# Piano — allineare Assistente ↔ Dashboard/Strategia/Rischio/Diagnostica/Sentiment/Diario/Proposte

## Perché non vedi "ACCUMULO IN CORSO" in Dashboard

Ho controllato la catena:

1. In **Settings** DB il tuo `bear_dca_enabled` è già `true` (l'aveva scritto l'assistente prima).
2. Il badge in Dashboard però controlla `diag.bearDca.active`, non `enabled`. `active = true` si accende **solo** quando l'`trading-engine` (cron ogni 5 min) apre effettivamente una tranche, cioè quando F&G < soglia AND macro=risk-off. Attualmente il mercato non soddisfa la regola → badge spento anche se il flag è armato.
3. In **Diagnostica** la stessa card ha già i 3 stati: `DISABILITATO` / `In attesa` / `ACCUMULO IN CORSO`. In Dashboard invece manca "ARMATO" quando enabled=true ma active=false → sembra che non sia successo nulla.

Fix: aggiungere badge "● ARMATO (attende trigger)" in Dashboard quando `bear_dca_enabled=true && !active`.

## Perché Diario AI / Proposte AI sono vuoti

Il cron orario `ai-strategy-supervisor-hourly` produce due risposte contemporanee ogni ora (una `200 ok`, una `500 SUPABASE_SERVICE_ROLE_KEY missing`). Le tabelle `ai_reports`, `ai_proposals`, `ai_flag_changes` restano vuote e `events_log` non ha righe con `component='ai-supervisor'` — quindi il ramo che scrive report **non viene mai eseguito con successo** sull'ambiente giusto. Serve strumentare l'hook per far emergere l'errore vero.

## Perché quando dici all'assistente "cambia preset a aggressivo" non cambia nulla di visibile

Nel tool `updateRiskSettings`:
- L'enum `strategy_preset` accettava `conservativo|bilanciato|aggressivo` (IT), ma DB e UI usano `conservative|balanced|aggressive` (EN) → validazione Zod fallisce silenziosamente.
- Anche se passasse, il tool scrive **solo la colonna `strategy_preset`**. Tutti i parametri derivati (core/satellite split, MA period, sentiment weights, universi multi-asset, take profit, trailing, cooldown, ecc.) restano ai valori vecchi → Strategia/Rischio/Sentiment mostrano ancora i numeri del preset precedente.

## Interventi (build mode)

### 1. `src/lib/assistant/tools.server.ts` — tool `updateRiskSettings`
- Enum `strategy_preset` accetta sia EN (`conservative|balanced|aggressive`) sia gli alias IT (`conservativo|bilanciato|aggressivo`), normalizzati lato server.
- Quando il patch contiene `strategy_preset`, importa `getPreset`/`deriveSentimentWeights` da `strategy-presets.ts` e costruisce la **cascata completa** (stessi campi di `applyStrategyPreset`): `core_satellite_split`, `core_weights`, `min_volume_24h`, `max_spread_pct`, `min_listing_age_days`, `macro_ma_period`, `mid_ma_period`, `fg_greed_cap`, `max_satellite_positions`, `risk_per_trade_pct`, `stop_atr_mult`, `stop_min_pct`, `trailing_activate_pct`, `trailing_gap_pct`, `take_profit_pct`, `min_target_pct`, `monthly_trade_cap`, `cooldown_hours`, `daily_loss_limit_pct`, `timeframe`, `max_positions`, `max_position_pct`, `stop_loss_pct`, `sentiment_weights`, `asset_class_split`, `stocks_universe`, `futures_universe`, `forex_universe`.
- Eventuali override espliciti passati dall'utente nello stesso patch vincono sulla cascata.
- Ritorna `updated_fields`, `cascaded_from_preset`, e una `note` che spiega quando aspettarsi l'aggiornamento nei badge (Dashboard = subito per i numeri, prossimo ciclo per i flag operativi).
- Descrizione aggiornata di conseguenza.

### 2. `src/routes/_authenticated/dashboard.tsx` — badge Bear-DCA
Nella card "Meso → Satellite" (attorno alle righe 192-207), aggiungere un terzo stato:

```tsx
{diag.bearDca.active ? (
  <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 text-xs">
    ● ACCUMULO IN CORSO
  </Badge>
) : diag.settings?.bear_dca_enabled ? (
  <Badge variant="outline" className="text-xs">
    ● ARMATO
  </Badge>
) : null}
```

Sottotitolo: se armato ma non attivo, aggiungere `· in attesa (F&G ≥ ${fgThreshold} o macro risk-on)`.

### 3. `src/routes/api/public/hooks/ai-strategy-supervisor.ts` — osservabilità
- Sempre scrivere una riga in `events_log` (`component='ai-supervisor'`, level=`info`) alla fine di ogni utente processato, con `{ report_id, flag_changes, proposals }` così vediamo che gira davvero.
- Nel `catch` per-utente scrivere `events_log` con level=`error` e stack completo nel payload.
- Nel `catch` esterno (fatal) idem: prova a scrivere un `events_log` di livello error prima di rispondere 500, così l'errore vero appare in "Diagnostica → Attività recente" invece di sparire in un JSON non visibile.

### 4. Nessuna modifica funzionale a Strategia / Rischio / Sentiment / Diario / Proposte
Queste pagine **già leggono in modo reattivo da `settings`** (React Query con `refetchInterval` o al mount). Una volta che (1) scrive tutta la cascata, si aggiornano da sole al prossimo poll o alla ricarica. Aggiungiamo però nella risposta del tool la `note` esplicita così l'assistente te lo dice in chat.

## File da modificare
- `src/lib/assistant/tools.server.ts` (schema enum + cascata preset + note)
- `src/routes/_authenticated/dashboard.tsx` (badge ARMATO)
- `src/routes/api/public/hooks/ai-strategy-supervisor.ts` (events_log sempre + errori tracciati)

## Verifica post-build
1. Chiedere all'assistente: "cambia preset a aggressivo". Deve rispondere con `updated_fields` che include `strategy_preset` + `cascaded_from_preset` con ~30 campi. Ricaricare Strategia/Rischio/Sentiment: valori nuovi.
2. Chiedere: "attiva bear_dca_enabled". Dashboard mostra subito badge **ARMATO**; entro 5 min, se F&G < soglia in risk-off, passa a **ACCUMULO IN CORSO**.
3. Aprire Diagnostica → Attività recente: entro l'ora appare una riga `ai-supervisor` con esito (o errore reale se il cron fallisce), così possiamo capire perché Diario/Proposte restano vuoti.
