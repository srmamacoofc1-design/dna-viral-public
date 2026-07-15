ALTER TABLE public.script_assemblies
  ADD COLUMN validation_result jsonb NULL,
  ADD COLUMN validation_status text NULL,
  ADD COLUMN validated_at timestamptz NULL,
  ADD COLUMN validation_version integer NOT NULL DEFAULT 1;