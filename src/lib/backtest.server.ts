// Pure backtest engine v4. Deterministic, no I/O — accepts pre-loaded OHLC + F&G arrays
// and returns equity curves + KPIs for: strategy, BTC buy&hold, S&P 500.
// v4: include Bear-DCA, monthly_trade_cap, cooldown_hours e min_target_pct
// in linea con il trading-engine live. GO LIVE gate vs BTC Buy & Hold.


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
  core_pct: number;            // 0..1, quota allocata al core buy & hold
  core_assets: string[];       // simboli del core sleeve (es. BTC, ETH)
  // v4 — disciplina trade satellite (mirror del trading-engine live)
  monthly_trade_cap: number;   // max entries satellite per mese solare
  cooldown_hours: number;      // ore dopo l'exit prima di poter riaprire lo stesso asset
  min_target_pct: number;      // target minimo per coprire fee Kraken (entry guard)
};

export type BearDcaParams = {
  enabled: boolean;
  fgThreshold: number;         // F&G sotto cui si apre la tranche (deep fear)
  intervalDays: number;        // distanza minima tra due tranche
  tranchePct: number;          // % capitale totale per tranche
  maxPct: number;              // tetto allocazione DCA in % del core
  smaPeriod: number;           // SMA per definire il regime macro risk-off (default 200)
};


export type BacktestInput = {
  startCapital: number;
  preset: PresetParams;
  btc: Candle[];
  spx: Candle[];
  fg: FgPoint[];
  assets: Record<string, Candle[]>;
  feePct: number;
  slippagePct: number;
  bearDca: BearDcaParams;
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
  sortino: number;
  trades: number;
  winRatePct: number;
  profitFactor: number;
};

export type LiveGateChecks = {
  profitFactorOk: boolean;       // PF > 1.3
  sharpeOk: boolean;             // Sharpe > 0.8
  beatsBtcSharpe: boolean;       // sharpe strategy >= sharpe BTC B&H
  beatsBtcDrawdown: boolean;     // |maxDD strategy| <= |maxDD BTC B&H|
};

export type BacktestResult = {
  equity: EquityPoint[];
  strategyKpis: Kpis;
  btcKpis: Kpis;
  spxKpis: Kpis;
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

function feeCost(notional: number, feePct: number, slipPct: number): number {
  return notional * ((feePct + slipPct) / 100);
}

function runBuyHold(price: number[], capital: number, feePct: number, slipPct: number): { equity: number[]; trades: { pnlPct: number }[] } {
  const units = (capital - feeCost(capital, feePct, slipPct)) / price[0];
  const equity = price.map((p) => units * p);
  const final = equity[equity.length - 1];
  return { equity, trades: [{ pnlPct: (final / capital - 1) * 100 }] };
}

export function runBacktest(input: BacktestInput): BacktestResult {
  const { startCapital, preset, btc, spx, fg, assets, feePct, slippagePct } = input;

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

  // ============ CORE SLEEVE (regime-gated buy & hold equipesato) ============
  // v8: il core non è più sempre investito. Quando il filtro macro è risk-off
  // ruota in stable (cash) e rientra al ritorno risk-on. Questo è il motore di
  // outperformance risk-adjusted: salta i grandi bear invece di subirli.
  const corePct = Math.max(0, Math.min(1, preset.core_pct ?? 0));
  const coreBudgetInitial = startCapital * corePct;
  const satBudget = startCapital - coreBudgetInitial;
  const availableCore = preset.core_assets.filter((s) => assets[s] && assets[s].length > 0);

  // Stato core: o "invested" (units per asset) oppure "cash" (USD parcheggiati).
  let coreInvested = false;
  let coreUnits: Record<string, number> = {};
  let coreCash = coreBudgetInitial; // cash che resta nel core sleeve quando risk-off

  function enterCore(date: string) {
    if (coreInvested || availableCore.length === 0 || coreCash <= 0) return;
    const slice = coreCash / availableCore.length;
    for (const sym of availableCore) {
      const c = assetIdx[sym]?.get(date);
      if (!c) { coreUnits[sym] = 0; continue; }
      const entry = c.close * (1 + slippagePct / 100);
      const fee = slice * (feePct / 100);
      coreUnits[sym] = (slice - fee) / entry;
    }
    coreCash = 0;
    coreInvested = true;
  }

  function exitCore(date: string) {
    if (!coreInvested) return;
    let cashOut = 0;
    for (const sym of availableCore) {
      const c = assetIdx[sym]?.get(date);
      const price = c ? c.close : 0;
      const gross = (coreUnits[sym] ?? 0) * price * (1 - slippagePct / 100);
      cashOut += gross * (1 - feePct / 100);
    }
    coreCash += cashOut;
    coreUnits = {};
    coreInvested = false;
  }

  let cash = satBudget;
  const open: OpenPos[] = [];
  const tradeLog: Array<{ asset: string; entryDate: string; exitDate: string; pnlPct: number }> = [];

  const equityStrategy: number[] = [];
  const equitySpx: number[] = [];
  const equityDates: string[] = [];

  const spxFirst = spx.length ? spx[0].close : null;
  let lastSpxClose: number | null = spxFirst;
  const coreSet = new Set(preset.core_assets);

  // ============ v4 — disciplina trade satellite ============
  const lastExitMs: Record<string, number> = {};
  const cooldownMs = Math.max(0, preset.cooldown_hours) * 3600 * 1000;
  const tradesPerMonth: Record<string, number> = {};
  const monthlyCap = Math.max(0, preset.monthly_trade_cap || 0);
  const entryGuardOk = preset.take_profit_pct >= preset.min_target_pct;

  // ============ v4 — Bear-DCA su BTC (release dentro al CORE al ritorno risk-on) ============
  type DcaTranche = { qty: number; costBasis: number; entryDate: string };
  const dcaTranches: DcaTranche[] = [];
  let dcaSpent = 0;
  const dcaCap = coreBudgetInitial * (preset.regime_filter === "off" ? 0 : (input.bearDca.maxPct / 100));
  const dcaTrancheUsd = startCapital * (input.bearDca.tranchePct / 100);
  const dcaIntervalMs = Math.max(0, input.bearDca.intervalDays) * 86400 * 1000;
  let lastDcaMs = -Infinity;
  const dcaSmaPeriod = Math.max(20, input.bearDca.smaPeriod || 200);

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const ms = new Date(date).getTime();
    const monthKey = date.slice(0, 7);

    // ===== regime macro su BTC (gate per CORE e SATELLITE) =====
    const sma50Btc = sma(btcCloses, 50, i);
    const sma200Btc = sma(btcCloses, 200, i);
    const smaDcaBtc = sma(btcCloses, dcaSmaPeriod, i);
    const btcLast = btcCloses[i];
    const fgVal = fgIdx.get(date)?.value ?? null;
    let regimeOk = true;
    if (preset.regime_filter === "btc_sma50") regimeOk = sma50Btc != null && btcLast > sma50Btc;
    else if (preset.regime_filter === "btc_sma200") regimeOk = sma200Btc != null && btcLast > sma200Btc;
    else if (preset.regime_filter === "fg_only") regimeOk = true;
    const macroOk = regimeOk; // regime "puro" senza F&G, usato per il CORE
    // Per il SATELLITE applichiamo anche il cap di greed F&G
    let satelliteRegimeOk = regimeOk;
    if (preset.regime_filter !== "off" && fgVal != null && fgVal > preset.fg_greed_cap) satelliteRegimeOk = false;

    // ===== gestione CORE: rotazione in/out =====
    if (preset.regime_filter === "off") {
      if (!coreInvested) enterCore(date); // sempre dentro se filtro spento
    } else if (sma200Btc != null) {
      if (macroOk && !coreInvested) enterCore(date);
      else if (!macroOk && coreInvested) exitCore(date);
    } else if (!coreInvested) {
      // pre-SMA200: entra subito così non perdi il primo anno
      enterCore(date);
    }

    // valore core oggi (units * close + eventuale cash)
    let coreValue = coreCash;
    if (coreInvested) {
      for (const sym of availableCore) {
        const c = assetIdx[sym]?.get(date);
        const price = c ? c.close : 0;
        coreValue += (coreUnits[sym] ?? 0) * price;
      }
    }

    // ===== gestione posizioni satellite aperte (stop/trailing/TP) =====
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
      // exit forzato se il macro va risk-off (proteggi il satellite)
      if (!exit && !macroOk) { exit = true; exitPrice = price; }
      if (exit) {
        const grossExit = p.qty * exitPrice * (1 - slippagePct / 100);
        const fee = grossExit * (feePct / 100);
        const netExit = grossExit - fee;
        cash += netExit;
        const pnlPct = (netExit - p.entryValue) / p.entryValue * 100;
        tradeLog.push({ asset: p.asset, entryDate: p.entryDate, exitDate: date, pnlPct });
        lastExitMs[p.asset] = ms;
        open.splice(j, 1);
      } else {
        mtmValue += p.qty * price;
      }
    }

    // ============ Bear-DCA: accumula in deep fear, RILASCIA NEL CORE al risk-on ============
    const macroRiskOff = smaDcaBtc != null && btcLast < smaDcaBtc;
    const btcCandle = assetIdx["BTC"]?.get(date);
    if (input.bearDca.enabled && btcCandle) {
      if (macroRiskOff && fgVal != null && fgVal < input.bearDca.fgThreshold) {
        const canByInterval = ms - lastDcaMs >= dcaIntervalMs;
        const canByCap = dcaSpent + dcaTrancheUsd <= dcaCap + 1e-6;
        if (canByInterval && canByCap && dcaTrancheUsd > 5 && cash >= dcaTrancheUsd) {
          const entryPrice = btcCandle.close * (1 + slippagePct / 100);
          const fee = dcaTrancheUsd * (feePct / 100);
          const qty = (dcaTrancheUsd - fee) / entryPrice;
          cash -= dcaTrancheUsd;
          dcaTranches.push({ qty, costBasis: dcaTrancheUsd, entryDate: date });
          dcaSpent += dcaTrancheUsd;
          lastDcaMs = ms;
        }
      } else if (!macroRiskOff && dcaTranches.length > 0 && coreInvested) {
        // release: trasferisci le tranche dentro il core BTC (aumenta units)
        // così la DCA partecipa al rialzo invece di realizzare in cash.
        const totalQty = dcaTranches.reduce((s, t) => s + t.qty, 0);
        const totalCost = dcaTranches.reduce((s, t) => s + t.costBasis, 0);
        coreUnits["BTC"] = (coreUnits["BTC"] ?? 0) + totalQty;
        const releasePrice = btcCandle.close;
        const releaseValue = totalQty * releasePrice;
        const pnlPct = totalCost > 0 ? (releaseValue - totalCost) / totalCost * 100 : 0;
        tradeLog.push({
          asset: "BTC-DCA",
          entryDate: dcaTranches[0].entryDate,
          exitDate: date,
          pnlPct,
        });
        dcaTranches.length = 0;
        dcaSpent = 0;
      }
    }

    // valore tranche DCA aperte (mark-to-market)
    let dcaValue = 0;
    if (dcaTranches.length > 0 && btcCandle) {
      for (const t of dcaTranches) dcaValue += t.qty * btcCandle.close;
    }

    // ============ Entries satellite ============
    const monthCount = tradesPerMonth[monthKey] ?? 0;
    const monthlyOk = monthlyCap === 0 || monthCount < monthlyCap;

    if (entryGuardOk && satelliteRegimeOk && monthlyOk && open.length < preset.max_positions && satBudget > 0) {
      for (const sym of Object.keys(assets)) {
        if (coreSet.has(sym)) continue;
        if (open.length >= preset.max_positions) break;
        if (monthlyCap > 0 && (tradesPerMonth[monthKey] ?? 0) >= monthlyCap) break;
        if (open.some((p) => p.asset === sym)) continue;
        const lastMs = lastExitMs[sym];
        if (lastMs != null && ms - lastMs < cooldownMs) continue;
        const idxArr = assetDates[sym];
        const closesArr = assetCloses[sym];
        const localIdx = idxArr.indexOf(date);
        if (localIdx < 50) continue;
        const s20 = sma(closesArr, 20, localIdx);
        const s50 = sma(closesArr, 50, localIdx);
        if (!s20 || !s50 || !(s20 > s50)) continue;
        const candle = assetIdx[sym]?.get(date);
        if (!candle) continue;
        // size = % del BUDGET SATELLITE (non del totale): evita drain del core
        const sizeUsd = (preset.max_position_pct / 100) * satBudget;
        if (sizeUsd > cash * 0.99) continue;
        if (sizeUsd < 5) continue;
        const entryPrice = candle.close * (1 + slippagePct / 100);
        const fee = sizeUsd * (feePct / 100);
        const qty = (sizeUsd - fee) / entryPrice;
        const stop = entryPrice * (1 - preset.stop_loss_pct / 100);
        cash -= sizeUsd;
        mtmValue += qty * candle.close;
        open.push({ asset: sym, qty, entryPrice, entryValue: sizeUsd, entryDate: date, stop, trailingHigh: null });
        tradesPerMonth[monthKey] = (tradesPerMonth[monthKey] ?? 0) + 1;
      }
    }

    const equity = cash + mtmValue + coreValue + dcaValue;
    equityStrategy.push(equity);

    // SPX forward-fill pulito (weekend / festivi)
    const spxToday = spxIdx.get(date)?.close;
    if (spxToday != null) lastSpxClose = spxToday;
    const spxPrice = lastSpxClose ?? spxFirst ?? 1;
    equitySpx.push(spxFirst ? (spxPrice / spxFirst) * startCapital : startCapital);
    equityDates.push(date);
  }


  // BTC Buy & Hold benchmark
  const bh = runBuyHold(btcCloses, startCapital, feePct, slippagePct);

  const equity: EquityPoint[] = equityDates.map((d, i) => ({
    date: d,
    strategy: equityStrategy[i],
    btc: bh.equity[i],
    spx: equitySpx[i],
  }));

  const strategyKpis = computeKpis(equityStrategy, equityDates, tradeLog);
  const btcKpis = computeKpis(bh.equity, equityDates, bh.trades);
  const spxKpis = computeKpis(equitySpx, equityDates, [{ pnlPct: (equitySpx[equitySpx.length - 1] / startCapital - 1) * 100 }]);

  const liveGateChecks: LiveGateChecks = {
    profitFactorOk: strategyKpis.profitFactor > 1.3,
    sharpeOk: strategyKpis.sharpe > 0.8,
    beatsBtcSharpe: strategyKpis.sharpe >= btcKpis.sharpe,
    beatsBtcDrawdown: Math.abs(strategyKpis.maxDrawdownPct) <= Math.abs(btcKpis.maxDrawdownPct),
  };
  const passesLiveGate = Object.values(liveGateChecks).every(Boolean);

  return {
    equity,
    strategyKpis,
    btcKpis,
    spxKpis,
    passesLiveGate,
    liveGateChecks,
    tradeLog,
  };
}
