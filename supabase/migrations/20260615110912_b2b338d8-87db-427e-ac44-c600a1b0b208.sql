
-- Trigger: auto-accrue 26% tax reserve on Live closed positions in profit, and update loss carryforward on losses.
CREATE OR REPLACE FUNCTION public.accrue_tax_on_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pnl_cents BIGINT;
BEGIN
  -- Only fire when a position transitions to closed in live mode with a pnl value
  IF NEW.status = 'closed'
     AND NEW.mode = 'live'
     AND NEW.pnl IS NOT NULL
     AND (OLD.status IS DISTINCT FROM 'closed')
  THEN
    pnl_cents := ROUND(NEW.pnl * 100)::BIGINT;

    IF pnl_cents > 0 THEN
      UPDATE public.settings
        SET tax_reserve_cents = COALESCE(tax_reserve_cents, 0) + ROUND(pnl_cents * 0.26)::BIGINT
        WHERE user_id = NEW.user_id;
    ELSIF pnl_cents < 0 THEN
      UPDATE public.settings
        SET loss_carryforward_cents = COALESCE(loss_carryforward_cents, 0) + ABS(pnl_cents)
        WHERE user_id = NEW.user_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS positions_accrue_tax ON public.positions;
CREATE TRIGGER positions_accrue_tax
  AFTER INSERT OR UPDATE OF status ON public.positions
  FOR EACH ROW EXECUTE FUNCTION public.accrue_tax_on_close();

-- Anti-duplicate sent reminders
CREATE TABLE public.tax_reminders_sent (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  deadline_id TEXT NOT NULL,
  days_offset INTEGER NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, deadline_id, days_offset)
);

GRANT SELECT, INSERT ON public.tax_reminders_sent TO authenticated;
GRANT ALL ON public.tax_reminders_sent TO service_role;

ALTER TABLE public.tax_reminders_sent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own reminders"
  ON public.tax_reminders_sent FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages reminders"
  ON public.tax_reminders_sent FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
