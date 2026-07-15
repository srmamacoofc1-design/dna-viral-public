-- Generic audit trigger function
CREATE OR REPLACE FUNCTION public.audit_trigger_func()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  col text;
  old_val text;
  new_val text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_trail (table_name, record_id, change_type, field_name, previous_value, new_value, changed_by)
    VALUES (TG_TABLE_NAME, OLD.id::text, 'delete', NULL, row_to_json(OLD)::text, NULL, 'system');
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_trail (table_name, record_id, change_type, field_name, previous_value, new_value, changed_by)
    VALUES (TG_TABLE_NAME, NEW.id::text, 'insert', NULL, NULL, row_to_json(NEW)::text, 'system');
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Log each changed column individually
    FOR col IN SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = TG_TABLE_NAME
    LOOP
      EXECUTE format('SELECT ($1).%I::text', col) INTO old_val USING OLD;
      EXECUTE format('SELECT ($1).%I::text', col) INTO new_val USING NEW;
      IF old_val IS DISTINCT FROM new_val THEN
        INSERT INTO public.audit_trail (table_name, record_id, change_type, field_name, previous_value, new_value, changed_by)
        VALUES (TG_TABLE_NAME, NEW.id::text, 'update', col, left(old_val, 500), left(new_val, 500), 'system');
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

-- Attach to all main tables
CREATE TRIGGER audit_videos AFTER INSERT OR UPDATE OR DELETE ON public.videos FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
CREATE TRIGGER audit_video_blocks AFTER INSERT OR UPDATE OR DELETE ON public.video_blocks FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
CREATE TRIGGER audit_video_transcripts AFTER INSERT OR UPDATE OR DELETE ON public.video_transcripts FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
CREATE TRIGGER audit_video_logs AFTER INSERT OR UPDATE OR DELETE ON public.video_logs FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
CREATE TRIGGER audit_processing_queue AFTER INSERT OR UPDATE OR DELETE ON public.processing_queue FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
-- `public.semantic_patterns` never existed in the schema (the real table is
-- `block_semantic_patterns`).  Keeping a trigger for the phantom table makes a
-- clean deployment fail here, so intentionally omit it.
CREATE TRIGGER audit_block_semantic_patterns AFTER INSERT OR UPDATE OR DELETE ON public.block_semantic_patterns FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
CREATE TRIGGER audit_block_word_patterns AFTER INSERT OR UPDATE OR DELETE ON public.block_word_patterns FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
CREATE TRIGGER audit_block_phrase_patterns AFTER INSERT OR UPDATE OR DELETE ON public.block_phrase_patterns FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
CREATE TRIGGER audit_cta_profiles AFTER INSERT OR UPDATE OR DELETE ON public.cta_profiles FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
CREATE TRIGGER audit_verbal_layer_patterns AFTER INSERT OR UPDATE OR DELETE ON public.verbal_layer_patterns FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
CREATE TRIGGER audit_video_metadata AFTER INSERT OR UPDATE OR DELETE ON public.video_metadata FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
CREATE TRIGGER audit_video_scripts AFTER INSERT OR UPDATE OR DELETE ON public.video_scripts FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
CREATE TRIGGER audit_video_frames AFTER INSERT OR UPDATE OR DELETE ON public.video_frames FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
CREATE TRIGGER audit_video_languages AFTER INSERT OR UPDATE OR DELETE ON public.video_languages FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
CREATE TRIGGER audit_extraction_logs AFTER INSERT OR UPDATE OR DELETE ON public.extraction_logs FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
CREATE TRIGGER audit_data_consistency_reports AFTER INSERT OR UPDATE OR DELETE ON public.data_consistency_reports FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
