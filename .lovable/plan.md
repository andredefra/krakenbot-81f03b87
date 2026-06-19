## Diagnosi

Quando importi il saldo da Kraken (`seed_from_kraken` in `src/lib/portfolio.functions.ts`) **ogni asset viene inserito con `sleeve = "core"`**, incluso SOL.

Il trading-engine (`supabase/functions/trading-engine/index.ts`) però considera "core" SOLO gli asset elencati in `core_weights` (default `{ BTC: 0.6, ETH: 0.4 }`). Tutte le altre posizioni con `sleeve='core'`:

- non vengono mai rifornite/riequilibrate in macro risk-on,
- vengono **chiuse tutte** nel ramo macro risk-off (riga 285-289: `for (const p of corePos) closePosition(..., "macro risk-off → core in stable")`).

Verificato in DB: SOL viene chiusa ad ogni ciclo dell'engine con `exit_reason = "macro risk-off → core in stable"`. Macro attuale = `risk-off` (BTC 62.640 < SMA200 77.008). Quindi:

1. Engine tick → chiude SOL (sleeve=core, non in `core_weights`) → restano BTC+ETH = $252.
2. Tu premi "Risincronizza da Kraken" (force=true) → cancella le posizioni paper aperte e reinserisce BTC+ETH+SOL = $306.
3. Dopo 1-5 min l'engine ri-parte → richiude SOL → tornano $252.

Stessa cosa accadrà a qualunque altra crypto presente su Kraken oltre a BTC/ETH (ADA, DOT, ecc.). E in realtà BTC/ETH stessi finiranno chiusi anche loro al prossimo tick risk-off (la sopravvivenza fin qui è stata fortuita perché il loop satellite/core ha pattern timing diversi).

## Fix proposto

### 1. `src/lib/portfolio.functions.ts` — `runSeedPaperFromKraken`
Assegnare il sleeve corretto in base a `core_weights`:

```ts
// Leggi core_weights dalle settings prima del loop
const coreSymbols = new Set(Object.keys(settings?.core_weights ?? { BTC: 1, ETH: 1 }));
// Nel loop:
const sleeve = coreSymbols.has(sym) ? "core" : "satellite";
```

Così SOL importata da Kraken entra come `satellite`, non viene toccata dal core-switch macro, e il suo destino dipende solo da stop/take/trailing satellite (regole 7) — che essendo seed senza stop attivo restano aperte finché il prezzo non triggera stop loss.

### 2. (Opzionale, consigliato) Comportamento "core" sconosciuto nel trading-engine

Nel ramo macro risk-off (riga 286), filtrare la chiusura ai soli asset che il bot riconosce come core:

```ts
for (const p of corePos.filter(p => coreAssets.includes(p.asset))) {
  await closePosition(...);
}
```

Così anche se in futuro qualcosa marca per errore un asset come `core`, l'engine non lo liquida senza motivo. Le posizioni "core estranee" vengono lasciate gestire al ramo satellite/uscite o all'utente.

### 3. Nota in `Composizione portafoglio`
Aggiungere una piccola nota: "Le posizioni importate da Kraken diverse da BTC/ETH (core) vengono trattate come satellite e gestite con stop/trailing standard."

## File modificati

- `src/lib/portfolio.functions.ts` — sleeve corretto in `runSeedPaperFromKraken`.
- `supabase/functions/trading-engine/index.ts` — chiusura core risk-off ristretta a `coreAssets`.
- `src/components/dashboard/PortfolioPieChart.tsx` (o testo della card portfolio) — micro nota informativa.

## Cosa NON viene toccato

- Strategia v4, preset, pesi sentiment, schema DB, RLS.
- Posizioni già chiuse storicamente (resta lo storico in `history`).

## Domanda

Applico tutti e 3 i punti? O preferisci solo il punto 1 (il fix minimo che risolve il sintomo della SOL che appare/scompare)?
