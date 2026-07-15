
-- Add new columns to dataset_cohort
ALTER TABLE public.dataset_cohort
  ADD COLUMN IF NOT EXISTS cohort_type text DEFAULT 'combinado',
  ADD COLUMN IF NOT EXISTS rules_json jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS confidence_score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS data_source_type text DEFAULT 'calculated',
  ADD COLUMN IF NOT EXISTS origin_level text DEFAULT 'calculated';

-- Add new columns to cohort_analysis_summary
ALTER TABLE public.cohort_analysis_summary
  ADD COLUMN IF NOT EXISTS dominant_verbal_pattern text,
  ADD COLUMN IF NOT EXISTS dominant_cta_pattern text,
  ADD COLUMN IF NOT EXISTS dominant_emotional_arc text,
  ADD COLUMN IF NOT EXISTS avg_normalized_performance_score numeric,
  ADD COLUMN IF NOT EXISTS summary_json jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS data_source_type text DEFAULT 'calculated',
  ADD COLUMN IF NOT EXISTS origin_level text DEFAULT 'calculated';

-- Create dataset_cohort_videos junction table
CREATE TABLE IF NOT EXISTS public.dataset_cohort_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id uuid NOT NULL REFERENCES public.dataset_cohort(id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(cohort_id, video_id)
);

ALTER TABLE public.dataset_cohort_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public all dataset_cohort_videos"
  ON public.dataset_cohort_videos FOR ALL TO public
  USING (true) WITH CHECK (true);
