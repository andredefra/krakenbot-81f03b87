
-- 1. Estendi settings con preset strategia
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS strategy_preset TEXT NOT NULL DEFAULT 'balanced',
  ADD COLUMN IF NOT EXISTS regime_filter TEXT NOT NULL DEFAULT 'btc_sma50',
  ADD COLUMN IF NOT EXISTS fg_greed_cap INT NOT NULL DEFAULT 75;

ALTER TABLE public.settings
  ADD CONSTRAINT settings_strategy_preset_check
    CHECK (strategy_preset IN ('conservative','balanced','aggressive','custom'));
ALTER TABLE public.settings
  ADD CONSTRAINT settings_regime_filter_check
    CHECK (regime_filter IN ('btc_sma50','btc_sma200','fg_only','off'));

-- 2. Tabella OHLC storico (crypto + indici)
CREATE TABLE public.historical_ohlc (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  source TEXT NOT NULL,
  date DATE NOT NULL,
  open NUMERIC NOT NULL,
  high NUMERIC NOT NULL,
  low NUMERIC NOT NULL,
  close NUMERIC NOT NULL,
  volume NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (symbol, date)
);
CREATE INDEX historical_ohlc_symbol_date_idx ON public.historical_ohlc (symbol, date DESC);
GRANT SELECT ON public.historical_ohlc TO authenticated;
GRANT ALL ON public.historical_ohlc TO service_role;
ALTER TABLE public.historical_ohlc ENABLE ROW LEVEL SECURITY;
CREATE POLICY "historical_ohlc readable by authenticated"
  ON public.historical_ohlc FOR SELECT TO authenticated USING (true);

-- 3. Storico Fear & Greed
CREATE TABLE public.fg_history (
  date DATE PRIMARY KEY,
  value INT NOT NULL,
  classification TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.fg_history TO authenticated;
GRANT ALL ON public.fg_history TO service_role;
ALTER TABLE public.fg_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fg_history readable by authenticated"
  ON public.fg_history FOR SELECT TO authenticated USING (true);

-- 4. Cache risultati backtest
CREATE TABLE public.backtest_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  input_hash TEXT NOT NULL,
  preset TEXT NOT NULL,
  years INT NOT NULL,
  universe TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, input_hash)
);
CREATE INDEX backtest_runs_user_idx ON public.backtest_runs (user_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.backtest_runs TO authenticated;
GRANT ALL ON public.backtest_runs TO service_role;
ALTER TABLE public.backtest_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "backtest_runs own rows"
  ON public.backtest_runs FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 5. Tabella ultimo snapshot diagnostica engine (1 riga per user, ultima valutazione candidati)
CREATE TABLE public.engine_diagnostics (
  user_id UUID PRIMARY KEY,
  cycle_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  regime TEXT NOT NULL,
  regime_reason TEXT,
  btc_last NUMERIC,
  btc_sma50 NUMERIC,
  fg_value INT,
  fg_label TEXT,
  candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.engine_diagnostics TO authenticated;
GRANT ALL ON public.engine_diagnostics TO service_role;
ALTER TABLE public.engine_diagnostics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "engine_diagnostics own row"
  ON public.engine_diagnostics FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
