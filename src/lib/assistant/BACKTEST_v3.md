# Metodologia di Backtest v3

> Documento di riferimento per l'assistente AI e per chi mantiene il motore di backtest. Riassume la logica del file `backtest_v3.py` (allegato alla strategia) e come va applicata nel motore interno.

## Principi

1. **Fee reali Kraken sempre**: maker 0.25%, taker 0.40%, slippage 0.05%. Mai più 0.1% di default.
2. **Doppio benchmark obbligatorio**: ogni strategia va confrontata con **Buy & Hold E con un DCA semplice**. Se non batte nemmeno il DCA sul rischio-aggiustato, la complessità non è giustificata.
3. **Walk-forward**: ottimizza parametri su una finestra (es. 2022–2024), valida su finestra mai vista (es. 2025–2026). Conta solo l'out-of-sample.
4. **Robustezza > picco**: cerca regioni di parametri che funzionano in modo simile, non il singolo valore migliore (overfit).

## Strategie testate (per singolo asset, di solito BTC poi ETH)

| Strategia | Logica |
|---|---|
| `buy_hold` | Compra tutto al primo giorno, mantieni. Benchmark 1. |
| `dca` | Acquisto periodico a importo fisso (default ogni 7 giorni). **Il vero metro**. |
| `trend_core` | Investito quando `close > SMA(n)` (default n=200), altrimenti cash. Replica il filtro di regime v3 sul core. |
| `trend_dca` | `trend_core` + tranche DCA opzionali in ribasso profondo (drawdown ≤ −25% dal max a 90g), **tenute** finché il trend non riparte. È la proposta v3 da validare. |

## Cancello di promozione a LIVE

Si passa a soldi veri **solo se**, su dati out-of-sample con fee Kraken:

- **Profit Factor > 1.3**
- **Sharpe > 0.8**
- **batte il DCA** su Sharpe E Max Drawdown
- validato su **due finestre temporali separate**

Se non passa → resta in paper, oppure ripiega su **core-only** o su **solo DCA**.

## Metriche calcolate

Per ogni strategia: `total_return`, `cagr`, `vol`, `sharpe`, `sortino`, `max_dd`, `calmar`, `n_trades`, `win_rate`, `profit_factor`.

## Implementazione interna

Il motore TS (`src/lib/backtest.server.ts`) implementa le stesse 4 strategie con identica logica del Python di riferimento. Le fee sono lette da `settings` (maker/taker/slippage), MAI hardcoded.
