## Obiettivo
Fermare tutte le attività automatiche che consumano crediti (AI Gateway + Lovable Cloud) senza cancellare dati né codice, così puoi riprendere in futuro.

## Cosa consuma crediti oggi
1. **Cron `ai-strategy-supervisor`** — gira ogni ora per ogni utente `is_running=true`, fa chiamate Gemini (AI Gateway) → costo principale.
2. **Cron `trading-engine`** (edge function Supabase) — gira ogni 5 min, chiama Kraken + market data.
3. **Cron `universe-scanner`, `daily-summary`, `historical-sync`, `tax-reminders`** — chiamate periodiche minori.
4. **Assistente chat** (`/api/chat`) — consuma solo quando lo usi tu, quindi basta non aprirlo.
5. **Backtest** — on-demand, nessun consumo se non lo lanci.

## Piano di stop (soft, reversibile)

### Step 1 — Spegnere il bot per l'utente
Nel DB: `UPDATE settings SET is_running = false WHERE user_id = <tuo>;`
Effetto: il supervisor e il trading-engine saltano subito il ciclo per il tuo utente (loop `for user of users where is_running=true` → vuoto). Zero chiamate AI.

### Step 2 — Disattivare i cron pg_cron su Supabase
Rimuovere/disabilitare gli schedule che chiamano gli endpoint `/api/public/hooks/*` e le edge functions:
- `ai-strategy-supervisor` (orario)
- `trading-engine` (5 min)
- `universe-scanner`
- `daily-summary`
- `historical-sync`
- `tax-reminders`

Comando tipo: `SELECT cron.unschedule('<jobname>');` per ognuno. Così anche se un domani riabiliti `is_running`, nulla parte finché non rischeduli.

### Step 3 — Alert Telegram off (opzionale)
Lasciare le env `TELEGRAM_BOT_TOKEN`/`CHAT_ID` ma, dato che nessun cron gira, non arriveranno più messaggi. Nessuna azione richiesta.

### Step 4 — Non pubblicare / non aprire l'assistente
- Non lanciare "Publish".
- Non aprire la pagina Assistente (ogni messaggio = chiamata Gemini).
- Non lanciare Backtest.

## Come ripartire in futuro
1. `UPDATE settings SET is_running = true …`
2. Ri-schedulare i cron pg_cron con gli stessi nomi/URL.
3. Il codice è intatto, riparte da dov'era.

## Cosa NON tocco
- Nessun file cancellato.
- Nessuna tabella droppata (storico posizioni, report AI, log → restano).
- Nessuna revoca di secrets.

## Conferma richiesta
Vuoi che proceda **solo con Step 1 + Step 2** (spegnimento pulito lato DB + cron), lasciando tutto il codice invariato? Se preferisci un blocco ancora più duro (es. mettere un early-return in cima agli handler cron come safety net), dimmelo e lo aggiungo.