export function formatUsd(value: number | null | undefined, opts?: { signed?: boolean }): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const formatted = formatter.format(Math.abs(value));
  if (opts?.signed) return `${value >= 0 ? "+" : "−"}${formatted}`;
  return value < 0 ? `−${formatted}` : formatted;
}

export function formatPct(value: number | null | undefined, opts?: { signed?: boolean }): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = opts?.signed ? (value >= 0 ? "+" : "−") : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

export function formatNumber(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function formatDateTime(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(fromIso: string | null | undefined, toIso: string | null | undefined): string {
  if (!fromIso || !toIso) return "—";
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (ms < 0) return "—";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}g ${hours % 24}h`;
}

export function pnlClass(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "text-muted-foreground";
  if (value > 0) return "text-[color:var(--profit)]";
  if (value < 0) return "text-[color:var(--loss)]";
  return "text-muted-foreground";
}
