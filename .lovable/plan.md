## Piano di fix

1. **Correggere il salvataggio server della risposta assistente**
   - In `src/routes/api/chat.ts`, rendere `onFinish` asincrono e attendere direttamente l'`upsert` su `chat_messages` prima della chiusura dello stream.
   - Rimuovere il salvataggio “fire-and-forget” con `keepAlive`, perché nel runtime serverless può non completare.
   - Aggiungere un `generateMessageId` server-side stabile/unico, così ogni risposta assistente non viene salvata con `message_id` vuoto e non sovrascrive le risposte precedenti.

2. **Correggere il ricaricamento UI della cronologia**
   - In `src/components/assistant/AssistantChat.tsx`, evitare che la chat venga inizializzata una sola volta da una cache vecchia di React Query.
   - Fare in modo che, quando la cronologia fresca arriva dal server e la chat non sta streammando, i messaggi visibili vengano aggiornati.
   - Invalidare/refetchare `chat-history` alla fine della risposta dell'assistente, così uscire e rientrare mostra subito i messaggi appena salvati.

3. **Mantenere invariati sicurezza e scope**
   - Nessuna logica di trading o chiave API nel frontend.
   - La lettura/scrittura resta user-scoped con auth e RLS su `chat_messages`.
   - Non modifico strategie, parametri trading o GO LIVE.

4. **Verifica**
   - Controllare che non ci siano errori server/client rilevanti.
   - Verificare nel database che dopo un nuovo scambio esistano sia il messaggio `user` sia quello `assistant` con `message_id` non vuoto.