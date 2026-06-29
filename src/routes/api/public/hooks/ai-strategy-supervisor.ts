// AI Supervisor v4: per ogni utente running, ogni ora
// Fase A (deterministica): aggiorna i 3 flag meccanici secondo REGOLE ESPLICITE.
//   - core_only_mode = ON  ⇔ BTC close < SMA200
//   - bear_dca_enabled = ON ⇔ macro=risk-off AND F&G < soglia
//   - exclude_fiat_commodity = sempre OFF: il satellite valuta tutto Kraken,
//     incluse azioni tokenizzate/xStocks, forex e commodity se liquide.
//   Ogni cambio → riga in ai_flag_changes + audit in events_log.
// Fase B (AI osserva e propone): genera report "investment officer" + eventuali
//   proposte di modifica parametri (status=pending). MAI applicate in automatico.
import { createFileRoute } from "@tanstack/react-router";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/assistant/ai-gateway.server";

// Whitelist parametri proponibili (tutte colonne di public.settings)
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

// NOTE: Gemini structured-output rejects schemas with too many states.
// Keep types only — validate ranges in code after parsing.
const ProposalSchema = z.object({
  title: z.string(),
  rationale: z.string(),
  param_diff: z.array(z.object({
    field: z.enum(PROPOSABLE_FIELDS),
    from: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    to: z.union([z.string(), z.number(), z.boolean()]),
  })),
});

const ReportSchema = z.object({
  narrative: z.string(),
  anomalies: z.array(z.string()),
  proposals: z.array(ProposalSchema),
});
type ReportT = z.infer<typeof ReportSchema>;

const SYSTEM_PROMPT = `Sei l'AI Supervisor di un bot Kraken multi-asset (strategia v4 Core-Led + Satellite + Bear-DCA).
Scrivi un report in italiano stile "investment officer": chiaro, sobrio, con numeri.
NON applichi nulla. OSSERVI e, se necessario, PROPONI modifiche che andranno approvate dall'utente e validate out-of-sample.

LINEE GUIDA:
- "narrative": 3-6 frasi su mercato, performance, cosa funziona / cosa no.
- "anomalies": elenco breve di cose insolite (PF in calo, fee elevate, drawdown anomalo, ecc.).
- "proposals": SOLO se hai un motivo concreto e supportato da dati. Massimo 0-2 proposte.
- Modifiche permesse: ${PROPOSABLE_FIELDS.join(", ")}.
- Niente proposte vaghe: ogni proposta ha titolo, motivazione e param_diff esatto.
- "Status quo" è spesso la scelta corretta. Se non hai proposte, lascia l'array vuoto.

NON proporre mai di cambiare modalità (paper/live), capitale, kill-switch, o i 3 flag automatici (sono gestiti da regole deterministiche).
Regola fissa: exclude_fiat_commodity resta OFF perché la strategia deve valutare anche token azionari/xStocks, forex e commodity presenti su Kraken; non suggerire di riattivarlo.`;

export const Route = createFileRoute("/api/public/hooks/ai-strategy-supervisor")({
  server: {
    handlers: {
      POST: async () => {
        const cronKey = process.env.LOVABLE_API_KEY;
        if (!cronKey) return Response.json({ ok: false, error: "Missing LOVABLE_API_KEY" }, { status: 500 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: users, error: usersErr } = await supabaseAdmin
          .from("settings")
          .select("user_id,strategy_preset,core_only_mode,bear_dca_enabled,exclude_fiat_commodity,ai_bear_dca_fg_threshold,kill_switch_floor,capital_reference")
          .eq("is_running", true);
        if (usersErr) return Response.json({ ok: false, error: usersErr.message }, { status: 500 });

        const gateway = createLovableAiGatewayProvider(cronKey);
        const model = gateway("google/gemini-3-flash-preview");
        const results: Array<Record<string, unknown>> = [];

        for (const u of users ?? []) {
          try {
            const userId = u.user_id as string;
            const preset = (u.strategy_preset ?? "balanced") as string;
            const fgThreshold = Number(u.ai_bear_dca_fg_threshold ?? 25);

            // ===== Carica dati =====
            const [diagRes, snapsRes, closedRes, feesRes] = await Promise.all([
              supabaseAdmin.from("engine_diagnostics").select("macro_regime,meso_regime,fg_value,fg_label,btc_last,btc_sma200,btc_sma50,bear_dca_state").eq("user_id", userId).maybeSingle(),
              supabaseAdmin.from("portfolio_snapshots").select("ts,total_value").eq("user_id", userId).gte("ts", new Date(Date.now() - 30 * 86400_000).toISOString()).order("ts", { ascending: true }),
              supabaseAdmin.from("positions").select("pnl,closed_at,asset").eq("user_id", userId).eq("status", "closed").gte("closed_at", new Date(Date.now() - 30 * 86400_000).toISOString()),
              supabaseAdmin.from("trade_fees").select("fee_cents").eq("user_id", userId).gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString()),
            ]);

            const diag = diagRes.data;
            const btcLast = diag?.btc_last ? Number(diag.btc_last) : null;
            const sma200 = diag?.btc_sma200 ? Number(diag.btc_sma200) : null;
            const fgValue = diag?.fg_value != null ? Number(diag.fg_value) : null;
            const macro = (diag?.macro_regime ?? "unknown") as string;

            // ===== Fase A — Regole deterministiche =====
            const ruleCore = btcLast != null && sma200 != null
              ? { rule: btcLast < sma200 ? "BTC<SMA200 → core-only" : "BTC≥SMA200 → satellite armato", value: btcLast < sma200, inputs: { btc_last: btcLast, sma200 } }
              : null;
            const ruleBear = fgValue != null
              ? {
                  rule: (macro === "risk-off" && fgValue < fgThreshold)
                    ? `macro=risk-off AND F&G<${fgThreshold}`
                    : `macro=${macro} / F&G=${fgValue} ≥ ${fgThreshold}`,
                  value: macro === "risk-off" && fgValue < fgThreshold,
                  inputs: { macro_regime: macro, fg_value: fgValue, threshold: fgThreshold },
                }
              : null;
            const ruleExFiat = { rule: "Sempre OFF: includi tutto Kraken multi-asset (xStocks/token azionari, forex, commodity) se supera liquidità/spread", value: false, inputs: { preset } };

            const desired = {
              core_only_mode: ruleCore?.value ?? !!u.core_only_mode,
              bear_dca_enabled: ruleBear?.value ?? !!u.bear_dca_enabled,
              exclude_fiat_commodity: false,
            };
            const current = {
              core_only_mode: !!u.core_only_mode,
              bear_dca_enabled: !!u.bear_dca_enabled,
              exclude_fiat_commodity: !!u.exclude_fiat_commodity,
            };

            const flagChanges: Array<{ flag: string; from: boolean; to: boolean; rule: string; inputs: Record<string, unknown> }> = [];
            if (ruleCore && desired.core_only_mode !== current.core_only_mode) {
              flagChanges.push({ flag: "core_only_mode", from: current.core_only_mode, to: desired.core_only_mode, rule: ruleCore.rule, inputs: ruleCore.inputs });
            }
            if (ruleBear && desired.bear_dca_enabled !== current.bear_dca_enabled) {
              flagChanges.push({ flag: "bear_dca_enabled", from: current.bear_dca_enabled, to: desired.bear_dca_enabled, rule: ruleBear.rule, inputs: ruleBear.inputs });
            }
            if (desired.exclude_fiat_commodity !== current.exclude_fiat_commodity) {
              flagChanges.push({ flag: "exclude_fiat_commodity", from: current.exclude_fiat_commodity, to: false, rule: ruleExFiat.rule, inputs: ruleExFiat.inputs });
            }

            if (flagChanges.length > 0) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await supabaseAdmin.from("settings").update({
                core_only_mode: desired.core_only_mode,
                bear_dca_enabled: desired.bear_dca_enabled,
                exclude_fiat_commodity: desired.exclude_fiat_commodity,
                ai_supervisor_state: {
                  last_run_at: new Date().toISOString(),
                  last_decision: desired,
                  reasoning: ruleExFiat.rule,
                  confidence: "high",
                  changed_flags: flagChanges.map((c) => c.flag),
                },
              } as any).eq("user_id", userId);
              await supabaseAdmin.from("ai_flag_changes").insert(flagChanges.map((c) => ({
                user_id: userId,
                flag: c.flag,
                from_value: c.from,
                to_value: c.to,
                rule_triggered: c.rule,
                inputs: c.inputs,
              })) as never);
              await supabaseAdmin.from("events_log").insert({
                user_id: userId,
                component: "ai-supervisor",
                level: "info",
                message: `Flag aggiornati (regole deterministiche): ${flagChanges.map((c) => `${c.flag}=${c.to ? "ON" : "OFF"}`).join(", ")}`,
                payload: { changes: flagChanges } as never,
              });
            } else {
              await supabaseAdmin.from("settings").update({
                ai_supervisor_state: {
                  last_run_at: new Date().toISOString(),
                  last_decision: desired,
                  reasoning: ruleExFiat.rule,
                  confidence: "high",
                  changed_flags: [],
                },
              } as any).eq("user_id", userId);
            }

            // ===== KPI snapshot =====
            const snaps = (snapsRes.data ?? []) as Array<{ total_value: number }>;
            let dd30 = 0;
            if (snaps.length > 1) {
              let peak = snaps[0].total_value;
              for (const s of snaps) {
                peak = Math.max(peak, s.total_value);
                const dd = (s.total_value - peak) / peak;
                if (dd < dd30) dd30 = dd;
              }
            }
            const closed = (closedRes.data ?? []) as Array<{ pnl: number | null }>;
            const wins = closed.filter((c) => Number(c.pnl ?? 0) > 0);
            const losses = closed.filter((c) => Number(c.pnl ?? 0) <= 0);
            const gross = wins.reduce((s, t) => s + Number(t.pnl ?? 0), 0);
            const lossSum = -losses.reduce((s, t) => s + Number(t.pnl ?? 0), 0);
            const profitFactor = lossSum > 0 ? gross / lossSum : wins.length > 0 ? 99 : 0;
            const totalPnl = closed.reduce((s, t) => s + Number(t.pnl ?? 0), 0);
            const fees30d = ((feesRes.data ?? []) as Array<{ fee_cents: number | null }>).reduce((s, r) => s + Number(r.fee_cents ?? 0) / 100, 0);

            const marketSnapshot = {
              macro_regime: macro,
              meso_regime: diag?.meso_regime ?? "unknown",
              fg_value: fgValue,
              fg_label: diag?.fg_label ?? null,
              btc_last: btcLast,
              btc_sma200: sma200,
              btc_vs_sma200_pct: btcLast && sma200 ? Number((((btcLast - sma200) / sma200) * 100).toFixed(2)) : null,
            };
            const selfSnapshot = {
              preset,
              flags: desired,
              closed_trades_30d: closed.length,
              win_rate_30d_pct: closed.length > 0 ? Number(((wins.length / closed.length) * 100).toFixed(1)) : null,
              profit_factor_30d: Number(profitFactor.toFixed(2)),
              realized_pnl_30d_usd: Number(totalPnl.toFixed(2)),
              drawdown_30d_pct: Number((dd30 * 100).toFixed(2)),
              fees_paid_30d_usd: Number(fees30d.toFixed(2)),
            };

            // ===== Fase B — Report + proposte =====
            const { experimental_output: report } = await generateText({
              model,
              system: SYSTEM_PROMPT,
              prompt: `MERCATO:\n${JSON.stringify(marketSnapshot, null, 2)}\n\nBOT (ultimi 30g):\n${JSON.stringify(selfSnapshot, null, 2)}\n\nFlag (decisi da regole):\n${JSON.stringify(desired, null, 2)}\n\nGenera il report e, se opportuno, proposte di modifica parametri.`,
              experimental_output: Output.object({ schema: ReportSchema }),
            }) as { experimental_output: ReportT };

            const { data: reportRow, error: reportErr } = await supabaseAdmin
              .from("ai_reports")
              .insert({
                user_id: userId,
                period: "hourly",
                market_snapshot: marketSnapshot as never,
                self_snapshot: selfSnapshot as never,
                narrative: report.narrative,
                anomalies: report.anomalies as never,
              })
              .select("id")
              .single();
            if (reportErr) throw new Error(reportErr.message);

            const proposalIds: string[] = [];
            for (const p of report.proposals) {
              const { data: propRow } = await supabaseAdmin
                .from("ai_proposals")
                .insert({
                  user_id: userId,
                  report_id: reportRow.id,
                  title: p.title,
                  rationale: p.rationale,
                  param_diff: p.param_diff as never,
                  status: "pending",
                })
                .select("id")
                .single();
              if (propRow) proposalIds.push(propRow.id as string);
            }
            if (proposalIds.length > 0) {
              await supabaseAdmin.from("ai_reports").update({ proposals_generated: proposalIds as never }).eq("id", reportRow.id);
              await supabaseAdmin.from("events_log").insert({
                user_id: userId,
                component: "ai-supervisor",
                level: "info",
                message: `AI ha generato ${proposalIds.length} proposta/e in attesa di approvazione`,
                payload: { report_id: reportRow.id, proposals: proposalIds } as never,
              });
              const { notifyTelegram } = await import("@/lib/assistant/telegram.server");
              await notifyTelegram(`🧠 AI Supervisor: ${proposalIds.length} nuova/e proposta/e. Apri "Proposte" per rivedere.`);
            }

            results.push({ user_id: userId, ok: true, flag_changes: flagChanges.length, proposals: proposalIds.length });
          } catch (e) {
            results.push({ user_id: u.user_id, ok: false, error: e instanceof Error ? e.message : String(e) });
          }
        }

        return Response.json({ ok: true, processed: results.length, results });
      },
    },
  },
});
