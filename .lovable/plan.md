## Cosa non va davvero con l'assistente

Nello screenshot l'assistente dice "vado" e chiama `updateRiskSettings` con `bear_dca_enabled: true` e `mid_ma_period: 100`. Il tool torna **Completed** verde, ma in DB non cambia niente. Motivo:

Lo schema Zod di `updateRiskSettings` (in `src/lib/assistant/tools.server.ts`) **non contiene** né `bear_dca_enabled` né `mid_ma_period` né molti altri parametri di strategia V4 (`short_ma_period`, `long_ma_period`, `core_only_mode`, `exclude_fiat_commodity`, allocazioni core/satellite, soglie breadth, ecc.). Zod fa `.strip()` di default: le chiavi sconosciute vengono silenziosamente rimosse, `entries` diventa vuoto e il tool ritorna `{ok:false, error:"Nessun campo da aggiornare."}`. La chat però mostra "Completed" perché il tool call è andato a buon fine tecnicamente — quindi l'assistente crede di aver salvato e tu vedi che non è successo niente.

`bear_dca_enabled` e `core_only_mode` erano stati intenzionalmente esclusi perché "gestiti dall'AI Supervisor", ma questo blocca le richieste manuali umane tramite chat, che è esattamente il flusso che stai usando.

## Piano

### 1) Allineare i tool dell'assistente allo schema V4 reale
File: `src/lib/assistant/tools.server.ts`

- Allargare lo schema di `updateRiskSettings` includendo TUTTI i campi modificabili safe della tabella `settings`:
  - Flag strategici: `core_only_mode`, `bear_dca_enabled`, `exclude_fiat_commodity`
  - Parametri MA regime: `short_ma_period`, `mid_ma_period`, `long_ma_period`
  - Preset: `strategy_preset` (`conservativo | bilanciato | aggressivo`)
  - Allocazioni: `core_allocation_pct`, `satellite_allocation_pct` (se presenti in schema)
  - Universi: `universe_stocks_enabled`, `universe_forex_enabled`, `universe_commodities_enabled` (se presenti)
- Cambiare il comportamento di "nessun campo": se il modello passa chiavi che non esistono nello schema, ritornare un errore esplicito che **elenca le chiavi ricevute** e **le chiavi accettate**, così l'assistente capisce e riprova con i nomi giusti invece di dichiarare successo.
- Passare da `.strip()` implicito a un preprocess che rileva chiavi ignote e le riporta nell'errore.
- Aggiungere log Telegram e `events_log` anche per i nuovi campi (già coperto dal riepilogo generico).

Nota: rimango dentro l'ambito parametri di rischio/strategia PAPER. Nessuna funzione nuova che tocca soldi veri.

### 2) Rimuovere l'icona bot flottante da ogni pagina
File: `src/routes/_authenticated/route.tsx`

- Rimuovere l'import di `FloatingChat` e il tag `<FloatingChat />` dal layout.
- Lasciare il file `src/components/assistant/FloatingChat.tsx` in repo (non usato) — l'accesso all'assistente resta dal menu laterale voce "Assistente".

### 3) Menu mobile più pulito
File: `src/routes/_authenticated/route.tsx` (funzione `MobileNav`)

- Sostituire il bottone "Menu" testuale + dropdown assoluto con un **Sheet** shadcn (drawer laterale sinistro) attivato da un icona hamburger (`Menu` da lucide-react).
- Contenuto del drawer: stesso header "Crypto Bot / Cruscotto" della sidebar desktop, lista `NAV` con icona + label, stato attivo evidenziato, email utente e bottone "Esci" in fondo — parità con la sidebar desktop.
- Chiusura automatica al click su una voce (già gestita da `onOpenChange`).
- Aggiungere `overflow-y-auto` così scrolla se il device è piccolo.
- Nell'header mobile mostrare a sinistra hamburger + logo compatto, a destra i due badge Mode/Running (che restano invariati).

### 4) Verifica
- Aprire `/assistant`, chiedere "attiva bear_dca_enabled e metti mid_ma_period a 100": la tool call deve completare con i campi effettivamente aggiornati, e un `SELECT` su `settings` deve mostrare i nuovi valori.
- Aprire il preview in viewport mobile: hamburger apre il drawer, le voci navigano e chiudono il drawer, nessuna bolla bot in basso a destra.
- Aprire il preview desktop: nessuna bolla bot in basso a destra, sidebar invariata.

## Dettagli tecnici (per riferimento)

Elenco campi che entrano nello schema di `updateRiskSettings` (unione di quelli già presenti + nuovi):

```text
capital_reference, kill_switch_floor, max_positions, max_satellite_positions,
max_position_pct, stop_loss_pct, trailing_activate_pct, trailing_gap_pct,
take_profit_pct, min_target_pct, daily_loss_limit_pct, monthly_trade_cap,
timeframe, bear_dca_fg_threshold, bear_dca_cap_pct, bear_dca_tranche_pct,
bear_dca_interval_days, taker_fee_pct, maker_fee_pct, slippage_pct,
+ core_only_mode, bear_dca_enabled, exclude_fiat_commodity,
+ short_ma_period, mid_ma_period, long_ma_period,
+ strategy_preset
```

Solo i campi effettivamente presenti nella tabella `settings` (verificati contro `src/integrations/supabase/types.ts`) finiranno nello schema — niente colonne inesistenti.
