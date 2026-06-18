// Pure backtest engine v3. Deterministic, no I/O — accepts pre-loaded OHLC + F&G arrays
// and returns equity curves + KPIs for: strategy, BTC buy&hold, S&P 500, BTC-DCA,
// BTC trend-core (SMA200), BTC trend + Bear-DCA. Includes a GO-LIVE gate check.

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

export type BearDcaParams = {
  enabled: boolean;
  ddTrigger: number;       // e.g. 0.25 = -25% dal massimo a 90gg
  intervalDays: number;    // ogni quanti giorni una tranche
  tranchePct: number;      // % del capitale per tranche
  maxPct: number;          // tetto totale dell'accumulo come % capitale
  ddWindow: number;        // finestra rolling per il massimo
  smaPeriod: number;       // periodo SMA del filtro di regime (default 200)
};

export type BacktestInput = {
  startCapital: number;
  preset: PresetParams;
  btc: Candle[]; // sorted asc by date
  spx: Candle[];
  fg: FgPoint[];
  assets: Record<string, Candle[]>;
  feePct: number;       // per side, e.g. 0.4 (%)
  slippagePct: number;  // 0.1 (%)
  bearDca: BearDcaParams;
};

export type EquityPoint = {
  date: string;
  strategy: number;
  btc: number;
  spx: number;
  dca: number;
  trendCore: number;
  trendDca: number;
};

export type Kpis = {
  totalReturnPct: number;
  cagr: number;
  maxDrawdownPct: number;
  sharpe: number;
  sortino: number;
  trades: number;
  winRatePct: number;
  profitFactor: number;
};

export type LiveGateChecks = {
  profitFactorOk: boolean;       // PF > 1.3
  sharpeOk: boolean;             // Sharpe > 0.8
  beatsDcaSharpe: boolean;       // sharpe strategy >= sharpe DCA
  beatsDcaDrawdown: boolean;     // |maxDD strategy| <= |maxDD DCA|
};

export type BacktestResult = {
  equity: EquityPoint[];
  strategyKpis: Kpis;
  btcKpis: Kpis;
  spxKpis: Kpis;
  dcaKpis: Kpis;
  trendCoreKpis: Kpis;
  trendDcaKpis: Kpis;
  passesLiveGate: boolean;
  liveGateChecks: LiveGateChecks;
  tradeLog: Array<{ asset: string; entryDate: string; exitDate: string; pnlPct: number }>;
};

function sma(values: number[], period: number, endIdx: number): number | null {
  if (endIdx + 1 < period) return null;
  let s = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) s += values[i];
  return s / period;
}

function rollingMax(values: number[], window: number): number[] {
  const out: number[] = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    let m = -Infinity;
    for (let j = start; j <= i; j++) if (values[j] > m) m = values[j];
    out[i] = m;
  }
  return out;
}

function buildDateIndex<T extends { date: string }>(rows: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) m.set(r.date, r);
  return m;
}

function computeKpis(equity: number[], dates: string[], trades: { pnlPct: number }[]): Kpis {
  if (equity.length < 2) {
    return { totalReturnPct: 0, cagr: 0, maxDrawdownPct: 0, sharpe: 0, sortino: 0, trades: 0, winRatePct: 0, profitFactor: 0 };
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
  const downside = rets.filter((r) => r < 0);
  const dVar = downside.length > 1 ? downside.reduce((s, r) => s + r * r, 0) / downside.length : 0;
  const dStd = Math.sqrt(dVar);
  const sortino = dStd > 0 ? (mean / dStd) * Math.sqrt(365) : 0;

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
    sortino,
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

// ============ BTC benchmark strategies (single-asset) ============

function feeCost(notional: number, feePct: number, slipPct: number): number {
  return notional * ((feePct + slipPct) / 100);
}

function runBuyHold(price: number[], capital: number, feePct: number, slipPct: number): { equity: number[]; trades: { pnlPct: number }[] } {
  const units = (capital - feeCost(capital, feePct, slipPct)) / price[0];
  const equity = price.map((p) => units * p);
  const final = equity[equity.length - 1];
  return { equity, trades: [{ pnlPct: (final / capital - 1) * 100 }] };
}

function runDcaBenchmark(price: number[], capital: number, feePct: number, slipPct: number, interval = 7): { equity: number[]; trades: { pnlPct: number }[] } {
  const n = price.length;
  const nTranches = Math.max(1, Math.floor(n / interval));
  const tranche = capital / nTranches;
  let cash = capital, units = 0, deployed = 0;
  const equity = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    if (i % interval === 0 && deployed < nTranches && cash >= tranche) {
      const spend = Math.min(tranche, cash);
      units += (spend - feeCost(spend, feePct, slipPct)) / price[i];
      cash -= spend;
      deployed++;
    }
    equity[i] = cash + units * price[i];
  }
  const final = equity[n - 1];
  return { equity, trades: [{ pnlPct: (final / capital - 1) * 100 }] };
}

function runTrendBtc(
  price: number[],
  capital: number,
  feePct: number,
  slipPct: number,
  smaPeriod: number,
  bearDca: BearDcaParams | null,
): { equity: number[]; trades: { pnlPct: number }[] } {
  const n = price.length;
  // SMA precompute
  const smaArr = new Array<number | null>(n).fill(null);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += price[i];
    if (i >= smaPeriod) sum -= price[i - smaPeriod];
    if (i >= smaPeriod - 1) smaArr[i] = sum / smaPeriod;
  }
  const rollHigh = bearDca ? rollingMax(price, bearDca.ddWindow) : null;

  let cash = capital, units = 0;
  const equity = new Array<number>(n);
  const trades: { pnlPct: number }[] = [];
  let inTrend = false;
  let costBasis = 0;
  let lastDca = -1e9, dcaDeployed = 0;

  for (let i = 0; i < n; i++) {
    const inUp = smaArr[i] != null && price[i] > (smaArr[i] as number);
    if (inUp) {
      if (!inTrend) {
        const spend = cash;
        if (spend > 0) {
          units += (spend - feeCost(spend, feePct, slipPct)) / price[i];
          costBasis += spend;
          cash = 0;
        }
        inTrend = true;
      }
    } else {
      if (inTrend) {
        const proceeds = units * price[i] - feeCost(units * price[i], feePct, slipPct);
        trades.push({ pnlPct: costBasis > 0 ? ((proceeds - costBasis) / costBasis) * 100 : 0 });
        cash = proceeds;
        units = 0;
        inTrend = false;
        costBasis = 0;
        lastDca = -1e9;
        dcaDeployed = 0;
      } else if (bearDca && bearDca.enabled && rollHigh) {
        const dd = price[i] / rollHigh[i] - 1;
        const budgetLeft = (bearDca.maxPct / 100) * capital - dcaDeployed;
        if (dd <= -bearDca.ddTrigger && budgetLeft > 0 && (i - lastDca) >= bearDca.intervalDays) {
          const spend = Math.min((bearDca.tranchePct / 100) * capital, cash, budgetLeft);
          if (spend > 0) {
            units += (spend - feeCost(spend, feePct, slipPct)) / price[i];
            cash -= spend;
            costBasis += spend;
            dcaDeployed += spend;
            lastDca = i;
          }
        }
      }
    }
    equity[i] = cash + units * price[i];
  }
  if (units > 0) {
    const proceeds = units * price[n - 1] - feeCost(units * price[n - 1], feePct, slipPct);
    trades.push({ pnlPct: costBasis > 0 ? ((proceeds - costBasis) / costBasis) * 100 : 0 });
  }
  return { equity, trades };
}

// ============ Main engine ============

export function runBacktest(input: BacktestInput): BacktestResult {
  const { startCapital, preset, btc, spx, fg, assets, feePct, slippagePct, bearDca } = input;

  const dates = btc.map((c) => c.date);
  const btcCloses = btc.map((c) => c.close);
  const spxIdx = buildDateIndex(spx);
  const fgIdx = buildDateIndex(fg);
  const assetIdx: Record<string, Map<string, Candle>> = {};
  for (const sym of Object.keys(assets)) assetIdx[sym] = buildDateIndex(assets[sym]);

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

  const btcStart = btcCloses[0];
  const spxFirst = spx.length ? spx[0].close : null;

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];

    let mtmValue = 0;
    for (let j = open.length - 1; j >= 0; j--) {
      const p = open[j];
      const candle = assetIdx[p.asset]?.get(date);
      if (!candle) {
        mtmValue += p.qty * p.entryPrice;
        continue;
      }
      const price = candle.close;
      const trailActivate = p.entryPrice * (1 + preset.trailing_activate_pct / 100);
      if (price >= trailActivate) {
        p.trailingHigh = Math.max(p.trailingHigh ?? price, price);
        const trailStop = p.trailingHigh * (1 - preset.trailing_gap_pct / 100);
        if (trailStop > p.stop) p.stop = trailStop;
      }
      let exit = false;
      let exitPrice = price;
      if (price <= p.stop) { exit = true; exitPrice = p.stop; }
      else if (price >= p.entryPrice * (1 + preset.take_profit_pct / 100)) {
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

    const sma50Btc = sma(btcCloses, 50, i);
    const sma200Btc = sma(btcCloses, 200, i);
    const btcLast = btcCloses[i];
    const fgVal = fgIdx.get(date)?.value ?? null;
    let regimeOk = true;
    if (preset.regime_filter === "btc_sma50") regimeOk = sma50Btc != null && btcLast > sma50Btc;
    else if (preset.regime_filter === "btc_sma200") regimeOk = sma200Btc != null && btcLast > sma200Btc;
    else if (preset.regime_filter === "fg_only") regimeOk = true;
    if (preset.regime_filter !== "off" && fgVal != null && fgVal > preset.fg_greed_cap) regimeOk = false;

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
        open.push({ asset: sym, qty, entryPrice, entryValue: sizeUsd, entryDate: date, stop, trailingHigh: null });
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

  // BTC benchmark strategies
  const bh = runBuyHold(btcCloses, startCapital, feePct, slippagePct);
  const dca = runDcaBenchmark(btcCloses, startCapital, feePct, slippagePct, 7);
  const tc = runTrendBtc(btcCloses, startCapital, feePct, slippagePct, bearDca.smaPeriod, null);
  const td = runTrendBtc(btcCloses, startCapital, feePct, slippagePct, bearDca.smaPeriod, bearDca);

  const equity: EquityPoint[] = equityDates.map((d, i) => ({
    date: d,
    strategy: equityStrategy[i],
    btc: bh.equity[i],
    spx: equitySpx[i],
    dca: dca.equity[i],
    trendCore: tc.equity[i],
    trendDca: td.equity[i],
  }));

  const strategyKpis = computeKpis(equityStrategy, equityDates, tradeLog);
  const btcKpis = computeKpis(bh.equity, equityDates, bh.trades);
  const spxKpis = computeKpis(equitySpx, equityDates, [{ pnlPct: (equitySpx[equitySpx.length - 1] / startCapital - 1) * 100 }]);
  const dcaKpis = computeKpis(dca.equity, equityDates, dca.trades);
  const trendCoreKpis = computeKpis(tc.equity, equityDates, tc.trades);
  const trendDcaKpis = computeKpis(td.equity, equityDates, td.trades);

  const liveGateChecks: LiveGateChecks = {
    profitFactorOk: strategyKpis.profitFactor > 1.3,
    sharpeOk: strategyKpis.sharpe > 0.8,
    beatsDcaSharpe: strategyKpis.sharpe >= dcaKpis.sharpe,
    beatsDcaDrawdown: Math.abs(strategyKpis.maxDrawdownPct) <= Math.abs(dcaKpis.maxDrawdownPct),
  };
  const passesLiveGate = Object.values(liveGateChecks).every(Boolean);

  return {
    equity,
    strategyKpis,
    btcKpis,
    spxKpis,
    dcaKpis,
    trendCoreKpis,
    trendDcaKpis,
    passesLiveGate,
    liveGateChecks,
    tradeLog,
  };
}
