
-- Narrative sequences detected across videos
CREATE TABLE public.verbal_narrative_sequences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sequence_pattern TEXT NOT NULL,
  sequence_length INT NOT NULL DEFAULT 0,
  frequency INT NOT NULL DEFAULT 0,
  video_ids JSONB DEFAULT '[]',
  avg_viral_score NUMERIC DEFAULT 0,
  avg_emotional_intensity NUMERIC DEFAULT 0,
  avg_confidence NUMERIC DEFAULT 0,
  avg_viral_strength NUMERIC DEFAULT 0,
  viewer_directed_rate NUMERIC DEFAULT 0,
  avg_replicability NUMERIC DEFAULT 0,
  dominant_emotion TEXT,
  sample_videos JSONB DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.verbal_narrative_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Verbal narrative sequences are publicly readable"
ON public.verbal_narrative_sequences FOR SELECT USING (true);

CREATE POLICY "Service role can manage verbal narrative sequences"
ON public.verbal_narrative_sequences FOR ALL USING (true) WITH CHECK (true);

-- Final verbal profile per function for Phase 2
CREATE TABLE public.verbal_phase2_profile (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  narrative_function TEXT NOT NULL,
  total_units INT NOT NULL DEFAULT 0,
  primary_emotion TEXT,
  secondary_emotion TEXT,
  avg_emotional_intensity NUMERIC DEFAULT 0,
  avg_confidence NUMERIC DEFAULT 0,
  avg_replicability NUMERIC DEFAULT 0,
  viewer_directed_rate NUMERIC DEFAULT 0,
  avg_viral_strength NUMERIC DEFAULT 0,
  top_verbal_patterns JSONB DEFAULT '[]',
  top_units JSONB DEFAULT '[]',
  emotion_distribution JSONB DEFAULT '{}',
  intensity_histogram JSONB DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.verbal_phase2_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Verbal phase2 profile is publicly readable"
ON public.verbal_phase2_profile FOR SELECT USING (true);

CREATE POLICY "Service role can manage verbal phase2 profile"
ON public.verbal_phase2_profile FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_verbal_narrative_sequences_updated_at
BEFORE UPDATE ON public.verbal_narrative_sequences
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_verbal_phase2_profile_updated_at
BEFORE UPDATE ON public.verbal_phase2_profile
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
