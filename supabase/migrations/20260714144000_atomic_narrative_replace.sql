-- Fail-closed, transactional replacement for analyze-narrative.
-- The Edge function must never delete a valid narrative before all replacement
-- rows and structural fields have passed database-side validation.

CREATE OR REPLACE FUNCTION public.replace_video_narrative_atomic(
  p_video_id uuid,
  p_blocks jsonb,
  p_video_update jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_claim_role text := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
  v_source_duration numeric;
  v_count integer;
  v_first_start numeric;
  v_last_end numeric;
  v_total_gap numeric;
  v_total_overlap numeric;
  v_covered numeric;
  v_overlap_tolerance numeric;
  v_expected_hook_text text;
  v_expected_payoff_text text;
BEGIN
  IF v_claim_role <> 'service_role' AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_video_id IS NULL OR jsonb_typeof(p_blocks) <> 'array'
     OR jsonb_typeof(p_video_update) <> 'object' THEN
    RAISE EXCEPTION 'NARRATIVE_ATOMIC_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT v.duracao
    INTO v_source_duration
    FROM public.videos AS v
   WHERE v.id = p_video_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VIDEO_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_source_duration IS NULL OR v_source_duration <= 0 OR v_source_duration > 3600 THEN
    RAISE EXCEPTION 'AUTHORITATIVE_VIDEO_DURATION_INVALID' USING ERRCODE = '22023';
  END IF;

  v_count := jsonb_array_length(p_blocks);
  IF v_count < 3 OR v_count > 18 THEN
    RAISE EXCEPTION 'NARRATIVE_BLOCK_COUNT_INVALID: %', v_count USING ERRCODE = '22023';
  END IF;
  IF COALESCE((p_video_update ->> 'numero_blocos')::integer, -1) <> v_count THEN
    RAISE EXCEPTION 'NARRATIVE_BLOCK_COUNT_MISMATCH' USING ERRCODE = '22023';
  END IF;
  IF p_video_update ? 'duracao' THEN
    RAISE EXCEPTION 'AUTHORITATIVE_DURATION_IS_IMMUTABLE_HERE' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_object_keys(p_video_update) AS key(name)
     WHERE key.name <> ALL (ARRAY[
       'numero_blocos','gancho_detectado','tipo_gancho','tempo_gancho','duracao_gancho',
       'emocao_predominante','intensidade_emocional','tempo_primeiro_evento',
       'tempo_primeira_revelacao','tempo_payoff','loop_detectado','tipo_viral',
       'segmento_ia','confianca_segmento','estilo_visual_ia','confianca_estilo',
       'segmento','estilo_visual','first_impact_time','hook_text','hook_keywords',
       'hook_phrase_pattern','hook_type_verbal','hook_emotion_verbal',
       'hook_emotion_intensity','narrative_progression_type','micro_turn_count',
       'micro_turn_types','payoff_text','payoff_type','payoff_emotion','cta_text',
       'cta_type','cta_position_time','status','block_segmentation_version'
     ]::text[])
  ) THEN
    RAISE EXCEPTION 'NARRATIVE_VIDEO_UPDATE_KEY_NOT_ALLOWED' USING ERRCODE = '22023';
  END IF;
  -- The caller supplies an analysis envelope, not a PATCH document.  Treating
  -- omitted fields as NULL silently erased a previous valid analysis when a
  -- buggy/internal caller sent a partial payload.
  IF EXISTS (
    SELECT 1
      FROM unnest(ARRAY[
        'numero_blocos','gancho_detectado','tipo_gancho','tempo_gancho','duracao_gancho',
        'emocao_predominante','intensidade_emocional','tempo_primeiro_evento',
        'tempo_primeira_revelacao','tempo_payoff','loop_detectado','tipo_viral',
        'segmento_ia','confianca_segmento','estilo_visual_ia','confianca_estilo',
        'first_impact_time','hook_text','hook_keywords','hook_phrase_pattern',
        'hook_type_verbal','hook_emotion_verbal','hook_emotion_intensity',
        'narrative_progression_type','micro_turn_count','micro_turn_types',
        'payoff_text','payoff_type','payoff_emotion','cta_text','cta_type',
        'cta_position_time','status','block_segmentation_version'
      ]::text[]) AS required_key(name)
     WHERE NOT (p_video_update ? required_key.name)
  ) THEN
    RAISE EXCEPTION 'NARRATIVE_VIDEO_UPDATE_INCOMPLETE' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_blocks) AS b(
        bloco_id integer, tipo_bloco text, tempo_inicio numeric, tempo_fim numeric,
        texto text, emocao text, funcao_narrativa text, language_code text,
        block_density_score numeric, semantic_shift_score numeric, visual_shift_score numeric
      )
     WHERE b.bloco_id IS NULL OR b.tipo_bloco IS NULL
        OR b.tipo_bloco NOT IN ('hook','setup','desenvolvimento','tensao','revelacao','payoff','transicao','loop')
        OR b.tempo_inicio IS NULL OR b.tempo_fim IS NULL
        OR b.tempo_inicio < 0 OR b.tempo_fim <= b.tempo_inicio
        OR b.tempo_fim > v_source_duration + GREATEST(0.5, v_source_duration * 0.01)
        OR NULLIF(btrim(b.texto), '') IS NULL
        OR b.emocao NOT IN ('curiosidade','surpresa','medo','tensao','alivio','expectativa','impacto')
        OR NULLIF(btrim(b.funcao_narrativa), '') IS NULL
        OR NULLIF(btrim(b.language_code), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'NARRATIVE_BLOCK_SCHEMA_OR_TIMELINE_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Exact 1..N ids prevent duplicate or missing narrative positions.
  IF EXISTS (
    WITH parsed AS (
      SELECT b.bloco_id, row_number() OVER (ORDER BY b.bloco_id)::integer AS expected_id
        FROM jsonb_to_recordset(p_blocks) AS b(bloco_id integer)
    )
    SELECT 1 FROM parsed WHERE bloco_id <> expected_id
  ) THEN
    RAISE EXCEPTION 'NARRATIVE_BLOCK_IDS_NOT_SEQUENTIAL' USING ERRCODE = '22023';
  END IF;

  WITH parsed AS (
    SELECT *
      FROM jsonb_to_recordset(p_blocks) AS b(
        bloco_id integer, tipo_bloco text, tempo_inicio numeric, tempo_fim numeric
      )
  ), ordered AS (
    SELECT *, lag(tempo_fim) OVER (ORDER BY bloco_id) AS previous_end
      FROM parsed
  )
  SELECT min(tempo_inicio) FILTER (WHERE bloco_id = 1),
         max(tempo_fim),
         COALESCE(sum(GREATEST(tempo_inicio - previous_end, 0)), 0),
         COALESCE(sum(GREATEST(previous_end - tempo_inicio, 0)), 0),
         COALESCE(sum(tempo_fim - tempo_inicio), 0)
           - COALESCE(sum(GREATEST(previous_end - tempo_inicio, 0)), 0)
    INTO v_first_start, v_last_end, v_total_gap, v_total_overlap, v_covered
    FROM ordered;
  v_overlap_tolerance := GREATEST(0.25, LEAST(1, v_source_duration * 0.005));

  IF v_first_start > GREATEST(2, v_source_duration * 0.1)
     OR v_last_end < v_source_duration * 0.9
     OR v_total_gap > GREATEST(5, v_source_duration * 0.1)
     OR v_total_overlap > GREATEST(1, v_source_duration * 0.02)
     OR v_covered / v_source_duration < 0.85
     OR EXISTS (
       WITH parsed AS (
         SELECT b.bloco_id, b.tempo_inicio, b.tempo_fim,
                lag(b.tempo_fim) OVER (ORDER BY b.bloco_id) AS previous_end
           FROM jsonb_to_recordset(p_blocks) AS b(
             bloco_id integer, tempo_inicio numeric, tempo_fim numeric
           )
       )
       SELECT 1 FROM parsed
        WHERE previous_end IS NOT NULL
          AND (tempo_inicio - previous_end > 3 OR previous_end - tempo_inicio > v_overlap_tolerance)
     ) THEN
    RAISE EXCEPTION 'NARRATIVE_TIMELINE_CONTRACT_INVALID' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    WITH parsed AS (
      SELECT b.bloco_id, b.tipo_bloco
        FROM jsonb_to_recordset(p_blocks) AS b(bloco_id integer, tipo_bloco text)
    )
    SELECT 1
      FROM parsed hook
      JOIN parsed development ON development.tipo_bloco = 'desenvolvimento'
      JOIN parsed payoff ON payoff.tipo_bloco = 'payoff'
     WHERE hook.tipo_bloco = 'hook' AND hook.bloco_id = 1
       AND development.bloco_id > hook.bloco_id
       AND payoff.bloco_id > development.bloco_id
  ) THEN
    RAISE EXCEPTION 'NARRATIVE_CHAIN_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT value ->> 'texto'
    INTO v_expected_hook_text
    FROM jsonb_array_elements(p_blocks) WITH ORDINALITY AS block(value, ordinality)
   WHERE ordinality = 1
     AND value ->> 'tipo_bloco' = 'hook';
  SELECT value ->> 'texto'
    INTO v_expected_payoff_text
    FROM jsonb_array_elements(p_blocks) AS block(value)
   WHERE value ->> 'tipo_bloco' = 'payoff'
   ORDER BY (value ->> 'bloco_id')::integer DESC
   LIMIT 1;
  IF p_video_update ->> 'hook_text' IS DISTINCT FROM v_expected_hook_text
     OR p_video_update ->> 'payoff_text' IS DISTINCT FROM v_expected_payoff_text THEN
    RAISE EXCEPTION 'NARRATIVE_HOOK_OR_PAYOFF_MUST_MATCH_EXACT_BLOCK_TEXT' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.video_blocks WHERE video_id = p_video_id;
  INSERT INTO public.video_blocks (
    video_id, bloco_id, tipo_bloco, tempo_inicio, tempo_fim, texto, emocao,
    funcao_narrativa, language_code, block_density_score,
    semantic_shift_score, visual_shift_score
  )
  SELECT p_video_id, b.bloco_id, b.tipo_bloco::public.tipo_bloco,
         b.tempo_inicio, b.tempo_fim, b.texto, b.emocao::public.emocao,
         b.funcao_narrativa, b.language_code, b.block_density_score,
         b.semantic_shift_score, b.visual_shift_score
    FROM jsonb_to_recordset(p_blocks) AS b(
      bloco_id integer, tipo_bloco text, tempo_inicio numeric, tempo_fim numeric,
      texto text, emocao text, funcao_narrativa text, language_code text,
      block_density_score numeric, semantic_shift_score numeric, visual_shift_score numeric
    )
   ORDER BY b.bloco_id;

  UPDATE public.videos AS v
     SET numero_blocos = u.numero_blocos,
         gancho_detectado = u.gancho_detectado,
         tipo_gancho = u.tipo_gancho,
         tempo_gancho = u.tempo_gancho,
         duracao_gancho = u.duracao_gancho,
         emocao_predominante = u.emocao_predominante,
         intensidade_emocional = u.intensidade_emocional,
         tempo_primeiro_evento = u.tempo_primeiro_evento,
         tempo_primeira_revelacao = u.tempo_primeira_revelacao,
         tempo_payoff = u.tempo_payoff,
         loop_detectado = u.loop_detectado,
         tipo_viral = u.tipo_viral,
         segmento_ia = u.segmento_ia,
         confianca_segmento = u.confianca_segmento,
         estilo_visual_ia = u.estilo_visual_ia,
         confianca_estilo = u.confianca_estilo,
         segmento = CASE WHEN p_video_update ? 'segmento' THEN u.segmento ELSE v.segmento END,
         estilo_visual = CASE WHEN p_video_update ? 'estilo_visual' THEN u.estilo_visual ELSE v.estilo_visual END,
         first_impact_time = u.first_impact_time,
         hook_text = u.hook_text,
         hook_keywords = u.hook_keywords,
         hook_phrase_pattern = u.hook_phrase_pattern,
         hook_type_verbal = u.hook_type_verbal,
         hook_emotion_verbal = u.hook_emotion_verbal,
         hook_emotion_intensity = u.hook_emotion_intensity,
         narrative_progression_type = u.narrative_progression_type,
         micro_turn_count = u.micro_turn_count,
         micro_turn_types = u.micro_turn_types,
         payoff_text = u.payoff_text,
         payoff_type = u.payoff_type,
         payoff_emotion = u.payoff_emotion,
         cta_text = u.cta_text,
         cta_type = u.cta_type,
         cta_position_time = u.cta_position_time,
         status = u.status,
         block_segmentation_version = u.block_segmentation_version
    FROM jsonb_to_record(p_video_update) AS u(
      numero_blocos integer, gancho_detectado boolean, tipo_gancho public.tipo_gancho,
      tempo_gancho numeric, duracao_gancho numeric, emocao_predominante public.emocao,
      intensidade_emocional public.intensidade_emocional, tempo_primeiro_evento numeric,
      tempo_primeira_revelacao numeric, tempo_payoff numeric, loop_detectado boolean,
      tipo_viral text, segmento_ia text, confianca_segmento numeric,
      estilo_visual_ia text, confianca_estilo numeric, segmento public.video_segmento,
      estilo_visual public.video_estilo_visual, first_impact_time numeric,
      hook_text text, hook_keywords jsonb, hook_phrase_pattern text,
      hook_type_verbal text, hook_emotion_verbal text, hook_emotion_intensity numeric,
      narrative_progression_type text, micro_turn_count integer, micro_turn_types jsonb,
      payoff_text text, payoff_type text, payoff_emotion text, cta_text text,
      cta_type text, cta_position_time numeric, status public.processing_status,
      block_segmentation_version text
    )
   WHERE v.id = p_video_id;

  RETURN jsonb_build_object(
    'video_id', p_video_id,
    'blocks_count', jsonb_array_length(p_blocks),
    'source_duration', v_source_duration,
    'atomic', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.replace_video_narrative_atomic(uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_video_narrative_atomic(uuid, jsonb, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.replace_video_narrative_atomic(uuid, jsonb, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.replace_video_narrative_atomic(uuid, jsonb, jsonb) TO service_role;
