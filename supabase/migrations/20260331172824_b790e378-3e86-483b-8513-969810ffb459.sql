
-- Create video_micro_events table
CREATE TABLE public.video_micro_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  video_id uuid NOT NULL,
  block_id uuid NOT NULL,
  timestamp_seconds numeric NOT NULL DEFAULT 0,
  event_type text NOT NULL,
  event_strength numeric NOT NULL DEFAULT 0,
  visual_change_score numeric NOT NULL DEFAULT 0,
  temporal_intensity numeric NOT NULL DEFAULT 0,
  alignment_score numeric NOT NULL DEFAULT 0,
  confidence_score numeric NOT NULL DEFAULT 0,
  processing_status text NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Unique constraint
ALTER TABLE public.video_micro_events
  ADD CONSTRAINT uq_micro_event_video_block_ts UNIQUE (video_id, block_id, timestamp_seconds);

-- Indexes
CREATE INDEX idx_micro_events_video ON public.video_micro_events (video_id);
CREATE INDEX idx_micro_events_block ON public.video_micro_events (block_id);
CREATE INDEX idx_micro_events_status ON public.video_micro_events (processing_status);
CREATE INDEX idx_micro_events_timestamp ON public.video_micro_events (timestamp_seconds);

-- RLS
ALTER TABLE public.video_micro_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public all video_micro_events"
  ON public.video_micro_events FOR ALL
  TO public USING (true) WITH CHECK (true);
