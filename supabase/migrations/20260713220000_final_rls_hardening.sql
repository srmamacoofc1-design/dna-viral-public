-- Final fail-closed RLS baseline for a fresh Supabase project.
--
-- The historical migration chain contained dozens of policies created FOR ALL
-- or for INSERT/UPDATE/DELETE with TO public (or without a TO clause, whose
-- default is PUBLIC). This migration inventories the *effective* pg_policies
-- state at runtime, removes unconditional mutation grants, restores only
-- authenticated/admin application flows, and fails the transaction if one
-- survives. Existing SELECT policies are deliberately left unchanged.

-- ---------------------------------------------------------------------------
-- 1. Deterministic profile/role bootstrap
-- ---------------------------------------------------------------------------

-- Defensive cleanup for databases created before the one-role-per-user index.
-- The later backfill sets the surviving row to the canonical role.
WITH ranked_roles AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id
      ORDER BY created_at ASC, id ASC
    ) AS role_number
  FROM public.user_roles
)
DELETE FROM public.user_roles AS duplicate_role
USING ranked_roles
WHERE duplicate_role.id = ranked_roles.id
  AND ranked_roles.role_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_one_role_per_user_idx
  ON public.user_roles (user_id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'display_name', ''),
      NULLIF(NEW.email, ''),
      'Usuário'
    )
  )
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'member'::public.app_role)
  ON CONFLICT (user_id) DO UPDATE
    SET role = EXCLUDED.role;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Existing users receive a profile without overwriting their chosen display
-- name, then exactly one canonical role. The upsert is idempotent.
INSERT INTO public.profiles (user_id, display_name)
SELECT
  auth_user.id,
  COALESCE(
    NULLIF(auth_user.raw_user_meta_data ->> 'display_name', ''),
    NULLIF(auth_user.email, ''),
    'Usuário'
  )
FROM auth.users AS auth_user
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT
  auth_user.id,
  'member'::public.app_role
FROM auth.users AS auth_user
ON CONFLICT (user_id) DO UPDATE
  SET role = EXCLUDED.role;

-- Role lookup is needed by authenticated RLS policies. The signup trigger is
-- not a browser RPC and must not be directly executable by anon/members.
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user()
  TO supabase_auth_admin, service_role;

-- ---------------------------------------------------------------------------
-- 2. Replace effective public/anon policies with authenticated/admin policies
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  exposed_policy record;
  table_name text;
  public_mutation_tables text[] := ARRAY[]::text[];
  public_all_read_tables text[] := ARRAY[]::text[];
  public_mutation_policies jsonb := '[]'::jsonb;
  owner_scoped_tables constant text[] := ARRAY[
    'profiles',
    'user_roles',
    'reference_videos',
    'reference_video_frames',
    'reference_video_topics',
    'reference_video_transcripts',
    'reference_generation_runs',
    'generation_contexts',
    'script_assemblies',
    'promoted_scripts',
    'reference_video_storage_migrations'
  ];
BEGIN
  -- Capture the real final state before dropping anything. Conditional owner
  -- and has_role policies are preserved; only USING/WITH CHECK true is removed.
  SELECT COALESCE(array_agg(DISTINCT policy.tablename), ARRAY[]::text[])
    INTO public_mutation_tables
  FROM pg_policies AS policy
  WHERE policy.schemaname = 'public'
    AND policy.cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
    AND EXISTS (
      SELECT 1
      FROM unnest(policy.roles) AS granted_role(role_name)
      WHERE granted_role.role_name::text IN ('public', 'anon')
    )
    AND CASE policy.cmd
      WHEN 'INSERT' THEN
        regexp_replace(lower(COALESCE(policy.with_check, 'true')), '[()[:space:]]', '', 'g') = 'true'
      WHEN 'UPDATE' THEN
        regexp_replace(lower(COALESCE(policy.qual, 'true')), '[()[:space:]]', '', 'g') = 'true'
        AND regexp_replace(lower(COALESCE(policy.with_check, 'true')), '[()[:space:]]', '', 'g') = 'true'
      WHEN 'DELETE' THEN
        regexp_replace(lower(COALESCE(policy.qual, 'true')), '[()[:space:]]', '', 'g') = 'true'
      WHEN 'ALL' THEN
        regexp_replace(lower(COALESCE(policy.qual, 'true')), '[()[:space:]]', '', 'g') = 'true'
        AND regexp_replace(lower(COALESCE(policy.with_check, 'true')), '[()[:space:]]', '', 'g') = 'true'
      ELSE false
    END;

  SELECT COALESCE(array_agg(DISTINCT policy.tablename), ARRAY[]::text[])
    INTO public_all_read_tables
  FROM pg_policies AS policy
  WHERE policy.schemaname = 'public'
    AND policy.cmd = 'ALL'
    AND EXISTS (
      SELECT 1
      FROM unnest(policy.roles) AS granted_role(role_name)
      WHERE granted_role.role_name::text IN ('public', 'anon')
    )
    AND regexp_replace(lower(COALESCE(policy.qual, 'true')), '[()[:space:]]', '', 'g') = 'true'
    AND regexp_replace(lower(COALESCE(policy.with_check, 'true')), '[()[:space:]]', '', 'g') = 'true';

  SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'tablename', policy.tablename,
          'policyname', policy.policyname
        )
        ORDER BY policy.tablename, policy.policyname
      ),
      '[]'::jsonb
    )
    INTO public_mutation_policies
  FROM pg_policies AS policy
  WHERE policy.schemaname = 'public'
    AND policy.cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
    AND EXISTS (
      SELECT 1
      FROM unnest(policy.roles) AS granted_role(role_name)
      WHERE granted_role.role_name::text IN ('public', 'anon')
    )
    AND CASE policy.cmd
      WHEN 'INSERT' THEN
        regexp_replace(lower(COALESCE(policy.with_check, 'true')), '[()[:space:]]', '', 'g') = 'true'
      WHEN 'UPDATE' THEN
        regexp_replace(lower(COALESCE(policy.qual, 'true')), '[()[:space:]]', '', 'g') = 'true'
        AND regexp_replace(lower(COALESCE(policy.with_check, 'true')), '[()[:space:]]', '', 'g') = 'true'
      WHEN 'DELETE' THEN
        regexp_replace(lower(COALESCE(policy.qual, 'true')), '[()[:space:]]', '', 'g') = 'true'
      WHEN 'ALL' THEN
        regexp_replace(lower(COALESCE(policy.qual, 'true')), '[()[:space:]]', '', 'g') = 'true'
        AND regexp_replace(lower(COALESCE(policy.with_check, 'true')), '[()[:space:]]', '', 'g') = 'true'
      ELSE false
    END;

  FOR exposed_policy IN
    SELECT policy_record.tablename, policy_record.policyname
    FROM jsonb_to_recordset(public_mutation_policies)
      AS policy_record(tablename text, policyname text)
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      exposed_policy.policyname,
      exposed_policy.tablename
    );
  END LOOP;

  -- Restore direct browser writes only for authenticated administrators. Edge
  -- Functions use service_role and bypass RLS. Owner-scoped/server-owned tables
  -- retain the explicit policies installed by the preceding hardening migrations.
  FOREACH table_name IN ARRAY public_mutation_tables
  LOOP
    IF table_name = ANY(owner_scoped_tables) THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM anon',
      table_name
    );
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM PUBLIC',
      table_name
    );
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated, service_role',
      table_name
    );
    EXECUTE format('DROP POLICY IF EXISTS final_admin_mutation ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY final_admin_mutation ON public.%I FOR ALL TO authenticated '
      || 'USING (public.has_role((SELECT auth.uid()), ''admin'')) '
      || 'WITH CHECK (public.has_role((SELECT auth.uid()), ''admin''))',
      table_name
    );
  END LOOP;

  -- FOR ALL previously also granted SELECT. Preserve that read-only behavior
  -- explicitly while removing its mutation half.
  FOREACH table_name IN ARRAY public_all_read_tables
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS final_public_read ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY final_public_read ON public.%I '
      || 'FOR SELECT TO anon, authenticated USING (true)',
      table_name
    );
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon, authenticated', table_name);
  END LOOP;
END;
$$;

-- Old Storage policy names are removed defensively. The policies created in
-- 20260713130000 remain: own-user paths in private reference-videos and
-- administrator-only mutations in the public legacy videos bucket.
DROP POLICY IF EXISTS "Allow public upload videos" ON storage.objects;
DROP POLICY IF EXISTS "Allow public delete videos" ON storage.objects;

-- ---------------------------------------------------------------------------
-- 3. Migration-time invariants: abort instead of silently shipping exposure
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      AND EXISTS (
        SELECT 1
        FROM unnest(policy.roles) AS granted_role(role_name)
        WHERE granted_role.role_name::text IN ('public', 'anon')
      )
      AND CASE policy.cmd
        WHEN 'INSERT' THEN
          regexp_replace(lower(COALESCE(policy.with_check, 'true')), '[()[:space:]]', '', 'g') = 'true'
        WHEN 'UPDATE' THEN
          regexp_replace(lower(COALESCE(policy.qual, 'true')), '[()[:space:]]', '', 'g') = 'true'
          AND regexp_replace(lower(COALESCE(policy.with_check, 'true')), '[()[:space:]]', '', 'g') = 'true'
        WHEN 'DELETE' THEN
          regexp_replace(lower(COALESCE(policy.qual, 'true')), '[()[:space:]]', '', 'g') = 'true'
        WHEN 'ALL' THEN
          regexp_replace(lower(COALESCE(policy.qual, 'true')), '[()[:space:]]', '', 'g') = 'true'
          AND regexp_replace(lower(COALESCE(policy.with_check, 'true')), '[()[:space:]]', '', 'g') = 'true'
        ELSE false
      END
  ) THEN
    RAISE EXCEPTION 'RLS hardening failed: an unconditional public/anon mutation policy remains';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies AS policy
    WHERE policy.schemaname = 'storage'
      AND policy.tablename = 'objects'
      AND policy.cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      AND EXISTS (
        SELECT 1
        FROM unnest(policy.roles) AS granted_role(role_name)
        WHERE granted_role.role_name::text IN ('public', 'anon')
      )
  ) THEN
    RAISE EXCEPTION 'Storage hardening failed: a public/anon object mutation policy remains';
  END IF;

  IF EXISTS (
    SELECT auth_user.id
    FROM auth.users AS auth_user
    LEFT JOIN public.profiles AS profile ON profile.user_id = auth_user.id
    LEFT JOIN public.user_roles AS user_role ON user_role.user_id = auth_user.id
    GROUP BY auth_user.id, profile.user_id
    HAVING profile.user_id IS NULL OR count(user_role.id) <> 1
  ) THEN
    RAISE EXCEPTION 'Auth bootstrap failed: every auth user must have one profile and exactly one role';
  END IF;

END;
$$;
