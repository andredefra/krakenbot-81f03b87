## Obiettivo
Fix sintetico ai 3 problemi (P/L 0 su TG fuorviante, "Conto Economico" disallineato, AI Supervisor non genera report/proposte) + reset PAPER pulito per risincronizzare da Kraken.

## 1. Daily summary Telegram — distinguere realizzato vs non realizzato
**File**: `supabase/functions/daily-summary/index.ts` + `supabase/functions/_shared/telegram.ts`

- Calcolare `unrealizedPnl` = somma `(current_price − entry_price) × qty` su `positions` aperte (mode corrente).
- Aggiornare `fmtDailySummary` con due righe:
  - `P/L realizzato oggi: X USD (Y trade chiusi)`
  - `P/L non realizzato attuale: Z USD (N posizioni aperte)`
- Passare entrambi i valori dall'engine al formatter.

## 2. AI Supervisor — capire perché non scrive su `ai_reports` / `ai_proposals`
**File**: `src/routes/api/public/hooks/ai-strategy-supervisor.ts`

- Verificare via `supabase--read_query` quante righe ci sono in `ai_reports` / `ai_proposals` / `ai_flag_changes` e quando è stato eseguito l'ultimo run (events_log).
- Controllare se il cron `pg_cron` è schedulato e se l'endpoint risponde (`supabase--curl_edge_functions` non si applica, è una route TanStack → uso `stack_modern--invoke-server-function` o curl manuale).
- Cause probabili da verificare e correggere:
  - Phase B (Gemini) fallisce silenziosamente → wrappare in try/catch con log esplicito su `events_log` (severity error) anziché return silenzioso.
  - Insert su `ai_reports` con colonne mancanti / RLS → leggere lo schema e i policy.
  - Schema Zod troppo grande per Gemini ("too many states") → ridurre enum/proprietà.
- Aggiungere un campo `last_run_status` su `events_log` per ogni esecuzione (ok/skip/error con motivo).

## 3. Bilancio — aggiungere KPI "P/L non realizzato"
**File**: `src/routes/_authenticated/bilancio.tsx` + `src/lib/bilancio.functions.ts`

- Aggiungere card "P/L non realizzato attuale" accanto a "Ricavi YTD" (somma `(current_price − entry_price) × qty` su posizioni aperte mode attivo).
- Nessuna modifica alla logica fiscale: il non-realizzato non entra mai nel `tax_reserve_cents`.

## 4. Reset PAPER pulito
**Via `supabase--insert`** (DELETE + UPDATE):

```sql
DELETE FROM positions          WHERE mode='paper';
DELETE FROM portfolio_snapshots WHERE mode='paper';
DELETE FROM engine_diagnostics WHERE mode='paper';
DELETE FROM events_log         WHERE mode='paper';
UPDATE settings SET paper_seeded_at=NULL,
                    paper_seed_total_usd=NULL,
                    paper_seed_cash_usd=NULL;
```

Al prossimo `getLivePortfolio` PAPER → auto-seed da Kraken (logica già esistente).

## Fuori scope
- Nessuna modifica a engine logic (trading-engine già fixato turno precedente).
- Nessun cambio a strategia/preset/universo.
- Nessuna modifica al pie chart o al grafico dashboard.

## Verifica finale
1. `supabase--read_query` su `ai_reports` post-fix per confermare insert.
2. Curl manuale del cron AI supervisor per forzare un run e verificare i log.
3. Trigger daily-summary via shell per ispezionare il messaggio TG formattato (mock chat_id o dry-run).
