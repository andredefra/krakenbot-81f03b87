// Server-only Kraken REST client (private API uses HMAC-SHA512).
// Conforme alla doc ufficiale Kraken:
//   API-Sign = HMAC-SHA512( path + SHA256(nonce + POST data), base64Decode(secret) )

import { createHash, createHmac } from "crypto";

const KRAKEN_BASE = "https://api.kraken.com";
let lastKrakenNonce = 0;

// ----------------------------------------------------------------------------
// Error type: porta SEMPRE in chiaro il codice/error string restituito da Kraken
// e lo status HTTP per debugging in UI e nei log.
// ----------------------------------------------------------------------------
export class KrakenApiError extends Error {
  code: string;
  httpStatus: number;
  krakenErrors: string[];
  hint: string | null;
  constructor(params: {
    code: string;
    message: string;
    httpStatus: number;
    krakenErrors: string[];
    hint?: string | null;
  }) {
    super(params.message);
    this.name = "KrakenApiError";
    this.code = params.code;
    this.httpStatus = params.httpStatus;
    this.krakenErrors = params.krakenErrors;
    this.hint = params.hint ?? null;
  }
}

function hintFor(code: string): string | null {
  if (code.includes("Invalid key")) return "API Key Kraken non valida o non riconosciuta. Verifica KRAKEN_API_KEY nei Secrets.";
  if (code.includes("Invalid signature")) return "Firma non valida. Verifica che KRAKEN_API_SECRET sia il secret esatto (base64) generato insieme alla key, senza spazi.";
  if (code.includes("Invalid nonce")) return "Nonce non valido (di solito perché un'altra app usa la stessa key con nonce più alto). Crea una API key dedicata per il bot.";
  if (code.includes("Permission denied")) return "La API Key non ha i permessi necessari. Abilita almeno 'Query Funds' nelle impostazioni della key Kraken.";
  if (code.includes("Rate limit")) return "Troppe richieste in poco tempo verso Kraken. Riprova fra qualche secondo.";
  return null;
}

function parseKrakenError(httpStatus: number, errors: string[]): KrakenApiError {
  const first = errors[0] ?? `HTTP ${httpStatus}`;
  const code = first.replace(/^[EW]/, (m) => m); // tieni prefisso E/W
  return new KrakenApiError({
    code,
    message: `Kraken: ${errors.join("; ")}`,
    httpStatus,
    krakenErrors: errors,
    hint: hintFor(code),
  });
}

function nextKrakenNonce(): string {
  const now = Date.now() * 1000;
  lastKrakenNonce = Math.max(lastKrakenNonce + 1, now);
  return String(lastKrakenNonce);
}

function signKrakenRequest(
  path: string,
  bodyParams: URLSearchParams,
  nonce: string,
  apiSecret: string,
): string {
  const message = bodyParams.toString();
  const sha256 = createHash("sha256").update(nonce + message).digest();
  const pathBuf = Buffer.from(path, "utf8");
  const hmac = createHmac("sha512", Buffer.from(apiSecret, "base64"));
  hmac.update(Buffer.concat([pathBuf, sha256]));
  return hmac.digest("base64");
}

async function krakenPrivate<T>(
  path: string,
  apiKey: string,
  apiSecret: string,
  extra: Record<string, string> = {},
): Promise<T> {
  if (!apiKey || !apiSecret) {
    throw new KrakenApiError({
      code: "MISSING_CREDENTIALS",
      message: "KRAKEN_API_KEY o KRAKEN_API_SECRET non configurate nei Secrets di Supabase.",
      httpStatus: 0,
      krakenErrors: ["MISSING_CREDENTIALS"],
      hint: "Aggiungi entrambi i secrets nel pannello Lovable Cloud → Secrets.",
    });
  }
  const nonce = nextKrakenNonce();
  const body = new URLSearchParams({ nonce, ...extra });
  const signature = signKrakenRequest(path, body, nonce, apiSecret);
  const res = await fetch(`${KRAKEN_BASE}${path}`, {
    method: "POST",
    headers: {
      "API-Key": apiKey,
      "API-Sign": signature,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "krakenbot/1.0",
    },
    body: body.toString(),
  });

  let json: { error?: string[]; result?: T } | null = null;
  let raw = "";
  try {
    raw = await res.text();
    json = raw ? JSON.parse(raw) : null;
  } catch {
    throw new KrakenApiError({
      code: "INVALID_JSON",
      message: `Risposta non-JSON da Kraken (HTTP ${res.status}): ${raw.slice(0, 200)}`,
      httpStatus: res.status,
      krakenErrors: [raw.slice(0, 200)],
    });
  }
  if (!res.ok || (json?.error && json.error.length > 0)) {
    const errors = json?.error?.length ? json.error : [`HTTP ${res.status}`];
    const parsed = parseKrakenError(res.status, errors);
    console.error("[Kraken] error", { path, httpStatus: res.status, code: parsed.code, errors });
    throw parsed;
  }
  return json!.result as T;
}

// ----------------------------------------------------------------------------
// Trades history — usato da bilancio.functions.ts per fees
// ----------------------------------------------------------------------------
export type NormalizedKrakenTrade = {
  tradeId: string;
  pair: string;
  volume: number;
  cost: number;
  fee: number;
  feeCurrency: string;
  tradedAt: string;
  raw: unknown;
};

type KrakenTrade = {
  pair: string; time: number; type: string; ordertype: string;
  price: string; cost: string; fee: string; vol: string;
  margin?: string; misc?: string;
};

export async function fetchKrakenTrades(apiKey: string, apiSecret: string): Promise<NormalizedKrakenTrade[]> {
  const result = await krakenPrivate<{ trades: Record<string, KrakenTrade>; count: number }>(
    "/0/private/TradesHistory",
    apiKey,
    apiSecret,
  );
  const trades = result?.trades ?? {};
  return Object.entries(trades).map(([id, t]) => ({
    tradeId: id,
    pair: t.pair,
    volume: Number(t.vol),
    cost: Number(t.cost),
    fee: Number(t.fee),
    feeCurrency: "EUR",
    tradedAt: new Date(t.time * 1000).toISOString(),
    raw: t,
  }));
}

// ----------------------------------------------------------------------------
// Balance / BalanceEx / TradeBalance — usati da getLivePortfolio
// ----------------------------------------------------------------------------
export type KrakenBalanceMap = Record<string, string>;
export type KrakenBalanceExEntry = { balance: string; hold_trade?: string; credit?: string };
export type KrakenBalanceExMap = Record<string, KrakenBalanceExEntry>;

export async function fetchKrakenBalance(apiKey: string, apiSecret: string): Promise<KrakenBalanceMap> {
  return krakenPrivate<KrakenBalanceMap>("/0/private/Balance", apiKey, apiSecret);
}

export async function fetchKrakenBalanceEx(apiKey: string, apiSecret: string): Promise<KrakenBalanceExMap> {
  return krakenPrivate<KrakenBalanceExMap>("/0/private/BalanceEx", apiKey, apiSecret);
}

export type KrakenTradeBalance = {
  eb: string; // equivalent balance (all assets in base currency)
  tb: string; // trade balance
  m?: string; e?: string; mf?: string; v?: string; n?: string; c?: string;
};

export async function fetchKrakenTradeBalance(
  apiKey: string,
  apiSecret: string,
  asset = "ZUSD",
): Promise<KrakenTradeBalance> {
  return krakenPrivate<KrakenTradeBalance>("/0/private/TradeBalance", apiKey, apiSecret, { asset });
}

export type KrakenOpenOrder = {
  refid?: string | null;
  userref?: number;
  status?: string;
  opentm?: number;
  descr?: { pair?: string; type?: string; ordertype?: string; price?: string; price2?: string; leverage?: string; order?: string };
  vol?: string;
  vol_exec?: string;
  cost?: string;
  fee?: string;
  price?: string;
  stopprice?: string;
  limitprice?: string;
  misc?: string;
  oflags?: string;
};

export type KrakenOpenOrdersResult = { open: Record<string, KrakenOpenOrder> };

export async function fetchKrakenOpenOrders(apiKey: string, apiSecret: string): Promise<KrakenOpenOrdersResult> {
  return krakenPrivate<KrakenOpenOrdersResult>("/0/private/OpenOrders", apiKey, apiSecret);
}

export type KrakenOpenPosition = {
  ordertxid?: string;
  pair?: string;
  time?: number;
  type?: string;
  ordertype?: string;
  cost?: string;
  fee?: string;
  vol?: string;
  vol_closed?: string;
  margin?: string;
  value?: string;
  net?: string;
  terms?: string;
  rollovertm?: string;
  misc?: string;
  oflags?: string;
};

export async function fetchKrakenOpenPositions(apiKey: string, apiSecret: string): Promise<Record<string, KrakenOpenPosition>> {
  return krakenPrivate<Record<string, KrakenOpenPosition>>("/0/private/OpenPositions", apiKey, apiSecret);
}

// ----------------------------------------------------------------------------
// Ticker (public) — per valorizzare i singoli asset in USD
// ----------------------------------------------------------------------------
export async function fetchKrakenPublicTicker(pairs: string[]): Promise<Record<string, number>> {
  if (pairs.length === 0) return {};
  const url = `${KRAKEN_BASE}/0/public/Ticker?pair=${pairs.join(",")}`;
  const r = await fetch(url);
  const raw = await r.text();
  let j: { error?: string[]; result?: Record<string, { c: [string, string] }> };
  try { j = JSON.parse(raw); } catch { throw new KrakenApiError({ code: "INVALID_JSON", message: raw.slice(0, 200), httpStatus: r.status, krakenErrors: [] }); }
  if (j.error?.length) throw parseKrakenError(r.status, j.error);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(j.result ?? {})) {
    const last = parseFloat(v.c?.[0] ?? "0");
    if (!Number.isNaN(last)) out[k] = last;
  }
  return out;
}

// Normalizza il codice asset Kraken (XXBT → BTC, ZUSD → USD, ecc.)
export function normalizeKrakenAsset(raw: string): string {
  const map: Record<string, string> = {
    XXBT: "BTC", XBT: "BTC", XETH: "ETH", XXRP: "XRP", XLTC: "LTC",
    XXDG: "DOGE", XDG: "DOGE", ZUSD: "USD", ZEUR: "EUR", ZGBP: "GBP",
    ZJPY: "JPY", ZCAD: "CAD", ZAUD: "AUD",
  };
  return map[raw] ?? raw.replace(/\.[FSM]$/, ""); // strip .F .S .M (staked, etc.)
}

export function isFiat(symbol: string): boolean {
  return ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF"].includes(symbol);
}
