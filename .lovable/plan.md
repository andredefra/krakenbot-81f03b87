# Migrazione Strategia v2 → v3

Lo scope tocca **engine, backtest, schema DB, 8 pagine UI, assistant AI e log**. Per evitare un PR-monstre lo spezzo in **5 fasi indipendenti**, ognuna verificabile da sola. Dimmi se l'ordine va bene o quali fasi vuoi prima/saltare.

---

## Fase 1 — Fondamenta: Fee reali Kraken + documenti v3
Senza questa, tutto il resto mente sui numeri.

- Sostituisco `src/lib/assistant/STRATEGIA.md` con la **v3** (allegata). Aggiungo `BACKTEST_v3.md` con la metodologia (walk-forward, doppio benchmark, cancello promozione).
- Migrazione DB su `settings`:
  - `maker_fee_pct` (default `0.25`), `taker_fee_pct` (default `0.40`), `slippage_pct` (default `0.05`).
  - `core_only_mode boolean default false`.
  - `bear_dca_enabled boolean default false`, `bear_dca_fg_threshold int default 22`, `bear_dca_cap_pct numeric default 30`, `bear_dca_tranche_pct numeric default 5`, `bear_dca_interval_days int default 14`.
  - `exclude_fiat_commodity boolean default true`.
  - `min_target_pct` → default `5`, `max_trades_per_month` → default `6`, `max_satellite_positions` → default `2`.
- Aggiorno `strategy-presets.ts`:
  - **Bilanciato**: core 70 / satellite 30
  - **Conservativo**: core 85 / satellite 15 ("quasi spento")
  - **Aggressivo**: core 55 / satellite 45 + warning "sconsigliato in bear"
- Pagina **Rischio/Strategia** mostra e permette di editare i 3 campi fee + toggle "Modalità core-only".

## Fase 2 — Backtest v3 nel motore TS esistente
Il `backtest_v3.py` è la specifica; lo porto in `src/lib/backtest.server.ts` (non eseguo Python in prod).

- Aggiungo strategie comparate: `buy_hold`, `dca`, `trend_core`, `trend_dca` — replicando esattamente la logica del file Python.
- Le fee usate = quelle salvate in `settings` (mai più 0.1% hardcoded).
- `runBacktestFn` ritorna 4 equity curves + metriche (CAGR, Sharpe, Sortino, MaxDD, Calmar, PF, Win%).
- Nuova metrica salvata in `backtest_runs`: `passes_live_gate boolean` calcolata da PF > 1.3 AND Sharpe > 0.8 AND batte DCA su Sharpe AND su MaxDD.
- Pagina backtest: nuovi grafici con 4 linee + tabella metriche + badge **PASS/FAIL** del cancello.

## Fase 3 — Engine: Bear-DCA + satellite severo + igiene universo
- `supabase/functions/trading-engine`:
  - Se `bear_dca_enabled` e `fg_value < threshold` e budget DCA residuo > 0 e ultimo DCA > intervallo → apri tranche, marcata `sleeve='DCA'`, NON chiudere su downtrend (tieni finché trend macro riparte).
  - Satellite: rispetta `max_satellite_positions=2`, `min_target_pct=5`, conta trade mese e blocca > `max_trades_per_month`.
  - Core-only mode: salta interamente la sezione satellite.
- `supabase/functions/universe-scanner`:
  - Se `exclude_fiat_commodity` → filtra ZEUR, USDT/USDC/DAI/PAXG, EURT, XAUT ecc. (lista hardcoded curata).
- Migrazione: aggiungo colonna `sleeve text` su `positions` (`core` | `satellite` | `dca`) + `fee_paid_usd numeric`.

## Fase 4 — UI: Dashboard, Posizioni, Storico, Bilancio, Diagnostica
Tutto solo presentazione, niente logica:

- **Dashboard**: card "Allocazione" (Core/Satellite/Cash con valore + %), grafico portfolio con 2 linee extra Buy&Hold e DCA, badge "Bear-DCA: on/off" + "Accumulo in corso" quando deep fear.
- **Posizioni**: colonna `Sleeve`, colonna `Fee pagate`, `P/L netto`.
- **Storico**: stesse colonne + header con PF cumulato, Win rate, Fee totali.
- **Bilancio**: blocco allocazione per sleeve, riga "Commissioni cumulate".
- **Diagnostica**: 
  - mostra SMA20/SMA50 per ogni asset anche quando il gate BTC è rosso (oggi "—")
  - riquadro "Commissioni in uso" (legge da settings)
  - riquadro Bear-DCA (deep fear sì/no, budget residuo)
  - delta strategia vs Buy&Hold e vs DCA (da ultimo backtest)

## Fase 5 — Cancello GO LIVE + Log + Assistente
- **Modalità**: pulsante GO LIVE **disabilitato** se ultimo backtest out-of-sample non passa il cancello. Checklist con 4 spunte verdi/rosse e motivo del blocco.
- **Log**: nuovi tipi evento `bear_dca_tranche`, `regime_flip_macro`, `regime_flip_meso`, `backtest_run` con PASS/FAIL. Già paginati (lavoro precedente).
- **Assistente** (`tools.server.ts`):
  - Nuovo tool `get_live_gate_status` → leggi ultimo `backtest_runs`, ritorna checklist.
  - Nuovo tool `get_allocation_breakdown` → core/satellite/cash + DCA budget.
  - Aggiorno system prompt: l'assistente deve saper rispondere "perché oggi non apre" citando regime + fee + cancello.

---

## Dettagli tecnici trasversali

- **Compatibilità preset esistenti**: i 3 preset attuali in `strategy-presets.ts` vengono aggiornati in-place, non rinominati, così settings utente esistenti non si rompono.
- **Tipi DB**: dopo ogni migrazione, `src/integrations/supabase/types.ts` viene rigenerato da Lovable — la fase di codice TS la scrivo subito dopo.
- **Fee in cents**: tengo `numeric` su `settings`, converto a frazione (`/100`) nei calcoli.
- **Sleeve='DCA' su positions**: le posizioni Bear-DCA NON contano nel limite `max_satellite_positions`.

## Domande prima di partire
1. Procediamo **fase per fase** o vuoi un mega-batch? (Consiglio fase per fase, così verifichi a vista.)
2. Le **fee in `settings` sono per-utente** o globali di sistema? (Default proposto: per-utente, editabili in pagina Rischio.)
3. Il backtest **walk-forward** (split train/test temporale automatico) lo vuoi già in Fase 2 o lo aggiungiamo dopo come iterazione?
