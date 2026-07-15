
-- Table: visual_block_analysis
CREATE TABLE public.visual_block_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES public.video_blocks(id) ON DELETE CASCADE,
  block_type text NOT NULL,
  representative_frame_path text,
  representative_timestamp numeric,
  scene_description text,
  main_action text,
  main_objects jsonb DEFAULT '[]'::jsonb,
  human_presence boolean,
  animal_presence boolean,
  text_on_screen_presence boolean,
  visual_intensity_level text,
  scene_change_detected boolean,
  scene_change_count integer DEFAULT 0,
  avg_visual_intensity_score integer,
  data_source_type text NOT NULL DEFAULT 'calculated',
  confidence_score integer NOT NULL DEFAULT 0,
  origin_level text NOT NULL DEFAULT 'calculated',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.visual_block_analysis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read visual_block_analysis" ON public.visual_block_analysis FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert visual_block_analysis" ON public.visual_block_analysis FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update visual_block_analysis" ON public.visual_block_analysis FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete visual_block_analysis" ON public.visual_block_analysis FOR DELETE TO public USING (true);

CREATE TRIGGER update_visual_block_analysis_updated_at BEFORE UPDATE ON public.visual_block_analysis FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Table: dna_base_versions
CREATE TABLE public.dna_base_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_name text NOT NULL DEFAULT 'DNA_BASE_V1',
  dataset_type text NOT NULL DEFAULT 'completed_videos',
  total_videos_used integer NOT NULL DEFAULT 0,
  total_blocks_used integer NOT NULL DEFAULT 0,
  avg_hook_time numeric,
  avg_reveal_time numeric,
  avg_payoff_time numeric,
  avg_turn_count numeric,
  avg_density numeric,
  dominant_structure_sequence text,
  dominant_hook_type text,
  dominant_emotion_sequence text,
  dominant_cta_type text,
  segment_breakdown jsonb DEFAULT '{}'::jsonb,
  formula_registry_snapshot jsonb DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dna_base_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read dna_base_versions" ON public.dna_base_versions FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert dna_base_versions" ON public.dna_base_versions FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public delete dna_base_versions" ON public.dna_base_versions FOR DELETE TO public USING (true);
