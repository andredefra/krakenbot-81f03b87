
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS maker_fee_pct numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS taker_fee_pct numeric NOT NULL DEFAULT 0.40,
  ADD COLUMN IF NOT EXISTS slippage_pct  numeric NOT NULL DEFAULT 0.05,
  ADD COLUMN IF NOT EXISTS core_only_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bear_dca_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bear_dca_fg_threshold integer NOT NULL DEFAULT 22,
  ADD COLUMN IF NOT EXISTS bear_dca_cap_pct numeric NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS bear_dca_tranche_pct numeric NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS bear_dca_interval_days integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS exclude_fiat_commodity boolean NOT NULL DEFAULT true;

-- Aggiorna i DEFAULT v3 per i nuovi account (non tocca i record esistenti).
ALTER TABLE public.settings ALTER COLUMN min_target_pct           SET DEFAULT 5;
ALTER TABLE public.settings ALTER COLUMN monthly_trade_cap        SET DEFAULT 6;
ALTER TABLE public.settings ALTER COLUMN max_satellite_positions  SET DEFAULT 2;
