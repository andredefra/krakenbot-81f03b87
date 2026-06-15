
# Migrazione a v2 — Core-Satellite + Universo Dinamico

Sostituisco `STRATEGIA.md` + `BUILD_SPEC.md` con le v2 e allineo codice + DB + UI. Procediamo in 3 fasi per non rompere nulla in un colpo solo.

---

## Fase 1 — Fondamenta (docs, DB, presets, sentiment, UI Strategia/Rischio/Sentiment)

Tutto ciò che si vede subito e che serve per le fasi successive.

### 1.1 Documenti di verità
- Sovrascrivo `src/lib/assistant/STRATEGIA.md` con `STRATEGIA_v2.md`.
- Sovrascrivo `src/lib/assistant/BUILD_SPEC.md` con `BUILD_SPEC_v2.md`.
- L'assistente userà automaticamente le v2 (già caricate via `?raw`).

### 1.2 Schema DB (migration)
Aggiungo a `public.settings` i nuovi campi v2 (con default ragionevoli):
`core_satellite_split jsonb {core:0.6,satellite:0.4}`, `core_weights jsonb {BTC:0.6,ETH:0.4}`,
`min_volume_24h numeric=5_000_000`, `max_spread_pct numeric=0.3`, `min_listing_age_days int=60`,
`macro_ma_period int=200`, `mid_ma_period int=50`, `rebalance_frequency text='monthly'`,
`risk_per_trade_pct numeric=3`, `stop_atr_mult numeric=2`, `stop_min_pct numeric=12`,
`monthly_trade_cap int=8`, `cooldown_hours int=48`, `max_satellite_positions int=2`.
Creo `public.universe` (asset, base, quote, volume_24h, spread_pct, first_seen, eligible, excluded_reason, last_checked) con RLS + GRANT come da convenzioni del progetto.
Aggiungo colonna `sleeve text check in ('core','satellite')` a `positions` (default `satellite`).
Aggiungo `core_value` e `satellite_value` a `portfolio_snapshots`.

### 1.3 Presets riscritti (Core-Satellite v2)
Riscrivo `src/lib/strategy-presets.ts`. I tre preset cambiano significato:

| Preset | Split Core/Sat | Risk/trade | Stop | Trailing | Min target | Trade/mese | Cooldown |
|---|---|---|---|---|---|---|---|
| Conservativo | 75 / 25 | 2% | max(12%, 2×ATR) | +15/-10 | +5% | 4 | 72h |
| Bilanciato (default v2) | 60 / 40 | 3% | max(12%, 2×ATR) | +12/-8 | +4% | 8 | 48h |
| Aggressivo | 45 / 55 | 4% | max(10%, 1.8×ATR) | +12/-8 | +3% | 12 | 24h |

Timeframe sempre `4h/daily`. Aggiorno `detectPreset` per i nuovi campi.

### 1.4 Sentiment pesato dalla strategia
Tolgo l'edit manuale dei pesi: in `Sentiment` resta solo ON/OFF + preview del peso. I pesi sono derivati dal preset attivo (funzione pura `deriveSentimentWeights(preset, enabledSources)` in `src/lib/strategy-presets.ts`):
- Conservativo: F&G 0.7, LunarCrush 0.2, Santiment 0.1 (sentiment "gate" forte).
- Bilanciato: F&G 0.5, LunarCrush 0.3, Santiment 0.2.
- Aggressivo: F&G 0.3, LunarCrush 0.4, Santiment 0.3 (più peso al social per cogliere momentum).
Vengono riscalati sulle sole sorgenti attive. Al cambio preset o toggle, `settings.sentiment_weights` si aggiorna server-side.

### 1.5 UI
- **Strategia**: cards riallineate al nuovo significato (Core-Satellite, universo dinamico, target minimo +4%, max 2 pos satellite, tetto mensile, cooldown). Sezione "Cosa è incluso" aggiornata.
- **Impostazioni rischio**: nuovi campi (split, pesi core, filtri universo, risk_per_trade, stop_atr_mult, monthly_trade_cap, cooldown_hours). Detect preset → Custom se modifico.
- **Sentiment**: solo toggle; mostra peso derivato in sola lettura con tooltip "deriva dal preset".

### 1.6 Backtest
Aggiorno `backtest.functions.ts` + `backtest.server.ts` per simulare Core-Satellite v2:
- 60/40 (o split del preset) BTC/ETH core con regime macro BTC vs SMA200 (uscita/rientro);
- satellite max 2 posizioni con stop ATR, cooldown, tetto mensile, target +4%;
- aggiungo benchmark **DCA BTC/ETH 60/40** (richiesto da §12 v2).
Invalido cache con prefisso `v3|...`.

---

## Fase 2 — Universe-scanner + pagina Universo

- Nuova edge function `supabase/functions/universe-scanner` (cron ~2h via pg_cron + pg_net): elenco coppie Kraken pubbliche → volume24h + spread → upsert in `universe` con `eligible` e `excluded_reason`. `first_seen` auto-popolato.
- Nuova route `src/routes/_authenticated/universe.tsx`: tabella con asset, volume, spread%, età, esito filtri; filtri client per "eligibili".
- Voce nel menu laterale.

## Fase 3 — Split del motore: satellite-engine + core-engine

- Rinomino `trading-engine` → `satellite-engine` (cron 15 min): kill-switch, regime medio BTC vs SMA50 + F&G, gestione posizioni satellite con stop ATR, cooldown, tetto mensile, ordini limit preferiti (placeholder in paper).
- Nuova `core-engine` (cron 1/giorno): regime macro BTC vs SMA200, ribilancio mensile core BTC/ETH ai pesi.
- `daily-summary` aggiornato con sezioni Core/Satellite.
- Aggiorno UI **Posizioni** e **Storico** con colonna **Sleeve**.

---

## Dettagli tecnici

- Tutte le migrations seguono il pattern del progetto (CREATE TABLE → GRANT → RLS → POLICY).
- Le edge function nuove vanno aggiunte a `supabase/config.toml` e schedulate via pg_cron.
- Cache backtest invalidata cambiando l'hash a `v3|`.
- Nessuna logica di trading nel frontend (regola fondamentale v2 §RULE).

---

## Conferme che mi servono prima di partire

1. **Procediamo subito con tutte e 3 le fasi** in un'unica run lunga, o vuoi che ti restituisca il controllo dopo la Fase 1 per validarla?
2. I valori dei tre preset v2 (tabella §1.3) ti vanno bene come default, o vuoi ritoccarli?
3. Posso **eliminare la pagina/edit dei pesi sentiment** (diventano derivati automatici), lasciando solo i toggle ON/OFF?
