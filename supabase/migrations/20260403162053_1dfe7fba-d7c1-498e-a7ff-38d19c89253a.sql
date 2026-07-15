CREATE TABLE public.generation_contexts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_blueprint_id UUID REFERENCES public.blueprint_contexts(id),
  generation_name TEXT NOT NULL DEFAULT 'Generation V1',
  slot_sequence JSONB NOT NULL DEFAULT '[]'::jsonb,
  slot_count_expected INTEGER,
  generation_rules JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'no_data',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.generation_contexts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read generation_contexts" ON public.generation_contexts FOR SELECT USING (true);
CREATE POLICY "Allow public insert generation_contexts" ON public.generation_contexts FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update generation_contexts" ON public.generation_contexts FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete generation_contexts" ON public.generation_contexts FOR DELETE USING (true);

CREATE TRIGGER update_generation_contexts_updated_at
  BEFORE UPDATE ON public.generation_contexts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();