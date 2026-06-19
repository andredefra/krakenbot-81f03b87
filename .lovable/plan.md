## Obiettivo

Vedere il dettaglio dei singoli crypto (BTC, ETH, SOL, …) senza dover cliccare lo spicchio "Crypto" per fare drill-down.

## Modifica

`src/components/dashboard/PortfolioPieChart.tsx`: sotto il pie chart (sempre visibile, sia in vista generale che in drill-down) aggiungo una tabella **"Dettaglio asset"** che elenca tutti i singoli asset di tutte le classi:

| Asset | Classe | Quantità | Prezzo USD | Valore USD | % |
|---|---|---|---|---|---|

- Ordinata per valore decrescente.
- Mostra ogni asset reale presente su Kraken (BTC, ETH, SOL, USDC, xStocks, ecc.) — non più solo "Crypto: 5 asset".
- Click su una riga → drill-down sulla sua asset class nel pie (riusa `setDrillClass`).
- Resta il pie chart attuale per la vista per asset class (con drill-down su click), così non perdi la visione aggregata.

Nessuna modifica server / DB / tipi. Solo presentazione frontend.

## File toccati

- `src/components/dashboard/PortfolioPieChart.tsx`
