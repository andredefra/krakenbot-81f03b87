## Architettura

**Backend (TanStack server route + AI SDK + Lovable AI Gateway)**
- Endpoint streaming `src/routes/api/chat.ts` (POST), modello `google/gemini-3-flash-preview`.
- Autenticato via `requireSupabaseAuth` → ogni tool agisce sui dati dell'utente loggato (RLS).
- System prompt costruito a partire da `STRATEGIA.md` + `BUILD_SPEC.md` (li includo come testo statico nel prompt) + ruolo "super-helper trading crypto".
- Tool calling AI SDK: ogni azione mutativa ha `needsApproval: true` → l'utente conferma in chat prima dell'esecuzione.

**Tool disponibili al modello**

| Tool | Tipo | Approval |
|---|---|---|
| `getSettings` | lettura settings | no |
| `getOpenPositions` | lettura posizioni aperte + uPnL | no |
| `getRecentEvents` | ultimi N log da `events_log` | no |
| `getLatestSentiment` | ultimo snapshot sentiment + F&G | no |
| `getPortfolio` | snapshot equity recenti | no |
| `updateRiskSettings` | update parziale parametri rischio | sì |
| `updateSentimentSettings` | toggle/peso fonti sentiment | sì |
| `setBotRunning` | accendi/spegni bot | sì |
| `setBotMode` | paper/live (live bloccato → errore Fase 1) | sì |
| `closePosition` | chiude trade PAPER manualmente | sì |

Ogni tool valida input con Zod, esegue via Supabase con RLS, scrive una riga in `events_log` ("assistente: ha modificato X"), e — per le azioni — notifica Telegram con il prefisso `[PAPER]`.

**Persistenza chat (una conversazione continua su DB)**
Nuova tabella `chat_messages` (`user_id`, `message_id` text, `role` text, `parts` jsonb, `created_at`), RLS per `auth.uid()`. Il route serve la cronologia via server fn `getChatHistory` e salva ogni messaggio (utente + assistente) in `onFinish` di `toUIMessageStreamResponse`.

**UI (AI Elements installati: conversation, message, prompt-input, shimmer, tool)**
- `src/components/assistant/AssistantChat.tsx` — componente unico riutilizzato in entrambi i posti.
- `src/components/assistant/FloatingChat.tsx` — bubble in basso a destra montato nel layout `_authenticated/route.tsx`. Click → sheet/drawer laterale che renderizza `<AssistantChat />`.
- Nuova route `src/routes/_authenticated/assistant.tsx` — pagina dedicata a tutta altezza con lo stesso `<AssistantChat />` e lo stesso `chatId="main"` → entrambi vedono e scrivono la stessa conversazione.
- Nuova voce di navigazione "Assistente" nella sidebar.
- Stile: bubble assistente senza sfondo, bubble utente con `primary`/`primary-foreground`, tool call collassati di default, indicatore "Sto pensando…" durante lo streaming, markdown reso con `MessageResponse`.
- Logo agente: piccola icona Bot esistente del progetto (no `Sparkles`).

**Sicurezza / RLS**
- Tutti i tool passano per `requireSupabaseAuth`; nessun service-role esposto.
- Tool mutativi confermano con `needsApproval` prima di toccare il DB.
- `setBotMode('live')` restituisce errore esplicito "Fase 1 — Live non abilitato".

## Signup pubblici Supabase
Non è una modifica al codice/DB ma una toggle del pannello Auth, quindi resta a te (1 click). Te la riepilogo nel mio messaggio fuori dal piano con il link diretto.

## Cosa NON faccio
- Niente Edge Functions: tutto via TanStack server route / `createServerFn` (allineato al modern stack).
- Niente azioni "agentiche" senza conferma: ogni write passa da approval.
- Non aggiungo trigger sulla tabella `auth.users` per bloccare signup (Supabase lo sconsiglia).

## Migrazione DB
Una sola migrazione: `chat_messages` + GRANT + RLS scoped a `auth.uid()`.

## Dopo l'approvazione (cosa ti chiederò di fare tu)
1. Disattivare "Allow new users to sign up" dal pannello Supabase Auth (link diretto te lo do io dopo).
2. Aprire la chat dal bubble o da `/assistente`, dirle "abbassa lo stop loss al 7%" → ricevere la conferma → vedere il parametro aggiornato live nella pagina Rischio + notifica Telegram.
