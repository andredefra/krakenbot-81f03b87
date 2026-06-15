// Client-safe strategy presets. Applying a preset updates settings table.
// Allineato a STRATEGIA.md §3 + nuovi parametri regime_filter / fg_greed_cap.

export type PresetId = "conservative" | "balanced" | "aggressive" | "custom";

export type StrategyPreset = {
  id: PresetId;
  name: string;
  tagline: string;
  risk: "Bassa" | "Media" | "Alta";
  variance: "Bassa" | "Media" | "Alta";
  expected: string;
  // Settings patch (lasciato `undefined` per "custom" — solo placeholder)
  values: {
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
  } | null;
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
  },
  {
    id: "custom",
    name: "Custom",
    tagline: "Parametri modificati a mano dalla pagina Rischio",
    risk: "Media",
    variance: "Media",
    expected: "Dipende dai tuoi valori",
    values: null,
  },
];

export function getPreset(id: PresetId): StrategyPreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[1];
}
