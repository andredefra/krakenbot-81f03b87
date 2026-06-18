// Server function: returns the latest engine_diagnostics snapshot v2
// (macro + meso regimes, core/satellite state, eligible universe).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CandidateRow = {
  asset: string;
  price: number | null;
  sma20: number | null;
  sma50: number | null;
  trendOk: boolean;
  priceOk: boolean;
  alreadyOpen: boolean;
  opened: boolean;
  reasonSkipped?: string;
};

export type UniverseRow = {
  asset: string;
  volume_24h: number | null;
  spread_pct: number | null;
  age_days: number | null;
  eligible: boolean;
};

export type CoreHolding = {
  asset: string;
  qty: number;
  value_usd: number;
  weight_actual: number;
  weight_target: number;
};

export type DiagnosticsPayload = {
  hasSnapshot: boolean;
  cycleAt: string | null;
  // legacy compat
  regime: "risk-on" | "risk-off" | "unknown";
  regimeReason: string | null;
  btcLast: number | null;
  btcSma50: number | null;
  btcSma200: number | null;
  fgValue: number | null;
  fgLabel: string | null;
  candidates: CandidateRow[];
  notes: string | null;
  // v2
  macro: { regime: "risk-on" | "risk-off" | "unknown"; reason: string | null };
  meso: { regime: "risk-on" | "risk-off" | "unknown"; reason: string | null };
  core: {
    invested: boolean;
    targetWeights: Record<string, number>;
    coreCapitalUsd: number | null;
    held: CoreHolding[];
  };
  satellite: { open: number; max: number };
  bearDca: {
    enabled: boolean;
    active: boolean;
    deployedUsd: number;
    capUsd: number;
    capPct: number;
    fgThreshold: number;
    lastActionAt: string | null;
    tranches: number;
  };
  universe: UniverseRow[];
  settings: {
    is_running: boolean;
    mode: string;
    max_positions: number;
    max_satellite_positions: number;
    regime_filter: string;
    fg_greed_cap: number;
    strategy_preset: string;
    core_only_mode: boolean;
    bear_dca_enabled: boolean;
    exclude_fiat_commodity: boolean;
  } | null;
  openPositions: number;
  totalFeesUsd: number;
  lastEngineMessage: string | null;
  lastEngineAt: string | null;
};

export const getDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DiagnosticsPayload> => {
    const { supabase, userId } = context;

    const [diagRes, settingsRes, openRes, eventRes] = await Promise.all([
      supabase.from("engine_diagnostics").select("*").eq("user_id", userId).maybeSingle(),
      supabase
        .from("settings")
        .select("is_running,mode,max_positions,max_satellite_positions,regime_filter,fg_greed_cap,strategy_preset")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("positions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "open"),
      supabase
        .from("events_log")
        .select("message,created_at")
        .eq("user_id", userId)
        .eq("component", "trading-engine")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const diag = diagRes.data as Record<string, unknown> | null;
    const coreState = (diag?.core_state ?? null) as null | {
      invested?: boolean;
      target_weights?: Record<string, number>;
      core_capital_usd?: number;
      held?: CoreHolding[];
    };
    const satState = (diag?.satellite_state ?? null) as null | { open?: number; max?: number };

    return {
      hasSnapshot: !!diag,
      cycleAt: (diag?.cycle_at as string) ?? null,
      regime: ((diag?.regime as string) ?? "unknown") as "risk-on" | "risk-off" | "unknown",
      regimeReason: (diag?.regime_reason as string) ?? null,
      btcLast: diag?.btc_last != null ? Number(diag.btc_last) : null,
      btcSma50: diag?.btc_sma50 != null ? Number(diag.btc_sma50) : null,
      btcSma200: diag?.btc_sma200 != null ? Number(diag.btc_sma200) : null,
      fgValue: (diag?.fg_value as number) ?? null,
      fgLabel: (diag?.fg_label as string) ?? null,
      candidates: ((diag?.candidates as CandidateRow[]) ?? []),
      notes: (diag?.notes as string) ?? null,
      macro: {
        regime: ((diag?.macro_regime as string) ?? "unknown") as "risk-on" | "risk-off" | "unknown",
        reason: (diag?.macro_reason as string) ?? null,
      },
      meso: {
        regime: ((diag?.meso_regime as string) ?? (diag?.regime as string) ?? "unknown") as "risk-on" | "risk-off" | "unknown",
        reason: (diag?.meso_reason as string) ?? (diag?.regime_reason as string) ?? null,
      },
      core: {
        invested: !!coreState?.invested,
        targetWeights: coreState?.target_weights ?? {},
        coreCapitalUsd: coreState?.core_capital_usd ?? null,
        held: coreState?.held ?? [],
      },
      satellite: {
        open: satState?.open ?? 0,
        max: satState?.max ?? (settingsRes.data?.max_satellite_positions ?? 2),
      },
      universe: ((diag?.universe_eligible as UniverseRow[]) ?? []),
      settings: settingsRes.data ?? null,
      openPositions: openRes.count ?? 0,
      lastEngineMessage: eventRes.data?.message ?? null,
      lastEngineAt: eventRes.data?.created_at ?? null,
    };
  });
