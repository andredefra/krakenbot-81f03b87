
## Cosa non va (diagnosi)

### 1. "Preset attivo: Custom" anche se Strategia mostra Bilanciato
Nel DB `settings` per il tuo utente:
- `strategy_preset = "balanced"` ✅
- ma `take_profit_pct = 20` mentre il preset v2 Bilanciato richiede `25`.

`detectPreset()` confronta tutti i campi numerici uno-a-uno: basta un mismatch e ricade su "custom". La causa è che la migrazione v2 ha aggiunto le nuove colonne ma **non ha riapplicato i valori del preset all'utente esistente** — `take_profit_pct` è rimasto al vecchio default (20). La pagina Strategia mostra "Già attivo" perché legge solo la colonna `strategy_preset`, mentre la pagina Rischio confronta i valori reali → conflitto visibile.

### 2. "Hai chiesto 3 anni ma in DB c'è solo storico più breve" (e 5 anni dà lo stesso range)
Nel DB i dati crypto vanno dal **2020-12-24 al 2026-06-15** (~5,5 anni). Ma i risultati cache mostrano:
- 5 anni → `2021-06-15 → 2024-03-10` (≈ 2,74y)
- 3 anni → `2023-06-15 → 2026-03-10` (≈ 2,74y)

Sempre **circa 1000 candele**. Causa: PostgREST applica un `max-rows` interno (1000) che `.range(0, 9999)` **non** sovrascrive. La query BTC (master timeline del backtest) viene troncata a 1000 righe → il backtest gira solo sui primi ~2,74 anni della finestra richiesta. Chiedere "5 anni" o "3 anni" risulta nello stesso span.

### 3. Linea della Strategia invisibile nel grafico
La linea Strategia usa `stroke="hsl(var(--primary))"` che nel tema è **verde** (lo stesso `#22c55e` usato per S&P 500). Le due linee si sovrappongono visivamente; la curva Strategia (+7%) sparisce sotto/dentro la curva S&P 500.

---

## Piano di intervento

### A. Backtest — paginazione query OHLC (`src/lib/backtest.functions.ts`)
Sostituire la singola chiamata `.range(0, 9999)` con un loop che pagina finché la risposta restituisce `pageSize` righe (PostgREST cap = 1000):

```text
const PAGE = 1000;
let from = 0;
let rows = [];
while (true) {
  const r = await supabase.from("historical_ohlc")
    .select("date,close").eq("symbol", sym)
    .gte("date", sinceStr).order("date", { ascending: true })
    .range(from, from + PAGE - 1);
  if (r.error) throw ...;
  rows.push(...r.data);
  if (r.data.length < PAGE) break;
  from += PAGE;
}
```

Stesso fix per `fg_history`. Bump cache hash da `v3|` → `v4|` per invalidare i risultati troncati. Risultato atteso: 5y → 2021-06-15 → 2026-06-15 (~5y reali); 3y → 2023-06-15 → 2026-06-15 (warning sparisce).

### B. Preset detection / riallineamento (`src/lib/strategy-presets.ts` + `src/routes/_authenticated/settings.tsx`)
Due opzioni, propongo la **(2)** che è più solida:

1. (Quick fix) Rimuovere `take_profit_pct` da `DETECT_NUMERIC` → la riga "Custom" sparirebbe ma i parametri reali restano disallineati dal preset dichiarato (stop_loss/take-profit non in linea con v2).

2. **(Consigliato)** Quando `strategy_preset` salvato ≠ `detectPreset()` calcolato, mostrare nella pagina Rischio un banner "Preset disallineato — i valori salvati non corrispondono più al preset `<X>`" con un bottone **"Riallinea al preset"** che chiama `applyStrategyPreset({preset: stored})`. Inoltre eseguire una migrazione one-shot che, per ogni utente con `strategy_preset='balanced' | 'conservative' | 'aggressive'`, riallinea i campi v2 (`take_profit_pct`, `min_target_pct`, ecc.) ai valori del preset. Così l'utente esistente parte già pulito e quelli futuri hanno comunque l'escape hatch.

### C. Grafico — colore distinto per la linea Strategia (`src/routes/_authenticated/strategia.tsx`)
Sostituire `stroke="hsl(var(--primary))"` con un blu/ciano distinto (es. `#60a5fa`) e portare lo `strokeWidth` a `2.5` per dare priorità visiva alla linea principale. Aggiungere `isAnimationActive={false}` su tutte le `<Line>` se non già presente per evitare flash su re-render.

### D. Documento di strategia
Nessuna modifica al contenuto di `STRATEGIA.md` v2: il problema è solo nel codice (caching + colori + sync preset).

---

## File toccati
- `src/lib/backtest.functions.ts` — paginazione query + bump hash a `v4|`
- `src/lib/strategy-presets.ts` — (eventuale tweak `DETECT_NUMERIC`)
- `src/routes/_authenticated/settings.tsx` — banner "Riallinea al preset"
- `src/routes/_authenticated/strategia.tsx` — colore linea Strategia
- Una migrazione SQL one-shot per riallineare le `settings` esistenti ai valori dei preset v2

## Cosa non faccio
- Non riavvio sync storico (i dati ci sono già fino al 2020-12-24, il bug era solo nel fetch lato backtest).
- Non tocco engine di backtest (`backtest.server.ts`) né i preset numerici v2 — sono coerenti con `STRATEGIA.md` v2.

Procedo?
