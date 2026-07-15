-- Add visual_emotion to visual_block_analysis
ALTER TABLE public.visual_block_analysis
ADD COLUMN IF NOT EXISTS visual_emotion text;

-- Add sub-score columns to text_visual_alignment
ALTER TABLE public.text_visual_alignment
ADD COLUMN IF NOT EXISTS action_alignment_score integer,
ADD COLUMN IF NOT EXISTS emotion_alignment_score integer,
ADD COLUMN IF NOT EXISTS intensity_alignment_score integer;