// Pure backtest engine. Deterministic, no I/O — accepts pre-loaded OHLC + F&G arrays
// and returns equity curves + KPIs for strategy / BTC buy&hold / S&P 500 buy&hold.

export type Candle = { date: string; close: number };
export type FgPoint = { date: string; value: number };

export type PresetParams = {
  max_positions: number;
  max_position_pct: number;
  stop_loss_pct: number;
  trailing_activate_pct: number;
  trailing_gap_pct: number;
  take_profit_pct: number;
  daily_loss_limit_pct: number;
  fg_greed_cap: number;
  regime_filter: "btc_sma50" | "btc_sma200" | "fg_only" | "off";
};

export type BacktestInput = {
  startCapital: number;
  preset: PresetParams;
  btc: Candle[]; // sorted asc by date
  spx: Candle[];
  fg: FgPoint[];
  assets: Record<string, Candle[]>; // symbol -> candles (incl. BTC if traded)
  feePct: number; // per side, e.g. 0.4
  slippagePct: number; // 0.1
};

export type EquityPoint = {
  date: string;
  strategy: number;
  btc: number;
  spx: number;
};

export type Kpis = {
  totalReturnPct: number;
  cagr: number;
  maxDrawdownPct: number;
  sharpe: number;
  trades: number;
  winRatePct: number;
  profitFactor: number;
};

export type BacktestResult = {
  equity: EquityPoint[];
  strategyKpis: Kpis;
  btcKpis: Kpis;
  spxKpis: Kpis;
  tradeLog: Array<{ asset: string; entryDate: string; exitDate: string; pnlPct: number }>;
};

function sma(values: number[], period: number, endIdx: number): number | null {
  if (endIdx + 1 < period) return null;
  let s = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) s += values[i];
  return s / period;
}

function buildDateIndex<T extends { date: string }>(rows: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) m.set(r.date, r);
  return m;
}

function computeKpis(equity: number[], dates: string[], trades: { pnlPct: number }[]): Kpis {
  if (equity.length < 2) {
    return { totalReturnPct: 0, cagr: 0, maxDrawdownPct: 0, sharpe: 0, trades: 0, winRatePct: 0, profitFactor: 0 };
  }
  const totalReturn = equity[equity.length - 1] / equity[0] - 1;
  const years = (new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / (365.25 * 86400_000);
  const cagr = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;

  let peak = equity[0];
  let maxDD = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }

  const rets: number[] = [];
  for (let i = 1; i < equity.length; i++) rets.push(equity[i] / equity[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length || 1);
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(365) : 0;

  const wins = trades.filter((t) => t.pnlPct > 0);
  const losses = trades.filter((t) => t.pnlPct <= 0);
  const gross = wins.reduce((s, t) => s + t.pnlPct, 0);
  const losssum = -losses.reduce((s, t) => s + t.pnlPct, 0);
  const profitFactor = losssum > 0 ? gross / losssum : wins.length > 0 ? 99 : 0;

  return {
    totalReturnPct: totalReturn * 100,
    cagr: cagr * 100,
    maxDrawdownPct: maxDD * 100,
    sharpe,
    trades: trades.length,
    winRatePct: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor,
  };
}

type OpenPos = {
  asset: string;
  qty: number;
  entryPrice: number;
  entryValue: number;
  entryDate: string;
  stop: number;
  trailingHigh: number | null;
};

export function runBacktest(input: BacktestInput): BacktestResult {
  const { startCapital, preset, btc, spx, fg, assets, feePct, slippagePct } = input;

  // Aligned date axis = BTC's dates (master timeline)
  const dates = btc.map((c) => c.date);
  const btcCloses = btc.map((c) => c.close);
  const spxIdx = buildDateIndex(spx);
  const fgIdx = buildDateIndex(fg);
  const assetIdx: Record<string, Map<string, Candle>> = {};
  for (const sym of Object.keys(assets)) assetIdx[sym] = buildDateIndex(assets[sym]);

  // Pre-compute SMA arrays for each asset
  const assetCloses: Record<string, number[]> = {};
  const assetDates: Record<string, string[]> = {};
  for (const sym of Object.keys(assets)) {
    assetCloses[sym] = assets[sym].map((c) => c.close);
    assetDates[sym] = assets[sym].map((c) => c.date);
  }

  let cash = startCapital;
  const open: OpenPos[] = [];
  const tradeLog: Array<{ asset: string; entryDate: string; exitDate: string; pnlPct: number }> = [];

  const equityStrategy: number[] = [];
  const equityBtc: number[] = [];
  const equitySpx: number[] = [];
  const equityDates: string[] = [];

  // BTC and SPX buy & hold baselines normalized to startCapital
  const btcStart = btcCloses[0];
  const spxFirst = spx.length ? spx[0].close : null;

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];

    // 1) Update open positions w/ today's close, check exits
    let mtmValue = 0;
    for (let j = open.length - 1; j >= 0; j--) {
      const p = open[j];
      const candle = assetIdx[p.asset]?.get(date);
      if (!candle) {
        mtmValue += p.qty * p.entryPrice;
        continue;
      }
      const price = candle.close;
      // trailing
      const trailActivate = p.entryPrice * (1 + preset.trailing_activate_pct / 100);
      if (price >= trailActivate) {
        p.trailingHigh = Math.max(p.trailingHigh ?? price, price);
        const trailStop = p.trailingHigh * (1 - preset.trailing_gap_pct / 100);
        if (trailStop > p.stop) p.stop = trailStop;
      }
      let exit = false;
      let exitPrice = price;
      if (price <= p.stop) {
        exit = true;
        exitPrice = p.stop;
      } else if (price >= p.entryPrice * (1 + preset.take_profit_pct / 100)) {
        exit = true;
        exitPrice = p.entryPrice * (1 + preset.take_profit_pct / 100);
      }
      if (exit) {
        const grossExit = p.qty * exitPrice * (1 - slippagePct / 100);
        const fee = grossExit * (feePct / 100);
        const netExit = grossExit - fee;
        cash += netExit;
        const pnlPct = (netExit - p.entryValue) / p.entryValue * 100;
        tradeLog.push({ asset: p.asset, entryDate: p.entryDate, exitDate: date, pnlPct });
        open.splice(j, 1);
      } else {
        mtmValue += p.qty * price;
      }
    }

    // 2) Regime check
    const sma50Btc = sma(btcCloses, 50, i);
    const sma200Btc = sma(btcCloses, 200, i);
    const btcLast = btcCloses[i];
    const fgVal = fgIdx.get(date)?.value ?? null;
    let regimeOk = true;
    if (preset.regime_filter === "btc_sma50") regimeOk = sma50Btc != null && btcLast > sma50Btc;
    else if (preset.regime_filter === "btc_sma200") regimeOk = sma200Btc != null && btcLast > sma200Btc;
    else if (preset.regime_filter === "fg_only") regimeOk = true;
    // F&G greed cap (always applied unless 'off')
    if (preset.regime_filter !== "off" && fgVal != null && fgVal > preset.fg_greed_cap) regimeOk = false;

    // 3) Entries
    if (regimeOk && open.length < preset.max_positions) {
      for (const sym of Object.keys(assets)) {
        if (sym === "BTC") continue;
        if (open.length >= preset.max_positions) break;
        if (open.some((p) => p.asset === sym)) continue;
        const idxArr = assetDates[sym];
        const closesArr = assetCloses[sym];
        const localIdx = idxArr.indexOf(date);
        if (localIdx < 50) continue;
        const s20 = sma(closesArr, 20, localIdx);
        const s50 = sma(closesArr, 50, localIdx);
        if (!s20 || !s50 || !(s20 > s50)) continue;
        const candle = assetIdx[sym]?.get(date);
        if (!candle) continue;
        const portfolioTotal = cash + mtmValue;
        const sizeUsd = (preset.max_position_pct / 100) * portfolioTotal;
        if (sizeUsd > cash * 0.99) continue;
        if (sizeUsd < 5) continue;
        const entryPrice = candle.close * (1 + slippagePct / 100);
        const fee = sizeUsd * (feePct / 100);
        const qty = (sizeUsd - fee) / entryPrice;
        const stop = entryPrice * (1 - preset.stop_loss_pct / 100);
        cash -= sizeUsd;
        mtmValue += qty * candle.close;
        open.push({
          asset: sym,
          qty,
          entryPrice,
          entryValue: sizeUsd,
          entryDate: date,
          stop,
          trailingHigh: null,
        });
      }
    }

    const equity = cash + mtmValue;
    equityStrategy.push(equity);
    equityBtc.push((btcLast / btcStart) * startCapital);
    const spxToday = spxIdx.get(date)?.close;
    const spxLast = spxToday ?? (equitySpx.length ? (equitySpx[equitySpx.length - 1] / startCapital) * (spxFirst ?? 1) : (spxFirst ?? btcLast));
    equitySpx.push(spxFirst ? (spxLast / spxFirst) * startCapital : startCapital);
    equityDates.push(date);
  }

  const equity: EquityPoint[] = equityDates.map((d, i) => ({
    date: d,
    strategy: equityStrategy[i],
    btc: equityBtc[i],
    spx: equitySpx[i],
  }));

  // Trades for BTC & SPX buy & hold = 1 each
  const btcTrades = [{ pnlPct: (equityBtc[equityBtc.length - 1] / startCapital - 1) * 100 }];
  const spxTrades = [{ pnlPct: (equitySpx[equitySpx.length - 1] / startCapital - 1) * 100 }];

  return {
    equity,
    strategyKpis: computeKpis(equityStrategy, equityDates, tradeLog),
    btcKpis: computeKpis(equityBtc, equityDates, btcTrades),
    spxKpis: computeKpis(equitySpx, equityDates, spxTrades),
    tradeLog,
  };
}
