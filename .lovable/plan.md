# Fix `getPortfolio` / `getOpenPositions` in LIVE + aggiungi Finnhub

## Cause confermate dal codice

1. **"An error occurred." nella chat** = comportamento di default dell'AI SDK quando un tool lancia un errore. `src/routes/api/chat.ts` non passa `onError` a `toUIMessageStreamResponse`, quindi l'errore reale di Kraken (es. `EAPI:Invalid signature`, `Permission denied`, `MISSING_CREDENTIALS`) viene mascherato. Le tue chiavi sono OK lato Kraken (screenshot conferma tutti i permessi attivi) → il problema è di propagazione, non di permessi.

2. **`getOpenPositions` ritorna `[]`** perché interroga solo la tabella `positions` (dati paper). In LIVE deve leggere da Kraken (`OpenOrders` + saldi spot > 0 + `OpenPositions` per margin/futures).

3. **`getPortfolio` in LIVE può fallire** anche per il nonce: usa `Date.now()*1000` ma se la tua key Kraken Pro è già usata altrove (es. webapp Kraken o un'altra app) il nonce può risultare troppo basso → `EAPI:Invalid nonce`. La causa esatta la vedremo subito una volta sbloccata la propagazione errori.

4. **Azioni / futures**: Kraken offre **xStocks** (token derivati di azioni) tradabili come coppie spot crypto (es. `AAPLxUSD`). Per i prezzi reference di mercato azionario/forex useremo **Finnhub** (nuovo secret) + Alpha Vantage (già presente) come fallback.

## Cosa farò (build mode)

### 1. Propagazione errori chat (fix lampante)
- `src/routes/api/chat.ts` → aggiungo `onError: (err) => err instanceof Error ? err.message : String(err)` a `toUIMessageStreamResponse(...)` così la chat mostra il messaggio Kraken reale invece di "An error occurred.".
- `src/lib/assistant/tools.server.ts` → nei catch di `getPortfolio` (e nuovi tool) ritorno sempre `{ ok: false, error: {...} }` invece di throw, così l'assistente può spiegarlo all'utente senza interrompere lo stream.

### 2. `getOpenPositions` consapevole della modalità
In `tools.server.ts`:
- Legge `settings.mode`.
- **paper** → comportamento attuale (tabella `positions`).
- **live** → chiama Kraken:
  - `/0/private/OpenOrders` per ordini aperti
  - `/0/private/OpenPositions` per posizioni margin/futures
  - `BalanceEx` filtrato per `qty > 0` come "holding aperti" spot
  Ritorna un array unificato `{ source: 'kraken-live', asset, side, qty, entry_price, current_price, opened_at, kind: 'spot'|'margin'|'order' }`.
- Stessa policy errori: `{ ok: false, error }` se Kraken risponde male.

### 3. `getPortfolio` — diagnostica e nonce
- Log server-side esteso (`console.error("[Kraken getPortfolio]", { httpStatus, krakenErrors })`) già presente in `kraken.server.ts` — aggiungo anche il `code` del tipo errore così appare nei runtime logs.
- Nonce: passo da `Date.now()*1000` a un nonce monotonico per-istanza (`Math.max(lastNonce+1, Date.now()*1000)`) per evitare `Invalid nonce` quando il worker fa più chiamate ravvicinate.
- Aggiungo fallback: se `Balance` fallisce con `Permission denied`, provo `TradeBalance` (richiede solo Query Funds) per restituire almeno l'equivalent balance EUR/USD.

### 4. Diagnostica pagina
- `src/routes/_authenticated/diagnostica.tsx` → il pulsante "Test connessione Kraken" già esiste; aggiungo che mostri **il codice errore reale + hint** sotto al risultato (oggi mostra solo OK/KO generico).

### 5. Azioni / futures / forex (xStocks + Finnhub)
- Aggiungo il nuovo secret `FINNHUB_API_KEY` (chiave fornita: `d8qepb9r01qr03ni7tlgd8qepb9r01qr03ni7tm0`) tramite il tool secrets.
- `src/lib/market-data.server.ts` (nuovo) — helper unificato:
  - `fetchStockQuote(symbol)` → Finnhub `/quote` (USD)
  - `fetchForexQuote(pair)` → Finnhub `/forex/rates` con Alpha Vantage fallback
  - `fetchFuturesQuote(symbol)` → Finnhub `/quote` (es. `ES=F`, `NQ=F`)
- `getPortfolio` LIVE: dopo aver letto i saldi Kraken, identifica i token xStocks (suffisso `x` es. `AAPLx`, `TSLAx`) e li classifica come asset class `stocks` invece di `crypto` nella pie chart.
- L'engine V4 in modalità paper userà questi helper per simulare i prezzi di stocks/futures/forex.

### 6. Allineamento `getPortfolio` ⇄ `getOpenPositions`
Entrambi useranno la stessa funzione interna `loadLiveSnapshot()` che ritorna `{ balances, openOrders, openPositions, prices }`, così non possono divergere.

## Cosa devi fare tu

1. **Approvare il piano** (poi passo in build mode).
2. Quando ti chiederò il secret, **confermare l'aggiunta di `FINNHUB_API_KEY`** (la chiave la inserisci tu nel form sicuro — non la metto nel codice).
3. `ALPHA_VANTAGE_API_KEY` è già configurata, non serve toccarla. Anche `KRAKEN_API_KEY` / `KRAKEN_API_SECRET` sono già presenti.

## Sequenza esecuzione

1. Fix `onError` chat + `getOpenPositions` live + nonce monotonico + log estesi → **vedrai subito il vero errore Kraken in chat**.
2. Aggiunta `FINNHUB_API_KEY` secret.
3. Helper `market-data.server.ts` + classificazione xStocks nella pie chart.
4. Diagnostica pagina con errore Kraken dettagliato.

Approva per procedere.
