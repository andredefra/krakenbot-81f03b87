## Problema

Il grafico usa un asse X **categoriale** (un tick per snapshot). Tutti gli snapshot attuali stanno in ~5 minuti, quindi:

- **1M**: vediamo 10 punti tutti del 15/06 → 10 etichette "15 giu" ripetute
- **1A**: stessi punti, formato cambia → 10 etichette "giu 26" ripetute (l'anno `26` viene da `year: "2-digit"` su 2026, corretto ma confuso)
- **1S**: finestra troppo corta, ridondante con 1G

L'asse X dovrebbe essere **temporale continuo** sull'intera finestra selezionata (es. 1M = ultimi 30 giorni → ticks distribuiti dal 16 mag a oggi), non sui soli punti dati.

## Modifica (solo `src/routes/_authenticated/dashboard.tsx`)

### 1. Timeframes
Sostituisco la lista con: `1H · 1G · 1M · 3M · 1A · Tutto` (rimosso `1S`, aggiunto `3M`). Default: `1G`.

### 2. Asse X temporale
Converto `XAxis` da categoriale a numerico/temporale:

```tsx
<XAxis
  dataKey="t"              // timestamp in ms (nuovo campo derivato)
  type="number"
  scale="time"
  domain={[domainStart, Date.now()]}
  ticks={generatedTicks}    // ticks calcolati, non per-data-point
  tickFormatter={tickFmt}
  ...
/>
```

- `domainStart = Date.now() - tf.ms` (per `ALL` uso `snapshots[0].ts`)
- `generatedTicks`: 5–7 timestamp equidistanti tra `domainStart` e ora
- Mappo `filtered` aggiungendo `t: new Date(s.ts).getTime()`

Così l'asse mostra l'intervallo completo (es. `16 mag · 22 mag · 28 mag · 3 giu · 9 giu · 15 giu`) anche se i dati coprono solo gli ultimi minuti — l'area sarà una breve linea a destra, comportamento corretto in stile Coinbase.

### 3. Formato anno a 4 cifre
Per `1A` e `Tutto` uso `year: "numeric"` → `giu 2026` invece di `giu 26`.

### 4. Empty/sparse state migliorato
Se `filtered.length < 2` mostro comunque l'asse vuoto con il domain corretto (no più messaggio "pochi dati"), oppure messaggio solo se 0 punti totali. Più coerente con stile trading.

## Non tocco

- Query Supabase, KPI cards, realtime, DB.
