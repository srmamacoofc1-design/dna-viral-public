
-- Drop existing data and recreate with full schema
DELETE FROM public.text_image_compatibility;

ALTER TABLE public.text_image_compatibility
  ADD COLUMN IF NOT EXISTS block_type text,
  ADD COLUMN IF NOT EXISTS text_intensity_score integer,
  ADD COLUMN IF NOT EXISTS visual_intensity_score_calc integer,
  ADD COLUMN IF NOT EXISTS intensity_gap integer,
  ADD COLUMN IF NOT EXISTS text_requires_visual_boost boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS visual_underpowered boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS visual_overpowered boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS emotional_match_score integer,
  ADD COLUMN IF NOT EXISTS action_match_score integer,
  ADD COLUMN IF NOT EXISTS curiosity_match_score integer,
  ADD COLUMN IF NOT EXISTS reveal_match_score integer,
  ADD COLUMN IF NOT EXISTS compatibility_score integer,
  ADD COLUMN IF NOT EXISTS compatibility_label text,
  ADD COLUMN IF NOT EXISTS compatibility_reason text,
  ADD COLUMN IF NOT EXISTS recommended_visual_direction text,
  ADD COLUMN IF NOT EXISTS data_source_type text DEFAULT 'calculated',
  ADD COLUMN IF NOT EXISTS origin_level text DEFAULT 'calculated';
