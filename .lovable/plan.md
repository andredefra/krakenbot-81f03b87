## Obiettivo
Allineare il pannello **Diagnostica** (e il motore che lo alimenta) all'architettura v2 Core-Satellite descritta in `STRATEGIA.md` / `BUILD_SPEC.md`: due regimi separati, split core/satellite, universo dinamico, max posizioni riferito al solo satellite.

## Stato attuale (cosa non va)
- `trading-engine` ha **un solo filtro di regime** (`btc_sma50` o `btc_sma200`, alternativi) e tratta tutti gli asset alla stessa stregua. Non distingue core da satellite.
- `engine_diagnostics` salva solo `regime`, `regime_reason`, `btc_sma50`. Nessun campo macro / core state / universo eligible / spread / volume.
- `diagnostica.tsx` mostra un'unica card "Regime di mercato" e usa `settings.max_positions` (globale) invece di `max_satellite_positions`.
- I candidati arrivano da `asset_universe` statico (ETH/SOL/ADA/LINK/AVAX/DOT), non dalla tabella `universe` v2 (che esiste già ma è vuota — manca lo scanner).

## Cosa cambia

### 1. DB — estendere `engine_diagnostics` (migration)
Nuove colonne (tutte nullable, retro-compatibili):
- `macro_regime` text · `macro_reason` text · `btc_sma200` numeric
- `meso_regime` text · `meso_reason` text  *(rimpiazza concettualmente l'attuale `regime`, che resta per compat)*
- `core_state` jsonb → `{ invested: bool, target: {BTC:0.6,ETH:0.4}, held: [{asset,qty,value_usd,weight_actual}] }`
- `satellite_state` jsonb → `{ open: int, max: int, positions: [...] }`
- `universe_eligible` jsonb → `[{asset, vol_24h_usd, spread_bps, age_days, eligible:true}]`

### 2. Engine — portare `trading-engine` al modello a 2 livelli
Nello stesso file (niente split fisico in questa fase, lo scheduling resta unico):
- Calcolare **macro** = BTC vs SMA200 → governa il core.
- Calcolare **meso** = BTC vs SMA50 + F&G (logica attuale) → governa il satellite.
- Ciclo core: se macro risk-on, target = `core_weights` su sleeve='core'; se risk-off, sposta core in stable. Ribilanciamento solo se drift > soglia (no churn ogni run).
- Ciclo satellite: itera **solo** sugli asset `eligible=true` di `public.universe` (fallback `asset_universe.momentum` se tabella vuota), confronta con `max_satellite_positions` (default 2), NON con `max_positions`. Sleeve='satellite' nelle insert.
- Il conteggio "max posizioni satellite" filtra `positions` per `sleeve='satellite'`.
- Scrive sullo snapshot diagnostica i nuovi campi (macro, meso, core_state, satellite_state, universe_eligible con vol/spread presi durante lo scan).

### 3. Universe scanner (minimo necessario)
Nuova edge function `universe-scanner` (cron ~2h) che:
- Chiama Kraken `AssetPairs` + `Ticker`, calcola `volume_24h_usd` e `spread_bps`.
- Aggiorna `public.universe` con `eligible = vol >= settings.min_volume_24h && spread <= settings.max_spread_bps && age >= settings.min_age_days`.
- Esclude BTC/ETH (riservati al core) e le stablecoin.

Se preferisci rimandare lo scanner a un turno successivo, l'engine usa il fallback statico ma il pannello mostra comunque la sezione "Universo" vuota con stato chiaro.

### 4. `diagnostics.functions.ts`
Estendere `DiagnosticsPayload` con: `macro`, `meso`, `core`, `satellite`, `universe`. Leggere i nuovi campi della tabella; restituire `openSatellitePositions` (count `sleeve='satellite'`) e `max_satellite_positions` dalle settings.

### 5. UI — `diagnostica.tsx`
Refactor in 4 card:
- **Regime MACRO** (verde/rosso) — BTC vs SMA200, badge "Core investito" / "Core in cash", lista asset core con peso target vs attuale.
- **Regime MEDIO** — BTC vs SMA50 + F&G, badge satellite `0/2`, motivo.
- **Universo eligible** — tabella con colonne Asset · Volume 24h · Spread (bps) · Età · Eligible.
- **Candidati satellite valutati** — tabella attuale (Asset, Prezzo, SMA20, SMA50, Trend, Esito) ma sorgente = solo universo eligible.

### 6. Settings
- Forzare `max_satellite_positions = 2` per preset Bilanciato (già a 2). Nessuna migrazione dati extra: già allineato dal turno precedente.
- Il vecchio `max_positions` resta come tetto totale (core+satellite) ma non è più mostrato nella diagnostica del satellite.

## File toccati
- `supabase/migrations/<new>.sql` — colonne diagnostiche
- `supabase/functions/trading-engine/index.ts` — dual regime + sleeve + eligible universe + nuova scrittura snapshot
- `supabase/functions/universe-scanner/index.ts` *(nuovo, se confermi)*
- `src/lib/diagnostics.functions.ts` — payload esteso
- `src/routes/_authenticated/diagnostica.tsx` — UI 4 card

## Domanda prima di procedere
Vuoi che includa **subito** lo `universe-scanner` (Fase 2 completa) oppure faccio prima allineamento engine+diagnostica con fallback statico e lo scanner in un turno separato?
