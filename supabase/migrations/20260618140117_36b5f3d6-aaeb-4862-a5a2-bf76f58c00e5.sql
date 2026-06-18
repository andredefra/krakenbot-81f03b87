ALTER TABLE public.positions DROP CONSTRAINT IF EXISTS positions_sleeve_check;
ALTER TABLE public.positions ADD CONSTRAINT positions_sleeve_check CHECK (sleeve = ANY (ARRAY['core'::text, 'satellite'::text, 'dca'::text]));
ALTER TABLE public.positions ADD COLUMN IF NOT EXISTS fee_paid_usd numeric DEFAULT 0;