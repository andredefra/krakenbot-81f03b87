// Telegram notifier — Edge Function shared helper
// Usa i formati esatti di STRATEGIA.md §7
const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TG_CHAT = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";

export async function sendTelegram(text: string): Promise<void> {
  if (!TG_TOKEN || !TG_CHAT) {
    console.log("[telegram] token o chat_id mancanti, skip");
    return;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: TG_CHAT,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!r.ok) {
      const body = await r.text();
      console.error(`[telegram] errore ${r.status}: ${body}`);
    }
  } catch (e) {
    console.error("[telegram] fetch failed", e);
  }
}

function tag(mode: "paper" | "live") {
  return mode === "live" ? "[LIVE]" : "[PAPER]";
}

export function fmtOpen(args: {
  mode: "paper" | "live";
  asset: string;
  price: number;
  qty: number;
  value: number;
  pctOfPortfolio: number;
  reason: string;
  portfolioTotal: number;
}) {
  return [
    `🟢 NUOVO TRADE — ${args.asset}   ${tag(args.mode)}`,
    `Ingresso: ${args.price.toFixed(4)} USD`,
    `Quantità: ${args.qty.toFixed(6)} ${args.asset}`,
    `Valore: ${args.value.toFixed(2)} USD (${args.pctOfPortfolio.toFixed(1)}% del portafoglio)`,
    `Motivo: ${args.reason}`,
    `💼 Portafoglio totale: ${args.portfolioTotal.toFixed(2)} USD`,
  ].join("\n");
}

export function fmtClose(args: {
  mode: "paper" | "live";
  asset: string;
  win: boolean;
  entryValue: number;
  entryPrice: number;
  exitValue: number;
  exitPrice: number;
  pnl: number;
  pnlPct: number;
  duration: string;
  reason: string;
  portfolioTotal: number;
}) {
  const icon = args.win ? "✅" : "❌";
  return [
    `${icon} TRADE CHIUSO — ${args.asset}   ${tag(args.mode)}`,
    `Ingresso: ${args.entryValue.toFixed(2)} USD @ ${args.entryPrice.toFixed(4)}`,
    `Uscita:   ${args.exitValue.toFixed(2)} USD @ ${args.exitPrice.toFixed(4)}`,
    `P/L: ${args.pnl.toFixed(2)} USD (${args.pnlPct.toFixed(2)}%)`,
    `Durata: ${args.duration}`,
    `Motivo uscita: ${args.reason}`,
    `💼 Portafoglio totale: ${args.portfolioTotal.toFixed(2)} USD`,
  ].join("\n");
}

export function fmtError(args: { component: string; message: string; action?: string }) {
  return [
    `⚠️ ERRORE — ${args.component}`,
    args.message,
    `Azione intrapresa: ${args.action ?? "nessuna"}`,
  ].join("\n");
}

export function fmtDailySummary(args: {
  date: string;
  portfolioTotal: number;
  dayDelta: number;
  openCount: number;
  openLines: string[];
  realizedToday: number;
  closedToday: number;
  regime: string;
  fgValue: number | null;
  fgLabel: string;
}) {
  const lines = [
    `📊 RIEPILOGO ${args.date}`,
    `💼 Portafoglio: ${args.portfolioTotal.toFixed(2)} USD (${args.dayDelta >= 0 ? "+" : ""}${args.dayDelta.toFixed(2)} oggi)`,
    `Posizioni aperte: ${args.openCount}`,
    ...args.openLines.map((l) => `  • ${l}`),
    `P/L realizzato oggi: ${args.realizedToday.toFixed(2)} USD`,
    `Trade chiusi oggi: ${args.closedToday}`,
    `Regime: ${args.regime} | Fear&Greed: ${args.fgValue ?? "—"} (${args.fgLabel})`,
  ];
  return lines.join("\n");
}

export function durationStr(fromIso: string, toIso: string): string {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  if (h < 48) return `${h}h ${minutes % 60}m`;
  return `${Math.floor(h / 24)}g ${h % 24}h`;
}
