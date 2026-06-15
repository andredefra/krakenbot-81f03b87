
# Piano — Test Telegram + pagina Bilancio

## Parte 1 — Test Telegram (subito)

**Obiettivo:** verificare che `notifyTelegram()` consegni messaggi sul tuo chat ID.

- Nuova server function `sendTelegramTest` in `src/lib/telegram.functions.ts` — autenticata (`requireSupabaseAuth`), invia "🧪 Test da TradingBot — <timestamp>" via `notifyTelegram()` e ritorna `{ ok, error? }` leggendo la risposta HTTP di Telegram (così se token/chat ID sono sbagliati lo vediamo).
- Pulsante **"Invia test Telegram"** nella pagina `/mode`, sezione Notifiche, con toast di esito (✅ inviato / ❌ messaggio di errore).
- Loggo l'esito anche in `events_log` (`component='telegram'`, `level=info|error`).

**Verifica:** dopo l'implementazione invoco il server fn dal sandbox e ti chiedo conferma che ti sia arrivato.

---

## Parte 2 — Pagina `/bilancio`

Nuova voce sidebar **"Bilancio"** (icona Calculator), route `_authenticated/bilancio.tsx`. Filtrata per `mode` attivo (Paper/Live) tramite `useActiveMode`, come le altre pagine.

### Layout — 4 sezioni verticali

**A) Costi infrastruttura** (manuali + import CSV)
- Tabella editabile: voce, categoria (`infra`/`api`/`altro`), importo, valuta, ricorrenza (`one_off`/`monthly`/`yearly`), data inizio, data fine (nullable = ancora attivo), note.
- Bottoni: "Aggiungi voce", "Importa CSV" (parsing client-side, validazione, preview, conferma), "Esporta CSV".
- KPI in alto: **Costo mese corrente**, **Costo YTD**, **Run-rate annuo**.

**B) Costi di trading (Kraken)**
- Pull reali dalla Kraken API (`TradesHistory`) via nuova server fn `syncKrakenFees` — recupera fee per trade dei trade chiusi e le persiste in nuova tabella `trade_fees` (un record per trade, idempotente per `kraken_trade_id`).
- Sync automatico (cron pg_cron ogni ora) + bottone "Sincronizza ora".
- In Paper: nessuna chiamata Kraken; le fee sono stimate dal campo `fee_estimate` sulle posizioni chiuse (se assente, applico 0.26% sul controvalore — configurabile in `settings`).
- KPI: **Fees mese**, **Fees YTD**, **Fee % media sul volume**.

**C) Conto economico** (cuore della pagina)
Tabella mensile + grafico:
```text
                       Mese    YTD    Run-rate annuo
Ricavi (P&L lordo)     ...     ...    ...
- Fees trading         ...     ...    ...
= P&L netto trading    ...     ...    ...
- Costi infrastruttura ...     ...    ...
= Utile ante imposte   ...     ...    ...
- Imposte (26%)        ...     ...    ...
= Utile netto          ...     ...    ...
```
- "Ricavi" = somma `realized_pnl` dalle `positions` chiuse nel periodo (filtrate per `mode`).
- Grafico equity netta nel tempo (linea utile netto cumulato, con shading separato per lordo/netto).

**D) Tasse — Italia (default)**
- Selettore **Paese di residenza fiscale** (default `IT`, salvato in `settings.tax_country`). Architettura pronta per altri paesi (mappa `tax_rules` lato server), ma implemento solo `IT` ora.
- Regime: **Imposta sostitutiva 26%** su plusvalenze crypto realizzate (Quadro RT).
- Calcolo:
  - Plusvalenza fiscale anno = `Σ realized_pnl` dei trade chiusi nell'anno solare (solo Live; il toggle "include Paper" è OFF di default e mostra disclaimer "paper non rilevante ai fini fiscali").
  - Compensazione minus pregresse (campo manuale opzionale "Minusvalenze riportate da anni precedenti", max 4 anni).
  - Imposta dovuta = `max(0, plusvalenza − minus) × 26%`.
- **Scadenze fiscali IT** mostrate come timeline + reminder banner se mancano <30 giorni:
  - **30 giugno** — saldo imposte anno precedente + 1° acconto (40% IRPEF; per sostitutiva crypto = saldo intero).
  - **30 novembre** — 2° acconto.
  - **Dichiarazione Redditi PF** — apertura aprile, termine 30/09 (telematico).
  - **Quadro RW** (monitoraggio) — segnalato come "verifica con commercialista", non calcolato automaticamente.
- Box "Quanto ti rimane":
  - Utile netto post-tasse YTD
  - Tasse stimate da accantonare (con barra "accantonato vs dovuto" — campo manuale "Accantonato finora")
  - Prossima scadenza con countdown

### Aspetti tecnici

**Migration:**
- `infra_costs` (id, user_id, name, category, amount_cents, currency, recurrence, start_date, end_date, notes, created_at)
- `trade_fees` (id, user_id, kraken_trade_id UNIQUE, position_id FK, fee_cents, currency, traded_at, raw jsonb)
- `settings`: aggiungo `tax_country text default 'IT'`, `tax_reserve_cents bigint default 0`, `loss_carryforward_cents bigint default 0`, `paper_fee_bps int default 26`.
- RLS + GRANT su tutte (pattern esistente, `user_id = auth.uid()`).
- Cron `pg_cron`: chiama `/api/public/cron/sync-kraken-fees` ogni ora (header `apikey` con anon key).

**Server functions** (`src/lib/bilancio.functions.ts`):
- `listInfraCosts`, `upsertInfraCost`, `deleteInfraCost`, `bulkImportInfraCosts`
- `getIncomeStatement({ year, month?, mode })` — aggrega ricavi/fees/costi/tasse
- `syncKrakenFees` (chiama Kraken `TradesHistory` con HMAC, paginazione, upsert)
- `getTaxSummary({ year, country })` — ritorna plusvalenza, imposta, scadenze, countdown
- `updateTaxSettings({ country, reserve, carryforward })`

**Route pubblica** (`/api/public/cron/sync-kraken-fees`) — verifica `apikey` header, itera su utenti con Kraken configurato, chiama `syncKrakenFees` con service role.

**Frontend:**
- `src/routes/_authenticated/bilancio.tsx` con 4 sezioni in Cards
- Componenti dedicati: `InfraCostsTable`, `TradingCostsCard`, `IncomeStatementTable`, `TaxPanel`, `TaxDeadlineTimeline`
- Grafico Recharts (line + area) per equity netta
- CSV import: `papaparse` (già leggero, da installare)
- Sidebar: aggiungo "Bilancio" tra "Logs" e "Modalità"

### Esclusioni esplicite
- Nessuna integrazione con commercialista / generazione F24 / invio Agenzia Entrate.
- Quadro RW (monitoraggio) e bollo IVAFE NON calcolati (solo nota informativa).
- Paesi diversi da IT: struttura predisposta ma regole vuote — verranno aggiunte quando servirà.
- Conversione valute multi-currency: tutto in EUR. Trade in USD vengono convertiti al tasso del giorno di chiusura (chiamata gratuita exchangerate.host, cache giornaliera in nuova tabella `fx_rates`).
