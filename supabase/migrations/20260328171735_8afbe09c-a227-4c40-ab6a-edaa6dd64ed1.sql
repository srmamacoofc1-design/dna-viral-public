-- Keep the database-side queue portable and fail-safe.
--
-- Processing is owned by an authenticated worker/Edge Function configured at
-- deploy time. This database function must not embed a project URL or token,
-- and it must not mark pending work as processed when no worker handled it.
CREATE OR REPLACE FUNCTION public.process_viral_recalc_queue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only completed queue entries are housekeeping candidates. Pending entries
  -- are intentionally preserved for the externally configured worker.
  DELETE FROM public.viral_score_recalc_queue
  WHERE processed = true
    AND requested_at < now() - interval '1 hour';
END;
$$;
