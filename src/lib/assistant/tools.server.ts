// Server-only: AI SDK tools backed by the user's Supabase session.
import { tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { notifyTelegram } from "./telegram.server";

type DB = SupabaseClient<Database>;

async function logEvent(
  supabase: DB,
  userId: string,
  level: "info" | "warn" | "error",
  message: string,
) {
  await supabase.from("events_log").insert({
    user_id: userId,
    component: "assistant",
    level,
    message,
  });
}

export function buildAssistantTools(supabase: DB, userId: string) {
  return {
    // -------------------- READ TOOLS --------------------
    getSettings: tool({
      description: "Restituisce le impostazioni correnti del bot: parametri di rischio, modalità, on/off, fonti sentiment.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await supabase.from("settings").select("*").maybeSingle();
        if (error) throw new Error(error.message);
        return data ?? {};
      },
    }),

    getOpenPositions: tool({
      description: "Restituisce tutte le posizioni attualmente aperte con prezzo di ingresso, prezzo corrente, quantità, stop e trailing.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await supabase
          .from("positions")
          .select("id,asset,side,qty,entry_price,current_price,entry_value,stop_price,trailing_high,opened_at,mode,open_reason")
          .eq("status", "open")
          .order("opened_at", { ascending: false });
        if (error) throw new Error(error.message);
        return data ?? [];
      },
    }),

    getClosedPositions: tool({
      description: "Restituisce le ultime posizioni chiuse con P/L, motivo di uscita e durata.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
      execute: async ({ limit }) => {
        const { data, error } = await supabase
          .from("positions")
          .select("asset,entry_price,exit_price,pnl,pnl_pct,exit_reason,opened_at,closed_at,mode")
          .eq("status", "closed")
          .order("closed_at", { ascending: false })
          .limit(limit);
        if (error) throw new Error(error.message);
        return data ?? [];
      },
    }),

    getRecentEvents: tool({
      description: "Ultimi eventi dal log del bot (errori, decisioni, azioni eseguite). Utile per diagnosi.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(20) }),
      execute: async ({ limit }) => {
        const { data, error } = await supabase
          .from("events_log")
          .select("ts,level,component,message")
          .order("ts", { ascending: false })
          .limit(limit);
        if (error) throw new Error(error.message);
        return data ?? [];
      },
    }),

    getLatestSentiment: tool({
      description: "Ultimo snapshot di sentiment per ciascuna fonte attiva (Fear&Greed, LunarCrush, Santiment, news).",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await supabase
          .from("sentiment_snapshots")
          .select("source,scope,score,raw,ts")
          .order("ts", { ascending: false })
          .limit(40);
        if (error) throw new Error(error.message);
        // tieni solo il più recente per (source, scope)
        const seen = new Set<string>();
        const dedup: typeof data = [];
        for (const r of data ?? []) {
          const k = `${r.source}|${r.scope}`;
          if (seen.has(k)) continue;
          seen.add(k);
          dedup.push(r);
        }
        return dedup;
      },
    }),

    getPortfolio: tool({
      description: "Ultimi snapshot di equity del portafoglio (per disegnare la curva o calcolare delta).",
      inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
      execute: async ({ limit }) => {
        const { data, error } = await supabase
          .from("portfolio_snapshots")
          .select("ts,total_value,cash_value,positions_value,realized_pnl,unrealized_pnl")
          .order("ts", { ascending: false })
          .limit(limit);
        if (error) throw new Error(error.message);
        return data ?? [];
      },
    }),

    // -------------------- WRITE TOOLS --------------------
    updateRiskSettings: tool({
      description: "Modifica uno o più parametri di rischio. Passa SOLO i campi da cambiare. Prima di chiamarlo devi spiegare in chat cosa stai per cambiare e perché, e attendere conferma esplicita dell'utente.",
      inputSchema: z.object({
        capital_reference: z.number().positive().optional(),
        kill_switch_floor: z.number().positive().optional(),
        max_positions: z.number().int().min(1).max(20).optional(),
        max_position_pct: z.number().min(1).max(100).optional(),
        stop_loss_pct: z.number().min(0.1).max(50).optional(),
        trailing_activate_pct: z.number().min(0).max(50).optional(),
        trailing_gap_pct: z.number().min(0.1).max(50).optional(),
        take_profit_pct: z.number().min(0.1).max(100).optional(),
        min_target_pct: z.number().min(0).max(50).optional(),
        daily_loss_limit_pct: z.number().min(0.1).max(50).optional(),
        timeframe: z.enum(["15m", "30m", "1h", "2h", "4h", "1d"]).optional(),
      }),
      execute: async (patch) => {
        const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
        if (entries.length === 0) return { ok: false, error: "Nessun campo da aggiornare." };
        const update = Object.fromEntries(entries);
        const { data, error } = await supabase
          .from("settings")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update(update as any)
          .eq("user_id", userId)
          .select("*")
          .maybeSingle();
        if (error) return { ok: false, error: error.message };
        const summary = entries.map(([k, v]) => `${k}=${v}`).join(", ");
        await logEvent(supabase, userId, "info", `Assistente: aggiornati parametri rischio (${summary})`);
        await notifyTelegram(`🛠️ [PAPER] Assistente: aggiornati parametri rischio\n${summary}`);
        return { ok: true, updated: data };
      },
    }),

    updateSentimentSettings: tool({
      description: "Modifica le fonti sentiment attive e/o i loro pesi. Chiavi valide: fear_greed, lunarcrush, santiment, news.",
      inputSchema: z.object({
        enabled: z
          .object({
            fear_greed: z.boolean().optional(),
            lunarcrush: z.boolean().optional(),
            santiment: z.boolean().optional(),
            news: z.boolean().optional(),
          })
          .optional(),
        weights: z
          .object({
            fear_greed: z.number().min(0).max(3).optional(),
            lunarcrush: z.number().min(0).max(3).optional(),
            santiment: z.number().min(0).max(3).optional(),
            news: z.number().min(0).max(3).optional(),
          })
          .optional(),
      }),
      execute: async ({ enabled, weights }) => {
        const { data: current, error: e1 } = await supabase
          .from("settings")
          .select("id,enabled_sentiment_sources,sentiment_weights")
          .eq("user_id", userId)
          .maybeSingle();
        if (e1 || !current) return { ok: false, error: e1?.message ?? "Settings non trovate" };
        const nextEnabled = { ...(current.enabled_sentiment_sources as Record<string, boolean>), ...(enabled ?? {}) };
        const nextWeights = { ...(current.sentiment_weights as Record<string, number>), ...(weights ?? {}) };
        const { error } = await supabase
          .from("settings")
          .update({ enabled_sentiment_sources: nextEnabled, sentiment_weights: nextWeights })
          .eq("id", current.id);
        if (error) return { ok: false, error: error.message };
        const parts: string[] = [];
        if (enabled) parts.push(`enabled=${JSON.stringify(enabled)}`);
        if (weights) parts.push(`weights=${JSON.stringify(weights)}`);
        await logEvent(supabase, userId, "info", `Assistente: sentiment ${parts.join(" ")}`);
        await notifyTelegram(`🛠️ [PAPER] Assistente: aggiornato sentiment\n${parts.join("\n")}`);
        return { ok: true, enabled: nextEnabled, weights: nextWeights };
      },
    }),

    setBotRunning: tool({
      description: "Accende o spegne il motore di trading (toggle is_running).",
      inputSchema: z.object({ running: z.boolean() }),
      execute: async ({ running }) => {
        const { error } = await supabase
          .from("settings")
          .update({ is_running: running })
          .eq("user_id", userId);
        if (error) return { ok: false, error: error.message };
        await logEvent(supabase, userId, "info", `Assistente: bot ${running ? "AVVIATO" : "FERMATO"}`);
        await notifyTelegram(`${running ? "▶️" : "⏸️"} [PAPER] Assistente: bot ${running ? "AVVIATO" : "FERMATO"}`);
        return { ok: true, running };
      },
    }),

    setBotMode: tool({
      description: "Cambia modalità del bot tra 'paper' e 'live'. NB: 'live' è disabilitato nella Fase 1 e verrà rifiutato.",
      inputSchema: z.object({ mode: z.enum(["paper", "live"]) }),
      execute: async ({ mode }) => {
        if (mode === "live") {
          return { ok: false, error: "Modalità LIVE non abilitata in Fase 1. Disponibile dopo i criteri di successo paper." };
        }
        const { error } = await supabase
          .from("settings")
          .update({ mode })
          .eq("user_id", userId);
        if (error) return { ok: false, error: error.message };
        await logEvent(supabase, userId, "info", `Assistente: modalità → ${mode}`);
        return { ok: true, mode };
      },
    }),

    closePosition: tool({
      description: "Chiude manualmente una posizione PAPER aperta. Richiede l'ID esatto (UUID) della posizione.",
      inputSchema: z.object({
        position_id: z.string().uuid(),
        reason: z.string().min(3).max(200).default("Chiusura manuale da assistente"),
      }),
      execute: async ({ position_id, reason }) => {
        const { data: pos, error: e1 } = await supabase
          .from("positions")
          .select("id,asset,qty,entry_price,current_price,entry_value,mode,status,opened_at")
          .eq("id", position_id)
          .maybeSingle();
        if (e1 || !pos) return { ok: false, error: e1?.message ?? "Posizione non trovata" };
        if (pos.status !== "open") return { ok: false, error: "Posizione già chiusa" };
        if (pos.mode !== "paper") return { ok: false, error: "Solo posizioni PAPER chiudibili dall'assistente" };
        const exit_price = pos.current_price ?? pos.entry_price;
        const exit_value = exit_price * pos.qty;
        const pnl = exit_value - pos.entry_value;
        const pnl_pct = pos.entry_value > 0 ? (pnl / pos.entry_value) * 100 : 0;
        const { error: e2 } = await supabase
          .from("positions")
          .update({
            status: "closed",
            exit_price,
            exit_value,
            pnl,
            pnl_pct,
            exit_reason: reason,
            closed_at: new Date().toISOString(),
          })
          .eq("id", position_id);
        if (e2) return { ok: false, error: e2.message };
        await logEvent(supabase, userId, "info", `Assistente: chiusa ${pos.asset} pnl=${pnl.toFixed(2)} (${reason})`);
        await notifyTelegram(
          `✋ [PAPER] Assistente: chiusura manuale ${pos.asset}\nP/L: ${pnl.toFixed(2)} USD (${pnl_pct.toFixed(2)}%)\nMotivo: ${reason}`,
        );
        return { ok: true, pnl, pnl_pct, exit_price };
      },
    }),
  };
}
