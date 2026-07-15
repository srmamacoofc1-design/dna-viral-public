-- Function to clean old audit trail records (> 90 days)
CREATE OR REPLACE FUNCTION public.cleanup_audit_trail()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.audit_trail
  WHERE created_at < now() - interval '90 days';
END;
$$;

-- Schedule daily cleanup at 3 AM UTC via pg_cron
SELECT cron.schedule(
  'cleanup-audit-trail-daily',
  '0 3 * * *',
  $$SELECT public.cleanup_audit_trail()$$
);

-- Also clean old extraction_logs > 90 days
CREATE OR REPLACE FUNCTION public.cleanup_extraction_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.extraction_logs
  WHERE created_at < now() - interval '90 days';
END;
$$;

SELECT cron.schedule(
  'cleanup-extraction-logs-daily',
  '0 3 * * *',
  $$SELECT public.cleanup_extraction_logs()$$
);