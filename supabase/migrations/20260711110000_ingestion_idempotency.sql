-- Canonicalize queue and metadata rows before adding retry-safe uniqueness.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY video_id
    ORDER BY created_at DESC, id DESC
  ) AS position
  FROM public.processing_queue
)
DELETE FROM public.processing_queue queue
USING ranked
WHERE queue.id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_processing_queue_video_id
  ON public.processing_queue(video_id);

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY video_id, chave
    ORDER BY created_at DESC, id DESC
  ) AS position
  FROM public.video_metadata
)
DELETE FROM public.video_metadata metadata
USING ranked
WHERE metadata.id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_video_metadata_video_key
  ON public.video_metadata(video_id, chave);

-- Prevent two rapid submissions of the same external source from creating
-- separate library records. Other metadata values may repeat normally.
-- Older app versions could already have put the same source key on different
-- videos, so retain the newest key and remove only the duplicate markers
-- before creating the cross-video unique index.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY chave, valor
    ORDER BY created_at DESC, id DESC
  ) AS position
  FROM public.video_metadata
  WHERE chave = 'source_idempotency_key' AND valor IS NOT NULL
)
DELETE FROM public.video_metadata metadata
USING ranked
WHERE metadata.id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_video_metadata_source_idempotency
  ON public.video_metadata(chave, valor)
  WHERE chave = 'source_idempotency_key' AND valor IS NOT NULL;

COMMENT ON INDEX public.uq_processing_queue_video_id IS
  'One durable state-machine row per video; required for atomic queue claims.';

COMMENT ON INDEX public.uq_video_metadata_video_key IS
  'video_metadata is a key/value map, not an append-only event stream.';
