
# Fase 1 — Fondamenta, cruscotto e motore PAPER

> Documenti seguiti come fonte di verità: `STRATEGIA.md` e `BUILD_SPEC.md`.
> Solo Fase 1: nessun trading live, nessun ordine reale Kraken.

---

## ⚠ Conflitto da segnalarti subito (importante)

I tuoi documenti dicono **Supabase Edge Functions + pg_cron**. Lo stack attuale di questo progetto Lovable è **TanStack Start** e di default preferirebbe TanStack server functions per la logica server-side.

Per la regola che mi hai dato ("seguire i documenti"), **userò Supabase Edge Functions** (Deno) per `trading-engine` e `daily-summary`, invocate da `pg_cron` + `pg_net`. Questo è coerente con BUILD_SPEC §2.2 e §4 e ti lascia un bot "vero" che gira 24/7 anche senza il frontend aperto. Segnalo solo che è una scelta "fuori stack di default" — accettabile e ben supportata da Supabase.

Frontend: resta React + Tailwind dentro TanStack Start (route protette dietro Supabase Auth tramite il layout `_authenticated/`).

---

## 1. Database (migration unica, RLS ovunque)

Tabelle nel schema `public`, tutte con `user_id uuid not null default auth.uid() references auth.users(id) on delete cascade`, RLS attiva, policy `user_id = auth.uid()` per SELECT/INSERT/UPDATE/DELETE. `GRANT` per `authenticated` + `service_role`. Trigger `updated_at` su `settings` e `positions`.

- **settings** (riga singola per utente, unique su `user_id`)
  Campi e default da STRATEGIA §3:
  `mode='paper'`, `is_running=false`, `capital_reference=318`, `kill_switch_floor=159`, `max_positions=3`, `max_position_pct=30`, `stop_loss_pct=10`, `trailing_activate_pct=10`, `trailing_gap_pct=7`, `take_profit_pct=20`, `min_target_pct=2`, `daily_loss_limit_pct=8`, `timeframe='1h'`, `enabled_sentiment_sources={fear_greed:true,lunarcrush:false,santiment:false,news:false}`, `sentiment_weights={fear_greed:1,lunarcrush:0.5,santiment:0.5,news:0.3}`, `asset_universe={core:['ETH','SOL'],momentum:['ADA','LINK','AVAX','DOT'],regime:['BTC']}`.
  Trigger: alla `INSERT` di un nuovo utente in `auth.users`, crea automaticamente la riga `settings` di default (funzione + trigger `on_auth_user_created`).

- **positions** — schema esatto come da tuo prompt; indice su `(user_id, status)` e `(user_id, closed_at desc)`.
- **sentiment_snapshots** — indice su `(user_id, ts desc, source)`.
- **portfolio_snapshots** — indice su `(user_id, ts desc)`.
- **events_log** — indice su `(user_id, ts desc)`.

Abilito le extension `pg_cron` e `pg_net` nello stesso migration.

## 2. Autenticazione

- Supabase Auth email/password (single-user di fatto, ma protetto via RLS — se per errore qualcuno si registra non vede comunque i tuoi dati).
- Pagina `/auth` (login + signup minimale).
- Rotte protette sotto `src/routes/_authenticated/` (layout managed dall'integrazione: gate client-side che redirige a `/auth`).
- **Disabilito le signup pubbliche** dopo che ti registri — te lo ricordo nel riepilogo finale (va fatto a mano nel dashboard Supabase).

## 3. Frontend — cruscotto in sola lettura (scrive solo `settings`)

Tema scuro sobrio (zinc/slate scuro), accent verde per profitti e rosso per perdite. Layout con sidebar fissa + topbar con **badge modalità** (`PAPER` ambra / `LIVE` rosso) e **badge stato** (`RUNNING` verde / `STOPPED` grigio).

Rotte (tutte sotto `_authenticated/`):

- `/` **Dashboard** — KPI: valore totale, var. 24h e 7d (da `portfolio_snapshots`), regime corrente, Fear & Greed (ultimo snapshot `source='fear_greed'`), grafico area del valore portafoglio (Recharts).
- `/positions` **Posizioni aperte** — tabella `status='open'`: asset, entry_price, current_price, valore attuale, uPnL $/%, stop_price.
- `/history` **Storico trade** — tabella `status='closed'` ordinata desc: asset, entry/exit, P/L $/%, durata, exit_reason.
- `/settings` **Impostazioni rischio** — form (react-hook-form + zod) su tutti i numerici di STRATEGIA §3, salva su `settings`.
- `/sentiment` **Sentiment** — 4 righe (Fear&Greed, LunarCrush, Santiment, Notizie) con Switch ON/OFF + input peso 0–1; salva su `enabled_sentiment_sources` e `sentiment_weights`.
- `/mode` **Modalità** — selettore Paper/Live (Live disabilitato in Fase 1), toggle `is_running`, pulsante **GO LIVE** disabilitato con label "in arrivo — Fase 2".
- `/logs` **Log** — ultimi 200 eventi da `events_log`, con badge livello.

Dati letti via `@tanstack/react-query` + client browser Supabase, con realtime subscription su `positions`, `portfolio_snapshots`, `events_log` per aggiornamenti live.

## 4. Backend — Edge Functions Supabase

### `supabase/functions/trading-engine/index.ts` (PAPER only)

Flusso da BUILD_SPEC §4:

1. Per ogni utente con `settings.is_running=true`:
2. Calcola valore totale (cash simulato + Σ positions aperte a `current_price`). Se ≤ `kill_switch_floor` → set `is_running=false`, log + Telegram `⚠️`, esci.
3. Verifica limite giornaliero (P/L oggi vs `daily_loss_limit_pct`): se sforato, niente nuovi ingressi.
4. Fetch prezzi Kraken pubblico `/0/public/Ticker?pair=...` per universe + BTC.
5. Aggiorna `current_price`, `trailing_high`, `stop_price` di ogni posizione aperta.
6. **Gestione uscite (simulate)**: stop loss, trailing (attiva a +`trailing_activate_pct`, gap `trailing_gap_pct`), take profit; chiude la posizione, calcola pnl, scrive `exit_*` + Telegram `[PAPER]`.
7. Calcola regime: BTC vs SMA50 daily (fetch OHLC) + Fear&Greed da `https://api.alternative.me/fng/`.
8. Salva `sentiment_snapshots` per ogni fonte abilitata (in Fase 1: solo Fear&Greed; LunarCrush/Santiment stub se chiave presente, altrimenti skip con log).
9. **Stub ingressi**: regola tecnica base (es. SMA20 > SMA50 su 1h + breakout massimo 24h) rispettando `max_positions`, `max_position_pct`, target minimo, e un minimo d'ordine indicativo (es. 5 USD). Apertura simulata → insert in `positions` con `mode='paper'` + Telegram apertura.
10. Insert `portfolio_snapshot` + `events_log` per ogni step rilevante.

Usa `supabase-js` con `SUPABASE_SERVICE_ROLE_KEY` (service role) per leggere/scrivere bypassando RLS dal server.

### `supabase/functions/daily-summary/index.ts`

Costruisce il messaggio formato STRATEGIA §7 e invia su Telegram. Una sola query aggregata + `sendMessage`.

### Helper `supabase/functions/_shared/telegram.ts`

`sendTelegram(text)` → POST a `https://api.telegram.org/bot{TOKEN}/sendMessage` (HTML parse_mode). I 4 formatter esatti di STRATEGIA §7 (apertura, chiusura, errore, riepilogo) con prefisso `[PAPER]` o `[LIVE]`. Se il token o chat_id mancano → log e no-op (non rompe il ciclo).

### Cron (via tool `supabase--insert`, non migration)

```
cron.schedule('trading-engine','*/5 * * * *', net.http_post(<func-url>, {Authorization: Bearer SERVICE_ROLE}, '{}'))
cron.schedule('daily-summary','0 22 * * *', ...)
```

## 5. Secrets predisposti (Supabase Edge Function secrets)

Te li chiederò con `secrets--add_secret` come campi vuoti, da compilare tu:
`KRAKEN_API_KEY`, `KRAKEN_API_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `LUNARCRUSH_API_KEY` (opz.), `SANTIMENT_API_KEY` (opz.).

Mai esposti al frontend, mai in tabella.

---

## Dettagli tecnici (per riferimento)

- Migration in un singolo file SQL con `create extension if not exists pg_cron`/`pg_net`, tipi enum (`trade_mode`, `position_status`, `event_level`), tutte le tabelle + GRANTs + RLS + policies + trigger updated_at + trigger handle_new_user.
- Schedule cron creato con `supabase--insert` (contiene URL + service role) dopo il deploy delle Edge Functions, non in migration (per non leakarli al remix).
- Realtime: `alter publication supabase_realtime add table public.positions, public.portfolio_snapshots, public.events_log`.
- Tipi TypeScript Supabase rigenerati dopo migration; il codice frontend usa quei tipi.
- Niente logica trading nel frontend, niente chiamate dirette a Kraken/Telegram dal browser.

## Cosa NON faccio in Fase 1 (esplicitamente)

- Nessun ordine reale Kraken (API privata non chiamata).
- Stop loss come ordine nativo Kraken: rinviato a Fase 2.
- Pulsante GO LIVE: visibile ma disabilitato.
- LunarCrush/Santiment: solo predisposti, fetch effettivo in fase successiva (o quando aggiungi la chiave).

## Cosa dovrai fare tu dopo l'implementazione

1. Registrarti su `/auth` (creazione automatica della riga settings).
2. Compilare i secret Supabase (almeno TELEGRAM_*).
3. Disabilitare le signup pubbliche nel dashboard Supabase Auth.
4. Verificare che i 2 cron job siano attivi (`select * from cron.job`).
5. Mettere `is_running=true` da `/mode` per far partire il motore in PAPER.

Quando tutto questo è pronto, ti fermo per validare prima della Fase 2 (LunarCrush/Santiment veri + go-live Kraken).
