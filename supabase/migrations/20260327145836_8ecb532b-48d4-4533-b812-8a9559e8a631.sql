
-- Narrative Intelligence Layer: new columns on videos table

-- Part 1: Hook model expansion
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS first_impact_time numeric;

-- Part 2: Verbal hook layer
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS hook_text text;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS hook_keywords jsonb;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS hook_phrase_pattern text;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS hook_type_verbal text;

-- Part 3: Verbal emotion
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS hook_emotion_verbal text;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS hook_emotion_intensity integer;

-- Part 4: Narrative construction
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS narrative_progression_type text;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS micro_turn_count integer;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS micro_turn_types jsonb;

-- Part 5: Payoff verbal analysis
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS payoff_text text;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS payoff_type text;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS payoff_emotion text;

-- Part 6: CTA classification
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS cta_text text;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS cta_type text;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS cta_position_time numeric;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS cta_intrusion_score integer;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS cta_flow_break_score integer;
