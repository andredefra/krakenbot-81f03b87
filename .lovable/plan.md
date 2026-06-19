Obiettivo: fermare l’errore ricorrente `Cannot read properties of undefined (reading 'toFixed')` e azzerare lo storico trade PAPER, ripartendo solo dalle posizioni/saldi aperti reali importati da Kraken.

Piano:
1. **Correzione trading-engine**
   - Il crash avviene subito dopo una chiusura (`Chiuso ETH/BTC/SOL...`) perché `fmtClose()` riceve `portfolioTotal` non valorizzato e chiama `.toFixed()`.
   - Aggiornerò `closePosition()` per passare sempre un totale portafoglio valido a `fmtClose()`.
   - Renderò anche i formatter Telegram più robusti usando conversioni numeriche sicure, così un dato mancante non può più far saltare tutto il ciclo.

2. **Pulizia PAPER e reseed da Kraken**
   - Eliminerò tutte le righe PAPER nella tabella `positions`, quindi spariranno trade aperti e chiusi generati finora.
   - Eliminerò anche gli snapshot PAPER (`portfolio_snapshots`) e la diagnostica engine collegata, così la dashboard non mescola dati vecchi con il nuovo inizio.
   - Reinizializzerò il PAPER da Kraken usando la logica esistente di seed, mantenendo solo le posizioni/saldi aperti effettivi importati da Kraken.
   - Non toccherò dati LIVE, chiavi Kraken, impostazioni strategia o log storici non necessari.

3. **Allineamento dashboard**
   - Dopo il reset, il dettaglio portafoglio PAPER leggerà solo le nuove posizioni aperte importate.
   - La dashboard mostrerà il nuovo snapshot coerente con BTC/SOL/altre posizioni realmente presenti su Kraken, invece delle sole 2 posizioni rimaste dopo vecchie chiusure automatiche.

4. **Deploy e verifica**
   - Distribuirò la funzione `trading-engine` aggiornata.
   - Controllerò i log/eventi dopo una chiamata di test per verificare che non venga più inviato l’errore `.toFixed` su Telegram.