// Server functions per AI Supervisor v2 (Diario + Proposte).
// Tutte le funzioni richiedono auth e operano nello scope dell'utente corrente.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Whitelist parametri (deve coincidere con quella del supervisor hook)
const PROPOSABLE_FIELDS = [
  "strategy_preset",
  "max_satellite_positions",
  "max_position_pct",
  "risk_per_trade_pct",
  "stop_min_pct",
  "trailing_activate_pct",
  "trailing_gap_pct",
  "take_profit_pct",
  "monthly_trade_cap",
  "cooldown_hours",
  "daily_loss_limit_pct",
  "fg_greed_cap",
] as const;
type ProposableField = (typeof PROPOSABLE_FIELDS)[number];

type ParamDiffEntry = { field: ProposableField; from?: string | number | boolean | null; to: string | number | boolean };

// ============== Liste ==============

export const listReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ limit: z.number().int().min(1).max(100).default(30) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const r = await supabase
      .from("ai_reports")
      .select("id,created_at,period,narrative,anomalies,market_snapshot,self_snapshot,proposals_generated")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (r.error) throw new Error(r.error.message);
    return r.data ?? [];
  });

export const listProposals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ status: z.string().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase
      .from("ai_proposals")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.status) q = q.eq("status", data.status as never);
    const r = await q;
    if (r.error) throw new Error(r.error.message);
    return r.data ?? [];
  });

export const listFlagChanges = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ limit: z.number().int().min(1).max(50).default(20) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const r = await supabase
      .from("ai_flag_changes")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (r.error) throw new Error(r.error.message);
    return r.data ?? [];
  });

export const countPendingProposals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const r = await supabase
      .from("ai_proposals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["pending", "validated"] as never);
    return r.count ?? 0;
  });

// ============== Decisione (approva/rifiuta) ==============

export const decideProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    decision: z.enum(["approve", "reject"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const prop = await supabase.from("ai_proposals").select("*").eq("id", data.id).eq("user_id", userId).maybeSingle();
    if (prop.error || !prop.data) throw new Error("Proposta non trovata");
    if (prop.data.status !== "pending") throw new Error(`Proposta in stato ${prop.data.status}, non modificabile`);

    if (data.decision === "reject") {
      await supabase.from("ai_proposals").update({
        status: "rejected", decided_at: new Date().toISOString(), decided_by: userId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any).eq("id", data.id);
      await supabase.from("events_log").insert({
        user_id: userId, component: "ai-proposals", level: "info",
        message: `Proposta rifiutata: ${prop.data.title}`,
        payload: { id: data.id } as never,
      });
      return { ok: true, status: "rejected" };
    }

    // approve → marca approved e lancia validazione (sync)
    await supabase.from("ai_proposals").update({
      status: "approved", decided_at: new Date().toISOString(), decided_by: userId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).eq("id", data.id);

    const validation = await runValidationInternal(supabase, userId, data.id);
    return { ok: true, status: validation.status, validation };
  });

// ============== Applica proposta validata ==============

export const applyValidatedProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const prop = await supabase.from("ai_proposals").select("*").eq("id", data.id).eq("user_id", userId).maybeSingle();
    if (prop.error || !prop.data) throw new Error("Proposta non trovata");
    if (prop.data.status !== "validated") throw new Error("Solo le proposte validate (PASS) possono essere applicate");

    const diff = (prop.data.param_diff ?? []) as ParamDiffEntry[];
    const patch: Record<string, unknown> = {};
    for (const e of diff) {
      if (!PROPOSABLE_FIELDS.includes(e.field as ProposableField)) continue;
      patch[e.field] = e.to;
    }
    if (Object.keys(patch).length === 0) throw new Error("param_diff vuoto");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upd = await supabase.from("settings").update(patch as any).eq("user_id", userId);
    if (upd.error) throw new Error(upd.error.message);

    await supabase.from("ai_proposals").update({
      status: "applied", applied_at: new Date().toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).eq("id", data.id);

    await supabase.from("events_log").insert({
      user_id: userId, component: "ai-proposals", level: "warning",
      message: `Proposta APPLICATA: ${prop.data.title}`,
      payload: { id: data.id, patch } as never,
    });
    return { ok: true };
  });

// ============== Validazione (interna) ==============

type ValidationOutcome = {
  status: "validated" | "validation_failed";
  kpis: {
    strategy: { totalReturnPct: number; cagr: number; maxDrawdownPct: number; sharpe: number; sortino: number; trades: number; winRatePct: number; profitFactor: number };
    btcBuyHold: { totalReturnPct: number; cagr: number; maxDrawdownPct: number; sharpe: number; sortino: number };
    btcDca: { totalReturnPct: number; cagr: number; maxDrawdownPct: number; sharpe: number; sortino: number };
  } | null;
  checks: {
    profitFactorOk: boolean;
    sharpeOk: boolean;
    beatsBtcSharpe: boolean;
    beatsBtcDrawdown: boolean;
    beatsDcaSharpe: boolean;
    beatsDcaDrawdown: boolean;
  } | null;
  reason?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runValidationInternal(supabase: any, userId: string, proposalId: string): Promise<ValidationOutcome> {
  const propRes = await supabase.from("ai_proposals").select("param_diff").eq("id", proposalId).maybeSingle();
  const diff = (propRes.data?.param_diff ?? []) as ParamDiffEntry[];

  const settingsRes = await supabase.from("settings").select("*").eq("user_id", userId).maybeSingle();
  const baseSettings = { ...(settingsRes.data ?? {}) };
  for (const e of diff) {
    if (PROPOSABLE_FIELDS.includes(e.field as ProposableField)) {
      (baseSettings as Record<string, unknown>)[e.field] = e.to;
    }
  }

  // Esegui validazione OOS riusando il backtest engine
  const { runOosValidation } = await import("./backtest-oos.server");
  let outcome: ValidationOutcome;
  try {
    const res = await runOosValidation({ supabase, userId, simulatedSettings: baseSettings });
    const checks = {
      profitFactorOk: res.strategy.profitFactor > 1.3,
      sharpeOk: res.strategy.sharpe > 0.8,
      beatsBtcSharpe: res.strategy.sharpe >= res.btcBuyHold.sharpe,
      beatsBtcDrawdown: Math.abs(res.strategy.maxDrawdownPct) <= Math.abs(res.btcBuyHold.maxDrawdownPct),
      beatsDcaSharpe: res.strategy.sharpe >= res.btcDca.sharpe,
      beatsDcaDrawdown: Math.abs(res.strategy.maxDrawdownPct) <= Math.abs(res.btcDca.maxDrawdownPct),
    };
    const pass = Object.values(checks).every(Boolean);
    outcome = {
      status: pass ? "validated" : "validation_failed",
      kpis: { strategy: res.strategy, btcBuyHold: res.btcBuyHold, btcDca: res.btcDca },
      checks,
    };
  } catch (e) {
    outcome = { status: "validation_failed", kpis: null, checks: null, reason: e instanceof Error ? e.message : String(e) };
  }

  const update: Record<string, unknown> = {
    status: outcome.status,
    validation_result: outcome,
    validated_at: new Date().toISOString(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from("ai_proposals").update(update as any).eq("id", proposalId);
  await supabase.from("events_log").insert({
    user_id: userId,
    component: "ai-proposals",
    level: outcome.status === "validated" ? "info" : "warning",
    message: `Validazione proposta: ${outcome.status === "validated" ? "PASS" : "FAIL"}`,
    payload: { id: proposalId, outcome } as never,
  });
  return outcome;
}
