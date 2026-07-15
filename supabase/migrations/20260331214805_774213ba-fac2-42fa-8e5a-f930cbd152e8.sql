ALTER TABLE public.viral_word_combinations
  ADD COLUMN IF NOT EXISTS semantic_coherence_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS emotional_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS visual_temporal_confirmation_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approval_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_block_type text,
  ADD COLUMN IF NOT EXISTS linked_micro_event boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS linked_temporal_signal boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS linked_visual_signal boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_for_dna boolean DEFAULT false;