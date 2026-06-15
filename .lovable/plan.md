# Paginazione pagina Log

Attualmente `src/routes/_authenticated/logs.tsx` carica gli ultimi 200 eventi in un'unica lista che scorre all'infinito. Aggiungiamo paginazione client-side/server-side a **50 eventi per pagina**.

## Modifiche (solo `src/routes/_authenticated/logs.tsx`)

1. Stato `page` (default 0) accanto a `viewMode`.
2. La query diventa paginata:
   - `range(page*50, page*50+49)` su Supabase
   - `select(..., { count: 'exact' })` per sapere il totale
   - queryKey include `page` e `filterMode`
3. Footer della Card con:
   - Testo "Pagina N di M · X eventi totali"
   - Bottoni **Precedente / Successiva** (disabilitati ai bordi)
4. Cambio `viewMode` o nuovo evento realtime → reset `page = 0`.
5. Header card mostra "50 di X eventi" invece del solo count locale.

## Non tocco
- Engine, server fn, schema DB
- Stile / componenti riutilizzati (`Button`, `Card`, `EventRowItem`)
- Logica realtime (continua a fare refetch della pagina corrente)

## Domanda
Vuoi anche un tetto massimo totale (es. ultimi 1000 eventi navigabili) o navigazione libera su tutto lo storico?
