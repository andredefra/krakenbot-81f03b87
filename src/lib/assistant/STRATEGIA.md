# Strategia di Trading — Bot Crypto su Kraken

> Documento strategico (il "cosa" e il "perché"). La parte tecnica di realizzazione è nel file `BUILD_SPEC.md`.

---

## 1. Sintesi

Bot di trading **long-only**, stile **swing / momentum equilibrato**, su Kraken, con:
- esecuzione **automatica ma con limiti stretti** (tu non devi essere sempre presente);
- filtro basato su **sentiment** (Fear & Greed + social) attivabile/disattivabile;
- fase iniziale in **paper trading**, poi passaggio a **live** con un pulsante;
- **notifiche Telegram** a ogni apertura/chiusura, sugli errori, e un riepilogo giornaliero.

Obiettivo dichiarato: **crescita aggressiva ma non esagerata**, partendo da ~318 USD.

---

## 2. Aspettative realistiche (leggere bene)

- Nessuna strategia garantisce profitti costanti. Questo bot serve a **applicare regole con disciplina e gestire il rischio**, non a stampare soldi.
- Su 318 USD le **commissioni** sono il freno principale: su Kraken Pro un giro completo (compra+vendi) costa circa **0,5–0,8%**. Per questo la strategia evita di iper-tradare e impone un **target minimo per trade** che superi abbondantemente le fee.
- Lo stile è **alta varianza**: ci saranno mesi negativi. Lo stop globale serve esattamente a impedire che un brutto periodo azzeri il conto.
- Il sentiment è un input **utile ma rumoroso** (a volte manipolato). Si usa come filtro/conferma, mai come unico segnale.

**Solo capitale che puoi permetterti di perdere del tutto.** Questo non è un consiglio finanziario.

---

## 3. Profilo di rischio — parametri di default proposti

Tutti modificabili dal cruscotto. Valori pensati per "aggressivo ma non folle" su conto piccolo.

| Parametro | Valore di default | Note |
|---|---|---|
| Capitale di riferimento | ~318 USD | aggiornabile quando aggiungi fondi |
| **Stop globale (kill-switch)** | 50% del capitale di riferimento (~159 USD) | il bot **spegne tutto** e ti avvisa; calcolato anche sull'high-water mark se preferisci |
| Max posizioni aperte contemporaneamente | 3 | su conto piccolo, di più frammenta troppo |
| Dimensione max per posizione | 30% del portafoglio | con 3 posizioni ≈ 90% investito, ~10% cuscinetto |
| Stop loss per trade | −10% dall'ingresso | hard stop, anche come ordine reale su Kraken |
| Trailing stop | si attiva a +10%, poi insegue a −7% dal massimo | blocca i guadagni sui runner |
| Take-profit parziale (opzionale) | vende metà a +20% | lascia correre il resto col trailing |
| Target minimo per aprire | +2% atteso | filtro anti-commissioni / anti-overtrading |
| Limite di perdita giornaliero | −8% del portafoglio in un giorno | stop a nuovi ingressi fino al giorno dopo |
| Timeframe dei segnali | candele 1h o 4h | "swing", non scalping |
| Frequenza di controllo del motore | ogni 5–10 minuti | controlla segnali e stop |

---

## 4. Universo di asset

Tre "fasce", con regole diverse:

1. **Core** — ETH, SOL.
   I tuoi asset attuali, liquidi e con buon movimento. Sono i candidati principali ai trade.

2. **Sleeve di momentum** — lista curata di altcoin **liquide quotate su Kraken** (es. top per volume/liquidità, aggiornata periodicamente).
   È qui che catturiamo "ciò che sta pumpando" — **ma in modo disciplinato**: solo asset con order book profondo, mai microcap illiquide, sempre con stop e sizing pieni. Questo realizza la tua intenzione senza l'aspetto kamikaze.

3. **BTC** — usato soprattutto come **indicatore di regime di mercato** (vedi sotto), perché ha meno swing. Posizione diretta solo opzionale e piccola.

4. **Stablecoin (USDC/USDT)** — è la posizione **"cash"**, non una fonte di rendimento.
   Hai ragione che rende ~zero: il suo scopo è **difensivo**. Stare liquidi quando non ci sono buone occasioni o quando il mercato è "risk-off" è una decisione attiva che protegge il capitale.

> Vincolo importante: rispettare i **minimi d'ordine di Kraken** per ogni coppia. Su 318 USD con 3 posizioni i tagli sono piccoli, quindi il bot scarta i trade sotto il minimo eseguibile.

---

## 5. Logica della strategia

### 5.1 Regime di mercato (decisione "dall'alto")
Prima di tutto il bot decide se si può essere aggressivi (**risk-on**) o difensivi (**risk-off**):

- **Trend di BTC**: prezzo BTC sopra/sotto la sua media mobile a 50 periodi (daily) → mercato in salita / in discesa.
- **Fear & Greed Index**:
  - *Extreme Greed (>75)*: cautela, si stringono gli stop e si riducono i nuovi ingressi (rischio correzione).
  - *Extreme Fear (<25)*: possibile opportunità d'acquisto, **ma solo** se il singolo asset sta già girando al rialzo (non si comprano "coltelli che cadono").
  - *Neutro (25–75)*: operatività normale.
- **Esito**: si è **risk-on** (si aprono long) solo se BTC è in uptrend **e** il sentiment non è in Extreme Greed. Altrimenti **risk-off**: si riduce l'esposizione e ci si sposta verso cash.

### 5.2 Segnali di entrata (per ogni asset, se risk-on)
Si entra long quando si allineano:
- **Trend**: media mobile breve (20) sopra media mobile media (50) sul timeframe operativo.
- **Momentum/breakout**: il prezzo rompe il massimo recente con volume in aumento.
- **RSI**: non già in ipercomprato estremo (es. < 75). Preferiti gli ingressi su pullback con RSI che rimbalza dalla zona 40–50, oppure breakout confermati.
- **Liquidità**: order book sufficiente; asset troppo illiquidi vengono saltati.
- **Sentiment del singolo asset** (se la fonte social è attiva): Galaxy Score / volume social in aumento = conferma; in forte calo = niente ingresso, anche se la parte tecnica è a posto.

### 5.3 Integrazione del sentiment (attivabile/disattivabile)
Ogni fonte contribuisce a un **punteggio sentiment composito** con peso configurabile. Dal cruscotto puoi accendere/spegnere ogni fonte:
- **Fear & Greed (Alternative.me)** → gate di regime generale. *Gratis, sempre consigliato attivo.*
- **Social (LunarCrush)** → conferma sul singolo asset (Galaxy Score, social volume).
- **On-chain + social (Santiment)** → conferma aggiuntiva, segnali di divergenza.
- **Notizie (opzionale)** → reazione difensiva su eventi forti.

Se spegni tutte le fonti, il bot opera in modalità **solo tecnica**.

### 5.4 Dimensionamento
- Ogni nuova posizione = fino al **30%** del portafoglio (parametro).
- Mai più di **3** posizioni aperte insieme.
- Lo stop loss definisce il rischio massimo per trade: a −10% di stop e 30% di size, il rischio per trade ≈ 3% del portafoglio.

### 5.5 Regole di uscita
La posizione si chiude quando si verifica **una qualsiasi** di queste:
- **Stop loss** colpito (−10%, idealmente come ordine reale su Kraken).
- **Trailing stop** o **take-profit** raggiunto.
- **Inversione di trend**: la media breve incrocia sotto la media media.
- **Regime → risk-off**: si riduce/chiude per difesa.
- **Crollo improvviso del sentiment** (se la fonte è attiva): uscita difensiva.

---

## 6. Modalità Paper → Live

- **PAPER**: stessa identica logica, ma gli ordini sono **simulati** sui prezzi reali (saldo virtuale). Da tenere attivo alcune settimane per validare e tarare i parametri.
- **GO LIVE**: un interruttore nel cruscotto passa agli **ordini reali** su Kraken. Con doppia conferma. Consigliato partire con size ridotta (es. 15% per posizione) per le prime settimane live, poi alzare.
- Le notifiche indicano sempre se un trade è `PAPER` o `LIVE`, così non c'è confusione.

---

## 7. Notifiche Telegram (formati)

**Apertura trade**
```
🟢 NUOVO TRADE — {ASSET}   [{PAPER|LIVE}]
Ingresso: {prezzo} USD
Quantità: {qty} {ASSET}
Valore: {valore} USD ({pct}% del portafoglio)
Motivo: {segnale}
💼 Portafoglio totale: {totale} USD
```

**Chiusura trade**
```
{✅|❌} TRADE CHIUSO — {ASSET}   [{PAPER|LIVE}]
Ingresso: {valore_ingresso} USD @ {prezzo_ingresso}
Uscita:   {valore_uscita} USD @ {prezzo_uscita}
P/L: {pnl} USD ({pnl_pct}%)
Durata: {durata}
Motivo uscita: {motivo}
💼 Portafoglio totale: {totale} USD
```

**Errore**
```
⚠️ ERRORE — {componente}
{messaggio}
Azione intrapresa: {es. trade saltato, bot in pausa}
```

**Riepilogo giornaliero (es. ore 22:00)**
```
📊 RIEPILOGO {data}
💼 Portafoglio: {totale} USD ({variazione_giorno} oggi)
Posizioni aperte: {n}
  • {ASSET}: {upnl} USD ({upnl_pct}%)
P/L realizzato oggi: {realizzato} USD
Trade chiusi oggi: {conteggio}
Regime: {risk-on|risk-off} | Fear&Greed: {valore} ({etichetta})
```

---

## 8. Cosa NON fa questo bot (per scelta)

- Non insegue microcap illiquide / token da DEX / "shitcoin" appena nate.
- Non usa leva / short (long-only, come richiesto).
- Non fa scalping ad alta frequenza (le commissioni lo renderebbero perdente su questo capitale).
- Non promette rendimenti: applica regole e ti tiene informato.
