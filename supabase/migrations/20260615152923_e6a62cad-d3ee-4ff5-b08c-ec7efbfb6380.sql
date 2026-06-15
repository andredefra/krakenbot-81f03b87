ALTER TABLE public.engine_diagnostics
  ADD COLUMN IF NOT EXISTS macro_regime text,
  ADD COLUMN IF NOT EXISTS macro_reason text,
  ADD COLUMN IF NOT EXISTS btc_sma200 numeric,
  ADD COLUMN IF NOT EXISTS meso_regime text,
  ADD COLUMN IF NOT EXISTS meso_reason text,
  ADD COLUMN IF NOT EXISTS core_state jsonb,
  ADD COLUMN IF NOT EXISTS satellite_state jsonb,
  ADD COLUMN IF NOT EXISTS universe_eligible jsonb;