-- Ledger and lease-based worker for moving pre-private-bucket generation
-- references out of the public viral-library bucket. Storage bytes are copied
-- by the admin Edge Function; SQL only records durable, auditable state.

CREATE TABLE IF NOT EXISTS public.reference_video_storage_migrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_video_id uuid NOT NULL UNIQUE
    REFERENCES public.reference_videos(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_bucket text NOT NULL DEFAULT 'videos'
    CHECK (source_bucket = 'videos'),
  source_path text NOT NULL,
  destination_bucket text NOT NULL DEFAULT 'reference-videos'
    CHECK (destination_bucket = 'reference-videos'),
  destination_path text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'copying',
      'copied_verified',
      'completed',
      'source_retained',
      'failed'
    )),
  verification_method text,
  source_size_bytes bigint,
  destination_size_bytes bigint,
  source_removed boolean NOT NULL DEFAULT false,
  source_retained_reason text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  lease_owner uuid,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reference_video_storage_migrations_claim
  ON public.reference_video_storage_migrations (status, lease_expires_at, created_at);

DROP TRIGGER IF EXISTS update_reference_video_storage_migrations_updated_at
  ON public.reference_video_storage_migrations;
CREATE TRIGGER update_reference_video_storage_migrations_updated_at
  BEFORE UPDATE ON public.reference_video_storage_migrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.reference_video_storage_migrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reference_video_storage_migrations_admin_read"
  ON public.reference_video_storage_migrations;
CREATE POLICY "reference_video_storage_migrations_admin_read"
  ON public.reference_video_storage_migrations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Browser clients may audit this table only when they are admins. Mutation is
-- service-role-only so a client cannot forge a successful migration record.
REVOKE ALL ON public.reference_video_storage_migrations FROM anon, authenticated;
GRANT SELECT ON public.reference_video_storage_migrations TO authenticated;
GRANT ALL ON public.reference_video_storage_migrations TO service_role;

WITH legacy_rows AS (
  SELECT
    rv.id,
    rv.user_id,
    rv.storage_path,
    CASE
      WHEN lower(rv.storage_path) ~ '\.(mp4|mov|webm|avi|mpeg|mpg|m4v|3gp)$'
        THEN lower(substring(rv.storage_path FROM '\.([^.]+)$'))
      ELSE 'mp4'
    END AS extension
  FROM public.reference_videos rv
  WHERE rv.storage_bucket = 'videos'
    AND rv.storage_path IS NOT NULL
    AND btrim(rv.storage_path) <> ''
)
INSERT INTO public.reference_video_storage_migrations (
  reference_video_id,
  owner_user_id,
  source_bucket,
  source_path,
  destination_bucket,
  destination_path
)
SELECT
  legacy.id,
  legacy.user_id,
  'videos',
  legacy.storage_path,
  'reference-videos',
  'reference/' || COALESCE(legacy.user_id::text, 'unowned')
    || '/legacy/' || legacy.id::text || '.' || legacy.extension
FROM legacy_rows legacy
ON CONFLICT (reference_video_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.claim_reference_video_storage_migrations(
  _worker_id uuid,
  _limit integer DEFAULT 10,
  _lease_seconds integer DEFAULT 300,
  _include_source_retained boolean DEFAULT false
)
RETURNS SETOF public.reference_video_storage_migrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _worker_id IS NULL THEN
    RAISE EXCEPTION 'worker_id is required';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT migration.id
    FROM public.reference_video_storage_migrations migration
    WHERE (
      migration.status IN ('pending', 'failed', 'copied_verified')
      OR (_include_source_retained AND migration.status = 'source_retained')
      OR (
        migration.status = 'copying'
        AND migration.lease_expires_at IS NOT NULL
        AND migration.lease_expires_at <= now()
      )
    )
      AND (migration.lease_expires_at IS NULL OR migration.lease_expires_at <= now())
    ORDER BY migration.created_at, migration.id
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(COALESCE(_limit, 10), 50))
  ), claimed AS (
    UPDATE public.reference_video_storage_migrations migration
    SET
      status = 'copying',
      lease_owner = _worker_id,
      lease_expires_at = now()
        + make_interval(secs => greatest(60, least(COALESCE(_lease_seconds, 300), 1800))),
      attempt_count = migration.attempt_count + 1,
      last_error = NULL,
      started_at = COALESCE(migration.started_at, now()),
      completed_at = NULL
    FROM candidates
    WHERE migration.id = candidates.id
    RETURNING migration.*
  )
  SELECT * FROM claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_reference_video_storage_migrations(uuid, integer, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reference_video_storage_migrations(uuid, integer, integer, boolean)
  TO service_role;

COMMENT ON TABLE public.reference_video_storage_migrations IS
  'Auditable ledger for server-side copy, verification, row swap, and safe cleanup of legacy generation-reference objects.';
COMMENT ON FUNCTION public.claim_reference_video_storage_migrations(uuid, integer, integer, boolean) IS
  'Atomically leases legacy reference migration jobs to the service-role Edge worker.';
