// Edge Function: trading-engine
// Esegue UN ciclo del motore per ogni utente con settings.is_running = true.
// Fase 1: PAPER only. Nessun ordine reale Kraken.
// Vedi BUILD_SPEC.md §4 e STRATEGIA.md §5.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendTelegram, fmtOpen, fmtClose, fmtError, durationStr } from "../_shared/telegram.ts";
import { fetchKrakenTickers, fetchKrakenDailyCloses, fetchFearGreed, sma } from "../_shared/market.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supa = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });

  try {
    const { data: users, error } = await supa
      .from("settings")
      .select("*")
      .eq("is_running", true);
    if (error) throw error;

    const results: Array<{ user_id: string; ok: boolean; note?: string }> = [];

    for (const settings of users ?? []) {
      try {
        await runCycle(supa, settings);
        results.push({ user_id: settings.user_id, ok: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supa.from("events_log").insert({
          user_id: settings.user_id,
          level: "error",
          component: "trading-engine",
          message: msg,
        });
        await sendTelegram(fmtError({ component: "trading-engine", message: msg, action: "ciclo saltato" }));
        results.push({ user_id: settings.user_id, ok: false, note: msg });
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});

// Types ----------------------------------------------------------------------
type Settings = {
  id: string;
  user_id: string;
  mode: "paper" | "live";
  is_running: boolean;
  capital_reference: number;
  kill_switch_floor: number;
  max_positions: number;
  max_position_pct: number;
  stop_loss_pct: number;
  trailing_activate_pct: number;
  trailing_gap_pct: number;
  take_profit_pct: number;
  min_target_pct: number;
  daily_loss_limit_pct: number;
  timeframe: string;
  enabled_sentiment_sources: Record<string, boolean>;
  sentiment_weights: Record<string, number>;
  asset_universe: { core?: string[]; momentum?: string[]; regime?: string[] };
};

type Position = {
  id: string;
  user_id: string;
  asset: string;
  status: "open" | "closed";
  mode: "paper" | "live";
  entry_price: number;
  entry_value: number;
  qty: number;
  current_price: number | null;
  stop_price: number | null;
  trailing_high: number | null;
  open_reason: string | null;
  opened_at: string;
};

// Core loop ------------------------------------------------------------------
async function runCycle(supa: ReturnType<typeof createClient>, settings: Settings) {
  const userId = settings.user_id;
  const isPaper = settings.mode === "paper";

  await log(supa, userId, "info", "trading-engine", `Ciclo avviato (${settings.mode})`);

  // 1. Posizioni aperte
  const { data: openPos, error: oerr } = await supa
    .from("positions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "open");
  if (oerr) throw oerr;
  const positions = (openPos ?? []) as Position[];

  // 2. Universo simboli (BTC sempre, anche solo per regime)
  const universe = uniq([
    ...(settings.asset_universe.core ?? []),
    ...(settings.asset_universe.momentum ?? []),
    "BTC",
  ]);
  const priceSymbols = uniq([...universe, ...positions.map((p) => p.asset)]);

  // 3. Prezzi pubblici Kraken
  const prices = await fetchKrakenTickers(priceSymbols);
  if (Object.keys(prices).length === 0) throw new Error("Nessun prezzo recuperato da Kraken");

  // 4. Aggiorna posizioni aperte (current_price, trailing_high, stop_price)
  const updatedPositions: Position[] = [];
  for (const p of positions) {
    const price = prices[p.asset];
    if (!price) {
      updatedPositions.push(p);
      continue;
    }
    const trailingActivatePrice = p.entry_price * (1 + settings.trailing_activate_pct / 100);
    let trailingHigh = p.trailing_high;
    let stop = p.stop_price ?? p.entry_price * (1 - settings.stop_loss_pct / 100);
    if (price >= trailingActivatePrice) {
      trailingHigh = Math.max(trailingHigh ?? price, price);
      const trailStop = trailingHigh * (1 - settings.trailing_gap_pct / 100);
      stop = Math.max(stop, trailStop);
    }
    const patch = { current_price: price, trailing_high: trailingHigh, stop_price: stop };
    await supa.from("positions").update(patch).eq("id", p.id);
    updatedPositions.push({ ...p, ...patch });
  }

  // 5. Calcolo valore portafoglio (paper: cash = capital_reference - costo posizioni aperte storiche)
  const positionsValue = updatedPositions.reduce((s, p) => s + (p.current_price ?? p.entry_price) * p.qty, 0);
  // realized_today
  const { data: closedToday } = await supa
    .from("positions")
    .select("pnl,closed_at")
    .eq("user_id", userId)
    .eq("status", "closed")
    .gte("closed_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString());
  const realizedToday = (closedToday ?? []).reduce((s, r) => s + Number(r.pnl ?? 0), 0);
  const investedNow = updatedPositions.reduce((s, p) => s + Number(p.entry_value), 0);
  const cash = Math.max(0, settings.capital_reference + realizedToday - investedNow);
  const portfolioTotal = cash + positionsValue;

  // 6. Kill-switch
  if (portfolioTotal <= settings.kill_switch_floor) {
    await supa.from("settings").update({ is_running: false }).eq("id", settings.id);
    const msg = `Kill-switch attivato: portafoglio ${portfolioTotal.toFixed(2)} ≤ floor ${settings.kill_switch_floor}`;
    await log(supa, userId, "warn", "trading-engine", msg);
    await sendTelegram(fmtError({ component: "kill-switch", message: msg, action: "bot in pausa" }));
    // salva snapshot e termina
    await supa.from("portfolio_snapshots").insert({
      user_id: userId,
      total_value: portfolioTotal,
      cash_value: cash,
      positions_value: positionsValue,
      realized_pnl_day: realizedToday,
    });
    return;
  }

  // 7. Gestione uscite (simulata in paper)
  for (const p of updatedPositions.filter((x) => x.current_price !== null)) {
    const price = p.current_price!;
    let exitReason: string | null = null;
    if (p.stop_price && price <= p.stop_price) {
      exitReason = p.trailing_high && p.trailing_high > p.entry_price ? "trailing stop" : "stop loss";
    } else if (price >= p.entry_price * (1 + settings.take_profit_pct / 100)) {
      exitReason = "take profit";
    }
    if (exitReason) {
      const exitValue = price * p.qty;
      const pnl = exitValue - Number(p.entry_value);
      const pnlPct = (pnl / Number(p.entry_value)) * 100;
      const closedAt = new Date().toISOString();
      await supa
        .from("positions")
        .update({
          status: "closed",
          exit_price: price,
          exit_value: exitValue,
          pnl,
          pnl_pct: pnlPct,
          exit_reason: exitReason,
          closed_at: closedAt,
        })
        .eq("id", p.id);
      await log(supa, userId, "info", "trading-engine", `Chiuso ${p.asset} (${exitReason}) P/L ${pnl.toFixed(2)}`);
      await sendTelegram(
        fmtClose({
          mode: settings.mode,
          asset: p.asset,
          win: pnl >= 0,
          entryValue: Number(p.entry_value),
          entryPrice: Number(p.entry_price),
          exitValue,
          exitPrice: price,
          pnl,
          pnlPct,
          duration: durationStr(p.opened_at, closedAt),
          reason: exitReason,
          portfolioTotal,
        }),
      );
    }
  }

  // 8. Regime: BTC > SMA50 daily + F&G non extreme greed → risk-on
  const btcCloses = await fetchKrakenDailyCloses("BTC", 60);
  const sma50 = sma(btcCloses, 50);
  const btcLast = prices["BTC"] ?? btcCloses[btcCloses.length - 1];
  const fg = await fetchFearGreed();
  const btcUptrend = sma50 != null && btcLast > sma50;
  const fgGreedExtreme = fg ? fg.value > 75 : false;
  const riskOn = btcUptrend && !fgGreedExtreme;

  if (fg) {
    await supa.from("sentiment_snapshots").insert({
      user_id: userId,
      source: "fear_greed",
      scope: "market",
      score: fg.value,
      raw: { classification: fg.label, btc_uptrend: btcUptrend },
    });
  }
  await supa.from("sentiment_snapshots").insert({
    user_id: userId,
    source: "regime",
    scope: "market",
    score: riskOn ? 1 : 0,
    raw: { label: riskOn ? "risk-on" : "risk-off", btc_last: btcLast, btc_sma50: sma50, fg: fg?.value ?? null },
  });

  // 9. Stub ingressi: regola tecnica base
  // Aprire solo se: risk-on, posizioni < max, limite giorno non superato.
  const dailyLossUsd = (settings.daily_loss_limit_pct / 100) * (cash + positionsValue);
  const dailyLossExceeded = -realizedToday >= dailyLossUsd;
  const stillOpenCount = (await supa.from("positions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "open")).count ?? 0;

  if (riskOn && stillOpenCount < settings.max_positions && !dailyLossExceeded) {
    const candidates = uniq([...(settings.asset_universe.core ?? []), ...(settings.asset_universe.momentum ?? [])]).filter((a) => a !== "BTC");
    for (const asset of candidates) {
      if (stillOpenCount + 1 > settings.max_positions) break;
      // Skip se già aperta
      const { data: alreadyOpen } = await supa
        .from("positions")
        .select("id")
        .eq("user_id", userId)
        .eq("asset", asset)
        .eq("status", "open")
        .maybeSingle();
      if (alreadyOpen) continue;

      const price = prices[asset];
      if (!price) continue;

      // Regola tecnica STUB: SMA20 > SMA50 su daily come proxy di trend
      const closes = await fetchKrakenDailyCloses(asset, 60);
      const s20 = sma(closes, 20);
      const s50 = sma(closes, 50);
      if (!s20 || !s50 || !(s20 > s50)) continue;

      const sizeUsd = (settings.max_position_pct / 100) * portfolioTotal;
      const MIN_ORDER_USD = 5;
      if (sizeUsd < MIN_ORDER_USD) continue;
      if (sizeUsd > cash * 0.99) continue;

      const qty = sizeUsd / price;
      const stop = price * (1 - settings.stop_loss_pct / 100);
      const reason = "SMA20>SMA50 daily, risk-on";

      const { data: inserted, error: ierr } = await supa
        .from("positions")
        .insert({
          user_id: userId,
          asset,
          status: "open",
          mode: settings.mode,
          entry_price: price,
          entry_value: sizeUsd,
          qty,
          current_price: price,
          stop_price: stop,
          trailing_high: null,
          open_reason: reason,
        })
        .select()
        .single();
      if (ierr) {
        await log(supa, userId, "error", "trading-engine", `Open ${asset} failed: ${ierr.message}`);
        continue;
      }

      await log(supa, userId, "info", "trading-engine", `Aperta ${asset} a ${price.toFixed(4)} size ${sizeUsd.toFixed(2)}`);
      await sendTelegram(
        fmtOpen({
          mode: settings.mode,
          asset,
          price,
          qty,
          value: sizeUsd,
          pctOfPortfolio: settings.max_position_pct,
          reason,
          portfolioTotal,
        }),
      );

      // Aggiorna contatori locali per il prossimo ciclo iterativo
      void inserted;
    }
  }

  // 10. Snapshot portafoglio finale
  // Ricalcola posizioni dopo eventuali ingressi/uscite
  const { data: finalPos } = await supa
    .from("positions")
    .select("entry_value,qty,current_price,entry_price")
    .eq("user_id", userId)
    .eq("status", "open");
  const finalPosValue = (finalPos ?? []).reduce(
    (s, p) => s + Number(p.current_price ?? p.entry_price) * Number(p.qty),
    0,
  );
  const finalInvested = (finalPos ?? []).reduce((s, p) => s + Number(p.entry_value), 0);
  const finalCash = Math.max(0, settings.capital_reference + realizedToday - finalInvested);
  const finalTotal = finalCash + finalPosValue;

  await supa.from("portfolio_snapshots").insert({
    user_id: userId,
    total_value: finalTotal,
    cash_value: finalCash,
    positions_value: finalPosValue,
    realized_pnl_day: realizedToday,
  });

  await log(supa, userId, "info", "trading-engine", `Ciclo completato (paper=${isPaper}) totale ${finalTotal.toFixed(2)}`);
}

// Helpers --------------------------------------------------------------------
function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

async function log(
  supa: ReturnType<typeof createClient>,
  userId: string,
  level: "info" | "warn" | "error",
  component: string,
  message: string,
) {
  try {
    await supa.from("events_log").insert({ user_id: userId, level, component, message });
  } catch (e) {
    console.error("log insert failed", e);
  }
}
