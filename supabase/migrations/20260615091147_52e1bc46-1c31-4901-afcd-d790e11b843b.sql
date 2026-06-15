
-- Extensions for cron + http
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Enums
CREATE TYPE public.trade_mode AS ENUM ('paper', 'live');
CREATE TYPE public.position_status AS ENUM ('open', 'closed');
CREATE TYPE public.position_side AS ENUM ('long');
CREATE TYPE public.event_level AS ENUM ('info', 'warn', 'error');

-- Shared updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =========================
-- settings
-- =========================
CREATE TABLE public.settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  mode public.trade_mode NOT NULL DEFAULT 'paper',
  is_running BOOLEAN NOT NULL DEFAULT false,
  capital_reference NUMERIC NOT NULL DEFAULT 318,
  kill_switch_floor NUMERIC NOT NULL DEFAULT 159,
  max_positions INTEGER NOT NULL DEFAULT 3,
  max_position_pct NUMERIC NOT NULL DEFAULT 30,
  stop_loss_pct NUMERIC NOT NULL DEFAULT 10,
  trailing_activate_pct NUMERIC NOT NULL DEFAULT 10,
  trailing_gap_pct NUMERIC NOT NULL DEFAULT 7,
  take_profit_pct NUMERIC NOT NULL DEFAULT 20,
  min_target_pct NUMERIC NOT NULL DEFAULT 2,
  daily_loss_limit_pct NUMERIC NOT NULL DEFAULT 8,
  timeframe TEXT NOT NULL DEFAULT '1h',
  enabled_sentiment_sources JSONB NOT NULL DEFAULT '{"fear_greed":true,"lunarcrush":false,"santiment":false,"news":false}'::jsonb,
  sentiment_weights JSONB NOT NULL DEFAULT '{"fear_greed":1,"lunarcrush":0.5,"santiment":0.5,"news":0.3}'::jsonb,
  asset_universe JSONB NOT NULL DEFAULT '{"core":["ETH","SOL"],"momentum":["ADA","LINK","AVAX","DOT"],"regime":["BTC"]}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own settings"
  ON public.settings FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_settings_updated_at
  BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- positions
-- =========================
CREATE TABLE public.positions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset TEXT NOT NULL,
  side public.position_side NOT NULL DEFAULT 'long',
  status public.position_status NOT NULL DEFAULT 'open',
  mode public.trade_mode NOT NULL DEFAULT 'paper',
  entry_price NUMERIC NOT NULL,
  entry_value NUMERIC NOT NULL,
  qty NUMERIC NOT NULL,
  current_price NUMERIC,
  stop_price NUMERIC,
  trailing_high NUMERIC,
  open_reason TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  exit_price NUMERIC,
  exit_value NUMERIC,
  pnl NUMERIC,
  pnl_pct NUMERIC,
  exit_reason TEXT,
  closed_at TIMESTAMPTZ,
  kraken_order_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.positions TO authenticated;
GRANT ALL ON public.positions TO service_role;

ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own positions"
  ON public.positions FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_positions_user_status ON public.positions(user_id, status);
CREATE INDEX idx_positions_user_closed ON public.positions(user_id, closed_at DESC);

CREATE TRIGGER update_positions_updated_at
  BEFORE UPDATE ON public.positions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- sentiment_snapshots
-- =========================
CREATE TABLE public.sentiment_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'market',
  score NUMERIC,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sentiment_snapshots TO authenticated;
GRANT ALL ON public.sentiment_snapshots TO service_role;

ALTER TABLE public.sentiment_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own sentiment snapshots"
  ON public.sentiment_snapshots FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_sentiment_user_ts ON public.sentiment_snapshots(user_id, ts DESC, source);

-- =========================
-- portfolio_snapshots
-- =========================
CREATE TABLE public.portfolio_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_value NUMERIC NOT NULL,
  cash_value NUMERIC NOT NULL,
  positions_value NUMERIC NOT NULL,
  realized_pnl_day NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.portfolio_snapshots TO authenticated;
GRANT ALL ON public.portfolio_snapshots TO service_role;

ALTER TABLE public.portfolio_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own portfolio snapshots"
  ON public.portfolio_snapshots FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_portfolio_user_ts ON public.portfolio_snapshots(user_id, ts DESC);

-- =========================
-- events_log
-- =========================
CREATE TABLE public.events_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  level public.event_level NOT NULL DEFAULT 'info',
  component TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.events_log TO authenticated;
GRANT ALL ON public.events_log TO service_role;

ALTER TABLE public.events_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own events log"
  ON public.events_log FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_events_user_ts ON public.events_log(user_id, ts DESC);

-- =========================
-- Auto-create settings row on new user
-- =========================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.settings (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================
-- Realtime
-- =========================
ALTER PUBLICATION supabase_realtime ADD TABLE public.positions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.portfolio_snapshots;
ALTER PUBLICATION supabase_realtime ADD TABLE public.events_log;
ALTER PUBLICATION supabase_realtime ADD TABLE public.settings;
