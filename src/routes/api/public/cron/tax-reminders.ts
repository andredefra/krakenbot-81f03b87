// Daily cron: sends Telegram reminders for upcoming Italian tax deadlines
// at T-30, T-7, and T-1 days. Idempotent via tax_reminders_sent table.

import { createFileRoute } from "@tanstack/react-router";
import { getItalianDeadlines } from "@/lib/tax/it";

const OFFSETS = [30, 7, 1];

function eur(cents: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(cents / 100);
}

async function sendTelegram(token: string, chatId: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
}

export const Route = createFileRoute("/api/public/cron/tax-reminders")({
  server: {
    handlers: {
      POST: async () => {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        if (!token || !chatId) {
          return Response.json({ ok: false, error: "Telegram not configured" }, { status: 200 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const today = new Date();
        const deadlines = getItalianDeadlines(today);

        // Load all users that have a settings row (so reminders are per-user)
        const { data: usersR, error: usersErr } = await supabaseAdmin
          .from("settings")
          .select("user_id,tax_country,tax_reserve_cents,loss_carryforward_cents,is_running")
          .eq("is_running", true);
        if (usersErr) return Response.json({ ok: false, error: usersErr.message }, { status: 500 });

        // Hard kill-switch: nessun utente in running → return immediato.
        if (!usersR || usersR.length === 0) {
          return Response.json({ ok: true, skipped: "no users with is_running=true" });
        }

        let sent = 0;

        for (const user of usersR ?? []) {
          if (user.tax_country && user.tax_country !== "IT") continue;

          // Compute realized live gains YTD for context line
          const yearStart = `${today.getFullYear()}-01-01`;
          const yearEnd = `${today.getFullYear() + 1}-01-01`;
          const { data: posR } = await supabaseAdmin
            .from("positions")
            .select("pnl")
            .eq("user_id", user.user_id)
            .eq("mode", "live")
            .eq("status", "closed")
            .gte("closed_at", yearStart)
            .lt("closed_at", yearEnd);
          const realizedCents = (posR ?? []).reduce(
            (s, p) => s + Math.round(Number(p.pnl ?? 0) * 100),
            0,
          );
          const taxableCents = Math.max(0, realizedCents - (user.loss_carryforward_cents ?? 0));
          const dueCents = Math.round((taxableCents * 2600) / 10000);
          const reserveCents = user.tax_reserve_cents ?? 0;
          const coverage = dueCents > 0 ? Math.min(100, Math.round((reserveCents / dueCents) * 100)) : 100;

          for (const d of deadlines) {
            const daysLeft = Math.ceil(
              (new Date(d.date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
            );
            const offset = OFFSETS.find((o) => o === daysLeft);
            if (!offset) continue;

            // Idempotency check
            const { data: existing } = await supabaseAdmin
              .from("tax_reminders_sent")
              .select("id")
              .eq("user_id", user.user_id)
              .eq("deadline_id", d.id)
              .eq("days_offset", offset)
              .maybeSingle();
            if (existing) continue;

            const text =
              `⏰ <b>Promemoria fiscale IT</b>\n` +
              `<b>${d.label}</b>\n` +
              `📅 ${d.date} — tra <b>${offset} ${offset === 1 ? "giorno" : "giorni"}</b>\n\n` +
              `${d.description}\n\n` +
              `<b>Stato anno ${today.getFullYear()} (Live):</b>\n` +
              `• Plusvalenze realizzate: ${eur(realizedCents)}\n` +
              `• Imposta dovuta (26%): ${eur(dueCents)}\n` +
              `• Riserva accantonata: ${eur(reserveCents)} (${coverage}%)`;

            try {
              await sendTelegram(token, chatId, text);
              await supabaseAdmin.from("tax_reminders_sent").insert({
                user_id: user.user_id,
                deadline_id: d.id,
                days_offset: offset,
              });
              sent++;
            } catch (err) {
              console.error("[tax-reminders]", err);
            }
          }
        }

        return Response.json({ ok: true, sent, deadlines: deadlines.length });
      },
    },
  },
});
