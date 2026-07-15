-- Add new columns for incremental processing
ALTER TABLE public.video_temporal_profile 
  ADD COLUMN processing_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN updated_at timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN error_message text;

-- Unique constraint to prevent duplicates per video+block
ALTER TABLE public.video_temporal_profile 
  ADD CONSTRAINT uq_temporal_video_block UNIQUE (video_id, block_id);

-- Performance indexes for scale
CREATE INDEX idx_temporal_status ON public.video_temporal_profile(processing_status);
CREATE INDEX idx_temporal_created ON public.video_temporal_profile(created_at);
CREATE INDEX idx_temporal_video_status ON public.video_temporal_profile(video_id, processing_status);

-- Mark all existing rows as completed
UPDATE public.video_temporal_profile SET processing_status = 'completed';