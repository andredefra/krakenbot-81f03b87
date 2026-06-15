// Pure backtest engine — BTC-core + momentum rotation.
//
// Strategy:
//  - Regime: BTC > SMA200 → risk-on (invested); BTC < SMA200 → cash.
//  - In risk-on: pick top-N assets by 30d momentum (BTC always anchored, occupies 1 slot).
//  - Equal-weight across selected assets; rebalance every `rebalance_days` (default 7)
//    OR immediately when composition changes (asset enters/exits top-N).
//  - Per-asset stop loss: if price falls `stop_loss_pct` from entry, close that position
//    (cash sits until next rebalance).
//  - Daily kill-switch: if portfolio drops > `daily_loss_limit_pct` in one day, flatten to cash
//    until the next day.
//  - Costs: fee + slippage on every buy and every sell.
//
// Benchmarks computed in parallel:
//  - BTC buy & hold (no costs after entry)
//  - S&P 500 buy & hold
//  - BTC + SMA200 trivial baseline (same fees as strategy): hold BTC when BTC>SMA200, else cash.

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
  rebalance_days?: number;
};

export type BacktestInput = {
  startCapital: number;
  preset: PresetParams;
  btc: Candle[];
  spx: Candle[];
  fg: FgPoint[];
  assets: Record<string, Candle[]>; // MUST include BTC plus tradeable alts
  feePct: number;
  slippagePct: number;
};

export type EquityPoint = {
  date: string;
  strategy: number;
  btc: number;
  spx: number;
  btcRegime: number;
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
  btcRegimeKpis: Kpis;
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
};

export function runBacktest(input: BacktestInput): BacktestResult {
  const { startCapital, preset, btc, spx, fg, assets, feePct, slippagePct } = input;
  const rebalanceDays = Math.max(1, preset.rebalance_days ?? 7);
  void fg; // F&G not used in rotation strategy (regime is pure price-based)

  // Aligned timeline = BTC's dates
  const dates = btc.map((c) => c.date);
  const btcCloses = btc.map((c) => c.close);
  const spxIdx = buildDateIndex(spx);

  // Ensure BTC is in assets dict (anchor)
  const tradeable: Record<string, Map<string, Candle>> = {};
  for (const sym of Object.keys(assets)) tradeable[sym] = buildDateIndex(assets[sym]);
  if (!tradeable["BTC"]) tradeable["BTC"] = buildDateIndex(btc);

  // Per-asset closes array + date index, for momentum
  const assetCloses: Record<string, number[]> = {};
  const assetDates: Record<string, string[]> = {};
  const assetDateIdx: Record<string, Map<string, number>> = {};
  const allSymsForMomentum = Object.keys(tradeable);
  for (const sym of allSymsForMomentum) {
    const arr = assets[sym] ?? btc;
    assetCloses[sym] = arr.map((c) => c.close);
    assetDates[sym] = arr.map((c) => c.date);
    const m = new Map<string, number>();
    arr.forEach((c, i) => m.set(c.date, i));
    assetDateIdx[sym] = m;
  }

  // Helper: 30-day momentum (% return) for `sym` ending on `date`. Null if no history.
  const momentum = (sym: string, date: string): number | null => {
    const idx = assetDateIdx[sym]?.get(date);
    if (idx == null || idx < 30) return null;
    const past = assetCloses[sym][idx - 30];
    const now = assetCloses[sym][idx];
    if (!past || !now) return null;
    return (now / past - 1) * 100;
  };

  // Strategy state
  let cash = startCapital;
  const open: OpenPos[] = [];
  const tradeLog: Array<{ asset: string; entryDate: string; exitDate: string; pnlPct: number }> = [];
  let daysSinceRebalance = 999;
  let lastComposition = "";
  let prevDayEquity = startCapital;
  let killSwitchUntil = -1; // index of day to resume

  // BTC+SMA200 baseline state
  let baseCash = startCapital;
  let baseQty = 0; // BTC qty held
  let baseInBtc = false;

  // BTC buy & hold (no costs after initial entry)
  const btcStart = btcCloses[0];

  // SPX buy & hold
  const spxFirstClose = spx.length ? spx[0].close : null;
  let spxLastSeen = spxFirstClose ?? 1;

  // Output arrays
  const equityStrategy: number[] = [];
  const equityBtc: number[] = [];
  const equitySpx: number[] = [];
  const equityRegime: number[] = [];
  const equityDates: string[] = [];

  const buyAsset = (sym: string, sizeUsd: number, date: string, price: number) => {
    const entryPrice = price * (1 + slippagePct / 100);
    const fee = sizeUsd * (feePct / 100);
    const qty = (sizeUsd - fee) / entryPrice;
    if (qty <= 0) return false;
    cash -= sizeUsd;
    open.push({ asset: sym, qty, entryPrice, entryValue: sizeUsd, entryDate: date });
    return true;
  };

  const sellPosition = (p: OpenPos, date: string, price: number) => {
    const grossExit = p.qty * price * (1 - slippagePct / 100);
    const fee = grossExit * (feePct / 100);
    const netExit = grossExit - fee;
    cash += netExit;
    const pnlPct = ((netExit - p.entryValue) / p.entryValue) * 100;
    tradeLog.push({ asset: p.asset, entryDate: p.entryDate, exitDate: date, pnlPct });
  };

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const btcPrice = btcCloses[i];
    const btcSma200 = sma(btcCloses, 200, i);
    const regimeOn = btcSma200 != null && btcPrice > btcSma200;

    // --- 1. Mark-to-market current positions value
    const priceOf = (sym: string) => tradeable[sym]?.get(date)?.close ?? null;

    // --- 2. Per-asset stop loss check (close stopped positions to cash)
    for (let j = open.length - 1; j >= 0; j--) {
      const p = open[j];
      const px = priceOf(p.asset);
      if (px == null) continue;
      if (px <= p.entryPrice * (1 - preset.stop_loss_pct / 100)) {
        sellPosition(p, date, p.entryPrice * (1 - preset.stop_loss_pct / 100));
        open.splice(j, 1);
      }
    }

    // --- 3. Regime / kill-switch: if either is off, flatten everything to cash
    const killActive = i < killSwitchUntil;
    if (!regimeOn || killActive) {
      for (let j = open.length - 1; j >= 0; j--) {
        const p = open[j];
        const px = priceOf(p.asset);
        if (px == null) continue;
        sellPosition(p, date, px);
        open.splice(j, 1);
      }
      lastComposition = "";
      daysSinceRebalance = 999; // force rebalance on regime return
    } else {
      // --- 4. Pick top-N (BTC always in)
      const N = Math.max(1, preset.max_positions);
      const scored: Array<{ sym: string; mom: number }> = [];
      for (const sym of allSymsForMomentum) {
        if (sym === "BTC") continue;
        const m = momentum(sym, date);
        if (m == null) continue;
        // require positive momentum to enter alts (BTC anchor takes the slot otherwise)
        if (m <= 0) continue;
        scored.push({ sym, mom: m });
      }
      scored.sort((a, b) => b.mom - a.mom);
      const target = new Set<string>(["BTC"]);
      for (const s of scored) {
        if (target.size >= N) break;
        target.add(s.sym);
      }
      const composition = [...target].sort().join(",");

      const needsRebalance = composition !== lastComposition || daysSinceRebalance >= rebalanceDays;
      if (needsRebalance && composition.length > 0) {
        // Sell positions not in target
        for (let j = open.length - 1; j >= 0; j--) {
          const p = open[j];
          if (target.has(p.asset)) continue;
          const px = priceOf(p.asset);
          if (px == null) continue;
          sellPosition(p, date, px);
          open.splice(j, 1);
        }
        // For symmetric weights, also close existing positions in target then re-buy
        // (simpler and ensures equal-weight after drift). Costs are realistic.
        for (let j = open.length - 1; j >= 0; j--) {
          const p = open[j];
          const px = priceOf(p.asset);
          if (px == null) continue;
          sellPosition(p, date, px);
          open.splice(j, 1);
        }
        // Buy each target asset equally
        const slotValue = cash / target.size;
        for (const sym of target) {
          const px = priceOf(sym);
          if (px == null) continue;
          if (slotValue < 5) continue;
          buyAsset(sym, slotValue, date, px);
        }
        lastComposition = composition;
        daysSinceRebalance = 0;
      }
    }
    daysSinceRebalance++;

    // --- 5. Mark equity after all actions
    let mtm = 0;
    for (const p of open) {
      const px = priceOf(p.asset);
      mtm += p.qty * (px ?? p.entryPrice);
    }
    const equity = cash + mtm;
    equityStrategy.push(equity);

    // Daily kill-switch trigger (acts NEXT day)
    if (prevDayEquity > 0) {
      const dayChange = (equity / prevDayEquity - 1) * 100;
      if (dayChange <= -preset.daily_loss_limit_pct) {
        killSwitchUntil = i + 1; // flatten on next day
      }
    }
    prevDayEquity = equity;

    // --- BTC buy & hold
    equityBtc.push((btcPrice / btcStart) * startCapital);

    // --- SPX buy & hold (carry forward last seen)
    const spxToday = spxIdx.get(date)?.close;
    if (spxToday != null) spxLastSeen = spxToday;
    equitySpx.push(spxFirstClose ? (spxLastSeen / spxFirstClose) * startCapital : startCapital);

    // --- BTC + SMA200 baseline
    if (regimeOn && !baseInBtc) {
      const entryPrice = btcPrice * (1 + slippagePct / 100);
      const fee = baseCash * (feePct / 100);
      baseQty = (baseCash - fee) / entryPrice;
      baseCash = 0;
      baseInBtc = true;
    } else if (!regimeOn && baseInBtc) {
      const gross = baseQty * btcPrice * (1 - slippagePct / 100);
      const fee = gross * (feePct / 100);
      baseCash = gross - fee;
      baseQty = 0;
      baseInBtc = false;
    }
    const baseEquity = baseInBtc ? baseQty * btcPrice : baseCash;
    equityRegime.push(baseEquity);

    equityDates.push(date);
  }

  const equity: EquityPoint[] = equityDates.map((d, i) => ({
    date: d,
    strategy: equityStrategy[i],
    btc: equityBtc[i],
    spx: equitySpx[i],
    btcRegime: equityRegime[i],
  }));

  const btcTrades = [{ pnlPct: (equityBtc[equityBtc.length - 1] / startCapital - 1) * 100 }];
  const spxTrades = [{ pnlPct: (equitySpx[equitySpx.length - 1] / startCapital - 1) * 100 }];
  const regimeTrades = [{ pnlPct: (equityRegime[equityRegime.length - 1] / startCapital - 1) * 100 }];

  return {
    equity,
    strategyKpis: computeKpis(equityStrategy, equityDates, tradeLog),
    btcKpis: computeKpis(equityBtc, equityDates, btcTrades),
    spxKpis: computeKpis(equitySpx, equityDates, spxTrades),
    btcRegimeKpis: computeKpis(equityRegime, equityDates, regimeTrades),
    tradeLog,
  };
}
