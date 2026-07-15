
CREATE TABLE public.block_semantic_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES public.video_blocks(id) ON DELETE CASCADE,
  block_type text NOT NULL,
  block_text text,
  block_keywords jsonb DEFAULT '[]'::jsonb,
  block_emotional_words jsonb DEFAULT '[]'::jsonb,
  block_repeated_words jsonb DEFAULT '[]'::jsonb,
  block_strong_phrases jsonb DEFAULT '[]'::jsonb,
  block_emotional_type text,
  block_emotional_intensity integer,
  block_verbal_tone text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(block_id)
);

ALTER TABLE public.block_semantic_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read block_semantic_patterns" ON public.block_semantic_patterns FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert block_semantic_patterns" ON public.block_semantic_patterns FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update block_semantic_patterns" ON public.block_semantic_patterns FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete block_semantic_patterns" ON public.block_semantic_patterns FOR DELETE TO public USING (true);
