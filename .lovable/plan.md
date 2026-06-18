## Obiettivo

Semplificare la pagina **Strategia → Backtest** per riflettere il nuovo modello in cui l'AI Supervisor decide universo e interruttori in autonomia. L'utente deve poter scegliere solo:

- **Preset** (Conservativo / Bilanciato / Aggressivo)
- **Periodo** (1 / 3 / 5 anni)
- **Capitale iniziale** (€)

Confronto vs **due benchmark** soltanto: **BTC Buy & Hold** e **S&P 500**.

---

## Modifiche

### 1. UI — `src/routes/_authenticated/strategia.tsx`

**Rimozioni:**
- Selettore "Universo satellite" (Solo ETH/SOL / + top alt liquide) e relativo state `universe`.
- Riga riassuntiva "Da X €" → mantengo solo Strategia / BTC / S&P 500 (rimuovo DCA).
- Card KPI: rimuovo `BTC DCA`, `BTC Trend`, `BTC Trend+BearDCA`. Resta grid a 3 colonne: `Strategia v3` (highlight), `BTC Buy & Hold`, `S&P 500`.
- Linee del grafico: rimuovo `dca`, `trendCore`, `trendDca`. Restano `strategy`, `btc`, `spx`.
- Layout form: griglia passa da `md:grid-cols-5` a `md:grid-cols-4` (Preset, Periodo, Capitale, Bottone).
- Descrizione card aggiornata: "Strategia v3 vs BTC Buy & Hold e S&P 500".
- Box "Cosa è incluso": rimuovo bullet su DCA/Trend/BearDCA; aggiorno la riga GO LIVE (vedi sotto).

**Cancello GO LIVE (riformulato):**
Il gate attuale confronta con DCA. Lo riallineo a BTC Buy & Hold (benchmark passivo standard):
- Profit Factor > 1.3
- Sharpe > 0.8
- Sharpe ≥ BTC B&H · *(rinominato)*
- Max DD ≤ BTC B&H · *(rinominato)*

Nota: i campi nel payload `liveGateChecks` restano gli stessi nomi (`beatsDcaSharpe`, `beatsDcaDrawdown`) ma la **logica server** li ricalcola contro BTC B&H per evitare un breaking change di schema. Le label UI mostrano "BTC B&H".

### 2. Server — `src/lib/backtest.functions.ts`

- `inputSchema`: rimuovo il campo `universe`. Internamente il backtest usa sempre l'**universo completo Kraken** (`CORE_ASSETS + SLEEVE_ASSETS`) che rappresenta lo spazio decisionale che l'AI Supervisor può attivare. Nota: il filtro `core_only_mode` o `exclude_fiat_commodity` è AI-driven a runtime, quindi nel backtest storico simuliamo lo scenario "AI lascia libero accesso" come riferimento.
- `hashInput`: bump versione a `v5` + rimozione segmento universe → invalida la vecchia cache.
- `BacktestPayload`: campo `universe` rimosso. (Nessun consumer esterno lo legge oltre alla pagina che sto pulendo.)
- Tabella `backtest_runs`: la colonna `universe` è `NOT NULL` con default `core_sleeve` (verificato dal codice di upsert). Per non rompere: continuo a passare un valore fisso `"ai_managed"` nell'upsert, senza esporlo in UI. Non serve migrazione.

### 3. Server — `src/lib/backtest.server.ts`

- I calcoli `runDcaBenchmark`, `runTrendBtc` e i relativi KPI restano nel motore (potenzialmente utili in diagnostica) ma il payload server li include comunque — la UI semplicemente non li mostra. **Decisione**: per ridurre payload e tempo CPU, **rimuovo** dca / trendCore / trendDca dal `BacktestResult` e dall'`EquityPoint`. Pulizia coerente con l'obiettivo "pulire i dati".
- Aggiorno `liveGateChecks` per usare `btcKpis` invece di `dcaKpis` come riferimento:
  - `beatsDcaSharpe` → `strategyKpis.sharpe >= btcKpis.sharpe`
  - `beatsDcaDrawdown` → `|strategyKpis.maxDD| <= |btcKpis.maxDD|`
- Tipi `BacktestResult` aggiornati (rimossi `dcaKpis`, `trendCoreKpis`, `trendDcaKpis`).

### 4. Assistant tools — `src/lib/assistant/tools.server.ts`

Verifico che `runBacktest` tool (se esposto) non passi più `universe`; se presente lo rimuovo dallo schema e dalla chiamata.

---

## File toccati

- `src/routes/_authenticated/strategia.tsx` — UI semplificata
- `src/lib/backtest.functions.ts` — schema input, hash, payload
- `src/lib/backtest.server.ts` — rimozione benchmark extra, GO LIVE gate vs BTC
- `src/lib/assistant/tools.server.ts` — solo se referenzia `universe`

## Verifica

1. Apro `/strategia`, controllo che il form mostri 4 controlli e non più 5.
2. Run backtest 1y / 3y / 5y su Bilanciato: grafico con 3 linee, 3 card KPI, gate visibile.
3. Cache invalidata correttamente (hash v5).
4. Nessun errore TS sul payload (`dca`, `trendCore`, `trendDca` rimossi dall'`EquityPoint` e dalle KPI).

## Fuori scopo

- Nessuna modifica a `historical_ohlc`, `backtest_runs` schema, AI Supervisor o pagine Diagnostica/Settings.
- Non tocco il motore di esecuzione live.
