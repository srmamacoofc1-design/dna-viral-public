-- Repairs the exact 16 stale Gemini transcript timelines from the original
-- Portuguese YouTube caption track, then invokes the existing exact-speech
-- rebind inside the same PostgreSQL transaction.  The caller cannot use this
-- path for any other video and cannot submit a title as spoken evidence.

CREATE OR REPLACE FUNCTION public._repair_viral_source_caption_and_rebind_payload(
  _payload jsonb,
  _payload_sha256 text,
  _audit_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  _allowed_ids constant text[] := ARRAY[
    '5ClZjsEO2mA','I-n6aSD0GxU','xvA4RIDpCjI','Hk9tKIR3LIc',
    '3gnSj4i4ZUs','2uVOpKc1KF0','zmzfzxB89GY','IWyvjlTq1Gk',
    'y410EEYFjUw','H3OeoDbO_l8','tbmMTbZ5kmE','-lf6Rb445nQ',
    'GkKHT1qjXGc','ExLIjbDfcOQ','L5dXJXpKNQA','lMhyllrR880'
  ];
  _claim_role text := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
  _youtube_id text := _payload ->> 'youtube_id';
  _video_ids uuid[];
  _video_id uuid;
  _duration numeric;
  _transcript_count integer;
  _rebind jsonb := _payload -> 'rebind';
  _result jsonb;
BEGIN
  IF _claim_role <> 'service_role' AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_payload) IS DISTINCT FROM 'object'
     OR _payload ->> 'schema_version' IS DISTINCT FROM '1'
     OR _payload ->> 'engine' IS DISTINCT FROM 'source_caption_spoken_rebind_v1'
     OR _youtube_id IS NULL
     OR NOT (_youtube_id = ANY (_allowed_ids))
     OR COALESCE(_payload ->> 'caption_sha256', '') !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(_payload -> 'transcripts') IS DISTINCT FROM 'array'
     OR jsonb_typeof(_rebind) IS DISTINCT FROM 'object'
     OR _rebind ->> 'engine' IS DISTINCT FROM 'spoken_dna_rebind_v1'
     OR _rebind ->> 'youtube_id' IS DISTINCT FROM _youtube_id
     OR COALESCE(_payload_sha256, '') !~ '^[0-9a-f]{64}$'
     OR COALESCE(_audit_sha256, '') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'SOURCE_CAPTION_REBIND_PAYLOAD_INVALID:%', COALESCE(_youtube_id, '?')
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT metadata.video_id)
    INTO _video_ids
    FROM public.video_metadata AS metadata
   WHERE (metadata.chave = 'youtube_id' AND metadata.valor = _youtube_id)
      OR (metadata.chave = 'source_idempotency_key' AND metadata.valor = 'youtube:' || _youtube_id);
  IF COALESCE(cardinality(_video_ids), 0) <> 1 THEN
    RAISE EXCEPTION 'SOURCE_CAPTION_REBIND_VIDEO_LOOKUP_NOT_UNIQUE:%', _youtube_id USING ERRCODE = 'P0002';
  END IF;
  _video_id := _video_ids[1];

  PERFORM 1 FROM public.videos WHERE id = _video_id FOR UPDATE;
  IF NOT FOUND OR _payload ->> 'video_id' IS DISTINCT FROM _video_id::text
     OR _rebind ->> 'video_id' IS DISTINCT FROM _video_id::text THEN
    RAISE EXCEPTION 'SOURCE_CAPTION_REBIND_VIDEO_ID_MISMATCH:%', _youtube_id USING ERRCODE = '22023';
  END IF;
  _duration := NULLIF(_payload ->> 'duration_seconds', '')::numeric;
  IF _duration IS NULL OR _duration <= 0 OR _duration > 600
     OR NULLIF(_rebind ->> 'duration_seconds', '')::numeric IS DISTINCT FROM _duration THEN
    RAISE EXCEPTION 'SOURCE_CAPTION_REBIND_DURATION_INVALID:%', _youtube_id USING ERRCODE = '22023';
  END IF;
  _transcript_count := jsonb_array_length(_payload -> 'transcripts');
  IF _transcript_count < 3 OR _transcript_count > 240 THEN
    RAISE EXCEPTION 'SOURCE_CAPTION_REBIND_TRANSCRIPT_COUNT_INVALID:%', _youtube_id USING ERRCODE = '22023';
  END IF;

  -- These are the only permissible transcript records.  `texto` comes from
  -- the downloaded pt-orig caption artifact; publication title is absent.
  IF EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(_payload -> 'transcripts') AS item(
        id uuid, tempo_inicio numeric, tempo_fim numeric, duracao numeric,
        texto text, language_code text
      )
     WHERE id IS NULL OR tempo_inicio IS NULL OR tempo_fim IS NULL OR duracao IS NULL
        OR tempo_inicio < 0 OR tempo_fim <= tempo_inicio OR duracao <= 0
        OR abs(duracao - (tempo_fim - tempo_inicio)) > 0.01
        OR tempo_fim > _duration + GREATEST(0.5, _duration * 0.01)
        OR texto IS NULL OR btrim(texto) = ''
        OR language_code IS DISTINCT FROM 'pt'
  ) OR (
    SELECT count(DISTINCT item.id)
      FROM jsonb_to_recordset(_payload -> 'transcripts') AS item(
        id uuid, tempo_inicio numeric, tempo_fim numeric, duracao numeric,
        texto text, language_code text
      )
  ) <> _transcript_count THEN
    RAISE EXCEPTION 'SOURCE_CAPTION_REBIND_TRANSCRIPT_SCHEMA_INVALID:%', _youtube_id USING ERRCODE = '22023';
  END IF;

  IF NOT (
    WITH intervals AS (
      SELECT id, tempo_inicio, tempo_fim
        FROM jsonb_to_recordset(_payload -> 'transcripts') AS item(
          id uuid, tempo_inicio numeric, tempo_fim numeric, duracao numeric,
          texto text, language_code text
        )
       ORDER BY tempo_inicio, tempo_fim, id
    ), ordered AS (
      SELECT *, lag(tempo_fim) OVER (ORDER BY tempo_inicio, tempo_fim) AS previous_end
        FROM intervals
    ), spans AS (
      SELECT tempo_inicio, tempo_fim,
             sum(CASE WHEN previous_end IS NULL OR tempo_inicio > previous_end THEN 1 ELSE 0 END)
               OVER (ORDER BY tempo_inicio, tempo_fim) AS group_no
        FROM ordered
    ), merged AS (
      SELECT group_no, min(tempo_inicio) AS start_at, max(tempo_fim) AS end_at
        FROM spans GROUP BY group_no
    )
    SELECT min(start_at) <= GREATEST(2, _duration * 0.1)
       AND COALESCE(sum(end_at - start_at), 0) / _duration >= 0.7
       AND max(end_at) >= _duration * 0.9
      FROM merged
  ) THEN
    RAISE EXCEPTION 'SOURCE_CAPTION_REBIND_TIMELINE_INCOMPLETE:%', _youtube_id USING ERRCODE = '23514';
  END IF;

  -- The source-caption payload and the rebind payload must reference exactly
  -- the same deterministic rows before anything destructive happens.
  IF (SELECT count(*) FROM jsonb_array_elements(_rebind -> 'blocks')) < 3
     OR EXISTS (
       SELECT 1
         FROM jsonb_array_elements(_rebind -> 'blocks') AS block(value)
         CROSS JOIN LATERAL jsonb_array_elements_text(block.value -> 'transcript_segment_ids') AS ref(value)
         LEFT JOIN jsonb_to_recordset(_payload -> 'transcripts') AS transcript(
           id uuid, tempo_inicio numeric, tempo_fim numeric, duracao numeric,
           texto text, language_code text
         ) ON transcript.id::text = ref.value
        WHERE transcript.id IS NULL
     )
     OR (SELECT count(*)
           FROM jsonb_array_elements(_rebind -> 'blocks') AS block(value)
           CROSS JOIN LATERAL jsonb_array_elements_text(block.value -> 'transcript_segment_ids')) <> _transcript_count
     OR (SELECT count(DISTINCT ref.value)
           FROM jsonb_array_elements(_rebind -> 'blocks') AS block(value)
           CROSS JOIN LATERAL jsonb_array_elements_text(block.value -> 'transcript_segment_ids') AS ref(value)) <> _transcript_count THEN
    RAISE EXCEPTION 'SOURCE_CAPTION_REBIND_TRANSCRIPT_REFERENCE_INVALID:%', _youtube_id USING ERRCODE = '22023';
  END IF;

  -- `_commit_viral_spoken_dna_rebind_payload` validates all block text,
  -- semantic layers and temporal visual evidence.  It reads `videos.duracao`,
  -- so make the independently downloaded media duration authoritative first.
  UPDATE public.videos
     SET duracao = _duration, idioma = 'pt', status = 'processing'
   WHERE id = _video_id;
  DELETE FROM public.video_transcripts WHERE video_id = _video_id;
  INSERT INTO public.video_transcripts (
    id, video_id, tempo_inicio, tempo_fim, duracao, texto, language_code
  )
  SELECT item.id, _video_id, item.tempo_inicio, item.tempo_fim,
         item.duracao, item.texto, item.language_code
    FROM jsonb_to_recordset(_payload -> 'transcripts') AS item(
      id uuid, tempo_inicio numeric, tempo_fim numeric, duracao numeric,
      texto text, language_code text
    );

  _result := public._commit_viral_spoken_dna_rebind_payload(
    _rebind, _payload_sha256, _audit_sha256
  );
  IF NOT public._viral_spoken_dna_is_valid(_video_id) THEN
    RAISE EXCEPTION 'SOURCE_CAPTION_REBIND_POSTCONDITION_FAILED:%', _youtube_id USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.video_metadata (video_id, chave, valor)
  VALUES (
    _video_id, 'source_caption_spoken_rebind_v1',
    jsonb_build_object(
      'youtube_id', _youtube_id,
      'caption_sha256', _payload ->> 'caption_sha256',
      'caption_language', 'pt-orig',
      'duration_seconds', _duration,
      'payload_sha256', _payload_sha256,
      'audit_sha256', _audit_sha256,
      'committed_at', clock_timestamp()
    )::text
  ) ON CONFLICT (video_id, chave) DO UPDATE
    SET valor = EXCLUDED.valor, created_at = clock_timestamp();

  INSERT INTO public.video_logs (video_id, etapa, status, mensagem)
  VALUES (
    _video_id, 'Source caption spoken DNA repair', 'success',
    format('Replaced %s stale transcript rows with original pt-orig captions; payload=%s',
      _transcript_count, _payload_sha256)
  );
  RETURN _result || jsonb_build_object(
    'source_caption_repair', true,
    'caption_sha256', _payload ->> 'caption_sha256',
    'caption_segments', _transcript_count
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.repair_viral_source_captions_and_rebind_atomic(
  _payloads jsonb,
  _payload_sha256 text,
  _audit_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  _expected_ids constant text[] := ARRAY[
    '5ClZjsEO2mA','I-n6aSD0GxU','xvA4RIDpCjI','Hk9tKIR3LIc',
    '3gnSj4i4ZUs','2uVOpKc1KF0','zmzfzxB89GY','IWyvjlTq1Gk',
    'y410EEYFjUw','H3OeoDbO_l8','tbmMTbZ5kmE','-lf6Rb445nQ',
    'GkKHT1qjXGc','ExLIjbDfcOQ','L5dXJXpKNQA','lMhyllrR880'
  ];
  _claim_role text := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
  _youtube_id text;
  _payload jsonb;
  _results jsonb := '[]'::jsonb;
BEGIN
  IF _claim_role <> 'service_role' AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_payloads) IS DISTINCT FROM 'array'
     OR jsonb_array_length(_payloads) <> cardinality(_expected_ids)
     OR COALESCE(_payload_sha256, '') !~ '^[0-9a-f]{64}$'
     OR COALESCE(_audit_sha256, '') !~ '^[0-9a-f]{64}$'
     OR (SELECT count(DISTINCT value ->> 'youtube_id') FROM jsonb_array_elements(_payloads)) <> cardinality(_expected_ids)
     OR EXISTS (
       SELECT expected_id FROM unnest(_expected_ids) AS expected(expected_id)
       EXCEPT SELECT value ->> 'youtube_id' FROM jsonb_array_elements(_payloads)
     ) OR EXISTS (
       SELECT value ->> 'youtube_id' FROM jsonb_array_elements(_payloads)
       EXCEPT SELECT expected_id FROM unnest(_expected_ids) AS expected(expected_id)
     ) THEN
    RAISE EXCEPTION 'SOURCE_CAPTION_REBIND_BATCH_INVALID' USING ERRCODE = '22023';
  END IF;

  FOREACH _youtube_id IN ARRAY _expected_ids LOOP
    SELECT value INTO _payload
      FROM jsonb_array_elements(_payloads) AS item(value)
     WHERE value ->> 'youtube_id' = _youtube_id;
    _results := _results || jsonb_build_array(
      public._repair_viral_source_caption_and_rebind_payload(
        _payload, _payload_sha256, _audit_sha256
      )
    );
  END LOOP;
  RETURN jsonb_build_object(
    'atomic', true,
    'count', cardinality(_expected_ids),
    'payload_sha256', _payload_sha256,
    'audit_sha256', _audit_sha256,
    'results', _results
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._repair_viral_source_caption_and_rebind_payload(jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._repair_viral_source_caption_and_rebind_payload(jsonb, text, text) FROM anon;
REVOKE ALL ON FUNCTION public._repair_viral_source_caption_and_rebind_payload(jsonb, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.repair_viral_source_captions_and_rebind_atomic(jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.repair_viral_source_captions_and_rebind_atomic(jsonb, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.repair_viral_source_captions_and_rebind_atomic(jsonb, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.repair_viral_source_captions_and_rebind_atomic(jsonb, text, text) TO service_role;
