-- Restore the legacy per-video semantic contract that is still consumed by
-- generation-context, cross-pattern detection, exports, and V2 reprocessing.
-- The generated Supabase types contained this table, but no historical
-- migration created it, which made clean project deployments incomplete.

CREATE TABLE IF NOT EXISTS public.semantic_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL UNIQUE
    REFERENCES public.videos(id) ON DELETE CASCADE,
  hook_text text,
  hook_word_count integer,
  hook_phrase_type text,
  hook_emotional_type text,
  hook_emotional_intensity integer,
  trigger_words jsonb DEFAULT '[]'::jsonb,
  most_common_trigger_words jsonb DEFAULT '[]'::jsonb,
  dominant_verbal_tone text,
  verbal_tone_per_block jsonb DEFAULT '[]'::jsonb,
  repeated_words jsonb DEFAULT '[]'::jsonb,
  strong_phrases jsonb DEFAULT '[]'::jsonb,
  payoff_text text,
  payoff_pattern text,
  payoff_emotional_type text,
  payoff_emotional_intensity integer,
  cta_exists boolean,
  cta_type text,
  cta_tone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT semantic_patterns_hook_word_count_nonnegative
    CHECK (hook_word_count IS NULL OR hook_word_count >= 0)
);

COMMENT ON TABLE public.semantic_patterns IS
  'Legacy one-row-per-video semantic summary used by DNA context and cross-pattern analysis.';

DROP TRIGGER IF EXISTS update_semantic_patterns_updated_at
  ON public.semantic_patterns;
CREATE TRIGGER update_semantic_patterns_updated_at
  BEFORE UPDATE ON public.semantic_patterns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS audit_semantic_patterns
  ON public.semantic_patterns;
CREATE TRIGGER audit_semantic_patterns
  AFTER INSERT OR UPDATE OR DELETE ON public.semantic_patterns
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

ALTER TABLE public.semantic_patterns ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  exposed_policy record;
BEGIN
  FOR exposed_policy IN
    SELECT policy.policyname
    FROM pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'semantic_patterns'
      AND policy.cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      AND EXISTS (
        SELECT 1
        FROM unnest(policy.roles) AS granted_role(role_name)
        WHERE granted_role.role_name::text IN ('public', 'anon')
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.semantic_patterns',
      exposed_policy.policyname
    );
  END LOOP;
END;
$$;

REVOKE ALL PRIVILEGES ON TABLE public.semantic_patterns
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.semantic_patterns TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.semantic_patterns TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.semantic_patterns TO service_role;

DROP POLICY IF EXISTS semantic_patterns_read
  ON public.semantic_patterns;
CREATE POLICY semantic_patterns_read
  ON public.semantic_patterns
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS semantic_patterns_admin_mutation
  ON public.semantic_patterns;
CREATE POLICY semantic_patterns_admin_mutation
  ON public.semantic_patterns
  FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));

-- Fail the migration if the clean-project contract is not exactly one row per
-- video or if an unconditional browser mutation policy was introduced.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.semantic_patterns'::regclass
      AND contype = 'u'
      AND conname = 'semantic_patterns_video_id_key'
  ) THEN
    RAISE EXCEPTION 'semantic_patterns must enforce one row per video';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'semantic_patterns'
      AND policy.cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      AND EXISTS (
        SELECT 1
        FROM unnest(policy.roles) AS granted_role(role_name)
        WHERE granted_role.role_name::text IN ('public', 'anon')
      )
  ) THEN
    RAISE EXCEPTION 'semantic_patterns has an unsafe public/anon mutation policy';
  END IF;

  IF has_table_privilege('authenticated', 'public.semantic_patterns', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.semantic_patterns', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.semantic_patterns', 'TRIGGER') THEN
    RAISE EXCEPTION 'semantic_patterns grants unsafe table privileges to authenticated';
  END IF;
END;
$$;
