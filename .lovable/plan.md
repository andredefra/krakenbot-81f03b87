## Obiettivo
Delegare i 3 interruttori strategici (`core_only_mode`, `bear_dca_enabled`, `exclude_fiat_commodity`) a un **AI Supervisor** che gira ogni ora, decide in autonomia in base al preset attivo + condizioni di mercato, e applica i flag senza chiedere conferma.

## 1. Server route AI Supervisor

Nuovo file: `src/routes/api/public/hooks/ai-strategy-supervisor.ts` (route pubblica, header `apikey` per pg_cron).

Per ogni utente con `is_running=true`:
1. Carica: `settings` (preset, flag attuali, parametri Bear-DCA), `engine_diagnostics` (macro/meso, F&G, BTC vs SMA200/50, bear_dca_state), ultimi 30g di `positions` chiuse (win rate, PF, drawdown corrente), totale fee pagate.
2. Chiama **Lovable AI Gateway** (`google/gemini-3-flash-preview`) con `Output.object` strutturato:
   ```ts
   { core_only_mode: boolean, bear_dca_enabled: boolean,
     exclude_fiat_commodity: boolean, reasoning: string,
     confidence: "low"|"medium"|"high" }
   ```
3. System prompt: regole deterministiche per preset come **baseline**, l'AI può deviare se condizioni di mercato lo giustificano:
   - **Conservative**: default bear_dca=ON sempre, exclude_fiat=ON, core_only=ON se drawdown 30g > 15% o F&G > 80
   - **Balanced**: default bear_dca=ON, exclude_fiat=ON, core_only=ON solo se drawdown > 20% o F&G > 85
   - **Aggressive**: default bear_dca=ON solo se F&G < 30, exclude_fiat=OFF (cerca alpha ovunque), core_only=OFF salvo emergenze
4. **Applica diff**: solo se almeno un flag cambia → `UPDATE settings`, log `events_log` (component=`ai-supervisor`), notifica Telegram (`🤖 AI Supervisor: bear_dca ON→OFF — motivo: …`).
5. Salva sempre lo stato AI in `settings.ai_supervisor_state` (JSONB) per tracciamento.

## 2. Schema DB

Migrazione: nuova colonna `settings.ai_supervisor_state JSONB` con shape:
```json
{ "last_run_at": "2026-06-18T15:00:00Z",
  "last_decision": { "core_only_mode": false, "bear_dca_enabled": true,
                     "exclude_fiat_commodity": true },
  "reasoning": "Macro risk-off + F&G 15 → mantengo bear_dca ON…",
  "confidence": "high",
  "changed_flags": ["bear_dca_enabled"] }
```

## 3. Cron orario

Via `supabase--insert` (non migration): `pg_cron` orario che POST a `https://project--83246337-7089-4f55-8513-1c18d291c310.lovable.app/api/public/hooks/ai-strategy-supervisor`.

## 4. Settings UI — nascondere i 3 toggle

`src/routes/_authenticated/settings.tsx`:
- Rimuovere `Switch` per `core_only_mode`, `bear_dca_enabled`, `exclude_fiat_commodity` (e le card relative).
- Lasciare modificabili: parametri Bear-DCA numerici (threshold, cap, tranche, interval), fee Kraken, capitale.
- Banner in cima alla sezione strategia: *"🤖 Gli interruttori strategici sono gestiti automaticamente dall'AI Supervisor in base al preset attivo. Vedi `Diagnostica` per lo stato corrente."*

## 5. Diagnostica — pannello AI Supervisor

`src/routes/_authenticated/diagnostica.tsx`: nuova card "🤖 AI Supervisor" che mostra:
- Stato attuale dei 3 flag (badge read-only)
- Ultima esecuzione + confidence
- Reasoning testuale dell'ultima decisione
- Lista `changed_flags` con timestamp

`getDiagnostics` server fn estesa per includere `ai_supervisor_state`.

## 6. Tool assistente

`src/lib/assistant/tools.server.ts`: in `updateRiskSettings` **rimuovere** dallo schema `core_only_mode`, `bear_dca_enabled`, `exclude_fiat_commodity`. Aggiungere nuovo tool read-only `getAiSupervisorState` per leggere le decisioni recenti. System prompt aggiornato: l'assistente spiega che questi 3 flag sono AI-gestiti e non li tocca.

## 7. Verifica

- Trigger manuale del supervisor via `curl_edge_functions` (in realtà `invoke-server-function` per route TanStack) → verifica scrittura `ai_supervisor_state` + diff applicato.
- Verifica che il cron sia schedulato (`SELECT * FROM cron.job`).
- Test rapido in UI: cambiare preset da `/strategia` → al prossimo run AI rivaluta.

## Tecnico — file toccati
- 🆕 `src/routes/api/public/hooks/ai-strategy-supervisor.ts`
- 🆕 1 migrazione (colonna `ai_supervisor_state`)
- 🆕 1 cron via insert tool
- ✏️ `src/lib/diagnostics.functions.ts` (espone `aiSupervisor`)
- ✏️ `src/routes/_authenticated/diagnostica.tsx` (pannello AI Supervisor)
- ✏️ `src/routes/_authenticated/settings.tsx` (rimuove i 3 toggle, banner info)
- ✏️ `src/lib/assistant/tools.server.ts` (rimuove flag dal write tool, aggiunge read tool)
- ✏️ `src/lib/assistant/system-prompt.server.ts` (nota AI Supervisor)

## Costo AI
~24 chiamate/utente/giorno × token strutturato leggero (input ~1.5K, output ~200) → trascurabile su Gemini 3 Flash.