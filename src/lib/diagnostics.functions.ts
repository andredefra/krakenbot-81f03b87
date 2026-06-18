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
  aiSupervisor: {
    lastRunAt: string | null;
    decision: { core_only_mode: boolean; bear_dca_enabled: boolean; exclude_fiat_commodity: boolean } | null;
    reasoning: string | null;
    confidence: "low" | "medium" | "high" | null;
    changedFlags: string[];
  };
  lastEngineMessage: string | null;
  lastEngineAt: string | null;
};

export const getDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DiagnosticsPayload> => {
    const { supabase, userId } = context;

    const [diagRes, settingsRes, openRes, eventRes, feesRes] = await Promise.all([
      supabase.from("engine_diagnostics").select("*").eq("user_id", userId).maybeSingle(),
      supabase
        .from("settings")
        .select("is_running,mode,max_positions,max_satellite_positions,regime_filter,fg_greed_cap,strategy_preset,core_only_mode,bear_dca_enabled,exclude_fiat_commodity,bear_dca_fg_threshold,bear_dca_cap_pct,ai_supervisor_state")
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
      supabase
        .from("positions")
        .select("fee_paid_usd")
        .eq("user_id", userId),
    ]);

    const diag = diagRes.data as Record<string, unknown> | null;
    const coreState = (diag?.core_state ?? null) as null | {
      invested?: boolean;
      target_weights?: Record<string, number>;
      core_capital_usd?: number;
      held?: CoreHolding[];
    };
    const satState = (diag?.satellite_state ?? null) as null | { open?: number; max?: number };
    const bdState = (diag?.bear_dca_state ?? null) as null | {
      active?: boolean;
      deployed_usd?: number;
      cap_usd?: number;
      tranches?: number;
      last_action_at?: string | null;
    };
    const settingsRow = settingsRes.data as null | {
      is_running: boolean;
      mode: string;
      max_positions: number;
      max_satellite_positions: number;
      regime_filter: string;
      fg_greed_cap: number;
      strategy_preset: string;
      core_only_mode: boolean | null;
      bear_dca_enabled: boolean | null;
      exclude_fiat_commodity: boolean | null;
      bear_dca_fg_threshold: number | null;
      bear_dca_cap_pct: number | null;
    };
    const totalFeesUsd = (feesRes.data ?? []).reduce(
      (acc, r: { fee_paid_usd: number | null }) => acc + Number(r.fee_paid_usd ?? 0),
      0,
    );

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
        max: satState?.max ?? (settingsRow?.max_satellite_positions ?? 2),
      },
      bearDca: {
        enabled: !!settingsRow?.bear_dca_enabled,
        active: !!bdState?.active,
        deployedUsd: Number(bdState?.deployed_usd ?? 0),
        capUsd: Number(bdState?.cap_usd ?? 0),
        capPct: Number(settingsRow?.bear_dca_cap_pct ?? 0),
        fgThreshold: Number(settingsRow?.bear_dca_fg_threshold ?? 22),
        lastActionAt: bdState?.last_action_at ?? null,
        tranches: Number(bdState?.tranches ?? 0),
      },
      universe: ((diag?.universe_eligible as UniverseRow[]) ?? []),
      settings: settingsRow
        ? {
            is_running: settingsRow.is_running,
            mode: settingsRow.mode,
            max_positions: settingsRow.max_positions,
            max_satellite_positions: settingsRow.max_satellite_positions,
            regime_filter: settingsRow.regime_filter,
            fg_greed_cap: settingsRow.fg_greed_cap,
            strategy_preset: settingsRow.strategy_preset,
            core_only_mode: !!settingsRow.core_only_mode,
            bear_dca_enabled: !!settingsRow.bear_dca_enabled,
            exclude_fiat_commodity: !!settingsRow.exclude_fiat_commodity,
          }
        : null,
      openPositions: openRes.count ?? 0,
      totalFeesUsd,
      aiSupervisor: (() => {
        const s = (settingsRow as unknown as { ai_supervisor_state?: Record<string, unknown> } | null)?.ai_supervisor_state ?? null;
        const dec = (s?.last_decision ?? null) as null | { core_only_mode: boolean; bear_dca_enabled: boolean; exclude_fiat_commodity: boolean };
        return {
          lastRunAt: (s?.last_run_at as string) ?? null,
          decision: dec,
          reasoning: (s?.reasoning as string) ?? null,
          confidence: (s?.confidence as "low" | "medium" | "high") ?? null,
          changedFlags: (s?.changed_flags as string[]) ?? [],
        };
      })(),
      lastEngineMessage: eventRes.data?.message ?? null,
      lastEngineAt: eventRes.data?.created_at ?? null,
    };
  });
