CREATE TABLE IF NOT EXISTS public.data_consistency_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  validation_step text NOT NULL,
  issue_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  field_name text,
  current_value text,
  expected_rule text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.data_consistency_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read data_consistency_reports" ON public.data_consistency_reports FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert data_consistency_reports" ON public.data_consistency_reports FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public delete data_consistency_reports" ON public.data_consistency_reports FOR DELETE TO public USING (true);

CREATE INDEX idx_dcr_video ON public.data_consistency_reports(video_id);
CREATE INDEX idx_dcr_severity ON public.data_consistency_reports(severity);
CREATE INDEX idx_dcr_step ON public.data_consistency_reports(validation_step);