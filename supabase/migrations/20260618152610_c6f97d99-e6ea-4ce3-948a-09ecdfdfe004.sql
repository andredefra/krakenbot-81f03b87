-- Fix: engine_diagnostics missing write protection
-- Add owner-scoped INSERT/UPDATE/DELETE policies.
CREATE POLICY "engine_diagnostics insert own"
  ON public.engine_diagnostics FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "engine_diagnostics update own"
  ON public.engine_diagnostics FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "engine_diagnostics delete own"
  ON public.engine_diagnostics FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Fix: Realtime channel authorization
-- Enable RLS on realtime.messages with default-deny. The app uses Postgres
-- Changes (which enforces RLS on the underlying source tables) and does not
-- use Broadcast/Presence channels, so a default-deny on realtime.messages
-- prevents cross-user subscription to broadcast/presence topics without
-- breaking existing functionality.
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;