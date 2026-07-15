-- Refreshes only the derived spoken-DNA layers for the 18 videos whose
-- existing block boundaries and transcript text are already exact.  This is
-- deliberately separate from the 16-video rebind path: it never changes a
-- transcript, visual evidence, frame, or narrative block.
--
-- The public wrapper accepts one exact allowlisted cohort and calls the
-- per-video helper in a single PostgreSQL transaction.  Any validation
-- failure aborts all 18 updates.

CREATE OR REPLACE FUNCTION public._refresh_viral_spoken_layers_payload(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  _allowed_ids constant text[] := ARRAY[
    'OlYMSfYlBFo','eXs-hEK1qPg','nFfKqQBRC8g','raP3axYfubU',
    'Ay-E-FByxyU','8B0OfDDWqNs','PzYV3aq2QYM','jPoq9QTxMDc',
    '8zb89g-AUEY','bDP1EALyXik','NatewOBrinA','bnLlnciv04c',
    'qgBrw-CjvGI','JGxFwABwiWo','f1VkuYAF2mM','EakSssIZ3nQ',
    '7oiC-4hc-dI','raB_88YjQbk'
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
  _stored_duration numeric;
  _block_count integer;
  _transcript_count integer;
  _block jsonb;
  _block_id uuid;
  _keyword text;
  _phrase text;
  _word_blocks integer;
  _phrase_blocks integer;
  _semantic_blocks integer;
  _verbal_blocks integer;
  _last_payoff jsonb;
BEGIN
  IF _claim_role <> 'service_role' AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_payload) IS DISTINCT FROM 'object'
     OR _payload ->> 'schema_version' IS DISTINCT FROM '1'
     OR _payload ->> 'engine' IS DISTINCT FROM 'spoken_dna_layer_refresh_v1'
     OR _youtube_id IS NULL
     OR NOT (_youtube_id = ANY (_allowed_ids))
     OR COALESCE(_payload ->> 'transcript_sha256', '') !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(_payload -> 'blocks') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'SPOKEN_DNA_LAYER_REFRESH_PAYLOAD_INVALID:%', COALESCE(_youtube_id, '?')
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT metadata.video_id)
    INTO _video_ids
    FROM public.video_metadata AS metadata
   WHERE (metadata.chave = 'youtube_id' AND metadata.valor = _youtube_id)
      OR (metadata.chave = 'source_idempotency_key' AND metadata.valor = 'youtube:' || _youtube_id);
  IF COALESCE(cardinality(_video_ids), 0) <> 1 THEN
    RAISE EXCEPTION 'SPOKEN_DNA_LAYER_REFRESH_VIDEO_LOOKUP_NOT_UNIQUE:%', _youtube_id
      USING ERRCODE = 'P0002';
  END IF;
  _video_id := _video_ids[1];

  SELECT duracao INTO _stored_duration
    FROM public.videos
   WHERE id = _video_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SPOKEN_DNA_LAYER_REFRESH_VIDEO_NOT_FOUND:%', _youtube_id USING ERRCODE = 'P0002';
  END IF;
  IF _payload ->> 'video_id' IS DISTINCT FROM _video_id::text THEN
    RAISE EXCEPTION 'SPOKEN_DNA_LAYER_REFRESH_VIDEO_ID_MISMATCH:%', _youtube_id USING ERRCODE = '22023';
  END IF;
  _duration := NULLIF(_payload ->> 'duration_seconds', '')::numeric;
  IF _duration IS NULL OR _duration <= 0 OR _duration > 600
     OR _stored_duration IS NULL
     OR abs(_duration - _stored_duration) > GREATEST(0.05, _stored_duration * 0.001) THEN
    RAISE EXCEPTION 'SPOKEN_DNA_LAYER_REFRESH_DURATION_MISMATCH:%', _youtube_id USING ERRCODE = '22023';
  END IF;

  _block_count := jsonb_array_length(_payload -> 'blocks');
  SELECT count(*) INTO _transcript_count
    FROM public.video_transcripts
   WHERE video_id = _video_id;
  IF _block_count < 3 OR _block_count > 18 OR _transcript_count < 3 THEN
    RAISE EXCEPTION 'SPOKEN_DNA_LAYER_REFRESH_COUNT_INVALID:%', _youtube_id USING ERRCODE = '22023';
  END IF;

  -- Shape validation happens before UUID/numeric casts below.  Every
  -- extraction term is later checked as contiguous real speech, not a title
  -- or an imagined description.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(_payload -> 'blocks') WITH ORDINALITY AS item(value, ordinality)
     WHERE COALESCE((value ->> 'index')::integer, -1) <> ordinality::integer
        OR COALESCE(value ->> 'type', '') NOT IN ('hook','setup','desenvolvimento','tensao','revelacao','payoff','transicao','loop')
        OR COALESCE((value ->> 'start')::numeric, -1) < 0
        OR COALESCE((value ->> 'end')::numeric, -1) <= COALESCE((value ->> 'start')::numeric, -1)
        OR COALESCE((value ->> 'end')::numeric, _duration + 1) > _duration + GREATEST(0.5, _duration * 0.01)
        OR NULLIF(btrim(value ->> 'text'), '') IS NULL
        OR COALESCE(value ->> 'source_block_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR jsonb_typeof(value -> 'semantic') IS DISTINCT FROM 'object'
        OR jsonb_typeof(value #> '{semantic,keywords}') IS DISTINCT FROM 'array'
        OR jsonb_array_length(value #> '{semantic,keywords}') < 1
        OR jsonb_typeof(value #> '{semantic,keyword_frequencies}') IS DISTINCT FROM 'object'
        OR jsonb_typeof(value #> '{semantic,strong_phrases}') IS DISTINCT FROM 'array'
        OR jsonb_array_length(value #> '{semantic,strong_phrases}') < 1
        OR jsonb_typeof(value #> '{semantic,emotional_words}') IS DISTINCT FROM 'array'
        OR jsonb_typeof(value #> '{semantic,repeated_words}') IS DISTINCT FROM 'array'
        OR jsonb_typeof(value #> '{semantic,rare_words}') IS DISTINCT FROM 'array'
        OR jsonb_typeof(value #> '{semantic,dominant_words}') IS DISTINCT FROM 'array'
        OR jsonb_typeof(value -> 'verbal') IS DISTINCT FROM 'object'
        OR jsonb_typeof(value #> '{verbal,trigger_words}') IS DISTINCT FROM 'array'
        OR COALESCE((value #>> '{verbal,word_count}')::integer, 0) < 1
        OR COALESCE((value #>> '{verbal,phrase_count}')::integer, 0) < 1
  ) THEN
    RAISE EXCEPTION 'SPOKEN_DNA_LAYER_REFRESH_BLOCK_SCHEMA_INVALID:%', _youtube_id USING ERRCODE = '22023';
  END IF;

  -- The payload is allowed to refresh derived layers only.  It must describe
  -- the currently persisted blocks byte-for-byte (apart from trimming around
  -- text, which the client has already canonicalised), and all current blocks
  -- must appear once.
  IF (SELECT count(*) FROM public.video_blocks WHERE video_id = _video_id) <> _block_count
     OR (SELECT count(DISTINCT value ->> 'source_block_id') FROM jsonb_array_elements(_payload -> 'blocks')) <> _block_count
     OR EXISTS (
       SELECT 1
         FROM jsonb_array_elements(_payload -> 'blocks') AS item(value)
         LEFT JOIN public.video_blocks AS source
           ON source.id = (item.value ->> 'source_block_id')::uuid
          AND source.video_id = _video_id
        WHERE source.id IS NULL
           OR source.bloco_id <> (item.value ->> 'index')::integer
           OR source.tipo_bloco::text IS DISTINCT FROM item.value ->> 'type'
           OR source.tempo_inicio IS DISTINCT FROM (item.value ->> 'start')::numeric
           OR source.tempo_fim IS DISTINCT FROM (item.value ->> 'end')::numeric
           OR btrim(source.texto) IS DISTINCT FROM btrim(item.value ->> 'text')
     ) THEN
    RAISE EXCEPTION 'SPOKEN_DNA_LAYER_REFRESH_WOULD_CHANGE_BLOCK:%', _youtube_id USING ERRCODE = '22023';
  END IF;

  -- Reproduce the transcript assignment used by the audit.  A title is not
  -- involved anywhere in this validation or in the derived content.
  IF NOT (
    WITH blocks AS (
      SELECT id, bloco_id, tempo_inicio, tempo_fim, texto
        FROM public.video_blocks WHERE video_id = _video_id
    ), assigned AS (
      SELECT transcript.id AS transcript_id, transcript.texto,
             transcript.tempo_inicio, transcript.tempo_fim, chosen.id AS block_id
        FROM public.video_transcripts AS transcript
        LEFT JOIN LATERAL (
          SELECT block.id
            FROM blocks AS block
           WHERE GREATEST(0, LEAST(transcript.tempo_fim, block.tempo_fim)
              - GREATEST(transcript.tempo_inicio, block.tempo_inicio)) > 0
           ORDER BY GREATEST(0, LEAST(transcript.tempo_fim, block.tempo_fim)
              - GREATEST(transcript.tempo_inicio, block.tempo_inicio)) DESC,
                    block.bloco_id ASC, block.id ASC
           LIMIT 1
        ) AS chosen ON true
       WHERE transcript.video_id = _video_id
    ), expected AS (
      SELECT block.id AS block_id, count(assigned.transcript_id) AS segment_count,
             string_agg(btrim(assigned.texto), ' '
               ORDER BY assigned.tempo_inicio, assigned.tempo_fim, assigned.transcript_id) AS exact_text
        FROM blocks AS block
        LEFT JOIN assigned ON assigned.block_id = block.id
       GROUP BY block.id
    )
    SELECT (SELECT count(*) FROM assigned) = _transcript_count
       AND NOT EXISTS (SELECT 1 FROM assigned WHERE block_id IS NULL)
       AND NOT EXISTS (
         SELECT 1 FROM blocks
          JOIN expected ON expected.block_id = blocks.id
         WHERE segment_count < 1 OR btrim(blocks.texto) IS DISTINCT FROM expected.exact_text
       )
  ) THEN
    RAISE EXCEPTION 'SPOKEN_DNA_LAYER_REFRESH_CURRENT_BLOCKS_NOT_EXACT_SPEECH:%', _youtube_id
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(_payload -> 'blocks') AS hook(value)
      JOIN jsonb_array_elements(_payload -> 'blocks') AS development(value)
        ON development.value ->> 'type' = 'desenvolvimento'
       AND (development.value ->> 'index')::integer > (hook.value ->> 'index')::integer
      JOIN jsonb_array_elements(_payload -> 'blocks') AS payoff(value)
        ON payoff.value ->> 'type' = 'payoff'
       AND (payoff.value ->> 'index')::integer > (development.value ->> 'index')::integer
     WHERE hook.value ->> 'type' = 'hook'
       AND (hook.value ->> 'index')::integer = 1
  ) THEN
    RAISE EXCEPTION 'SPOKEN_DNA_LAYER_REFRESH_NARRATIVE_CHAIN_INVALID:%', _youtube_id USING ERRCODE = '22023';
  END IF;

  -- All exposed semantic and verbal terms must be present in the exact
  -- spoken block.  This is intentionally more strict than checking keywords
  -- alone, because every one of these fields is fed into the style pack.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(_payload -> 'blocks') AS block(value)
      CROSS JOIN LATERAL (
        SELECT value FROM jsonb_array_elements_text(block.value #> '{semantic,keywords}')
        UNION ALL SELECT value FROM jsonb_array_elements_text(block.value #> '{semantic,strong_phrases}')
        UNION ALL SELECT value FROM jsonb_array_elements_text(block.value #> '{semantic,emotional_words}')
        UNION ALL SELECT value FROM jsonb_array_elements_text(block.value #> '{semantic,repeated_words}')
        UNION ALL SELECT value FROM jsonb_array_elements_text(block.value #> '{semantic,rare_words}')
        UNION ALL SELECT value FROM jsonb_array_elements_text(block.value #> '{semantic,dominant_words}')
        UNION ALL SELECT value FROM jsonb_array_elements_text(block.value #> '{verbal,trigger_words}')
      ) AS term(value)
     WHERE NULLIF(public._spoken_dna_normalized_text(term.value), '') IS NULL
        OR position(
          ' ' || public._spoken_dna_normalized_text(term.value) || ' '
          IN ' ' || public._spoken_dna_normalized_text(block.value ->> 'text') || ' '
        ) = 0
  ) THEN
    RAISE EXCEPTION 'SPOKEN_DNA_LAYER_REFRESH_TERM_NOT_SPOKEN:%', _youtube_id USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.block_semantic_patterns WHERE video_id = _video_id;
  DELETE FROM public.block_word_patterns WHERE video_id = _video_id;
  DELETE FROM public.block_phrase_patterns WHERE video_id = _video_id;
  DELETE FROM public.block_verbal_analysis WHERE video_id = _video_id;

  FOR _block IN
    SELECT value FROM jsonb_array_elements(_payload -> 'blocks') AS item(value)
     ORDER BY (value ->> 'index')::integer
  LOOP
    _block_id := (_block ->> 'source_block_id')::uuid;

    INSERT INTO public.block_semantic_patterns (
      video_id, block_id, block_type, block_text, block_keywords,
      block_emotional_words, block_repeated_words, block_strong_phrases,
      block_emotional_type, block_emotional_intensity, block_verbal_tone,
      rare_words, dominant_words, weighted_word_score, weighted_phrase_score
    ) VALUES (
      _video_id, _block_id, _block ->> 'type', _block ->> 'text',
      _block #> '{semantic,keywords}', _block #> '{semantic,emotional_words}',
      _block #> '{semantic,repeated_words}', _block #> '{semantic,strong_phrases}',
      _block #>> '{semantic,emotional_type}',
      (_block #>> '{semantic,emotional_intensity}')::integer,
      _block #>> '{semantic,verbal_tone}', _block #> '{semantic,rare_words}',
      _block #> '{semantic,dominant_words}',
      (_block #>> '{semantic,weighted_word_score}')::numeric,
      (_block #>> '{semantic,weighted_phrase_score}')::numeric
    );

    FOR _keyword IN
      SELECT value FROM jsonb_array_elements_text(_block #> '{semantic,keywords}') AS item(value)
    LOOP
      INSERT INTO public.block_word_patterns (
        video_id, block_id, block_type, word, word_frequency,
        is_emotional, is_rare, is_dominant, is_impact, weighted_score,
        timestamp_start, timestamp_end
      ) VALUES (
        _video_id, _block_id, _block ->> 'type', _keyword,
        GREATEST(1, COALESCE(((_block #> '{semantic,keyword_frequencies}') ->> _keyword)::integer, 1)),
        EXISTS (SELECT 1 FROM jsonb_array_elements_text(_block #> '{semantic,emotional_words}') AS item(value) WHERE item.value = _keyword),
        EXISTS (SELECT 1 FROM jsonb_array_elements_text(_block #> '{semantic,rare_words}') AS item(value) WHERE item.value = _keyword),
        EXISTS (SELECT 1 FROM jsonb_array_elements_text(_block #> '{semantic,dominant_words}') AS item(value) WHERE item.value = _keyword),
        (_block ->> 'type') IN ('hook','revelacao','payoff'),
        (_block #>> '{semantic,weighted_word_score}')::numeric,
        (_block ->> 'start')::numeric, (_block ->> 'end')::numeric
      );
    END LOOP;

    FOR _phrase IN
      SELECT value FROM jsonb_array_elements_text(_block #> '{semantic,strong_phrases}') AS item(value)
    LOOP
      INSERT INTO public.block_phrase_patterns (
        video_id, block_id, block_type, phrase, phrase_type, phrase_category,
        is_emotional, is_repeated, is_strong, phrase_length, phrase_position,
        phrase_strength_score, weighted_score
      ) VALUES (
        _video_id, _block_id, _block ->> 'type', _phrase,
        _block ->> 'type', 'exact_transcript',
        jsonb_array_length(_block #> '{semantic,emotional_words}') > 0,
        false, true, cardinality(regexp_split_to_array(btrim(_phrase), E'\\s+')),
        (_block ->> 'start')::numeric / _duration,
        (_block #>> '{semantic,weighted_phrase_score}')::numeric,
        (_block #>> '{semantic,weighted_phrase_score}')::numeric
      );
    END LOOP;

    INSERT INTO public.block_verbal_analysis (
      video_id, block_id, full_text, word_count, phrase_count, phrase_pattern,
      tone, trigger_words, linguistic_density, emotional_intensity,
      semantic_pressure_score, confidence_score, data_source_type, origin_level
    ) VALUES (
      _video_id, _block_id, _block ->> 'text',
      (_block #>> '{verbal,word_count}')::integer,
      (_block #>> '{verbal,phrase_count}')::integer,
      _block #>> '{verbal,phrase_pattern}', _block #>> '{verbal,tone}',
      _block #> '{verbal,trigger_words}',
      (_block #>> '{verbal,linguistic_density}')::numeric,
      (_block #>> '{verbal,emotional_intensity}')::integer,
      (_block #>> '{verbal,semantic_pressure_score}')::numeric,
      100, 'spoken_dna_layer_refresh_v1', 'exact_transcript_deterministic'
    );
  END LOOP;

  SELECT value INTO _last_payoff
    FROM jsonb_array_elements(_payload -> 'blocks') AS item(value)
   WHERE value ->> 'type' = 'payoff'
   ORDER BY (value ->> 'index')::integer DESC
   LIMIT 1;

  UPDATE public.videos
     SET status = 'completed',
         numero_blocos = _block_count,
         gancho_detectado = true,
         tipo_gancho = 'texto',
         tempo_gancho = (_payload #>> '{blocks,0,start}')::numeric,
         duracao_gancho = (_payload #>> '{blocks,0,end}')::numeric - (_payload #>> '{blocks,0,start}')::numeric,
         hook_text = _payload #>> '{blocks,0,text}',
         hook_keywords = _payload #> '{blocks,0,semantic,keywords}',
         hook_phrase_pattern = _payload #>> '{blocks,0,verbal,phrase_pattern}',
         hook_type_verbal = 'spoken_exact_transcript',
         hook_emotion_verbal = COALESCE(_payload #>> '{blocks,0,schema_emotion}', hook_emotion_verbal),
         hook_emotion_intensity = (_payload #>> '{blocks,0,verbal,emotional_intensity}')::integer,
         payoff_text = _last_payoff ->> 'text',
         payoff_type = 'spoken_exact_transcript',
         payoff_emotion = COALESCE(_last_payoff ->> 'schema_emotion', payoff_emotion),
         tempo_payoff = (_last_payoff ->> 'start')::numeric,
         narrative_progression_type = 'exact_transcript_layer_refresh',
         micro_turn_count = _block_count - 1,
         micro_turn_types = (SELECT jsonb_agg(value ->> 'type' ORDER BY (value ->> 'index')::integer)
           FROM jsonb_array_elements(_payload -> 'blocks') AS item(value)),
         approved_for_global = true
   WHERE id = _video_id;

  INSERT INTO public.video_metadata (video_id, chave, valor)
  VALUES (
    _video_id, 'spoken_dna_layer_refresh_v1',
    jsonb_build_object(
      'youtube_id', _youtube_id,
      'transcript_sha256', _payload ->> 'transcript_sha256',
      'committed_at', clock_timestamp()
    )::text
  ) ON CONFLICT (video_id, chave) DO UPDATE
    SET valor = EXCLUDED.valor, created_at = clock_timestamp();

  INSERT INTO public.processing_queue (video_id, status, completed_at, error_message, priority)
  VALUES (_video_id, 'completed', clock_timestamp(), NULL, 100)
  ON CONFLICT (video_id) DO UPDATE
    SET status = 'completed', completed_at = clock_timestamp(), error_message = NULL,
        priority = GREATEST(public.processing_queue.priority, 100);

  SELECT count(DISTINCT block_id) INTO _semantic_blocks
    FROM public.block_semantic_patterns WHERE video_id = _video_id;
  SELECT count(DISTINCT block_id) INTO _word_blocks
    FROM public.block_word_patterns WHERE video_id = _video_id;
  SELECT count(DISTINCT block_id) INTO _phrase_blocks
    FROM public.block_phrase_patterns WHERE video_id = _video_id;
  SELECT count(DISTINCT block_id) INTO _verbal_blocks
    FROM public.block_verbal_analysis WHERE video_id = _video_id;
  IF _semantic_blocks <> _block_count OR _word_blocks <> _block_count
     OR _phrase_blocks <> _block_count OR _verbal_blocks <> _block_count THEN
    RAISE EXCEPTION 'SPOKEN_DNA_LAYER_REFRESH_COVERAGE_INVALID:%', _youtube_id USING ERRCODE = '23514';
  END IF;

  RETURN jsonb_build_object(
    'youtube_id', _youtube_id,
    'video_id', _video_id,
    'block_count', _block_count,
    'changed', 'derived_spoken_layers_only'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_viral_spoken_layers_atomic(
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
    'OlYMSfYlBFo','eXs-hEK1qPg','nFfKqQBRC8g','raP3axYfubU',
    'Ay-E-FByxyU','8B0OfDDWqNs','PzYV3aq2QYM','jPoq9QTxMDc',
    '8zb89g-AUEY','bDP1EALyXik','NatewOBrinA','bnLlnciv04c',
    'qgBrw-CjvGI','JGxFwABwiWo','f1VkuYAF2mM','EakSssIZ3nQ',
    '7oiC-4hc-dI','raB_88YjQbk'
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
    RAISE EXCEPTION 'SPOKEN_DNA_LAYER_REFRESH_BATCH_INVALID' USING ERRCODE = '22023';
  END IF;

  FOREACH _youtube_id IN ARRAY _expected_ids LOOP
    SELECT value INTO _payload
      FROM jsonb_array_elements(_payloads) AS item(value)
     WHERE value ->> 'youtube_id' = _youtube_id;
    _results := _results || jsonb_build_array(public._refresh_viral_spoken_layers_payload(_payload));
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

REVOKE ALL ON FUNCTION public._refresh_viral_spoken_layers_payload(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._refresh_viral_spoken_layers_payload(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public._refresh_viral_spoken_layers_payload(jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.refresh_viral_spoken_layers_atomic(jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_viral_spoken_layers_atomic(jsonb, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.refresh_viral_spoken_layers_atomic(jsonb, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_viral_spoken_layers_atomic(jsonb, text, text) TO service_role;
