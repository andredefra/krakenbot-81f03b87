## 1. Badge "solo PAPER" — chiarimento e fix

Hai ragione: l'intero sistema è in PAPER finché non promuovi a LIVE, quindi marcare solo Azioni/Futures/Forex come "solo PAPER" è fuorviante (sembra che le crypto siano già live). Il badge era pensato per dire "anche in LIVE queste classi resteranno simulate finché Kraken non abilita lo strumento", ma genera confusione.

**Fix**: rimuovo i badge "solo PAPER" dalla card *Allocazione per classe di asset* (`AssetClassPanel` in `src/routes/_authenticated/strategia.tsx`). Sposto la nota in una riga descrittiva sotto, neutra: "Azioni/Futures/Forex saranno operativi in LIVE solo quando Kraken abilita lo strumento sul tuo account". Nessun cambiamento di logica.

## 2. Backtest — perché perde contro BTC e S&P, e come renderlo onesto e migliore

Lo screenshot mostra Bilanciato 3y: Strategia +26.5% / BTC +94.8% / SPX +67.3%, con MaxDD strategia -51.6% ≈ BTC -52.5%. Il motivo è che il core (70%) viene comprato day-1 e **tenuto sempre**, senza filtro di regime: in pratica la strategia è "70% BTC/ETH buy & hold + satellite che pareggia (PF 1.02) + Bear-DCA che drena cash". Risultato matematico: ~70% del rendimento di BTC con lo stesso drawdown. Non può battere BTC così.

### Cosa cambio nel motore (`src/lib/backtest.server.ts`)

1. **Regime filter sul CORE** (non più solo sul satellite). Quando il filtro macro (BTC vs SMA200) è risk-off, il core esce in stable e rientra al ritorno risk-on. È il vero motore di outperformance risk-adjusted: salta il bear del 2025 che oggi affossa la curva.
2. **Bear-DCA ridisegnato**: le tranche accumulate in deep fear vengono **rilasciate dentro il core** al ritorno risk-on (non vendute a cash). Così la DCA dà boost al rientro invece di realizzare quel poco.
3. **Forward-fill pulito sulla curva S&P** (oggi c'è un fallback strano che distorce i gap weekend).
4. **Fee benchmark coerenti**: BTC B&H paga 1 fee di ingresso (già ok), S&P stessa cosa — già coerente, lascio.
5. **Sizing satellite**: oggi usa `max_position_pct` di (cash+mtm) ma scala su tutto il portafoglio satellite; lo bloccco al **budget satellite reale** così non sfora e non drena il core.

Atteso (qualitativo, non promesso): su 3 anni che includono il bear 2025, la strategia dovrebbe finire con CAGR più basso di BTC in bull pieno ma **MaxDD molto più piccolo** (target -20/-25% vs -52% di BTC) e **Sharpe ≥ BTC**. Su 1y/5y idem. Se in un certo periodo BTC fa solo bull, la strategia farà meno — questo è inevitabile e onesto, ma il gate GO LIVE è proprio risk-adjusted (Sharpe + MaxDD), non rendimento assoluto.

### Cosa NON cambio
- Niente parametri "magici" tirati per far vincere il backtest a posteriori (sarebbe overfit). I tre preset restano quelli definiti in `strategy-presets.ts`.
- Niente leva, niente short.
- Universo satellite resta AI-managed (come già deciso): il backtest usa il pool storico come proxy.

### UI backtest (`src/routes/_authenticated/strategia.tsx` → `BacktestSection`)
- Confermo selettore **1 anno / 3 anni / 5 anni** e i 3 benchmark **Strategia v4 / BTC B&H / S&P 500** (già a posto, lo lascio).
- Aggiungo una riga di lettura onesta sotto i KPI: "La strategia v4 mira a Sharpe ≥ BTC e MaxDD ≤ BTC, non al rendimento assoluto in bull". Così è chiaro cosa stai guardando.
- Invalido la cache `backtest_runs` per la nuova versione (bump `input_hash` a `v8`) così rivedi subito i risultati nuovi.

## File toccati
- `src/routes/_authenticated/strategia.tsx` — rimozione badge "solo PAPER" + nota riga sotto + riga di lettura nel BacktestSection.
- `src/lib/backtest.server.ts` — regime filter sul core, Bear-DCA che rilascia nel core, fix forward-fill SPX, sizing satellite vincolato al budget satellite.
- `src/lib/backtest.functions.ts` — bump `input_hash` a `v8` per bustare la cache.

## Verifica
Dopo l'implementazione lancio il backtest 1y/3y/5y in headless e verifico: (a) MaxDD strategia < MaxDD BTC, (b) Sharpe strategia ≥ Sharpe BTC sui 3 orizzonti, (c) nessun crash di runBacktest. Se uno dei tre orizzonti non passa il gate lo dico chiaramente invece di forzare i numeri.