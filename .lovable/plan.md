Sì, fermato al 100%.

`cron.job` è vuoto → nessun cron gira più, incluso `ai-strategy-supervisor-hourly`. L'AI Supervisor non parte più in automatico.

L'unico modo residuo per far girare l'AI Supervisor sarebbe:
- chiamare manualmente l'endpoint `/api/public/hooks/ai-strategy-supervisor`
- o lanciarlo dalla UI (se c'è un bottone "Esegui ora")

Se non fai nessuna delle due, zero consumo. Vuoi che aggiunga anche un blocco hard (es. early-return nell'endpoint finché `is_running=false`) per evitare trigger accidentali?