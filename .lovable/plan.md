## Problema

`trading-engine` crasha ad ogni ciclo con `Cannot read properties of undefined (reading 'toFixed')` e Telegram riceve l'avviso "ciclo saltato".

Causa più probabile: in `supabase/functions/trading-engine/index.ts` la variabile `btcLast` (riga 226) viene calcolata come:

```ts
const btcLast = prices["BTC"] ?? btcCloses[btcCloses.length - 1];
```

Se Kraken non restituisce il ticker `BTC` **e** `fetchKrakenDailyCloses("BTC", ...)` torna un array vuoto (rate-limit / errore transitorio), `btcLast` è `undefined`. Pochi righi sotto viene usata senza guardia in:

- riga 231 / 232 → `btcLast.toFixed(0)` (ramo `macroOn ? ... : ...`)
- riga 241 → costruzione `mesoReason` quando `btcSma50` è valido ma `btcLast` no

Stesso pattern fragile anche su `btcSma200`/`btcSma50` se `sma()` torna `null`: oggi sono guardati, ma li blindo con `?? 0` per coerenza.

## Fix proposto (chirurgico, no logica strategia)

File: `supabase/functions/trading-engine/index.ts`

1. **Fail-fast esplicito** subito dopo il calcolo di `btcLast`: se `btcLast` non è un numero finito → log warning, snapshot portafoglio, `return` pulito dal ciclo (non `throw`, così Telegram NON manda l'errore generico ma un messaggio chiaro tipo *"Prezzo BTC non disponibile da Kraken: ciclo posticipato"*).

2. **Hardening difensivo** di tutte le `toFixed` su valori potenzialmente nulli in quella sezione (righe 199, 231–243): cast `Number(x ?? 0).toFixed(...)` dove il guard non è ovvio.

3. **Niente modifiche** a: schema DB, RLS, server functions TanStack, UI, logica Core/Satellite/Bear-DCA, backtest.

## Risultato atteso

- Quando Kraken risponde regolarmente: comportamento invariato.
- Quando Kraken fallisce momentaneamente sul BTC: il ciclo viene saltato in modo pulito con un singolo messaggio Telegram informativo (non più stack trace generico ricorrente).
