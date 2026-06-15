
-- ============= infra_costs =============
CREATE TABLE public.infra_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'infra',
  amount_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  recurrence text NOT NULL DEFAULT 'monthly',
  start_date date NOT NULL,
  end_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT infra_costs_recurrence_check CHECK (recurrence IN ('one_off','monthly','yearly')),
  CONSTRAINT infra_costs_category_check CHECK (category IN ('infra','api','altro'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.infra_costs TO authenticated;
GRANT ALL ON public.infra_costs TO service_role;

ALTER TABLE public.infra_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own infra_costs"
  ON public.infra_costs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_infra_costs_updated_at
  BEFORE UPDATE ON public.infra_costs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============= trade_fees =============
CREATE TABLE public.trade_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kraken_trade_id text NOT NULL,
  position_id uuid REFERENCES public.positions(id) ON DELETE SET NULL,
  fee_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  pair text,
  volume numeric,
  cost numeric,
  traded_at timestamptz NOT NULL,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trade_fees_user_kraken_unique UNIQUE (user_id, kraken_trade_id)
);

CREATE INDEX idx_trade_fees_user_date ON public.trade_fees(user_id, traded_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_fees TO authenticated;
GRANT ALL ON public.trade_fees TO service_role;

ALTER TABLE public.trade_fees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own trade_fees"
  ON public.trade_fees FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own trade_fees"
  ON public.trade_fees FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============= fx_rates (shared cache) =============
CREATE TABLE public.fx_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base text NOT NULL,
  quote text NOT NULL,
  rate_date date NOT NULL,
  rate numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fx_rates_unique UNIQUE (base, quote, rate_date)
);

CREATE INDEX idx_fx_rates_lookup ON public.fx_rates(base, quote, rate_date DESC);

GRANT SELECT ON public.fx_rates TO authenticated;
GRANT ALL ON public.fx_rates TO service_role;

ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read fx_rates"
  ON public.fx_rates FOR SELECT
  TO authenticated
  USING (true);

-- ============= settings: tax + paper fee columns =============
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS tax_country text NOT NULL DEFAULT 'IT',
  ADD COLUMN IF NOT EXISTS tax_reserve_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loss_carryforward_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paper_fee_bps integer NOT NULL DEFAULT 26;
