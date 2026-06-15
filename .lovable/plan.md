## Problema

Il grafico "Andamento del portafoglio" mostra tutti i tick come "15 giu" perché:
1. Gli snapshot sono tutti dello stesso giorno (motore appena avviato)
2. Il `tickFormatter` mostra sempre giorno+mese, quindi a parità di data appare ripetuto

## Modifica (solo `src/routes/_authenticated/dashboard.tsx`)

Aggiungo un selettore timeframe in stile Coinbase/Binance sopra il grafico:

**Bottoni**: `1H` · `1G` · `1S` · `1M` · `1A` · `Tutto` (default: `1G`)

**Logica**:
- Filtro gli snapshot lato client in base alla finestra selezionata (`Date.now() - ms`)
- Asse X con formato adattivo:
  - `1H` / `1G` → ore:minuti (`14:30`)
  - `1S` / `1M` → giorno + mese (`15 giu`)
  - `1A` / `Tutto` → mese + anno (`giu 26`)
- `minTickGap={40}` per evitare etichette sovrapposte/ripetute
- Empty state contestuale: se non ci sono abbastanza punti nel timeframe scelto, messaggio "Pochi dati nell'intervallo X, prova un timeframe più ampio"

**UI**: pill group con bordo, sfondo `muted/30`, bottone attivo con `bg-background` e shadow (stesso pattern shadcn già usato in altre pagine).

## Non tocco

- Query Supabase (continuo a caricare gli ultimi 500 snapshot, il filtro è solo lato vista)
- KPI cards in alto
- Realtime subscription
- Nessun cambio DB / backend
