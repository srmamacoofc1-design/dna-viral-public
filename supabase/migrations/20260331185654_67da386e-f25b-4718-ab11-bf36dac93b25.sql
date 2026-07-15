
CREATE TABLE public.viral_word_combinations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  video_id UUID NOT NULL,
  block_id UUID,
  combination_text TEXT NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 2,
  dominant_function TEXT NOT NULL DEFAULT 'BUILD',
  emotional_intent TEXT,
  block_type TEXT,
  language_code TEXT DEFAULT 'pt',
  confidence_score NUMERIC DEFAULT 0,
  occurrence_count INTEGER DEFAULT 1,
  cross_video_count INTEGER DEFAULT 0,
  pattern_score NUMERIC DEFAULT 0,
  sample_context TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.viral_word_combinations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public all viral_word_combinations" ON public.viral_word_combinations
  FOR ALL TO public USING (true) WITH CHECK (true);

CREATE INDEX idx_vwc_video_id ON public.viral_word_combinations(video_id);
CREATE INDEX idx_vwc_combination_text ON public.viral_word_combinations(combination_text);
CREATE INDEX idx_vwc_dominant_function ON public.viral_word_combinations(dominant_function);
CREATE INDEX idx_vwc_cross_video_count ON public.viral_word_combinations(cross_video_count DESC);
CREATE INDEX idx_vwc_pattern_score ON public.viral_word_combinations(pattern_score DESC);

-- Cross-video consolidated view table
CREATE TABLE public.viral_combination_patterns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  combination_text TEXT NOT NULL UNIQUE,
  word_count INTEGER NOT NULL DEFAULT 2,
  dominant_function TEXT NOT NULL DEFAULT 'BUILD',
  emotional_intent TEXT,
  videos_count INTEGER DEFAULT 0,
  total_occurrences INTEGER DEFAULT 0,
  avg_confidence NUMERIC DEFAULT 0,
  pattern_score NUMERIC DEFAULT 0,
  dominant_block_types TEXT[],
  sample_contexts TEXT[],
  languages TEXT[],
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.viral_combination_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public all viral_combination_patterns" ON public.viral_combination_patterns
  FOR ALL TO public USING (true) WITH CHECK (true);

CREATE INDEX idx_vcp_pattern_score ON public.viral_combination_patterns(pattern_score DESC);
CREATE INDEX idx_vcp_dominant_function ON public.viral_combination_patterns(dominant_function);
CREATE INDEX idx_vcp_videos_count ON public.viral_combination_patterns(videos_count DESC);
