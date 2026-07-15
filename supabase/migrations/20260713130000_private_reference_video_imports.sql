-- Generation references contain user-provided media and must never share the
-- legacy public viral-library bucket. Keep library objects in `videos`, but
-- move every new reference to this private, ownership-scoped bucket.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reference-videos',
  'reference-videos',
  false,
  314572800,
  ARRAY[
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-msvideo',
    'video/mpeg',
    'video/3gpp',
    'video/x-m4v',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "reference_videos_storage_select_own" ON storage.objects;
DROP POLICY IF EXISTS "reference_videos_storage_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "reference_videos_storage_update_own" ON storage.objects;
DROP POLICY IF EXISTS "reference_videos_storage_delete_own" ON storage.objects;

CREATE POLICY "reference_videos_storage_select_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'reference-videos'
    AND (storage.foldername(name))[1] = 'reference'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "reference_videos_storage_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'reference-videos'
    AND (storage.foldername(name))[1] = 'reference'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND COALESCE((storage.foldername(name))[3], '') <> 'legacy'
  );

CREATE POLICY "reference_videos_storage_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'reference-videos'
    AND (storage.foldername(name))[1] = 'reference'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND COALESCE((storage.foldername(name))[3], '') <> 'legacy'
  )
  WITH CHECK (
    bucket_id = 'reference-videos'
    AND (storage.foldername(name))[1] = 'reference'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND COALESCE((storage.foldername(name))[3], '') <> 'legacy'
  );

CREATE POLICY "reference_videos_storage_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'reference-videos'
    AND (storage.foldername(name))[1] = 'reference'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND COALESCE((storage.foldername(name))[3], '') <> 'legacy'
  );

-- Remove the member exception from the public bucket. Only administrators may
-- mutate the viral-library bucket after this migration.
DROP POLICY IF EXISTS "videos_storage_authenticated_insert" ON storage.objects;
DROP POLICY IF EXISTS "videos_storage_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "videos_storage_authenticated_delete" ON storage.objects;

CREATE POLICY "videos_storage_authenticated_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'videos' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "videos_storage_authenticated_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'videos' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'videos' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "videos_storage_authenticated_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'videos' AND public.has_role(auth.uid(), 'admin'));

-- Stable per-user source identity makes retries/reloads converge on the same
-- reference row without ever entering public.videos or the DNA corpus.
ALTER TABLE public.reference_videos
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS source_idempotency_key text,
  ADD COLUMN IF NOT EXISTS storage_bucket text;

-- Every pre-migration reference lived in the legacy bucket. This is the only
-- fallback path; all newly inserted references default to the private bucket.
UPDATE public.reference_videos
SET storage_bucket = 'videos'
WHERE storage_bucket IS NULL;

ALTER TABLE public.reference_videos
  ALTER COLUMN storage_bucket SET NOT NULL,
  ALTER COLUMN storage_bucket SET DEFAULT 'reference-videos';

ALTER TABLE public.reference_videos
  DROP CONSTRAINT IF EXISTS reference_videos_storage_bucket_allowed;
ALTER TABLE public.reference_videos
  ADD CONSTRAINT reference_videos_storage_bucket_allowed
  CHECK (storage_bucket IN ('videos', 'reference-videos'));

CREATE UNIQUE INDEX IF NOT EXISTS reference_videos_user_source_unique
  ON public.reference_videos (user_id, source_idempotency_key)
  WHERE user_id IS NOT NULL AND source_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS reference_videos_user_storage_unique
  ON public.reference_videos (user_id, storage_bucket, storage_path)
  WHERE user_id IS NOT NULL AND storage_path IS NOT NULL;

-- Reassert the complete table policy set in the same migration. This removes
-- every permissive policy name used by prior versions, including the original
-- FOR ALL policy and the legacy SELECT that exposed rows with NULL owners.
ALTER TABLE public.reference_videos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public all reference_videos" ON public.reference_videos;
DROP POLICY IF EXISTS "Members insert own reference_videos" ON public.reference_videos;
DROP POLICY IF EXISTS "Members see own reference_videos" ON public.reference_videos;
DROP POLICY IF EXISTS "Members update own reference_videos" ON public.reference_videos;
DROP POLICY IF EXISTS "Members delete own reference_videos" ON public.reference_videos;
DROP POLICY IF EXISTS "rv_select_own_or_admin" ON public.reference_videos;
DROP POLICY IF EXISTS "rv_insert_own_or_admin" ON public.reference_videos;
DROP POLICY IF EXISTS "rv_update_own_or_admin" ON public.reference_videos;
DROP POLICY IF EXISTS "rv_delete_admin_only" ON public.reference_videos;
DROP POLICY IF EXISTS "rv_delete_own_or_admin" ON public.reference_videos;

CREATE POLICY "rv_select_own_or_admin" ON public.reference_videos
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "rv_insert_own_or_admin" ON public.reference_videos
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "rv_update_own_or_admin" ON public.reference_videos
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "rv_delete_own_or_admin" ON public.reference_videos
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
