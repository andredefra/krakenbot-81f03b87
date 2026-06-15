## Obiettivo

Rendere la sezione **Tasse** della pagina `/bilancio` completamente automatica e read-only, con accantonamento automatico del 26% ad ogni trade Live in profitto e promemoria scadenze su Telegram.

## Cosa cambia

### 1. Sezione Tasse → 100% read-only

Nella pagina `src/routes/_authenticated/bilancio.tsx`, sostituisco i campi input della sezione "Tasse Italia" con una vista solo-lettura che mostra:

- **Plusvalenze realizzate YTD** (live mode, derivato da `positions.pnl`)
- **Minusvalenze pregresse**: 0,00 € (parti da zero — il sistema lo aggiornerà automaticamente se chiuderai un anno in perdita, riportabili 4 anni)
- **Base imponibile**
- **Imposta dovuta (26%)**
- **Riserva accantonata** (alimentata automaticamente)
- **Copertura riserva** (barra di progresso verso il 100% del dovuto)
- **Prossima scadenza** con countdown e badge categoria (saldo / acconto / dichiarazione)
- **Calendario completo** delle scadenze IT dei prossimi 14 mesi

Rimuovo: input "riserva", input "minusvalenze pregresse", input "paese", select "fee paper". Tutti questi diventano valori automatici interni (paese = IT hardcoded, paper_fee_bps = 26 di default, minus = auto-calcolate dagli anni precedenti).

### 2. Accantonamento automatico 26% ad ogni trade Live in profitto

Aggiungo un trigger Postgres su `public.positions`:
- Quando una posizione passa a `status = 'closed'` con `mode = 'live'` e `pnl > 0`
- Incrementa `settings.tax_reserve_cents` di `round(pnl * 100 * 0.26)` per quel `user_id`
- Se `pnl < 0`, incrementa `settings.loss_carryforward_cents` di `round(abs(pnl) * 100)` (e azzera dopo 4 anni — gestito al calcolo)

Backfill iniziale: ricalcolo `tax_reserve_cents` e `loss_carryforward_cents` per l'utente sulla base delle posizioni Live già chiuse (per te oggi = 0, essendo il primo giorno).

### 3. Promemoria scadenze fiscali su Telegram

Nuovo server route pubblico `src/routes/api/public/cron/tax-reminders.ts`:
- Calcola scadenze IT (riuso `getItalianDeadlines` da `src/lib/tax/it.ts`)
- Per ogni scadenza a T-30, T-7, T-1 giorni invia messaggio Telegram via `notifyTelegram()`
- Tabella `tax_reminders_sent (user_id, deadline_id, days_offset)` per evitare duplicati
- Job `pg_cron` giornaliero alle 09:00 Europe/Rome chiama il route con `apikey` anon

Banner in-app già coperto dal blocco "Prossima scadenza" con countdown nella nuova UI read-only.

### 4. Pulizia coerente

- `bilancio.functions.ts`: rimuovo `updateTaxSettings` (non più necessario, tutto auto). Mantengo `getTaxSummary` come unica fonte read-only.
- `getTaxSummary` legge sempre paese = IT, riserva auto, minus auto.

## Dettagli tecnici

**Migration SQL:**
```sql
-- Trigger riserva tasse automatica
CREATE OR REPLACE FUNCTION public.accrue_tax_reserve() ...
CREATE TRIGGER positions_accrue_tax AFTER UPDATE OF status ON public.positions ...

-- Tabella anti-duplicato promemoria
CREATE TABLE public.tax_reminders_sent (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  deadline_id text NOT NULL,
  days_offset int NOT NULL,
  sent_at timestamptz DEFAULT now(),
  UNIQUE (user_id, deadline_id, days_offset)
);
GRANT SELECT, INSERT ON public.tax_reminders_sent TO authenticated;
GRANT ALL ON public.tax_reminders_sent TO service_role;
ALTER TABLE ... ENABLE RLS;
CREATE POLICY ... USING (auth.uid() = user_id);
```

**File modificati:**
- `src/routes/_authenticated/bilancio.tsx` — sezione tasse → read-only
- `src/lib/bilancio.functions.ts` — rimuovo `updateTaxSettings`

**File creati:**
- `src/routes/api/public/cron/tax-reminders.ts` — endpoint cron Telegram
- Migration: trigger accrual + tabella `tax_reminders_sent`

**Cron (via supabase insert tool, non migration):**
- Job giornaliero 09:00 Europe/Rome verso `/api/public/cron/tax-reminders`

## Esclusioni

- Niente cambio paese (IT fisso; quando ti sposterai aggiungeremo il selettore)
- Niente buffer extra oltre il 26% (scelta "26% di ogni plusvalenza")
- Niente IVAFE / Quadro RW automatici (restano come nota informativa)
