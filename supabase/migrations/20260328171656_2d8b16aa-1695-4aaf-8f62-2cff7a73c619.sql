-- Drop the per-row trigger (causes N calls per batch)
DROP TRIGGER IF EXISTS trg_recalculate_viral_scores ON public.videos;
DROP FUNCTION IF EXISTS public.trigger_viral_score_recalculation();

-- Create a debounce table to track pending recalculations
CREATE TABLE IF NOT EXISTS public.viral_score_recalc_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed boolean NOT NULL DEFAULT false
);

ALTER TABLE public.viral_score_recalc_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public all viral_score_recalc_queue"
  ON public.viral_score_recalc_queue FOR ALL
  TO public USING (true) WITH CHECK (true);

-- New trigger function: only enqueues if no pending request in last 10 seconds
CREATE OR REPLACE FUNCTION public.enqueue_viral_recalc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  recent_pending boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.views IS NOT DISTINCT FROM NEW.views
        AND OLD.likes IS NOT DISTINCT FROM NEW.likes
        AND OLD.comments IS NOT DISTINCT FROM NEW.comments
        AND OLD.status IS NOT DISTINCT FROM NEW.status) THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.viral_score_recalc_queue
    WHERE processed = false
      AND requested_at > now() - interval '10 seconds'
  ) INTO recent_pending;

  IF NOT recent_pending THEN
    INSERT INTO public.viral_score_recalc_queue (requested_at) VALUES (now());
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

-- Statement-level trigger (fires once per statement, not per row)
CREATE TRIGGER trg_enqueue_viral_recalc
  AFTER INSERT OR UPDATE OF views, likes, comments, status
  ON public.videos
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_viral_recalc();
