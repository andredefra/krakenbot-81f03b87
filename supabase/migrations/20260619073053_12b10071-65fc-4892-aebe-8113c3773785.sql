
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS asset_class_split jsonb NOT NULL DEFAULT '{"crypto":1,"stocks":0,"futures":0,"forex":0}'::jsonb,
  ADD COLUMN IF NOT EXISTS stocks_universe text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS futures_universe text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS forex_universe text[] NOT NULL DEFAULT ARRAY[]::text[];

ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS asset_class text NOT NULL DEFAULT 'crypto';

CREATE INDEX IF NOT EXISTS positions_asset_class_idx ON public.positions(user_id, asset_class);

ALTER TABLE public.universe
  ADD COLUMN IF NOT EXISTS asset_class text NOT NULL DEFAULT 'crypto';

ALTER TABLE public.engine_diagnostics
  ADD COLUMN IF NOT EXISTS asset_class_exposure jsonb;
