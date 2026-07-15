
-- Validation reports table (stores all validation layer results)
CREATE TABLE public.validation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_type text NOT NULL,
  video_id uuid REFERENCES public.videos(id) ON DELETE CASCADE,
  report_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  anomaly_detected boolean DEFAULT false,
  confidence_score integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.validation_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public all validation_reports" ON public.validation_reports
  FOR ALL TO public USING (true) WITH CHECK (true);

CREATE INDEX idx_validation_reports_type ON public.validation_reports(validation_type);
CREATE INDEX idx_validation_reports_video ON public.validation_reports(video_id);

-- Cohort analysis summary table
CREATE TABLE public.cohort_analysis_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id uuid REFERENCES public.dataset_cohort(id) ON DELETE CASCADE,
  cohort_name text NOT NULL,
  video_count integer DEFAULT 0,
  dominant_patterns jsonb DEFAULT '{}'::jsonb,
  avg_performance numeric,
  avg_viral_score numeric,
  avg_alignment_score numeric,
  dominant_structure text,
  dominant_emotion text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cohort_analysis_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public all cohort_analysis_summary" ON public.cohort_analysis_summary
  FOR ALL TO public USING (true) WITH CHECK (true);
