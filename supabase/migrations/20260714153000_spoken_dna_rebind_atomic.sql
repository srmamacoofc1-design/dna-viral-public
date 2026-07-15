-- Surgical, fail-closed repair of the exact 16 non-manual spoken-DNA rows
-- identified by the 50-video audit. The public RPC commits the whole batch in
-- one transaction. Passing videos and the 16 Codex-manual videos are outside
-- the SQL allowlist and cannot be changed by this path.

CREATE OR REPLACE FUNCTION public._spoken_dna_normalized_text(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $function$
  SELECT btrim(regexp_replace(
    translate(lower(_value),
      'áàâãäåéèêëíìîïóòôõöúùûüçñ',
      'aaaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]+', ' ', 'g'
  ));
$function$;

CREATE OR REPLACE FUNCTION public._viral_spoken_dna_is_valid(_video_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  WITH blocks AS (
    SELECT * FROM public.video_blocks
     WHERE video_id = _video_id
  ), transcript AS (
    SELECT * FROM public.video_transcripts
     WHERE video_id = _video_id
  ), assigned AS (
    SELECT transcript.id AS transcript_id,
           transcript.texto,
           transcript.tempo_inicio,
           transcript.tempo_fim,
           chosen.id AS block_id
      FROM transcript
      LEFT JOIN LATERAL (
        SELECT blocks.id
          FROM blocks
         WHERE GREATEST(0,
           LEAST(transcript.tempo_fim, blocks.tempo_fim)
           - GREATEST(transcript.tempo_inicio, blocks.tempo_inicio)) > 0
         ORDER BY GREATEST(0,
           LEAST(transcript.tempo_fim, blocks.tempo_fim)
           - GREATEST(transcript.tempo_inicio, blocks.tempo_inicio)) DESC,
           blocks.bloco_id ASC, blocks.id ASC
         LIMIT 1
      ) AS chosen ON true
  ), expected AS (
    SELECT blocks.id AS block_id,
           count(assigned.transcript_id) AS segment_count,
           string_agg(btrim(assigned.texto), ' '
             ORDER BY assigned.tempo_inicio, assigned.tempo_fim, assigned.transcript_id) AS exact_text
      FROM blocks
      LEFT JOIN assigned ON assigned.block_id = blocks.id
     GROUP BY blocks.id
  ), speech AS (
    SELECT (SELECT count(*) FROM transcript) > 0
       AND NOT EXISTS (SELECT 1 FROM assigned WHERE block_id IS NULL)
       AND NOT EXISTS (
         SELECT 1 FROM blocks
         JOIN expected ON expected.block_id = blocks.id
          WHERE expected.segment_count < 1
             OR blocks.texto IS DISTINCT FROM expected.exact_text
       ) AS valid
  ), word_patterns AS (
    SELECT NOT EXISTS (
      SELECT 1 FROM blocks
       WHERE NOT EXISTS (
         SELECT 1 FROM public.block_word_patterns AS word
          WHERE word.video_id = _video_id AND word.block_id = blocks.id
       ) OR EXISTS (
         SELECT 1 FROM public.block_word_patterns AS word
          WHERE word.video_id = _video_id AND word.block_id = blocks.id
            AND position(
              ' ' || public._spoken_dna_normalized_text(word.word) || ' '
              IN ' ' || public._spoken_dna_normalized_text(blocks.texto) || ' '
            ) = 0
       )
    ) AS valid
  ), phrase_patterns AS (
    SELECT NOT EXISTS (
      SELECT 1 FROM blocks
       WHERE NOT EXISTS (
         SELECT 1 FROM public.block_phrase_patterns AS phrase
          WHERE phrase.video_id = _video_id AND phrase.block_id = blocks.id
       ) OR EXISTS (
         SELECT 1 FROM public.block_phrase_patterns AS phrase
          WHERE phrase.video_id = _video_id AND phrase.block_id = blocks.id
            AND position(
              ' ' || public._spoken_dna_normalized_text(phrase.phrase) || ' '
              IN ' ' || public._spoken_dna_normalized_text(blocks.texto) || ' '
            ) = 0
       )
    ) AS valid
  )
  SELECT COALESCE((SELECT status = 'completed' FROM public.videos WHERE id = _video_id), false)
     AND (SELECT count(*) FROM blocks) BETWEEN 3 AND 18
     AND EXISTS (SELECT 1 FROM blocks WHERE tipo_bloco = 'hook')
     AND EXISTS (SELECT 1 FROM blocks WHERE tipo_bloco = 'desenvolvimento')
     AND EXISTS (SELECT 1 FROM blocks WHERE tipo_bloco = 'payoff')
     AND (SELECT valid FROM speech)
     AND (SELECT valid FROM word_patterns)
     AND (SELECT valid FROM phrase_patterns);
$function$;

CREATE OR REPLACE FUNCTION public._validate_viral_spoken_dna_rebind_payload(_payload jsonb)
RETURNS uuid
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
  _youtube_id text;
  _video_ids uuid[];
  _video_id uuid;
  _duration numeric;
  _stored_duration numeric;
  _mode text;
  _block_count integer;
  _transcript_count integer;
BEGIN
  IF _claim_role <> 'service_role' AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_payload) IS DISTINCT FROM 'object'
     OR _payload ->> 'schema_version' IS DISTINCT FROM '1'
     OR _payload ->> 'engine' IS DISTINCT FROM 'spoken_dna_rebind_v1' THEN
    RAISE EXCEPTION 'SPOKEN_DNA_REBIND_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  _youtube_id := _payload ->> 'youtube_id';
  _mode := _payload ->> 'mode';
  IF _youtube_id IS NULL OR NOT (_youtube_id = ANY (_allowed_ids))
     OR COALESCE(_mode, '') NOT IN ('layers_only', 'full_rebind')
     OR COALESCE(_payload ->> 'transcript_sha256', '') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'SPOKEN_DNA_REBIND_SCOPE_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT metadata.video_id)
    INTO _video_ids
    FROM public.video_metadata AS metadata
   WHERE (metadata.chave = 'youtube_id' AND metadata.valor = _youtube_id)
      OR (metadata.chave = 'source_idempotency_key' AND metadata.valor = 'youtube:' || _youtube_id);
  IF COALESCE(cardinality(_video_ids), 0) <> 1 THEN
    RAISE EXCEPTION 'SPOKEN_DNA_REBIND_VIDEO_LOOKUP_NOT_UNIQUE:%', _youtube_id USING ERRCODE = 'P0002';
  END IF;
  _video_id := _video_ids[1];
  SELECT duracao INTO _stored_duration FROM public.videos WHERE id = _video_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VIDEO_NOT_FOUND:%', _youtube_id USING ERRCODE = 'P0002'; END IF;
  IF _payload ->> 'video_id' IS DISTINCT FROM _video_id::text THEN
    RAISE EXCEPTION 'SPOKEN_DNA_REBIND_VIDEO_ID_MISMATCH:%', _youtube_id USING ERRCODE = '22023';
  END IF;
  IF public._viral_spoken_dna_is_valid(_video_id) THEN
    RAISE EXCEPTION 'SPOKEN_DNA_ALREADY_VALID:%', _youtube_id USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.video_metadata
     WHERE video_id = _video_id
       AND chave IN ('codex_manual_visual_analysis','codex_manual_audit_payload_sha256')
  ) OR EXISTS (
    SELECT 1 FROM public.visual_block_analysis
     WHERE video_id = _video_id AND data_source_type = 'codex_manual_visual_audit'
  ) THEN
    RAISE EXCEPTION 'SPOKEN_DNA_REBIND_MANUAL_EVIDENCE_FORBIDDEN:%', _youtube_id USING ERRCODE = '42501';
  END IF;

  _duration := (_payload ->> 'duration_seconds')::numeric;
  IF _duration IS NULL OR _duration <= 0 OR _duration > 600
     OR _stored_duration IS NULL
     OR abs(_duration - _stored_duration) > GREATEST(0.05, _stored_duration * 0.001) THEN
    RAISE EXCEPTION 'SPOKEN_DNA_REBIND_DURATION_MISMATCH:%', _youtube_id USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(_payload -> 'blocks') <> 'array' THEN
    RAISE EXCEPTION 'SPOKEN_DNA_REBIND_BLOCKS_INVALID:%', _youtube_id USING ERRCODE = '22023';
  END IF;
  _block_count := jsonb_array_length(_payload -> 'blocks');
  SELECT count(*) INTO _transcript_count FROM public.video_transcripts WHERE video_id = _video_id;
  IF _transcript_count < 3 OR _block_count < 3 OR _block_count > 18 THEN
    RAISE EXCEPTION 'SPOKEN_DNA_REBIND_LAYER_COUNT_INVALID:%', _youtube_id USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(_payload -> 'blocks') WITH ORDINALITY AS source(value, ordinality)
     WHERE COALESCE((value ->> 'index')::integer, -1) <> ordinality::integer
        OR COALESCE(value ->> 'type', '') NOT IN ('hook','setup','desenvolvimento','tensao','revelacao','payoff','transicao','loop')
        OR COALESCE(value ->> 'schema_emotion', '') NOT IN ('curiosidade','surpresa','medo','tensao','alivio','expectativa','impacto')
        OR COALESCE((value ->> 'start')::numeric, -1) < 0
        OR COALESCE((value ->> 'end')::numeric, -1) <= COALESCE((value ->> 'start')::numeric, -1)
        OR COALESCE((value ->> 'end')::numeric, _duration + 1) > _duration + GREATEST(0.5, _duration * 0.01)
        OR NULLIF(btrim(value ->> 'text'), '') IS NULL
        OR NULLIF(btrim(value ->> 'narrative_function'), '') IS NULL
        OR COALESCE(value ->> 'source_block_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR COALESCE(value ->> 'source_visual_analysis_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR jsonb_typeof(value -> 'transcript_segment_ids') <> 'array'
        OR jsonb_array_length(value -> 'transcript_segment_ids') < 1
        OR jsonb_typeof(value -> 'transcript_segment_indexes') <> 'array'
        OR jsonb_array_length(value -> 'transcript_segment_indexes') <> jsonb_array_length(value -> 'transcript_segment_ids')
        OR jsonb_typeof(value -> 'semantic') <> 'object'
        OR jsonb_typeof(value #> '{semantic,keywords}') <> 'array'
        OR jsonb_array_length(value #> '{semantic,keywords}') < 1
        OR jsonb_typeof(value #> '{semantic,keyword_frequencies}') <> 'object'
        OR jsonb_typeof(value #> '{semantic,strong_phrases}') <> 'array'
        OR jsonb_array_length(value #> '{semantic,strong_phrases}') < 1
        OR jsonb_typeof(value #> '{semantic,emotional_words}') <> 'array'
        OR jsonb_typeof(value #> '{semantic,repeated_words}') <> 'array'
        OR jsonb_typeof(value #> '{semantic,rare_words}') <> 'array'
        OR jsonb_typeof(value #> '{semantic,dominant_words}') <> 'array'
        OR jsonb_typeof(value -> 'verbal') <> 'object'
        OR jsonb_typeof(value #> '{verbal,trigger_words}') <> 'array'
        OR COALESCE((value #>> '{verbal,word_count}')::integer, 0) < 1
        OR COALESCE((value #>> '{verbal,phrase_count}')::integer, 0) < 1
  ) THEN
    RAISE EXCEPTION 'SPOKEN_DNA_REBIND_BLOCK_SCHEMA_INVALID:%', _youtube_id USING ERRCODE = '22023';
  END IF;

  -- The payload can reference only the immutable current transcript rows.
  -- Every row must appear exactly once and every persisted block text is the
  -- exact ordered concatenation of those rows.
  IF EXISTS (
    WITH refs AS (
      SELECT (segment.value #>> '{}')::uuid AS transcript_id, count(*) AS uses
        FROM jsonb_array_elements(_payload -> 'blocks') AS block(value)
        CROSS JOIN LATERAL jsonb_array_elements(block.value -> 'transcript_segment_ids') AS segment(value)
       GROUP BY 1
    )
    SELECT 1 FROM refs
     FULL JOIN public.video_transcripts AS transcript
       ON transcript.id = refs.transcript_id AND transcript.video_id = _video_id
     WHERE transcript.id IS NULL OR refs.uses <> 1
  ) OR (
    SELECT count(*)
      FROM jsonb_array_elements(_payload -> 'blocks') AS block(value)
      CROSS JOIN LATERAL jsonb_array_elements(block.value -> 'transcript_segment_ids')
  ) <> _transcript_count THEN
    RAISE EXCEPTION 'SPOKEN_DNA_REBIND_TRANSCRIPT_COVERAGE_INVALID:%', _youtube_id USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    WITH ordered_transcript AS (
      SELECT id,
             row_number() OVER (ORDER BY tempo_inicio, tempo_fim, id)::integer - 1 AS expected_index
        FROM public.video_transcripts
       WHERE video_id = _video_id
    )
    SELECT 1
      FROM jsonb_array_elements(_payload -> 'blocks') AS block(value)
      CROSS JOIN LATERAL jsonb_array_elements_text(block.value -> 'transcript_segment_ids')
        WITH ORDINALITY AS ref(value, ordinality)
      JOIN LATERAL jsonb_array_elements_text(block.value -> 'transcript_segment_indexes')
        WITH ORDINALITY AS supplied(value, ordinality)
        ON supplied.ordinality = ref.ordinality
      JOIN ordered_transcript ON ordered_transcript.id = ref.value::uuid
     WHERE supplied.value::integer <> ordered_transcript.expected_index
  ) THEN
    RAISE EXCEPTION 'SPOKEN_DNA_REBIND_TRANSCRIPT_INDEX_MISMATCH:%', _youtube_id USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    WITH expected AS (
      SELECT (block.value ->> 'index')::integer AS block_index,
             block.value ->> 'text' AS block_text,
             string_agg(btrim(transcript.texto), ' ' ORDER BY ref.ordinality) AS exact_text
        FROM jsonb_array_elements(_payload -> 'blocks') AS block(value)
        CROSS JOIN LATERAL jsonb_array_elements_text(block.value -> 'transcript_segment_ids')
          WITH ORDINALITY AS ref(value, ordinality)
        JOIN public.video_transcripts AS transcript
          ON transcript.id = ref.value::uuid AND transcript.video_id = _video_id
       GROUP BY block.value
    )
    SELECT 1 FROM expected WHERE block_text IS DISTINCT FROM exact_text
  ) THEN
    RAISE EXCEPTION 'SPOKEN_DNA_REBIND_TEXT_NOT_EXACT_SPEECH:%', _youtube_id USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(_payload -> 'blocks') AS block(value)
      CROSS JOIN LATERAL jsonb_array_elements_text(block.value -> 'transcript_segment_ids') AS ref(value)
      JOIN public.video_transcripts AS transcript
        ON transcript.id = ref.value::uuid AND transcript.video_id = _video_id
     WHERE transcript.tempo_inicio < (block.value ->> 'start')::numeric - 0.25
        OR transcript.tempo_fim > (block.value ->> 'end')::numeric + 0.25
  ) THEN
    RAISE EXCEPTION 'SPOKEN_DNA_REBIND_TRANSCRIPT_INTERVAL_INVALID:%', _youtube_id USING ERRCODE = '22023';
  END IF;

  -- Independently reproduce the public audit's greatest-positive-overlap
  -- assignment. A payload that merely lists all transcripts but would audit
  -- into another block is rejected before destructive work.
  IF EXISTS (
    WITH refs AS (
      SELECT (block.value ->> 'index')::integer AS referenced_index,
             ref.value::uuid AS transcript_id
        FROM jsonb_array_elements(_payload -> 'blocks') AS block(value)
        CROSS JOIN LATERAL jsonb_array_elements_text(block.value -> 'transcript_segment_ids') AS ref(value)
    ), chosen AS (
      SELECT transcript.id AS transcript_id, candidate.block_index
        FROM public.video_transcripts AS transcript
        LEFT JOIN LATERAL (
          SELECT (block.value ->> 'index')::integer AS block_index
            FROM jsonb_array_elements(_payload -> 'blocks') AS block(value)
           WHERE GREATEST(0,
             LEAST(transcript.tempo_fim, (block.value ->> 'end')::numeric)
             - GREATEST(transcript.tempo_inicio, (block.value ->> 'start')::numeric)) > 0
           ORDER BY GREATEST(0,
             LEAST(transcript.tempo_fim, (block.value ->> 'end')::numeric)
             - GREATEST(transcript.tempo_inicio, (block.value ->> 'start')::numeric)) DESC,
             (block.value ->> 'index')::integer ASC
           LIMIT 1
        ) AS candidate ON true
       WHERE transcript.video_id = _video_id
    )
    SELECT 1 FROM chosen JOIN refs USING (transcript_id)
     WHERE chosen.block_index IS NULL OR chosen.block_index <> refs.referenced_index
  ) THEN
    RAISE EXCEPTION 'SPOKEN_DNA_REBIND_GREATEST_OVERLAP_MISMATCH:%', _youtube_id USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    WITH blocks AS (
      SELECT (value ->> 'index')::integer AS index, value ->> 'type' AS type
        FROM jsonb_array_elements(_payload -> 'blocks')
    )
    SELECT 1 FROM blocks AS hook
      JOIN blocks AS development ON development.type = 'desenvolvimento' AND development.index > hook.index
      JOIN blocks AS payoff ON payoff.type = 'payoff' AND payoff.index > development.index
     WHERE hook.type = 'hook' AND hook.index = 1
  ) THEN
    RAISE EXCEPTION 'SPOKEN_DNA_REBIND_NARRATIVE_CHAIN_INVALID:%', _youtube_id USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    WITH blocks AS (
      SELECT (value ->> 'index')::integer AS index,
             (value ->> 'start')::numeric AS start,
             (value ->> 'end')::numeric AS "end"
        FROM jsonb_array_elements(_payload -> 'blocks')
    ), ordered AS (
      SELECT *, lag("end") OVER (ORDER BY index) AS previous_end FROM blocks
    ), metrics AS (
      SELECT COALESCE(sum(GREATEST(start - previous_end, 0)), 0) AS total_gap,
             COALESCE(sum(GREATEST(previous_end - start, 0)), 0) AS total_overlap,
             COALESCE(sum("end" - start), 0)
               - COALESCE(sum(GREATEST(previous_end - start, 0)), 0) AS union_coverage,
             min(start) AS first_start, max("end") AS last_end
        FROM ordered
    )
    SELECT 1 FROM metrics
     WHERE first_start > GREATEST(2, _duration * 0.1)
        OR total_gap > GREATEST(5, _duration * 0.1)
        OR total_overlap > GREATEST(1, _duration * 0.02)
        OR union_coverage / _duration < 0.85
        OR last_end < _duration * 0.9
  ) THEN
    RAISE EXCEPTION 'SPOKEN_DNA_REBIND_TIMELINE_INVALID:%', _youtube_id USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(_payload -> 'blocks') AS block(value)
      CROSS JOIN LATERAL jsonb_array_elements_text(block.value #> '{semantic,keywords}') AS keyword(value)
     WHERE position(
       ' ' || public._spoken_dna_normalized_text(keyword.value) || ' '
       IN ' ' || public._spoken_dna_normalized_text(block.value ->> 'text') || ' '
     ) = 0
  ) OR EXISTS (
    SELECT 1
      FROM jsonb_array_elements(_payload -> 'blocks') AS block(value)
      CROSS JOIN LATERAL jsonb_array_elements_text(block.value #> '{semantic,strong_phrases}') AS phrase(value)
     WHERE position(
       ' ' || public._spoken_dna_normalized_text(phrase.value) || ' '
       IN ' ' || public._spoken_dna_normalized_text(block.value ->> 'text') || ' '
     ) = 0
  ) THEN
    RAISE EXCEPTION 'SPOKEN_DNA_REBIND_PATTERN_NOT_SPOKEN:%', _youtube_id USING ERRCODE = '22023';
  END IF;
  -- These fields are later injected into the generation context too. Do not
  -- let a valid headline keyword hide invented rare/repeated/emotional terms.
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
    RAISE EXCEPTION 'SPOKEN_DNA_REBIND_SEMANTIC_OR_TRIGGER_NOT_SPOKEN:%', _youtube_id USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_payload -> 'blocks') AS block(value)
     LEFT JOIN public.video_blocks AS source
       ON source.id = (block.value ->> 'source_block_id')::uuid AND source.video_id = _video_id
     LEFT JOIN public.visual_block_analysis AS visual
       ON visual.id = (block.value ->> 'source_visual_analysis_id')::uuid
      AND visual.video_id = _video_id
      AND visual.data_source_type = 'gemini_video_understanding'
     WHERE source.id IS NULL OR visual.id IS NULL
        OR visual.representative_timestamp IS NULL
        OR visual.representative_timestamp < (block.value ->> 'start')::numeric - 0.5
        OR visual.representative_timestamp > (block.value ->> 'end')::numeric + 0.5
  ) OR (
    SELECT count(DISTINCT value ->> 'source_visual_analysis_id')
      FROM jsonb_array_elements(_payload -> 'blocks')
  ) <> _block_count THEN
    RAISE EXCEPTION 'SPOKEN_DNA_REBIND_TRUSTED_VISUAL_REFERENCE_INVALID:%', _youtube_id USING ERRCODE = '22023';
  END IF;

  IF _mode = 'layers_only' AND (
    (SELECT count(*) FROM public.video_blocks WHERE video_id = _video_id) <> _block_count
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(_payload -> 'blocks') AS block(value)
      LEFT JOIN public.video_blocks AS current
        ON current.id = (block.value ->> 'source_block_id')::uuid AND current.video_id = _video_id
       WHERE current.id IS NULL
          OR current.bloco_id <> (block.value ->> 'index')::integer
          OR current.tipo_bloco::text IS DISTINCT FROM block.value ->> 'type'
          OR current.tempo_inicio IS DISTINCT FROM (block.value ->> 'start')::numeric
          OR current.tempo_fim IS DISTINCT FROM (block.value ->> 'end')::numeric
          OR current.texto IS DISTINCT FROM block.value ->> 'text'
    )
  ) THEN
    RAISE EXCEPTION 'SPOKEN_DNA_REBIND_LAYERS_ONLY_CHANGED_BLOCK:%', _youtube_id USING ERRCODE = '22023';
  END IF;
  RETURN _video_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public._commit_viral_spoken_dna_rebind_payload(
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
  _video_id uuid;
  _youtube_id text := _payload ->> 'youtube_id';
  _mode text := _payload ->> 'mode';
  _duration numeric := (_payload ->> 'duration_seconds')::numeric;
  _block_count integer := jsonb_array_length(_payload -> 'blocks');
  _block jsonb;
  _block_id uuid;
  _visual jsonb;
  _visual_snapshot jsonb := '[]'::jsonb;
  _alignment jsonb;
  _alignment_snapshot jsonb := '[]'::jsonb;
  _compatibility jsonb;
  _compatibility_snapshot jsonb := '[]'::jsonb;
  _old_block_id uuid;
  _keyword text;
  _phrase text;
  _word_blocks integer;
  _phrase_blocks integer;
BEGIN
  _video_id := public._validate_viral_spoken_dna_rebind_payload(_payload);
  DELETE FROM public.video_metadata
   WHERE video_id = _video_id AND chave = 'multimodal_processing_claim';

  IF _mode = 'layers_only' THEN
    DELETE FROM public.block_semantic_patterns WHERE video_id = _video_id;
    DELETE FROM public.block_word_patterns WHERE video_id = _video_id;
    DELETE FROM public.block_phrase_patterns WHERE video_id = _video_id;
    DELETE FROM public.block_verbal_analysis WHERE video_id = _video_id;
  ELSE
    SELECT COALESCE(jsonb_agg(to_jsonb(visual)), '[]'::jsonb)
      INTO _visual_snapshot
      FROM public.visual_block_analysis AS visual
     WHERE visual.video_id = _video_id
       AND visual.data_source_type = 'gemini_video_understanding'
       AND visual.id IN (
         SELECT (value ->> 'source_visual_analysis_id')::uuid
           FROM jsonb_array_elements(_payload -> 'blocks')
       );
    SELECT COALESCE(jsonb_agg(to_jsonb(alignment)), '[]'::jsonb)
      INTO _alignment_snapshot
      FROM public.text_visual_alignment AS alignment
     WHERE alignment.video_id = _video_id;
    SELECT COALESCE(jsonb_agg(to_jsonb(compatibility)), '[]'::jsonb)
      INTO _compatibility_snapshot
      FROM public.text_image_compatibility AS compatibility
     WHERE compatibility.video_id = _video_id;
    DELETE FROM public.video_blocks WHERE video_id = _video_id;
  END IF;

  FOR _block IN
    SELECT value FROM jsonb_array_elements(_payload -> 'blocks')
     ORDER BY (value ->> 'index')::integer
  LOOP
    SELECT value INTO _visual
      FROM jsonb_array_elements(_visual_snapshot)
     WHERE value ->> 'id' = _block ->> 'source_visual_analysis_id'
     LIMIT 1;
    IF _mode = 'layers_only' THEN
      _block_id := (_block ->> 'source_block_id')::uuid;
    ELSE
      IF _visual IS NULL THEN
        RAISE EXCEPTION 'SPOKEN_DNA_VISUAL_SNAPSHOT_LOST:%', _youtube_id USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.video_blocks (
        video_id, bloco_id, tempo_inicio, tempo_fim, texto, frame_url,
        tipo_bloco, funcao_narrativa, emocao, elemento_visual,
        descricao_visual, language_code, block_density_score,
        semantic_shift_score, visual_shift_score
      ) VALUES (
        _video_id, (_block ->> 'index')::integer,
        (_block ->> 'start')::numeric, (_block ->> 'end')::numeric,
        _block ->> 'text', _visual ->> 'representative_frame_path',
        (_block ->> 'type')::public.tipo_bloco,
        _block ->> 'narrative_function', (_block ->> 'schema_emotion')::public.emocao,
        _visual ->> 'main_action', _visual ->> 'scene_description', 'pt',
        LEAST(100, GREATEST(0, round(50 * (_duration / _block_count)
          / GREATEST(0.1, (_block ->> 'end')::numeric - (_block ->> 'start')::numeric)))),
        CASE WHEN (_block ->> 'index')::integer = 1 THEN 100 ELSE 70 END,
        LEAST(100, GREATEST(0, COALESCE(NULLIF(_visual ->> 'avg_visual_intensity_score', '')::numeric, 0)))
      ) RETURNING id INTO _block_id;

      INSERT INTO public.visual_block_analysis (
        video_id, block_id, block_type, representative_frame_path,
        representative_timestamp, scene_description, main_action, main_objects,
        human_presence, animal_presence, text_on_screen_presence,
        visual_intensity_level, scene_change_detected, scene_change_count,
        avg_visual_intensity_score, visual_emotion, data_source_type,
        confidence_score, origin_level
      ) VALUES (
        _video_id, _block_id, _block ->> 'type',
        _visual ->> 'representative_frame_path',
        NULLIF(_visual ->> 'representative_timestamp', '')::numeric,
        _visual ->> 'scene_description', _visual ->> 'main_action',
        COALESCE(_visual -> 'main_objects', '[]'::jsonb),
        NULLIF(_visual ->> 'human_presence', '')::boolean,
        NULLIF(_visual ->> 'animal_presence', '')::boolean,
        NULLIF(_visual ->> 'text_on_screen_presence', '')::boolean,
        _visual ->> 'visual_intensity_level',
        NULLIF(_visual ->> 'scene_change_detected', '')::boolean,
        COALESCE(NULLIF(_visual ->> 'scene_change_count', '')::integer, 0),
        NULLIF(_visual ->> 'avg_visual_intensity_score', '')::integer,
        _visual ->> 'visual_emotion', 'gemini_video_understanding',
        COALESCE(NULLIF(_visual ->> 'confidence_score', '')::integer, 0),
        COALESCE(NULLIF(_visual ->> 'origin_level', ''), 'gemini_video_understanding')
      );
    END IF;

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
      100, 'spoken_dna_rebind_v1', 'exact_transcript_deterministic'
    );

    IF _mode = 'full_rebind' THEN
      _old_block_id := (_visual ->> 'block_id')::uuid;
      SELECT value INTO _alignment FROM jsonb_array_elements(_alignment_snapshot)
       WHERE value ->> 'block_id' = _old_block_id::text LIMIT 1;
      SELECT value INTO _compatibility FROM jsonb_array_elements(_compatibility_snapshot)
       WHERE value ->> 'block_id' = _old_block_id::text LIMIT 1;

      INSERT INTO public.text_visual_alignment (
        video_id, block_id, text_action, visual_action, text_emotion,
        visual_emotion, alignment_score, action_alignment_score,
        emotion_alignment_score, intensity_alignment_score,
        data_source_type, confidence_score, origin_level
      ) VALUES (
        _video_id, _block_id, _block ->> 'text', _visual ->> 'main_action',
        _block ->> 'schema_emotion', _visual ->> 'visual_emotion',
        LEAST(75, COALESCE(NULLIF(_alignment ->> 'alignment_score', '')::integer, 55)),
        LEAST(75, COALESCE(NULLIF(_alignment ->> 'action_alignment_score', '')::integer, 55)),
        LEAST(75, COALESCE(NULLIF(_alignment ->> 'emotion_alignment_score', '')::integer, 55)),
        LEAST(75, COALESCE(NULLIF(_alignment ->> 'intensity_alignment_score', '')::integer, 55)),
        'spoken_dna_rebind_v1',
        LEAST(70, COALESCE(NULLIF(_alignment ->> 'confidence_score', '')::integer, 60)),
        'remapped_from_current_gemini_visual'
      );

      INSERT INTO public.text_image_compatibility (
        video_id, block_id, semantic_coherence_score, contradiction_detected,
        visual_overload_detected, confidence_score, block_type,
        text_intensity_score, visual_intensity_score_calc, intensity_gap,
        text_requires_visual_boost, visual_underpowered, visual_overpowered,
        emotional_match_score, action_match_score, curiosity_match_score,
        reveal_match_score, compatibility_score, compatibility_label,
        compatibility_reason, recommended_visual_direction,
        data_source_type, origin_level
      ) VALUES (
        _video_id, _block_id,
        LEAST(75, COALESCE(NULLIF(_compatibility ->> 'semantic_coherence_score', '')::integer, 55)),
        COALESCE(NULLIF(_compatibility ->> 'contradiction_detected', '')::boolean, false),
        COALESCE(NULLIF(_compatibility ->> 'visual_overload_detected', '')::boolean, false),
        LEAST(70, COALESCE(NULLIF(_compatibility ->> 'confidence_score', '')::integer, 60)),
        _block ->> 'type',
        (_block #>> '{verbal,emotional_intensity}')::integer,
        COALESCE(NULLIF(_visual ->> 'avg_visual_intensity_score', '')::integer, 50),
        abs((_block #>> '{verbal,emotional_intensity}')::integer
          - COALESCE(NULLIF(_visual ->> 'avg_visual_intensity_score', '')::integer, 50)),
        COALESCE(NULLIF(_compatibility ->> 'text_requires_visual_boost', '')::boolean, false),
        COALESCE(NULLIF(_compatibility ->> 'visual_underpowered', '')::boolean, false),
        COALESCE(NULLIF(_compatibility ->> 'visual_overpowered', '')::boolean, false),
        LEAST(75, COALESCE(NULLIF(_compatibility ->> 'emotional_match_score', '')::integer, 55)),
        LEAST(75, COALESCE(NULLIF(_compatibility ->> 'action_match_score', '')::integer, 55)),
        LEAST(75, COALESCE(NULLIF(_compatibility ->> 'curiosity_match_score', '')::integer, 55)),
        LEAST(75, COALESCE(NULLIF(_compatibility ->> 'reveal_match_score', '')::integer, 55)),
        LEAST(75, COALESCE(NULLIF(_compatibility ->> 'compatibility_score', '')::integer, 55)),
        'remapeado', 'Limites verbais refeitos da fala exata; observação visual Gemini preservada.',
        COALESCE(_compatibility ->> 'recommended_visual_direction', _visual ->> 'main_action'),
        'spoken_dna_rebind_v1', 'remapped_from_current_gemini_visual'
      );
    END IF;
  END LOOP;

  IF _mode = 'full_rebind' THEN
    UPDATE public.video_frames AS frame
       SET block_id = (
         SELECT block.id FROM public.video_blocks AS block
          WHERE block.video_id = _video_id
          ORDER BY CASE WHEN frame.timestamp_seconds BETWEEN block.tempo_inicio AND block.tempo_fim THEN 0 ELSE 1 END,
                   abs(frame.timestamp_seconds - ((block.tempo_inicio + block.tempo_fim) / 2)),
                   block.bloco_id
          LIMIT 1
       )
     WHERE frame.video_id = _video_id;
  END IF;

  UPDATE public.videos
     SET status = 'completed', numero_blocos = _block_count,
         gancho_detectado = true, tipo_gancho = 'texto',
         tempo_gancho = (_payload #>> '{blocks,0,start}')::numeric,
         duracao_gancho = (_payload #>> '{blocks,0,end}')::numeric
           - (_payload #>> '{blocks,0,start}')::numeric,
         hook_text = _payload #>> '{blocks,0,text}',
         hook_keywords = _payload #> '{blocks,0,semantic,keywords}',
         hook_phrase_pattern = _payload #>> '{blocks,0,verbal,phrase_pattern}',
         hook_type_verbal = 'spoken_exact_transcript',
         hook_emotion_verbal = _payload #>> '{blocks,0,schema_emotion}',
         hook_emotion_intensity = (_payload #>> '{blocks,0,verbal,emotional_intensity}')::integer,
         payoff_text = (SELECT value ->> 'text' FROM jsonb_array_elements(_payload -> 'blocks')
           WHERE value ->> 'type' = 'payoff' ORDER BY (value ->> 'index')::integer DESC LIMIT 1),
         payoff_type = 'spoken_exact_transcript',
         payoff_emotion = (SELECT value ->> 'schema_emotion' FROM jsonb_array_elements(_payload -> 'blocks')
           WHERE value ->> 'type' = 'payoff' ORDER BY (value ->> 'index')::integer DESC LIMIT 1),
         tempo_payoff = (SELECT (value ->> 'start')::numeric FROM jsonb_array_elements(_payload -> 'blocks')
           WHERE value ->> 'type' = 'payoff' ORDER BY (value ->> 'index')::integer DESC LIMIT 1),
         narrative_progression_type = 'exact_transcript_rebound',
         micro_turn_count = _block_count - 1,
         micro_turn_types = (SELECT jsonb_agg(value ->> 'type' ORDER BY (value ->> 'index')::integer)
           FROM jsonb_array_elements(_payload -> 'blocks')),
         block_segmentation_version = CASE WHEN _mode = 'layers_only'
           THEN block_segmentation_version ELSE 'spoken_dna_rebind_v1' END,
         approved_for_global = true
   WHERE id = _video_id;

  INSERT INTO public.video_metadata (video_id, chave, valor)
  VALUES (
    _video_id, 'spoken_dna_rebind_v1',
    jsonb_build_object(
      'youtube_id', _youtube_id, 'mode', _mode,
      'payload_sha256', _payload_sha256, 'audit_sha256', _audit_sha256,
      'transcript_sha256', _payload ->> 'transcript_sha256',
      'trusted_visual_source', 'gemini_video_understanding',
      'committed_at', clock_timestamp()
    )::text
  )
  ON CONFLICT (video_id, chave) DO UPDATE
    SET valor = EXCLUDED.valor, created_at = clock_timestamp();

  INSERT INTO public.processing_queue (video_id, status, completed_at, error_message, priority)
  VALUES (_video_id, 'completed', clock_timestamp(), NULL, 100)
  ON CONFLICT (video_id) DO UPDATE
    SET status = 'completed', completed_at = clock_timestamp(), error_message = NULL,
        priority = GREATEST(public.processing_queue.priority, 100);
  INSERT INTO public.video_logs (video_id, etapa, status, mensagem)
  VALUES (
    _video_id, 'Spoken DNA atomic rebind', 'success',
    format('%s: %s exact transcript blocks; payload=%s audit=%s',
      _mode, _block_count, _payload_sha256, _audit_sha256)
  );

  SELECT count(DISTINCT block_id) INTO _word_blocks
    FROM public.block_word_patterns WHERE video_id = _video_id;
  SELECT count(DISTINCT block_id) INTO _phrase_blocks
    FROM public.block_phrase_patterns WHERE video_id = _video_id;
  IF _word_blocks <> _block_count OR _phrase_blocks <> _block_count
     OR NOT public._viral_spoken_dna_is_valid(_video_id) THEN
    RAISE EXCEPTION 'SPOKEN_DNA_REBIND_POSTCONDITION_FAILED:%', _youtube_id USING ERRCODE = '23514';
  END IF;
  RETURN jsonb_build_object(
    'youtube_id', _youtube_id, 'video_id', _video_id, 'mode', _mode,
    'block_count', _block_count, 'word_pattern_blocks', _word_blocks,
    'phrase_pattern_blocks', _phrase_blocks, 'ready', true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.rebind_viral_spoken_dna_atomic(
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
  _payload jsonb;
  _results jsonb := '[]'::jsonb;
BEGIN
  IF _claim_role <> 'service_role' AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_payloads) <> 'array' OR jsonb_array_length(_payloads) <> 16
     OR COALESCE(_payload_sha256, '') !~ '^[0-9a-f]{64}$'
     OR COALESCE(_audit_sha256, '') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'SPOKEN_DNA_BATCH_SCHEMA_INVALID' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT value ->> 'youtube_id') FROM jsonb_array_elements(_payloads)) <> 16
     OR EXISTS (
       SELECT expected_id FROM unnest(_expected_ids) AS expected(expected_id)
       EXCEPT SELECT value ->> 'youtube_id' FROM jsonb_array_elements(_payloads)
     ) OR EXISTS (
       SELECT value ->> 'youtube_id' FROM jsonb_array_elements(_payloads)
       EXCEPT SELECT expected_id FROM unnest(_expected_ids) AS expected(expected_id)
     ) THEN
    RAISE EXCEPTION 'SPOKEN_DNA_BATCH_INVENTORY_MISMATCH' USING ERRCODE = '22023';
  END IF;

  -- Phase 1 locks and validates the complete batch. No child row is modified
  -- until every one of the exact 16 payloads has passed all preconditions.
  FOR _payload IN
    SELECT value FROM jsonb_array_elements(_payloads)
     ORDER BY value ->> 'youtube_id'
  LOOP
    PERFORM public._validate_viral_spoken_dna_rebind_payload(_payload);
  END LOOP;

  -- Phase 2 remains inside this single RPC transaction. Any postcondition or
  -- insert failure rolls every video back, including earlier loop iterations.
  FOR _payload IN
    SELECT value FROM jsonb_array_elements(_payloads)
     ORDER BY value ->> 'youtube_id'
  LOOP
    _results := _results || jsonb_build_array(
      public._commit_viral_spoken_dna_rebind_payload(
        _payload, _payload_sha256, _audit_sha256
      )
    );
  END LOOP;
  RETURN jsonb_build_object(
    'atomic', true, 'committed', 16,
    'payload_sha256', _payload_sha256, 'audit_sha256', _audit_sha256,
    'results', _results
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._spoken_dna_normalized_text(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._viral_spoken_dna_is_valid(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._validate_viral_spoken_dna_rebind_payload(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._commit_viral_spoken_dna_rebind_payload(jsonb, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rebind_viral_spoken_dna_atomic(jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rebind_viral_spoken_dna_atomic(jsonb, text, text) TO service_role;

COMMENT ON FUNCTION public.rebind_viral_spoken_dna_atomic(jsonb, text, text) IS
  'All-or-nothing repair of the exact 16 audited non-manual spoken-DNA failures; rejects passing/manual/out-of-scope videos and copies visual evidence only from current Gemini rows.';
