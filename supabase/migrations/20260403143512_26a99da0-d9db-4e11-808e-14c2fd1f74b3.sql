
CREATE TABLE public.blueprint_contexts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_template_context_id UUID REFERENCES public.template_contexts(id),
  blueprint_name TEXT NOT NULL DEFAULT 'Blueprint V1',
  block_sequence JSONB NOT NULL DEFAULT '[]'::jsonb,
  block_count_expected INTEGER,
  hook_expected_position_pct NUMERIC,
  payoff_expected_position_pct NUMERIC,
  cta_expected_position_seconds NUMERIC,
  dominant_emotion TEXT,
  dominant_cta_type TEXT,
  blueprint_rules JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.blueprint_contexts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read blueprint_contexts" ON public.blueprint_contexts FOR SELECT USING (true);
CREATE POLICY "Allow public insert blueprint_contexts" ON public.blueprint_contexts FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update blueprint_contexts" ON public.blueprint_contexts FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete blueprint_contexts" ON public.blueprint_contexts FOR DELETE USING (true);

CREATE TRIGGER update_blueprint_contexts_updated_at
  BEFORE UPDATE ON public.blueprint_contexts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
