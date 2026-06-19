## Obiettivo

Il portfolio non parte mai da un saldo finto. In **PAPER**, al primo avvio (o tramite un pulsante "Risincronizza da Kraken") leggiamo il saldo reale da Kraken e lo congeliamo come capitale iniziale della simulazione. Da lì in poi la simulazione lavora su quella base. In **LIVE** continuiamo a leggere sempre Kraken in tempo reale.

## Modifiche DB (`settings`)

Aggiungo 3 colonne nullable:

- `paper_seed_total_usd numeric` — equity totale Kraken al momento del seed
- `paper_seed_cash_usd numeric` — quota cash USD al seed
- `paper_seeded_at timestamptz` — quando è avvenuto il seed

Niente cambi alle tabelle `positions` / `portfolio_snapshots`.

## Logica server

**Nuova server fn `seedPaperFromKraken`** (`src/lib/portfolio.functions.ts`):
1. Chiama `loadLivePortfolioSnapshot` (Kraken reale).
2. Calcola `totalValueUsd`, `cashUsd` e crea per ogni asset non-cash una riga in `positions` con `mode='paper'`, `status='open'`, `entry_price = prezzo Kraken attuale`, `qty = saldo reale`, `asset_class` corretto (crypto / stocks via xStock / forex).
3. Inserisce uno snapshot iniziale in `portfolio_snapshots` (`mode='paper'`).
4. Aggiorna `settings.paper_seed_*` e `paper_seeded_at`.
5. Idempotente: se `paper_seeded_at` esiste, richiede `force: true` (usato dal pulsante "Risincronizza").

**`getLivePortfolio` ramo PAPER** (stesso file):
- Se `paper_seeded_at IS NULL` → invoca `seedPaperFromKraken` automaticamente prima di rispondere (così il primo render mostra subito il portafoglio reale, non una pagina vuota).
- Dopo il seed legge `positions`/`portfolio_snapshots` come oggi, ma il `totalValueUsd` fallback usa `paper_seed_total_usd` finché l'engine non scrive un nuovo snapshot.

## UI

**Dashboard** (`src/routes/_authenticated/dashboard.tsx`):
- Sotto al `PortfolioPieChart` aggiungo un riquadro "Sorgente: PAPER (seed da Kraken il <data>)" + pulsante **Risincronizza da Kraken** che chiama `seedPaperFromKraken({ force: true })` e poi `router.invalidate()`.
- In LIVE mostra "Sorgente: Kraken live" (nessun pulsante seed).

**Diagnostica**: nessuna modifica (il test Kraken esiste già).

## File toccati

- `supabase/migrations/<nuova>.sql` — 3 colonne su `settings`
- `src/lib/portfolio.functions.ts` — nuova fn `seedPaperFromKraken` + auto-seed nel ramo paper di `getLivePortfolio`
- `src/lib/portfolio.server.ts` — helper `buildSeedFromSnapshot(snapshot)` che produce le righe `positions` + il primo snapshot
- `src/routes/_authenticated/dashboard.tsx` — banner sorgente + pulsante risincronizza
- `src/integrations/supabase/types.ts` — rigenerato dopo la migration

## Cosa NON cambio

- LIVE mode: già legge Kraken, resta identica.
- Engine di trading paper: continua a usare `positions`/`portfolio_snapshots` con `mode='paper'`. Nessun impatto sulle strategie esistenti.
- Tasse / bilancio: invariati (lavorano su `mode='live'`).
