ALTER TABLE public.blueprint_contexts
  ADD COLUMN hook_position_tolerance_pct numeric DEFAULT 5,
  ADD COLUMN payoff_position_tolerance_pct numeric DEFAULT 5,
  ADD COLUMN cta_position_tolerance_seconds numeric DEFAULT 1;