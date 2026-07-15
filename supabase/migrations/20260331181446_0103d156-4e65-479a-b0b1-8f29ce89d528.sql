ALTER TABLE public.viral_verbal_patterns 
ADD COLUMN IF NOT EXISTS pattern_category text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS verbal_position text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS recurrence_type text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS sample_phrases jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS dominant_emotion text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS hook_related boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS payoff_related boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS cta_related boolean DEFAULT false;