## Obiettivi

1. **Strategia V4** — estensione del paniere oltre le crypto: aggiungere **azioni**, **futures** e **forex** con allocazioni per preset (Conservativo / Bilanciato / Aggressivo).
2. **Pie chart live del portafoglio** — composizione generale (per asset class) + drill-down per singolo asset.
3. **Fix getPortfolio** — niente più "An error occurred" generico, niente saldo finto 318 USD, fonte coerente Paper vs Live, test diagnostico Kraken.

---

## 1) Strategia V4 — multi-asset

### Modello concettuale
Ogni preset definisce due livelli di allocazione:
- **Asset class split** (somma = 100%): `crypto / stocks / futures / forex`.
- Dentro ogni classe: stesso schema core/satellite già esistente.

Proposta di default V4:

| Preset | Crypto | Azioni | Futures | Forex | Note |
|---|---|---|---|---|---|
| Conservativo | 60% | 35% | 0% | 5% | Azioni = ETF large cap (es. SPY/VTI), forex solo EUR/USD hedge |
| Bilanciato | 50% | 30% | 10% | 10% | Futures su indici principali, forex majors |
| Aggressivo | 45% | 25% | 20% | 10% | Futures con leva contenuta, forex majors+cross |

I valori esatti restano modificabili dalla pagina Strategia.

### Cambiamenti DB (migration)
- `settings`: aggiungere `asset_class_split jsonb` (default per preset), `stocks_universe text[]`, `futures_universe text[]`, `forex_universe text[]`.
- `positions`: aggiungere `asset_class text` (`crypto|stock|future|forex`, default `crypto` per dati esistenti) + indice.
- `universe`: aggiungere colonna `asset_class` con default `crypto`.
- `engine_diagnostics`: aggiungere `asset_class_exposure jsonb` per riportare il peso effettivo.

### Codice
- `src/lib/strategy-presets.ts`: estendere `PresetValues` con `asset_class_split` e universi per classe; aggiornare i 3 preset; aggiornare `detectPreset`.
- Backtest (`src/lib/backtest.server.ts`): supportare più classi (richiede serie OHLC anche per stocks/forex/futures). In assenza di feed, V4 backtest gira sulle classi con dati disponibili e segnala "no data" per le altre — niente numeri inventati.
- Engine (`supabase/functions/trading-engine`): rispettare l'allocazione per classe. **In paper mode** simula su tutte le classi. **In live mode** esegue solo le classi supportate dal broker attivo (oggi solo Kraken → crypto + forex spot via coppie XBT/EUR ecc.). Stocks/futures = solo paper finché non connettiamo un broker dedicato; viene mostrato un badge "Solo Paper" sulla classe.
- Pagina Strategia: nuova sezione "Allocazione per classe" con sliders + warning per classi paper-only.

### Note importanti
- **Non si attiva GO LIVE su classi senza broker.** Il gate live resta crypto-only fino a integrazione broker stocks/futures.
- Documentare la cosa in `STRATEGIA.md` (nuova sezione v4).

---

## 2) Pie chart live del portafoglio

Nuovo componente `PortfolioPieChart` in `src/components/dashboard/`:
- **Vista 1 (generale)**: pie per asset class (crypto / stocks / futures / forex / cash).
- **Vista 2 (dettaglio)**: click su uno spicchio → pie dei singoli asset di quella classe (es. BTC 40%, ETH 25%, SOL 10%…).
- Toggle a tab sopra il grafico.
- Dati da una nuova server fn `getPortfolioComposition` che:
  - In **Live**: usa Kraken `Balance` + prezzi spot per valorizzare in USD.
  - In **Paper**: usa la tabella `positions` (open) + cash simulato.
- Aggiunto nella pagina Dashboard sotto la curva equity.
- Usa `recharts` `<PieChart>` (già in progetto).

---

## 3) Fix getPortfolio + Kraken connection

### Cause probabili dell'errore generico
- L'handler attuale legge solo `portfolio_snapshots` e non interroga Kraken in tempo reale → il "318 USD" è uno snapshot vecchio (paper) mostrato anche in modalità live = bug grave.
- Quando si tenta una chiamata Kraken, l'errore Kraken (`error: ["EAPI:Invalid key"]` ecc.) viene incapsulato in un generico `throw new Error("...")` che lato UI diventa "An error occurred".

### Cosa cambia

**a) Kraken client (`src/lib/kraken.server.ts`)**
- Nuova funzione `fetchKrakenBalanceEx(apiKey, apiSecret)` che chiama `/0/private/BalanceEx`.
- Nuova funzione `fetchKrakenTradeBalance(apiKey, apiSecret, asset="ZUSD")` per equity totale + margin.
- Tutte le funzioni private:
  - Loggano `status` HTTP + payload `error[]` completi (server side, non al client).
  - Lanciano `KrakenApiError` con codice (`EAPI:Invalid key`, `EAPI:Invalid signature`, `EAPI:Invalid nonce`, `EGeneral:Permission denied`, ecc.) e messaggio leggibile.
- Verifica della firma resta quella attuale (HMAC-SHA512 di `path + SHA256(nonce + body)`, secret base64-decoded) — già conforme alla doc Kraken.

**b) Server fn `getLivePortfolio` (nuova, `src/lib/portfolio.functions.ts`)**
- Protetta con `requireSupabaseAuth`.
- Legge mode da `settings`:
  - **paper** → ritorna composizione e equity calcolata dalle `positions` paper + cash (da `portfolio_snapshots` più recente in mode=paper). Marca `source: "paper"`.
  - **live** → carica `KRAKEN_API_KEY` / `KRAKEN_API_SECRET` dai secrets, chiama `BalanceEx` + `TradeBalance` + ticker per valorizzare. Marca `source: "kraken-live"`.
- In caso di errore, ritorna `{ ok: false, error: { code, message, httpStatus, krakenError } }` con il **vero** messaggio Kraken — niente fallback a snapshot vecchi.

**c) UI Dashboard**
- Rimuovere qualunque numero hardcoded/placeholder; se `getLivePortfolio` fallisce in live mode, mostrare alert rosso: *"Impossibile recuperare il saldo da Kraken: {messaggio reale}"* + bottone "Vai a Diagnostica".
- Mostrare un badge che indica la fonte: "Saldo live Kraken" vs "Portfolio simulato (Paper)".

**d) Tool assistant `getPortfolio`**
- Riscritto per richiamare `getLivePortfolio` invece di leggere solo `portfolio_snapshots`. In caso di errore Kraken, restituisce all'LLM il messaggio reale così la chat può spiegarlo all'utente.

**e) Diagnostica Kraken**
- Nella pagina `/diagnostica` aggiungere card "Connessione Kraken" con bottone "Test connessione" che chiama una nuova server fn `testKrakenConnection`:
  - Chiama `Balance` (endpoint leggero autenticato).
  - Risposta: ✅ OK con timestamp, oppure ❌ con codice errore Kraken esatto e suggerimento (es. "Permission denied → abilita 'Query Funds' nelle API key Kraken").

### Configurazione richiesta all'utente
- I secrets `KRAKEN_API_KEY` e `KRAKEN_API_SECRET` risultano già presenti nei Supabase Secrets.
- Verificare nel pannello Kraken che la API key abbia i permessi: **Query Funds**, **Query Open Orders & Trades**, **Query Closed Orders & Trades**. Per il trading live serviranno anche **Create & Modify Orders** e **Cancel Orders** (non necessari ora per il solo getPortfolio).

---

## Ordine di esecuzione consigliato
1. Migration DB (asset_class su settings/positions/universe + nuovo campo diagnostics).
2. Fix Kraken: client + `getLivePortfolio` + tool assistant + diagnostica.
3. Pie chart in dashboard usando `getLivePortfolio`.
4. Estensione preset V4 + UI strategia + aggiornamento `STRATEGIA.md`.
5. Backtest V4 (multi-class, segnalando classi senza dati).

Procedo? Se sì, in build mode parto dalla migration e dal fix Kraken (priorità che hai segnalato come "errore gravissimo"), poi pie chart, poi V4.
