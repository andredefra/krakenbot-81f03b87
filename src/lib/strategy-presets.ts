// Client-safe strategy presets — v3 Core-Led (vedi STRATEGIA.md v3).
// v3: 70/30 di default, satellite più severo (max 2 pos, target +5%, ≤6 trade/mese,
// cooldown 48h), Bear-DCA opzionale, igiene universo, fee reali Kraken usate sia
// dall'engine che dal backtest.

export type PresetId = "conservative" | "balanced" | "aggressive" | "custom";

export type PresetValues = {
  // Allocazione
  core_satellite_split: { core: number; satellite: number };
  core_weights: { BTC: number; ETH: number };

  // Filtri universo (cancelli liquidità)
  min_volume_24h: number;
  max_spread_pct: number;
  min_listing_age_days: number;

  // Regime
  macro_ma_period: number;
  mid_ma_period: number;
  fg_greed_cap: number;

  // Satellite — gestione posizione
  max_satellite_positions: number;
  risk_per_trade_pct: number;
  stop_atr_mult: number;
  stop_min_pct: number;
  trailing_activate_pct: number;
  trailing_gap_pct: number;
  take_profit_pct: number;
  min_target_pct: number;

  // Disciplina commissioni
  monthly_trade_cap: number;
  cooldown_hours: number;

  // Globali
  daily_loss_limit_pct: number;
  timeframe: string;

  // Compat — mappate alle vecchie colonne (per non rompere queries esistenti)
  max_positions: number;       // = max_satellite_positions
  max_position_pct: number;    // ≈ risk_per_trade_pct * 10 (size indicativa)
  stop_loss_pct: number;       // = stop_min_pct (floor)
};

export type PresetDescription = {
  summary: string;
  assets: string[];
  entryRules: string[];
  exitRules: string[];
  idealFor: string;
  avoidIf: string;
  expectedDrawdown: string;
  tradesPerMonth: string;
};

export type StrategyPreset = {
  id: PresetId;
  name: string;
  tagline: string;
  risk: "Bassa" | "Media" | "Alta";
  variance: "Bassa" | "Media" | "Alta";
  expected: string;
  values: PresetValues | null;
  description: PresetDescription | null;
};

const UNIVERSE_DEFAULTS = {
  min_volume_24h: 5_000_000,
  max_spread_pct: 0.3,
  min_listing_age_days: 60,
};

export const PRESETS: StrategyPreset[] = [
  {
    id: "conservative",
    name: "Conservativo",
    tagline: "Quasi core-only — satellite spento al minimo",
    risk: "Bassa",
    variance: "Bassa",
    expected: "Cattura ~70% del trend con DD molto piccolo",
    values: {
      core_satellite_split: { core: 0.85, satellite: 0.15 },
      core_weights: { BTC: 0.7, ETH: 0.3 },
      ...UNIVERSE_DEFAULTS,
      macro_ma_period: 200,
      mid_ma_period: 50,
      fg_greed_cap: 70,
      max_satellite_positions: 1,
      risk_per_trade_pct: 2,
      stop_atr_mult: 2,
      stop_min_pct: 12,
      trailing_activate_pct: 15,
      trailing_gap_pct: 10,
      take_profit_pct: 25,
      min_target_pct: 5,
      monthly_trade_cap: 3,
      cooldown_hours: 72,
      daily_loss_limit_pct: 5,
      timeframe: "4h",
      max_positions: 1,
      max_position_pct: 15,
      stop_loss_pct: 12,
    },
    description: {
      summary:
        "85% in core BTC/ETH (70/30) con filtro macro BTC vs SMA200, 15% di satellite quasi spento (max 1 posizione, ≤3 trade/mese, cooldown 72h). Pensato per chi vuole essere quasi solo core: minima varianza e fee minime.",
      assets: ["Core: BTC, ETH", "Satellite: universo Kraken filtrato (no fiat/commodity)"],
      entryRules: [
        "Macro: BTC sopra SMA200 (core investito)",
        "Medio: BTC sopra SMA50 + F&G ≤ 70 (satellite armato)",
        "Universo: volume 24h > 5M USD, spread < 0.3%, età > 60g, no fiat/commodity",
        "Trend up + breakout con volume, target minimo +5%",
      ],
      exitRules: [
        "Stop: max(12%, 2×ATR) come ordine reale Kraken",
        "Trailing +15% / −10%",
        "Inversione trend o regime medio risk-off",
        "Cooldown 72h prima di rientrare sullo stesso asset",
      ],
      idealFor: "Esposizione crypto con drawdown ridotto, quasi core-only",
      avoidIf: "Vuoi rendimenti potenzialmente più alti del buy & hold",
      expectedDrawdown: "−10% / −15%",
      tradesPerMonth: "≤ 3",
    },
  },
  {
    id: "balanced",
    name: "Bilanciato",
    tagline: "Default v3 — 70% core, 30% satellite severo",
    risk: "Media",
    variance: "Media",
    expected: "Mira a Sharpe più alto del buy & hold con fee reali",
    values: {
      core_satellite_split: { core: 0.7, satellite: 0.3 },
      core_weights: { BTC: 0.6, ETH: 0.4 },
      ...UNIVERSE_DEFAULTS,
      macro_ma_period: 200,
      mid_ma_period: 50,
      fg_greed_cap: 75,
      max_satellite_positions: 2,
      risk_per_trade_pct: 3,
      stop_atr_mult: 2,
      stop_min_pct: 12,
      trailing_activate_pct: 12,
      trailing_gap_pct: 8,
      take_profit_pct: 25,
      min_target_pct: 5,
      monthly_trade_cap: 6,
      cooldown_hours: 48,
      daily_loss_limit_pct: 8,
      timeframe: "4h",
      max_positions: 2,
      max_position_pct: 25,
      stop_loss_pct: 12,
    },
    description: {
      summary:
        "70% core BTC/ETH (60/40) con filtro macro BTC vs SMA200, 30% sleeve satellite severo (max 2 posizioni, ≤6 trade/mese, target minimo +5%, cooldown 48h). Default v3: meno frequenza = meno drag da commissioni reali Kraken.",
      assets: ["Core: BTC, ETH", "Satellite: universo Kraken filtrato (no fiat/commodity)"],
      entryRules: [
        "Macro: BTC sopra SMA200 (core investito)",
        "Medio: BTC sopra SMA50 + F&G ≤ 75 (satellite armato)",
        "Universo: volume 24h > 5M, spread < 0.3%, età > 60g, no fiat/commodity",
        "Trend up + breakout volume, target minimo +5% (per coprire fee Kraken ~0.8% a giro)",
      ],
      exitRules: [
        "Stop: max(12%, 2×ATR) come ordine reale Kraken",
        "Trailing +12% / −8%, take-profit parziale a +25%",
        "Inversione trend (SMA20<50 su 4h) o regime medio risk-off",
        "Cooldown 48h sullo stesso asset",
      ],
      idealFor: "Equilibrio rischio/rendimento, default raccomandato v3",
      avoidIf: "Vuoi semplicemente comprare e tenere senza filtri",
      expectedDrawdown: "−15% / −22%",
      tradesPerMonth: "≤ 6",
    },
  },
  {
    id: "aggressive",
    name: "Aggressivo",
    tagline: "Satellite più ampio — sconsigliato in bear",
    risk: "Alta",
    variance: "Alta",
    expected: "Cattura più upside in bull, drawdown maggiori",
    values: {
      core_satellite_split: { core: 0.55, satellite: 0.45 },
      core_weights: { BTC: 0.5, ETH: 0.5 },
      ...UNIVERSE_DEFAULTS,
      macro_ma_period: 200,
      mid_ma_period: 50,
      fg_greed_cap: 85,
      max_satellite_positions: 3,
      risk_per_trade_pct: 4,
      stop_atr_mult: 1.8,
      stop_min_pct: 10,
      trailing_activate_pct: 12,
      trailing_gap_pct: 8,
      take_profit_pct: 30,
      min_target_pct: 5,
      monthly_trade_cap: 10,
      cooldown_hours: 24,
      daily_loss_limit_pct: 10,
      timeframe: "4h",
      max_positions: 3,
      max_position_pct: 35,
      stop_loss_pct: 10,
    },
    description: {
      summary:
        "55% core BTC/ETH (50/50), 45% sleeve satellite più ampio (max 3 posizioni, ≤10 trade/mese, cooldown 24h). Più esposizione alle alt. ⚠️ Sconsigliato in bear: le alt crollano più di BTC nel risk-off.",
      assets: ["Core: BTC, ETH", "Satellite: universo Kraken filtrato (no fiat/commodity)"],
      entryRules: [
        "Macro: BTC sopra SMA200",
        "Medio: BTC sopra SMA50 + F&G ≤ 85 (filtro permissivo)",
        "Universo: volume 24h > 5M, spread < 0.3%, età > 60g, no fiat/commodity",
        "Trend + breakout, target minimo +5%",
      ],
      exitRules: [
        "Stop: max(10%, 1.8×ATR)",
        "Trailing +12% / −8%, take-profit parziale a +30%",
        "Inversione trend o regime medio risk-off",
        "Cooldown 24h sullo stesso asset",
      ],
      idealFor: "Cerchi più upside accettando swing forti (solo in bull confermato)",
      avoidIf: "Mercato in bear o non puoi vedere il capitale scendere del 30%",
      expectedDrawdown: "−25% / −35%",
      tradesPerMonth: "≤ 10",
    },
  },
  {
    id: "custom",
    name: "Custom",
    tagline: "Parametri modificati a mano dalla pagina Rischio",
    risk: "Media",
    variance: "Media",
    expected: "Dipende dai tuoi valori",
    values: null,
    description: null,
  },
];

export function getPreset(id: PresetId): StrategyPreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[1];
}

// Campi confrontati per la detection. Le jsonb sono serializzate.
const DETECT_NUMERIC: Array<keyof PresetValues> = [
  "max_satellite_positions",
  "risk_per_trade_pct",
  "stop_atr_mult",
  "stop_min_pct",
  "trailing_activate_pct",
  "trailing_gap_pct",
  "take_profit_pct",
  "min_target_pct",
  "monthly_trade_cap",
  "cooldown_hours",
  "daily_loss_limit_pct",
  "fg_greed_cap",
];

export function detectPreset(settings: Record<string, unknown> | null | undefined): PresetId {
  if (!settings) return "custom";
  for (const p of PRESETS) {
    if (!p.values) continue;
    const numericMatch = DETECT_NUMERIC.every((k) => Number(settings[k as string]) === Number(p.values![k]));
    if (!numericMatch) continue;
    // split jsonb
    const split = (settings.core_satellite_split ?? {}) as Record<string, number>;
    const targetSplit = p.values.core_satellite_split;
    if (Number(split.core) !== targetSplit.core || Number(split.satellite) !== targetSplit.satellite) continue;
    return p.id;
  }
  return "custom";
}

// ============================================================================
// Sentiment weights derivati dal preset attivo + sorgenti abilitate
// ============================================================================
// Strategia v3: F&G è "gate" sempre primario e governa anche il trigger di
// deep-fear del Bear-DCA. LunarCrush e Santiment sono solo conferme sul satellite.

const SENTIMENT_BASE: Record<Exclude<PresetId, "custom">, Record<string, number>> = {
  conservative: { fear_greed: 0.7, lunarcrush: 0.2, santiment: 0.1, news: 0.0 },
  balanced:     { fear_greed: 0.5, lunarcrush: 0.3, santiment: 0.2, news: 0.0 },
  aggressive:   { fear_greed: 0.3, lunarcrush: 0.4, santiment: 0.3, news: 0.0 },
};

const SENTIMENT_SOURCES = ["fear_greed", "lunarcrush", "santiment", "news"] as const;

export function deriveSentimentWeights(
  presetId: PresetId,
  enabled: Record<string, boolean>,
): Record<string, number> {
  const base = SENTIMENT_BASE[presetId === "custom" ? "balanced" : presetId];
  const activeKeys = SENTIMENT_SOURCES.filter((k) => enabled[k]);
  if (activeKeys.length === 0) {
    return Object.fromEntries(SENTIMENT_SOURCES.map((k) => [k, 0]));
  }
  const sum = activeKeys.reduce((s, k) => s + (base[k] || 0), 0);
  const out: Record<string, number> = {};
  for (const k of SENTIMENT_SOURCES) {
    out[k] = enabled[k] && sum > 0 ? Math.round(((base[k] || 0) / sum) * 100) / 100 : 0;
  }
  return out;
}
