# Fix grafico dashboard + tooltip pie chart

## Problema 1 — Grafico "Andamento del portafoglio"
Nello screenshot la linea parte solo dopo le ~13:00 ed è schiacciata a destra, perché il dominio X è hard-coded a `[now - timeframe, now]`. Dopo il reset PAPER ci sono pochissime ore di snapshot, ma la finestra "1G" forza 24h: risultato un grafico quasi vuoto che sembra rotto. Anche tick e label non si adattano alla quantità reale di dati.

### Cosa cambia in `src/routes/_authenticated/dashboard.tsx` (`ChartView`)
1. **Dominio adattivo**: `start = max(firstSnapshot.ts, now - timeframe.ms)`; se non ci sono snapshot nella finestra, fallback all'intero range disponibile invece di mostrare un'area vuota.
2. **Banner "dati insufficienti"**: se la finestra selezionata copre meno del 10% di dati reali (es. 1A con sole 6h), mostrare sopra il chart un piccolo hint "Storico disponibile: Xh — finestra più ampia non ancora popolata".
3. **Tick X dinamici**: numero tick basato sull'effettiva durata coperta (`min(6, points/2)`) e formato `HH:mm` quando lo span è < 24h indipendentemente dalla preset (1H/1G), `dd MMM HH:mm` se 1–7g, `dd MMM` oltre.
4. **Asse Y zoom**: invece di partire da 0 (che appiattisce le oscillazioni reali), usare `domain={["auto","auto"]}` con padding 2% così la variazione è visibile.
5. **Linea di riferimento**: aggiungere `ReferenceLine` orizzontale sul valore di seed (primo snapshot della finestra) per vedere subito se siamo sopra/sotto.
6. **Tooltip leggibile**: aggiungere `color: var(--color-popover-foreground)` allo `contentStyle` (vedi Problema 2).

### File toccati
- `src/routes/_authenticated/dashboard.tsx` — solo la funzione `ChartView` (no logica business, no query).

## Problema 2 — Testo nero nel tooltip del pie chart
Recharts applica `color: #000` di default al contenuto del tooltip; con sfondo scuro `--color-popover` il testo non si legge. Manca `color` nello `contentStyle`.

### Cosa cambia
In `src/components/dashboard/PortfolioPieChart.tsx` (e per coerenza nello stesso `ChartView` sopra) aggiungere al `contentStyle`:
```
color: "var(--color-popover-foreground)"
```
e impostare `itemStyle={{ color: "var(--color-popover-foreground)" }}` + `labelStyle={{ color: "var(--color-popover-foreground)" }}` sul `<Tooltip />`.

### File toccati
- `src/components/dashboard/PortfolioPieChart.tsx` — solo prop del `<Tooltip />`.

## Fuori scope
- Nessuna modifica a engine, supervisor, dati o query.
- Nessun cambio al pie chart oltre il colore tooltip.
- Nessun cambio ai KPI card sopra il grafico.
