
-- Table for enriched canonical verbal units ready for Phase 2
CREATE TABLE public.verbal_canonical_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL,
  block_id uuid,
  candidate_text text NOT NULL,
  narrative_function text NOT NULL,
  emotional_intent text,
  emotional_intensity integer DEFAULT 0,
  confidence_score integer DEFAULT 0,
  replicable_for_dna boolean DEFAULT false,
  viewer_directed boolean DEFAULT false,
  viral_strength numeric DEFAULT 0,
  source_judge_id uuid,
  is_top_ranked boolean DEFAULT false,
  rank_within_function integer,
  video_title text,
  video_viral_score numeric,
  video_views bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.verbal_canonical_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public all verbal_canonical_units"
  ON public.verbal_canonical_units FOR ALL
  USING (true) WITH CHECK (true);

CREATE INDEX idx_vcu_narrative_function ON public.verbal_canonical_units(narrative_function);
CREATE INDEX idx_vcu_video_id ON public.verbal_canonical_units(video_id);
CREATE INDEX idx_vcu_is_top ON public.verbal_canonical_units(is_top_ranked) WHERE is_top_ranked = true;

-- Table for aggregated verbal intelligence summary per function
CREATE TABLE public.verbal_intelligence_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  narrative_function text NOT NULL UNIQUE,
  total_canonical_units integer DEFAULT 0,
  primary_emotion text,
  secondary_emotion text,
  avg_emotional_intensity numeric DEFAULT 0,
  avg_confidence numeric DEFAULT 0,
  avg_replicability numeric DEFAULT 0,
  viewer_directed_rate numeric DEFAULT 0,
  avg_viral_strength numeric DEFAULT 0,
  top_patterns jsonb DEFAULT '[]'::jsonb,
  top_units jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.verbal_intelligence_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public all verbal_intelligence_summary"
  ON public.verbal_intelligence_summary FOR ALL
  USING (true) WITH CHECK (true);
