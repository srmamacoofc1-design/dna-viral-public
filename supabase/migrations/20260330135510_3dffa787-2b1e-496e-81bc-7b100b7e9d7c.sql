
CREATE TABLE public.text_visual_alignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES public.video_blocks(id) ON DELETE CASCADE,
  text_action text,
  visual_action text,
  text_emotion text,
  visual_emotion text,
  alignment_score integer CHECK (alignment_score >= 0 AND alignment_score <= 100),
  data_source_type text NOT NULL DEFAULT 'calculated',
  confidence_score integer NOT NULL DEFAULT 0,
  origin_level text NOT NULL DEFAULT 'calculated',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(video_id, block_id)
);

ALTER TABLE public.text_visual_alignment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read text_visual_alignment" ON public.text_visual_alignment FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert text_visual_alignment" ON public.text_visual_alignment FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update text_visual_alignment" ON public.text_visual_alignment FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete text_visual_alignment" ON public.text_visual_alignment FOR DELETE TO public USING (true);

CREATE TRIGGER update_text_visual_alignment_updated_at
  BEFORE UPDATE ON public.text_visual_alignment
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_text_visual_alignment
  AFTER INSERT OR UPDATE OR DELETE ON public.text_visual_alignment
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- Add avg_alignment_score to videos table
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS avg_alignment_score numeric;
