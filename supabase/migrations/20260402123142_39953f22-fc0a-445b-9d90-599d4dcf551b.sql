
CREATE TABLE public.readiness_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  readiness_score INTEGER NOT NULL DEFAULT 0,
  validation_status TEXT NOT NULL DEFAULT 'PENDING',
  total_videos INTEGER NOT NULL DEFAULT 0,
  total_blocks INTEGER NOT NULL DEFAULT 0,
  report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.readiness_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read readiness_reports"
  ON public.readiness_reports FOR SELECT
  USING (true);

CREATE POLICY "Allow public insert readiness_reports"
  ON public.readiness_reports FOR INSERT
  WITH CHECK (true);
