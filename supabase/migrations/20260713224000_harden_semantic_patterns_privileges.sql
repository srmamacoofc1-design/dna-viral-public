-- Forward privilege correction for the already-deployed restoration migration.
-- RLS does not protect TRUNCATE, REFERENCES, or TRIGGER privileges.

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

DROP POLICY IF EXISTS semantic_patterns_read ON public.semantic_patterns;
CREATE POLICY semantic_patterns_read
  ON public.semantic_patterns
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS semantic_patterns_admin_mutation ON public.semantic_patterns;
CREATE POLICY semantic_patterns_admin_mutation
  ON public.semantic_patterns
  FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.semantic_patterns', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.semantic_patterns', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.semantic_patterns', 'TRIGGER') THEN
    RAISE EXCEPTION 'semantic_patterns grants unsafe table privileges to authenticated';
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
END;
$$;
