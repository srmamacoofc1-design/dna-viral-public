ALTER TABLE public.video_blocks 
  ADD COLUMN IF NOT EXISTS block_density_score numeric NULL,
  ADD COLUMN IF NOT EXISTS semantic_shift_score numeric NULL,
  ADD COLUMN IF NOT EXISTS visual_shift_score numeric NULL;

ALTER TABLE public.videos 
  ADD COLUMN IF NOT EXISTS block_segmentation_version text NULL DEFAULT 'v1_legacy';