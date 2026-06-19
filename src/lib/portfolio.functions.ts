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
    // Auto-seed dal saldo Kraken reale al primo avvio.
    if (!settings?.paper_seeded_at) {
      try {
        await runSeedPaperFromKraken(supabase, userId, { force: false });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[getLivePortfolio] auto-seed failed", msg);
        return {
          ok: false, source: "paper", mode,
          error: { code: "SEED_FAILED", message: `Impossibile inizializzare PAPER da Kraken: ${msg}`, httpStatus: 0, krakenErrors: [], hint: "Vai in Diagnostica → Test Connessione Kraken." },
        };
      }
    }

    const [posRes, snapRes, settings2Res] = await Promise.all([
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
      supabase.from("settings")
        .select("paper_seeded_at, paper_seed_total_usd, paper_seed_cash_usd")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    const positions = ((posRes.data ?? []) as unknown) as Array<{
      asset: string; asset_class: string | null; qty: number;
      entry_price: number; entry_value: number; current_price: number | null;
    }>;
    const snap = snapRes.data;
    const seedInfo = settings2Res.data;
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
    const cashUsd = Number(snap?.cash_value ?? seedInfo?.paper_seed_cash_usd ?? 0);
    const totalValueUsd = snap?.total_value != null
      ? Number(snap.total_value)
      : (Number(seedInfo?.paper_seed_total_usd ?? 0) || cashUsd + positionsValue);

    const classes: PortfolioClassSlice[] = [];
    if (cashUsd > 0) classes.push({ assetClass: "cash", valueUsd: cashUsd, items: [{ symbol: "USD", qty: cashUsd, priceUsd: 1, valueUsd: cashUsd, assetClass: "cash" }] });
    for (const [cls, items] of byClass) {
      const v = items.reduce((a, i) => a + i.valueUsd, 0);
      classes.push({ assetClass: cls, valueUsd: v, items: items.sort((a, b) => b.valueUsd - a.valueUsd) });
    }

    return {
      ok: true, source: "paper", mode, totalValueUsd, cashUsd, classes, fetchedAt,
      warnings: positions.length === 0 && cashUsd === 0
        ? ["Nessun saldo Kraken trovato — verifica le chiavi API o usa 'Risincronizza da Kraken'."]
        : [],
    };
  });

// ============================================================================
// seedPaperFromKraken — copia il saldo reale Kraken come base PAPER
// ============================================================================
export const seedPaperFromKraken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { force?: boolean } | undefined) => ({ force: Boolean(input?.force) }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    try {
      const result = await runSeedPaperFromKraken(supabase, userId, { force: data.force });
      return { ok: true as const, ...result };
    } catch (e) {
      const { krakenErrorDto } = await import("@/lib/portfolio.server");
      const err = krakenErrorDto(e);
      console.error("[seedPaperFromKraken]", err);
      return { ok: false as const, error: err };
    }
  });

// Logica condivisa: chiama Kraken, salva positions + snapshot + settings.
async function runSeedPaperFromKraken(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
  opts: { force: boolean },
) {
  const sb = supabase;

  const { data: existing } = await sb
    .from("settings")
    .select("paper_seeded_at, paper_seed_total_usd, paper_seed_cash_usd, core_weights")
    .eq("user_id", userId)
    .maybeSingle();

  const coreSymbols = new Set(
    Object.keys(((existing as { core_weights?: Record<string, number> } | null)?.core_weights ?? { BTC: 0.6, ETH: 0.4 }))
  );


  if (existing?.paper_seeded_at && !opts.force) {
    return {
      seededAt: existing.paper_seeded_at as string,
      totalValueUsd: Number(existing.paper_seed_total_usd ?? 0),
      cashUsd: Number(existing.paper_seed_cash_usd ?? 0),
      created: 0,
      reused: true as const,
    };
  }

  const { loadLivePortfolioSnapshot, classifyAsset, isFiat } = await import("@/lib/portfolio.server");
  const apiKey = process.env.KRAKEN_API_KEY ?? "";
  const apiSecret = process.env.KRAKEN_API_SECRET ?? "";
  const snapshot = await loadLivePortfolioSnapshot(apiKey, apiSecret);

  let cashUsd = 0;
  let positionsValue = 0;
  const positionsToInsert: Array<Record<string, unknown>> = [];
  const nowIso = new Date().toISOString();

  for (const [sym, qty] of Object.entries(snapshot.balances)) {
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (isFiat(sym)) {
      if (sym === "USD") cashUsd += qty;
      continue;
    }
    const assetClass = classifyAsset(sym);
    const px = snapshot.prices[sym];
    if (px == null || px <= 0) continue;
    const value = qty * px;
    positionsValue += value;
    positionsToInsert.push({
      user_id: userId,
      asset: sym,
      asset_class: assetClass,
      sleeve: coreSymbols.has(sym) ? "core" : "satellite",
      side: "long",
      status: "open",
      mode: "paper",
      qty,
      entry_price: px,
      entry_value: value,
      current_price: px,
      opened_at: nowIso,
      open_reason: "seed_from_kraken",
    });
  }

  // Reset previous paper open positions before reseeding.
  if (opts.force) {
    await sb.from("positions")
      .delete()
      .eq("user_id", userId)
      .eq("mode", "paper")
      .eq("status", "open");
  }

  if (positionsToInsert.length > 0) {
    const { error: insErr } = await sb.from("positions").insert(positionsToInsert);
    if (insErr) throw new Error(`Insert positions: ${insErr.message}`);
  }

  const totalValueUsd = cashUsd + positionsValue;
  const { error: snapErr } = await sb.from("portfolio_snapshots").insert({
    user_id: userId,
    ts: nowIso,
    mode: "paper",
    total_value: totalValueUsd,
    cash_value: cashUsd,
    positions_value: positionsValue,
    realized_pnl_day: 0,
  });
  if (snapErr) throw new Error(`Insert snapshot: ${snapErr.message}`);

  const { error: updErr } = await sb.from("settings")
    .update({
      paper_seeded_at: nowIso,
      paper_seed_total_usd: totalValueUsd,
      paper_seed_cash_usd: cashUsd,
    })
    .eq("user_id", userId);
  if (updErr) throw new Error(`Update settings: ${updErr.message}`);

  return {
    seededAt: nowIso,
    totalValueUsd,
    cashUsd,
    created: positionsToInsert.length,
    reused: false as const,
  };
}


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
