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

// Safe number→fixed: tollerante a undefined/null/NaN.
function f(n: unknown, d = 2): string {
  const x = Number(n);
  return (Number.isFinite(x) ? x : 0).toFixed(d);
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
    `Ingresso: ${f(args.price, 4)} USD`,
    `Quantità: ${f(args.qty, 6)} ${args.asset}`,
    `Valore: ${f(args.value, 2)} USD (${f(args.pctOfPortfolio, 1)}% del portafoglio)`,
    `Motivo: ${args.reason}`,
    `💼 Portafoglio totale: ${f(args.portfolioTotal, 2)} USD`,
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
  portfolioTotal?: number;
}) {
  const icon = args.win ? "✅" : "❌";
  return [
    `${icon} TRADE CHIUSO — ${args.asset}   ${tag(args.mode)}`,
    `Ingresso: ${f(args.entryValue, 2)} USD @ ${f(args.entryPrice, 4)}`,
    `Uscita:   ${f(args.exitValue, 2)} USD @ ${f(args.exitPrice, 4)}`,
    `P/L: ${f(args.pnl, 2)} USD (${f(args.pnlPct, 2)}%)`,
    `Durata: ${args.duration}`,
    `Motivo uscita: ${args.reason}`,
    `💼 Portafoglio totale: ${f(args.portfolioTotal, 2)} USD`,
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
  unrealizedTotal: number;
  regime: string;
  fgValue: number | null;
  fgLabel: string;
}) {
  const dd = Number(args.dayDelta);
  const upnl = Number(args.unrealizedTotal);
  const lines = [
    `📊 RIEPILOGO ${args.date}`,
    `💼 Portafoglio: ${f(args.portfolioTotal, 2)} USD (${Number.isFinite(dd) && dd >= 0 ? "+" : ""}${f(dd, 2)} oggi)`,
    `Posizioni aperte: ${args.openCount}`,
    ...args.openLines.map((l) => `  • ${l}`),
    `P/L non realizzato (aperte): ${Number.isFinite(upnl) && upnl >= 0 ? "+" : ""}${f(upnl, 2)} USD`,
    `P/L realizzato oggi: ${f(args.realizedToday, 2)} USD (${args.closedToday} trade chiusi)`,
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
