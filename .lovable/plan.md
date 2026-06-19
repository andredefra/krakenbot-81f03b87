## Cosa cambia

### A) Backtest allineato a Strategia v4 (engine puro)

Oggi `runBacktest` (in `src/lib/backtest.server.ts`) riceve già i parametri Bear-DCA ma **non li usa**, e ignora `monthly_trade_cap`, `cooldown_hours` e `min_target_pct`. Il live engine (`supabase/functions/trading-engine/index.ts`) invece li applica. Risultato: il backtest stima un numero di trade superiore alla strategia reale e non simula la tranche di accumulo deep-fear.

Aggiungo nel `runBacktest`:

1. **Bear-DCA passivo crypto-only**
   - Quando `bearDca.enabled` e regime macro = risk-off (BTC < SMA200) **e** F&G < `bearDca.fgThreshold` (oggi cablato a 22, lo espongo nei `BearDcaParams`) → apre una tranche BTC pari a `tranchePct%` del capitale, rispettando `intervalDays` tra tranche e `maxPct%` del core come tetto.
   - Quando macro torna risk-on → chiude tutte le tranche DCA (release).
   - Tranche e fee calcolate come per le posizioni satellite.

2. **Disciplina trade satellite**
   - `monthly_trade_cap`: conta i satellite aperti nel mese solare in corso; salta nuove aperture quando raggiunto.
   - `cooldown_hours`: salta riaperture sullo stesso asset entro la finestra (basata sulla data dell'ultima chiusura).
   - `min_target_pct`: pre-check ingresso — se `take_profit_pct < min_target_pct + fee_round_trip` salta l'asset (come fa il live engine).

3. **Pass-through dei parametri preset**
   - `backtest.functions.ts` passa `monthly_trade_cap`, `cooldown_hours`, `min_target_pct` dentro `PresetParams` e legge `bear_dca_fg_threshold` da `settings` per popolare `bearDca.fgThreshold`.

4. **Cache invalidation**
   - Bump `hashInput` da `v6|...` a `v7|...` per invalidare le cache backtest esistenti (le vecchie non simulavano queste regole).

### B) Allineamento copy v3 → v4 ancora presenti

- `src/routes/_authenticated/settings.tsx`
  - Sottotitolo: "Parametri della Strategia v3 (Core-Led 70/30...)" → "Parametri della **Strategia v4 multi-asset** (Core-Led 70/30 default Bilanciato, fee Kraken reali, Bear-DCA opzionale)".
  - Card "Commissioni reali Kraken (v3 — usate anche dal backtest)" → "(v4 — usate anche dal backtest)".
  - Card Timeframe: "v3 raccomandato" → "v4 raccomandato".
  - Toast riallineamento: "tornare al default v2" → "tornare al default v4".

- `src/lib/strategy.functions.ts`
  - Event log "Preset v2 applicato: ..." → "Preset v4 applicato: ...".

- `src/routes/_authenticated/strategia.tsx`
  - Toast "Preset v2 applicato — parametri e pesi sentiment aggiornati" → "Preset v4 applicato — parametri, allocazione asset class e pesi sentiment aggiornati".

### C) Visibilità del legame Preset → pesi sentiment

Il meccanismo esiste già: `applyStrategyPreset` chiama `deriveSentimentWeights(presetId, enabled)` e scrive `sentiment_weights` nelle settings. Manca solo la conferma visiva.

- In ogni **PresetCard** (`strategia.tsx`) aggiungo una mini-riga "Sentiment" con i 3 pesi base più alti per quel preset (es. Aggressivo → "LunarCrush 30% · F&G 25% · Santiment 20%"). Calcolata da `SENTIMENT_BASE` (richiede di esportarla da `strategy-presets.ts`).
- Nella pagina **Sentiment** (`sentiment.tsx`), nel box "Perché i pesi non sono editabili?", aggiungo un piccolo riepilogo "Preset attivo: **Aggressivo** → profilo pesi base derivato qui sotto".

Nessuna modifica alla logica: solo trasparenza.

## File modificati

- `src/lib/backtest.server.ts` — Bear-DCA, monthly_cap, cooldown, min_target nel motore puro.
- `src/lib/backtest.functions.ts` — pass-through nuovi parametri + bump hash a `v7`.
- `src/lib/strategy-presets.ts` — export `SENTIMENT_BASE` (sola visibilità).
- `src/lib/strategy.functions.ts` — testo log v4.
- `src/routes/_authenticated/settings.tsx` — copy v3→v4.
- `src/routes/_authenticated/strategia.tsx` — riga sentiment in PresetCard + toast v4.
- `src/routes/_authenticated/sentiment.tsx` — riga "preset attivo" nel box informativo.

## Cosa NON cambia

- Universo backtest (resta crypto: BTC/ETH core + alt satellite). Il GO LIVE è già crypto-only su Kraken; stocks/forex restano paper-only e fuori dal backtest finché non integriamo un broker.
- Schema DB, RLS, migrations.
- Logica del trading-engine live (già v4 compatibile).
- Mapping `deriveSentimentWeights` (già preset-driven).

## Domanda

Procedo con tutto il pacchetto, oppure preferisci splittare e iniziare solo dal punto **A) backtest** (impatto funzionale maggiore) lasciando i punti B (copy) e C (visibilità sentiment) per dopo?
