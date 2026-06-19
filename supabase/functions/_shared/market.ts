// Risoluzione dinamica simbolo comune -> coppia Kraken USD.
// Non usiamo una whitelist statica: la strategia v4 deve poter valutare anche
// xStocks / token azionari, commodity e forex presenti su Kraken.
export const KRAKEN_PAIR: Record<string, string> = {
  BTC: "XBTUSD",
  XBT: "XBTUSD",
  ETH: "ETHUSD",
  DOGE: "XDGUSD",
};

type AssetPair = { altname: string; base: string; quote: string };
let pairCache: Record<string, string> | null = null;

function normalizeKrakenAsset(raw: string): string {
  const map: Record<string, string> = {
    XXBT: "BTC", XBT: "BTC", XETH: "ETH", XXRP: "XRP", XLTC: "LTC",
    XXDG: "DOGE", XDG: "DOGE", ZUSD: "USD", ZEUR: "EUR", ZGBP: "GBP",
    ZJPY: "JPY", ZCAD: "CAD", ZAUD: "AUD", ZCHF: "CHF",
  };
  return map[raw] ?? raw.replace(/\.[FSM]$/, "");
}

async function loadUsdPairs(): Promise<Record<string, string>> {
  if (pairCache) return pairCache;
  const r = await fetch("https://api.kraken.com/0/public/AssetPairs");
  if (!r.ok) throw new Error(`Kraken AssetPairs HTTP ${r.status}`);
  const j = await r.json();
  if (j.error?.length) throw new Error(`Kraken error: ${j.error.join("; ")}`);
  const out: Record<string, string> = { ...KRAKEN_PAIR };
  for (const p of Object.values((j.result ?? {}) as Record<string, AssetPair>)) {
    const quote = normalizeKrakenAsset(p.quote || "");
    if (quote !== "USD") continue;
    const base = normalizeKrakenAsset(p.base || "");
    if (!base || !p.altname) continue;
    out[base] = p.altname;
  }
  pairCache = out;
  return out;
}

export async function fetchKrakenTickers(symbols: string[]): Promise<Record<string, number>> {
  const pairMap = await loadUsdPairs();
  const pairs = [...new Set(symbols.map((s) => pairMap[s] ?? pairMap[s.toUpperCase()]).filter(Boolean))];
  if (pairs.length === 0) return {};
  const result: Record<string, { c: [string, string] }> = {};
  const CHUNK = 60;
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const url = `https://api.kraken.com/0/public/Ticker?pair=${pairs.slice(i, i + CHUNK).join(",")}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Kraken Ticker HTTP ${r.status}`);
    const j = await r.json();
    if (j.error?.length) throw new Error(`Kraken error: ${j.error.join("; ")}`);
    Object.assign(result, j.result ?? {});
  }
  const out: Record<string, number> = {};
  for (const sym of symbols) {
    const pair = pairMap[sym] ?? pairMap[sym.toUpperCase()];
    if (!pair) continue;
    // Kraken returns keys like "XETHZUSD" sometimes — find by suffix match
    const key = Object.keys(result).find((k) => k === pair || k.endsWith(pair) || k.replace(/^[XZ]/, "").startsWith(pair.replace("USD", "")));
    if (!key) continue;
    const last = parseFloat(result[key].c[0]);
    if (!Number.isNaN(last)) out[sym] = last;
  }
  return out;
}

// Daily OHLC for SMA50 (regime BTC). interval=1440 minuti = 1 giorno.
export async function fetchKrakenDailyCloses(symbol: string, count = 60): Promise<number[]> {
  const pairMap = await loadUsdPairs();
  const pair = pairMap[symbol] ?? pairMap[symbol.toUpperCase()];
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
