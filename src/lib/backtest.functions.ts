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
  startCapital: z.number().min(10).max(1_000_000).default(200),
});

export type BacktestPayload = {
  cached: boolean;
  equity: Array<{ date: string; strategy: number; btc: number; spx: number }>;
  strategyKpis: { totalReturnPct: number; cagr: number; maxDrawdownPct: number; sharpe: number; trades: number; winRatePct: number; profitFactor: number };
  btcKpis: BacktestPayload["strategyKpis"];
  spxKpis: BacktestPayload["strategyKpis"];
  tradesCount: number;
  universe: string;
  preset: string;
  years: number;
};

// Universe = which crypto assets get traded (BTC always loaded for regime + benchmark)
const CORE_ASSETS = ["ETH", "SOL"];
const SLEEVE_ASSETS = ["ADA", "LINK", "AVAX", "DOT", "XRP", "LTC"];

function hashInput(input: { preset: string; years: number; universe: string; startCapital: number }): string {
  return `v4|${input.preset}|${input.years}y|${input.universe}|${input.startCapital}€`;
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
  // safety cap (15k rows = ~40 anni daily)
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
        return { ...(cached.data.result as Record<string, unknown>), cached: true } as BacktestPayload;
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

    // Fetch per-symbol to bypass PostgREST max-rows cap (a single .in() query
    // sorted by date returns the oldest rows first — SPX dominates and BTC/alts get truncated).
    const bySym: Record<string, Array<{ date: string; close: number }>> = {};
    const ohlcResults = await Promise.all(
      allSyms.map((sym) =>
        supabase
          .from("historical_ohlc")
          .select("date,close")
          .eq("symbol", sym)
          .gte("date", sinceStr)
          .order("date", { ascending: true })
          .range(0, 9999),
      ),
    );
    for (let i = 0; i < allSyms.length; i++) {
      const res = ohlcResults[i];
      if (res.error) throw new Error(res.error.message);
      if (res.data && res.data.length) {
        bySym[allSyms[i]] = res.data.map((r) => ({ date: r.date as string, close: Number(r.close) }));
      }
    }
    if (Object.keys(bySym).length === 0) {
      throw new Error("Storico non ancora popolato. Esegui historical-sync prima.");
    }
    if (!bySym["BTC"] || bySym["BTC"].length < 60) {
      throw new Error("Storico BTC insufficiente (servono almeno 60 candele).");
    }

    const fgRows = await supabase
      .from("fg_history")
      .select("date,value")
      .gte("date", sinceStr)
      .order("date", { ascending: true })
      .range(0, 9999);
    const fg = (fgRows.data ?? []).map((r) => ({ date: r.date as string, value: r.value }));

    const assets: Record<string, Array<{ date: string; close: number }>> = {};
    for (const sym of tradedSyms) {
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
        // v2: il filtro macro per il core è BTC vs SMA200 (vedi STRATEGIA.md v2 §3.1)
        regime_filter: "btc_sma200",
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
