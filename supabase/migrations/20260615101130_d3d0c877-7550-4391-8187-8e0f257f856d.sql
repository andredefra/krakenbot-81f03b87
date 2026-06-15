
ALTER TABLE public.events_log ADD COLUMN IF NOT EXISTS mode public.trade_mode NOT NULL DEFAULT 'paper';
ALTER TABLE public.events_log ADD COLUMN IF NOT EXISTS payload jsonb;
ALTER TABLE public.portfolio_snapshots ADD COLUMN IF NOT EXISTS mode public.trade_mode NOT NULL DEFAULT 'paper';

CREATE INDEX IF NOT EXISTS events_log_mode_idx ON public.events_log (user_id, mode, ts DESC);
CREATE INDEX IF NOT EXISTS portfolio_snapshots_mode_idx ON public.portfolio_snapshots (user_id, mode, ts DESC);
