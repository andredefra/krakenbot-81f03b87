# Nuova strategia: BTC-core + rotazione momentum

## Idea in una frase
Il capitale sta **sempre investito in BTC** (default), e ruota su ETH/SOL/sleeve quando un altro asset mostra un **momentum relativo** più forte di BTC. Esce in cash solo quando BTC scende sotto la sua SMA200 (regime ribassista vero).

Questo cambia radicalmente il profilo: niente più periodi lunghi a cash che fanno sembrare la linea piatta, e si batte BTC B&H nei laterali / bear moderati grazie alla rotazione, perdendo meno nei bear forti grazie al filtro SMA200.

## Regole operative

**Regime (check giornaliero):**
- BTC > SMA200 → *risk-on*: investito al 100%
- BTC < SMA200 → *risk-off*: tutto in cash (capitale fermo)

**Allocazione in risk-on:**
- Calcolo *momentum score* di ogni asset = ritorno % a 30 giorni
- Seleziono i top-N per score (N = `max_positions` del preset)
- BTC è sempre incluso nella selezione (anchor): occupa almeno 1 slot
- Pesi uguali tra gli asset selezionati (es. 3 slot = 33% ciascuno)
- Ribilancio settimanale (ogni 7 giorni) o quando un asset esce/entra dal top-N

**Stop di emergenza (non trailing aggressivo):**
- Stop loss per singolo asset a `−stop_loss_pct` dall'ingresso (esce dal singolo, il capitale va su BTC o cash)
- Kill-switch giornaliero: se il portafoglio perde > `daily_loss_limit_pct` in un giorno, va tutto in cash per 24h

**Costi:** fee 0.4% + slippage 0.1% per side, applicati a ogni ribilancio.

## Quarta linea benchmark: "BTC + SMA200"
Aggiungo una baseline triviale per capire se la rotazione aggiunge davvero valore:
- BTC > SMA200 → 100% BTC
- BTC < SMA200 → cash
Stessi costi della strategia. Se la strategia non batte questa baseline → la rotazione non sta aggiungendo nulla e va semplificata.

## File toccati

### 1. `src/lib/backtest.server.ts` (riscrittura della logica trading, KPI invariati)
- Nuova funzione `pickTopN(date, assets, btc, n)` che calcola momentum 30d e ritorna i top-N (BTC sempre presente)
- Loop giornaliero:
  1. Update mark-to-market posizioni esistenti
  2. Check regime BTC vs SMA200 → se sotto: liquida tutto in cash, skip
  3. Check kill-switch giornaliero
  4. Ogni 7 giorni (o se composizione top-N cambia): ribilancia a equal-weight tra top-N
  5. Check stop loss per singolo asset
- Aggiungo `btcRegime` equity curve (4° benchmark) calcolata in parallelo con stessa logica costi
- Output `BacktestResult` esteso con `btcRegimeKpis` e `equity[].btcRegime`

### 2. `src/lib/backtest.functions.ts`
- Estendo il payload con `btcRegimeKpis` e includo `btcRegime` nel downsampling equity
- Cambio la chiave cache (aggiungo `v2` al hash) per invalidare i run vecchi

### 3. `src/routes/_authenticated/strategia.tsx`
- Aggiungo 4ª linea nel grafico (`btcRegime`, colore distinto + spessore +1 alla strategia)
- Aggiungo KPI card "BTC+SMA200" accanto a Strategia/BTC/S&P
- Aggiungo nel riepilogo finale: "Da €X a: Strategia €… · BTC €… · S&P €… · BTC+SMA200 €…"
- Aggiorno legenda con tooltip "Cosa fa la strategia" che mostra le 4 regole

### 4. `src/lib/strategy-presets.ts`
- Aggiungo campo opzionale `rebalance_days: number` (default 7) ai presets — non breaking, fallback a 7 se assente
- Preset values restano compatibili, ma `regime_filter` diventa "btc_sma200" per tutti (è la regola della nuova strategia, non più una scelta per preset). Il preset ora differenzia solo: `max_positions`, `stop_loss_pct`, `daily_loss_limit_pct`, universo
- Aggiorno le `description.entryRules / exitRules` per riflettere la nuova logica

### 5. Tabella `backtest_runs` (nessuna migration necessaria)
- Il bump della cache key invalida i run vecchi automaticamente, lo schema JSON `result` è già libero

## Cosa NON tocco
- `historical-sync` edge function (dati invariati)
- `strategy.functions.ts` (preset save / load)
- `trading-engine` live (questa è solo la simulazione backtest; il live verrà allineato in un secondo step quando approverai il comportamento sui grafici)
- Auth, RLS, layout pagina

## Verifica
Dopo l'implementazione, con €200 capitale e preset Balanced su 2y, mi aspetto:
- Linea Strategia chiaramente visibile (sempre investita, mai flat lunghi)
- Strategia ≈ BTC B&H nei forti bull, > BTC B&H nei laterali (grazie a rotazione su ETH/SOL nei loro periodi di forza), < drawdown di BTC nei bear (grazie a SMA200)
- BTC+SMA200 come "sanity check": se strategia ≤ baseline → la rotazione non paga, semplifico

## Trade-off da accettare
1. In un mega-bull lineare di solo BTC (es. 2024-2025 puro), la strategia potrebbe ancora perdere qualche punto vs BTC B&H per i costi di ribilancio → è normale, è il prezzo della protezione nei bear
2. Più trade della versione attuale (1 ogni 7 giorni per ribilancio + stop) → costi più alti ma comunque sotto l'1% mensile
3. Il backtest non modella ancora il fatto che durante un crash gli stop slippano molto di più dello 0.1% → stima ottimistica nei drawdown del 2022. Lo segnalo nel tooltip.