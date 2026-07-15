
CREATE TABLE public.reference_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  storage_path text,
  transcription text,
  transcription_segments jsonb DEFAULT '[]'::jsonb,
  frames jsonb DEFAULT '[]'::jsonb,
  duration_seconds numeric,
  status text NOT NULL DEFAULT 'uploading',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reference_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public all reference_videos"
  ON public.reference_videos FOR ALL
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_reference_videos_updated_at
  BEFORE UPDATE ON public.reference_videos
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
