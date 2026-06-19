## Problema

L'errore `positions_sleeve_check` blocca il seed PAPER perché in `runSeedPaperFromKraken` ho usato `sleeve: "seed"`, ma la tabella `positions` accetta solo `'core' | 'satellite' | 'dca'`.

## Fix

In `src/lib/portfolio.functions.ts` → `runSeedPaperFromKraken`:

- Sostituire `sleeve: "seed"` con `sleeve: "core"` per ogni riga inserita. Le posizioni importate da Kraken rappresentano il capitale di partenza, quindi "core" è la sleeve corretta.
- Lasciare `open_reason: "seed_from_kraken"` come marcatore tracciabile (campo libero).

## Verifica

Dopo la fix, clic su "Risincronizza da Kraken" sulla dashboard deve:
1. Inserire le posizioni reali Kraken come `sleeve='core'`, `mode='paper'`.
2. Aggiornare `settings.paper_seeded_at` e i totali.
3. La card "Valore portafoglio (PAPER)" mostra il totale reale, non più "Errore".

## File toccati

- `src/lib/portfolio.functions.ts` (1 riga)

Nessuna migration necessaria.
