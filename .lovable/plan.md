## Obiettivo
Azzerare completamente lo stato del paper trading e ripartire da zero importando solo le posizioni reali attualmente aperte su Kraken, con un nuovo bilancio iniziale coerente.

## Azioni

### 1. Pulizia dati PAPER nel database
Cancellare tutte le righe in modalità `paper` da:
- `positions` (sia aperte che chiuse — storico trade incluso)
- `portfolio_snapshots` (storico equity)
- `engine_diagnostics` (cicli engine)
- `trade_fees` (commissioni)
- `events_log` (eventi engine, solo paper)
- `ai_proposals`, `ai_reports`, `ai_flag_changes` (solo paper)
- `backtest_runs` non viene toccato (è altra cosa)

Reset in `settings` (mode=paper):
- `paper_seeded_at = NULL`
- `paper_seed_total_usd = NULL`
- `paper_seed_cash_usd = NULL`
- `tax_reserve_cents = 0`, `loss_carryforward_cents = 0`

### 2. Risincronizzazione da Kraken
- Al prossimo ciclo, l'engine rileva `paper_seeded_at = NULL` e ri-esegue il seed: legge il balance reale da Kraken (cash USD + holdings aperti) e popola `positions` solo con le posizioni effettivamente aperte adesso.
- Il bilancio iniziale = valore totale del portafoglio Kraken al momento del seed (nessuno storico, equity parte da lì).

### 3. Verifica
- Dopo il reset, lancio un ciclo manuale dell'engine per innescare il seed.
- Controllo che `positions` contenga solo le aperte reali e che `portfolio_snapshots` riparta da un singolo snapshot iniziale.

## Note
- Nessuna modifica a LIVE, Kraken keys, strategia, preset, o configurazione AI Supervisor.
- Nessuna modifica al codice — è solo un'operazione di pulizia dati + riseed automatico.
