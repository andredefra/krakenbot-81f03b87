// Edge Function: universe-scanner
// Scansiona le coppie USD di Kraken, calcola volume 24h (USD) e spread (%) e
// aggiorna public.universe con eligible=true/false in base alle soglie globali
// (settings di un utente di riferimento — usa le soglie più conservative).
// Lanciato da cron ogni ~2h.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Asset da escludere dal satellite: core + stablecoin (sempre)
const EXCLUDE = new Set([
  "BTC", "XBT", "ETH",
  "USDT", "USDC", "DAI", "USD", "EUR", "USDS", "PYUSD", "TUSD", "RLUSD",
  "EURT", "GBP", "JPY", "CAD", "AUD", "CHF",
]);
// Token tokenizzati di fiat o commodity (oro, argento): esclusi se exclude_fiat_commodity = true (v3)
const FIAT_COMMODITY = new Set([
  "PAXG", "XAUT", "ZEUR", "ZUSD", "EURT", "USDP", "USTC", "XAGT",
]);

type AssetPair = {
  altname: string;
  wsname?: string;
  base: string;
  quote: string;
};

type TickerRow = {
  a: [string, string, string]; // ask [price, whole, lot]
  b: [string, string, string]; // bid
  c: [string, string];         // last [price, lot]
  v: [string, string];         // volume [today, 24h] in base
  p: [string, string];         // vwap [today, 24h]
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supa = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });

  try {
    // Soglie: prendi la più conservativa fra gli utenti attivi (fallback default)
    const { data: settingsRows } = await supa
      .from("settings")
      .select("min_volume_24h,max_spread_pct,min_listing_age_days,is_running")
      .eq("is_running", true);
    const minVol = Math.min(...(settingsRows ?? []).map((s) => Number(s.min_volume_24h)).filter((n) => !Number.isNaN(n)), 5_000_000);
    const maxSpread = Math.min(...(settingsRows ?? []).map((s) => Number(s.max_spread_pct)).filter((n) => !Number.isNaN(n)), 0.3);
    const minAge = Math.min(...(settingsRows ?? []).map((s) => Number(s.min_listing_age_days)).filter((n) => !Number.isNaN(n)), 60);

    // 1) Lista coppie
    const apResp = await fetch("https://api.kraken.com/0/public/AssetPairs");
    if (!apResp.ok) throw new Error(`AssetPairs HTTP ${apResp.status}`);
    const apJson = await apResp.json();
    if (apJson.error?.length) throw new Error(`Kraken: ${apJson.error.join(";")}`);
    const allPairs = apJson.result as Record<string, AssetPair>;

    // Filtra USD-quoted (ZUSD o USD)
    const usdPairs = Object.entries(allPairs).filter(([_, p]) => {
      const q = (p.quote || "").replace(/^Z/, "");
      return q === "USD";
    });

    // Costruisci mapping pairKey -> baseSymbol (normalizzato senza X/Z prefisso Kraken)
    const pairList: Array<{ key: string; altname: string; base: string }> = usdPairs.map(([key, p]) => {
      const base = (p.base || "").replace(/^X(?=[A-Z]{3,})/, "").replace(/^XBT$/, "BTC");
      return { key, altname: p.altname, base };
    }).filter((p) => !EXCLUDE.has(p.base));

    // 2) Ticker batch (Kraken accetta lista, ma per sicurezza spezza)
    const tickers: Record<string, TickerRow> = {};
    const CHUNK = 60;
    for (let i = 0; i < pairList.length; i += CHUNK) {
      const slice = pairList.slice(i, i + CHUNK);
      const url = `https://api.kraken.com/0/public/Ticker?pair=${slice.map((p) => p.altname).join(",")}`;
      const tr = await fetch(url);
      if (!tr.ok) continue;
      const tj = await tr.json();
      if (tj.error?.length) continue;
      Object.assign(tickers, tj.result as Record<string, TickerRow>);
    }

    // 3) Compute + upsert
    const now = new Date().toISOString();
    let upserts = 0, eligibleCount = 0;

    for (const p of pairList) {
      // Trova ticker entry: chiave Kraken (key) o altname
      const t = tickers[p.key] ?? tickers[p.altname]
        ?? Object.entries(tickers).find(([k]) => k === p.key || k.endsWith(p.altname))?.[1];
      if (!t) continue;

      const last = parseFloat(t.c[0]);
      const ask = parseFloat(t.a[0]);
      const bid = parseFloat(t.b[0]);
      const vol24Base = parseFloat(t.v[1]);
      const vwap24 = parseFloat(t.p[1]) || last;
      if (!Number.isFinite(last) || last <= 0) continue;

      const volume_24h = vol24Base * vwap24; // USD
      const spread_pct = ask > 0 && bid > 0 ? ((ask - bid) / ((ask + bid) / 2)) * 100 : null;

      // Mantieni first_seen se già esiste
      const { data: existing } = await supa
        .from("universe").select("first_seen").eq("asset", p.base).maybeSingle();
      const firstSeen = existing?.first_seen ?? now;
      const ageDays = (Date.now() - new Date(firstSeen).getTime()) / 86400000;

      let eligible = true;
      let reason: string | null = null;
      if (!Number.isFinite(volume_24h) || volume_24h < minVol) {
        eligible = false; reason = `Volume 24h ${(volume_24h || 0).toFixed(0)} < min ${minVol}`;
      } else if (spread_pct != null && spread_pct > maxSpread) {
        eligible = false; reason = `Spread ${spread_pct.toFixed(3)}% > max ${maxSpread}%`;
      } else if (ageDays < minAge) {
        eligible = false; reason = `Età ${ageDays.toFixed(0)}d < min ${minAge}d`;
      }

      const { error: uerr } = await supa.from("universe").upsert({
        asset: p.base,
        base: p.base,
        quote: "USD",
        volume_24h,
        spread_pct,
        first_seen: firstSeen,
        eligible,
        excluded_reason: reason,
        last_checked: now,
      }, { onConflict: "asset" });
      if (!uerr) { upserts += 1; if (eligible) eligibleCount += 1; }
    }

    console.log(`[universe-scanner] ${upserts} upserts, ${eligibleCount} eligible (minVol=${minVol}, maxSpread=${maxSpread}%, minAge=${minAge}d)`);

    return new Response(JSON.stringify({ ok: true, upserts, eligibleCount, thresholds: { minVol, maxSpread, minAge } }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
