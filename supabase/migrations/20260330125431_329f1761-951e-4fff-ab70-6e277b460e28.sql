-- Enum for data source types
CREATE TYPE public.data_source_type AS ENUM (
  'transcription',
  'visual_detection',
  'metadata_import',
  'manual_entry',
  'calculated',
  'ai_extraction'
);

-- Enum for data origin level
CREATE TYPE public.data_origin_level AS ENUM ('raw', 'calculated');

-- Extraction logs table — audit trail for every field extracted
CREATE TABLE IF NOT EXISTS public.extraction_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  extraction_step text NOT NULL,
  field_name text NOT NULL,
  extracted_value text,
  confidence_score integer NOT NULL DEFAULT 0,
  source_type public.data_source_type NOT NULL,
  origin_level public.data_origin_level NOT NULL DEFAULT 'raw',
  error_flag boolean NOT NULL DEFAULT false,
  error_message text
);

ALTER TABLE public.extraction_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read extraction_logs" ON public.extraction_logs FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert extraction_logs" ON public.extraction_logs FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public delete extraction_logs" ON public.extraction_logs FOR DELETE TO public USING (true);

CREATE INDEX idx_extraction_logs_video ON public.extraction_logs(video_id);
CREATE INDEX idx_extraction_logs_step ON public.extraction_logs(extraction_step);
CREATE INDEX idx_extraction_logs_error ON public.extraction_logs(error_flag) WHERE error_flag = true;
CREATE INDEX idx_extraction_logs_confidence ON public.extraction_logs(confidence_score);

-- Audit trail table — tracks all changes to any record
CREATE TABLE IF NOT EXISTS public.audit_trail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  table_name text NOT NULL,
  record_id text NOT NULL,
  change_type text NOT NULL,
  field_name text,
  previous_value text,
  new_value text,
  changed_by text NOT NULL DEFAULT 'system'
);

ALTER TABLE public.audit_trail ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read audit_trail" ON public.audit_trail FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert audit_trail" ON public.audit_trail FOR INSERT TO public WITH CHECK (true);

CREATE INDEX idx_audit_trail_table ON public.audit_trail(table_name);
CREATE INDEX idx_audit_trail_record ON public.audit_trail(record_id);
CREATE INDEX idx_audit_trail_created ON public.audit_trail(created_at DESC);