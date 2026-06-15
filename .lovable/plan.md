# Backtest: storico esteso + trasparenza fee/sentiment

## Problema

Selezionando "5 anni" il grafico parte da agosto 2024 (~2 anni). Causa: l'endpoint pubblico Kraken `OHLC` (interval=1440) restituisce un massimo di ~720 candele daily per pair e non permette di andare più indietro nel tempo. Il backtest si allinea sul timeline BTC quindi tutto viene troncato.

In più non è chiaro all'utente cosa entra nel calcolo: commissioni, slippage, sentiment.

## Cosa fare

### 1. Fonte storica crypto più lunga (CoinGecko)

Aggiungere in `supabase/functions/historical-sync/index.ts` un fetcher CoinGecko come **fallback/estensione** per BTC/ETH/SOL/ADA/LINK/AVAX/DOT/XRP/LTC:

- Endpoint pubblico: `https://api.coingecko.com/api/v3/coins/{id}/market_chart?vs_currency=usd&days=max&interval=daily`
- Restituisce close daily fino al 2013 (BTC) / inception per le altre
- Gratuito senza API key (rate limit ~10-30 req/min → fetch sequenziale con `await sleep(2500)` tra simboli)
- Strategia merge: prima carica CoinGecko (storico lungo, solo close), poi sovrascrive con Kraken (ultimi 2 anni, OHLC completo). Upsert per `(symbol, date)` già gestito.

Vantaggi: 5 anni reali per tutti, niente costi, niente chiavi.

Limite accettato: per il periodo > 2 anni avremo solo `close` (high/low/open = close). Il backtest engine usa solo `close`, quindi nessun impatto sui risultati.

### 2. Validazione "Periodo" in UI

Se l'utente seleziona 5 anni ma in DB ci sono meno candele BTC, mostrare un badge sotto il chart: "Storico disponibile da AAAA-MM-DD".

### 3. Trasparenza fee/sentiment nella pagina Strategia

Aggiungere sotto il grafico una piccola sezione "Cosa è incluso nel calcolo":

- **Commissioni**: 0.4% per lato (taker fee Kraken Pro tier base)
- **Slippage**: 0.1% per lato
- **Filtro Fear & Greed**: blocca nuovi ingressi sopra la soglia del preset (Bilanciato: 75)
- **Filtro regime BTC**: SMA50/SMA200 a seconda del preset

Così l'utente sa esattamente cosa sta vedendo.

### 4. Invalidare la cache backtest

`backtest_runs` ha risultati cachati con lo storico vecchio: bumpare `hashInput` aggiungendo un suffisso versione (`v2`) per forzare ricalcolo.

## File toccati

- `supabase/functions/historical-sync/index.ts` — aggiunta `fetchCoinGeckoDailyHistory()` + merge prima di Kraken
- `src/lib/backtest.functions.ts` — bump versione hash
- `src/routes/_authenticated/strategia.tsx` — badge "storico disponibile da" + sezione "Cosa è incluso"

## Dopo il deploy

Eseguo `historical-sync` per popolare lo storico CoinGecko (la prima sync impiega ~30-60 secondi per i 9 simboli per rispettare i rate limit).

## Note

- Non tocco l'engine `backtest.server.ts`: fee, slippage e F&G greed cap sono già applicati correttamente.
- Non aggiungo "uscite su sentiment estremo" perché non è in STRATEGIA.md — se lo vuoi lo discutiamo a parte.
