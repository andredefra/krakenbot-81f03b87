ALTER TABLE public.settings
ADD COLUMN IF NOT EXISTS ai_supervisor_state JSONB;

COMMENT ON COLUMN public.settings.ai_supervisor_state IS
'AI Supervisor state: { last_run_at, last_decision: {core_only_mode,bear_dca_enabled,exclude_fiat_commodity}, reasoning, confidence, changed_flags[] }';