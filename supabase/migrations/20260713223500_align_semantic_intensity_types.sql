-- The legacy contract stores both per-video emotional intensities as integers.
-- Keep this forward correction because 20260713223000 was briefly deployed
-- with numeric columns while reconstructing the missing historical table.

ALTER TABLE public.semantic_patterns
  ALTER COLUMN hook_emotional_intensity TYPE integer
    USING hook_emotional_intensity::integer,
  ALTER COLUMN payoff_emotional_intensity TYPE integer
    USING payoff_emotional_intensity::integer;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'semantic_patterns'
      AND column_name IN (
        'hook_emotional_intensity',
        'payoff_emotional_intensity'
      )
      AND data_type <> 'integer'
  ) THEN
    RAISE EXCEPTION 'semantic_patterns intensity columns must be integers';
  END IF;
END;
$$;
