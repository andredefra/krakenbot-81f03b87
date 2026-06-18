# AI Supervisor v2 — Observe, Report, Propose

## Regola d'oro (non derogabile)
L'AI **non** modifica mai parametri/strategia da sola e **non** manda mai in live nulla. Osserva, scrive report, propone. L'umano approva. Ogni proposta passa dal cancello di validazione out-of-sample con fee Kraken reali **prima** di poter influenzare il trading.

L'unica autonomia concessa sono i 3 flag meccanici (`core_only_mode`, `bear_dca_enabled`, `exclude_fiat_commodity`) e solo via regole esplicite deterministiche.

---

## 1. Database (nuova migration)

Nuove tabelle in `public` (con GRANT + RLS `auth.uid() = user_id`):

- **`ai_reports`** — timeline "Diario AI"
  - `id`, `user_id`, `created_at`, `period` (hourly|daily), `market_snapshot` jsonb (regime, F&G, trend), `self_snapshot` jsonb (P/L, win rate, PF, vs benchmark), `narrative` text (testo "investment officer"), `anomalies` jsonb, `proposals_generated` uuid[]

- **`ai_proposals`** — coda modifiche
  - `id`, `user_id`, `created_at`, `report_id`, `title`, `rationale` text, `param_diff` jsonb (`{path, from, to}[]`), `status` enum (`pending` | `approved` | `rejected` | `validated` | `validation_failed` | `applied`), `approved_at`, `decided_by`, `validation_result` jsonb (kpis + PASS/FAIL checks), `applied_at`

- **`ai_flag_changes`** — audit dei 3 flag meccanici
  - `id`, `user_id`, `created_at`, `flag` (enum), `from_value`, `to_value`, `rule_triggered` text, `inputs` jsonb (es. `{btc_close, sma200, fg_value}`)

Estendere `settings` con `ai_supervisor_last_run_at` (se mancante).

Nessun nuovo flag nel `settings` per "applied params" — quando una proposta passa validazione e viene applicata, scrive direttamente nei campi esistenti di `settings` (preset, soglie, ecc.) con audit in `events_log`.

---

## 2. Server logic

### `src/routes/api/public/hooks/ai-strategy-supervisor.ts` (refactor)
Diviso in due fasi:

**Fase A — Flag meccanici (regole esplicite)**
- `core_only_mode = true` ⇔ BTC close < SMA200
- `bear_dca_enabled = true` ⇔ macro risk-off **AND** F&G < soglia (configurable, default 25)
- `exclude_fiat_commodity = true` sempre per satellite

Ogni cambio → riga in `ai_flag_changes` con la regola che è scattata + update `settings`.

**Fase B — Report + Proposte (Gemini 3 Flash)**
- Raccoglie market snapshot, posizioni, trade chiusi recenti, KPI vs BTC B&H / S&P, fee pagate.
- Prompt "investment officer": produce JSON con `narrative`, `anomalies`, `proposals[]` (titolo, motivazione, `param_diff`).
- Insert in `ai_reports` + una riga per proposta in `ai_proposals` (status `pending`).
- **Non** tocca mai `settings` (eccetto i 3 flag in Fase A).

### `src/lib/ai-proposals.functions.ts` (nuovo)
Server functions auth-protette:
- `listProposals({status?})`
- `decideProposal({id, decision: 'approve'|'reject'})` — su approve, schedula validazione async
- `runProposalValidation({id})` — esegue backtest out-of-sample con `param_diff` applicato in memoria:
  - finestra OOS: ultimi 12 mesi escludendo gli ultimi 30 giorni (i 30gg restano holdout futuro)
  - confronta vs **BTC B&H** e **BTC DCA**
  - PASS se: PF > 1.3, Sharpe > 0.8, Sharpe ≥ BTC B&H, |MaxDD| ≤ |BTC B&H|, **AND** Sharpe ≥ DCA, |MaxDD| ≤ |DCA|
  - salva `validation_result` + status `validated` o `validation_failed`
- `applyValidatedProposal({id})` — solo se `validated`; scrive `param_diff` in `settings`, status `applied`, log

### `src/lib/backtest.server.ts` (estensione)
Aggiungere `runOosBacktest(params, windowStart, windowEnd)` riusando l'engine esistente — include simulazione DCA semplice come benchmark aggiuntivo (oltre BTC B&H e S&P già presenti) per i criteri di validazione proposte.

### `src/lib/diary.functions.ts` (nuovo)
`listReports({limit})` per il Diario AI.

---

## 3. UI

### Nuove route in `src/routes/_authenticated/`

- **`diario.tsx`** — "Diario AI"
  - Timeline cards per report: header (data, periodo), narrative leggibile, sezioni Market / Self / Anomalies, chip "N proposte generate" che linka a Proposte.

- **`proposte.tsx`** — "Proposte"
  - Lista filtrabile per status (Pending / Validated / Failed / Applied / Rejected).
  - Card per proposta: titolo, motivazione, **diff parametri** (vista before/after tabellare), pulsanti **Approva** / **Rifiuta** (se pending).
  - Se `approved` → mostra "Validazione in corso…" o esito PASS/FAIL con KPI strategia vs BTC B&H vs DCA.
  - Se `validated` → pulsante **Applica al sistema**.
  - Se `validation_failed` → mostra ragione, opzione "Archivia".

### Modifiche

- **`diagnostica.tsx`** — sezione "Flag AI" con stato corrente dei 3 flag + ultima regola che ha scattato il cambio (da `ai_flag_changes`).
- **`logs.tsx`** — includere eventi: report generato, flag cambiato, proposta creata/approvata/rifiutata, esito validazione.
- Sidebar nav: aggiungere voci **Diario AI** e **Proposte** (badge col numero di proposte pending).

### Pulsante GO LIVE
Resta gated dal cancello di validazione esistente. Nessun cambio comportamentale qui — la validazione delle proposte usa gli stessi criteri + i due aggiuntivi vs DCA.

---

## 4. Cron / scheduling

- Cron orario esistente per `ai-strategy-supervisor` resta. Aggiungere parametro `period` (default `hourly`); ogni 24h forza `period=daily` per un report più articolato.
- Validazione proposte: trigger immediato all'approvazione (async dalla server fn). Niente cron dedicato.

---

## 5. Dettagli tecnici / sicurezza

- Tutto server-side (TanStack server fn + route `/api/public/hooks/*`). Nessuna chiave API o logica di trading nel frontend.
- `LOVABLE_API_KEY` letto solo dentro handler.
- RLS su tutte le nuove tabelle scoped a `auth.uid()`.
- Audit completo: ogni decisione umana + ogni esito validazione → riga in `events_log`.

---

## Cosa dovrai configurare tu
1. Approvare la migration (nuove tabelle + RLS + GRANT).
2. Una volta deployato, le proposte appariranno in `/proposte`: starà a te approvarle e — se passano la validazione — applicarle.
3. Eventualmente tarare la soglia F&G per `bear_dca_enabled` (default 25) in `settings` se vuoi un valore diverso.

Nessun nuovo secret necessario (riusa `LOVABLE_API_KEY`).
