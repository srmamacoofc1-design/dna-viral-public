-- One all-or-nothing boundary for the 16 independently reviewed videos.
-- Frame-object publication happens before this RPC, but database state must
-- never contain only an arbitrary prefix of the reviewed cohort.

CREATE OR REPLACE FUNCTION public.commit_codex_manual_audited_batch(
  _payloads jsonb,
  _manifest_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  _expected_ids constant text[] := ARRAY[
    'Zpi10UTydLU','0P8vcxxyuoI','KqGxjJ21Eqk','xTdr9tsT_4g',
    'vpY4sfLYQSY','JIcwpf_aE4o','j19oBZL2d-8','89_3HIcw80A',
    '6FP7nKEwLDo','1uVrM46e_yw','gsF_ZZ94Ue8','4Cz5ZMsGoT4',
    'xkzJeq1U_oM','6WNDlb8ame4','UKsKkmkpDi0','qyrjKm3KP0o'
  ];
  _claim_role text := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
  _youtube_id text;
  _payload jsonb;
  _result jsonb;
  _results jsonb := '[]'::jsonb;
BEGIN
  IF _claim_role <> 'service_role' AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_payloads) <> 'array'
     OR jsonb_array_length(_payloads) <> cardinality(_expected_ids)
     OR COALESCE(_manifest_sha256, '') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'CODEX_MANUAL_BATCH_SCHEMA_INVALID' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT value ->> 'youtube_id') FROM jsonb_array_elements(_payloads)) <> cardinality(_expected_ids)
     OR EXISTS (
       SELECT expected_id FROM unnest(_expected_ids) AS expected(expected_id)
       EXCEPT SELECT value ->> 'youtube_id' FROM jsonb_array_elements(_payloads)
     ) OR EXISTS (
       SELECT value ->> 'youtube_id' FROM jsonb_array_elements(_payloads)
       EXCEPT SELECT expected_id FROM unnest(_expected_ids) AS expected(expected_id)
     ) THEN
    RAISE EXCEPTION 'CODEX_MANUAL_BATCH_INVENTORY_MISMATCH' USING ERRCODE = '22023';
  END IF;

  -- Validation and writes run in the caller transaction. If any one payload
  -- fails the existing per-video fail-closed RPC, PostgreSQL rolls all 16
  -- video changes back together.
  FOREACH _youtube_id IN ARRAY _expected_ids LOOP
    SELECT value INTO _payload
      FROM jsonb_array_elements(_payloads) AS item(value)
     WHERE value ->> 'youtube_id' = _youtube_id;
    IF _payload IS NULL
       OR COALESCE(_payload ->> 'video_payload_sha256', '') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'CODEX_MANUAL_BATCH_PAYLOAD_INVALID:%', _youtube_id USING ERRCODE = '22023';
    END IF;
    _result := public.commit_codex_manual_audited_video(
      _youtube_id,
      _payload,
      _payload ->> 'video_payload_sha256',
      _manifest_sha256
    );
    _results := _results || jsonb_build_array(_result);
  END LOOP;

  RETURN jsonb_build_object(
    'atomic', true,
    'manifest_sha256', _manifest_sha256,
    'count', cardinality(_expected_ids),
    'results', _results
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.commit_codex_manual_audited_batch(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_codex_manual_audited_batch(jsonb, text) FROM anon;
REVOKE ALL ON FUNCTION public.commit_codex_manual_audited_batch(jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.commit_codex_manual_audited_batch(jsonb, text) TO service_role;
