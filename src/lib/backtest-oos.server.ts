// Validazione out-of-sample per le proposte AI.
// Usa l'engine di backtest esistente sulla finestra ultimi 12 mesi escludendo
// i 30 giorni più recenti (holdout). Confronta strategy vs BTC Buy & Hold
// e BTC DCA settimanale.
import { runBacktest, type Kpis } from "./backtest.server";

// Universo OOS v4: include SPX come proxy storico per token azionari/xStocks
// Kraken quando lo storico specifico non è ancora popolato.
const FULL_UNIVERSE = ["ETH", "SOL", "ADA", "LINK", "AVAX", "DOT", "XRP", "LTC", "SPX"];
const CORE_ASSETS = ["BTC", "ETH"];
const PAGE_SIZE = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchOhlc(supabase: any, symbol: string, from: string, to: string) {
  const out: Array<{ date: string; close: number }> = [];
  let off = 0;
  while (off < 15000) {
    const r = await supabase.from("historical_ohlc").select("date,close").eq("symbol", symbol).gte("date", from).lte("date", to).order("date", { ascending: true }).range(off, off + PAGE_SIZE - 1);
    if (r.error) throw new Error(r.error.message);
    const rows = r.data ?? [];
    for (const row of rows) out.push({ date: row.date as string, close: Number(row.close) });
    if (rows.length < PAGE_SIZE) break;
    off += PAGE_SIZE;
  }
  return out;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchFg(supabase: any, from: string, to: string) {
  const out: Array<{ date: string; value: number }> = [];
  let off = 0;
  while (off < 15000) {
    const r = await supabase.from("fg_history").select("date,value").gte("date", from).lte("date", to).order("date", { ascending: true }).range(off, off + PAGE_SIZE - 1);
    if (r.error) throw new Error(r.error.message);
    const rows = r.data ?? [];
    for (const row of rows) out.push({ date: row.date as string, value: Number(row.value) });
    if (rows.length < PAGE_SIZE) break;
    off += PAGE_SIZE;
  }
  return out;
}

function dcaBenchmark(btc: Array<{ date: string; close: number }>, totalCapital: number, weeklyTranche: number, feePct: number, slipPct: number): { equity: number[]; dates: string[]; kpis: Kpis } {
  const equity: number[] = [];
  const dates: string[] = [];
  let cash = totalCapital;
  let units = 0;
  let nextBuy = 0;
  for (let i = 0; i < btc.length; i++) {
    if (i >= nextBuy && cash > 0) {
      const spend = Math.min(weeklyTranche, cash);
      const price = btc[i].close * (1 + slipPct / 100);
      const fee = spend * (feePct / 100);
      units += (spend - fee) / price;
      cash -= spend;
      nextBuy = i + 7;
    }
    equity.push(cash + units * btc[i].close);
    dates.push(btc[i].date);
  }
  // KPIs
  const rets: number[] = [];
  for (let i = 1; i < equity.length; i++) rets.push(equity[i] / equity[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length || 1);
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(365) : 0;
  const downside = rets.filter((r) => r < 0);
  const dVar = downside.length > 1 ? downside.reduce((s, r) => s + r * r, 0) / downside.length : 0;
  const dStd = Math.sqrt(dVar);
  const sortino = dStd > 0 ? (mean / dStd) * Math.sqrt(365) : 0;
  let peak = equity[0];
  let maxDD = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }
  const totalRet = equity[equity.length - 1] / totalCapital - 1;
  const years = dates.length > 1 ? (new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / (365.25 * 86400_000) : 1;
  const cagr = years > 0 ? Math.pow(1 + totalRet, 1 / years) - 1 : 0;
  return {
    equity, dates,
    kpis: { totalReturnPct: totalRet * 100, cagr: cagr * 100, maxDrawdownPct: maxDD * 100, sharpe, sortino, trades: 0, winRatePct: 0, profitFactor: 0 },
  };
}

export async function runOosValidation(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
  simulatedSettings: Record<string, unknown>;
}) {
  const s = args.simulatedSettings;
  const startCapital = Number(s.capital_reference ?? 1000) || 1000;
  const feePct = Number(s.taker_fee_pct ?? 0.4);
  const slippagePct = Number(s.slippage_pct ?? 0.05);

  // Finestra: ultimi 12 mesi escludendo ultimi 30g
  const today = new Date();
  const to = new Date(today.getTime() - 30 * 86400_000);
  const from = new Date(to.getTime() - 365 * 86400_000);
  const toStr = to.toISOString().slice(0, 10);
  const fromStr = from.toISOString().slice(0, 10);

  const allSyms = [...new Set(["BTC", "SPX", ...FULL_UNIVERSE])];
  const ohlcByS: Record<string, Array<{ date: string; close: number }>> = {};
  const fetched = await Promise.all(allSyms.map((sym) => fetchOhlc(args.supabase, sym, fromStr, toStr)));
  for (let i = 0; i < allSyms.length; i++) if (fetched[i].length) ohlcByS[allSyms[i]] = fetched[i];
  if (!ohlcByS["BTC"] || ohlcByS["BTC"].length < 60) throw new Error("Storico BTC insufficiente per OOS");
  const fg = await fetchFg(args.supabase, fromStr, toStr);

  const assets: Record<string, Array<{ date: string; close: number }>> = {};
  for (const sym of [...new Set([...CORE_ASSETS, ...FULL_UNIVERSE])]) {
    if (ohlcByS[sym] && ohlcByS[sym].length > 50) assets[sym] = ohlcByS[sym];
  }

  const corePct = Number((s.core_satellite_split as { core?: number } | null)?.core ?? 0.7);

  const result = runBacktest({
    startCapital,
    preset: {
      max_positions: Number(s.max_satellite_positions ?? 2),
      max_position_pct: Number(s.max_position_pct ?? 25),
      stop_loss_pct: Number(s.stop_min_pct ?? 12),
      trailing_activate_pct: Number(s.trailing_activate_pct ?? 12),
      trailing_gap_pct: Number(s.trailing_gap_pct ?? 8),
      take_profit_pct: Number(s.take_profit_pct ?? 25),
      daily_loss_limit_pct: Number(s.daily_loss_limit_pct ?? 8),
      fg_greed_cap: Number(s.fg_greed_cap ?? 75),
      regime_filter: "btc_sma200",
      core_pct: corePct,
      core_assets: CORE_ASSETS,
      monthly_trade_cap: Number(s.monthly_trade_cap ?? 6),
      cooldown_hours: Number(s.cooldown_hours ?? 48),
      min_target_pct: Number(s.min_target_pct ?? 5),
    },
    btc: ohlcByS["BTC"],
    spx: ohlcByS["SPX"] ?? [],
    fg,
    assets,
    feePct,
    slippagePct,
    bearDca: {
      enabled: Boolean(s.bear_dca_enabled ?? true),
      fgThreshold: Number(s.bear_dca_fg_threshold ?? 22),
      intervalDays: Number(s.bear_dca_interval_days ?? 14),
      tranchePct: Number(s.bear_dca_tranche_pct ?? 5),
      maxPct: Number(s.bear_dca_cap_pct ?? 30),
      smaPeriod: 200,
    },
  });


  // DCA settimanale: totale = startCapital, tranche = capital / numero settimane
  const weeks = Math.max(1, Math.floor(ohlcByS["BTC"].length / 7));
  const dca = dcaBenchmark(ohlcByS["BTC"], startCapital, startCapital / weeks, feePct, slippagePct);

  return {
    window: { from: fromStr, to: toStr },
    strategy: result.strategyKpis,
    btcBuyHold: result.btcKpis,
    btcDca: dca.kpis,
  };
}
