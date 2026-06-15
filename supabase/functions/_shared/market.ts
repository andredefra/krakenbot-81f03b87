// Mappa simbolo "comune" -> coppia Kraken USD
// https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,...
export const KRAKEN_PAIR: Record<string, string> = {
  BTC: "XBTUSD",
  ETH: "ETHUSD",
  SOL: "SOLUSD",
  ADA: "ADAUSD",
  LINK: "LINKUSD",
  AVAX: "AVAXUSD",
  DOT: "DOTUSD",
  XRP: "XRPUSD",
  MATIC: "MATICUSD",
  LTC: "LTCUSD",
  DOGE: "XDGUSD",
};

export async function fetchKrakenTickers(symbols: string[]): Promise<Record<string, number>> {
  const pairs = symbols.map((s) => KRAKEN_PAIR[s]).filter(Boolean);
  if (pairs.length === 0) return {};
  const url = `https://api.kraken.com/0/public/Ticker?pair=${pairs.join(",")}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Kraken Ticker HTTP ${r.status}`);
  const j = await r.json();
  if (j.error?.length) throw new Error(`Kraken error: ${j.error.join("; ")}`);
  const out: Record<string, number> = {};
  for (const sym of symbols) {
    const pair = KRAKEN_PAIR[sym];
    if (!pair) continue;
    // Kraken returns keys like "XETHZUSD" sometimes — find by suffix match
    const result = j.result as Record<string, { c: [string, string] }>;
    const key = Object.keys(result).find((k) => k === pair || k.endsWith(pair) || k.replace(/^[XZ]/, "").startsWith(pair.replace("USD", "")));
    if (!key) continue;
    const last = parseFloat(result[key].c[0]);
    if (!Number.isNaN(last)) out[sym] = last;
  }
  return out;
}

// Daily OHLC for SMA50 (regime BTC). interval=1440 minuti = 1 giorno.
export async function fetchKrakenDailyCloses(symbol: string, count = 60): Promise<number[]> {
  const pair = KRAKEN_PAIR[symbol];
  if (!pair) return [];
  const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=1440`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Kraken OHLC HTTP ${r.status}`);
  const j = await r.json();
  if (j.error?.length) throw new Error(`Kraken error: ${j.error.join("; ")}`);
  const result = j.result as Record<string, unknown>;
  const key = Object.keys(result).find((k) => k !== "last");
  if (!key) return [];
  const rows = result[key] as Array<[number, string, string, string, string, string, string, number]>;
  return rows.slice(-count).map((r) => parseFloat(r[4]));
}

export async function fetchFearGreed(): Promise<{ value: number; label: string } | null> {
  try {
    const r = await fetch("https://api.alternative.me/fng/?limit=1");
    if (!r.ok) return null;
    const j = await r.json();
    const d = j?.data?.[0];
    if (!d) return null;
    return { value: parseInt(d.value, 10), label: String(d.value_classification ?? "") };
  } catch {
    return null;
  }
}

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}
