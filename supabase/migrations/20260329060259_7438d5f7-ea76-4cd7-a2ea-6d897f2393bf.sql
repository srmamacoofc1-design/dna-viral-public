
-- Create granular word patterns table (one row per word per block)
CREATE TABLE IF NOT EXISTS public.block_word_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES public.video_blocks(id) ON DELETE CASCADE,
  block_type text NOT NULL,
  word text NOT NULL,
  word_frequency integer NOT NULL DEFAULT 1,
  is_emotional boolean NOT NULL DEFAULT false,
  is_rare boolean NOT NULL DEFAULT false,
  is_dominant boolean NOT NULL DEFAULT false,
  is_impact boolean NOT NULL DEFAULT false,
  weighted_score numeric DEFAULT NULL,
  timestamp_start numeric DEFAULT NULL,
  timestamp_end numeric DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.block_word_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read block_word_patterns" ON public.block_word_patterns FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert block_word_patterns" ON public.block_word_patterns FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public delete block_word_patterns" ON public.block_word_patterns FOR DELETE TO public USING (true);

CREATE INDEX idx_block_word_patterns_video ON public.block_word_patterns(video_id);
CREATE INDEX idx_block_word_patterns_block_type ON public.block_word_patterns(block_type);

-- Create granular phrase patterns table (one row per phrase per block)
CREATE TABLE IF NOT EXISTS public.block_phrase_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES public.video_blocks(id) ON DELETE CASCADE,
  block_type text NOT NULL,
  phrase text NOT NULL,
  phrase_type text DEFAULT NULL,
  phrase_category text DEFAULT NULL,
  is_emotional boolean NOT NULL DEFAULT false,
  is_repeated boolean NOT NULL DEFAULT false,
  is_strong boolean NOT NULL DEFAULT false,
  phrase_length integer DEFAULT NULL,
  phrase_position numeric DEFAULT NULL,
  phrase_strength_score numeric DEFAULT NULL,
  weighted_score numeric DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.block_phrase_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read block_phrase_patterns" ON public.block_phrase_patterns FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert block_phrase_patterns" ON public.block_phrase_patterns FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public delete block_phrase_patterns" ON public.block_phrase_patterns FOR DELETE TO public USING (true);

CREATE INDEX idx_block_phrase_patterns_video ON public.block_phrase_patterns(video_id);
CREATE INDEX idx_block_phrase_patterns_block_type ON public.block_phrase_patterns(block_type);
CREATE INDEX idx_block_phrase_patterns_category ON public.block_phrase_patterns(phrase_category);

-- Add cta_intensity to cta_profiles
ALTER TABLE public.cta_profiles ADD COLUMN IF NOT EXISTS cta_intensity numeric DEFAULT NULL;
