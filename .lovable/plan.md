## Parte 1 — Rendere visibile la chat AI

La chat è già stata costruita (`AssistantChat`, `FloatingChat`, route `/assistant`, endpoint `/api/chat`, tool, persistenza DB) ma non è agganciata al layout, quindi non la vedi.

Cosa farò:
1. Aggiungere la voce **"Assistente"** nella sidebar di `src/routes/_authenticated/route.tsx` (icona Bot, link a `/assistant`).
2. Montare `<FloatingChat />` dentro lo stesso layout, dopo `<main>`, così la bolla in basso a destra appare su **tutte** le pagine autenticate.
3. Verificare in preview che: bolla visibile, click apre lo sheet, pagina `/assistant` carica, primo messaggio funziona.

Niente cambia su logica/tool della chat — solo wiring UI.

## Parte 2 — Separare Paper da Live + report PDF al go-live

L'obiettivo è: quando passerai a Live, i dati paper restano "congelati" e ricevi nei log un PDF scaricabile con il resoconto della Fase Paper, da mostrare a te o a investitori.

### Separazione dati paper / live

Tutte le tabelle operative hanno già modalità implicita ma non filtrata. Aggiungo una colonna `mode` (`paper` | `live`, default `paper`) su:
- `positions`
- `events_log`
- `portfolio_snapshots`

Backfill: tutte le righe esistenti → `mode = 'paper'`.
Tutte le pagine del cruscotto (Dashboard, Posizioni, Storico, Sentiment, Log) filtreranno per la **modalità attualmente attiva** in `settings.mode`. Così quando passi a Live vedi solo i numeri Live; per rivedere il Paper basterà uno switch "Mostra archivio Paper" (toggle in alto a destra delle pagine interessate).

### Trigger del report

Modifico la pagina `/mode`:
- Pulsante "GO LIVE" non più disabled (resta protetto da doppia conferma).
- Al click: dialogo "Sei sicuro? Verrà generato un report PDF della fase Paper".
- Conferma → server function `generatePaperReport` che:
  1. Aggrega da DB i dati paper: equity iniziale/finale, P&L totale, % return, max drawdown, Sharpe approssimato, n. trade, win-rate, best/worst trade, durata media, breakdown per asset, snapshot sentiment medio.
  2. Genera un PDF brandizzato con `pdf-lib` (logo Bot, tabelle, grafico equity curve come SVG embed).
  3. Carica il PDF in un nuovo bucket Supabase Storage `reports` (privato, RLS scoped a `user_id`).
  4. Inserisce una riga in `events_log` con `level=info`, `component=mode`, `message="Report Paper generato — go-live"`, e un nuovo campo `attachment_url` (storage path).
  5. Aggiorna `settings.mode = 'live'`.

### Log con allegato

La pagina `/logs` mostrerà, sulle righe con `attachment_url`, un'icona 📎 con bottone **"Scarica PDF"** che genera un signed URL e apre il file.

Il tool dell'assistente `setBotMode('live')` verrà sbloccato e chiamerà la stessa server function, così potrai dirgli "passa a live" e ricevere il report.

## Dettagli tecnici

- **DB migration**: `ALTER TABLE positions/events_log/portfolio_snapshots ADD COLUMN mode text NOT NULL DEFAULT 'paper'`. `events_log` riceve anche `attachment_url text`.
- **Storage**: bucket `reports` privato + policy `auth.uid() = owner` per select/insert.
- **PDF**: `pdf-lib` (puro JS, gira nel Worker — niente sharp/canvas).
- **Equity curve**: SVG generato server-side e disegnato come immagine nel PDF.
- **Server fn**: `src/lib/reports.functions.ts` (`generatePaperReport`, `getReportDownloadUrl`).
- **Filtro modalità**: hook `useActiveMode()` che legge `settings.mode` da realtime, poi tutte le query aggiungono `.eq('mode', activeMode)`. Toggle "Archivio Paper" forza `mode='paper'` nelle query.

## Cosa NON faccio (in questo step)

- Non implemento ordini reali su Kraken (la Fase 2 vera richiede chiavi live, sizing ridotto, doppia conferma per ordine — la facciamo dopo, in un piano dedicato).
- Per ora "GO LIVE" cambia `mode='live'` e genera il PDF, ma il motore di trading continuerà a operare in simulazione finché non colleghiamo l'esecuzione live.

## Cosa dovrai fare tu

Niente nel pannello Supabase — la migration e il bucket li creo io. Dopo l'implementazione: aprire la chat dalla bolla per testare, poi quando vorrai provare il flusso del report, fare click su GO LIVE e scaricare il PDF dai Log.