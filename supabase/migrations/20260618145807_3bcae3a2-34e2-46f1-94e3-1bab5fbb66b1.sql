
-- Enum for proposal status
DO $$ BEGIN
  CREATE TYPE public.ai_proposal_status AS ENUM ('pending','approved','rejected','validated','validation_failed','applied');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ai_supervisor_flag AS ENUM ('core_only_mode','bear_dca_enabled','exclude_fiat_commodity');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ai_reports
CREATE TABLE IF NOT EXISTS public.ai_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  period TEXT NOT NULL DEFAULT 'hourly',
  market_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  self_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  narrative TEXT NOT NULL DEFAULT '',
  anomalies JSONB NOT NULL DEFAULT '[]'::jsonb,
  proposals_generated UUID[] NOT NULL DEFAULT '{}'::uuid[]
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_reports TO authenticated;
GRANT ALL ON public.ai_reports TO service_role;
ALTER TABLE public.ai_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own reports" ON public.ai_reports FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS ai_reports_user_created_idx ON public.ai_reports(user_id, created_at DESC);

-- ai_proposals
CREATE TABLE IF NOT EXISTS public.ai_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  report_id UUID REFERENCES public.ai_reports(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  param_diff JSONB NOT NULL DEFAULT '[]'::jsonb,
  status public.ai_proposal_status NOT NULL DEFAULT 'pending',
  decided_at TIMESTAMPTZ,
  decided_by UUID,
  validation_result JSONB,
  validated_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_proposals TO authenticated;
GRANT ALL ON public.ai_proposals TO service_role;
ALTER TABLE public.ai_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own proposals" ON public.ai_proposals FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS ai_proposals_user_status_idx ON public.ai_proposals(user_id, status, created_at DESC);

-- ai_flag_changes
CREATE TABLE IF NOT EXISTS public.ai_flag_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  flag public.ai_supervisor_flag NOT NULL,
  from_value BOOLEAN,
  to_value BOOLEAN NOT NULL,
  rule_triggered TEXT NOT NULL,
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_flag_changes TO authenticated;
GRANT ALL ON public.ai_flag_changes TO service_role;
ALTER TABLE public.ai_flag_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own flag changes" ON public.ai_flag_changes FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS ai_flag_changes_user_idx ON public.ai_flag_changes(user_id, created_at DESC);

-- settings: aggiungi soglia FG per bear-DCA se mancante
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS ai_bear_dca_fg_threshold INTEGER NOT NULL DEFAULT 25;
