## Obiettivo

Aggiungere due nuovi pannelli all'app:
1. **Diagnostica** — perché il bot non sta entrando ora (regime, filtri, candidati scartati)
2. **Strategia** — preset di approccio (Conservativo / Bilanciato / Aggressivo / Custom) che riscrivono i parametri di rischio, + backtest 5 anni vs BTC e S&P 500

---

## 1. Pannello Diagnostica — `/diagnostica`

Pagina read-only che mostra in tempo reale **perché** il trading-engine sta o non sta aprendo trade. Aggiornamento ogni 30s.

**Sezioni:**
- **Regime di mercato** (badge grande verde/rosso): `risk-on` / `risk-off`
  - BTC last vs SMA50 daily (con delta %)
  - Fear & Greed value + label
  - Motivo testuale: es. "BTC sotto SMA50 (−10.2%) → risk-off"
- **Stato bot**: `is_running`, `mode`, posizioni aperte / max, capitale disponibile, daily P/L vs limite
- **Ultimo ciclo engine**: timestamp, durata, esito (dall'`events_log`)
- **Candidati valutati nell'ultimo ciclo**: tabella per ogni asset del Core+Sleeve con
  - prezzo, SMA20, SMA50, RSI, volume
  - check ✅/❌ su ogni filtro (trend, breakout, RSI, liquidità, sentiment)
  - **motivo scarto** se non aperto
- **Prossimo controllo** countdown (ogni 5 min)

**Implementazione:**
- Nuova server fn `getDiagnostics()` in `src/lib/diagnostics.functions.ts` che:
  - Legge `settings`, ultime righe `events_log`, ultimo `sentiment_snapshot`
  - Chiama `fetchKrakenTickers` + `fetchKrakenDailyCloses('BTC')` per regime live
  - Per ogni asset Core+Sleeve calcola filtri (riusa funzioni da `trading-engine/index.ts` — estratte in `_shared/strategy.ts`)
- Modifica `trading-engine/index.ts` per loggare in `events_log` un evento `engine.candidate` per ogni asset valutato con i filtri (così la diagnostica non rifa il lavoro, basta leggere l'ultimo ciclo)

---

## 2. Pannello Strategia — `/strategia`

Pagina con **3 preset + custom** che riscrivono i parametri di `settings` (gli stessi mostrati in `/settings`).

**Preset proposti** (allineati a STRATEGIA.md):

| Preset | Max pos | Size max | Stop loss | Trailing att./gap | Take profit | Min target | Daily loss | F&G greed cap | Filtro SMA50 BTC |
|---|---|---|---|---|---|---|---|---|---|
| **Conservativo** | 2 | 20% | −7% | +8% / −5% | +15% | +3% | −5% | 70 | obbligatorio |
| **Bilanciato** (default) | 3 | 30% | −10% | +10% / −7% | +20% | +2% | −8% | 75 | obbligatorio |
| **Aggressivo** | 4 | 40% | −12% | +12% / −8% | +25% | +1.5% | −10% | 85 | solo se BTC > SMA200 |
| **Custom** | — | — | — | — | — | — | — | — | — |

**UI:**
- 3 card grandi con preset, badge "Attuale", rendimento atteso/varianza ("alta/media/bassa"), CTA "Applica preset"
- Sotto: **comparatore live** che mostra cosa cambierebbe rispetto ai valori attuali (diff tabellare prima/dopo) con conferma esplicita
- Dopo applica → toast + redirect a `/settings` o stay con i nuovi valori
- Sezione "Avanzato" collassata: toggle per
  - filtro regime BTC (obbligatorio / solo F&G / disattivato)
  - peso sentiment social (off / conferma / blocco)
  - timeframe (1h / 4h)

**Implementazione:**
- Nuova `src/lib/strategy-presets.ts` (client-safe) con i 4 preset come oggetti tipizzati
- Server fn `applyStrategyPreset({ preset })` in `src/lib/strategy.functions.ts` con `requireSupabaseAuth` → `UPDATE settings SET ...`
- Migration: aggiungere 3 colonne a `settings`:
  - `strategy_preset TEXT DEFAULT 'balanced'`
  - `regime_filter TEXT DEFAULT 'btc_sma50'` (`'btc_sma50'|'fg_only'|'off'`)
  - `fg_greed_cap INT DEFAULT 75`
- `trading-engine/index.ts` legge `regime_filter` e `fg_greed_cap` invece di hardcode

---

## 3. Backtest 5 anni nel pannello Strategia

Sezione dedicata sotto i preset: **"Come avrebbe performato negli ultimi 5 anni"**.

**Cosa mostra:**
- Grafico equity curve (line chart con `recharts`) di 3 serie sovrapposte:
  - **Strategia selezionata** (paper, applicando i filtri del preset)
  - **Benchmark BTC buy & hold**
  - **Benchmark S&P 500 buy & hold** (proxy SPY)
- KPI sotto il grafico (tabella):
  - Rendimento totale, CAGR, max drawdown, Sharpe (semplificato), # trade, win rate, profit factor
- Periodo selezionabile: 1y / 3y / 5y
- Asset universe selezionabile (Core / Core+Sleeve)

**Implementazione tecnica:**
- **Dati storici**:
  - Crypto: Kraken OHLC daily (`fetchKrakenDailyCloses` esiste già, va estesa per restituire OHLCV completo + supportare lookback >720gg via paginazione `since`)
  - S&P 500: dati daily da fonte gratuita — proposta **Stooq** (`https://stooq.com/q/d/l/?s=^spx&i=d`, CSV, no API key, 5y disponibili). Alternativa: Yahoo Finance (instabile) o FRED.
- **Cache**: nuova tabella `historical_ohlc` (symbol, date, open, high, low, close, volume) popolata on-demand e rinfrescata 1×/giorno via cron. Evita di sbattere Kraken/Stooq a ogni cambio preset.
- **Engine di backtest**: nuova `src/lib/backtest.server.ts` (puro JS, deterministico):
  - Replica la logica di `trading-engine` (SMA20/50, RSI, breakout, regime BTC+F&G) su candele storiche
  - F&G storico: Alternative.me ha endpoint `?limit=0` che restituisce **tutta la storia dal 2018** → cache in tabella `fg_history`
  - Applica fee Kraken (0.4% per side), slippage 0.1%, sizing del preset
  - Output: array `{date, equity_strategy, equity_btc, equity_spx, trades, drawdown}`
- **Server fn** `runBacktest({ preset, years, universe })` con `requireSupabaseAuth`
  - Tempi attesi: ~2-5s per 5y, accettabile per UI con skeleton + cancellazione
- **Caching risultati**: tabella `backtest_runs` (input_hash, result_jsonb, created_at) per non rifare lo stesso backtest

---

## File coinvolti

**Nuovi:**
- `src/routes/_authenticated/diagnostica.tsx`
- `src/routes/_authenticated/strategia.tsx`
- `src/lib/diagnostics.functions.ts`
- `src/lib/strategy.functions.ts`
- `src/lib/strategy-presets.ts`
- `src/lib/backtest.functions.ts` (server fn wrapper)
- `src/lib/backtest.server.ts` (engine puro)
- `supabase/functions/_shared/strategy.ts` (filtri estratti da trading-engine)
- `supabase/functions/historical-sync/index.ts` (cron daily OHLC + F&G)
- 1 migration: nuove colonne `settings` + tabelle `historical_ohlc`, `fg_history`, `backtest_runs` (con GRANT + RLS)

**Modificati:**
- `supabase/functions/trading-engine/index.ts` — log `engine.candidate` + leggi nuove colonne settings
- `src/routes/__root.tsx` o sidebar nav — aggiungere voci "Diagnostica" e "Strategia"

---

## Domande prima di partire

1. **S&P 500 benchmark — fonte dati**: confermi **Stooq** (gratis, no API key, affidabile)? Alternativa: ti procuri una API key Alpha Vantage / Polygon.
2. **Backtest universe**: devo includere anche le altcoin Sleeve (servono Liste Kraken USD), o solo Core (ETH, SOL) + BTC?
3. **Cambio preset → trade aperti esistenti**: se cambio da Aggressivo a Conservativo mentre ho 4 posizioni aperte, devo (a) lasciarle correre con le regole vecchie, (b) chiuderne forzatamente l'eccesso, (c) applicare i nuovi stop ai trade esistenti?
4. **Diagnostica refresh**: ogni 30s va bene o preferisci un bottone "refresh manuale" (meno rate-limit Kraken)?
