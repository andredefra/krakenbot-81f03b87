// Edge Function: trading-engine (v2 Core-Satellite)
// Esegue UN ciclo del motore per ogni utente con settings.is_running = true.
// Modello v2:
//  - MACRO (BTC vs SMA200) governa il Core (BTC/ETH secondo core_weights).
//  - MEDIO (BTC vs SMA50 + Fear&Greed) governa il Satellite (momentum).
//  - Universo dinamico letto da public.universe (eligible=true). Fallback: settings.asset_universe.momentum.
//  - Max posizioni satellite = settings.max_satellite_positions (NON max_positions).
// Vedi STRATEGIA.md §3-§7 e BUILD_SPEC.md.

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
    const { data: users, error } = await supa.from("settings").select("*").eq("is_running", true);
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
  regime_filter?: "btc_sma50" | "btc_sma200" | "fg_only" | "off";
  fg_greed_cap?: number;
  strategy_preset?: string;
  // v2
  core_satellite_split?: { core: number; satellite: number };
  core_weights?: Record<string, number>;
  max_satellite_positions?: number;
  macro_ma_period?: number;
  mid_ma_period?: number;
  monthly_trade_cap?: number;
  // v3
  taker_fee_pct?: number;
  maker_fee_pct?: number;
  slippage_pct?: number;
  core_only_mode?: boolean;
  bear_dca_enabled?: boolean;
  bear_dca_fg_threshold?: number;
  bear_dca_cap_pct?: number;
  bear_dca_tranche_pct?: number;
  bear_dca_interval_days?: number;
  exclude_fiat_commodity?: boolean;
};

type Position = {
  id: string;
  user_id: string;
  asset: string;
  status: "open" | "closed";
  mode: "paper" | "live";
  sleeve?: "core" | "satellite" | "dca";
  entry_price: number;
  entry_value: number;
  qty: number;
  current_price: number | null;
  stop_price: number | null;
  trailing_high: number | null;
  open_reason: string | null;
  opened_at: string;
  fee_paid_usd?: number | null;
};

// Core loop ------------------------------------------------------------------
async function runCycle(supa: ReturnType<typeof createClient>, settings: Settings) {
  const userId = settings.user_id;
  await log(supa, userId, "info", "trading-engine", `Ciclo v3 avviato (${settings.mode})`);

  const macroPeriod = settings.macro_ma_period ?? 200;
  const midPeriod = settings.mid_ma_period ?? 50;
  const fgGreedCap = settings.fg_greed_cap ?? 75;
  const coreWeights = settings.core_weights ?? { BTC: 0.6, ETH: 0.4 };
  const split = settings.core_satellite_split ?? { core: 0.6, satellite: 0.4 };
  const maxSatPos = settings.max_satellite_positions ?? 2;
  // v3
  const takerFeePct = Number(settings.taker_fee_pct ?? 0.4);
  const coreOnly = Boolean(settings.core_only_mode ?? false);
  const bdEnabled = Boolean(settings.bear_dca_enabled ?? true);
  const bdFgThreshold = Number(settings.bear_dca_fg_threshold ?? 22);
  const bdCapPct = Number(settings.bear_dca_cap_pct ?? 30);
  const bdTranchePct = Number(settings.bear_dca_tranche_pct ?? 5);
  const bdIntervalDays = Number(settings.bear_dca_interval_days ?? 14);
  const monthlyCap = Number(settings.monthly_trade_cap ?? 6);
  const minTargetPct = Number(settings.min_target_pct ?? 5);

  // 1. Posizioni aperte
  const { data: openPos, error: oerr } = await supa
    .from("positions").select("*").eq("user_id", userId).eq("status", "open");
  if (oerr) throw oerr;
  const positions = (openPos ?? []) as Position[];
  const corePos = positions.filter((p) => p.sleeve === "core");
  const satPos = positions.filter((p) => (p.sleeve ?? "satellite") === "satellite");
  const dcaPos = positions.filter((p) => p.sleeve === "dca");

  // 2. Universo eligible (dinamico)
  const { data: universeRows } = await supa
    .from("universe").select("asset,volume_24h,spread_pct,first_seen,eligible").eq("eligible", true);
  const eligibleAssets = (universeRows ?? []).map((u) => u.asset as string).filter((a) => a !== "BTC" && a !== "ETH");
  const usedFallback = eligibleAssets.length === 0;
  const satelliteUniverse = usedFallback
    ? (settings.asset_universe.momentum ?? []).filter((a) => a !== "BTC" && a !== "ETH")
    : eligibleAssets;
  const coreAssets = Object.keys(coreWeights);

  // 3. Prezzi
  const priceSymbols = uniq([...coreAssets, ...satelliteUniverse, "BTC", ...positions.map((p) => p.asset)]);
  const prices = await fetchKrakenTickers(priceSymbols);
  if (Object.keys(prices).length === 0) throw new Error("Nessun prezzo recuperato da Kraken");

  // 4. Aggiorna posizioni aperte (trailing / stop)
  const updated: Position[] = [];
  for (const p of positions) {
    const price = prices[p.asset];
    if (!price) { updated.push(p); continue; }
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
    updated.push({ ...p, ...patch });
  }

  // 5. Valori portafoglio
  const positionsValue = updated.reduce((s, p) => s + (p.current_price ?? p.entry_price) * p.qty, 0);
  const { data: closedToday } = await supa
    .from("positions").select("pnl,closed_at").eq("user_id", userId).eq("status", "closed")
    .gte("closed_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString());
  const realizedToday = (closedToday ?? []).reduce((s, r) => s + Number(r.pnl ?? 0), 0);
  const investedNow = updated.reduce((s, p) => s + Number(p.entry_value), 0);
  const cash = Math.max(0, settings.capital_reference + realizedToday - investedNow);
  const portfolioTotal = cash + positionsValue;
  const coreValue = updated.filter((p) => p.sleeve === "core").reduce((s, p) => s + (p.current_price ?? p.entry_price) * p.qty, 0);
  const satValue = updated.filter((p) => (p.sleeve ?? "satellite") === "satellite").reduce((s, p) => s + (p.current_price ?? p.entry_price) * p.qty, 0);

  // 6. Kill-switch
  if (portfolioTotal <= settings.kill_switch_floor) {
    await supa.from("settings").update({ is_running: false }).eq("id", settings.id);
    const msg = `Kill-switch: portafoglio ${portfolioTotal.toFixed(2)} ≤ floor ${settings.kill_switch_floor}`;
    await log(supa, userId, "warn", "trading-engine", msg);
    await sendTelegram(fmtError({ component: "kill-switch", message: msg, action: "bot in pausa" }));
    await supa.from("portfolio_snapshots").insert({
      user_id: userId, total_value: portfolioTotal, cash_value: cash,
      positions_value: positionsValue, realized_pnl_day: realizedToday,
      core_value: coreValue, satellite_value: satValue,
    });
    return;
  }

  // 7. Gestione uscite (stop/take/trailing) — solo sleeve satellite (il core esce via macro switch)
  for (const p of updated.filter((x) => x.current_price !== null && (x.sleeve ?? "satellite") === "satellite")) {
    const price = p.current_price!;
    let exitReason: string | null = null;
    if (p.stop_price && price <= p.stop_price) {
      exitReason = p.trailing_high && p.trailing_high > p.entry_price ? "trailing stop" : "stop loss";
    } else if (price >= p.entry_price * (1 + settings.take_profit_pct / 100)) {
      exitReason = "take profit";
    }
    if (exitReason) await closePosition(supa, userId, settings, p, price, exitReason, takerFeePct);
  }

  // 8. REGIME MACRO (governa il Core) — BTC vs SMA200
  const btcCloses = await fetchKrakenDailyCloses("BTC", Math.max(macroPeriod + 10, 220));
  const btcSma200 = sma(btcCloses, macroPeriod);
  const btcSma50 = sma(btcCloses, midPeriod);
  const btcLast = prices["BTC"] ?? btcCloses[btcCloses.length - 1];
  const macroOn = btcSma200 != null && btcLast > btcSma200;
  const macroReason = btcSma200 == null
    ? `Dati BTC insufficienti per SMA${macroPeriod}`
    : macroOn
      ? `BTC ${btcLast.toFixed(0)} sopra SMA${macroPeriod} ${btcSma200.toFixed(0)} → core investito`
      : `BTC ${btcLast.toFixed(0)} sotto SMA${macroPeriod} ${btcSma200.toFixed(0)} → core in stable`;

  // 9. REGIME MEDIO (governa il Satellite) — BTC vs SMA50 + F&G
  const fg = await fetchFearGreed();
  const midUptrend = btcSma50 != null && btcLast > btcSma50;
  const fgGreedExtreme = fg ? fg.value > fgGreedCap : false;
  const mesoOn = midUptrend && !fgGreedExtreme;
  let mesoReason = "";
  if (btcSma50 == null) mesoReason = `Dati BTC insufficienti per SMA${midPeriod}`;
  else if (!midUptrend) mesoReason = `BTC sotto SMA${midPeriod} ${btcSma50.toFixed(0)} → satellite risk-off`;
  else if (fgGreedExtreme) mesoReason = `F&G ${fg?.value} > ${fgGreedCap} (Extreme Greed) → satellite risk-off`;
  else mesoReason = `BTC sopra SMA${midPeriod}, F&G ${fg?.value ?? "?"} → satellite risk-on`;

  // Sentiment snapshots
  if (fg) await supa.from("sentiment_snapshots").insert({
    user_id: userId, source: "fear_greed", scope: "market", score: fg.value,
    raw: { classification: fg.label, btc_uptrend: midUptrend },
  });
  await supa.from("sentiment_snapshots").insert({
    user_id: userId, source: "regime", scope: "market", score: mesoOn ? 1 : 0,
    raw: { macro: macroOn ? "risk-on" : "risk-off", meso: mesoOn ? "risk-on" : "risk-off", btc_last: btcLast, btc_sma50: btcSma50, btc_sma200: btcSma200, fg: fg?.value ?? null },
  });

  // 10. CORE REBALANCE (semplificato: switch on/off in base al macro)
  const coreCapital = split.core * settings.capital_reference;
  const coreHeld: Array<{ asset: string; qty: number; value_usd: number; weight_actual: number; weight_target: number }> = [];
  if (macroOn) {
    // Apri eventuali core mancanti per ciascun asset in coreWeights
    for (const asset of coreAssets) {
      const existing = corePos.find((p) => p.asset === asset);
      const price = prices[asset];
      const targetUsd = (coreWeights[asset] ?? 0) * coreCapital;
      if (!existing && price && targetUsd >= 5 && cash >= targetUsd * 0.99) {
        const qty = targetUsd / price;
        const stop = price * (1 - settings.stop_loss_pct / 100);
        const entryFee = targetUsd * (takerFeePct / 100);
        const { error: ierr } = await supa.from("positions").insert({
          user_id: userId, asset, status: "open", mode: settings.mode, sleeve: "core",
          entry_price: price, entry_value: targetUsd, qty,
          current_price: price, stop_price: stop, trailing_high: null,
          open_reason: `Core init macro risk-on (target ${(coreWeights[asset] * 100).toFixed(0)}%)`,
          fee_paid_usd: entryFee,
        });
        if (!ierr) {
          await log(supa, userId, "info", "trading-engine", `[CORE] Aperta ${asset} ${targetUsd.toFixed(2)} USD (fee ${entryFee.toFixed(2)})`);
          coreHeld.push({ asset, qty, value_usd: targetUsd, weight_actual: targetUsd / Math.max(1, portfolioTotal), weight_target: coreWeights[asset] });
        }
      } else if (existing) {
        const v = (existing.current_price ?? existing.entry_price) * existing.qty;
        coreHeld.push({ asset, qty: existing.qty, value_usd: v, weight_actual: v / Math.max(1, portfolioTotal), weight_target: coreWeights[asset] ?? 0 });
      }
    }
  } else {
    // Macro risk-off: chiudi tutto il core (sposta in stable)
    for (const p of corePos) {
      const price = prices[p.asset] ?? p.current_price ?? p.entry_price;
      await closePosition(supa, userId, settings, p, price, "macro risk-off → core in stable", takerFeePct);
    }
  }

  // 10b. BEAR-DCA ACCUMULATOR (v3)
  // Apre tranche su BTC quando macro=risk-off E F&G < soglia (paura estrema).
  // Resta aperto in downtrend; si chiude quando macro torna risk-on (release).
  const bdState: Record<string, unknown> = {
    enabled: bdEnabled, active: false, fg: fg?.value ?? null, fg_threshold: bdFgThreshold,
    deployed_usd: dcaPos.reduce((s, p) => s + Number(p.entry_value), 0),
    cap_usd: (bdCapPct / 100) * settings.capital_reference,
    positions: dcaPos.length,
    last_action: null as string | null,
  };
  if (macroOn && dcaPos.length > 0) {
    // Macro flip → rilascia accumulatore
    for (const p of dcaPos) {
      const price = prices[p.asset] ?? p.current_price ?? p.entry_price;
      await closePosition(supa, userId, settings, p, price, "macro risk-on → release Bear-DCA", takerFeePct);
    }
    bdState.last_action = "released_on_macro_risk_on";
  } else if (!macroOn && bdEnabled && fg && fg.value < bdFgThreshold) {
    bdState.active = true;
    const deployedUsd = dcaPos.reduce((s, p) => s + Number(p.entry_value), 0);
    const capUsd = (bdCapPct / 100) * settings.capital_reference;
    const budgetLeft = capUsd - deployedUsd;
    // Ultima tranche aperta (per intervallo)
    const lastDca = dcaPos.length ? dcaPos.map((p) => new Date(p.opened_at).getTime()).sort((a, b) => b - a)[0] : 0;
    const daysSince = lastDca ? (Date.now() - lastDca) / 86400000 : 1e9;
    if (budgetLeft <= 0) {
      bdState.last_action = "cap_reached";
    } else if (daysSince < bdIntervalDays) {
      bdState.last_action = `cooldown ${(bdIntervalDays - daysSince).toFixed(1)}d`;
    } else {
      const trancheUsd = Math.min((bdTranchePct / 100) * settings.capital_reference, budgetLeft, cash);
      const btcPrice = prices["BTC"];
      if (trancheUsd >= 5 && btcPrice) {
        const qty = trancheUsd / btcPrice;
        const entryFee = trancheUsd * (takerFeePct / 100);
        const reason = `Bear-DCA tranche (F&G ${fg.value} < ${bdFgThreshold}, macro risk-off)`;
        const { error: ierr } = await supa.from("positions").insert({
          user_id: userId, asset: "BTC", status: "open", mode: settings.mode, sleeve: "dca",
          entry_price: btcPrice, entry_value: trancheUsd, qty,
          current_price: btcPrice, stop_price: null, trailing_high: null,
          open_reason: reason, fee_paid_usd: entryFee,
        });
        if (!ierr) {
          bdState.last_action = "tranche_opened";
          await log(supa, userId, "info", "trading-engine", `[BEAR-DCA] Tranche BTC ${trancheUsd.toFixed(2)} USD (deployed ${(deployedUsd + trancheUsd).toFixed(2)}/${capUsd.toFixed(2)})`);
          await sendTelegram(fmtOpen({
            mode: settings.mode, asset: "BTC", price: btcPrice, qty, value: trancheUsd,
            pctOfPortfolio: bdTranchePct, reason, portfolioTotal,
          }));
        } else {
          bdState.last_action = `insert_error: ${ierr.message}`;
        }
      } else {
        bdState.last_action = `budget_or_cash_insufficient (tranche ${trancheUsd.toFixed(2)})`;
      }
    }
  }

  // 11. SATELLITE: candidati = solo universo eligible
  const dailyLossUsd = (settings.daily_loss_limit_pct / 100) * (cash + positionsValue);
  const dailyLossExceeded = -realizedToday >= dailyLossUsd;
  let stillOpenSat = satPos.length;
  const candidates: Array<Record<string, unknown>> = [];

  // Monthly trade cap: count satellite OPEN positions opened this month
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const { count: openedThisMonth } = await supa
    .from("positions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("sleeve", "satellite")
    .gte("opened_at", monthStart.toISOString());
  const monthlyCapHit = (openedThisMonth ?? 0) >= monthlyCap;

  // Pre-check: minimo target netto ≥ min_target_pct
  // Take-profit lordo deve coprire fee round-trip + min_target
  const feeRoundTripPct = takerFeePct * 2;
  const minTpRequired = minTargetPct + feeRoundTripPct;
  const tpUnderMin = settings.take_profit_pct < minTpRequired;

  const satBlockReason =
    coreOnly ? "Core-only mode attivo (satellite disabilitato)" :
    !mesoOn ? mesoReason :
    dailyLossExceeded ? `Limite perdita giornaliera superato (${realizedToday.toFixed(2)} USD)` :
    monthlyCapHit ? `Tetto trade mensile raggiunto (${openedThisMonth}/${monthlyCap})` :
    tpUnderMin ? `Take-profit ${settings.take_profit_pct}% < min target+fee ${minTpRequired.toFixed(2)}%` :
    stillOpenSat >= maxSatPos ? `Max posizioni satellite raggiunto (${stillOpenSat}/${maxSatPos})` :
    "";

  if (!satBlockReason) {
    for (const asset of satelliteUniverse) {
      const baseRow: Record<string, unknown> = {
        asset, price: prices[asset] ?? null, sma20: null, sma50: null,
        trendOk: false, priceOk: !!prices[asset], alreadyOpen: false, opened: false,
      };
      if (stillOpenSat + 1 > maxSatPos) {
        baseRow.reasonSkipped = `Max posizioni satellite raggiunto (${stillOpenSat}/${maxSatPos})`;
        candidates.push(baseRow); continue;
      }
      const already = satPos.find((p) => p.asset === asset);
      if (already) { baseRow.alreadyOpen = true; baseRow.reasonSkipped = "Posizione satellite già aperta"; candidates.push(baseRow); continue; }
      const price = prices[asset];
      if (!price) { baseRow.reasonSkipped = "Prezzo non disponibile"; candidates.push(baseRow); continue; }
      const closes = await fetchKrakenDailyCloses(asset, 60);
      const s20 = sma(closes, 20);
      const s50 = sma(closes, 50);
      baseRow.sma20 = s20; baseRow.sma50 = s50;
      baseRow.trendOk = !!(s20 && s50 && s20 > s50);
      if (!s20 || !s50 || !(s20 > s50)) {
        baseRow.reasonSkipped = `Trend SMA20 ≤ SMA50 (${s20?.toFixed(2) ?? "?"} vs ${s50?.toFixed(2) ?? "?"})`;
        candidates.push(baseRow); continue;
      }
      // Sizing: usa quota satellite del capitale
      const satCapital = split.satellite * settings.capital_reference;
      const sizeUsd = (settings.max_position_pct / 100) * satCapital;
      const MIN_ORDER_USD = 5;
      if (sizeUsd < MIN_ORDER_USD) { baseRow.reasonSkipped = `Size ${sizeUsd.toFixed(2)} USD sotto minimo`; candidates.push(baseRow); continue; }
      if (sizeUsd > cash * 0.99) { baseRow.reasonSkipped = `Cash insufficiente (size ${sizeUsd.toFixed(2)} > cash ${cash.toFixed(2)})`; candidates.push(baseRow); continue; }
      const qty = sizeUsd / price;
      const stop = price * (1 - settings.stop_loss_pct / 100);
      const entryFee = sizeUsd * (takerFeePct / 100);
      const reason = "SAT: SMA20>SMA50 + meso risk-on";
      const { error: ierr } = await supa.from("positions").insert({
        user_id: userId, asset, status: "open", mode: settings.mode, sleeve: "satellite",
        entry_price: price, entry_value: sizeUsd, qty,
        current_price: price, stop_price: stop, trailing_high: null, open_reason: reason,
        fee_paid_usd: entryFee,
      });
      if (ierr) { baseRow.reasonSkipped = `Errore insert: ${ierr.message}`; candidates.push(baseRow); continue; }
      baseRow.opened = true; candidates.push(baseRow); stillOpenSat += 1;
      await log(supa, userId, "info", "trading-engine", `[SAT] Aperta ${asset} a ${price.toFixed(4)} size ${sizeUsd.toFixed(2)} fee ${entryFee.toFixed(2)}`);
      await sendTelegram(fmtOpen({
        mode: settings.mode, asset, price, qty, value: sizeUsd,
        pctOfPortfolio: settings.max_position_pct, reason, portfolioTotal,
      }));
      if (stillOpenSat >= maxSatPos) break;
    }
  } else {
    for (const asset of satelliteUniverse) {
      candidates.push({ asset, price: prices[asset] ?? null, sma20: null, sma50: null, trendOk: false, priceOk: !!prices[asset], alreadyOpen: false, opened: false, reasonSkipped: satBlockReason });
    }
  }

  // 12. Diagnostica snapshot
  const universeEligible = (universeRows ?? []).map((u) => ({
    asset: u.asset, volume_24h: u.volume_24h, spread_pct: u.spread_pct,
    age_days: u.first_seen ? Math.floor((Date.now() - new Date(u.first_seen as string).getTime()) / 86400000) : null,
    eligible: u.eligible,
  }));

  await supa.from("engine_diagnostics").upsert({
    user_id: userId,
    cycle_at: new Date().toISOString(),
    // legacy (compat)
    regime: mesoOn ? "risk-on" : "risk-off",
    regime_reason: mesoReason,
    btc_last: btcLast,
    btc_sma50: btcSma50,
    fg_value: fg?.value ?? null,
    fg_label: fg?.label ?? null,
    candidates,
    notes: dailyLossExceeded ? "Limite perdita giornaliero superato" : (usedFallback ? "Universo dinamico vuoto: uso fallback statico (asset_universe.momentum)" : null),
    updated_at: new Date().toISOString(),
    // v2
    macro_regime: macroOn ? "risk-on" : "risk-off",
    macro_reason: macroReason,
    btc_sma200: btcSma200,
    meso_regime: mesoOn ? "risk-on" : "risk-off",
    meso_reason: mesoReason,
    core_state: {
      invested: macroOn,
      target_weights: coreWeights,
      core_capital_usd: coreCapital,
      held: coreHeld,
    },
    satellite_state: {
      open: stillOpenSat,
      max: maxSatPos,
      positions: satPos.map((p) => ({ asset: p.asset, entry_price: p.entry_price, current_price: p.current_price, qty: p.qty })),
    },
    universe_eligible: universeEligible,
    bear_dca_state: bdState,
  });

  // 13. Snapshot portafoglio finale
  const { data: finalPos } = await supa
    .from("positions").select("entry_value,qty,current_price,entry_price,sleeve")
    .eq("user_id", userId).eq("status", "open");
  const finalPosValue = (finalPos ?? []).reduce((s, p) => s + Number(p.current_price ?? p.entry_price) * Number(p.qty), 0);
  const finalCore = (finalPos ?? []).filter((p) => p.sleeve === "core").reduce((s, p) => s + Number(p.current_price ?? p.entry_price) * Number(p.qty), 0);
  const finalSat = (finalPos ?? []).filter((p) => (p.sleeve ?? "satellite") === "satellite").reduce((s, p) => s + Number(p.current_price ?? p.entry_price) * Number(p.qty), 0);
  const finalInvested = (finalPos ?? []).reduce((s, p) => s + Number(p.entry_value), 0);
  const finalCash = Math.max(0, settings.capital_reference + realizedToday - finalInvested);
  const finalTotal = finalCash + finalPosValue;

  await supa.from("portfolio_snapshots").insert({
    user_id: userId, total_value: finalTotal, cash_value: finalCash,
    positions_value: finalPosValue, realized_pnl_day: realizedToday,
    core_value: finalCore, satellite_value: finalSat,
  });

  await log(supa, userId, "info", "trading-engine", `Ciclo v2 completato totale ${finalTotal.toFixed(2)} (core ${finalCore.toFixed(2)} / sat ${finalSat.toFixed(2)})`);
}

// Helpers --------------------------------------------------------------------
async function closePosition(supa: ReturnType<typeof createClient>, userId: string, settings: Settings, p: Position, price: number, reason: string, takerFeePct = 0.4) {
  const exitValue = price * p.qty;
  const exitFee = exitValue * (takerFeePct / 100);
  const entryFee = Number(p.fee_paid_usd ?? 0);
  const totalFee = entryFee + exitFee;
  const pnl = exitValue - Number(p.entry_value) - exitFee; // net of exit fee
  const pnlPct = (pnl / Number(p.entry_value)) * 100;
  const closedAt = new Date().toISOString();
  await supa.from("positions").update({
    status: "closed", exit_price: price, exit_value: exitValue,
    pnl, pnl_pct: pnlPct, exit_reason: reason, closed_at: closedAt,
    fee_paid_usd: totalFee,
  }).eq("id", p.id);
  await log(supa, userId, "info", "trading-engine", `Chiuso ${p.asset} (${reason}) P/L ${pnl.toFixed(2)} fee ${totalFee.toFixed(2)}`);
  await sendTelegram(fmtClose({
    mode: settings.mode, asset: p.asset, win: pnl >= 0,
    entryValue: Number(p.entry_value), entryPrice: Number(p.entry_price),
    exitValue, exitPrice: price, pnl, pnlPct,
    duration: durationStr(p.opened_at, closedAt), reason,
  }));
}

function uniq<T>(arr: T[]): T[] { return [...new Set(arr)]; }

async function log(supa: ReturnType<typeof createClient>, userId: string, level: "info" | "warn" | "error", component: string, message: string) {
  try { await supa.from("events_log").insert({ user_id: userId, level, component, message }); }
  catch (e) { console.error("log insert failed", e); }
}
