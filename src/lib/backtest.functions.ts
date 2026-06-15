// Server function wrapping the pure backtest engine.
// Loads OHLC + F&G from historical_ohlc / fg_history tables, runs deterministic
// backtest, caches result in backtest_runs.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getPreset, type PresetId } from "./strategy-presets";

const inputSchema = z.object({
  preset: z.enum(["conservative", "balanced", "aggressive"]),
  years: z.number().int().min(1).max(5),
  universe: z.enum(["core", "core_sleeve"]),
});

// Universe = which crypto assets get traded (BTC always loaded for regime + benchmark)
const CORE_ASSETS = ["ETH", "SOL"];
const SLEEVE_ASSETS = ["ADA", "LINK", "AVAX", "DOT", "XRP", "LTC"];

function hashInput(input: { preset: string; years: number; universe: string }): string {
  return `${input.preset}|${input.years}y|${input.universe}`;
}

export const runBacktestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const input_hash = hashInput(data);

    // Check cache
    const cached = await supabase
      .from("backtest_runs")
      .select("result,created_at")
      .eq("user_id", userId)
      .eq("input_hash", input_hash)
      .maybeSingle();
    if (cached.data) {
      const age = Date.now() - new Date(cached.data.created_at).getTime();
      if (age < 24 * 3600 * 1000) {
        return { cached: true, ...(cached.data.result as Record<string, unknown>) };
      }
    }

    const presetMeta = getPreset(data.preset as PresetId);
    if (!presetMeta.values) throw new Error("Preset senza valori");

    const since = new Date();
    since.setFullYear(since.getFullYear() - data.years);
    const sinceStr = since.toISOString().slice(0, 10);

    // Load BTC, SPX, traded universe
    const tradedSyms = data.universe === "core" ? CORE_ASSETS : [...CORE_ASSETS, ...SLEEVE_ASSETS];
    const allSyms = ["BTC", "SPX", ...tradedSyms];

    const { data: ohlc, error: oerr } = await supabase
      .from("historical_ohlc")
      .select("symbol,date,close")
      .in("symbol", allSyms)
      .gte("date", sinceStr)
      .order("date", { ascending: true });
    if (oerr) throw new Error(oerr.message);
    if (!ohlc || ohlc.length === 0) {
      throw new Error("Storico non ancora popolato. Esegui historical-sync prima.");
    }

    const bySym: Record<string, Array<{ date: string; close: number }>> = {};
    for (const r of ohlc) {
      (bySym[r.symbol] ??= []).push({ date: r.date as string, close: Number(r.close) });
    }
    if (!bySym["BTC"] || bySym["BTC"].length < 60) {
      throw new Error("Storico BTC insufficiente (servono almeno 60 candele).");
    }

    const fgRows = await supabase
      .from("fg_history")
      .select("date,value")
      .gte("date", sinceStr)
      .order("date", { ascending: true });
    const fg = (fgRows.data ?? []).map((r) => ({ date: r.date as string, value: r.value }));

    const assets: Record<string, Array<{ date: string; close: number }>> = {};
    for (const sym of tradedSyms) {
      if (bySym[sym] && bySym[sym].length > 50) assets[sym] = bySym[sym];
    }

    const { runBacktest } = await import("./backtest.server");
    const result = runBacktest({
      startCapital: 1000,
      preset: {
        max_positions: presetMeta.values.max_positions,
        max_position_pct: presetMeta.values.max_position_pct,
        stop_loss_pct: presetMeta.values.stop_loss_pct,
        trailing_activate_pct: presetMeta.values.trailing_activate_pct,
        trailing_gap_pct: presetMeta.values.trailing_gap_pct,
        take_profit_pct: presetMeta.values.take_profit_pct,
        daily_loss_limit_pct: presetMeta.values.daily_loss_limit_pct,
        fg_greed_cap: presetMeta.values.fg_greed_cap,
        regime_filter: presetMeta.values.regime_filter,
      },
      btc: bySym["BTC"],
      spx: bySym["SPX"] ?? [],
      fg,
      assets,
      feePct: 0.4,
      slippagePct: 0.1,
    });

    // Downsample equity to ~250 points for chart payload
    const step = Math.max(1, Math.floor(result.equity.length / 250));
    const downEq = result.equity.filter((_, i) => i % step === 0 || i === result.equity.length - 1);

    const payload = {
      cached: false,
      equity: downEq,
      strategyKpis: result.strategyKpis,
      btcKpis: result.btcKpis,
      spxKpis: result.spxKpis,
      tradesCount: result.tradeLog.length,
      universe: data.universe,
      preset: data.preset,
      years: data.years,
    };

    await supabase
      .from("backtest_runs")
      .upsert({ user_id: userId, input_hash, preset: data.preset, years: data.years, universe: data.universe, result: payload });

    return payload;
  });
