// Server functions for the Bilancio page.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { computeItalianTax, type TaxSummary } from "@/lib/tax/it";

// ============= Infra costs =============

const infraCostInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  category: z.enum(["infra", "api", "altro"]),
  amount_cents: z.number().int().min(0),
  currency: z.string().min(3).max(3).default("EUR"),
  recurrence: z.enum(["one_off", "monthly", "yearly"]),
  start_date: z.string(), // YYYY-MM-DD
  end_date: z.string().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const listInfraCosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("infra_costs")
      .select("*")
      .order("start_date", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertInfraCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => infraCostInput.parse(data))
  .handler(async ({ data, context }) => {
    const row = { ...data, user_id: context.userId };
    const { data: saved, error } = await context.supabase
      .from("infra_costs")
      .upsert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return saved;
  });

export const deleteInfraCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("infra_costs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const bulkImportInfraCosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ rows: z.array(infraCostInput).min(1).max(500) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const withUser = data.rows.map((r) => ({ ...r, user_id: context.userId }));
    const { error, count } = await context.supabase
      .from("infra_costs")
      .insert(withUser, { count: "exact" });
    if (error) throw new Error(error.message);
    return { inserted: count ?? withUser.length };
  });

// ============= Tax settings =============

const taxSettingsInput = z.object({
  tax_country: z.string().min(2).max(2),
  tax_reserve_cents: z.number().int().min(0),
  loss_carryforward_cents: z.number().int().min(0),
  paper_fee_bps: z.number().int().min(0).max(1000),
});

export const updateTaxSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => taxSettingsInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("settings")
      .update(data)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Income statement & tax summary =============

export type IncomeStatement = {
  year: number;
  mode: "paper" | "live";
  monthly: Array<{
    month: string; // YYYY-MM
    revenueCents: number;
    feeCents: number;
    netTradingCents: number;
    infraCostCents: number;
    preTaxCents: number;
    taxCents: number;
    netCents: number;
  }>;
  ytd: {
    revenueCents: number;
    feeCents: number;
    netTradingCents: number;
    infraCostCents: number;
    preTaxCents: number;
    taxCents: number;
    netCents: number;
  };
  runRateAnnual: {
    revenueCents: number;
    netCents: number;
    infraCostCents: number;
  };
};

function monthKey(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthlyInfraCost(
  costs: Array<{
    amount_cents: number;
    recurrence: string;
    start_date: string;
    end_date: string | null;
  }>,
  yyyymm: string,
): number {
  const [y, m] = yyyymm.split("-").map(Number);
  const monthStart = new Date(Date.UTC(y, m - 1, 1));
  const monthEnd = new Date(Date.UTC(y, m, 0));
  let total = 0;
  for (const c of costs) {
    const start = new Date(c.start_date);
    const end = c.end_date ? new Date(c.end_date) : null;
    if (start > monthEnd) continue;
    if (end && end < monthStart) continue;
    if (c.recurrence === "monthly") total += c.amount_cents;
    else if (c.recurrence === "yearly") total += Math.round(c.amount_cents / 12);
    else if (c.recurrence === "one_off") {
      // attribute to its start month only
      if (start >= monthStart && start <= monthEnd) total += c.amount_cents;
    }
  }
  return total;
}

export const getIncomeStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        year: z.number().int().min(2020).max(2100),
        mode: z.enum(["paper", "live"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<IncomeStatement> => {
    const { supabase } = context;
    const yearStart = `${data.year}-01-01`;
    const yearEnd = `${data.year + 1}-01-01`;

    const [positionsR, feesR, costsR, settingsR] = await Promise.all([
      supabase
        .from("positions")
        .select("pnl,exit_value,closed_at")
        .eq("mode", data.mode)
        .eq("status", "closed")
        .gte("closed_at", yearStart)
        .lt("closed_at", yearEnd),
      supabase
        .from("trade_fees")
        .select("fee_cents,traded_at")
        .gte("traded_at", yearStart)
        .lt("traded_at", yearEnd),
      supabase.from("infra_costs").select("amount_cents,recurrence,start_date,end_date"),
      supabase.from("settings").select("paper_fee_bps,tax_country,tax_reserve_cents,loss_carryforward_cents").maybeSingle(),
    ]);
    if (positionsR.error) throw new Error(positionsR.error.message);
    if (feesR.error) throw new Error(feesR.error.message);
    if (costsR.error) throw new Error(costsR.error.message);
    if (settingsR.error) throw new Error(settingsR.error.message);

    const positions = positionsR.data ?? [];
    const realFees = feesR.data ?? [];
    const infraCosts = costsR.data ?? [];
    const paperFeeBps = settingsR.data?.paper_fee_bps ?? 26;
    const isPaper = data.mode === "paper";

    // Aggregate per month
    const monthlyMap = new Map<
      string,
      { revenueCents: number; feeCents: number }
    >();

    for (const p of positions) {
      if (!p.closed_at || p.pnl === null) continue;
      const k = monthKey(p.closed_at);
      const entry = monthlyMap.get(k) ?? { revenueCents: 0, feeCents: 0 };
      entry.revenueCents += Math.round(Number(p.pnl) * 100);
      // Estimated fees for paper mode (real fees handled below for live)
      if (isPaper && p.exit_value) {
        entry.feeCents += Math.round((Number(p.exit_value) * paperFeeBps) / 10000 * 100);
      }
      monthlyMap.set(k, entry);
    }

    if (!isPaper) {
      for (const f of realFees) {
        const k = monthKey(f.traded_at);
        const entry = monthlyMap.get(k) ?? { revenueCents: 0, feeCents: 0 };
        entry.feeCents += f.fee_cents;
        monthlyMap.set(k, entry);
      }
    }

    // Build 12 months
    const monthly: IncomeStatement["monthly"] = [];
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const lastMonth = data.year === currentYear ? now.getUTCMonth() + 1 : 12;

    for (let m = 1; m <= lastMonth; m++) {
      const k = `${data.year}-${String(m).padStart(2, "0")}`;
      const agg = monthlyMap.get(k) ?? { revenueCents: 0, feeCents: 0 };
      const infraCostCents = monthlyInfraCost(infraCosts, k);
      const netTradingCents = agg.revenueCents - agg.feeCents;
      const preTaxCents = netTradingCents - infraCostCents;
      // Tax only on positive realized gains, applied to live mode only
      const taxableForMonth = !isPaper ? Math.max(0, agg.revenueCents) : 0;
      const taxCents = Math.round((taxableForMonth * 2600) / 10000);
      const netCents = preTaxCents - taxCents;
      monthly.push({
        month: k,
        revenueCents: agg.revenueCents,
        feeCents: agg.feeCents,
        netTradingCents,
        infraCostCents,
        preTaxCents,
        taxCents,
        netCents,
      });
    }

    const ytd = monthly.reduce(
      (acc, m) => ({
        revenueCents: acc.revenueCents + m.revenueCents,
        feeCents: acc.feeCents + m.feeCents,
        netTradingCents: acc.netTradingCents + m.netTradingCents,
        infraCostCents: acc.infraCostCents + m.infraCostCents,
        preTaxCents: acc.preTaxCents + m.preTaxCents,
        taxCents: acc.taxCents + m.taxCents,
        netCents: acc.netCents + m.netCents,
      }),
      {
        revenueCents: 0,
        feeCents: 0,
        netTradingCents: 0,
        infraCostCents: 0,
        preTaxCents: 0,
        taxCents: 0,
        netCents: 0,
      },
    );

    const monthsElapsed = monthly.length || 1;
    const runRateAnnual = {
      revenueCents: Math.round((ytd.revenueCents / monthsElapsed) * 12),
      netCents: Math.round((ytd.netCents / monthsElapsed) * 12),
      infraCostCents: Math.round((ytd.infraCostCents / monthsElapsed) * 12),
    };

    return { year: data.year, mode: data.mode, monthly, ytd, runRateAnnual };
  });

export const getTaxSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ year: z.number().int().min(2020).max(2100) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<TaxSummary | { country: string; unsupported: true }> => {
    const { supabase, userId } = context;
    const yearStart = `${data.year}-01-01`;
    const yearEnd = `${data.year + 1}-01-01`;

    const [settingsR, positionsR] = await Promise.all([
      supabase
        .from("settings")
        .select("tax_country,tax_reserve_cents,loss_carryforward_cents")
        .maybeSingle(),
      supabase
        .from("positions")
        .select("pnl,closed_at")
        .eq("mode", "live")
        .eq("status", "closed")
        .gte("closed_at", yearStart)
        .lt("closed_at", yearEnd),
    ]);
    if (settingsR.error) throw new Error(settingsR.error.message);
    if (positionsR.error) throw new Error(positionsR.error.message);

    const country = settingsR.data?.tax_country ?? "IT";
    if (country !== "IT") {
      return { country, unsupported: true };
    }

    const realizedGainCents = (positionsR.data ?? []).reduce(
      (sum, p) => sum + Math.round(Number(p.pnl ?? 0) * 100),
      0,
    );

    return computeItalianTax({
      realizedGainCents,
      lossCarryforwardCents: settingsR.data?.loss_carryforward_cents ?? 0,
      reservedCents: settingsR.data?.tax_reserve_cents ?? 0,
      year: data.year,
    });
  });

// ============= Kraken fee sync (manual trigger) =============
// Will fetch real trades from Kraken once Live mode is connected. For now,
// returns 0 synced trades but the wiring is in place.

export const syncKrakenFees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const apiKey = process.env.KRAKEN_API_KEY;
    const apiSecret = process.env.KRAKEN_API_SECRET;
    if (!apiKey || !apiSecret) {
      return { ok: false as const, synced: 0, error: "API key Kraken non configurate" };
    }

    // Only sync if user is in live mode (paper mode uses estimated fees)
    const { data: settings } = await context.supabase
      .from("settings")
      .select("mode")
      .maybeSingle();

    if (settings?.mode !== "live") {
      return {
        ok: true as const,
        synced: 0,
        note: "Sincronizzazione Kraken disponibile solo in modalità Live.",
      };
    }

    // Real Kraken API call would go here. Implemented as a stub for now
    // since live execution layer is not connected yet.
    try {
      const { fetchKrakenTrades } = await import("@/lib/kraken.server");
      const trades = await fetchKrakenTrades(apiKey, apiSecret);
      if (trades.length === 0) {
        return { ok: true as const, synced: 0 };
      }

      const rows = trades.map((t) => ({
        user_id: context.userId,
        kraken_trade_id: t.tradeId,
        fee_cents: Math.round(t.fee * 100),
        currency: t.feeCurrency,
        pair: t.pair,
        volume: t.volume,
        cost: t.cost,
        traded_at: t.tradedAt,
        raw: t.raw,
      }));

      const { error, count } = await context.supabase
        .from("trade_fees")
        .upsert(rows, { onConflict: "user_id,kraken_trade_id", count: "exact" });
      if (error) throw new Error(error.message);

      return { ok: true as const, synced: count ?? rows.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false as const, synced: 0, error: msg };
    }
  });
