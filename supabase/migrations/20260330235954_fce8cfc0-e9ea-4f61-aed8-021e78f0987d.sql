
-- Add block_id and frame_role columns to video_frames
-- Preserving all existing data (existing frames get frame_role = 'scene_detected')
ALTER TABLE public.video_frames 
  ADD COLUMN IF NOT EXISTS block_id uuid,
  ADD COLUMN IF NOT EXISTS frame_role text DEFAULT 'scene_detected',
  ADD COLUMN IF NOT EXISTS source_method text DEFAULT 'scene_detection';

-- Set existing frames to legacy values
UPDATE public.video_frames 
SET frame_role = 'scene_detected', 
    source_method = 'scene_detection' 
WHERE frame_role IS NULL OR frame_role = 'scene_detected';

-- Create index for efficient block-based queries
CREATE INDEX IF NOT EXISTS idx_video_frames_block_id ON public.video_frames(block_id);
CREATE INDEX IF NOT EXISTS idx_video_frames_role ON public.video_frames(video_id, block_id, frame_role);

-- Add RLS policy for UPDATE (currently missing)
CREATE POLICY "Allow public update video_frames" ON public.video_frames
  FOR UPDATE TO public USING (true) WITH CHECK (true);
