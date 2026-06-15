// Server functions for the Paper → Live transition report.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Aggregates paper-mode data, generates a PDF "snapshot", inserts an event in
 * events_log with the snapshot payload, and flips settings.mode to 'live'.
 */
export const generatePaperGoLiveReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context;

    // Pull paper data
    const [settingsR, closedR, snapshotsR] = await Promise.all([
      supabase.from("settings").select("*").maybeSingle(),
      supabase
        .from("positions")
        .select("asset,entry_value,exit_value,pnl,pnl_pct,opened_at,closed_at")
        .eq("mode", "paper")
        .eq("status", "closed")
        .order("closed_at", { ascending: true }),
      supabase
        .from("portfolio_snapshots")
        .select("ts,total_value")
        .eq("mode", "paper")
        .order("ts", { ascending: true }),
    ]);

    if (settingsR.error) throw new Error(settingsR.error.message);
    if (closedR.error) throw new Error(closedR.error.message);
    if (snapshotsR.error) throw new Error(snapshotsR.error.message);
    const settings = settingsR.data;
    if (!settings) throw new Error("Settings non trovate");

    const closed = closedR.data ?? [];
    const snapshots = snapshotsR.data ?? [];

    // Compute stats
    const wins = closed.filter((p) => (p.pnl ?? 0) > 0);
    const losses = closed.filter((p) => (p.pnl ?? 0) <= 0);
    const totalPnl = closed.reduce((s, p) => s + (p.pnl ?? 0), 0);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const initial = snapshots[0]?.total_value ?? settings.capital_reference ?? 0;
    const final = snapshots[snapshots.length - 1]?.total_value ?? initial + totalPnl;
    const pnlPct = initial > 0 ? ((final - initial) / initial) * 100 : 0;

    // Max drawdown from equity curve
    let peak = initial;
    let maxDD = 0;
    for (const s of snapshots) {
      if (s.total_value > peak) peak = s.total_value;
      const dd = peak > 0 ? ((peak - s.total_value) / peak) * 100 : 0;
      if (dd > maxDD) maxDD = dd;
    }

    // Holding times
    const holds = closed
      .map((p) => p.opened_at && p.closed_at ? (new Date(p.closed_at).getTime() - new Date(p.opened_at).getTime()) / 3600000 : null)
      .filter((x): x is number => x !== null);

    // By asset
    const assetMap = new Map<string, { trades: number; pnl: number; wins: number }>();
    for (const p of closed) {
      const a = assetMap.get(p.asset) ?? { trades: 0, pnl: 0, wins: 0 };
      a.trades += 1;
      a.pnl += p.pnl ?? 0;
      if ((p.pnl ?? 0) > 0) a.wins += 1;
      assetMap.set(p.asset, a);
    }
    const byAsset = Array.from(assetMap.entries())
      .map(([asset, v]) => ({
        asset,
        trades: v.trades,
        pnl: v.pnl,
        winRatePct: v.trades ? (v.wins / v.trades) * 100 : 0,
      }))
      .sort((a, b) => b.pnl - a.pnl);

    const enabled = (settings.enabled_sentiment_sources ?? {}) as Record<string, boolean>;
    const weights = (settings.sentiment_weights ?? {}) as Record<string, number>;

    const reportData = {
      generatedAt: new Date().toISOString(),
      userEmail: (claims?.email as string | undefined) ?? null,
      period: {
        from: snapshots[0]?.ts ?? closed[0]?.opened_at ?? null,
        to: new Date().toISOString(),
      },
      capital: {
        initial,
        final,
        pnl: final - initial,
        pnlPct,
        maxDrawdownPct: maxDD,
      },
      trades: {
        total: closed.length,
        wins: wins.length,
        losses: losses.length,
        winRatePct: closed.length ? (wins.length / closed.length) * 100 : 0,
        avgWinPct: avg(wins.map((p) => p.pnl_pct ?? 0)),
        avgLossPct: avg(losses.map((p) => p.pnl_pct ?? 0)),
        bestTradePct: closed.length ? Math.max(...closed.map((p) => p.pnl_pct ?? 0)) : 0,
        worstTradePct: closed.length ? Math.min(...closed.map((p) => p.pnl_pct ?? 0)) : 0,
        avgHoldHours: avg(holds),
      },
      byAsset,
      equityCurve: snapshots.map((s) => ({ ts: s.ts, total: s.total_value })),
      settings: {
        timeframe: settings.timeframe,
        maxPositions: settings.max_positions,
        maxPositionPct: settings.max_position_pct,
        stopLossPct: settings.stop_loss_pct,
        trailingActivatePct: settings.trailing_activate_pct,
        trailingGapPct: settings.trailing_gap_pct,
        takeProfitPct: settings.take_profit_pct,
        dailyLossLimitPct: settings.daily_loss_limit_pct,
        enabledSentimentSources: enabled,
        sentimentWeights: weights,
      },
    };

    // Insert event log (kind=paper_report) carrying the snapshot payload
    const { data: eventRow, error: eventErr } = await supabase
      .from("events_log")
      .insert({
        user_id: userId,
        component: "mode",
        level: "info",
        mode: "paper",
        message: `Report Paper generato — passaggio a LIVE (P&L ${reportData.capital.pnl.toFixed(2)} USD, ${reportData.trades.total} trade)`,
        payload: { kind: "paper_report", ...reportData },
      })
      .select("id")
      .single();
    if (eventErr) throw new Error(eventErr.message);

    // Flip mode to live
    const { error: modeErr } = await supabase
      .from("settings")
      .update({ mode: "live" })
      .eq("user_id", userId);
    if (modeErr) throw new Error(modeErr.message);

    // Marker event in live mode
    await supabase.from("events_log").insert({
      user_id: userId,
      component: "mode",
      level: "info",
      mode: "live",
      message: "Modalità LIVE attivata — i dati Paper sono congelati nell'archivio",
    });

    return { ok: true, eventId: eventRow.id, summary: reportData.capital };
  });

/**
 * Returns the PDF bytes (base64) for a previously generated paper report event.
 */
export const downloadPaperReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { eventId: string }) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("events_log")
      .select("payload,ts")
      .eq("id", data.eventId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = row?.payload as any;
    if (!payload || payload.kind !== "paper_report") {
      throw new Error("Report non disponibile per questo evento");
    }
    const { buildPaperReportPdf } = await import("./reports/build-pdf.server");
    const bytes = await buildPaperReportPdf(payload);
    // Convert to base64 for transport
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const base64 = btoa(bin);
    const filename = `report-paper-${new Date(row!.ts).toISOString().slice(0, 10)}.pdf`;
    return { base64, filename };
  });
