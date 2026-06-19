# Strategia di Trading v4 — Bot Kraken multi-asset

> Evoluzione della v3: mantiene Core-Led + Bear-DCA su BTC/ETH, ma il satellite valuta tutto l'universo Kraken liquido, incluse azioni tokenizzate/xStocks, forex e commodity se presenti e negoziabili.
>
> **Premessa onesta**: i "miglioramenti" della v3 sono soprattutto **disciplina di validazione e onestà sulle commissioni** — non una strategia più "furba". Spesso la versione vincente è la più semplice. Nulla va in live finché un backtest serio non supera il cancello della §5.

---

## 1. Cosa cambia rispetto alla v2 (sintesi)

| Area | v2 | **v3** | Motivo |
|---|---|---|---|
| Commissioni nel backtest | spesso 0.1% (default) | **fee reali Kraken 0.5–0.8% a giro** | i default sottostimano i costi di 3–4× |
| Peso Core / Satellite | 60 / 40 | **70 / 30** (+ modalità *core-only*) | il core ha dimostrato il suo valore; il satellite disperde valore |
| Bear-DCA | proposta | **opzionale, da validare** | utile solo se batte il trend puro nel backtest |
| Target minimo satellite | +4% | **+5%** | per superare le fee reali con margine |
| Tetto trade satellite/mese | ≤8 | **≤6** | meno frequenza = meno drag |
| Universo | crypto Kraken | **Kraken multi-asset**: crypto + token azionari/xStocks + forex + commodity | cercare momentum dove c'è liquidità, senza escludere asset Kraken validi |
| Validazione | accennata | **walk-forward + robustezza + vs DCA** formalizzati | è qui il vero salto di qualità |

---

## 2. La verità sulle commissioni (la cosa più importante)

Su Kraken Pro paghi **0,25% maker / 0,40% taker** per lato → un giro completo costa **~0,5–0,8%** (più slippage). I backtest "da brochure" usano spesso **0,1%**, cioè sottostimano i tuoi costi reali di **3–4 volte**.

Conseguenza concreta: il primo backtest che hai visto (rendimento −2%, **profit factor 1,09**) a commissioni realistiche sta **peggio** — quel margine del 9% sopra le perdite viene mangiato dalle fee. Ogni trade satellite deve guadagnare **molto più di ~0,8%** solo per coprire i costi.

**Regola v3**: ogni backtest usa le fee Kraken reali. Mai lo 0,1%. Lo strumento `backtest_v3.py` (allegato) ha già i default a 0,40% + slippage.

---

## 3. Architettura v3: "core-led"

Più peso alla parte robusta (il core trend-following, che ha schivato il bear del 2026), satellite **piccolo e severo** perché è dove il valore si disperde (fee + whipsaw + le alt crollano più di BTC nel risk-off).

### 3.1 CORE (~70%)
- **BTC/ETH** (es. 60/40), filtro macro **BTC vs SMA200** (investito / in stable).
- **Leg di accumulo (Bear-DCA) — OPZIONALE, da validare**: in **deep fear** (F&G < ~20–25) accumula piccole tranche capate (max ~30% del budget core) e **le TIENE** finché il trend non riparte.
  - ⚠️ **Tradeoff onesto e dimostrato**: in un bear che **non** si riprende, il bear-DCA **peggiora** i risultati (lo mostra anche il motore di backtest su dati di prova: accumula in una discesa che non torna su). Riduce la protezione dal drawdown.
  - **Accendilo SOLO se** in backtest batte il trend puro su **Sharpe E Max Drawdown**. Altrimenti tienilo spento.

### 3.2 SATELLITE (~30%)
- **Max 2** posizioni, **rischio 3%** per trade (size da volatilità), stop `max(12%, 2×ATR)`, trailing +12% / −8%, take-profit parziale +25%.
- **Target minimo per aprire: +5%** (alzato per le fee reali). **Tetto ≤6 trade/mese**. **Cooldown 48h**.
- Universo dinamico (vol > 5M, spread < 0,3%, età ≥ 60g) su Kraken multi-asset. **Non escludere** token azionari/xStocks, forex o commodity-pegged (es. PAXG): entrano nel satellite se passano liquidità, spread, età e trend. Le stablecoin restano escluse.
- **Gate satellite su BTC SMA50: confermato** (le alt crollano più di BTC nel risk-off → tenerlo).
- **Modalità *core-only***: interruttore per spegnere del tutto il satellite e tenere solo il core. Da considerare se il satellite non supera la validazione.

---

## 4. Metodologia di validazione (il vero salto di qualità)

1. **Walk-forward**: ottimizza i parametri su una finestra (es. 2022–2024), poi **valida su una finestra mai vista** (es. 2025–2026, che include questo bear). Conta solo il risultato out-of-sample.
2. **Robustezza > picco**: scegli **regioni** di parametri che funzionano in modo simile, non il singolo valore migliore (che è overfit e crolla dal vivo).
3. **Benchmark doppio**: confronta sempre con **Buy & Hold E con un DCA semplice**. Se la strategia non batte nemmeno un DCA sul rischio-aggiustato, semplifica.
4. **Fee reali Kraken** sempre.
5. **Strumento**: `backtest_v3.py` — testa core, bear-DCA, buy&hold e DCA sui tuoi dati reali, con fee Kraken e metriche complete.

---

## 5. Cancello di promozione a LIVE (inderogabile)

Si passa a soldi veri **solo se**, su dati out-of-sample e con fee Kraken:
- **Profit factor > 1,3**
- **Sharpe > 0,8**
- **batte il DCA semplice su Sharpe E Max Drawdown**
- validato su **due finestre temporali separate**

Se non passa → resta in paper, oppure ripiega su **core-only** o su **solo DCA**. Questo cancello è ciò che ti protegge dall'entusiasmo.

---

## 6. Aspettative oneste

- Anche la v3, in un **bull market pieno**, quasi certamente farà **meno** del buy & hold (tiene il 70% nel core ed è selettiva). Il suo valore è **risk-adjusted**: meno drawdown, corsa più liscia.
- La parte di "crescita aggressiva" vive nel satellite — che è anche la parte **meno dimostrata** e più costosa. Per questo è piccola e severamente filtrata.
- Non è garantito che batta nemmeno il rischio-aggiustato: **va dimostrato col backtest**, non assunto.

---

## 7. Parametri v3 — preset Bilanciato (default)

| Parametro | Valore |
|---|---|
| Capitale di riferimento | ~318 USD |
| Kill-switch globale | 50% (~159 USD) |
| Split Core / Satellite | **70 / 40** → **70 / 30** |
| Pesi core (BTC/ETH) | 60 / 40 |
| Filtro macro (core) | BTC vs **SMA200** |
| Bear-DCA | **off di default**; se attivo: trigger F&G < ~22, tetto 30% del core, tranche ~5%/capitale, intervallo ~14g |
| Max posizioni satellite | 2 |
| Rischio per trade (satellite) | 3% |
| Stop loss | max(12%, 2×ATR) |
| Trailing | +12% / −8% |
| Take-profit parziale | +25% |
| Target minimo per aprire | **+5%** |
| Tetto trade satellite/mese | **≤6** |
| Cooldown stesso asset | 48h |
| Filtri universo | vol > 5M, spread < 0,3%, età ≥ 60g; stablecoin escluse; token azionari/xStocks, forex e commodity inclusi se quotati su Kraken |
| Filtro medio (satellite) | BTC vs SMA50 + Fear & Greed |
| Commissioni (live + backtest) | maker 0,25% / taker 0,40% |
| Timeframe segnali | 4h |

I preset Conservativo e Aggressivo scalano di conseguenza (Conservativo: più core, satellite quasi spento; Aggressivo: più satellite — sconsigliato in bear).
