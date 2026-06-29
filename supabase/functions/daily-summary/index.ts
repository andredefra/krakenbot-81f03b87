// Edge Function: daily-summary
// Costruisce e invia il riepilogo giornaliero su Telegram per ogni utente con is_running=true.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendTelegram, fmtDailySummary } from "../_shared/telegram.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supa = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });

  try {
    const { data: users } = await supa.from("settings").select("user_id,mode,is_running,capital_reference");
    let sent = 0;

    for (const s of users ?? []) {
      if (!s.is_running) continue;
      const userId = s.user_id;

      const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

      // ultimi snapshot
      const { data: latestSnap } = await supa
        .from("portfolio_snapshots")
        .select("total_value,ts")
        .eq("user_id", userId)
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: dayStartSnap } = await supa
        .from("portfolio_snapshots")
        .select("total_value")
        .eq("user_id", userId)
        .gte("ts", dayStart)
        .order("ts", { ascending: true })
        .limit(1)
        .maybeSingle();

      const portfolioTotal = Number(latestSnap?.total_value ?? s.capital_reference);
      const dayDelta = dayStartSnap ? portfolioTotal - Number(dayStartSnap.total_value) : 0;

      // posizioni aperte
      const { data: openPos } = await supa
        .from("positions")
        .select("asset,entry_value,qty,current_price,entry_price")
        .eq("user_id", userId)
        .eq("status", "open");
      let unrealizedTotal = 0;
      const openLines = (openPos ?? []).map((p) => {
        const cur = Number(p.current_price ?? p.entry_price);
        const upnl = cur * Number(p.qty) - Number(p.entry_value);
        const upct = (upnl / Number(p.entry_value)) * 100;
        unrealizedTotal += Number.isFinite(upnl) ? upnl : 0;
        return `${p.asset}: ${upnl >= 0 ? "+" : ""}${upnl.toFixed(2)} USD (${upct >= 0 ? "+" : ""}${upct.toFixed(2)}%)`;
      });

      // chiusi oggi
      const { data: closedToday } = await supa
        .from("positions")
        .select("pnl")
        .eq("user_id", userId)
        .eq("status", "closed")
        .gte("closed_at", dayStart);
      const realized = (closedToday ?? []).reduce((a, b) => a + Number(b.pnl ?? 0), 0);

      // sentiment latest
      const { data: fg } = await supa
        .from("sentiment_snapshots")
        .select("score,raw")
        .eq("user_id", userId)
        .eq("source", "fear_greed")
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: regime } = await supa
        .from("sentiment_snapshots")
        .select("raw")
        .eq("user_id", userId)
        .eq("source", "regime")
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();

      const fgValue = fg?.score != null ? Number(fg.score) : null;
      const fgLabel = ((fg?.raw ?? {}) as { classification?: string }).classification ?? "—";
      const regimeLabel = ((regime?.raw ?? {}) as { label?: string }).label ?? "—";

      const text = fmtDailySummary({
        date: new Date().toLocaleDateString("it-IT"),
        portfolioTotal,
        dayDelta,
        openCount: openPos?.length ?? 0,
        openLines,
        realizedToday: realized,
        closedToday: closedToday?.length ?? 0,
        unrealizedTotal,
        regime: regimeLabel,
        fgValue,
        fgLabel,
      });

      await sendTelegram(text);
      await supa.from("events_log").insert({
        user_id: userId,
        level: "info",
        component: "daily-summary",
        message: "Riepilogo inviato",
      });
      sent++;
    }

    return new Response(JSON.stringify({ ok: true, sent }), {
      headers: { ...cors, "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...cors, "content-type": "application/json" },
    });
  }
});
