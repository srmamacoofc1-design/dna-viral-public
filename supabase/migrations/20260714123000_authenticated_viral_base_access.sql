-- Let every authenticated account use the Viral Base without turning members
-- into administrators. The corpus remains readable as a shared base, while
-- destructive writes are scoped to the account that created the video/preset.

ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS approved_for_global boolean NOT NULL DEFAULT false;
ALTER TABLE public.videos
  ALTER COLUMN created_by SET DEFAULT auth.uid();
UPDATE public.videos
   SET approved_for_global = true
 WHERE created_by IS NULL;
CREATE INDEX IF NOT EXISTS videos_created_by_idx ON public.videos(created_by);
CREATE INDEX IF NOT EXISTS videos_global_approval_idx
  ON public.videos(approved_for_global)
  WHERE approved_for_global = true;

ALTER TABLE public.dataset_cohort
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.dataset_cohort
  ALTER COLUMN created_by SET DEFAULT auth.uid();
CREATE INDEX IF NOT EXISTS dataset_cohort_created_by_idx ON public.dataset_cohort(created_by);

CREATE OR REPLACE FUNCTION public.can_manage_viral_video(_video_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.videos AS video
     WHERE video.id = _video_id
       AND (
         (
           video.created_by = (SELECT auth.uid())
           AND video.approved_for_global = false
         )
         OR public.has_role((SELECT auth.uid()), 'admin')
       )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_viral_video(_video_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.videos AS video
     WHERE video.id = _video_id
       AND (
         video.approved_for_global = true
         OR video.created_by = (SELECT auth.uid())
         OR public.has_role((SELECT auth.uid()), 'admin')
       )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_dna_preset(_cohort_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.dataset_cohort AS cohort
     WHERE cohort.id = _cohort_id
       AND cohort.cohort_type = 'dna_preset'
       AND (
         cohort.created_by = (SELECT auth.uid())
         OR public.has_role((SELECT auth.uid()), 'admin')
       )
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_viral_video(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_viral_video(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_dna_preset(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_viral_video(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_viral_video(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_dna_preset(uuid) TO authenticated, service_role;

-- A member can create, update, retry and delete only their own library videos.
-- Existing corpus rows keep created_by NULL and therefore remain admin-owned.
DROP POLICY IF EXISTS videos_member_insert_own ON public.videos;
DROP POLICY IF EXISTS videos_member_update_own ON public.videos;
DROP POLICY IF EXISTS videos_member_delete_own ON public.videos;
CREATE POLICY videos_member_insert_own ON public.videos
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND approved_for_global = false
  );
CREATE POLICY videos_member_update_own ON public.videos
  FOR UPDATE TO authenticated
  USING (
    created_by = (SELECT auth.uid())
    AND approved_for_global = false
  )
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND approved_for_global = false
  );
CREATE POLICY videos_member_delete_own ON public.videos
  FOR DELETE TO authenticated
  USING (
    created_by = (SELECT auth.uid())
    AND approved_for_global = false
  );

-- Replace the historical anonymous corpus reads. Authenticated users see the
-- approved shared corpus plus their own private modeling videos; admins see all.
DO $$
DECLARE
  exposed_policy record;
BEGIN
  FOR exposed_policy IN
    SELECT policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'videos'
       AND cmd IN ('SELECT', 'ALL')
       AND EXISTS (
         SELECT 1
           FROM unnest(roles) AS granted_role(role_name)
          WHERE granted_role.role_name::text IN ('public', 'anon')
       )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.videos', exposed_policy.policyname);
  END LOOP;
END
$$;
REVOKE SELECT ON TABLE public.videos FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.videos TO authenticated, service_role;
DROP POLICY IF EXISTS videos_read_authenticated ON public.videos;
CREATE POLICY videos_read_authenticated ON public.videos
  FOR SELECT TO authenticated
  USING (
    approved_for_global = true
    OR created_by = (SELECT auth.uid())
    OR public.has_role((SELECT auth.uid()), 'admin')
  );

DO $$
DECLARE
  table_name text;
  exposed_policy record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'block_phrase_patterns',
    'block_semantic_patterns',
    'block_verbal_analysis',
    'block_word_patterns',
    'cta_deep_analysis',
    'cta_profiles',
    'data_consistency_reports',
    'extraction_logs',
    'narrative_judge_results',
    'outlier_detection',
    'processing_queue',
    'semantic_patterns',
    'text_image_compatibility',
    'text_visual_alignment',
    'validation_reports',
    'verbal_canonical_units',
    'verbal_noise_archive',
    'video_blocks',
    'video_cta_events',
    'video_frames',
    'video_languages',
    'video_logs',
    'video_metadata',
    'video_micro_events',
    'video_scripts',
    'video_temporal_profile',
    'video_transcripts',
    'viral_word_combinations',
    'visual_block_analysis',
    'visual_emotion_sequence'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      CONTINUE;
    END IF;

    FOR exposed_policy IN
      SELECT policyname
        FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = table_name
         AND cmd IN ('SELECT', 'ALL')
         AND EXISTS (
           SELECT 1
             FROM unnest(roles) AS granted_role(role_name)
            WHERE granted_role.role_name::text IN ('public', 'anon')
         )
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        exposed_policy.policyname,
        table_name
      );
    END LOOP;

    EXECUTE format('REVOKE SELECT ON TABLE public.%I FROM PUBLIC, anon', table_name);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated, service_role', table_name);
    EXECUTE format('DROP POLICY IF EXISTS authenticated_video_rows_read ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY authenticated_video_rows_read ON public.%I FOR SELECT TO authenticated '
      || 'USING (public.can_read_viral_video(video_id))',
      table_name
    );
  END LOOP;
END
$$;

-- Browser-side ingestion writes these child rows before the service worker
-- claims the job. Ownership is always derived from the parent video.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'processing_queue',
    'video_metadata',
    'video_languages',
    'video_logs',
    'video_frames',
    'video_transcripts',
    'video_blocks',
    'extraction_logs',
    'visual_emotion_sequence'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated, service_role',
      table_name
    );
    EXECUTE format('DROP POLICY IF EXISTS member_own_video_rows ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY member_own_video_rows ON public.%I FOR ALL TO authenticated '
      || 'USING (public.can_manage_viral_video(video_id)) '
      || 'WITH CHECK (public.can_manage_viral_video(video_id))',
      table_name
    );
  END LOOP;
END
$$;

-- DNA presets are private to their creator. Legacy presets (created_by NULL)
-- stay shared/read-only, preserving every existing generation flow.
DO $$
DECLARE
  table_name text;
  exposed_policy record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['dataset_cohort', 'dataset_cohort_videos']
  LOOP
    FOR exposed_policy IN
      SELECT policyname
        FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = table_name
         AND cmd IN ('SELECT', 'ALL')
         AND EXISTS (
           SELECT 1
             FROM unnest(roles) AS granted_role(role_name)
            WHERE granted_role.role_name::text IN ('public', 'anon')
         )
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        exposed_policy.policyname,
        table_name
      );
    END LOOP;

    EXECUTE format('REVOKE SELECT ON TABLE public.%I FROM PUBLIC, anon', table_name);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated, service_role', table_name);
  END LOOP;
END
$$;

DROP POLICY IF EXISTS dataset_cohort_read_authenticated ON public.dataset_cohort;
CREATE POLICY dataset_cohort_read_authenticated ON public.dataset_cohort
  FOR SELECT TO authenticated
  USING (
    cohort_type IS DISTINCT FROM 'dna_preset'
    OR created_by IS NULL
    OR created_by = (SELECT auth.uid())
    OR public.has_role((SELECT auth.uid()), 'admin')
  );

DROP POLICY IF EXISTS dataset_cohort_member_preset_insert ON public.dataset_cohort;
DROP POLICY IF EXISTS dataset_cohort_member_preset_update ON public.dataset_cohort;
DROP POLICY IF EXISTS dataset_cohort_member_preset_delete ON public.dataset_cohort;
CREATE POLICY dataset_cohort_member_preset_insert ON public.dataset_cohort
  FOR INSERT TO authenticated
  WITH CHECK (
    cohort_type = 'dna_preset'
    AND created_by = (SELECT auth.uid())
  );
CREATE POLICY dataset_cohort_member_preset_update ON public.dataset_cohort
  FOR UPDATE TO authenticated
  USING (
    cohort_type = 'dna_preset'
    AND created_by = (SELECT auth.uid())
  )
  WITH CHECK (
    cohort_type = 'dna_preset'
    AND created_by = (SELECT auth.uid())
  );
CREATE POLICY dataset_cohort_member_preset_delete ON public.dataset_cohort
  FOR DELETE TO authenticated
  USING (
    cohort_type = 'dna_preset'
    AND created_by = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS dataset_cohort_videos_member_preset_rows ON public.dataset_cohort_videos;
DROP POLICY IF EXISTS dataset_cohort_videos_read_authenticated ON public.dataset_cohort_videos;
CREATE POLICY dataset_cohort_videos_read_authenticated ON public.dataset_cohort_videos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.dataset_cohort AS cohort
       WHERE cohort.id = cohort_id
         AND (
           cohort.cohort_type IS DISTINCT FROM 'dna_preset'
           OR cohort.created_by IS NULL
           OR cohort.created_by = (SELECT auth.uid())
           OR public.has_role((SELECT auth.uid()), 'admin')
         )
    )
    AND public.can_read_viral_video(video_id)
  );
CREATE POLICY dataset_cohort_videos_member_preset_rows ON public.dataset_cohort_videos
  FOR ALL TO authenticated
  USING (
    public.can_manage_dna_preset(cohort_id)
    AND public.can_read_viral_video(video_id)
  )
  WITH CHECK (
    public.can_manage_dna_preset(cohort_id)
    AND public.can_read_viral_video(video_id)
  );

-- Profiles may contain an email-derived display name. They must never be
-- enumerable without a session; members read only themselves and admins all.
DO $$
DECLARE
  exposed_policy record;
BEGIN
  FOR exposed_policy IN
    SELECT policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'profiles'
       AND cmd IN ('SELECT', 'ALL')
       AND EXISTS (
         SELECT 1
           FROM unnest(roles) AS granted_role(role_name)
          WHERE granted_role.role_name::text IN ('public', 'anon')
       )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', exposed_policy.policyname);
  END LOOP;
END
$$;
REVOKE SELECT ON TABLE public.profiles FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.profiles TO authenticated, service_role;
DROP POLICY IF EXISTS profiles_read_own_or_admin ON public.profiles;
CREATE POLICY profiles_read_own_or_admin ON public.profiles
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.has_role((SELECT auth.uid()), 'admin')
  );

-- Audit rows contain snapshots of transcripts, blocks and video metadata.
-- Keep the audit screen available to administrators without leaking those
-- snapshots to anonymous visitors or unrelated members.
DO $$
DECLARE
  exposed_policy record;
BEGIN
  FOR exposed_policy IN
    SELECT policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'audit_trail'
       AND cmd IN ('SELECT', 'ALL')
       AND EXISTS (
         SELECT 1
           FROM unnest(roles) AS granted_role(role_name)
          WHERE granted_role.role_name::text IN ('public', 'anon')
       )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.audit_trail', exposed_policy.policyname);
  END LOOP;
END
$$;
REVOKE SELECT ON TABLE public.audit_trail FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.audit_trail TO authenticated, service_role;
DROP POLICY IF EXISTS audit_trail_read_admin ON public.audit_trail;
CREATE POLICY audit_trail_read_admin ON public.audit_trail
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));

-- Reprocessing jobs expose operational errors and retry state, not DNA data.
-- They remain part of the administrator control plane.
DO $$
DECLARE
  table_name text;
  exposed_policy record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['reprocess_jobs', 'reprocess_job_items']
  LOOP
    FOR exposed_policy IN
      SELECT policyname
        FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = table_name
         AND cmd IN ('SELECT', 'ALL')
         AND EXISTS (
           SELECT 1
             FROM unnest(roles) AS granted_role(role_name)
            WHERE granted_role.role_name::text IN ('public', 'anon')
         )
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        exposed_policy.policyname,
        table_name
      );
    END LOOP;

    EXECUTE format('REVOKE SELECT ON TABLE public.%I FROM PUBLIC, anon', table_name);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated, service_role', table_name);
    EXECUTE format('DROP POLICY IF EXISTS reprocess_read_admin ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY reprocess_read_admin ON public.%I FOR SELECT TO authenticated '
      || 'USING (public.has_role((SELECT auth.uid()), ''admin''))',
      table_name
    );
  END LOOP;
END
$$;

-- Resumable uploads use library/<user-id>/<video-id>.<ext>. The old root
-- remains admin-only, so a member cannot overwrite legacy corpus objects.
DROP POLICY IF EXISTS videos_storage_member_library_insert ON storage.objects;
DROP POLICY IF EXISTS videos_storage_member_library_update ON storage.objects;
DROP POLICY IF EXISTS videos_storage_member_library_delete ON storage.objects;
CREATE POLICY videos_storage_member_library_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'videos'
    AND (storage.foldername(name))[1] = 'library'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  );
CREATE POLICY videos_storage_member_library_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'videos'
    AND (storage.foldername(name))[1] = 'library'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'videos'
    AND (storage.foldername(name))[1] = 'library'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  );
CREATE POLICY videos_storage_member_library_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'videos'
    AND (storage.foldername(name))[1] = 'library'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  );

COMMENT ON COLUMN public.videos.created_by IS
  'Owner of a user-ingested Viral Base video; NULL means legacy/admin-owned shared corpus.';
COMMENT ON COLUMN public.videos.approved_for_global IS
  'Only approved videos participate in the shared Base Global; personal presets may use the owner private videos.';
COMMENT ON COLUMN public.dataset_cohort.created_by IS
  'Owner of a personal DNA preset; NULL means a legacy shared preset.';

-- Fail the migration instead of silently retaining an anonymous read path to
-- user-owned corpus data through a historical policy or grant.
DO $$
DECLARE
  protected_tables constant text[] := ARRAY[
    'audit_trail',
    'block_phrase_patterns',
    'block_semantic_patterns',
    'block_verbal_analysis',
    'block_word_patterns',
    'cta_deep_analysis',
    'cta_profiles',
    'data_consistency_reports',
    'dataset_cohort',
    'dataset_cohort_videos',
    'extraction_logs',
    'narrative_judge_results',
    'outlier_detection',
    'processing_queue',
    'profiles',
    'reprocess_job_items',
    'reprocess_jobs',
    'semantic_patterns',
    'text_image_compatibility',
    'text_visual_alignment',
    'validation_reports',
    'verbal_canonical_units',
    'verbal_noise_archive',
    'video_blocks',
    'video_cta_events',
    'video_frames',
    'video_languages',
    'video_logs',
    'video_metadata',
    'video_micro_events',
    'video_scripts',
    'video_temporal_profile',
    'video_transcripts',
    'videos',
    'viral_word_combinations',
    'visual_block_analysis',
    'visual_emotion_sequence'
  ];
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_policies AS policy
     WHERE policy.schemaname = 'public'
       AND policy.tablename = ANY(protected_tables)
       AND policy.cmd IN ('SELECT', 'ALL')
       AND EXISTS (
         SELECT 1
           FROM unnest(policy.roles) AS granted_role(role_name)
          WHERE granted_role.role_name::text IN ('public', 'anon')
       )
  ) THEN
    RAISE EXCEPTION 'Authenticated Viral Base migration left an anonymous SELECT policy';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM information_schema.table_privileges AS privilege
     WHERE privilege.table_schema = 'public'
       AND privilege.table_name = ANY(protected_tables)
       AND privilege.privilege_type = 'SELECT'
       AND lower(privilege.grantee) IN ('public', 'anon')
  ) THEN
    RAISE EXCEPTION 'Authenticated Viral Base migration left an anonymous SELECT grant';
  END IF;
END
$$;
