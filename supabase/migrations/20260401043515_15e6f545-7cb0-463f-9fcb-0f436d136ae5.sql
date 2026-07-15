CREATE TABLE public.verbal_noise_archive (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  video_id UUID NOT NULL,
  block_id UUID,
  combination_text TEXT NOT NULL,
  rejection_reason TEXT NOT NULL,
  dominant_function TEXT,
  emotional_intent TEXT,
  impact_score NUMERIC,
  semantic_coherence_score NUMERIC,
  emotional_score NUMERIC,
  word_count INTEGER,
  source_block_type TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.verbal_noise_archive ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public all verbal_noise_archive"
  ON public.verbal_noise_archive FOR ALL
  TO public USING (true) WITH CHECK (true);