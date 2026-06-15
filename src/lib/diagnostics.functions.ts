// Server function: returns the latest engine_diagnostics snapshot
// + complementary info (settings, last engine event, next cycle ETA).
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

export type DiagnosticsPayload = {
  hasSnapshot: boolean;
  cycleAt: string | null;
  regime: "risk-on" | "risk-off" | "unknown";
  regimeReason: string | null;
  btcLast: number | null;
  btcSma50: number | null;
  fgValue: number | null;
  fgLabel: string | null;
  candidates: CandidateRow[];
  notes: string | null;
  settings: {
    is_running: boolean;
    mode: string;
    max_positions: number;
    regime_filter: string;
    fg_greed_cap: number;
    strategy_preset: string;
  } | null;
  openPositions: number;
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
        .select("is_running,mode,max_positions,regime_filter,fg_greed_cap,strategy_preset")
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

    const diag = diagRes.data;
    return {
      hasSnapshot: !!diag,
      cycleAt: diag?.cycle_at ?? null,
      regime: ((diag?.regime as string) ?? "unknown") as "risk-on" | "risk-off" | "unknown",
      regimeReason: diag?.regime_reason ?? null,
      btcLast: diag?.btc_last ? Number(diag.btc_last) : null,
      btcSma50: diag?.btc_sma50 ? Number(diag.btc_sma50) : null,
      fgValue: diag?.fg_value ?? null,
      fgLabel: diag?.fg_label ?? null,
      candidates: (diag?.candidates as CandidateRow[]) ?? [],
      notes: diag?.notes ?? null,
      settings: settingsRes.data ?? null,
      openPositions: openRes.count ?? 0,
      lastEngineMessage: eventRes.data?.message ?? null,
      lastEngineAt: eventRes.data?.created_at ?? null,
    };
  });
