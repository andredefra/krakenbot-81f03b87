## Diagnosi

**"Sempre uguale"** = il backtest è cache-ato per 24h in `backtest_runs` con hash `preset|years|universe`. Quando hai rilanciato è stata restituita la run precedente (creata QUANDO SPX era ancora vuoto), quindi `equity.spx` è ancora tutto $1000 → in vista % diventa una linea a 0% (piatta). BTC e Strategia dovrebbero invece variare ora — se vedi proprio tutto identico è perché la pagina ha ancora il risultato cached in memoria.

**"Strategia perde"** = lo dico come osservazione: con questi parametri (stop loss ampio, momentum su sleeve, cap F&G) su un periodo dove le alts hanno fatto peggio di BTC è plausibile. Non lo tocchiamo ora — prima rendiamolo configurabile e leggibile, poi se vuoi rivediamo i preset.

**"Voglio partire da €200 modificabile"** = oggi `startCapital = 1000` è hardcoded in `backtest.functions.ts:101`. Da esporre come input.

## Modifiche

### 1. Capitale iniziale configurabile

**`src/lib/backtest.functions.ts`**
- Aggiungo `startCapital: z.number().min(10).max(1_000_000)` all'`inputSchema`.
- Lo passo a `runBacktest({ startCapital: data.startCapital, ... })`.
- Includo `startCapital` nell'hash della cache → `${preset}|${years}y|${universe}|${startCapital}€` → invalida automaticamente la run vecchia.

**`src/routes/_authenticated/strategia.tsx` — `BacktestSection`**
- Nuovo state `const [startCapital, setStartCapital] = useState(200)`.
- Nuovo campo input numerico nella griglia (passa da `grid-cols-4` a `grid-cols-5` su md+):
  ```
  Capitale iniziale (€)  [200]
  ```
  con `min={10} step={50}`.
- Passo `startCapital` nella mutation.
- Label asse Y / tooltip restano in **%** (decisione presa nel turno precedente, comparabile).
- Aggiungo sotto al chart una riga riassuntiva:
  `Capitale finale: Strategia €X · BTC €Y · S&P €Z` calcolata da `startCapital * (1 + kpi.totalReturnPct/100)`.

### 2. Bust della cache stale

Cambiando il formato dell'hash, tutte le run precedenti diventano irraggiungibili e la prossima esecuzione gira fresca (con SPX popolato). Nessun DELETE serve.

### 3. Etichette in €

Sostituisco i `$` residui nei testi del backtest con `€` (è puramente cosmetico, il motore lavora su numeri puri; OHLC sono comunque indicizzati a `startCapital` per la curva). Nota: i prezzi storici crypto/SPX sono in USD, ma per il backtest che parte da `startCapital` e moltiplica per ratio è equivalente — assumiamo cambio fisso. Lo dichiaro implicitamente usando solo "€" come unità di display.

### Non tocco
- Engine (`backtest.server.ts`): già accetta `startCapital` come parametro.
- Logica strategia / preset.
- DB / RLS / migrations.

## Verifica
1. Apro `/strategia`, scrivo `200` nel nuovo campo, lancio.
2. Vedo 3 curve in % distinte (strategia, BTC arancione che oscilla, SPX verde non più piatto).
3. Cambio a `500`, rilancio → nuova run (cache busted), curve identiche in % (è normale: il ratio non cambia) ma "Capitale finale" scala.