## Stato attuale (verificato ora)

- `cron.job` → vuoto, nessun job schedulato
- `settings.is_running = false` per il tuo utente
- `net.http_request_queue` (pg_net) → 0 richieste pendenti
- Log edge functions ultimi 7 giorni → **zero invocazioni**

Le barre che vedi in *Supabase Dashboard → Edge Functions → Invocations* sono quasi certamente **dati storici** (giorni precedenti allo stop) che restano visibili nel grafico a finestra fissa. Niente sta girando ora.

## Piano di blindaggio (belt-and-suspenders)

Per essere sicuro al 100% che nessuno possa triggerare invocazioni anche manualmente o via URL scoperto, aggiungo un kill-switch hard identico a quello già presente in `universe-scanner` e `historical-sync` anche nelle due edge functions rimaste:

1. **`supabase/functions/trading-engine/index.ts`**
   - Early-return `{ ok: true, skipped: "no users with is_running=true" }` come prima riga utile, PRIMA di qualsiasi fetch Kraken / market data / AI.

2. **`supabase/functions/daily-summary/index.ts`**
   - Stesso early-return in cima, PRIMA di qualsiasi query o chiamata Telegram.

3. **Verifica finale**
   - Rileggo che tutte e 4 le edge functions (`trading-engine`, `daily-summary`, `universe-scanner`, `historical-sync`) abbiano il kill-switch come primo controllo dopo il parse della request.
   - Le edge functions Supabase si deployano automaticamente al prossimo push, **nessun publish richiesto** per loro.

## Cosa NON serve fare

- Nessun `Publish` necessario (le TSS routes hanno già il kill-switch dal turno precedente; Publish serve solo se vuoi il blocco anche in produzione lovable.app).
- Nessuna azione manuale su Supabase.

## Come verificare dopo

Riapri *Edge Functions → Invocations* dopo 24h: il grafico dovrà mostrare zero nuove barre. Se vedi ancora attività, mandami il nome della funzione e i timestamp e cerco la sorgente (probabile trigger esterno o webhook rimasto configurato).

Procedo?