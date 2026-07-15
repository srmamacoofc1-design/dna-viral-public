
CREATE TABLE public.narrative_judge_results (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  video_id uuid NOT NULL,
  block_id uuid,
  candidate_text text NOT NULL,
  is_valid_narrative_unit boolean NOT NULL DEFAULT false,
  narrative_function text,
  emotional_intent text,
  viewer_directed boolean DEFAULT false,
  replicable_for_dna boolean DEFAULT false,
  confidence_score integer DEFAULT 0,
  short_reason text,
  provider text,
  model text,
  batch_id text,
  processing_time_ms integer,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.narrative_judge_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public all narrative_judge_results"
ON public.narrative_judge_results
FOR ALL
USING (true)
WITH CHECK (true);

CREATE INDEX idx_narrative_judge_video ON public.narrative_judge_results(video_id);
CREATE INDEX idx_narrative_judge_batch ON public.narrative_judge_results(batch_id);
CREATE INDEX idx_narrative_judge_function ON public.narrative_judge_results(narrative_function);
