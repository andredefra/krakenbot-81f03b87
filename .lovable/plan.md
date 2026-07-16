## Cosa serve fare ora

### 1. Publish frontend? NO (non obbligatorio)
Le ultime modifiche di "stop credits" sono state:
- **Database** (`is_running=false` via migration) → già live, non serve publish
- **Cron unschedule** (SQL su Supabase) → già live, non serve publish

Il codice frontend non è stato toccato nell'ultimo giro, quindi **non serve cliccare Update/Publish**. Farlo non cambierebbe nulla dal punto di vista del consumo crediti.

### 2. Serve fare qualcosa su Supabase manualmente? NO
Tutto è già stato eseguito via tool:
- `settings.is_running = false` per tutti gli utenti ✅
- `cron.unschedule(...)` per: `trading-engine`, `daily-summary`, `tax-reminders-daily`, `historical-sync-daily`, `invoke-universe-scanner-2h`, `ai-strategy-supervisor-hourly` ✅

### 3. Verifica opzionale (consigliata)
Se vuoi essere 100% sicuro che nulla giri, posso (in build mode) eseguire due query di controllo su Supabase:
```sql
SELECT jobname, schedule, active FROM cron.job;
SELECT user_id, is_running FROM public.settings;
```
Attesa: `cron.job` vuoto (o solo job non nostri) e `is_running=false` ovunque.

### 4. Cosa NON fare per mantenere consumo ~0
- Non aprire la pagina **Assistente** (ogni messaggio = call a AI Gateway)
- Non lanciare **Backtest** (usa market data API)
- Non lasciare aperta la Dashboard in loop (le query realtime sono leggere ma non nulle)

### 5. Quando vuoi ripartire
Basta dirmelo: rimetto `is_running=true` e rischedulo i cron con un'unica migration.

---

**TL;DR**: non devi fare nulla. Vuoi che lanci le due query di verifica per conferma?
