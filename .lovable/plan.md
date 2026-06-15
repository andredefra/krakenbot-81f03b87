## Cosa sta succedendo davvero

Ho verificato dati e codice:

**1. S&P 500 è davvero piatto — bug reale.**
Tutte e 3 le fonti di `historical-sync` per SPX hanno fallito (`SPX_error: "Tutte le fonti S&P 500 hanno fallito"`), quindi `historical_ohlc` non ha nessuna riga `SPX`. Il backtest engine (`backtest.server.ts:148,246`) quando `spx` è vuoto pusha sempre `startCapital` → linea verde fissa a $1000.

Cause: Yahoo Finance CSV download (`query1.finance.yahoo.com/v7/finance/download`) è stato deprecato/blocca le richieste server-side da metà 2024; Stooq spesso 403/blocca le edge IP senza User-Agent; Alpha Vantage funziona solo se la key esiste (è presente nei secrets) ma il codice chiede `SPY` invece di `^GSPC` e potrebbe rate-limitare.

**2. BTC NON è piatto nei dati** — ho verificato:
```
2024-07 $62k → 2024-12 $97k → 2025-03 $86k → 2025-10 $124k → 2026-03 $65k → 2026-06 $71k
```
Range completo: min $54k, max $124k (oltre 2x). Il problema è puramente di **resa grafica**:
- L'asse Y è in dollari assoluti con `domain={["auto","auto"]}` e parte da 0.
- Se la strategia compounda forte (es. $1000 → $5000) lo Y-axis va 0 → 5000 e la curva BTC che oscilla tra 1000 e 2300 appare schiacciata in basso, quasi una diagonale.
- Inoltre stiamo confrontando BTC buy&hold (1.3x) con strategia leveraged-feel: visualizzazione non comparabile.

## Modifiche

### A. Fix data source S&P 500 (`supabase/functions/historical-sync/index.ts`)

Riscrivo `fetchSpxCombo()` con fonti che funzionano realmente da edge function:

1. **Stooq** con `User-Agent` header (`Mozilla/5.0`) — spesso sblocca il 403.
2. **Alpha Vantage** `TIME_SERIES_DAILY` su `SPY` ETF (già presente, lo lascio come 2°).
3. **Nuovo: Stooq mirror via `?s=spy.us&i=d`** (più stabile di `^spx`).
4. **Rimuovo Yahoo CSV** (endpoint morto da fine 2024) e **sostituisco con `query2.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=5y&interval=1d`** — endpoint JSON ancora attivo, restituisce timestamp + close in `chart.result[0]`.

Ordine nuovo: Yahoo chart JSON → Stooq con UA → Alpha Vantage. Se almeno una restituisce >100 righe → salva.

Poi rilancio `historical-sync` (in build mode) per popolare SPX.

### B. Chart confrontabile (`src/routes/_authenticated/strategia.tsx`)

Cambio il chart da "valore in $" a **"performance % normalizzata"**:
- Aggiungo, lato client, un mapping `equity` → `{ date, strategy: (v/eq0-1)*100, btc: ..., spx: ... }`.
- `YAxis` con `tickFormatter={(v) => `${v.toFixed(0)}%`}` e `domain={["auto","auto"]}` (può andare negativo).
- Tooltip mostra `+X.X%`.
- Etichetta asse / titolo: "Rendimento cumulato (%)".

Così BTC (+30%), strategia (es. +400%) e SPX (+50%) sono tutti visibili e confrontabili, anche se hanno magnitudini diverse. È lo standard dei backtest tool (Portfolio Visualizer, TradingView).

### Non tocco
- `backtest.server.ts` (i KPI sono già in %).
- DB schema, RLS, preset.

## Verifica post-build
1. Lancio `historical-sync` via curl → controllo `SPX: <n>` nel report.
2. `SELECT COUNT(*) FROM historical_ohlc WHERE symbol='SPX'` > 100.
3. Rilancio backtest dall'UI → vedo 3 curve distinte in % e SPX non più piatto.