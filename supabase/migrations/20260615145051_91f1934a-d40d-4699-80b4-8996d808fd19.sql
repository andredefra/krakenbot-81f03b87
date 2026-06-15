
-- v2 Core-Satellite schema additions

-- 1. New settings columns
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS core_satellite_split jsonb NOT NULL DEFAULT '{"core":0.6,"satellite":0.4}'::jsonb,
  ADD COLUMN IF NOT EXISTS core_weights jsonb NOT NULL DEFAULT '{"BTC":0.6,"ETH":0.4}'::jsonb,
  ADD COLUMN IF NOT EXISTS min_volume_24h numeric NOT NULL DEFAULT 5000000,
  ADD COLUMN IF NOT EXISTS max_spread_pct numeric NOT NULL DEFAULT 0.3,
  ADD COLUMN IF NOT EXISTS min_listing_age_days int NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS macro_ma_period int NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS mid_ma_period int NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS rebalance_frequency text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS risk_per_trade_pct numeric NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS stop_atr_mult numeric NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS stop_min_pct numeric NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS monthly_trade_cap int NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS cooldown_hours int NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS max_satellite_positions int NOT NULL DEFAULT 2;

-- Update existing settings rows to v2 defaults for balanced preset
UPDATE public.settings SET
  timeframe = '4h',
  min_target_pct = 4,
  trailing_activate_pct = 12,
  trailing_gap_pct = 8,
  stop_loss_pct = 12
WHERE strategy_preset = 'balanced';

-- 2. positions: add sleeve
ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS sleeve text NOT NULL DEFAULT 'satellite' CHECK (sleeve IN ('core','satellite'));

-- 3. portfolio_snapshots: add core/satellite breakdown
ALTER TABLE public.portfolio_snapshots
  ADD COLUMN IF NOT EXISTS core_value numeric,
  ADD COLUMN IF NOT EXISTS satellite_value numeric,
  ADD COLUMN IF NOT EXISTS cash_value numeric;

-- 4. universe table
CREATE TABLE IF NOT EXISTS public.universe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset text NOT NULL UNIQUE,
  base text NOT NULL,
  quote text NOT NULL,
  volume_24h numeric,
  spread_pct numeric,
  first_seen timestamptz NOT NULL DEFAULT now(),
  eligible boolean NOT NULL DEFAULT false,
  excluded_reason text,
  last_checked timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.universe TO authenticated;
GRANT ALL ON public.universe TO service_role;

ALTER TABLE public.universe ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read universe"
  ON public.universe FOR SELECT
  TO authenticated
  USING (true);

CREATE TRIGGER update_universe_updated_at
  BEFORE UPDATE ON public.universe
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_universe_eligible ON public.universe(eligible) WHERE eligible = true;
