ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS paper_seed_total_usd numeric,
  ADD COLUMN IF NOT EXISTS paper_seed_cash_usd numeric,
  ADD COLUMN IF NOT EXISTS paper_seeded_at timestamptz;