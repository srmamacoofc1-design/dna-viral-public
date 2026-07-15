
CREATE TABLE public.dna_objects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  source_scope TEXT NOT NULL DEFAULT 'all_videos',
  total_videos_used INTEGER DEFAULT 0,
  dominant_sequence TEXT,
  required_blocks JSONB DEFAULT '[]'::jsonb,
  optional_blocks JSONB DEFAULT '[]'::jsonb,
  avg_hook_time NUMERIC,
  avg_payoff_time NUMERIC,
  avg_cta_time NUMERIC,
  avg_block_count NUMERIC,
  avg_video_duration NUMERIC,
  dominant_emotion TEXT,
  secondary_emotion TEXT,
  dominant_cta_type TEXT,
  avg_viral_score NUMERIC,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'ready'
);

ALTER TABLE public.dna_objects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read dna_objects" ON public.dna_objects FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert dna_objects" ON public.dna_objects FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update dna_objects" ON public.dna_objects FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete dna_objects" ON public.dna_objects FOR DELETE TO public USING (true);
