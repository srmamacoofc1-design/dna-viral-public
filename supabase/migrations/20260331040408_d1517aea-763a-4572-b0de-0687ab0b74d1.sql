
-- Job tracking tables for persistent v2 reprocessing
CREATE TABLE public.reprocess_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'queued',
  total_videos integer NOT NULL DEFAULT 0,
  completed_videos integer NOT NULL DEFAULT 0,
  failed_videos integer NOT NULL DEFAULT 0,
  skipped_videos integer NOT NULL DEFAULT 0,
  current_video_id uuid NULL,
  current_step text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  error_message text NULL
);

CREATE TABLE public.reprocess_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.reprocess_jobs(id) ON DELETE CASCADE,
  video_id uuid NOT NULL,
  video_title text NULL,
  status text NOT NULL DEFAULT 'queued',
  current_step text NULL,
  attempts integer NOT NULL DEFAULT 0,
  progress_pct integer NOT NULL DEFAULT 0,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NULL,
  finished_at timestamptz NULL
);

ALTER TABLE public.reprocess_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reprocess_job_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public all reprocess_jobs" ON public.reprocess_jobs FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow public all reprocess_job_items" ON public.reprocess_job_items FOR ALL TO public USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.reprocess_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.reprocess_job_items;
