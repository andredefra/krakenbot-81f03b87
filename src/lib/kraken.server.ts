// Server-only Kraken REST client (private API uses HMAC-SHA512).
// Used by syncKrakenFees. Will be exercised once Live mode is connected.

import { createHash, createHmac } from "crypto";

const KRAKEN_BASE = "https://api.kraken.com";

export type NormalizedKrakenTrade = {
  tradeId: string;
  pair: string;
  volume: number;
  cost: number;
  fee: number;
  feeCurrency: string;
  tradedAt: string; // ISO
  raw: unknown;
};

type KrakenTradesResponse = {
  error: string[];
  result?: {
    trades: Record<
      string,
      {
        pair: string;
        time: number;
        type: string;
        ordertype: string;
        price: string;
        cost: string;
        fee: string;
        vol: string;
        margin?: string;
        misc?: string;
      }
    >;
    count: number;
  };
};

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

export async function fetchKrakenTrades(
  apiKey: string,
  apiSecret: string,
): Promise<NormalizedKrakenTrade[]> {
  const path = "/0/private/TradesHistory";
  const nonce = String(Date.now() * 1000);
  const body = new URLSearchParams({ nonce });
  const signature = signKrakenRequest(path, body, nonce, apiSecret);

  const res = await fetch(`${KRAKEN_BASE}${path}`, {
    method: "POST",
    headers: {
      "API-Key": apiKey,
      "API-Sign": signature,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const json = (await res.json()) as KrakenTradesResponse;
  if (json.error && json.error.length > 0) {
    throw new Error(`Kraken: ${json.error.join(", ")}`);
  }
  const trades = json.result?.trades ?? {};
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
