
-- TABELA 1: viral_sequence_patterns
CREATE TABLE public.viral_sequence_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_structure text NOT NULL,
  sequence_emotion_flow text,
  sequence_duration_avg numeric DEFAULT 0,
  videos_count integer DEFAULT 0,
  occurrence_count integer DEFAULT 0,
  avg_peak_intensity numeric DEFAULT 0,
  pattern_score numeric DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.viral_sequence_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public all viral_sequence_patterns" ON public.viral_sequence_patterns FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_viral_sequence_patterns_score ON public.viral_sequence_patterns (pattern_score DESC);
CREATE INDEX idx_viral_sequence_patterns_videos ON public.viral_sequence_patterns (videos_count DESC);

-- TABELA 2: viral_timing_patterns
CREATE TABLE public.viral_timing_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timing_signature text NOT NULL,
  avg_cut_density numeric DEFAULT 0,
  avg_pause_duration numeric DEFAULT 0,
  avg_acceleration numeric DEFAULT 0,
  videos_count integer DEFAULT 0,
  pattern_score numeric DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.viral_timing_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public all viral_timing_patterns" ON public.viral_timing_patterns FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_viral_timing_patterns_score ON public.viral_timing_patterns (pattern_score DESC);

-- TABELA 3: viral_emotional_patterns
CREATE TABLE public.viral_emotional_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emotional_sequence text NOT NULL,
  peak_positions jsonb DEFAULT '[]'::jsonb,
  avg_intensity numeric DEFAULT 0,
  videos_count integer DEFAULT 0,
  pattern_score numeric DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.viral_emotional_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public all viral_emotional_patterns" ON public.viral_emotional_patterns FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_viral_emotional_patterns_score ON public.viral_emotional_patterns (pattern_score DESC);

-- TABELA 4: viral_verbal_patterns
CREATE TABLE public.viral_verbal_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phrase_structure text NOT NULL,
  dominant_tone text,
  linguistic_density_avg numeric DEFAULT 0,
  semantic_pressure_avg numeric DEFAULT 0,
  videos_count integer DEFAULT 0,
  pattern_score numeric DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.viral_verbal_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public all viral_verbal_patterns" ON public.viral_verbal_patterns FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_viral_verbal_patterns_score ON public.viral_verbal_patterns (pattern_score DESC);

-- TABELA 5: viral_visual_patterns
CREATE TABLE public.viral_visual_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visual_signature text NOT NULL,
  frame_transition_pattern text,
  alignment_type text,
  videos_count integer DEFAULT 0,
  pattern_score numeric DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.viral_visual_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public all viral_visual_patterns" ON public.viral_visual_patterns FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_viral_visual_patterns_score ON public.viral_visual_patterns (pattern_score DESC);
