
CREATE TABLE public.promoted_scripts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_script_assembly_id uuid NOT NULL REFERENCES public.script_assemblies(id),
  source_generation_context_id uuid REFERENCES public.generation_contexts(id),
  source_blueprint_id uuid REFERENCES public.blueprint_contexts(id),
  script_title text NOT NULL DEFAULT 'Final Script V1',
  script_text text NOT NULL DEFAULT '',
  script_blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  script_status text NOT NULL DEFAULT 'final',
  promoted_at timestamptz NOT NULL DEFAULT now(),
  validation_status text,
  validation_version integer NOT NULL DEFAULT 1,
  promotion_trace jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_script_assembly_id)
);

ALTER TABLE public.promoted_scripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public all promoted_scripts"
  ON public.promoted_scripts FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER update_promoted_scripts_updated_at
  BEFORE UPDATE ON public.promoted_scripts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
