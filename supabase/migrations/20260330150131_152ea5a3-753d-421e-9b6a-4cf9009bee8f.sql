
-- ETAPA 1: block_verbal_analysis
CREATE TABLE public.block_verbal_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES public.video_blocks(id) ON DELETE CASCADE,
  full_text text,
  word_count integer DEFAULT 0,
  phrase_count integer DEFAULT 0,
  phrase_pattern text, -- pergunta, afirmacao, alerta, segredo, erro, proibicao, promessa, descoberta
  tone text, -- misterioso, urgente, emocional, tecnico, neutro, chocante
  trigger_words jsonb DEFAULT '[]'::jsonb,
  linguistic_density numeric,
  emotional_intensity integer DEFAULT 0,
  syntactic_complexity numeric,
  semantic_pressure_score numeric,
  confidence_score integer DEFAULT 0,
  data_source_type text NOT NULL DEFAULT 'ai_extraction',
  origin_level text NOT NULL DEFAULT 'calculated',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(video_id, block_id)
);
ALTER TABLE public.block_verbal_analysis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public all block_verbal_analysis" ON public.block_verbal_analysis FOR ALL TO public USING (true) WITH CHECK (true);

-- ETAPA 2: cta_deep_analysis
CREATE TABLE public.cta_deep_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  cta_text text,
  cta_position text, -- inicio, meio, final
  cta_type text, -- direto, indireto, emocional, racional, implicito
  cta_tone text, -- urgente, sugestivo, autoridade, curiosidade
  cta_target text, -- seguir, comentar, compartilhar, clicar, comprar
  cta_intensity integer DEFAULT 0,
  implicit_cta_detected boolean DEFAULT false,
  confidence_score integer DEFAULT 0,
  data_source_type text NOT NULL DEFAULT 'ai_extraction',
  origin_level text NOT NULL DEFAULT 'calculated',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cta_deep_analysis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public all cta_deep_analysis" ON public.cta_deep_analysis FOR ALL TO public USING (true) WITH CHECK (true);

-- ETAPA 3: viral_lexicon_global + viral_phrase_bank
CREATE TABLE public.viral_lexicon_global (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  word text NOT NULL UNIQUE,
  frequency_total integer DEFAULT 0,
  frequency_by_position jsonb DEFAULT '{}'::jsonb,
  narrative_position text,
  emotional_association text,
  performance_weighted_score numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.viral_lexicon_global ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public all viral_lexicon_global" ON public.viral_lexicon_global FOR ALL TO public USING (true) WITH CHECK (true);

CREATE TABLE public.viral_phrase_bank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phrase_text text NOT NULL,
  frequency_count integer DEFAULT 0,
  narrative_position text,
  emotional_trigger text,
  performance_weight numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(phrase_text, narrative_position)
);
ALTER TABLE public.viral_phrase_bank ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public all viral_phrase_bank" ON public.viral_phrase_bank FOR ALL TO public USING (true) WITH CHECK (true);

-- ETAPA 4: Add performance normalization columns to videos
ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS normalized_performance_score numeric,
  ADD COLUMN IF NOT EXISTS performance_z_score numeric,
  ADD COLUMN IF NOT EXISTS segment_adjusted_score numeric;

-- ETAPA 5: dna_base_v2
CREATE TABLE public.dna_base_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_name text NOT NULL DEFAULT 'DNA_BASE_V2',
  dominant_structure_sequence text,
  dominant_verbal_pattern text,
  dominant_cta_pattern text,
  dominant_emotional_arc text,
  avg_density numeric,
  verbal_density numeric,
  cta_distribution jsonb DEFAULT '{}'::jsonb,
  total_videos_used integer DEFAULT 0,
  total_blocks_used integer DEFAULT 0,
  dataset_type text NOT NULL DEFAULT 'completed_videos',
  segment_breakdown jsonb DEFAULT '{}'::jsonb,
  formula_registry_snapshot jsonb DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dna_base_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public all dna_base_v2" ON public.dna_base_v2 FOR ALL TO public USING (true) WITH CHECK (true);

-- ETAPA 6: performance_correlation
CREATE TABLE public.performance_correlation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type text NOT NULL, -- structural, verbal, visual, cta
  pattern_name text NOT NULL,
  correlation_with_views numeric,
  correlation_with_retention numeric,
  correlation_with_engagement numeric,
  confidence_score integer DEFAULT 0,
  sample_size integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(pattern_type, pattern_name)
);
ALTER TABLE public.performance_correlation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public all performance_correlation" ON public.performance_correlation FOR ALL TO public USING (true) WITH CHECK (true);

-- ETAPA 7: visual_emotion_sequence
CREATE TABLE public.visual_emotion_sequence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE UNIQUE,
  emotion_sequence jsonb DEFAULT '[]'::jsonb,
  sequence_string text,
  dominant_transition text,
  transition_count integer DEFAULT 0,
  confidence_score integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.visual_emotion_sequence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public all visual_emotion_sequence" ON public.visual_emotion_sequence FOR ALL TO public USING (true) WITH CHECK (true);

-- ETAPA 8: text_image_compatibility
CREATE TABLE public.text_image_compatibility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES public.video_blocks(id) ON DELETE CASCADE,
  semantic_coherence_score integer DEFAULT 0,
  contradiction_detected boolean DEFAULT false,
  visual_overload_detected boolean DEFAULT false,
  confidence_score integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(video_id, block_id)
);
ALTER TABLE public.text_image_compatibility ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public all text_image_compatibility" ON public.text_image_compatibility FOR ALL TO public USING (true) WITH CHECK (true);

-- ETAPA 9: outlier_detection
CREATE TABLE public.outlier_detection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  outlier_flag boolean DEFAULT false,
  outlier_reason text,
  outlier_type text, -- performance, estrutura, verbal, visual
  z_score numeric,
  reference_mean numeric,
  reference_stddev numeric,
  confidence_score integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(video_id, outlier_type)
);
ALTER TABLE public.outlier_detection ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public all outlier_detection" ON public.outlier_detection FOR ALL TO public USING (true) WITH CHECK (true);

-- ETAPA 10: dataset_cohort
CREATE TABLE public.dataset_cohort (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_name text NOT NULL,
  filter_views_min bigint,
  filter_views_max bigint,
  filter_duration_min numeric,
  filter_duration_max numeric,
  filter_segment text,
  filter_score_min numeric,
  filter_score_max numeric,
  video_ids jsonb DEFAULT '[]'::jsonb,
  video_count integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dataset_cohort ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public all dataset_cohort" ON public.dataset_cohort FOR ALL TO public USING (true) WITH CHECK (true);
