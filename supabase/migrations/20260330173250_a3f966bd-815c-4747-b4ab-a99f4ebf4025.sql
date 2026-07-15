
CREATE TABLE public.video_cta_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  block_id uuid REFERENCES public.video_blocks(id) ON DELETE SET NULL,
  cta_type text NOT NULL CHECK (cta_type IN ('explicit', 'implicit', 'emotional', 'narrative')),
  cta_text text,
  cta_intensity integer NOT NULL DEFAULT 1 CHECK (cta_intensity BETWEEN 1 AND 5),
  cta_position_seconds numeric,
  cta_language text DEFAULT 'pt',
  cta_confidence integer DEFAULT 0 CHECK (cta_confidence BETWEEN 0 AND 100),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.video_cta_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public all video_cta_events"
  ON public.video_cta_events FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_video_cta_events_video_id ON public.video_cta_events(video_id);
CREATE INDEX idx_video_cta_events_type ON public.video_cta_events(cta_type);
