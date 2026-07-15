-- One durable lease prevents duplicate 300 MB Gemini uploads. The commit RPC
-- replaces every derived multimodal row inside one PostgreSQL transaction, so
-- a failed insert leaves the previously valid analysis untouched.

CREATE OR REPLACE FUNCTION public.claim_video_multimodal_analysis(
  _video_id uuid,
  _claim_token uuid,
  _lease_seconds integer DEFAULT 480
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _acquired boolean;
  _bounded_lease integer := greatest(60, least(coalesce(_lease_seconds, 480), 900));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.videos WHERE id = _video_id) THEN
    RAISE EXCEPTION 'VIDEO_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.video_metadata (video_id, chave, valor, created_at)
  VALUES (_video_id, 'multimodal_processing_claim', _claim_token::text, clock_timestamp())
  ON CONFLICT (video_id, chave) DO UPDATE
  SET valor = EXCLUDED.valor,
      created_at = EXCLUDED.created_at
  WHERE public.video_metadata.valor = _claim_token::text
     OR public.video_metadata.created_at <= clock_timestamp() - make_interval(secs => _bounded_lease)
  RETURNING true INTO _acquired;

  RETURN coalesce(_acquired, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_video_multimodal_analysis_claim(
  _video_id uuid,
  _claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _deleted integer;
BEGIN
  DELETE FROM public.video_metadata
  WHERE video_id = _video_id
    AND chave = 'multimodal_processing_claim'
    AND valor = _claim_token::text;
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_video_multimodal_analysis(
  _video_id uuid,
  _claim_token uuid,
  _transcripts jsonb,
  _frames jsonb,
  _visual_analysis jsonb,
  _language text,
  _duration numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _segments_count integer;
  _frames_count integer;
BEGIN
  IF jsonb_typeof(_transcripts) <> 'array' OR jsonb_array_length(_transcripts) = 0 THEN
    RAISE EXCEPTION 'MULTIMODAL_TRANSCRIPTS_EMPTY' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(_frames) <> 'array' OR jsonb_array_length(_frames) < 3 THEN
    RAISE EXCEPTION 'MULTIMODAL_FRAMES_INSUFFICIENT' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(_visual_analysis) <> 'array' OR jsonb_array_length(_visual_analysis) < 3 THEN
    RAISE EXCEPTION 'MULTIMODAL_VISUAL_ANALYSIS_INSUFFICIENT' USING ERRCODE = '22023';
  END IF;
  IF _duration IS NULL OR _duration <= 0 OR _duration > 3600 THEN
    RAISE EXCEPTION 'MULTIMODAL_DURATION_INVALID' USING ERRCODE = '22023';
  END IF;
  IF _language IS NULL OR _language !~ '^[a-z]{2,3}$' THEN
    RAISE EXCEPTION 'MULTIMODAL_LANGUAGE_INVALID' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.videos WHERE id = _video_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VIDEO_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.video_metadata
  WHERE video_id = _video_id
    AND chave = 'multimodal_processing_claim'
    AND valor = _claim_token::text
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MULTIMODAL_CLAIM_LOST' USING ERRCODE = '55000';
  END IF;

  -- Validate converted records before any destructive statement. Any cast or
  -- invariant failure aborts before old rows are touched.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(_transcripts) AS item(
      tempo_inicio numeric,
      tempo_fim numeric,
      duracao numeric,
      texto text,
      language_code text
    )
    WHERE tempo_inicio IS NULL OR tempo_fim IS NULL OR duracao IS NULL
       OR tempo_inicio < 0 OR tempo_fim <= tempo_inicio OR duracao <= 0
       OR texto IS NULL OR btrim(texto) = ''
       OR language_code IS NULL OR language_code !~ '^[a-z]{2,3}$'
  ) THEN
    RAISE EXCEPTION 'MULTIMODAL_TRANSCRIPT_RECORD_INVALID' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(_frames) AS item(
      frame_number integer,
      timestamp_seconds numeric,
      file_path text,
      frame_hash text,
      frame_role text,
      source_method text,
      scene_change_flag boolean,
      visual_intensity_score integer
    )
    WHERE frame_number IS NULL OR frame_number <= 0
       OR timestamp_seconds IS NULL OR timestamp_seconds < 0
       OR frame_hash IS NULL OR btrim(frame_hash) = ''
       OR visual_intensity_score IS NULL
       OR visual_intensity_score < 0 OR visual_intensity_score > 100
  ) THEN
    RAISE EXCEPTION 'MULTIMODAL_FRAME_RECORD_INVALID' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.video_transcripts WHERE video_id = _video_id;
  INSERT INTO public.video_transcripts (
    video_id, tempo_inicio, tempo_fim, duracao, texto, language_code
  )
  SELECT
    _video_id, item.tempo_inicio, item.tempo_fim, item.duracao, item.texto, item.language_code
  FROM jsonb_to_recordset(_transcripts) AS item(
    tempo_inicio numeric,
    tempo_fim numeric,
    duracao numeric,
    texto text,
    language_code text
  );
  GET DIAGNOSTICS _segments_count = ROW_COUNT;

  DELETE FROM public.video_frames
  WHERE video_id = _video_id AND source_method = 'gemini_video_understanding';
  INSERT INTO public.video_frames (
    video_id,
    frame_number,
    timestamp_seconds,
    file_path,
    frame_hash,
    frame_role,
    source_method,
    scene_change_flag,
    visual_intensity_score
  )
  SELECT
    _video_id,
    item.frame_number,
    item.timestamp_seconds,
    item.file_path,
    item.frame_hash,
    item.frame_role,
    'gemini_video_understanding',
    item.scene_change_flag,
    item.visual_intensity_score
  FROM jsonb_to_recordset(_frames) AS item(
    frame_number integer,
    timestamp_seconds numeric,
    file_path text,
    frame_hash text,
    frame_role text,
    source_method text,
    scene_change_flag boolean,
    visual_intensity_score integer
  );
  GET DIAGNOSTICS _frames_count = ROW_COUNT;

  INSERT INTO public.video_metadata (video_id, chave, valor)
  VALUES (_video_id, 'multimodal_visual_analysis', _visual_analysis::text)
  ON CONFLICT (video_id, chave) DO UPDATE
  SET valor = EXCLUDED.valor,
      created_at = clock_timestamp();

  UPDATE public.videos
  SET idioma = _language,
      duracao = _duration,
      numero_frames = _frames_count
  WHERE id = _video_id;

  DELETE FROM public.video_metadata
  WHERE video_id = _video_id
    AND chave = 'multimodal_processing_claim'
    AND valor = _claim_token::text;

  RETURN jsonb_build_object(
    'segments_count', _segments_count,
    'visual_moments', _frames_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_video_multimodal_analysis(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_video_multimodal_analysis_claim(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_video_multimodal_analysis(uuid, uuid, jsonb, jsonb, jsonb, text, numeric)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_video_multimodal_analysis(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_video_multimodal_analysis_claim(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_video_multimodal_analysis(uuid, uuid, jsonb, jsonb, jsonb, text, numeric) TO service_role;

COMMENT ON FUNCTION public.claim_video_multimodal_analysis(uuid, uuid, integer) IS
  'Atomically acquires or renews the bounded lease for one video multimodal analysis.';
COMMENT ON FUNCTION public.commit_video_multimodal_analysis(uuid, uuid, jsonb, jsonb, jsonb, text, numeric) IS
  'Atomically replaces validated Gemini transcript, visual frames, metadata and video summary while holding the matching claim.';
