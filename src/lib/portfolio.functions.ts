// Server functions per portfolio LIVE/PAPER.
// Heavy logic (Kraken/market-data) is in portfolio.server.ts and dynamically
// imported inside handler bodies so it never lands in client bundles.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
      .select("mode, paper_seeded_at, paper_seed_total_usd, paper_seed_cash_usd")
      .eq("user_id", userId)
      .maybeSingle();
    const mode = (settings?.mode === "live" ? "live" : "paper") as "live" | "paper";


    if (mode === "live") {
      const {
        loadLivePortfolioSnapshot, classifyAsset, krakenErrorDto, KrakenApiError,
        isFiat, fetchKrakenTradeBalance,
      } = await import("@/lib/portfolio.server");
      const apiKey = process.env.KRAKEN_API_KEY;
      const apiSecret = process.env.KRAKEN_API_SECRET;
      try {
        const snapshot = await loadLivePortfolioSnapshot(apiKey ?? "", apiSecret ?? "");
        const byClass = new Map<AssetClass, PortfolioItem[]>();
        let cashUsd = 0;
        const warnings = [...snapshot.warnings];
        for (const [sym, qty] of Object.entries(snapshot.balances)) {
          if (isFiat(sym)) {
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
    const { fetchKrakenBalanceEx, normalizeKrakenAsset, KrakenApiError } = await import("@/lib/portfolio.server");
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
