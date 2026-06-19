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
  startCapital: z.number().min(10).max(100_000_000).default(200),
});

type KpisShape = { totalReturnPct: number; cagr: number; maxDrawdownPct: number; sharpe: number; sortino: number; trades: number; winRatePct: number; profitFactor: number };

export type BacktestPayload = {
  cached: boolean;
  equity: Array<{ date: string; strategy: number; btc: number; spx: number }>;
  strategyKpis: KpisShape;
  btcKpis: KpisShape;
  spxKpis: KpisShape;
  passesLiveGate: boolean;
  liveGateChecks: { profitFactorOk: boolean; sharpeOk: boolean; beatsBtcSharpe: boolean; beatsBtcDrawdown: boolean };
  tradesCount: number;
  preset: string;
  years: number;
};

// Universo completo Kraken: l'AI Supervisor decide a runtime quali asset
// usare (core_only_mode / exclude_fiat_commodity). Il backtest simula lo
// scenario "AI lascia accesso libero" come riferimento storico.
const FULL_UNIVERSE = ["ETH", "SOL", "ADA", "LINK", "AVAX", "DOT", "XRP", "LTC"];
const CORE_ASSETS = ["BTC", "ETH"]; // sleeve core buy & hold equipesato

function hashInput(input: { preset: string; years: number; startCapital: number }): string {
  return `v6|${input.preset}|${input.years}y|${input.startCapital}€`;
}

// PostgREST applica un max-rows interno (1000) che .range(0, 9999) NON sovrascrive:
// per finestre > ~2.7 anni la query veniva troncata silenziosamente. Pagina finché
// la risposta restituisce esattamente PAGE righe.
const PAGE_SIZE = 1000;
async function fetchOhlcAllPages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  symbol: string,
  sinceStr: string,
): Promise<Array<{ date: string; close: number }>> {
  const out: Array<{ date: string; close: number }> = [];
  let from = 0;
  while (from < 15000) {
    const r = await supabase
      .from("historical_ohlc")
      .select("date,close")
      .eq("symbol", symbol)
      .gte("date", sinceStr)
      .order("date", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (r.error) throw new Error(r.error.message);
    const rows = r.data ?? [];
    for (const row of rows) out.push({ date: row.date as string, close: Number(row.close) });
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

async function fetchFgAllPages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sinceStr: string,
): Promise<Array<{ date: string; value: number }>> {
  const out: Array<{ date: string; value: number }> = [];
  let from = 0;
  while (from < 15000) {
    const r = await supabase
      .from("fg_history")
      .select("date,value")
      .gte("date", sinceStr)
      .order("date", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (r.error) throw new Error(r.error.message);
    const rows = r.data ?? [];
    for (const row of rows) out.push({ date: row.date as string, value: row.value });
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

export const runBacktestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Load user-specific fees + bear-DCA params from settings (v3)
    const settingsRes = await supabase
      .from("settings")
      .select("maker_fee_pct, taker_fee_pct, slippage_pct, bear_dca_enabled, bear_dca_fg_threshold, bear_dca_cap_pct, bear_dca_tranche_pct, bear_dca_interval_days")
      .eq("user_id", userId)
      .maybeSingle();
    const s = (settingsRes.data ?? {}) as Record<string, number | boolean | null>;
    const feePct = Number(s.taker_fee_pct ?? 0.4);
    const slippagePct = Number(s.slippage_pct ?? 0.05);
    const bearEnabled = Boolean(s.bear_dca_enabled ?? true);
    const bearCapPct = Number(s.bear_dca_cap_pct ?? 30);
    const bearTranchePct = Number(s.bear_dca_tranche_pct ?? 5);
    const bearIntervalDays = Number(s.bear_dca_interval_days ?? 14);
    const bearFgThreshold = Number(s.bear_dca_fg_threshold ?? 22);

    const input_hash = `v7|${hashInput(data)}|fee${feePct}|slip${slippagePct}|bd${bearEnabled ? 1 : 0}|${bearCapPct}/${bearTranchePct}/${bearIntervalDays}/${bearFgThreshold}`;


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
        return { ...(cached.data.result as Record<string, unknown>), cached: true } as BacktestPayload;
      }
    }

    const presetMeta = getPreset(data.preset as PresetId);
    if (!presetMeta.values) throw new Error("Preset senza valori");

    const since = new Date();
    since.setFullYear(since.getFullYear() - data.years);
    const sinceStr = since.toISOString().slice(0, 10);

    const allSyms = ["BTC", "SPX", ...FULL_UNIVERSE];

    const bySym: Record<string, Array<{ date: string; close: number }>> = {};
    const ohlcResults = await Promise.all(
      allSyms.map((sym) => fetchOhlcAllPages(supabase, sym, sinceStr)),
    );
    for (let i = 0; i < allSyms.length; i++) {
      const rows = ohlcResults[i];
      if (rows.length) bySym[allSyms[i]] = rows;
    }
    if (Object.keys(bySym).length === 0) {
      throw new Error("Storico non ancora popolato. Esegui historical-sync prima.");
    }
    if (!bySym["BTC"] || bySym["BTC"].length < 60) {
      throw new Error("Storico BTC insufficiente (servono almeno 60 candele).");
    }

    const fg = await fetchFgAllPages(supabase, sinceStr);

    const assets: Record<string, Array<{ date: string; close: number }>> = {};
    // include core BTC/ETH come asset disponibili (core sleeve) + satellite
    const allTradedSyms = [...new Set([...CORE_ASSETS, ...FULL_UNIVERSE])];
    for (const sym of allTradedSyms) {
      if (bySym[sym] && bySym[sym].length > 50) assets[sym] = bySym[sym];
    }

    const { runBacktest } = await import("./backtest.server");
    const result = runBacktest({
      startCapital: data.startCapital,
      preset: {
        max_positions: presetMeta.values.max_satellite_positions,
        max_position_pct: presetMeta.values.max_position_pct,
        stop_loss_pct: presetMeta.values.stop_min_pct,
        trailing_activate_pct: presetMeta.values.trailing_activate_pct,
        trailing_gap_pct: presetMeta.values.trailing_gap_pct,
        take_profit_pct: presetMeta.values.take_profit_pct,
        daily_loss_limit_pct: presetMeta.values.daily_loss_limit_pct,
        fg_greed_cap: presetMeta.values.fg_greed_cap,
        regime_filter: "btc_sma200",
        core_pct: presetMeta.values.core_satellite_split.core,
        core_assets: CORE_ASSETS,
        monthly_trade_cap: presetMeta.values.monthly_trade_cap,
        cooldown_hours: presetMeta.values.cooldown_hours,
        min_target_pct: presetMeta.values.min_target_pct,
      },
      btc: bySym["BTC"],
      spx: bySym["SPX"] ?? [],
      fg,
      assets,
      feePct,
      slippagePct,
      bearDca: {
        enabled: bearEnabled,
        fgThreshold: bearFgThreshold,
        intervalDays: bearIntervalDays,
        tranchePct: bearTranchePct,
        maxPct: bearCapPct,
        smaPeriod: 200,
      },
    });


    const step = Math.max(1, Math.floor(result.equity.length / 250));
    const downEq = result.equity.filter((_, i) => i % step === 0 || i === result.equity.length - 1);

    const payload: BacktestPayload = {
      cached: false,
      equity: downEq,
      strategyKpis: result.strategyKpis,
      btcKpis: result.btcKpis,
      spxKpis: result.spxKpis,
      passesLiveGate: result.passesLiveGate,
      liveGateChecks: result.liveGateChecks,
      tradesCount: result.tradeLog.length,
      preset: data.preset,
      years: data.years,
    };

    await supabase
      .from("backtest_runs")
      .upsert({
        user_id: userId,
        input_hash,
        preset: data.preset,
        years: data.years,
        universe: "ai_managed",
        result: payload,
        passes_live_gate: result.passesLiveGate,
      });

    return payload;
  });
