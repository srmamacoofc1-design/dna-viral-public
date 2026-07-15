-- Atomic persistence for the exact 16 Codex-reviewed viral-base videos.
-- This RPC is intentionally unavailable to browser/authenticated clients and
-- never labels manual evidence as Gemini video understanding.

CREATE OR REPLACE FUNCTION public.commit_codex_manual_audited_video(
  _youtube_id text,
  _payload jsonb,
  _payload_sha256 text,
  _manifest_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  _expected_ids constant text[] := ARRAY[
    'Zpi10UTydLU','0P8vcxxyuoI','KqGxjJ21Eqk','xTdr9tsT_4g',
    'vpY4sfLYQSY','JIcwpf_aE4o','j19oBZL2d-8','89_3HIcw80A',
    '6FP7nKEwLDo','1uVrM46e_yw','gsF_ZZ94Ue8','4Cz5ZMsGoT4',
    'xkzJeq1U_oM','6WNDlb8ame4','UKsKkmkpDi0','qyrjKm3KP0o'
  ];
  _claim_role text := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
  _video_ids uuid[];
  _video_id uuid;
  _duration numeric;
  _transcript_count integer;
  _frame_count integer;
  _block_count integer;
  _block jsonb;
  _block_id uuid;
  _keyword text;
  _phrase text;
  _word_pattern_blocks integer;
  _phrase_pattern_blocks integer;
  _expected_payoff_text text;
  _expected_payoff_emotion text;
  _already_committed boolean := false;
  _source_type constant text := 'codex_manual_visual_audit';
  _analysis_source constant text := 'Codex manual multimodal audit + YouTube pt-orig captions';
BEGIN
  IF _claim_role <> 'service_role' AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF _youtube_id IS NULL OR NOT (_youtube_id = ANY (_expected_ids)) THEN
    RAISE EXCEPTION 'CODEX_MANUAL_YOUTUBE_ID_NOT_ALLOWED' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(_payload) <> 'object'
     OR _payload ->> 'youtube_id' IS DISTINCT FROM _youtube_id
     OR _payload ->> 'source_type' IS DISTINCT FROM _source_type
     OR _payload ->> 'analysis_source' IS DISTINCT FROM _analysis_source
     OR _payload ->> 'language' IS DISTINCT FROM 'pt' THEN
    RAISE EXCEPTION 'CODEX_MANUAL_TRACEABILITY_INVALID' USING ERRCODE = '22023';
  END IF;
  IF _payload_sha256 !~ '^[0-9a-f]{64}$'
     OR _manifest_sha256 !~ '^[0-9a-f]{64}$'
     OR _payload ->> 'video_payload_sha256' IS DISTINCT FROM _payload_sha256 THEN
    RAISE EXCEPTION 'CODEX_MANUAL_HASH_INVALID' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(_payload ->> 'source_url', '') !~
       ('^https?://([^/]+\.)?(youtube\.com/shorts/|youtu\.be/)' || _youtube_id || '([/?#].*)?$') THEN
    RAISE EXCEPTION 'CODEX_MANUAL_SOURCE_URL_MISMATCH' USING ERRCODE = '22023';
  END IF;

  _duration := (_payload ->> 'duration_seconds')::numeric;
  IF _duration IS NULL OR _duration <= 0 OR _duration > 600 THEN
    RAISE EXCEPTION 'CODEX_MANUAL_DURATION_INVALID' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(_payload -> 'source') <> 'object'
     OR (SELECT count(*) FROM jsonb_each(_payload -> 'source')) <> 5
     OR EXISTS (
       SELECT 1
         FROM jsonb_each(_payload -> 'source') AS artifact(name, value)
        WHERE artifact.name NOT IN ('video','captions_json3','captions_vtt','transcript','audit_notes')
           OR jsonb_typeof(artifact.value) <> 'object'
           OR COALESCE(artifact.value ->> 'path', '') = ''
           OR COALESCE(artifact.value ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
           OR COALESCE((artifact.value ->> 'size')::bigint, 0) <= 0
     ) THEN
    RAISE EXCEPTION 'CODEX_MANUAL_SOURCE_ARTIFACTS_INVALID' USING ERRCODE = '22023';
  END IF;
  IF (_payload #>> '{source,video,size}')::bigint > 314572800
     OR (_payload #>> '{source,captions_json3,size}')::bigint > 8388608
     OR (_payload #>> '{source,captions_vtt,size}')::bigint > 8388608
     OR (_payload #>> '{source,transcript,size}')::bigint > 8388608
     OR (_payload #>> '{source,audit_notes,size}')::bigint > 2097152 THEN
    RAISE EXCEPTION 'CODEX_MANUAL_SOURCE_ARTIFACT_SIZE_INVALID' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(_payload -> 'transcript') <> 'array'
     OR jsonb_typeof(_payload -> 'visual_moments') <> 'array'
     OR jsonb_typeof(_payload -> 'blocks') <> 'array'
     OR jsonb_typeof(_payload -> 'summary') <> 'object' THEN
    RAISE EXCEPTION 'CODEX_MANUAL_REQUIRED_ARRAY_INVALID' USING ERRCODE = '22023';
  END IF;
  _transcript_count := jsonb_array_length(_payload -> 'transcript');
  _frame_count := jsonb_array_length(_payload -> 'visual_moments');
  _block_count := jsonb_array_length(_payload -> 'blocks');
  IF _transcript_count < 1 OR _transcript_count > 1000
     OR _frame_count < 30 OR _frame_count > 180
     OR _block_count < 12 OR _block_count > 18 THEN
    RAISE EXCEPTION 'CODEX_MANUAL_LAYER_COUNT_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Caption rows must be exact 0..N-1, cover opening/final source and form a
  -- near-contiguous timeline. All casts occur before destructive statements.
  IF EXISTS (
    WITH transcript AS (
      SELECT ordinality::integer - 1 AS expected_index, item.*
        FROM jsonb_array_elements(_payload -> 'transcript') WITH ORDINALITY AS source(value, ordinality)
        CROSS JOIN LATERAL jsonb_to_record(source.value) AS item(
          index integer, start numeric, "end" numeric, duration numeric, text text
        )
    )
    SELECT 1 FROM transcript
     WHERE index <> expected_index OR start IS NULL OR "end" IS NULL OR duration IS NULL
        OR start < 0 OR "end" <= start OR abs(duration - ("end" - start)) > 0.01
        OR "end" > _duration + GREATEST(0.5, _duration * 0.01)
        OR NULLIF(btrim(text), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'CODEX_MANUAL_TRANSCRIPT_SCHEMA_INVALID' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    WITH transcript AS (
      SELECT item.*, lag(item."end") OVER (ORDER BY item.index) AS previous_end
        FROM jsonb_array_elements(_payload -> 'transcript') AS source(value)
        CROSS JOIN LATERAL jsonb_to_record(source.value) AS item(
          index integer, start numeric, "end" numeric
        )
    )
    SELECT 1 FROM transcript
     WHERE (index = 0 AND start > 1)
        OR (previous_end IS NOT NULL AND (start - previous_end > 0.5 OR previous_end - start > 0.1))
  ) OR (SELECT (value ->> 'end')::numeric FROM jsonb_array_elements(_payload -> 'transcript')
         ORDER BY (value ->> 'index')::integer DESC LIMIT 1) < _duration * 0.95 THEN
    RAISE EXCEPTION 'CODEX_MANUAL_TRANSCRIPT_TIMELINE_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Each persisted observation is a unique reviewed local frame with a
  -- cryptographic hash and dense opening/final timeline coverage.
  IF EXISTS (
    WITH frames AS (
      SELECT ordinality::integer AS expected_number, item.*
        FROM jsonb_array_elements(_payload -> 'visual_moments') WITH ORDINALITY AS source(value, ordinality)
        CROSS JOIN LATERAL jsonb_to_record(source.value) AS item(
          frame_number integer, timestamp_seconds numeric, file_path text,
          source_local_path text, frame_hash text, frame_role text, visual_intensity_score integer,
          description text, action text, objects jsonb, surprise_score integer
        )
    )
    SELECT 1 FROM frames
     WHERE frame_number <> expected_number OR timestamp_seconds IS NULL OR timestamp_seconds < 0
        OR timestamp_seconds > _duration + GREATEST(0.5, _duration * 0.01)
        OR NULLIF(btrim(source_local_path), '') IS NULL OR frame_hash !~ '^[0-9a-f]{64}$'
        OR file_path !~ ('^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/videos/frames/codex-manual/'
          || _youtube_id || '/[0-9]{3}-' || frame_hash || '\.jpg$')
        OR visual_intensity_score NOT BETWEEN 0 AND 100 OR surprise_score NOT BETWEEN 0 AND 100
        OR NULLIF(btrim(description), '') IS NULL OR NULLIF(btrim(action), '') IS NULL
        OR jsonb_typeof(objects) <> 'array' OR jsonb_array_length(objects) < 1
  ) OR (SELECT count(DISTINCT value ->> 'frame_hash') FROM jsonb_array_elements(_payload -> 'visual_moments')) <> _frame_count
     OR (SELECT count(DISTINCT value ->> 'file_path') FROM jsonb_array_elements(_payload -> 'visual_moments')) <> _frame_count
     OR (SELECT min((value ->> 'timestamp_seconds')::numeric) FROM jsonb_array_elements(_payload -> 'visual_moments')) > GREATEST(2, _duration * 0.1)
     OR (SELECT max((value ->> 'timestamp_seconds')::numeric) FROM jsonb_array_elements(_payload -> 'visual_moments')) < _duration * 0.95 THEN
    RAISE EXCEPTION 'CODEX_MANUAL_VISUAL_EVIDENCE_INVALID' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    WITH frames AS (
      SELECT (value ->> 'frame_number')::integer AS frame_number,
             (value ->> 'timestamp_seconds')::numeric AS timestamp_seconds
        FROM jsonb_array_elements(_payload -> 'visual_moments')
    ), ordered AS (
      SELECT *, lag(timestamp_seconds) OVER (ORDER BY frame_number) AS previous_timestamp FROM frames
    )
    SELECT 1 FROM ordered
     WHERE previous_timestamp IS NOT NULL
       AND (timestamp_seconds <= previous_timestamp
         OR timestamp_seconds - previous_timestamp > GREATEST(8, _duration / 20))
  ) THEN
    RAISE EXCEPTION 'CODEX_MANUAL_VISUAL_DENSITY_INVALID' USING ERRCODE = '22023';
  END IF;

  -- All block layers and their explicit transcript/frame references are
  -- mandatory. Manual evidence is never accepted with a Gemini source label.
  IF EXISTS (
    WITH blocks AS (
      SELECT ordinality::integer AS expected_index, source.value,
             (source.value ->> 'index')::integer AS index,
             source.value ->> 'type' AS type,
             (source.value ->> 'start')::numeric AS start,
             (source.value ->> 'end')::numeric AS "end"
        FROM jsonb_array_elements(_payload -> 'blocks') WITH ORDINALITY AS source(value, ordinality)
    )
    SELECT 1 FROM blocks
     WHERE index <> expected_index
        OR type NOT IN ('hook','setup','desenvolvimento','tensao','revelacao','payoff','transicao','loop')
        OR start < 0 OR "end" <= start
        OR "end" > _duration + GREATEST(0.5, _duration * 0.01)
        OR NULLIF(btrim(value ->> 'text'), '') IS NULL
        OR NULLIF(btrim(value ->> 'narrative_function'), '') IS NULL
        OR value ->> 'evidence_scope' NOT IN ('visual_confirmed','mixed','narration_only')
        OR value ->> 'schema_emotion' NOT IN ('curiosidade','surpresa','medo','tensao','alivio','expectativa','impacto')
        OR jsonb_typeof(value -> 'transcript_segment_indexes') <> 'array'
        OR jsonb_array_length(value -> 'transcript_segment_indexes') < 1
        OR jsonb_typeof(value -> 'evidence_frame_numbers') <> 'array'
        OR jsonb_array_length(value -> 'evidence_frame_numbers') < 1
        OR COALESCE((value ->> 'representative_frame_number')::integer, 0) < 1
        OR NULLIF(btrim(value ->> 'representative_frame_path'), '') IS NULL
        OR NULLIF(btrim(value ->> 'representative_source_local_path'), '') IS NULL
        OR jsonb_typeof(value -> 'visual') <> 'object'
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
        OR jsonb_typeof(value -> 'alignment') <> 'object'
        OR jsonb_typeof(value -> 'compatibility') <> 'object'
        OR COALESCE((value #>> '{alignment,alignment_score}')::integer, 100) >= 100
        OR COALESCE((value #>> '{compatibility,compatibility_score}')::integer, 100) >= 100
        OR (
          value ->> 'evidence_scope' = 'narration_only'
          AND (
            COALESCE((value #>> '{alignment,action_alignment_score}')::integer, 100) > 30
            OR COALESCE((value #>> '{compatibility,compatibility_score}')::integer, 100) > 45
            OR COALESCE((value #>> '{compatibility,text_requires_visual_boost}')::boolean, false) IS NOT true
            OR COALESCE((value #>> '{compatibility,visual_underpowered}')::boolean, false) IS NOT true
          )
        )
        OR (
          value ->> 'evidence_scope' = 'mixed'
          AND COALESCE((value #>> '{compatibility,compatibility_score}')::integer, 100) > 80
        )
  ) THEN
    RAISE EXCEPTION 'CODEX_MANUAL_BLOCK_SCHEMA_INVALID' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    WITH block_frames AS (
      SELECT block.value AS block,
             (frame_number.value #>> '{}')::integer AS frame_number
        FROM jsonb_array_elements(_payload -> 'blocks') AS block(value)
        CROSS JOIN LATERAL jsonb_array_elements(block.value -> 'evidence_frame_numbers') AS frame_number(value)
    )
    SELECT 1 FROM block_frames
     WHERE frame_number < 1 OR frame_number > _frame_count
  ) OR EXISTS (
    SELECT 1
      FROM jsonb_array_elements(_payload -> 'blocks') AS block(value)
      LEFT JOIN jsonb_array_elements(_payload -> 'visual_moments') AS frame(value)
        ON (frame.value ->> 'frame_number')::integer = (block.value ->> 'representative_frame_number')::integer
       AND frame.value ->> 'file_path' = block.value ->> 'representative_frame_path'
       AND frame.value ->> 'source_local_path' = block.value ->> 'representative_source_local_path'
     WHERE frame.value IS NULL
  ) THEN
    RAISE EXCEPTION 'CODEX_MANUAL_BLOCK_FRAME_REFERENCE_INVALID' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    WITH used AS (
      SELECT (segment_index.value #>> '{}')::integer AS segment_index, count(*) AS uses
        FROM jsonb_array_elements(_payload -> 'blocks') AS block(value)
        CROSS JOIN LATERAL jsonb_array_elements(block.value -> 'transcript_segment_indexes') AS segment_index(value)
       GROUP BY 1
    )
    SELECT 1 FROM used WHERE segment_index < 0 OR segment_index >= _transcript_count OR uses <> 1
  ) OR (SELECT count(*) FROM (
    SELECT DISTINCT (segment_index.value #>> '{}')::integer
      FROM jsonb_array_elements(_payload -> 'blocks') AS block(value)
      CROSS JOIN LATERAL jsonb_array_elements(block.value -> 'transcript_segment_indexes') AS segment_index(value)
  ) AS used) <> _transcript_count THEN
    RAISE EXCEPTION 'CODEX_MANUAL_TRANSCRIPT_BLOCK_COVERAGE_INVALID' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    WITH linked AS (
      SELECT (block.value ->> 'index')::integer AS block_index,
             (block.value ->> 'start')::numeric AS block_start,
             (block.value ->> 'end')::numeric AS block_end,
             (segment_index.value #>> '{}')::integer AS segment_index
        FROM jsonb_array_elements(_payload -> 'blocks') AS block(value)
        CROSS JOIN LATERAL jsonb_array_elements(block.value -> 'transcript_segment_indexes') AS segment_index(value)
    ), transcript AS (
      SELECT (value ->> 'index')::integer AS segment_index,
             (value ->> 'start')::numeric AS segment_start,
             (value ->> 'end')::numeric AS segment_end
        FROM jsonb_array_elements(_payload -> 'transcript')
    )
    SELECT 1 FROM linked JOIN transcript USING (segment_index)
     WHERE segment_start < block_start - GREATEST(0.5, _duration * 0.01)
        OR segment_end > block_end + GREATEST(0.5, _duration * 0.01)
  ) THEN
    RAISE EXCEPTION 'CODEX_MANUAL_TRANSCRIPT_INTERVAL_NOT_CONTAINED' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    WITH expected AS (
      SELECT (block.value ->> 'index')::integer AS block_index,
             block.value ->> 'text' AS block_text,
             string_agg(btrim(transcript.value ->> 'text'), ' ' ORDER BY segment_ref.ordinality) AS exact_speech
        FROM jsonb_array_elements(_payload -> 'blocks') AS block(value)
        CROSS JOIN LATERAL jsonb_array_elements(block.value -> 'transcript_segment_indexes')
          WITH ORDINALITY AS segment_ref(value, ordinality)
        JOIN jsonb_array_elements(_payload -> 'transcript') AS transcript(value)
          ON (transcript.value ->> 'index')::integer = (segment_ref.value #>> '{}')::integer
       GROUP BY block.value
    )
    SELECT 1 FROM expected WHERE block_text IS DISTINCT FROM exact_speech
  ) THEN
    RAISE EXCEPTION 'CODEX_MANUAL_BLOCK_TEXT_NOT_EXACT_TRANSCRIPT' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(_payload -> 'blocks') AS block(value)
      CROSS JOIN LATERAL jsonb_array_elements_text(block.value #> '{semantic,keywords}') AS keyword(value)
     WHERE translate(lower(keyword.value), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')
       <> ALL (regexp_split_to_array(
         translate(lower(block.value ->> 'text'), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
         '[^a-z0-9]+'
       ))
  ) THEN
    RAISE EXCEPTION 'CODEX_MANUAL_KEYWORD_NOT_IN_SPOKEN_BLOCK' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(_payload -> 'blocks') AS block(value)
      CROSS JOIN LATERAL jsonb_array_elements_text(block.value #> '{semantic,strong_phrases}') AS phrase(value)
     WHERE position(
       regexp_replace(translate(lower(phrase.value), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), E'\\s+', ' ', 'g')
       IN regexp_replace(translate(lower(block.value ->> 'text'), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), E'\\s+', ' ', 'g')
     ) = 0
  ) THEN
    RAISE EXCEPTION 'CODEX_MANUAL_STRONG_PHRASE_NOT_IN_SPOKEN_BLOCK' USING ERRCODE = '22023';
  END IF;
  -- Every text-bearing semantic/verbal layer is injected into the generation
  -- context. Therefore every value, not only the headline keyword/phrase
  -- arrays, must be a contiguous piece of the exact spoken block.
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
     WHERE NULLIF(regexp_replace(
             translate(lower(term.value), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
             '[^a-z0-9]+', ' ', 'g'
           ), '') IS NULL
        OR position(
          ' ' || regexp_replace(
            translate(lower(term.value), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
            '[^a-z0-9]+', ' ', 'g'
          ) || ' '
          IN ' ' || regexp_replace(
            translate(lower(block.value ->> 'text'), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
            '[^a-z0-9]+', ' ', 'g'
          ) || ' '
        ) = 0
  ) THEN
    RAISE EXCEPTION 'CODEX_MANUAL_SEMANTIC_OR_TRIGGER_NOT_IN_SPOKEN_BLOCK' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    WITH blocks AS (
      SELECT (value ->> 'index')::integer AS index, value ->> 'type' AS type
        FROM jsonb_array_elements(_payload -> 'blocks')
    )
    SELECT 1 FROM blocks hook
      JOIN blocks development ON development.type = 'desenvolvimento' AND development.index > hook.index
      JOIN blocks payoff ON payoff.type = 'payoff' AND payoff.index > development.index
     WHERE hook.type = 'hook' AND hook.index = 1
  ) THEN
    RAISE EXCEPTION 'CODEX_MANUAL_NARRATIVE_CHAIN_INVALID' USING ERRCODE = '22023';
  END IF;
  SELECT value ->> 'text', value ->> 'schema_emotion'
    INTO _expected_payoff_text, _expected_payoff_emotion
    FROM jsonb_array_elements(_payload -> 'blocks') AS block(value)
   WHERE value ->> 'type' = 'payoff'
   ORDER BY (value ->> 'index')::integer DESC
   LIMIT 1;
  IF _payload #>> '{summary,hook_text}' IS DISTINCT FROM _payload #>> '{blocks,0,text}'
     OR _payload #>> '{summary,hook_emotion}' IS DISTINCT FROM _payload #>> '{blocks,0,schema_emotion}'
     OR _payload #>> '{summary,payoff_text}' IS DISTINCT FROM _expected_payoff_text
     OR _payload #>> '{summary,payoff_emotion}' IS DISTINCT FROM _expected_payoff_emotion
     OR COALESCE(abs(
          (_payload #>> '{summary,hook_duration}')::numeric
          - ((_payload #>> '{blocks,0,end}')::numeric - (_payload #>> '{blocks,0,start}')::numeric)
        ) > 0.001, true) THEN
    RAISE EXCEPTION 'CODEX_MANUAL_SUMMARY_MUST_MATCH_EXACT_SPOKEN_BLOCKS' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    WITH blocks AS (
      SELECT (value ->> 'index')::integer AS index,
             (value ->> 'start')::numeric AS start,
             (value ->> 'end')::numeric AS "end"
        FROM jsonb_array_elements(_payload -> 'blocks')
    ), ordered AS (
      SELECT *, lag("end") OVER (ORDER BY index) AS previous_end FROM blocks
    )
    SELECT 1 FROM ordered
     WHERE (index = 1 AND start > GREATEST(2, _duration * 0.1))
        OR (previous_end IS NOT NULL AND (start - previous_end > 3
          OR previous_end - start > GREATEST(0.25, LEAST(1, _duration * 0.005))))
  ) OR EXISTS (
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
               - COALESCE(sum(GREATEST(previous_end - start, 0)), 0) AS union_coverage
        FROM ordered
    )
    SELECT 1 FROM metrics
     WHERE total_gap > GREATEST(5, _duration * 0.1)
        OR total_overlap > GREATEST(1, _duration * 0.02)
        OR union_coverage / _duration < 0.85
  ) OR (SELECT max((value ->> 'end')::numeric) FROM jsonb_array_elements(_payload -> 'blocks')) < _duration * 0.9 THEN
    RAISE EXCEPTION 'CODEX_MANUAL_BLOCK_TIMELINE_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT metadata.video_id)
    INTO _video_ids
    FROM public.video_metadata AS metadata
   WHERE (metadata.chave = 'youtube_id' AND metadata.valor = _youtube_id)
      OR (metadata.chave = 'source_idempotency_key' AND metadata.valor = 'youtube:' || _youtube_id);
  IF COALESCE(cardinality(_video_ids), 0) <> 1 THEN
    RAISE EXCEPTION 'CODEX_MANUAL_VIDEO_LOOKUP_NOT_UNIQUE' USING ERRCODE = 'P0002';
  END IF;
  _video_id := _video_ids[1];
  PERFORM 1 FROM public.videos WHERE id = _video_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VIDEO_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  -- Invalidate any old Gemini lease while holding the video lock. A delayed
  -- commit_video_multimodal_analysis then observes MULTIMODAL_CLAIM_LOST and
  -- cannot overwrite this manual audit after the transaction commits.
  DELETE FROM public.video_metadata
   WHERE video_id = _video_id AND chave = 'multimodal_processing_claim';

  SELECT EXISTS (
    SELECT 1 FROM public.video_metadata
     WHERE video_id = _video_id AND chave = 'codex_manual_audit_payload_sha256'
       AND valor = _payload_sha256
  ) INTO _already_committed;

  -- Replay always reconstructs every row from the validated immutable payload.
  -- Therefore a row-level mutation cannot hide behind unchanged table counts.
    DELETE FROM public.video_frames WHERE video_id = _video_id;
    DELETE FROM public.video_transcripts WHERE video_id = _video_id;
    DELETE FROM public.video_blocks WHERE video_id = _video_id;
    DELETE FROM public.video_languages WHERE video_id = _video_id;
    DELETE FROM public.video_metadata
     WHERE video_id = _video_id
       AND chave IN ('multimodal_visual_analysis','codex_manual_visual_analysis');

    INSERT INTO public.video_transcripts (
      video_id, tempo_inicio, tempo_fim, duracao, texto, language_code
    )
    SELECT _video_id, item.start, item."end", item.duration, item.text, 'pt'
      FROM jsonb_array_elements(_payload -> 'transcript') AS source(value)
      CROSS JOIN LATERAL jsonb_to_record(source.value) AS item(
        index integer, start numeric, "end" numeric, duration numeric, text text
      )
     ORDER BY item.index;

    FOR _block IN
      SELECT value FROM jsonb_array_elements(_payload -> 'blocks')
       ORDER BY (value ->> 'index')::integer
    LOOP
      INSERT INTO public.video_blocks (
        video_id, bloco_id, tempo_inicio, tempo_fim, texto, frame_url,
        tipo_bloco, funcao_narrativa, emocao, elemento_visual,
        descricao_visual, language_code, block_density_score,
        semantic_shift_score, visual_shift_score
      ) VALUES (
        _video_id,
        (_block ->> 'index')::integer,
        (_block ->> 'start')::numeric,
        (_block ->> 'end')::numeric,
        _block ->> 'text',
        _block ->> 'representative_frame_path',
        (_block ->> 'type')::public.tipo_bloco,
        _block ->> 'narrative_function',
        (_block ->> 'schema_emotion')::public.emocao,
        _block #>> '{visual,main_action}',
        _block #>> '{visual,scene_description}',
        'pt',
        LEAST(100, GREATEST(0, round(50 * (_duration / _block_count) /
          GREATEST(0.1, (_block ->> 'end')::numeric - (_block ->> 'start')::numeric)))),
        CASE WHEN (_block ->> 'index')::integer = 1 THEN 100 ELSE 70 END,
        LEAST(100, GREATEST(0, COALESCE((_block #>> '{visual,avg_visual_intensity_score}')::numeric, 0)))
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
        _block ->> 'representative_frame_path',
        (_block ->> 'representative_timestamp')::numeric,
        _block #>> '{visual,scene_description}', _block #>> '{visual,main_action}',
        _block #> '{visual,main_objects}',
        (_block #>> '{visual,human_presence}')::boolean,
        (_block #>> '{visual,animal_presence}')::boolean,
        (_block #>> '{visual,text_on_screen_presence}')::boolean,
        _block #>> '{visual,visual_intensity_level}',
        (_block #>> '{visual,scene_change_detected}')::boolean,
        (_block #>> '{visual,scene_change_count}')::integer,
        (_block #>> '{visual,avg_visual_intensity_score}')::integer,
        _block #>> '{visual,visual_emotion}', _source_type, 100,
        'manual_' || (_block ->> 'evidence_scope')
      );

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
        SELECT value FROM jsonb_array_elements_text(_block #> '{semantic,keywords}') AS keyword(value)
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
          (_block ->> 'start')::numeric,
          (_block ->> 'end')::numeric
        );
      END LOOP;

      FOR _phrase IN
        SELECT value FROM jsonb_array_elements_text(_block #> '{semantic,strong_phrases}') AS phrase(value)
      LOOP
        INSERT INTO public.block_phrase_patterns (
          video_id, block_id, block_type, phrase, phrase_type,
          phrase_category, is_emotional, is_repeated, is_strong,
          phrase_length, phrase_position, phrase_strength_score, weighted_score
        ) VALUES (
          _video_id, _block_id, _block ->> 'type', _phrase,
          _block ->> 'type', _block ->> 'evidence_scope',
          jsonb_array_length(_block #> '{semantic,emotional_words}') > 0,
          false, true,
          cardinality(regexp_split_to_array(btrim(_phrase), E'\\s+')),
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
        100, _source_type, 'manual_' || (_block ->> 'evidence_scope')
      );

      INSERT INTO public.text_visual_alignment (
        video_id, block_id, text_action, visual_action, text_emotion,
        visual_emotion, alignment_score, action_alignment_score,
        emotion_alignment_score, intensity_alignment_score,
        data_source_type, confidence_score, origin_level
      ) VALUES (
        _video_id, _block_id, _block #>> '{alignment,text_action}',
        _block #>> '{alignment,visual_action}', _block #>> '{alignment,text_emotion}',
        _block #>> '{alignment,visual_emotion}',
        (_block #>> '{alignment,alignment_score}')::integer,
        (_block #>> '{alignment,action_alignment_score}')::integer,
        (_block #>> '{alignment,emotion_alignment_score}')::integer,
        (_block #>> '{alignment,intensity_alignment_score}')::integer,
        _source_type, 100, 'manual_' || (_block ->> 'evidence_scope')
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
        (_block #>> '{compatibility,semantic_coherence_score}')::integer,
        (_block #>> '{compatibility,contradiction_detected}')::boolean,
        (_block #>> '{compatibility,visual_overload_detected}')::boolean,
        100, _block #>> '{compatibility,block_type}',
        (_block #>> '{compatibility,text_intensity_score}')::integer,
        (_block #>> '{compatibility,visual_intensity_score_calc}')::integer,
        (_block #>> '{compatibility,intensity_gap}')::integer,
        (_block #>> '{compatibility,text_requires_visual_boost}')::boolean,
        (_block #>> '{compatibility,visual_underpowered}')::boolean,
        (_block #>> '{compatibility,visual_overpowered}')::boolean,
        (_block #>> '{compatibility,emotional_match_score}')::integer,
        (_block #>> '{compatibility,action_match_score}')::integer,
        (_block #>> '{compatibility,curiosity_match_score}')::integer,
        (_block #>> '{compatibility,reveal_match_score}')::integer,
        (_block #>> '{compatibility,compatibility_score}')::integer,
        _block #>> '{compatibility,compatibility_label}',
        _block #>> '{compatibility,compatibility_reason}',
        _block #>> '{compatibility,recommended_visual_direction}',
        _source_type, 'manual_' || (_block ->> 'evidence_scope')
      );
    END LOOP;

    INSERT INTO public.video_frames (
      video_id, block_id, frame_number, timestamp_seconds, file_path, frame_hash,
      frame_role, source_method, scene_change_flag, visual_intensity_score
    )
    SELECT _video_id,
           (SELECT block.id FROM public.video_blocks AS block
             WHERE block.video_id = _video_id
             ORDER BY CASE WHEN frame.timestamp_seconds BETWEEN block.tempo_inicio AND block.tempo_fim THEN 0 ELSE 1 END,
                      abs(frame.timestamp_seconds - ((block.tempo_inicio + block.tempo_fim) / 2))
             LIMIT 1),
           frame.frame_number, frame.timestamp_seconds, frame.file_path,
           frame.frame_hash, frame.frame_role, _source_type,
           frame.scene_change_flag, frame.visual_intensity_score
      FROM jsonb_array_elements(_payload -> 'visual_moments') AS source(value)
      CROSS JOIN LATERAL jsonb_to_record(source.value) AS frame(
        frame_number integer, timestamp_seconds numeric, file_path text,
        frame_hash text, frame_role text, scene_change_flag boolean,
        visual_intensity_score integer
      )
     ORDER BY frame.frame_number;

    INSERT INTO public.video_languages (video_id, language_code, is_original)
    VALUES (_video_id, 'pt', true);

    INSERT INTO public.video_metadata (video_id, chave, valor)
    VALUES
      (_video_id, 'codex_manual_visual_analysis', (_payload -> 'visual_moments')::text),
      (_video_id, 'analysis_source', _analysis_source),
      (_video_id, 'codex_manual_audit_payload_sha256', _payload_sha256),
      (_video_id, 'codex_manual_audit_manifest_sha256', _manifest_sha256),
      (_video_id, 'codex_manual_audit_source_artifacts', (_payload -> 'source')::text)
    ON CONFLICT (video_id, chave) DO UPDATE
      SET valor = EXCLUDED.valor, created_at = clock_timestamp();

    UPDATE public.videos
       SET titulo = _payload ->> 'title',
           origem = _payload ->> 'source_url',
           duracao = _duration,
           idioma = 'pt',
           status = 'completed',
           numero_frames = _frame_count,
           numero_blocos = _block_count,
           gancho_detectado = true,
           tipo_gancho = CASE
             WHEN _payload #>> '{blocks,0,evidence_scope}' = 'visual_confirmed' THEN 'visual'::public.tipo_gancho
             ELSE 'texto'::public.tipo_gancho
           END,
           tempo_gancho = (_payload #>> '{blocks,0,start}')::numeric,
           duracao_gancho = (_payload #>> '{summary,hook_duration}')::numeric,
           emocao_predominante = (_payload #>> '{summary,dominant_emotion}')::public.emocao,
           intensidade_emocional = 'alta',
           tempo_primeiro_evento = (_payload #>> '{visual_moments,0,timestamp_seconds}')::numeric,
           tempo_primeira_revelacao = (SELECT min((value ->> 'start')::numeric)
             FROM jsonb_array_elements(_payload -> 'blocks') WHERE value ->> 'type' = 'revelacao'),
           tempo_payoff = (SELECT min((value ->> 'start')::numeric)
             FROM jsonb_array_elements(_payload -> 'blocks') WHERE value ->> 'type' = 'payoff'),
           loop_detectado = EXISTS (SELECT 1 FROM jsonb_array_elements(_payload -> 'blocks') WHERE value ->> 'type' = 'loop'),
           tipo_viral = 'codex_manual_audit',
           first_impact_time = (_payload #>> '{blocks,0,representative_timestamp}')::numeric,
           hook_text = _payload #>> '{summary,hook_text}',
           hook_keywords = _payload #> '{blocks,0,semantic,keywords}',
           hook_phrase_pattern = _payload #>> '{blocks,0,verbal,phrase_pattern}',
           hook_type_verbal = 'spoken_' || (_payload #>> '{blocks,0,evidence_scope}'),
           hook_emotion_verbal = _payload #>> '{summary,hook_emotion}',
           hook_emotion_intensity = (_payload #>> '{blocks,0,verbal,emotional_intensity}')::numeric,
           narrative_progression_type = 'manual_evidence_linked',
           micro_turn_count = _block_count - 1,
           micro_turn_types = (SELECT jsonb_agg(value ->> 'type') FROM jsonb_array_elements(_payload -> 'blocks')),
           payoff_text = _payload #>> '{summary,payoff_text}',
           payoff_type = 'revelacao',
           payoff_emotion = _payload #>> '{summary,payoff_emotion}',
           avg_alignment_score = (_payload #>> '{summary,avg_alignment_score}')::numeric,
           block_segmentation_version = 'codex_manual_audit_v1',
           approved_for_global = true
     WHERE id = _video_id;

    INSERT INTO public.processing_queue (
      video_id, status, completed_at, error_message, priority
    ) VALUES (_video_id, 'completed', clock_timestamp(), NULL, 100)
    ON CONFLICT (video_id) DO UPDATE
      SET status = 'completed', completed_at = clock_timestamp(),
          error_message = NULL, priority = GREATEST(public.processing_queue.priority, 100);

    INSERT INTO public.video_logs (video_id, etapa, status, mensagem)
    VALUES (
      _video_id, 'Codex manual multimodal audit', 'success',
      format('%s transcripts, %s reviewed frames, %s blocks and seven exact derived layers; payload=%s',
        _transcript_count, _frame_count, _block_count, _payload_sha256)
    );

    SELECT count(DISTINCT block_id) INTO _word_pattern_blocks
      FROM public.block_word_patterns WHERE video_id = _video_id;
    SELECT count(DISTINCT block_id) INTO _phrase_pattern_blocks
      FROM public.block_phrase_patterns WHERE video_id = _video_id;
    IF _word_pattern_blocks <> _block_count OR _phrase_pattern_blocks <> _block_count THEN
      RAISE EXCEPTION 'CODEX_MANUAL_GRANULAR_SPEECH_PATTERN_COVERAGE_INVALID' USING ERRCODE = '23514';
    END IF;
  RETURN jsonb_build_object(
    'youtube_id', _youtube_id,
    'video_id', _video_id,
    'already_committed', false,
    'same_payload_replayed', _already_committed,
    'source_type', _source_type,
    'analysis_source', _analysis_source,
    'payload_sha256', _payload_sha256,
    'manifest_sha256', _manifest_sha256,
    'transcript_count', _transcript_count,
    'frame_count', _frame_count,
    'block_count', _block_count,
    'visual_layer_count', _block_count,
    'semantic_layer_count', _block_count,
    'word_pattern_block_count', _word_pattern_blocks,
    'phrase_pattern_block_count', _phrase_pattern_blocks,
    'verbal_layer_count', _block_count,
    'alignment_layer_count', _block_count,
    'compatibility_layer_count', _block_count,
    'claim_invalidated', true,
    'atomic', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.commit_codex_manual_audited_video(text, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_codex_manual_audited_video(text, jsonb, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.commit_codex_manual_audited_video(text, jsonb, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.commit_codex_manual_audited_video(text, jsonb, text, text) TO service_role;

COMMENT ON FUNCTION public.commit_codex_manual_audited_video(text, jsonb, text, text) IS
  'Validates and atomically commits one of the exact 16 Codex manual multimodal audits, invalidating stale Gemini claims first.';
