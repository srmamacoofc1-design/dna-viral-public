CREATE TABLE public.video_temporal_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES public.video_blocks(id) ON DELETE CASCADE,
  cut_count integer NOT NULL DEFAULT 0,
  cut_density numeric NOT NULL DEFAULT 0,
  avg_cut_interval numeric NOT NULL DEFAULT 0,
  rhythm_level text NOT NULL DEFAULT 'low',
  tempo_pattern text NOT NULL DEFAULT 'stable',
  confidence_score numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.video_temporal_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public all video_temporal_profile"
  ON public.video_temporal_profile FOR ALL
  TO public USING (true) WITH CHECK (true);

CREATE INDEX idx_video_temporal_profile_video_id ON public.video_temporal_profile(video_id);
CREATE INDEX idx_video_temporal_profile_block_id ON public.video_temporal_profile(block_id);