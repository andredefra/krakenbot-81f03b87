## Obiettivo

1. Pagina **Sentiment**: aggiungere Finnhub + Alpha Vantage sia come **fonti dati mercato** (stato API key, asset class servita) sia come **fonti sentiment news** con peso derivato dal preset.
2. Rebrand UI **v3 → v4** in Diagnostica, Strategia, Sentiment, Dashboard + descrizioni preset.
3. Allineare copy AI Supervisor / Diagnostica al fatto che ora la strategia è multi-asset (crypto + stocks via xStocks + forex).

## Modifiche

### A) `src/lib/strategy-presets.ts`
- Aggiungere a `SENTIMENT_BASE` due nuove sorgenti: `finnhub_news` e `alpha_vantage_news`. Pesi base proposti (somma normalizzata dal `derive`):

  | preset | fear_greed | lunarcrush | santiment | finnhub_news | alpha_vantage_news | news |
  |---|---|---|---|---|---|---|
  | conservative | 0.55 | 0.15 | 0.10 | 0.10 | 0.10 | 0.0 |
  | balanced | 0.40 | 0.20 | 0.15 | 0.15 | 0.10 | 0.0 |
  | aggressive | 0.25 | 0.30 | 0.20 | 0.15 | 0.10 | 0.0 |

- Estendere `SENTIMENT_SOURCES` con le due nuove chiavi.
- Aggiornare commento di testa: "Strategia v4 multi-asset (crypto core/satellite + stocks via xStocks + forex)".
- Aggiornare `tagline`/`summary` dei preset: "Default v4" al posto di "Default v3".

### B) Pagina Sentiment (`src/routes/_authenticated/sentiment.tsx`)
- Aggiornare titolo/copy "v3" → "v4".
- Aggiungere a `SOURCES`:
  - `finnhub_news` — "Finnhub News & Earnings — segnali fondamentali su stocks/xStocks. Richiede `FINNHUB_API_KEY`."
  - `alpha_vantage_news` — "Alpha Vantage News Sentiment — fallback fondamentali stocks/forex. Richiede `ALPHA_VANTAGE_API_KEY`."
- Nuovo blocco **"Fonti dati di mercato"** (sopra il blocco Fonti sentiment):
  - Riga **Kraken** — crypto prezzi + saldi (badge "configurato" se le secret esistono).
  - Riga **Finnhub** — stocks/xStocks prezzi (badge ON/OFF).
  - Riga **Alpha Vantage** — forex + fallback stocks (badge ON/OFF).
  - Non sono toggle-abili (sono infrastruttura), solo stato.

### C) Nuova server fn `getMarketDataStatus` in `src/lib/diagnostics.functions.ts`
- Ritorna `{ kraken: boolean, finnhub: boolean, alphaVantage: boolean }` leggendo `process.env.KRAKEN_API_KEY`, `FINNHUB_API_KEY`, `ALPHA_VANTAGE_API_KEY` (solo boolean, mai i valori).
- Usata dal nuovo blocco in Sentiment.

### D) Diagnostica (`src/routes/_authenticated/diagnostica.tsx`)
- Titolo: "Diagnostica engine v4".
- Sottotitolo aggiornato: "Regimi macro/meso, Core / Satellite / Bear-DCA, **multi-asset (crypto + stocks xStocks + forex)**, universo dinamico, fee Kraken reali".
- Sezione **AI Supervisor**: aggiungere riga descrittiva "Strategia v4 multi-asset — alloca capitale per classe (vedi pesi `asset_class_split`) e governa i 3 flag operativi."

### E) Strategia (`src/routes/_authenticated/strategia.tsx`)
- Tutte le occorrenze "Strategia v3" → "Strategia v4" (incluse description box, chart legend, KPI card, descrizione tab).

### F) Dashboard (`src/routes/_authenticated/dashboard.tsx`)
- Stringa "(v3 Core-Led + Satellite + Bear-DCA)" → "(v4 multi-asset: Core-Led + Satellite + Bear-DCA + Stocks/Forex)".

## File toccati

- `src/lib/strategy-presets.ts`
- `src/lib/diagnostics.functions.ts` (+ nuova fn `getMarketDataStatus`)
- `src/routes/_authenticated/sentiment.tsx`
- `src/routes/_authenticated/diagnostica.tsx`
- `src/routes/_authenticated/strategia.tsx`
- `src/routes/_authenticated/dashboard.tsx`

## Cosa NON cambio

- Nessuna logica engine / DB / migration.
- Nessuna modifica ai pesi `asset_class_split` o ai parametri di risk dei preset.
- AI Supervisor logica decisionale invariata (solo copy testuale).
