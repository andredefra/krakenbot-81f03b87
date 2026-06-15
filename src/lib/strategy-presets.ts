// Client-safe strategy presets. Applying a preset updates settings table.
// Allineato a STRATEGIA.md §3 + nuovi parametri regime_filter / fg_greed_cap.

export type PresetId = "conservative" | "balanced" | "aggressive" | "custom";

export type PresetValues = {
  max_positions: number;
  max_position_pct: number;
  stop_loss_pct: number;
  trailing_activate_pct: number;
  trailing_gap_pct: number;
  take_profit_pct: number;
  min_target_pct: number;
  daily_loss_limit_pct: number;
  fg_greed_cap: number;
  regime_filter: "btc_sma50" | "btc_sma200" | "fg_only" | "off";
  timeframe: string;
  rebalance_days?: number;
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

export const PRESETS: StrategyPreset[] = [
  {
    id: "conservative",
    name: "Conservativo",
    tagline: "BTC-core, rotazione lenta, esce in cash sotto SMA200",
    risk: "Bassa",
    variance: "Bassa",
    expected: "Drawdown contenuto, traccia BTC nei bull, protezione nei bear",
    values: {
      max_positions: 2,
      max_position_pct: 50,
      stop_loss_pct: 15,
      trailing_activate_pct: 0,
      trailing_gap_pct: 0,
      take_profit_pct: 0,
      min_target_pct: 0,
      daily_loss_limit_pct: 8,
      fg_greed_cap: 100,
      regime_filter: "btc_sma200",
      timeframe: "1d",
      rebalance_days: 14,
    },
    description: {
      summary:
        "BTC come ancora. Capitale sempre in BTC quando BTC è sopra la SMA200 giornaliera; ruota su 1 alt (ETH o SOL) solo se mostra momentum 30g superiore. Esce tutto in cash sotto SMA200.",
      assets: ["BTC", "+ 1 alt a rotazione (ETH/SOL)"],
      entryRules: [
        "BTC > SMA200 giornaliera (regime risk-on)",
        "BTC sempre incluso (anchor)",
        "1 alt aggiunto solo se momentum 30g > 0",
        "Ribilancio ogni 14 giorni o se composizione cambia",
      ],
      exitRules: [
        "BTC < SMA200 → tutto in cash",
        "Stop per singolo asset a −15% (esce dal singolo)",
        "Kill-switch giornaliero a −8% (flat per 24h)",
      ],
      idealFor: "Chi vuole esposizione crypto difensiva, simile a BTC ma con protezione bear",
      avoidIf: "Vuoi battere BTC nei mega-bull (i costi di ribilancio costano qualche punto)",
      expectedDrawdown: "−15% / −25%",
      tradesPerMonth: "2-4",
    },
  },
  {
    id: "balanced",
    name: "Bilanciato",
    tagline: "Default — BTC + rotazione momentum su top alts",
    risk: "Media",
    variance: "Media",
    expected: "Cerca di battere BTC nei laterali, perde meno nei bear",
    values: {
      max_positions: 3,
      max_position_pct: 34,
      stop_loss_pct: 20,
      trailing_activate_pct: 0,
      trailing_gap_pct: 0,
      take_profit_pct: 0,
      min_target_pct: 0,
      daily_loss_limit_pct: 10,
      fg_greed_cap: 100,
      regime_filter: "btc_sma200",
      timeframe: "1d",
      rebalance_days: 7,
    },
    description: {
      summary:
        "Sempre investito quando BTC > SMA200. Tiene BTC + 2 alt scelti per momentum 30g tra l'universo (ETH, SOL, eventualmente sleeve). Equal-weight, ribilancio settimanale.",
      assets: ["BTC", "ETH", "SOL", "+ sleeve momentum"],
      entryRules: [
        "BTC > SMA200 (regime risk-on)",
        "BTC sempre incluso",
        "Top 2 alt per momentum 30g (solo se positivo)",
        "Equal-weight, ribilancio ogni 7 giorni",
      ],
      exitRules: [
        "BTC < SMA200 → tutto in cash",
        "Stop per singolo asset a −20%",
        "Kill-switch giornaliero a −10%",
      ],
      idealFor: "Chi vuole partecipare al ciclo crypto con protezione nei bear",
      avoidIf: "Non tolleri drawdown nell'ordine del −20% nei crash improvvisi",
      expectedDrawdown: "−20% / −30%",
      tradesPerMonth: "4-8",
    },
  },
  {
    id: "aggressive",
    name: "Aggressivo",
    tagline: "Rotazione veloce su sleeve allargato",
    risk: "Alta",
    variance: "Alta",
    expected: "Massima ricerca di rendimento, swing intensi",
    values: {
      max_positions: 4,
      max_position_pct: 25,
      stop_loss_pct: 25,
      trailing_activate_pct: 0,
      trailing_gap_pct: 0,
      take_profit_pct: 0,
      min_target_pct: 0,
      daily_loss_limit_pct: 12,
      fg_greed_cap: 100,
      regime_filter: "btc_sma200",
      timeframe: "1d",
      rebalance_days: 5,
    },
    description: {
      summary:
        "BTC + 3 alt scelti per momentum 30g tra tutto lo sleeve. Ribilancio ogni 5 giorni. Stop più larghi per assorbire volatilità degli alt.",
      assets: ["BTC", "ETH", "SOL", "+ sleeve allargato (ADA/LINK/AVAX/DOT/XRP/LTC)"],
      entryRules: [
        "BTC > SMA200 (regime risk-on)",
        "BTC sempre incluso",
        "Top 3 alt per momentum 30g",
        "Equal-weight, ribilancio ogni 5 giorni",
      ],
      exitRules: [
        "BTC < SMA200 → tutto in cash",
        "Stop per singolo asset a −25%",
        "Kill-switch giornaliero a −12%",
      ],
      idealFor: "Vuoi massimizzare il potenziale upside e tolleri swing forti",
      avoidIf: "Non puoi vedere il capitale scendere del 30%",
      expectedDrawdown: "−25% / −40%",
      tradesPerMonth: "8-15",
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

// Campi confrontati per la detection. `timeframe` escluso (stringa libera).
const DETECT_KEYS: Array<keyof PresetValues> = [
  "max_positions",
  "max_position_pct",
  "stop_loss_pct",
  "trailing_activate_pct",
  "trailing_gap_pct",
  "take_profit_pct",
  "min_target_pct",
  "daily_loss_limit_pct",
  "fg_greed_cap",
  "regime_filter",
];

/**
 * Confronta una riga `settings` con tutti i preset noti.
 * Ritorna l'id del preset che matcha esattamente, o "custom" altrimenti.
 */
export function detectPreset(settings: Record<string, unknown> | null | undefined): PresetId {
  if (!settings) return "custom";
  for (const p of PRESETS) {
    if (!p.values) continue;
    const match = DETECT_KEYS.every((k) => {
      const a = settings[k as string];
      const b = p.values![k];
      // numerico vs stringa numerica: confronto loose via Number
      if (typeof b === "number") return Number(a) === b;
      return String(a) === String(b);
    });
    if (match) return p.id;
  }
  return "custom";
}
