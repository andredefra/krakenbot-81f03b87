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
    tagline: "Capitale protetto, ingressi rari ma di qualità",
    risk: "Bassa",
    variance: "Bassa",
    expected: "Drawdown contenuto, crescita lenta",
    values: {
      max_positions: 2,
      max_position_pct: 20,
      stop_loss_pct: 7,
      trailing_activate_pct: 8,
      trailing_gap_pct: 5,
      take_profit_pct: 15,
      min_target_pct: 3,
      daily_loss_limit_pct: 5,
      fg_greed_cap: 70,
      regime_filter: "btc_sma50",
      timeframe: "4h",
    },
    description: {
      summary:
        "Esposizione minima al mercato crypto. Solo i due asset più liquidi, filtri severi sull'ingresso, stop stretti. Pensato per chi vuole partecipare al ciclo crypto senza perdere il sonno.",
      assets: ["BTC", "ETH"],
      entryRules: [
        "BTC sopra la sua SMA50 (mercato in trend rialzista)",
        "Fear & Greed ≤ 70 (no euforia)",
        "Segnale momentum su timeframe 4h",
        "Target minimo atteso ≥ 3%",
      ],
      exitRules: [
        "Stop loss fisso a −7% dall'ingresso",
        "Trailing stop attivato dopo +8% di profitto, gap 5%",
        "Take-profit parziale a +15%",
        "Kill-switch giornaliero a −5%",
      ],
      idealFor: "Chi vuole esposizione crypto minima e dorme sereno",
      avoidIf: "Cerchi rendimenti annuali sopra il 30%",
      expectedDrawdown: "−8% / −12%",
      tradesPerMonth: "1-3",
    },
  },
  {
    id: "balanced",
    name: "Bilanciato",
    tagline: "Default raccomandato — equilibrio rischio/rendimento",
    risk: "Media",
    variance: "Media",
    expected: "Crescita moderata, drawdown gestiti",
    values: {
      max_positions: 3,
      max_position_pct: 30,
      stop_loss_pct: 10,
      trailing_activate_pct: 10,
      trailing_gap_pct: 7,
      take_profit_pct: 20,
      min_target_pct: 2,
      daily_loss_limit_pct: 8,
      fg_greed_cap: 75,
      regime_filter: "btc_sma50",
      timeframe: "1h",
    },
    description: {
      summary:
        "Equilibrio tra protezione e partecipazione. Core di tre asset + sleeve momentum sulle top-10 per market cap. Filtri di regime attivi ma non eccessivi.",
      assets: ["BTC", "ETH", "SOL", "+ sleeve momentum top-10 mcap"],
      entryRules: [
        "BTC sopra la sua SMA50",
        "Fear & Greed ≤ 75",
        "Segnale momentum su timeframe 1h",
        "Target minimo atteso ≥ 2%",
      ],
      exitRules: [
        "Stop loss fisso a −10% dall'ingresso",
        "Trailing stop attivato dopo +10%, gap 7%",
        "Take-profit parziale a +20%",
        "Kill-switch giornaliero a −8%",
      ],
      idealFor: "Chi vuole crescita reale ma con regole chiare",
      avoidIf: "Non tolleri drawdown nell'ordine del −15%",
      expectedDrawdown: "−12% / −18%",
      tradesPerMonth: "3-8",
    },
  },
  {
    id: "aggressive",
    name: "Aggressivo",
    tagline: "Massima esposizione — accetti drawdown >20%",
    risk: "Alta",
    variance: "Alta",
    expected: "Crescita potenziale alta, swing intensi",
    values: {
      max_positions: 4,
      max_position_pct: 40,
      stop_loss_pct: 12,
      trailing_activate_pct: 12,
      trailing_gap_pct: 8,
      take_profit_pct: 25,
      min_target_pct: 1.5,
      daily_loss_limit_pct: 10,
      fg_greed_cap: 85,
      regime_filter: "btc_sma200",
      timeframe: "1h",
    },
    description: {
      summary:
        "Massima ricerca di rendimento. Sleeve momentum esteso, filtri di regime permissivi (SMA200 invece di SMA50), stop più larghi per assorbire la volatilità.",
      assets: ["BTC", "ETH", "SOL", "+ sleeve momentum top-20 mcap"],
      entryRules: [
        "BTC sopra la sua SMA200 (filtro permissivo)",
        "Fear & Greed ≤ 85 (entra anche in euforia)",
        "Segnale momentum su timeframe 1h",
        "Target minimo atteso ≥ 1.5%",
      ],
      exitRules: [
        "Stop loss fisso a −12% dall'ingresso",
        "Trailing stop attivato dopo +12%, gap 8%",
        "Take-profit parziale a +25%",
        "Kill-switch giornaliero a −10%",
      ],
      idealFor: "Vuoi rendimenti potenzialmente alti e tolleri swing forti",
      avoidIf: "Non puoi vedere il capitale scendere del 25%",
      expectedDrawdown: "−20% / −30%",
      tradesPerMonth: "5-15",
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
