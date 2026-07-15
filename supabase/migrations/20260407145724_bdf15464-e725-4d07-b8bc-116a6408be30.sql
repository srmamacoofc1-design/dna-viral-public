ALTER TABLE public.reference_videos
ADD COLUMN IF NOT EXISTS source_scope TEXT NOT NULL DEFAULT 'generation_input',
ADD COLUMN IF NOT EXISTS processing_scope TEXT NOT NULL DEFAULT 'operational_generation';

CREATE TABLE IF NOT EXISTS public.reference_video_transcripts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reference_video_id UUID NOT NULL REFERENCES public.reference_videos(id) ON DELETE CASCADE,
  transcript_text TEXT,
  transcript_segments JSONB NOT NULL DEFAULT '[]'::jsonb,
  detected_language TEXT,
  segment_count INTEGER NOT NULL DEFAULT 0,
  transcript_provider TEXT,
  transcript_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT reference_video_transcripts_reference_video_id_key UNIQUE (reference_video_id)
);

CREATE TABLE IF NOT EXISTS public.reference_video_frames (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reference_video_id UUID NOT NULL REFERENCES public.reference_videos(id) ON DELETE CASCADE,
  timestamp_seconds NUMERIC NOT NULL,
  description TEXT NOT NULL,
  scene_type TEXT,
  visual_elements JSONB NOT NULL DEFAULT '[]'::jsonb,
  emotional_tone TEXT,
  frame_order INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reference_video_topics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reference_video_id UUID NOT NULL REFERENCES public.reference_videos(id) ON DELETE CASCADE,
  central_topic TEXT,
  semantic_summary TEXT,
  key_topics TEXT[] NOT NULL DEFAULT '{}',
  forbidden_foreign_entities TEXT[] NOT NULL DEFAULT '{}',
  narrative_progression JSONB NOT NULL DEFAULT '[]'::jsonb,
  visual_anchor_points JSONB NOT NULL DEFAULT '[]'::jsonb,
  semantic_alignment_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  estimated_target_word_count INTEGER,
  detected_language TEXT,
  topic_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT reference_video_topics_reference_video_id_key UNIQUE (reference_video_id)
);

CREATE TABLE IF NOT EXISTS public.reference_generation_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reference_video_id UUID NOT NULL REFERENCES public.reference_videos(id) ON DELETE CASCADE,
  generation_context_id UUID REFERENCES public.generation_contexts(id) ON DELETE SET NULL,
  script_assembly_id UUID REFERENCES public.script_assemblies(id) ON DELETE SET NULL,
  promoted_script_id UUID REFERENCES public.promoted_scripts(id) ON DELETE SET NULL,
  execution_mode TEXT NOT NULL DEFAULT 'guided',
  pipeline_status TEXT NOT NULL DEFAULT 'queued',
  current_step TEXT,
  progress_pct INTEGER NOT NULL DEFAULT 0,
  semantic_alignment_score NUMERIC,
  duration_alignment_score NUMERIC,
  foreign_entity_contamination_score NUMERIC,
  visual_sync_score NUMERIC,
  validation_status TEXT,
  estimated_duration_seconds NUMERIC,
  actual_duration_seconds NUMERIC,
  content_guardrails JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE,
  finished_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reference_video_transcripts_reference_video_id
  ON public.reference_video_transcripts(reference_video_id);
CREATE INDEX IF NOT EXISTS idx_reference_video_frames_reference_video_id
  ON public.reference_video_frames(reference_video_id);
CREATE INDEX IF NOT EXISTS idx_reference_video_frames_timestamp
  ON public.reference_video_frames(reference_video_id, timestamp_seconds);
CREATE INDEX IF NOT EXISTS idx_reference_video_topics_reference_video_id
  ON public.reference_video_topics(reference_video_id);
CREATE INDEX IF NOT EXISTS idx_reference_generation_runs_reference_video_id
  ON public.reference_generation_runs(reference_video_id);
CREATE INDEX IF NOT EXISTS idx_reference_generation_runs_pipeline_status
  ON public.reference_generation_runs(pipeline_status, created_at DESC);

ALTER TABLE public.reference_video_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_video_frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_video_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_generation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public all reference_video_transcripts"
ON public.reference_video_transcripts
FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow public all reference_video_frames"
ON public.reference_video_frames
FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow public all reference_video_topics"
ON public.reference_video_topics
FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow public all reference_generation_runs"
ON public.reference_generation_runs
FOR ALL
USING (true)
WITH CHECK (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_reference_video_transcripts_updated_at'
  ) THEN
    CREATE TRIGGER update_reference_video_transcripts_updated_at
    BEFORE UPDATE ON public.reference_video_transcripts
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_reference_video_frames_updated_at'
  ) THEN
    CREATE TRIGGER update_reference_video_frames_updated_at
    BEFORE UPDATE ON public.reference_video_frames
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_reference_video_topics_updated_at'
  ) THEN
    CREATE TRIGGER update_reference_video_topics_updated_at
    BEFORE UPDATE ON public.reference_video_topics
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_reference_generation_runs_updated_at'
  ) THEN
    CREATE TRIGGER update_reference_generation_runs_updated_at
    BEFORE UPDATE ON public.reference_generation_runs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;