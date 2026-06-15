// Server functions for Telegram notifications (test + future automated alerts).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const sendTelegramTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chat = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chat) {
      const missing = [!token && "TELEGRAM_BOT_TOKEN", !chat && "TELEGRAM_CHAT_ID"]
        .filter(Boolean)
        .join(", ");
      return { ok: false as const, error: `Secret mancanti: ${missing}` };
    }

    const text = `🧪 <b>Test TradingBot</b>\nMessaggio di prova inviato il ${new Date().toLocaleString("it-IT")}`;

    let ok = false;
    let errorMsg: string | undefined;
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chat,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });
      const json = (await res.json()) as { ok: boolean; description?: string };
      ok = json.ok === true;
      if (!ok) errorMsg = json.description ?? `HTTP ${res.status}`;
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    }

    // Log to events_log (best effort)
    await context.supabase.from("events_log").insert({
      user_id: context.userId,
      level: ok ? "info" : "error",
      component: "telegram",
      message: ok ? "Test Telegram inviato" : `Test Telegram fallito: ${errorMsg}`,
    });

    return ok
      ? { ok: true as const }
      : { ok: false as const, error: errorMsg ?? "Errore sconosciuto" };
  });
