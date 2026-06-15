// Edge Function: historical-sync
// Popola le tabelle historical_ohlc (crypto + SPX) e fg_history.
// Esecuzione: una volta al giorno via cron, oppure a richiesta dall'app.
//
// Fonti:
//  - Kraken OHLC daily (gratis, paginazione via `since`) per BTC/ETH/SOL/ADA/LINK/AVAX/DOT/XRP/LTC
//  - S&P 500: combinazione → Stooq (primario, no key) → Alpha Vantage (TIME_SERIES_DAILY_ADJUSTED, fallback) → Yahoo (terzo livello)
//  - Alternative.me fng?limit=0 per storico Fear & Greed dal 2018

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALPHA_VANTAGE_KEY = Deno.env.get("ALPHA_VANTAGE_API_KEY") ?? "";

const CRYPTO_SYMBOLS: Record<string, string> = {
  BTC: "XBTUSD",
  ETH: "ETHUSD",
  SOL: "SOLUSD",
  ADA: "ADAUSD",
  LINK: "LINKUSD",
  AVAX: "AVAXUSD",
  DOT: "DOTUSD",
  XRP: "XRPUSD",
  LTC: "LTCUSD",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supa = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });

  const report: Record<string, unknown> = {};
  try {
    // 1. Crypto via Kraken (5y ≈ 1825 candele, Kraken restituisce ~720 per call → paginare)
    for (const [sym, pair] of Object.entries(CRYPTO_SYMBOLS)) {
      try {
        const rows = await fetchKrakenDailyHistory(pair, 5);
        if (rows.length) {
          await upsertOhlc(supa, sym, "kraken", rows);
          report[sym] = rows.length;
        }
      } catch (e) {
        report[`${sym}_error`] = String(e);
      }
    }

    // 2. S&P 500 (combo)
    try {
      const spxRows = await fetchSpxCombo();
      if (spxRows.length) {
        await upsertOhlc(supa, "SPX", spxRows[0].source, spxRows.map((r) => ({ date: r.date, open: r.close, high: r.close, low: r.close, close: r.close, volume: 0 })));
        report["SPX"] = spxRows.length;
        report["SPX_source"] = spxRows[0].source;
      }
    } catch (e) {
      report["SPX_error"] = String(e);
    }

    // 3. Fear & Greed history
    try {
      const fg = await fetchFgHistory();
      if (fg.length) {
        // chunk to 1000
        for (let i = 0; i < fg.length; i += 1000) {
          await supa.from("fg_history").upsert(fg.slice(i, i + 1000), { onConflict: "date" });
        }
        report["fg"] = fg.length;
      }
    } catch (e) {
      report["fg_error"] = String(e);
    }

    return new Response(JSON.stringify({ ok: true, report }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e), report }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});

type OhlcRow = { date: string; open: number; high: number; low: number; close: number; volume: number };

async function fetchKrakenDailyHistory(pair: string, years: number): Promise<OhlcRow[]> {
  const sinceTs = Math.floor((Date.now() - years * 365.25 * 86400 * 1000) / 1000);
  let since = sinceTs;
  const out: OhlcRow[] = [];
  // Kraken OHLC returns max ~720 rows per call → loop
  for (let attempt = 0; attempt < 10; attempt++) {
    const r = await fetch(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=1440&since=${since}`);
    if (!r.ok) throw new Error(`Kraken HTTP ${r.status}`);
    const j = await r.json();
    if (j.error?.length) throw new Error(`Kraken: ${j.error.join(",")}`);
    const result = j.result as Record<string, unknown>;
    const key = Object.keys(result).find((k) => k !== "last");
    if (!key) break;
    const rows = result[key] as Array<[number, string, string, string, string, string, string, number]>;
    if (!rows.length) break;
    for (const row of rows) {
      const ts = row[0];
      out.push({
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        open: parseFloat(row[1]),
        high: parseFloat(row[2]),
        low: parseFloat(row[3]),
        close: parseFloat(row[4]),
        volume: parseFloat(row[6]),
      });
    }
    const last = Number(result["last"]);
    if (!last || last <= since) break;
    since = last;
    // throttle
    await new Promise((res) => setTimeout(res, 500));
  }
  // dedupe by date
  const m = new Map<string, OhlcRow>();
  for (const r of out) m.set(r.date, r);
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function upsertOhlc(supa: ReturnType<typeof createClient>, symbol: string, source: string, rows: OhlcRow[]) {
  const payload = rows.map((r) => ({ symbol, source, ...r }));
  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await supa.from("historical_ohlc").upsert(payload.slice(i, i + 500), { onConflict: "symbol,date" });
    if (error) throw error;
  }
}

async function fetchSpxCombo(): Promise<Array<{ date: string; close: number; source: string }>> {
  const UA = { "User-Agent": "Mozilla/5.0 (compatible; KrakenBot/1.0)" };

  // 1) Yahoo chart JSON (endpoint v8, ancora attivo)
  for (const sym of ["%5EGSPC", "SPY"]) {
    try {
      const r = await fetch(
        `https://query2.finance.yahoo.com/v8/finance/chart/${sym}?range=5y&interval=1d`,
        { headers: UA },
      );
      if (r.ok) {
        const j = await r.json();
        const result = j?.chart?.result?.[0];
        const ts: number[] = result?.timestamp ?? [];
        const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
        const out: Array<{ date: string; close: number; source: string }> = [];
        for (let i = 0; i < ts.length; i++) {
          const c = closes[i];
          if (c == null || !isFinite(c)) continue;
          const d = new Date(ts[i] * 1000).toISOString().slice(0, 10);
          out.push({ date: d, close: c, source: `yahoo:${sym}` });
        }
        if (out.length > 100) return out;
      }
    } catch (_e) { /* fall through */ }
  }

  // 2) Stooq (con UA, prova sia ^spx che spy.us)
  for (const sym of ["%5Espx", "spy.us"]) {
    try {
      const r = await fetch(`https://stooq.com/q/d/l/?s=${sym}&i=d`, { headers: UA });
      if (r.ok) {
        const txt = await r.text();
        const lines = txt.trim().split("\n").slice(1);
        const out: Array<{ date: string; close: number; source: string }> = [];
        for (const ln of lines) {
          const cols = ln.split(",");
          if (cols.length < 5) continue;
          const close = parseFloat(cols[4]);
          if (!isFinite(close)) continue;
          out.push({ date: cols[0], close, source: `stooq:${sym}` });
        }
        if (out.length > 100) return out;
      }
    } catch (_e) { /* fall through */ }
  }

  // 3) Alpha Vantage SPY ETF
  if (ALPHA_VANTAGE_KEY) {
    try {
      const r = await fetch(`https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=SPY&outputsize=full&apikey=${ALPHA_VANTAGE_KEY}`);
      if (r.ok) {
        const j = await r.json();
        const series = j["Time Series (Daily)"] as Record<string, Record<string, string>> | undefined;
        if (series) {
          const out: Array<{ date: string; close: number; source: string }> = [];
          for (const [date, vals] of Object.entries(series)) {
            const c = parseFloat(vals["4. close"]);
            if (isFinite(c)) out.push({ date, close: c, source: "alphavantage" });
          }
          if (out.length > 100) return out.sort((a, b) => a.date.localeCompare(b.date));
        }
      }
    } catch (_e) { /* fall through */ }
  }

  throw new Error("Tutte le fonti S&P 500 hanno fallito");
}


async function fetchFgHistory(): Promise<Array<{ date: string; value: number; classification: string }>> {
  const r = await fetch("https://api.alternative.me/fng/?limit=0");
  if (!r.ok) throw new Error(`F&G HTTP ${r.status}`);
  const j = await r.json();
  const data = j.data as Array<{ timestamp: string; value: string; value_classification: string }>;
  return data.map((d) => ({
    date: new Date(parseInt(d.timestamp, 10) * 1000).toISOString().slice(0, 10),
    value: parseInt(d.value, 10),
    classification: d.value_classification,
  }));
}
