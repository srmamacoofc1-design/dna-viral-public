
CREATE TABLE public.template_contexts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  source_dna_object_id UUID REFERENCES public.dna_objects(id),
  template_name TEXT NOT NULL DEFAULT 'Template V1',
  dominant_sequence TEXT,
  required_blocks JSONB DEFAULT '[]'::jsonb,
  optional_blocks JSONB DEFAULT '[]'::jsonb,
  hook_position_pct NUMERIC,
  payoff_position_pct NUMERIC,
  cta_position_seconds NUMERIC,
  dominant_emotion TEXT,
  secondary_emotion TEXT,
  dominant_cta_type TEXT,
  avg_block_count NUMERIC,
  avg_video_duration NUMERIC,
  template_rules JSONB DEFAULT '[]'::jsonb,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'ready'
);

ALTER TABLE public.template_contexts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read template_contexts" ON public.template_contexts FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert template_contexts" ON public.template_contexts FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update template_contexts" ON public.template_contexts FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete template_contexts" ON public.template_contexts FOR DELETE TO public USING (true);
