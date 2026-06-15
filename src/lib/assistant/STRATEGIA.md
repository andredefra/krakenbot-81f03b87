# Strategia di Trading v2 — Bot Crypto su Kraken

> Revisione della v1 dopo il primo backtest (sotto-performance vs buy & hold). Sostituisce le §4–5 di `STRATEGIA.md`. Tutto il resto (notifiche, paper→live, sicurezza) resta valido.

---

## 1. Perché la v1 ha sotto-performato (e cosa cambiamo)

Il backtest non era "rotto": il risultato è normale per una strategia attiva. Cambiamo la v2 partendo dai tre motivi reali, **non** ritoccando parametri per far diventare verde il grafico.

| Problema della v1 | Sintomo nel backtest | Intervento in v2 |
|---|---|---|
| Troppe commissioni | Profit factor 1,09 (margine quasi nullo), 32 trade | **Disciplina commissioni**: meno trade, ordini limit, target minimo alto, tetto al numero di trade |
| Whipsaw (mercati ondulati) | Win rate 47%, Sharpe 0,11 | **Riduzione whipsaw**: timeframe più lento, filtro volatilità, stop più larghi + size minore, cooldown |
| Cash drag | Sharpe e rendimento peggiori del buy & hold | **Architettura Core-Satellite**: una base resta esposta al trend, solo una parte fa trading attivo |

---

## 2. Cosa significa "vincente" qui (obiettivo onesto)

- **NON** "battere il rendimento grezzo di BTC ogni periodo" → quasi impossibile, soprattutto in bull market pieno.
- **SÌ** "miglior rendimento aggiustato per il rischio": catturare buona parte dell'upside con **drawdown più contenuti** e **meno commissioni**. Metriche guida: Sharpe più alto e Max DD più basso del buy & hold, accettando di rinunciare a parte del rendimento nei rialzi più violenti.

Questo è un obiettivo raggiungibile. "Rendimento costante che batte il mercato" no — chi te lo promette mente.

---

## 3. Architettura Core-Satellite

Il portafoglio si divide in tre parti (proporzioni configurabili):

### 3.1 CORE — base esposta al trend (~60%)
- Allocazione in **BTC + ETH** (es. 60/40 dentro il core), **non** tradata dentro/fuori in continuo.
- Unico filtro, grossolano e a bassa frequenza: **trend-following di lungo periodo** per tagliare i crash, non per fare trading.
  - Se BTC sta **sotto la media mobile a 200 giorni** → si riduce/esce il core verso stablecoin (controllo settimanale).
  - Quando BTC **riconquista** la 200 giorni → si rientra.
- Questo è ciò che risponde al "cash drag" e al drawdown: catturi gran parte del buy & hold, ma eviti la fase peggiore dei ribassi.

### 3.2 SATELLITE — sleeve di momentum attivo (~40%)
- Questa parte fa i trade attivi su **tutto l'universo Kraken** (500+ asset), ETH e SOL inclusi.
- **Selettivo e poco frequente** (vedi §4 e §5).
- Massimo **2 posizioni** aperte insieme.

**Universo dinamico (non una lista fissa).** Il bot scansiona l'intero catalogo Kraken e, prima di considerare un asset, lo passa attraverso cancelli di liquidità/qualità oggettivi (tutti configurabili):

| Cancello | Default | A cosa serve |
|---|---|---|
| Volume 24h minimo | > 5.000.000 USD | poter entrare/uscire senza slippage eccessivo |
| Spread bid-ask massimo | < 0,3% | su asset illiquidi lo spread da solo supera le commissioni: è il filtro che protegge il conto |
| Età minima dalla quotazione | ≥ 60 giorni | tiene fuori le quotazioni nuovissime, dove si concentrano i pump-and-dump |
| (opz.) Copertura dati sentiment | richiesta solo se il filtro sentiment è attivo | gli asset troppo piccoli non hanno dati social/on-chain affidabili |

L'universo è **dinamico**: un asset diventa tradabile quando guadagna liquidità ed esce automaticamente quando la perde, senza interventi manuali. Così si copre "tutto ciò che si muove su Kraken" mantenendo i cancelli come protezione.

> Nota onesta: anche con i cancelli, tradare la coda lunga delle alt su un conto da ~318 USD resta ad **alta varianza** e con un drag di commissioni/slippage più alto rispetto a BTC/ETH. I cancelli riducono il rischio di rovina, non lo azzerano.

### 3.3 CASH (stablecoin)
- Dove finiscono core (in macro-downtrend) e satellite (quando non ci sono buone occasioni). Funzione difensiva, non di rendimento.

---

## 4. Disciplina commissioni (la leva più importante)

Su 318 USD le fee decidono tutto. Regole rigide:
- **Ordini limit (maker)** dove possibile → ~0,25% invece di ~0,40%.
- **Target minimo per aprire un trade satellite: +4%** (≈ 5–8x il costo di un giro completo). Niente trade "mordi e fuggi".
- **Cooldown**: dopo aver chiuso un trade su un asset, **48h** prima di rientrare sullo stesso (anti re-ingresso da whipsaw).
- **Tetto al numero di trade satellite: max ~8 al mese.** Forza la selettività e taglia il drag (la v1 ne faceva ~4x tanti).
- Il motore scarta qualsiasi trade sotto i **minimi d'ordine di Kraken**.

---

## 5. Riduzione del whipsaw

- **Timeframe più lento**: segnali su **4h e daily** (la v1 usava 1h, troppo rumore).
- **Filtro di volatilità**: se la volatilità è estrema/caotica (es. ATR% sopra una soglia, prezzo che "balla" intorno alla media) → niente nuovi ingressi.
- **Stop più larghi, size più piccola**: stop = `max(12%, 2×ATR)`, con la dimensione calcolata in modo che il **rischio per trade resti ~3% del portafoglio**. Così non vieni stoppato dal rumore, ma il rischio in euro è controllato.
- Frequenza di controllo del motore: ogni **15 minuti** (la strategia è più lenta, non serve di più).

---

## 6. Dimensionamento per volatilità (risk parity leggero)

- Ogni posizione satellite rischia la **stessa piccola % del portafoglio** (default 3%), non una % fissa di capitale.
- Dimensione = `rischio_target / distanza_dallo_stop`. → Le alt più volatili ricevono size minore.
- Esposizione satellite totale ≤ 40% del portafoglio.
- Migliora il profilo di rischio: nessun singolo trade può fare danni sproporzionati.

---

## 7. Regime e sentiment (semplificati)

Due livelli, tenuti semplici per non aggiungere rumore:
- **Macro (governa il Core)**: BTC vs media 200 giorni → dentro/fuori dal core.
- **Medio (governa il Satellite)**: BTC vs media 50 giorni + Fear & Greed → si possono aprire nuovi long satellite solo se risk-on.
  - *Extreme Greed (>75)*: nessun nuovo ingresso satellite, stop più stretti.
  - *Extreme Fear (<25)*: ingressi solo se il singolo asset sta già girando al rialzo.
- **Social (LunarCrush, opzionale)**: solo come conferma sui trade satellite, mai come segnale primario.

---

## 8. Regole operative aggiornate

**Ingresso satellite** (tutte vere, in regime medio risk-on):
1. Trend su: prezzo > media 50 (daily) **e** media 20 > media 50 (4h).
2. Breakout/momentum con volume in aumento.
3. Volatilità non estrema (filtro §5 superato).
4. Target logico ≥ **+4%** dall'ingresso.
5. Sentiment del singolo asset non in calo (se la fonte è attiva).
6. Posizioni satellite aperte < 2 e tetto mensile non raggiunto.

**Uscita satellite** (una qualsiasi):
- Stop colpito (come ordine reale su Kraken in live).
- Trailing stop (parte a +12%, insegue a −8% dal massimo) o take-profit parziale (metà a +25%).
- Inversione di trend (media 20 incrocia sotto media 50 su 4h).
- Regime medio → risk-off.

**Gestione Core**:
- Ribilancio mensile verso i pesi target.
- Esce in macro-downtrend (BTC < 200gg), rientra al recupero.
- Nessun altro trading sul core.

---

## 9. Parametri di default v2

| Parametro | v1 | **v2** | Motivo |
|---|---|---|---|
| Universo | lista curata di alt liquide | **tutto Kraken, filtrato per liquidità** | più opportunità senza la coda illiquida |
| Volume 24h minimo | — | **> 5M USD** | evita slippage |
| Spread massimo | — | **< 0,3%** | lo spread non mangia il trade |
| Età minima quotazione | — | **≥ 60 giorni** | fuori i pump da nuova quotazione |
| Split Core / Satellite | (100% attivo) | **60% / 40%** | riduce cash drag e fee |
| Max posizioni satellite | 3 | **2** | più selettività |
| Rischio per trade | ~3% (size 30%) | **3% (size da volatilità)** | profilo di rischio migliore |
| Stop loss | −10% fisso | **max(12%, 2×ATR)** | meno stop da rumore |
| Trailing | +10% / −7% | **+12% / −8%** | lascia respirare i runner |
| Target minimo per aprire | +2% | **+4%** | supera meglio le fee |
| Tetto trade satellite | — | **~8 / mese** | taglia il drag commissioni |
| Cooldown stesso asset | — | **48h** | anti-whipsaw |
| Timeframe | 1h / 4h | **4h / daily** | meno rumore |
| Tipo di ordine | (qualsiasi) | **limit/maker preferito** | fee 0,25% vs 0,40% |
| Macro filter sul core | — | **BTC vs 200gg** | taglia i crash |
| Frequenza motore | 5 min | **15 min** | strategia più lenta |
| Stop globale | 50% | **50%** | invariato (tua scelta) |

---

## 10. Aspettative oneste sulla v2

- In un **bull market violento**, questa v2 quasi certamente **farà meno** del buy & hold: tiene solo il 60% nel core ed è selettiva. È il prezzo di una corsa più liscia.
- Il valore atteso è: **drawdown più piccoli, Sharpe più alto, meno commissioni** — non un rendimento grezzo più alto.
- **Non è garantito che batta nemmeno il rischio-aggiustato.** Va dimostrato col test, non assunto.

---

## 11. Criterio di promozione a LIVE (da fissare ORA, prima di altri test)

Si passa a soldi veri **solo se** il backtest (con dati reali, fee 0,5–0,8% e slippage):
- è validato su **due periodi separati** (uno per tarare, uno mai toccato per verificare);
- ha **profit factor > 1,3** (margine vero sopra le fee, non 1,09);
- ha **Sharpe out-of-sample > 0,8**;
- ha **Max DD entro la soglia che tolleri** (es. < 30%);
- gira su un campione decente di trade. *Nota: una strategia poco frequente fa pochi trade → servirà testare su un periodo lungo, oppure accettare più incertezza statistica.*

Se non supera questi paletti, **non va in live** — si resta in paper o si torna al tavolo. Questo criterio è ciò che ti protegge dall'entusiasmo.

---

## 12. La domanda scomoda (da tenere a mente)

Per un conto da ~318 USD, la cosa statisticamente più "vincente" potrebbe essere **tradare ancora meno**: un semplice DCA (acquisto periodico) su un paniere BTC/ETH, con magari il solo filtro macro a 200 giorni per evitare i crash, batte spesso i bot attivi proprio perché paga pochissime commissioni e non soffre il whipsaw.

Usa quel DCA come **metro di paragone** nel backtest: se la v2 non batte nemmeno un banale DCA sul rischio-aggiustato, la risposta onesta è semplificare, non complicare.
