## Piano

### 1. Blocco hard su tutti gli endpoint automatici
Aggiungo un kill-switch che fa early-return `{ ok: true, skipped: "is_running=false" }` prima di qualsiasi chiamata a AI Gateway / Kraken / market data negli endpoint:

- `src/routes/api/public/hooks/ai-strategy-supervisor.ts`
- `src/routes/api/public/hooks/trading-engine.ts` (se esiste)
- `src/routes/api/public/hooks/daily-summary.ts`
- `src/routes/api/public/hooks/universe-scanner.ts`
- `src/routes/api/public/hooks/historical-sync.ts`
- `src/routes/api/public/hooks/tax-reminders.ts`

Logica: leggo `settings.is_running` con `supabaseAdmin`; se `false` per tutti → return immediato, zero costi. (Prima esploro la cartella `src/routes/api/public/hooks/` per la lista esatta dei file.)

### 2. Publish: SÌ, questa volta serve
Il blocco è **codice frontend/server route** → per farlo diventare attivo in produzione devi cliccare **Publish → Update**. Se non pubblichi, il kill-switch esiste solo nel preview.

Nota: anche senza publish sei già al sicuro (cron vuoti + `is_running=false`). Il publish serve solo per rendere permanente il blocco hard anche in caso di trigger manuale futuro sull'URL prod.

### 3. Come ripartire in futuro
Per riavviare tutto ti basterà:
1. `UPDATE settings SET is_running = true;`
2. Rischedulare i cron (te lo faccio in un colpo solo)

Il codice del kill-switch resta ma diventa "trasparente" quando `is_running=true`.

Procedo?