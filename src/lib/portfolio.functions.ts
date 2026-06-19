// Server functions per portfolio LIVE/PAPER.
// - getLivePortfolio: composizione + equity. In live va su Kraken Balance + Ticker.
//   In paper usa positions aperte + cash dell'ultimo snapshot. NIENTE dati finti.
// - testKrakenConnection: chiamata leggera autenticata a /0/private/BalanceEx per
//   verificare key/secret/permessi nella pagina Diagnostica.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  KrakenApiError,
  fetchKrakenBalanceEx,
  fetchKrakenOpenOrders,
  fetchKrakenOpenPositions,
  fetchKrakenPublicTicker,
  fetchKrakenTradeBalance,
  isFiat,
  normalizeKrakenAsset,
} from "@/lib/kraken.server";
import { fetchStockQuote, xStockBaseSymbol } from "@/lib/market-data.server";

export type AssetClass = "crypto" | "stocks" | "futures" | "forex" | "cash";

export type PortfolioItem = {
  symbol: string;
  qty: number;
  priceUsd: number | null;
  valueUsd: number;
  assetClass: AssetClass;
};

export type PortfolioClassSlice = {
  assetClass: AssetClass;
  valueUsd: number;
  items: PortfolioItem[];
};

export type PortfolioResult =
  | {
      ok: true;
      source: "kraken-live" | "paper";
      mode: "live" | "paper";
      totalValueUsd: number;
      cashUsd: number;
      classes: PortfolioClassSlice[];
      fetchedAt: string;
      warnings: string[];
    }
  | {
      ok: false;
      source: "kraken-live" | "paper";
      mode: "live" | "paper";
      error: {
        code: string;
        message: string;
        httpStatus: number;
        krakenErrors: string[];
        hint: string | null;
      };
    };

export type LivePositionItem = {
  source: "kraken-live";
  kind: "spot" | "margin" | "order";
  asset: string;
  side: "long" | "short" | "buy" | "sell" | null;
  qty: number;
  entry_price: number | null;
  current_price: number | null;
  entry_value: number | null;
  opened_at: string | null;
  status: "open";
  rawId?: string;
};

function krakenErrorDto(e: unknown) {
  if (e instanceof KrakenApiError) {
    return { code: e.code, message: e.message, httpStatus: e.httpStatus, krakenErrors: e.krakenErrors, hint: e.hint };
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { code: "UNKNOWN", message: msg, httpStatus: 0, krakenErrors: [] as string[], hint: null as string | null };
}

function classifyAsset(symbol: string): AssetClass {
  if (isFiat(symbol)) return "cash";
  if (xStockBaseSymbol(symbol)) return "stocks";
  if (/^[A-Z]{3}[A-Z]{3}$/.test(symbol) && /USD|EUR|GBP|JPY|CHF|CAD|AUD/.test(symbol)) return "forex";
  return "crypto";
}

// ----------------------------------------------------------------------------
// Helper: prova a recuperare prezzi USD per una lista di asset Kraken normali
// (es. BTC, ETH, SOL). Restituisce mappa { BTC: 65000, ETH: 3200, ... }.
// ----------------------------------------------------------------------------
async function priceMapForCrypto(symbols: string[]): Promise<Record<string, number>> {
  const wanted = symbols.filter((s) => !isFiat(s));
  if (wanted.length === 0) return {};
  // Kraken accetta varie coppie: BTCUSD, XBTUSD, ETHUSD, ecc. Proviamo formato comune.
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
        // fallback: trova qualsiasi key che contenga il symbol
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

// ============================================================================
// getLivePortfolio
// ============================================================================
export const getLivePortfolio = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PortfolioResult> => {
    const { supabase, userId } = context;
    const fetchedAt = new Date().toISOString();

    const { data: settings } = await supabase
      .from("settings")
      .select("mode")
      .eq("user_id", userId)
      .maybeSingle();
    const mode = (settings?.mode === "live" ? "live" : "paper") as "live" | "paper";

    // ----------- LIVE -----------
    if (mode === "live") {
      const apiKey = process.env.KRAKEN_API_KEY;
      const apiSecret = process.env.KRAKEN_API_SECRET;
      try {
        const snapshot = await loadLivePortfolioSnapshot(apiKey ?? "", apiSecret ?? "");
        const byClass = new Map<AssetClass, PortfolioItem[]>();
        let cashUsd = 0;
        const warnings = [...snapshot.warnings];
        for (const [sym, qty] of Object.entries(snapshot.balances)) {
          if (isFiat(sym)) {
            // converto qualsiasi fiat in USD: USD 1:1, altri fiat → skip (warning)
            if (sym === "USD") cashUsd += qty;
            else warnings.push(`Saldo in ${sym} (${qty}) non convertito in USD — aggiungi conversione manuale.`);
            continue;
          }
          const assetClass = classifyAsset(sym);
          const px = snapshot.prices[sym];
          if (px == null) {
            warnings.push(`Prezzo USD non trovato per ${sym} — voce esclusa dal totale.`);
            if (!byClass.has(assetClass)) byClass.set(assetClass, []);
            byClass.get(assetClass)!.push({ symbol: sym, qty, priceUsd: null, valueUsd: 0, assetClass });
            continue;
          }
          if (!byClass.has(assetClass)) byClass.set(assetClass, []);
          byClass.get(assetClass)!.push({ symbol: sym, qty, priceUsd: px, valueUsd: qty * px, assetClass });
        }
        const positionsValue = [...byClass.values()].flat().reduce((a, i) => a + i.valueUsd, 0);
        const totalValueUsd = positionsValue + cashUsd;

        const classes: PortfolioClassSlice[] = [];
        if (cashUsd > 0) classes.push({ assetClass: "cash", valueUsd: cashUsd, items: [{ symbol: "USD", qty: cashUsd, priceUsd: 1, valueUsd: cashUsd, assetClass: "cash" }] });
        for (const [assetClass, items] of byClass) {
          classes.push({ assetClass, valueUsd: items.reduce((a, i) => a + i.valueUsd, 0), items: items.sort((a, b) => b.valueUsd - a.valueUsd) });
        }

        return { ok: true, source: "kraken-live", mode, totalValueUsd, cashUsd, classes, fetchedAt, warnings };
      } catch (e) {
        if (e instanceof KrakenApiError) {
          console.error("[getLivePortfolio] kraken", { code: e.code, httpStatus: e.httpStatus, errors: e.krakenErrors });
          if (e.code.includes("Permission denied")) {
            try {
              const tradeBalance = await fetchKrakenTradeBalance(apiKey ?? "", apiSecret ?? "");
              const totalValueUsd = Number(tradeBalance.eb ?? 0);
              return {
                ok: true, source: "kraken-live", mode, totalValueUsd, cashUsd: 0,
                classes: totalValueUsd > 0 ? [{ assetClass: "cash", valueUsd: totalValueUsd, items: [{ symbol: "USD_EQUIV", qty: totalValueUsd, priceUsd: 1, valueUsd: totalValueUsd, assetClass: "cash" }] }] : [],
                fetchedAt,
                warnings: [`BalanceEx non autorizzato (${e.message}); usato TradeBalance come fallback.`],
              };
            } catch (fallbackErr) {
              console.error("[getLivePortfolio] tradeBalance fallback failed", krakenErrorDto(fallbackErr));
            }
          }
          return {
            ok: false, source: "kraken-live", mode,
            error: { code: e.code, message: e.message, httpStatus: e.httpStatus, krakenErrors: e.krakenErrors, hint: e.hint },
          };
        }
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[getLivePortfolio] unexpected", e);
        return {
          ok: false, source: "kraken-live", mode,
          error: { code: "UNKNOWN", message: msg, httpStatus: 0, krakenErrors: [], hint: null },
        };
      }
    }

    // ----------- PAPER -----------
    const [posRes, snapRes] = await Promise.all([
      supabase.from("positions")
        .select("asset, asset_class, qty, entry_price, entry_value, current_price")
        .eq("user_id", userId)
        .eq("status", "open")
        .eq("mode", "paper"),
      supabase.from("portfolio_snapshots")
        .select("total_value, cash_value, positions_value, ts")
        .eq("user_id", userId)
        .eq("mode", "paper")
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const positions = ((posRes.data ?? []) as unknown) as Array<{
      asset: string; asset_class: string | null; qty: number;
      entry_price: number; entry_value: number; current_price: number | null;
    }>;
    const snap = snapRes.data;
    const byClass = new Map<AssetClass, PortfolioItem[]>();
    let positionsValue = 0;
    for (const p of positions) {
      const cls = ((p.asset_class as AssetClass) ?? "crypto");
      const px = Number(p.current_price ?? p.entry_price ?? 0);
      const valueUsd = Number(p.qty) * px;
      positionsValue += valueUsd;
      if (!byClass.has(cls)) byClass.set(cls, []);
      byClass.get(cls)!.push({ symbol: p.asset, qty: Number(p.qty), priceUsd: px, valueUsd, assetClass: cls });
    }
    const cashUsd = Number(snap?.cash_value ?? 0);
    const totalValueUsd = (snap?.total_value != null ? Number(snap.total_value) : cashUsd + positionsValue);

    const classes: PortfolioClassSlice[] = [];
    if (cashUsd > 0) classes.push({ assetClass: "cash", valueUsd: cashUsd, items: [{ symbol: "USD", qty: cashUsd, priceUsd: 1, valueUsd: cashUsd, assetClass: "cash" }] });
    for (const [cls, items] of byClass) {
      const v = items.reduce((a, i) => a + i.valueUsd, 0);
      classes.push({ assetClass: cls, valueUsd: v, items: items.sort((a, b) => b.valueUsd - a.valueUsd) });
    }

    return {
      ok: true, source: "paper", mode, totalValueUsd, cashUsd, classes, fetchedAt,
      warnings: positions.length === 0 && cashUsd === 0 ? ["Nessun dato paper ancora — fai partire l'engine almeno una volta."] : [],
    };
  });

// ============================================================================
// testKrakenConnection — usato da pagina Diagnostica
// ============================================================================
export const testKrakenConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const apiKey = process.env.KRAKEN_API_KEY;
    const apiSecret = process.env.KRAKEN_API_SECRET;
    const startedAt = new Date().toISOString();
    try {
      const balance = await fetchKrakenBalanceEx(apiKey ?? "", apiSecret ?? "");
      const nonZero = Object.entries(balance).filter(([, v]) => Number(v.balance) > 0);
      return {
        ok: true as const,
        startedAt,
        finishedAt: new Date().toISOString(),
        assetsWithBalance: nonZero.length,
        sampleAssets: nonZero.slice(0, 5).map(([k, v]) => ({ asset: normalizeKrakenAsset(k), qty: Number(v.balance) })),
      };
    } catch (e) {
      if (e instanceof KrakenApiError) {
        return {
          ok: false as const,
          startedAt,
          error: { code: e.code, message: e.message, httpStatus: e.httpStatus, krakenErrors: e.krakenErrors, hint: e.hint },
        };
      }
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false as const, startedAt, error: { code: "UNKNOWN", message: msg, httpStatus: 0, krakenErrors: [], hint: null } };
    }
  });
