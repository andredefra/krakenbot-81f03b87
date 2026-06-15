# Specifica Tecnica v2 — Bot su Lovable + Supabase

> Allineata a `STRATEGIA_v2.md` (Core-Satellite + universo dinamico). **Sostituisce `BUILD_SPEC.md`.** Per Lovable usa la coppia: `STRATEGIA_v2.md` + questo file.

---

## 1. Architettura

Tre processi server-side, con cadenze diverse. Il frontend Lovable resta solo cruscotto (legge stato, scrive impostazioni; non tocca mai le chiavi).

```
┌──────────────────────────┐      ┌────────────────────────────────────────────┐
│  LOVABLE (frontend)      │      │  SUPABASE (backend, sempre attivo)           │
│  = cruscotto di controllo │◀───▶ │                                              │
│  - portafoglio + grafici  │      │  Postgres (config, universo, posizioni, log)  │
│  - posizioni Core/Satellite│      │  Edge Functions:                             │
│  - universo eleggibile     │      │   • universe-scanner   (ogni ~2h)            │
│  - impostazioni + filtri   │      │   • satellite-engine   (ogni 15 min)         │
│  - toggle sentiment        │      │   • core-engine        (1 volta/giorno)      │
│  - Paper/Live + GO LIVE    │      │   • daily-summary      (1 volta/giorno)      │
└──────────────────────────┘      │  Cron (pg_cron + pg_net) per ciascuna        │
                                   │  Vault/Secrets (chiavi API)                  │
                                   └───────────────┬──────────────────────────────┘
                                                   │
                       ┌───────────────────────────┼───────────────────────────┐
                       ▼                           ▼                            ▼
                  Kraken API                 Fonti sentiment              Telegram Bot API
              (pubblico: pair/volumi/        (Fear&Greed / LunarCrush      (notifiche)
               spread/OHLC; privato:          / Santiment, opzionali)
               ordini in live)
```

**Perché tre processi separati**: il core va controllato di rado (regime di lungo periodo), il satellite spesso (segnali su 4h), e lo scanner dell'universo è pesante ma cambia lentamente. Tenerli separati li mantiene tutti dentro i limiti delle Edge Function.

---

## 2. Componenti

### 2.1 Frontend (Lovable)
Pagine/funzioni:
- **Dashboard**: valore totale, variazione giorno/settimana (da `portfolio_snapshots`), regime macro e medio correnti, Fear & Greed, grafico del valore nel tempo.
- **Posizioni**: tabella con colonna **sleeve (Core / Satellite)**, asset, prezzo d'ingresso, valore attuale, P/L non realizzato (USD e %), prezzo di stop.
- **Storico trade**: trade chiusi con P/L (USD e %), durata, motivo di uscita, sleeve.
- **Universo**: lista degli asset **eleggibili** (da `universe`) con volume 24h, spread, esito dei filtri; utile per vedere cosa il bot considera ora.
- **Impostazioni rischio**: tutti i parametri di `STRATEGIA_v2.md §9` (editabili), inclusi split Core/Satellite, pesi del core e **i filtri dell'universo** (volume min, spread max, età min).
- **Sentiment**: una riga per fonte con interruttore ON/OFF + peso.
- **Modalità**: selettore Paper/Live + pulsante **GO LIVE** con doppia conferma.
- **Log**: ultimi eventi da `events_log`.
- Badge sempre visibile: PAPER/LIVE e `is_running`.
- Autenticazione **Supabase Auth** (solo tu).

### 2.2 Backend (Supabase) — Edge Functions e Cron
- **`universe-scanner`** (cron ~ogni 2h): costruisce la lista degli asset eleggibili (vedi §4.1).
- **`satellite-engine`** (cron ogni 15 min): lo sleeve attivo di momentum (vedi §4.2). Ospita anche il **kill-switch globale** (gira spesso).
- **`core-engine`** (cron 1 volta/giorno): regime macro e ribilancio del core (vedi §4.3).
- **`daily-summary`** (cron 1 volta/giorno, es. 22:00): riepilogo Telegram.
- Funzione/helper Telegram condivisa per l'invio messaggi.
- 4 job di cron: ben sotto il limite consigliato (≤8 concorrenti) e comunque sfalsati.

### 2.3 Integrazione Kraken
- **Pubblico** (nessuna chiave): elenco coppie, volumi/ticker, spread (bid/ask), order book, OHLC. Usato da scanner ed engine.
- **Privato** (solo in live): ordini, con chiave **trade-only, senza prelievo**. Lo **stop loss va piazzato come ordine reale** su Kraken.

### 2.4 Sentiment (con toggle)
- **Fear & Greed (Alternative.me)**: endpoint pubblico, nessun account. Usato come gate di regime. *Consigliato sempre attivo.*
- **LunarCrush / Santiment**: account + API key, opzionali, solo come conferma sul satellite. Coprono bene gli asset grandi, poco/niente la coda lunga: per questo il filtro "copertura sentiment" nell'universo (§4.1) scatta solo se il sentiment è attivo.

### 2.5 Telegram
- Bot via **@BotFather** → `BOT_TOKEN`; ricava il tuo `CHAT_ID`. Le Edge Functions chiamano `sendMessage`. Formati in `STRATEGIA_v2.md §...` (apertura/chiusura/errore/riepilogo). In paper i messaggi indicano `[PAPER]`.

---

## 3. Modello dati (Postgres, RLS attiva ovunque)

- **settings** (riga unica). Oltre ai campi v1, aggiungi:
  `core_satellite_split (jsonb, es. {"core":0.6,"satellite":0.4})`,
  `core_weights (jsonb, es. {"BTC":0.6,"ETH":0.4})`,
  `min_volume_24h`, `max_spread_pct`, `min_listing_age_days`,
  `macro_ma_period (200)`, `mid_ma_period (50)`, `rebalance_frequency ('monthly')`,
  `risk_per_trade_pct`, `stop_atr_mult`, `stop_min_pct`, `trailing_activate_pct`,
  `trailing_gap_pct`, `take_profit_pct`, `min_target_pct`, `max_satellite_positions (2)`,
  `monthly_trade_cap (8)`, `cooldown_hours (48)`, `timeframe`,
  `enabled_sentiment_sources (jsonb)`, `sentiment_weights (jsonb)`,
  `mode ('paper'|'live')`, `is_running (bool)`, `capital_reference`, `kill_switch_floor`,
  `daily_loss_limit_pct`.

- **universe** (lista valutata dallo scanner):
  `asset (pair)`, `base`, `quote`, `volume_24h`, `spread_pct`, `first_seen`,
  `eligible (bool)`, `excluded_reason`, `last_checked`.

- **positions** (aggiungi `sleeve`):
  `id`, **`sleeve ('core'|'satellite')`**, `asset`, `side ('long')`,
  `status ('open'|'closed')`, `mode`, `entry_price`, `entry_value`, `qty`,
  `current_price`, `stop_price`, `trailing_high`, `open_reason`, `opened_at`,
  `exit_price`, `exit_value`, `pnl`, `pnl_pct`, `exit_reason`, `closed_at`, `kraken_order_id`.

- **sentiment_snapshots**: `ts`, `source`, `scope`, `score`, `raw (jsonb)`.
- **portfolio_snapshots**: `ts`, `total_value`, `cash_value`, `core_value`, `satellite_value`, `realized_pnl_day`.
- **events_log**: `ts`, `level`, `component`, `message`.

---

## 4. Flussi dei processi

### 4.1 `universe-scanner` (~ogni 2h)
1. Prendi tutte le coppie attive di Kraken contro stablecoin/USD (endpoint pubblico delle coppie).
2. Per ogni coppia (in **batch**, per non superare i tempi): leggi volume 24h e best bid/ask → calcola lo spread%.
3. Aggiorna/inserisci in `universe`; alle coppie nuove imposta `first_seen = adesso`.
4. Calcola `eligible = volume_24h ≥ min_volume_24h AND spread_pct ≤ max_spread_pct AND (adesso − first_seen) ≥ min_listing_age_days` (e, se il sentiment è attivo, `AND copertura_sentiment`). Scrivi `excluded_reason` per chi non passa.
5. Salva e logga quanti asset risultano eleggibili.

> **Età dalla quotazione**: Kraken non espone una "data di listing" pulita via API. Soluzione robusta: usa il `first_seen` registrato dallo scanner (si auto-popola nel tempo). In alternativa, per una stima immediata, ricava l'età dalla candela OHLC più vecchia disponibile.

### 4.2 `satellite-engine` (ogni 15 min)
1. Carica `settings`. Se `is_running = false` → esci.
2. **Kill-switch globale**: valuta il portafoglio totale (core + satellite + cash). Se ≤ `kill_switch_floor` → `is_running = false`, chiudi tutte le posizioni (in live), notifica `⚠️`, esci.
3. **Limite giornaliero**: se la perdita di oggi supera `daily_loss_limit_pct` → niente nuovi ingressi (gestisci comunque le uscite).
4. Aggiorna prezzi delle posizioni **satellite** aperte; aggiorna `trailing_high`/`stop_price`.
5. **Uscite satellite**: per ogni posizione, verifica stop / trailing / take-profit parziale / inversione trend (media 20<50 su 4h) / regime medio risk-off. Se va chiusa → chiudi (simulata in paper, ordine reale in live), calcola P/L, notifica.
6. **Regime medio**: BTC vs media 50gg + Fear & Greed. Se risk-off → salta gli ingressi.
7. **Ingressi satellite** (se risk-on, posizioni < `max_satellite_positions`, tetto mensile non raggiunto): leggi l'**universo eleggibile** da `universe`, applica i segnali di `STRATEGIA_v2.md §8` (trend, breakout+volume, filtro volatilità, target ≥ `min_target_pct`, conferma sentiment se attivo), controlla **cooldown** e **minimi d'ordine Kraken**. Dimensiona per volatilità (`risk_per_trade_pct`). Apri il/i candidato/i migliore/i con **ordine limit**. Notifica apertura.
8. Salva `portfolio_snapshot`, log.

### 4.3 `core-engine` (1 volta/giorno)
1. Carica `settings`. Calcola il **regime macro**: BTC vs media 200gg.
2. Se **macro-downtrend** e il core è investito → riduci/esci il core verso stablecoin (notifica). Se il macro **recupera** e il core è in cash → rientra ai pesi `core_weights`.
3. Se oggi è il **giorno di ribilancio** (mensile) e il core è investito → ribilancia ai pesi target.
4. Salva snapshot/log e notifica solo se ci sono stati movimenti.

---

## 5. Sicurezza (critico)
- **Chiave Kraken solo-trading, MAI prelievo.**
- **Tutte le chiavi nei Secrets/Vault Supabase**, mai nel DB in chiaro, **mai nel frontend**.
- **RLS** su tutte le tabelle; cruscotto dietro **Supabase Auth**.
- Il frontend **legge** lo stato e **scrive solo** `settings`.
- **GO LIVE** con doppia conferma; parti con size ridotta.
- Le Edge Function serverless non hanno IP di uscita fisso → niente IP allowlist su Kraken; la mitigazione è la chiave trade-only. Per l'IP allowlist servirebbe un worker su VPS.

---

## 6. Limiti noti e mitigazioni
- **Edge Function**: wall clock ~400s totali, CPU ~200ms di calcolo attivo (default 60s, aumentabile). Le nostre funzioni sono I/O-bound: ok se il calcolo resta leggero.
- **Cron**: ogni job ≤10 min, ≤8 job concorrenti consigliati. Noi: 4 job sfalsati.
- **Scanner pesante (500+ coppie)**: gira ogni ~2h (non ogni 15 min), interroga i ticker **in batch**. Se rischi il timeout, spezza la scansione in blocchi su più esecuzioni (o usa una coda). Il `satellite-engine` resta veloce perché legge solo la lista già pronta da `universe`.
- **Affidabilità tra i cicli**: tra due esecuzioni c'è esposizione → **stop loss come ordine reale su Kraken**. Errori + riepilogo giornaliero fungono da "battito".
- **Piano gratuito**: pg_cron + Edge Functions disponibili sul piano hosted; verifica i limiti d'uso correnti del progetto.

---

## 7. Sequenza di build consigliata
1. **Supabase**: progetto, schema (§3) con RLS, Auth, Vault con i secret. Collega a Lovable.
2. **Lovable**: cruscotto in sola lettura (Dashboard, Posizioni, Universo, Log).
3. **`universe-scanner` + cron (~2h)**: popola `universe`. Verifica che la lista eleggibile abbia senso.
4. **`satellite-engine` in PAPER + cron (15 min)**: prezzi Kraken pubblici + Fear & Greed, fill simulati, notifiche Telegram. Legge l'universo eleggibile.
5. **`core-engine` in PAPER + cron (giornaliero)**: regime macro e ribilancio simulati.
6. **Sentiment**: aggiungi LunarCrush/Santiment coi toggle.
7. **Paper run** alcune settimane; usa il backtest e il criterio di promozione (`STRATEGIA_v2.md §11`).
8. **LIVE**: ordini reali Kraken (con stop loss nativo) dietro GO LIVE + conferma. Parti piccolo.

---

## 8. Prompt iniziale da incollare in Lovable

> Allega anche `STRATEGIA_v2.md` e questo file come riferimento. Conviene procedere per fasi (questo prompt copre le fasi 1–3; engine successivi in passi separati).

```
Voglio un cruscotto web personale per controllare un bot di trading crypto su Kraken,
con backend Supabase. Allego STRATEGIA_v2.md e BUILD_SPEC_v2.md: usali come fonte di
verità; se qualcosa è in conflitto, segui i documenti e segnalamelo.

REGOLA FONDAMENTALE: nessuna logica di trading e nessuna chiave API nel frontend.
La logica gira come Supabase Edge Functions schedulate via pg_cron. Il frontend solo
visualizza lo stato e modifica le impostazioni.

ARCHITETTURA (tre processi server-side separati):
- universe-scanner (cron ~ogni 2h): scansiona le coppie Kraken, calcola volume 24h e
  spread, e scrive nella tabella "universe" quali asset sono "eligible" in base ai
  filtri (volume minimo, spread massimo, età minima dalla quotazione via first_seen).
- satellite-engine (cron ogni 15 min): sleeve di momentum attivo; legge l'universo
  eleggibile, gestisce ingressi/uscite, ospita il kill-switch globale. In questa fase
  in modalità PAPER (fill simulati), max 2 posizioni.
- core-engine (cron 1 volta/giorno): gestisce l'allocazione core BTC/ETH in base al
  regime macro (BTC vs media 200 giorni) e ribilancio mensile. In PAPER in questa fase.
- daily-summary (cron 1 volta/giorno): riepilogo Telegram.

DATABASE (Supabase, RLS attiva, single user via Supabase Auth):
- settings (riga unica) con i parametri di STRATEGIA_v2.md §9: mode (default 'paper'),
  is_running (default false), capital_reference, kill_switch_floor, core_satellite_split,
  core_weights, min_volume_24h, max_spread_pct, min_listing_age_days, macro_ma_period,
  mid_ma_period, risk_per_trade_pct, stop_atr_mult, stop_min_pct, trailing_activate_pct,
  trailing_gap_pct, take_profit_pct, min_target_pct, max_satellite_positions,
  monthly_trade_cap, cooldown_hours, timeframe, daily_loss_limit_pct,
  enabled_sentiment_sources (jsonb), sentiment_weights (jsonb).
- universe: asset, base, quote, volume_24h, spread_pct, first_seen, eligible,
  excluded_reason, last_checked.
- positions: con colonna sleeve ('core'|'satellite'), + entry/exit/pnl/stop/trailing,
  status, mode, kraken_order_id.
- sentiment_snapshots, portfolio_snapshots (con core_value e satellite_value), events_log.

FRONTEND (legge dal DB, scrive SOLO settings):
- Dashboard: valore totale, variazione, regime macro/medio, Fear & Greed, grafico valore.
- Posizioni: tabella con colonna Sleeve (Core/Satellite), P/L non realizzato, stop.
- Storico trade: chiusi con P/L (USD e %), durata, motivo, sleeve.
- Universo: tabella degli asset eleggibili con volume, spread, esito filtri.
- Impostazioni: form con i campi numerici di settings, inclusi split Core/Satellite,
  pesi core, e i filtri universo (volume min, spread max, età min).
- Sentiment: riga per fonte con ON/OFF e peso.
- Modalità: selettore Paper/Live + pulsante GO LIVE con doppia conferma (live disabilitato
  in questa fase, etichetta "in arrivo").
- Log. Badge in alto con PAPER/LIVE e is_running.

EDGE FUNCTIONS (stub funzionanti in PAPER + cron):
- universe-scanner come sopra (API pubblica Kraken).
- satellite-engine: legge settings (se is_running false esce), kill-switch globale,
  recupera Fear & Greed (Alternative.me, pubblico), aggiorna posizioni satellite, gestisce
  uscite simulate, calcola regime medio, cerca ingressi sull'universo eleggibile rispettando
  max posizioni, cooldown e minimi Kraken, salva snapshot e logga. Ingressi con una regola
  tecnica base in questa fase.
- core-engine: regime macro BTC vs 200 giorni, gestione/ribilancio core simulati.
- daily-summary: riepilogo.
- Funzione Telegram con i formati di STRATEGIA_v2.md; in paper i messaggi indicano [PAPER].

SECRETS (Supabase Vault, campi vuoti che compilo io, mai nel frontend):
KRAKEN_API_KEY, KRAKEN_API_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
LUNARCRUSH_API_KEY (opz.), SANTIMENT_API_KEY (opz.).

VINCOLI: nessuna logica/chiave nel frontend; RLS ovunque; Edge Functions leggere (rispetta
i limiti Supabase); lo stop loss reale su Kraken NON va implementato ora (è per la fase live).

Quando hai finito, fammi un riepilogo di cosa hai creato e dimmi cosa configurare (secret,
login, cron) prima di passare alla fase successiva.
```
