// AI Supervisor: every hour, decides for each running user whether to flip
// core_only_mode / bear_dca_enabled / exclude_fiat_commodity flags based on
// the active preset (conservative/balanced/aggressive) + current market state.
// Public route — pg_cron calls it hourly. Uses service-role admin client.
import { createFileRoute } from "@tanstack/react-router";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/assistant/ai-gateway.server";

const Decision = z.object({
  core_only_mode: z.boolean(),
  bear_dca_enabled: z.boolean(),
  exclude_fiat_commodity: z.boolean(),
  reasoning: z.string().min(10).max(800),
  confidence: z.enum(["low", "medium", "high"]),
});
type DecisionT = z.infer<typeof Decision>;

const SUPERVISOR_PROMPT = `Sei l'AI Supervisor di un trading bot crypto Kraken (strategia v3 Core-Led + Satellite + Bear-DCA).
Ogni ora decidi 3 flag strategici per un utente, basandoti sul suo PRESET attivo + condizioni di mercato live.

I 3 FLAG:
- core_only_mode: spegne il satellite, tiene solo Core BTC/ETH.
- bear_dca_enabled: accumula tranche BTC quando macro=risk-off e F&G<soglia.
- exclude_fiat_commodity: esclude ZEUR/USDT/USDC/PAXG/XAUT/EURT dal satellite.

BASELINE PER PRESET (rispetta salvo deviazioni motivate):
- CONSERVATIVE: bear_dca=ON sempre, exclude_fiat=ON; core_only=ON se drawdown 30g>15% o F&G>80 (euforia).
- BALANCED: bear_dca=ON, exclude_fiat=ON; core_only=ON solo se drawdown>20% o F&G>85.
- AGGRESSIVE: bear_dca=ON solo se F&G<30; exclude_fiat=OFF (cerca alpha ovunque); core_only=OFF salvo emergenze (drawdown>25% o killswitch vicino).

REGOLE TRASVERSALI:
- Se macro=risk-off + F&G<25 (deep fear): bear_dca DEVE essere ON indipendentemente dal preset (asimmetria favorevole).
- Se macro=risk-on stabile da settimane + F&G normale (30-70): core_only sempre OFF, lascia respirare il satellite.
- Cambia un flag solo se hai un motivo concreto. "Status quo" è spesso la scelta migliore.

Rispondi SOLO con JSON valido. reasoning = 1-2 frasi tecniche in italiano. confidence = "high" se baseline + dati coerenti, "medium" se devii, "low" se dati incompleti.`;

export const Route = createFileRoute("/api/public/hooks/ai-strategy-supervisor")({
  server: {
    handlers: {
      POST: async () => {
        const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        const cronKey = process.env.LOVABLE_API_KEY;
        if (!apiKey || !cronKey) {
          return Response.json({ ok: false, error: "Missing env" }, { status: 500 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Fetch all running users
        const { data: users, error: usersErr } = await supabaseAdmin
          .from("settings")
          .select("user_id,strategy_preset,core_only_mode,bear_dca_enabled,exclude_fiat_commodity,bear_dca_fg_threshold,kill_switch_floor,capital_reference")
          .eq("is_running", true);
        if (usersErr) return Response.json({ ok: false, error: usersErr.message }, { status: 500 });

        const gateway = createLovableAiGatewayProvider(cronKey);
        const model = gateway("google/gemini-3-flash-preview");
        const results: Array<Record<string, unknown>> = [];

        for (const u of users ?? []) {
          try {
            const userId = u.user_id as string;
            const preset = (u.strategy_preset ?? "balanced") as string;
            const current = {
              core_only_mode: !!u.core_only_mode,
              bear_dca_enabled: !!u.bear_dca_enabled,
              exclude_fiat_commodity: !!u.exclude_fiat_commodity,
            };

            // Load diagnostics + recent perf
            const [diagRes, snapsRes, closedRes] = await Promise.all([
              supabaseAdmin.from("engine_diagnostics").select("macro_regime,meso_regime,fg_value,fg_label,btc_last,btc_sma200,btc_sma50,cycle_at,bear_dca_state").eq("user_id", userId).maybeSingle(),
              supabaseAdmin.from("portfolio_snapshots").select("ts,total_value").eq("user_id", userId).gte("ts", new Date(Date.now() - 30 * 86400_000).toISOString()).order("ts", { ascending: true }),
              supabaseAdmin.from("positions").select("pnl,closed_at").eq("user_id", userId).eq("status", "closed").gte("closed_at", new Date(Date.now() - 30 * 86400_000).toISOString()),
            ]);

            // Compute drawdown 30g
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
            const wins = closed.filter((c) => Number(c.pnl ?? 0) > 0).length;
            const winRate = closed.length > 0 ? (wins / closed.length) * 100 : null;

            const context = {
              preset,
              current_flags: current,
              macro_regime: diagRes.data?.macro_regime ?? "unknown",
              meso_regime: diagRes.data?.meso_regime ?? "unknown",
              fg_value: diagRes.data?.fg_value ?? null,
              fg_label: diagRes.data?.fg_label ?? null,
              btc_vs_sma200_pct: diagRes.data?.btc_last && diagRes.data?.btc_sma200 ? ((Number(diagRes.data.btc_last) - Number(diagRes.data.btc_sma200)) / Number(diagRes.data.btc_sma200)) * 100 : null,
              btc_vs_sma50_pct: diagRes.data?.btc_last && diagRes.data?.btc_sma50 ? ((Number(diagRes.data.btc_last) - Number(diagRes.data.btc_sma50)) / Number(diagRes.data.btc_sma50)) * 100 : null,
              drawdown_30d_pct: Number((dd30 * 100).toFixed(2)),
              closed_trades_30d: closed.length,
              win_rate_30d_pct: winRate != null ? Number(winRate.toFixed(1)) : null,
              capital_vs_killswitch_pct: u.kill_switch_floor && u.capital_reference ? ((Number(u.capital_reference) - Number(u.kill_switch_floor)) / Number(u.capital_reference)) * 100 : null,
            };

            const { experimental_output: decision } = await generateText({
              model,
              system: SUPERVISOR_PROMPT,
              prompt: `Contesto live:\n${JSON.stringify(context, null, 2)}\n\nDecidi i 3 flag.`,
              experimental_output: Output.object({ schema: Decision }),
            }) as { experimental_output: DecisionT };

            const changed: string[] = [];
            if (decision.core_only_mode !== current.core_only_mode) changed.push("core_only_mode");
            if (decision.bear_dca_enabled !== current.bear_dca_enabled) changed.push("bear_dca_enabled");
            if (decision.exclude_fiat_commodity !== current.exclude_fiat_commodity) changed.push("exclude_fiat_commodity");

            const ai_supervisor_state = {
              last_run_at: new Date().toISOString(),
              last_decision: {
                core_only_mode: decision.core_only_mode,
                bear_dca_enabled: decision.bear_dca_enabled,
                exclude_fiat_commodity: decision.exclude_fiat_commodity,
              },
              reasoning: decision.reasoning,
              confidence: decision.confidence,
              changed_flags: changed,
              context_snapshot: context,
            };

            const patch: Record<string, unknown> = { ai_supervisor_state };
            if (changed.length > 0) {
              patch.core_only_mode = decision.core_only_mode;
              patch.bear_dca_enabled = decision.bear_dca_enabled;
              patch.exclude_fiat_commodity = decision.exclude_fiat_commodity;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await supabaseAdmin.from("settings").update(patch as any).eq("user_id", userId);

            // Log
            await supabaseAdmin.from("events_log").insert({
              user_id: userId,
              component: "ai-supervisor",
              level: "info",
              message: changed.length === 0
                ? `Nessun cambio (${decision.confidence}) — ${decision.reasoning.slice(0, 200)}`
                : `Cambiati ${changed.join(", ")} (${decision.confidence}) — ${decision.reasoning.slice(0, 200)}`,
              payload: { decision: ai_supervisor_state.last_decision, changed, preset } as never,
            });

            // Telegram only on actual changes
            if (changed.length > 0) {
              const { notifyTelegram } = await import("@/lib/assistant/telegram.server");
              const lines = changed.map((k) => {
                const was = (current as Record<string, boolean>)[k] ? "ON" : "OFF";
                const now = (decision as unknown as Record<string, boolean>)[k] ? "ON" : "OFF";
                return `• ${k}: ${was} → ${now}`;
              }).join("\n");
              await notifyTelegram(`🤖 AI Supervisor (preset: ${preset})\n${lines}\nMotivo: ${decision.reasoning}`);
            }

            results.push({ user_id: userId, ok: true, changed, confidence: decision.confidence });
          } catch (e) {
            results.push({ user_id: u.user_id, ok: false, error: e instanceof Error ? e.message : String(e) });
          }
        }

        return Response.json({ ok: true, processed: results.length, results });
      },
    },
  },
});
