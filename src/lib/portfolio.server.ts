// Server-only portfolio helpers. Imported dynamically from *.functions.ts handlers
// and statically from other *.server.ts modules.
import {
  KrakenApiError,
  fetchKrakenBalanceEx,
  fetchKrakenOpenOrders,
  fetchKrakenOpenPositions,
  fetchKrakenPublicTicker,
  isFiat,
  normalizeKrakenAsset,
} from "@/lib/kraken.server";
import { fetchStockQuote, xStockBaseSymbol } from "@/lib/market-data.server";
import type { AssetClass, LivePositionItem } from "@/lib/portfolio.functions";

export { KrakenApiError };

export function krakenErrorDto(e: unknown) {
  if (e instanceof KrakenApiError) {
    return { code: e.code, message: e.message, httpStatus: e.httpStatus, krakenErrors: e.krakenErrors, hint: e.hint };
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { code: "UNKNOWN", message: msg, httpStatus: 0, krakenErrors: [] as string[], hint: null as string | null };
}

export function classifyAsset(symbol: string): AssetClass {
  if (isFiat(symbol)) return "cash";
  if (xStockBaseSymbol(symbol)) return "stocks";
  if (/^[A-Z]{3}[A-Z]{3}$/.test(symbol) && /USD|EUR|GBP|JPY|CHF|CAD|AUD/.test(symbol)) return "forex";
  return "crypto";
}

async function priceMapForCrypto(symbols: string[]): Promise<Record<string, number>> {
  const wanted = symbols.filter((s) => !isFiat(s));
  if (wanted.length === 0) return {};
  const pairs = wanted.map((s) => `${s === "BTC" ? "XBT" : s}USD`);
  try {
    const ticker = await fetchKrakenPublicTicker(pairs);
    const out: Record<string, number> = {};
    for (const sym of wanted) {
      const candidates = [
        `X${sym === "BTC" ? "XBT" : sym}ZUSD`,
        `${sym === "BTC" ? "XBT" : sym}USD`,
        `${sym}USD`,
      ];
      for (const k of Object.keys(ticker)) {
        if (candidates.some((c) => k === c || k.endsWith(c.replace("USD", "ZUSD")))) {
          out[sym] = ticker[k];
          break;
        }
      }
      if (!out[sym]) {
        const k = Object.keys(ticker).find((x) => x.includes(sym === "BTC" ? "XBT" : sym));
        if (k) out[sym] = ticker[k];
      }
    }
    return out;
  } catch {
    return {};
  }
}

export async function loadLivePortfolioSnapshot(apiKey: string, apiSecret: string) {
  const balanceEx = await fetchKrakenBalanceEx(apiKey, apiSecret);
  const warnings: string[] = [];
  let openOrders: Awaited<ReturnType<typeof fetchKrakenOpenOrders>> = { open: {} };
  let openPositions: Awaited<ReturnType<typeof fetchKrakenOpenPositions>> = {};
  try {
    openOrders = await fetchKrakenOpenOrders(apiKey, apiSecret);
  } catch (e) {
    warnings.push(`OpenOrders non disponibile: ${krakenErrorDto(e).message}`);
  }
  try {
    openPositions = await fetchKrakenOpenPositions(apiKey, apiSecret);
  } catch (e) {
    warnings.push(`OpenPositions non disponibile: ${krakenErrorDto(e).message}`);
  }

  const aggregated: Record<string, number> = {};
  for (const [rawAsset, entry] of Object.entries(balanceEx)) {
    const qty = Number(entry.balance ?? 0);
    if (!Number.isFinite(qty) || qty === 0) continue;
    const sym = normalizeKrakenAsset(rawAsset);
    aggregated[sym] = (aggregated[sym] ?? 0) + qty;
  }

  const symbols = Object.keys(aggregated);
  const cryptoSymbols = symbols.filter((s) => classifyAsset(s) === "crypto");
  const prices = await priceMapForCrypto(cryptoSymbols);
  for (const sym of symbols.filter((s) => classifyAsset(s) === "stocks")) {
    const base = xStockBaseSymbol(sym);
    if (!base) continue;
    const quote = await fetchStockQuote(base);
    if (quote.priceUsd != null) prices[sym] = quote.priceUsd;
    else warnings.push(`Prezzo Finnhub non trovato per xStock ${sym}.`);
  }

  return {
    balances: aggregated,
    openOrders: openOrders.open ?? {},
    openPositions,
    prices,
    warnings,
  };
}

export function livePositionsFromSnapshot(snapshot: Awaited<ReturnType<typeof loadLivePortfolioSnapshot>>): LivePositionItem[] {
  const items: LivePositionItem[] = [];
  for (const [asset, qty] of Object.entries(snapshot.balances)) {
    if (isFiat(asset) || qty <= 0) continue;
    const current = snapshot.prices[asset] ?? null;
    items.push({
      source: "kraken-live", kind: "spot", asset, side: "long", qty,
      entry_price: null, current_price: current, entry_value: current == null ? null : qty * current,
      opened_at: null, status: "open",
    });
  }
  for (const [id, p] of Object.entries(snapshot.openPositions)) {
    const asset = normalizeKrakenAsset(p.pair ?? id);
    const qty = Number(p.vol ?? 0) - Number(p.vol_closed ?? 0);
    const cost = Number(p.cost ?? 0);
    items.push({
      source: "kraken-live", kind: "margin", asset, side: p.type === "sell" ? "short" : "long", qty,
      entry_price: qty ? cost / qty : null, current_price: null, entry_value: cost || null,
      opened_at: p.time ? new Date(p.time * 1000).toISOString() : null, status: "open", rawId: id,
    });
  }
  for (const [id, o] of Object.entries(snapshot.openOrders)) {
    const asset = normalizeKrakenAsset(o.descr?.pair ?? id);
    const qty = Math.max(0, Number(o.vol ?? 0) - Number(o.vol_exec ?? 0));
    const price = Number(o.descr?.price ?? o.price ?? 0) || null;
    items.push({
      source: "kraken-live", kind: "order", asset, side: o.descr?.type === "sell" ? "sell" : "buy", qty,
      entry_price: price, current_price: null, entry_value: price == null ? null : qty * price,
      opened_at: o.opentm ? new Date(o.opentm * 1000).toISOString() : null, status: "open", rawId: id,
    });
  }
  return items.sort((a, b) => (b.entry_value ?? 0) - (a.entry_value ?? 0));
}

export { isFiat, fetchKrakenBalanceEx, fetchKrakenTradeBalance, normalizeKrakenAsset } from "@/lib/kraken.server";
