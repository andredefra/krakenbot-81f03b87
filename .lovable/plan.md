# Diagnostica del sistema (stato attuale)

**Engine**: gira regolarmente ogni 5 min (`Ciclo v2 completato`, ultimo alle 16:10). Snapshot portafoglio aggiornati (totale costante 318 USD, mode `paper`).

**Regime macro** = `risk-off` → BTC 67.123 sotto SMA200 77.527 → **Core in stable, non investito**. Corretto.
**Regime meso** = `risk-off` → BTC sotto SMA50 73.694 → **Satellite 0/2**. Corretto.

**Posizioni aperte**: 0. Coerente con doppio risk-off.

## Problemi trovati

### 1) BUG CRITICO — Universo dinamico: 0 asset eligible su 640
Lo scanner ha popolato 640 coppie USD, calcola volume e spread correttamente (XRP 38M, SOL 27M, ADA 17M...), ma **tutti** sono marcati `eligible=false` con motivo `Età 0d < min 60d`.

Causa: `first_seen` viene impostato a `now()` la **prima volta** che lo scanner vede l'asset. Siccome la tabella è stata popolata oggi, ogni asset ha età 0 giorni. Il filtro `min_listing_age_days=60` è pensato per escludere nuovi listing su Kraken, non per attendere 60 giorni dopo l'attivazione dello scanner.

Conseguenza: il satellite cade sempre sul fallback statico (`asset_universe.momentum`) e l'universo dinamico è di fatto disattivo per i prossimi 60 giorni.

### 2) Dashboard non allineata a v2
La KPI "Regime / F&G" mostra un solo valore generico letto da `sentiment_snapshots.regime`. Con v2 ci sono **due regimi distinti** (Macro→Core, Meso→Satellite) e la dashboard non li distingue, non mostra lo stato Core (investito/in stable) né l'utilizzo slot Satellite (0/2).

# Piano interventi

## A. Fix universo (migrazione SQL one-shot)
Backfill `first_seen` retrodatandolo a ~400 giorni fa per **tutti gli asset già presenti** in `public.universe`:
```sql
UPDATE public.universe
SET first_seen = LEAST(first_seen, now() - interval '400 days');
```
- Effetto immediato: al prossimo run dello scanner (max 2h, o invocazione manuale) gli asset con vol > min e spread < max diventeranno `eligible=true`.
- Nuovi listing futuri continueranno a essere filtrati dai 60 giorni (comportamento corretto): per loro `first_seen` sarà la data reale del primo avvistamento.
- Trigger manuale `universe-scanner` subito dopo la migrazione per popolare l'eleggibilità senza attendere il cron.

## B. Dashboard v2 (`src/routes/_authenticated/dashboard.tsx`)
Sostituire l'unica KPI "Regime / F&G" con **due KPI** alimentate da `getDiagnostics` (server fn già esistente):

1. **Macro → Core**
   - Badge `risk-on` / `risk-off`
   - Sub-line: `Core: INVESTITO (BTC 60% / ETH 40%)` oppure `Core: IN STABLE`
   - Tooltip: motivo (BTC vs SMA200)

2. **Meso → Satellite**
   - Badge `risk-on` / `risk-off`
   - Sub-line: `Satellite N/2 · F&G XX (label)`
   - Tooltip: motivo (BTC vs SMA50 + F&G)

Grid attuale 4 colonne → diventa 5 su xl (Valore, 24h, 7g, Macro, Meso) oppure mantengo 4 e accorpo le due variazioni. Proposta: **xl:grid-cols-5** per non perdere info.

Aggiungere un piccolo banner sotto la grid se `data.universe.filter(eligible).length === 0`:
> "Universo dinamico vuoto — satellite su fallback statico."

Nessun cambio al grafico portfolio.

## C. (Opzionale) Allineare `max_positions`
Settings utente ha `max_positions=2` e `max_satellite_positions=2`. In v2 `max_positions` è il cap totale (core+satellite). Con BTC+ETH core (2 slot) + 2 satellite servirebbero **4 slot totali**. Da confermare se vuoi che alzi `max_positions` a 4 nei preset.

# Dettagli tecnici

- File toccati: `supabase/migrations/<new>.sql` (1 UPDATE), `src/routes/_authenticated/dashboard.tsx` (KPI + query a `getDiagnostics`).
- Nessuna modifica all'engine, allo scanner, alla diagnostica.
- Invocazione manuale scanner dopo migrazione tramite `supabase--curl_edge_functions`.

# Domanda
Confermi: (1) fix universo come sopra, (2) dashboard con 5 KPI (Valore/24h/7g/Macro/Meso), (3) alzo `max_positions` a 4 nei preset Bilanciato/Aggressivo per non strozzare il satellite quando il core è investito? Oppure preferisci lasciare `max_positions` invariato?
