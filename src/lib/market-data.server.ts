type Quote = { symbol: string; priceUsd: number | null; source: "finnhub" | "alpha-vantage" | "none" };

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export async function fetchStockQuote(symbol: string): Promise<Quote> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return { symbol, priceUsd: null, source: "none" };
  const json = await fetchJson<{ c?: number }>(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`);
  const price = Number(json?.c ?? 0);
  return { symbol, priceUsd: Number.isFinite(price) && price > 0 ? price : null, source: price > 0 ? "finnhub" : "none" };
}

export async function fetchFuturesQuote(symbol: string): Promise<Quote> {
  return fetchStockQuote(symbol);
}

export async function fetchForexQuote(pair: string): Promise<Quote> {
  const clean = pair.replace("/", "").toUpperCase();
  const finnhubKey = process.env.FINNHUB_API_KEY;
  if (finnhubKey && clean.length === 6) {
    const base = clean.slice(0, 3);
    const quote = clean.slice(3, 6);
    const json = await fetchJson<{ quote?: Record<string, number> }>(`https://finnhub.io/api/v1/forex/rates?base=${encodeURIComponent(base)}&token=${finnhubKey}`);
    const rate = Number(json?.quote?.[quote] ?? 0);
    if (Number.isFinite(rate) && rate > 0) return { symbol: clean, priceUsd: quote === "USD" ? rate : null, source: "finnhub" };
  }

  const alphaKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (alphaKey && clean.length === 6) {
    const from = clean.slice(0, 3);
    const to = clean.slice(3, 6);
    const json = await fetchJson<{ "Realtime Currency Exchange Rate"?: { "5. Exchange Rate"?: string } }>(
      `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${encodeURIComponent(from)}&to_currency=${encodeURIComponent(to)}&apikey=${alphaKey}`,
    );
    const rate = Number(json?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"] ?? 0);
    if (Number.isFinite(rate) && rate > 0) return { symbol: clean, priceUsd: to === "USD" ? rate : null, source: "alpha-vantage" };
  }

  return { symbol: clean, priceUsd: null, source: "none" };
}

export function xStockBaseSymbol(symbol: string): string | null {
  const clean = symbol.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const known = ["AAPL", "AMZN", "COIN", "GOOGL", "META", "MSFT", "MSTR", "NVDA", "SPY", "TSLA"];
  for (const base of known) {
    if (clean === `${base}X` || clean === `${base}XSTOCK` || clean === `${base}XSTOCKS`) return base;
  }
  return null;
}