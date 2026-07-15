ALTER TABLE public.viral_verbal_patterns 
ADD COLUMN IF NOT EXISTS verbal_function text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS emotional_intent text DEFAULT NULL;