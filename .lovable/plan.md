# Piano: Rischio ↔ Strategia + Recap descrittivo

## 1. Sync bidirezionale Rischio ↔ Strategia

**Obiettivo**: se modifichi un parametro di rischio nella pagina **Impostazioni/Rischio**, il sistema rileva che non corrisponde più a nessun preset (Conservativo/Bilanciato/Aggressivo) e marca automaticamente `strategy_preset = 'custom'`. Viceversa, applicare un preset da `/strategia` aggiorna i campi di rischio (già funzionante).

### Cosa cambia
- **`src/lib/strategy-presets.ts`**: aggiunta helper `detectPreset(settings)` che confronta i 10 valori chiave (max_positions, max_position_pct, stop_loss_pct, trailing_activate_pct, trailing_gap_pct, take_profit_pct, min_target_pct, daily_loss_limit_pct, fg_greed_cap, regime_filter) contro ogni preset. Match esatto → ritorna l'id; altrimenti → `'custom'`.
- **`src/routes/_authenticated/settings.tsx`**: al salvataggio di un campo di rischio, dopo l'update della riga `settings`, ricalcola `strategy_preset` con `detectPreset()` e lo scrive nello stesso update. Mostra un badge in cima alla sezione Rischio: «Preset attivo: **Bilanciato**» o «Preset attivo: **Custom** ⚠️ valori modificati a mano» con link a `/strategia`.
- **`src/routes/_authenticated/strategia.tsx`**: la card "Custom" appare solo se `strategy_preset === 'custom'` (oggi è sempre visibile). Mostra anche un diff vs il preset più vicino.

### Edge case
- Quando applichi un preset da Strategia → `strategy_preset` viene scritto esplicitamente, niente conflitto.
- Quando un valore torna esattamente a un preset (es. rimetti tutti i valori = Bilanciato), il sistema rileva automaticamente e cambia `custom` → `balanced`.

## 2. Recap descrittivo per preset

**Obiettivo**: ogni card preset in `/strategia` mostra un testo chiaro su *cosa fa*, *che crypto tradera*, *quando entra/esce*, *profilo utente ideale*.

### Cosa cambia
- **`src/lib/strategy-presets.ts`**: aggiungo a ogni preset un campo `description` strutturato:
  ```ts
  description: {
    summary: string;           // 1-2 frasi
    assets: string[];          // ["BTC", "ETH", "SOL", "+ sleeve momentum top-20 mcap"]
    entryRules: string[];      // ["Solo se BTC > SMA50", "Fear & Greed ≤ 70", ...]
    exitRules: string[];       // ["SL fisso -7%", "Trailing dopo +8%", ...]
    idealFor: string;          // "Chi vuole esposizione crypto senza notti insonni"
    avoidIf: string;           // "Cerchi rendimenti >50%/anno"
    expectedDrawdown: string;  // "-10% / -15%"
    tradesPerMonth: string;    // "2-5"
  }
  ```
- **`src/routes/_authenticated/strategia.tsx`**: sotto ogni card preset, sezione espandibile "Cosa prevede questa strategia" che mostra il recap formattato (icone, liste, badge per asset).

### Contenuto preset (bozza)

**Conservativo**
- Asset: solo BTC, ETH (core liquidi)
- Entry: BTC sopra SMA50 + F&G ≤ 70 + segnale momentum 4h
- Exit: SL -7%, trailing da +8% gap 5%, TP parziale +15%
- Per chi: vuole esposizione crypto minima, dorme sereno
- Trades/mese: 1-3, drawdown atteso -8%/-12%

**Bilanciato** (default)
- Asset: BTC, ETH, SOL + sleeve momentum (top-10 mcap)
- Entry: BTC sopra SMA50 + F&G ≤ 75 + segnale 1h
- Exit: SL -10%, trailing da +10% gap 7%, TP +20%
- Per chi: vuole crescita reale ma con regole, accetta -15% drawdown
- Trades/mese: 3-8, drawdown atteso -12%/-18%

**Aggressivo**
- Asset: BTC, ETH, SOL + sleeve momentum esteso (top-20)
- Entry: BTC sopra SMA200 (filtro più permissivo) + F&G ≤ 85
- Exit: SL -12%, trailing da +12% gap 8%, TP +25%
- Per chi: cerca rendimenti alti, tollera -25% drawdown
- Trades/mese: 5-15, drawdown atteso -20%/-30%

## File modificati
- `src/lib/strategy-presets.ts` — +description, +detectPreset helper
- `src/routes/_authenticated/settings.tsx` — badge preset attivo + auto-detect su save
- `src/routes/_authenticated/strategia.tsx` — sezione recap espandibile + card Custom condizionale

## Fuori scope (risponde alle altre domande)
- **GitHub**: collegamento manuale tuo via menu **+ → GitHub → Connect project**
- **Supabase**: nulla da fare, tutto già configurato (tabelle, RLS, cron, secrets)
