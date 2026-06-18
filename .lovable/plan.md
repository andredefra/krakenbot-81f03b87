# Fix: la cronologia dell'Assistente non viene salvata

## Diagnosi

In `src/routes/api/chat.ts` la persistenza dei messaggi avviene dentro `toUIMessageStreamResponse({ onFinish })`. Il callback `onFinish` parte **dopo** che lo stream è stato chiuso e la `Response` è già stata restituita al client.

In runtime serverless (Cloudflare Worker, che è dove gira TanStack Start in questo progetto) il contesto della request viene smontato appena la `Response` termina: ogni promise non collegata a `ctx.waitUntil(...)` viene **cancellata a metà**. Risultato: l'`upsert` su `chat_messages` parte ma non arriva quasi mai a buon fine — per questo vedi solo la primissima domanda (salvata in un passato in cui la rotta era diversa o per puro caso il worker è rimasto vivo), mentre tutte le risposte successive scompaiono al reload.

Lo schema DB, le RLS e il caricamento client (`getChatHistory` + `setMessages` con `loadedRef`) sono corretti — il problema è solo lato write.

## Soluzione

Riscrivere la persistenza in `src/routes/api/chat.ts` in due passi sicuri:

1. **Salvare subito il messaggio utente** (l'ultimo elemento di `messages` con `role === "user"`) con un `await supabase.from("chat_messages").upsert(...)` **prima** di iniziare lo stream. Così la domanda è in DB anche se il worker viene terminato durante lo streaming.
2. **Salvare il messaggio assistant** in `onFinish` filtrando solo i nuovi messaggi (quelli con id non presente in `originalMessages`), e wrappare la promise in `ctx.waitUntil(...)` recuperando il contesto Cloudflare via `getRequestContext()` da `@cloudflare/workers` quando disponibile; con fallback ad `await` normale in dev (Node) dove il processo non viene killato.

In pratica:

```ts
const waitUntil = (p: Promise<unknown>) => {
  try {
    // dynamic import perché in dev non c'è
    const { getRequestContext } = require("cloudflare:workers");
    getRequestContext().ctx.waitUntil(p);
  } catch {
    // dev / Node: la promise vive comunque
  }
};
```

Errori dell'`upsert` vengono loggati con `console.error` e (per il primo write sincrono) restituiti come `500` così non perdiamo silenziosamente la traccia.

## Verifica

1. Aprire `/assistant`, inviare un messaggio nuovo, aspettare la risposta.
2. Cambiare pagina (es. `/dashboard`) e tornare su `/assistant`: la coppia domanda + risposta deve esserci.
3. Reload completo (F5): idem.
4. Premere il cestino: la cronologia si svuota; nuovo messaggio → riappare e sopravvive al reload.

## File toccati

- `src/routes/api/chat.ts` (solo logica di persistenza, niente cambi a UI, tool, prompt o modello).
