
-- Add new columns to block_semantic_patterns for enhanced extraction
ALTER TABLE public.block_semantic_patterns 
ADD COLUMN IF NOT EXISTS rare_words jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS dominant_words jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS weighted_word_score numeric DEFAULT NULL,
ADD COLUMN IF NOT EXISTS weighted_phrase_score numeric DEFAULT NULL;

-- Create CTA profiles table (per video)
CREATE TABLE IF NOT EXISTS public.cta_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  cta_text text,
  cta_position_seconds numeric,
  cta_type text,
  cta_emotion text,
  cta_action text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(video_id)
);

ALTER TABLE public.cta_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read cta_profiles" ON public.cta_profiles FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert cta_profiles" ON public.cta_profiles FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update cta_profiles" ON public.cta_profiles FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete cta_profiles" ON public.cta_profiles FOR DELETE TO public USING (true);

-- Create verbal_layer_patterns table (global consolidated per layer type)
CREATE TABLE IF NOT EXISTS public.verbal_layer_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layer_type text NOT NULL,
  top_words jsonb DEFAULT '[]'::jsonb,
  top_phrases jsonb DEFAULT '[]'::jsonb,
  top_emotions jsonb DEFAULT '[]'::jsonb,
  avg_emotion_intensity numeric,
  viral_weighted_words jsonb DEFAULT '[]'::jsonb,
  viral_weighted_phrases jsonb DEFAULT '[]'::jsonb,
  top_tones jsonb DEFAULT '[]'::jsonb,
  total_videos_analyzed integer DEFAULT 0,
  total_blocks_analyzed integer DEFAULT 0,
  avg_viral_score numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(layer_type)
);

ALTER TABLE public.verbal_layer_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read verbal_layer_patterns" ON public.verbal_layer_patterns FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert verbal_layer_patterns" ON public.verbal_layer_patterns FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update verbal_layer_patterns" ON public.verbal_layer_patterns FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete verbal_layer_patterns" ON public.verbal_layer_patterns FOR DELETE TO public USING (true);

-- Create trigger for updated_at on new tables
CREATE TRIGGER update_cta_profiles_updated_at BEFORE UPDATE ON public.cta_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_verbal_layer_patterns_updated_at BEFORE UPDATE ON public.verbal_layer_patterns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
