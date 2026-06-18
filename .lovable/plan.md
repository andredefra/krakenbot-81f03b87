## Fase 5b — Pulizia label v2 → v3

Trovati 3 riferimenti residui alla "v2" mentre tutta la pipeline è già v3:

1. **`src/routes/_authenticated/sentiment.tsx` (riga 81)**
   - Testo attuale: *"La Strategia v2 sceglie da sé l'intensità…"*
   - Nuovo testo: spiegare in ottica v3 — Fear & Greed è anche il gate del Bear-DCA (soglia `bear_dca_fg_threshold`, default 22); LunarCrush/Santiment confermano i satellite (max `monthly_trade_cap` al mese, filtro fiat/oro). I pesi restano derivati dal preset Core-Led.

2. **`src/routes/_authenticated/diagnostica.tsx` (riga 27)**
   - Titolo: *"Diagnostica engine v2"* → *"Diagnostica engine v3"*
   - Sottotitolo: aggiungere Bear-DCA e fee reali nella descrizione ("regimi macro/meso, Core / Satellite / Bear-DCA, universo dinamico, fee Kraken reali").

3. **`src/routes/_authenticated/dashboard.tsx` (riga 106)**
   - Sottotitolo: *"v2 Core+Satellite"* → *"v3 Core-Led + Satellite + Bear-DCA"*.

Nessuna modifica logica: solo copy/label per allineare l'UI alla strategia attiva.

## Fase 6 — Backtest di prova + verifica engine

Dopo il riallineamento:

1. **Lancio backtest v3** dalla pagina `/strategia` per ognuno dei 3 preset (Conservative / Balanced / Aggressive) sull'orizzonte standard.
   - Verificare popolamento di `backtest_runs` con: Sharpe, Sortino, Profit Factor, max DD, `passes_live_gate`.
   - Confronto delle 6 equity lines (strategia + BTC Buy&Hold, BTC DCA, BTC Trend SMA200, BTC Trend+BearDCA, S&P 500).
   - Verifica visiva del pannello GO LIVE Gate (PF>1.3, Sharpe>0.8, Sharpe≥BTC DCA, maxDD≤BTC DCA).

2. **Verifica engine in paper**:
   - Forzare un ciclo `trading-engine` (o aspettare il prossimo cron) e leggere `engine_diagnostics`:
     - `bear_dca_state` valorizzato (active/deployed_usd/cap_usd/tranches).
     - `core_state.held` coerente con i target weights.
     - `universe_eligible` filtrato dai fiat/commodity quando `exclude_fiat_commodity=ON`.
   - Verificare che le nuove `positions` abbiano `sleeve` corretto (core/satellite/dca) e `fee_paid_usd` valorizzato.
   - Controllare log `events_log` per eventuali errori delle validazioni v3 (min_target_pct vs taker_fee, monthly_trade_cap, soglia Bear-DCA).

3. **Report finale all'utente** con:
   - Tabella esiti backtest per preset (PF, Sharpe, maxDD, gate ✓/✗).
   - Snapshot diagnostica corrente (regime, sleeve, Bear-DCA, fee totali).
   - Eventuali anomalie e raccomandazioni di tuning.

## Tecnico

- File toccati in fase 5b: 3 edit testuali (1 riga ciascuno), nessuna migrazione DB, nessun deploy edge function.
- Per il backtest: chiamata server function già esistente `runBacktest` (`src/lib/backtest.functions.ts`).
- Per il ciclo engine: trigger manuale via Supabase `curl_edge_functions` su `trading-engine` (già deployato in Fase 3).