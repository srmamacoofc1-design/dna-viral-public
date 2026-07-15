
CREATE TABLE public.script_assemblies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  source_generation_context_id UUID REFERENCES public.generation_contexts(id),
  assembly_name TEXT NOT NULL DEFAULT 'Script Assembly V1',
  script_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  block_count_expected INTEGER,
  assembly_rules JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'no_data'
);

ALTER TABLE public.script_assemblies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read script_assemblies" ON public.script_assemblies FOR SELECT USING (true);
CREATE POLICY "Allow public insert script_assemblies" ON public.script_assemblies FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update script_assemblies" ON public.script_assemblies FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete script_assemblies" ON public.script_assemblies FOR DELETE USING (true);

CREATE TRIGGER update_script_assemblies_updated_at
  BEFORE UPDATE ON public.script_assemblies
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
