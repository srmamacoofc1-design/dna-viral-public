-- Historical compatibility trigger.
--
-- Never call an Edge Function from a migration using a project-specific URL
-- or JWT. A later migration replaces this trigger with the durable
-- viral_score_recalc_queue. Until then, this function deliberately does
-- nothing so a fresh project can apply the migration chain without reaching
-- a legacy backend.
CREATE OR REPLACE FUNCTION public.trigger_viral_score_recalculation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN NEW;
END;
$$;

-- Create trigger on videos table for relevant changes
DROP TRIGGER IF EXISTS trg_recalculate_viral_scores ON public.videos;
CREATE TRIGGER trg_recalculate_viral_scores
  AFTER INSERT OR UPDATE OF views, likes, comments, status
  ON public.videos
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_viral_score_recalculation();
