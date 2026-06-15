# Specifica Tecnica di Realizzazione — Bot su Lovable + Supabase

> Il "come". Da leggere insieme a `STRATEGIA.md`. Pensato per essere costruito con **Lovable** (cruscotto) + **Supabase** (motore e dati).

---

## 1. Architettura (punto chiave)

Un bot deve girare **24/7 lato server**, anche col tuo PC spento. Un'app Lovable è frontend: gira nel browser quando la pagina è aperta. Quindi **la logica di trading NON va nel frontend**. Divisione corretta:

```
┌─────────────────────────┐        ┌──────────────────────────────────────┐
│  LOVABLE (frontend)     │        │  SUPABASE (backend, sempre attivo)     │
│  = cruscotto di controllo│ ◀────▶ │                                        │
│  - vede portafoglio      │        │  Postgres (dati: config, trade, log)   │
│  - storico trade         │        │  Edge Functions (la logica)            │
│  - impostazioni rischio  │        │   • trading-engine  (motore)           │
│  - toggle sentiment      │        │   • daily-summary   (riepilogo)        │
│  - interruttore Paper/Live│        │  Cron (pg_cron) → invoca il motore     │
│  - pulsante GO LIVE      │        │   ogni 5–10 min                        │
└─────────────────────────┘        │  Vault/Secrets (chiavi API)            │
                                    └───────────────┬────────────────────────┘
                                                    │
                            ┌───────────────────────┼───────────────────────┐
                            ▼                       ▼                        ▼
                       Kraken API            Fonti sentiment           Telegram Bot API
                    (prezzi + ordini)   (Fear&Greed / LunarCrush / …)   (notifiche)
```

Il frontend **legge** lo stato dal database e **scrive** solo le impostazioni. Non tocca mai le chiavi di Kraken/Telegram.

---

## 2. Componenti

### 2.1 Frontend (Lovable)
Pagine/funzioni:
- **Dashboard**: valore totale portafoglio, variazione giorno/settimana, regime corrente, Fear&Greed.
- **Posizioni aperte**: asset, prezzo ingresso, valore attuale, P/L non realizzato, stop.
- **Storico trade**: lista chiusi con P/L $ e %, durata, motivo.
- **Impostazioni rischio**: tutti i parametri di `STRATEGIA.md` §3 (editabili).
- **Sentiment**: una riga per fonte con interruttore ON/OFF + peso.
- **Modalità**: interruttore **Paper / Live** + pulsante **GO LIVE** con doppia conferma.
- **Log**: ultimi eventi/errori.
- Autenticazione **Supabase Auth** → solo tu accedi.

### 2.2 Backend (Supabase)
- **Postgres**: tabelle (vedi §3) con **RLS attiva**.
- **Edge Functions**:
  - `trading-engine` — il ciclo principale (vedi §4). Invocata dal Cron.
  - `daily-summary` — costruisce e invia il riepilogo giornaliero.
  - (opz.) `go-live` — endpoint che valida e attiva la modalità live in modo controllato.
- **Cron (pg_cron + pg_net)**: invoca `trading-engine` ogni 5–10 min e `daily-summary` una volta al giorno.
- **Vault/Secrets**: tutte le chiavi (vedi §5).

### 2.3 Integrazione Kraken
- **Dati pubblici** (prezzi, OHLC, order book): API pubblica, nessuna chiave.
- **Ordini** (solo in modalità Live): API privata con chiave **trade-only** (vedi §5).
- In modalità Live, piazzare lo **stop loss come ordine reale** su Kraken (vedi §6) così scatta anche se il motore salta un giro.

### 2.4 Integrazione fonti sentiment (con toggle)
- **Fear & Greed (Alternative.me)**: endpoint pubblico, nessun account. *Consigliato sempre attivo.*
  → crea account solo se vuoi la versione di CoinMarketCap; per iniziare non serve.
- **LunarCrush**: account + API key. Social sentiment, Galaxy Score, social volume.
- **Santiment**: account + API key. On-chain + social.
- **Notizie (opzionale)**: aggregatore con API (es. CryptoPanic) — verifica i termini del piano gratuito.

Il motore legge `settings.enabled_sentiment_sources` e interroga **solo** le fonti accese, salvando i valori in `sentiment_snapshots`.

### 2.5 Integrazione Telegram
- Crea un bot con **@BotFather** → ottieni il `BOT_TOKEN`.
- Ricava il tuo `CHAT_ID` (scrivi al bot e leggi `getUpdates`, oppure usa un bot tipo @userinfobot).
- Le Edge Functions chiamano `https://api.telegram.org/bot{TOKEN}/sendMessage`.

---

## 3. Modello dati (tabelle Postgres)

- **settings** (riga singola di configurazione)
  `mode (paper|live)`, `is_running (bool)`, `capital_reference`, `kill_switch_floor`,
  `max_positions`, `max_position_pct`, `stop_loss_pct`, `trailing_activate_pct`, `trailing_gap_pct`,
  `take_profit_pct`, `min_target_pct`, `daily_loss_limit_pct`, `timeframe`,
  `enabled_sentiment_sources (jsonb)`, `sentiment_weights (jsonb)`, `asset_universe (jsonb)`.

- **positions**
  `id`, `asset`, `side (long)`, `status (open|closed)`, `mode`,
  `entry_price`, `entry_value`, `qty`, `current_price`,
  `stop_price`, `trailing_high`, `open_reason`, `opened_at`,
  `exit_price`, `exit_value`, `pnl`, `pnl_pct`, `exit_reason`, `closed_at`,
  `kraken_order_id` (in live).

- **sentiment_snapshots**
  `ts`, `source`, `scope (market|<asset>)`, `score`, `raw (jsonb)`.

- **portfolio_snapshots**
  `ts`, `total_value`, `cash_value`, `positions_value`, `realized_pnl_day`.

- **events_log**
  `ts`, `level (info|warn|error)`, `component`, `message`.

---

## 4. Flusso del `trading-engine` (a ogni invocazione del cron)

1. **Carica** `settings`. Se `is_running = false` → esci.
2. **Kill-switch**: calcola valore totale portafoglio. Se ≤ `kill_switch_floor` → metti `is_running = false`, chiudi le posizioni (in live), notifica `⚠️` e termina.
3. **Limite giornaliero**: se la perdita di oggi supera `daily_loss_limit_pct` → niente nuovi ingressi (gestisci comunque le uscite).
4. **Aggiorna prezzi** delle posizioni aperte (Kraken pubblico) e i relativi `current_price`, `trailing_high`, `stop_price`.
5. **Gestisci uscite**: per ogni posizione aperta, verifica stop / trailing / take-profit / inversione trend / regime / sentiment. Se va chiusa → chiudi (simulata in paper, ordine reale in live), calcola P/L, aggiorna `positions`, notifica chiusura.
6. **Regime**: calcola risk-on/off (trend BTC + Fear&Greed).
7. **Sentiment**: interroga le fonti accese, salva snapshot.
8. **Cerca ingressi** (solo se risk-on, posizioni < max, limite giorno non superato): scorri l'universo, applica i segnali di §5.2 di `STRATEGIA.md`, controlla minimi Kraken e target minimo. Se valido → apri (simulato/reale), notifica apertura.
9. **Salva** `portfolio_snapshot` e log.

> Mantieni il codice **leggero**: il grosso del tempo è attesa di risposte HTTP (compatibile coi limiti, vedi §7).

---

## 5. Sicurezza (critico — riguarda i tuoi soldi)

- **Chiave API Kraken con permesso SOLO trading, MAI prelievo.** Anche se trapelasse, nessuno può portarti via i fondi, solo (al peggio) fare trade.
- **Tutte le chiavi nei Secrets/Vault di Supabase**, mai nel database in chiaro, **mai nel codice frontend**. Per accedere ai token in modo sicuro nelle chiamate alle Edge Function, Supabase raccomanda di conservarli nel Vault.
- **RLS attiva** su tutte le tabelle; cruscotto dietro **Supabase Auth** (solo il tuo account).
- Il frontend **legge** lo stato e **scrive solo** la tabella `settings`; non vede né maneggia le chiavi di exchange/Telegram.
- **GO LIVE** con doppia conferma; consigliato partire con size ridotta.
- **Nota sull'IP allowlisting di Kraken**: le Edge Functions serverless **non hanno un IP di uscita fisso**, quindi limitare la chiave a un IP non è pratico con questo setup. La mitigazione è la chiave **trade-only**. Se in futuro vuoi l'IP allowlist, serve un piccolo worker su VPS sempre acceso (alternativa più "robusta" ma da gestire a mano).

---

## 6. Limiti noti e mitigazioni

- **Limiti Edge Function**: il limite di wall clock è ~400 secondi per la durata totale e la CPU è limitata a ~200 ms di calcolo attivo; l'esecuzione di default è 60s sul piano Pro e si può aumentare. La nostra logica è I/O-bound (attese di rete), quindi rientra senza problemi se il calcolo resta leggero.
- **Limiti Cron**: ogni Job dovrebbe durare non più di 10 minuti e si raccomanda non più di 8 Job concorrenti. Noi usiamo 1–2 job, ben sotto i limiti.
- **Affidabilità tra un giro e l'altro**: tra due esecuzioni (5–10 min) c'è esposizione. Per lo stop loss, **piazzalo come ordine reale su Kraken** così scatta anche se il motore salta un ciclo. Le notifiche di errore + il riepilogo giornaliero fungono da "battito" per accorgerti se qualcosa è fermo.
- **Piano gratuito**: pg_cron ed Edge Functions sono disponibili sul piano hosted; verifica i limiti d'uso correnti del tuo progetto.

---

## 7. Sequenza di build consigliata

1. **Supabase**: crea progetto, schema tabelle (§3), Auth, Vault con i secret. Collega il progetto a Lovable.
2. **Lovable**: costruisci il cruscotto in sola lettura (legge dalle tabelle).
3. **`trading-engine` in PAPER**: prezzi pubblici Kraken + Fear&Greed, fill simulati, notifiche Telegram. Collega il Cron (ogni 5–10 min).
4. **Sentiment**: aggiungi LunarCrush/Santiment con i toggle.
5. **Paper run**: lascialo girare alcune settimane, guarda le notifiche, tara i parametri.
6. **LIVE**: aggiungi gli ordini reali Kraken (con stop loss nativo) dietro il pulsante GO LIVE + conferma. Parti piccolo.
7. **Monitoraggio**: tieni d'occhio errori e riepiloghi.

---

## 8. Prompt iniziale da incollare in Lovable

> Da usare per far partire lo scaffold. La logica dettagliata del motore conviene rifinirla in un secondo momento (in Lovable o con Claude Code), passo 3+ qui sopra.

```
Costruisci un cruscotto web per controllare un bot di trading crypto personale,
con backend Supabase. NON inserire la logica di trading nel frontend: il motore
gira come Supabase Edge Function schedulata via cron.

FRONTEND (solo per me, dietro Supabase Auth):
- Dashboard: valore totale del portafoglio, variazione giorno/settimana, regime
  di mercato corrente, indice Fear & Greed.
- Tabella "Posizioni aperte": asset, prezzo d'ingresso, valore attuale, P/L
  non realizzato (USD e %), prezzo di stop.
- Tabella "Storico trade": trade chiusi con P/L (USD e %), durata, motivo di uscita.
- Pagina "Impostazioni rischio" con campi editabili: capitale di riferimento,
  stop globale (kill-switch), numero max posizioni, dimensione max per posizione (%),
  stop loss (%), trailing (attivazione % e gap %), take-profit (%), target minimo (%),
  limite di perdita giornaliero (%), timeframe.
- Pagina "Sentiment": una riga per fonte (Fear&Greed, LunarCrush, Santiment, Notizie)
  con interruttore ON/OFF e peso.
- Selettore modalità "Paper / Live" e pulsante "GO LIVE" con doppia conferma.
- Pagina "Log" con gli ultimi eventi.

BACKEND (Supabase):
- Tabelle: settings, positions, sentiment_snapshots, portfolio_snapshots, events_log,
  con Row Level Security attiva.
- Edge Function "trading-engine" (stub iniziale) invocata da pg_cron ogni 5 minuti.
- Edge Function "daily-summary" invocata una volta al giorno.
- Le chiavi API (Kraken, Telegram, LunarCrush, Santiment) vanno nei Secrets/Vault
  di Supabase, MAI nel frontend.

Il frontend deve solo leggere lo stato dalle tabelle e scrivere la tabella settings.
```
