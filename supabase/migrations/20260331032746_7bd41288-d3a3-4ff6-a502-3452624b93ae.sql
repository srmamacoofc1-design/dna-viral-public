CREATE TABLE public.pattern_performance_weights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type text NOT NULL,
  pattern_value text NOT NULL,
  block_type text,
  frequency integer NOT NULL DEFAULT 0,
  avg_views numeric,
  avg_likes_rate numeric,
  avg_comments_rate numeric,
  avg_engagement_score numeric,
  strength_score numeric,
  sample_size integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(pattern_type, pattern_value, block_type)
);

ALTER TABLE public.pattern_performance_weights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public all pattern_performance_weights"
  ON public.pattern_performance_weights FOR ALL
  TO public USING (true) WITH CHECK (true);

CREATE TRIGGER update_pattern_performance_weights_updated_at
  BEFORE UPDATE ON public.pattern_performance_weights
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();