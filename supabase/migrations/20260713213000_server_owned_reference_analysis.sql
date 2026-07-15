-- Users may reserve/upload their own reference media, but only trusted Edge
-- Functions may publish derived transcription, visual evidence, topics, or a
-- `ready` state. This prevents a browser from fabricating completed analysis.

DROP POLICY IF EXISTS "rv_insert_own_or_admin" ON public.reference_videos;
DROP POLICY IF EXISTS "rv_update_own_or_admin" ON public.reference_videos;
DROP POLICY IF EXISTS "rv_insert_raw_own_or_admin" ON public.reference_videos;
DROP POLICY IF EXISTS "rv_update_raw_own_or_admin" ON public.reference_videos;

CREATE POLICY "rv_insert_raw_own_or_admin" ON public.reference_videos
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR (
      user_id = auth.uid()
      AND storage_bucket = 'reference-videos'
      AND (
        storage_path IS NULL
        OR (
          (storage.foldername(storage_path))[1] = 'reference'
          AND (storage.foldername(storage_path))[2] = auth.uid()::text
        )
      )
      AND status IN ('uploading', 'pending', 'error')
      AND transcription IS NULL
      AND COALESCE(transcription_segments, '[]'::jsonb) = '[]'::jsonb
      AND COALESCE(frames, '[]'::jsonb) = '[]'::jsonb
      AND duration_seconds IS NULL
    )
  );

CREATE POLICY "rv_update_raw_own_or_admin" ON public.reference_videos
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR (
      user_id = auth.uid()
      AND storage_bucket = 'reference-videos'
      AND (
        storage_path IS NULL
        OR (
          (storage.foldername(storage_path))[1] = 'reference'
          AND (storage.foldername(storage_path))[2] = auth.uid()::text
        )
      )
      AND status IN ('uploading', 'pending', 'error')
      AND transcription IS NULL
      AND COALESCE(transcription_segments, '[]'::jsonb) = '[]'::jsonb
      AND COALESCE(frames, '[]'::jsonb) = '[]'::jsonb
      AND duration_seconds IS NULL
    )
  );

-- Derived evidence inherits owner-scoped read access from reference_videos,
-- while all mutations are restricted to admins. Service-role Edge Functions
-- bypass RLS and remain the normal writers.
DROP POLICY IF EXISTS "Allow public all reference_video_frames" ON public.reference_video_frames;
DROP POLICY IF EXISTS "rvf_select_own_or_admin" ON public.reference_video_frames;
DROP POLICY IF EXISTS "rvf_insert_own_or_admin" ON public.reference_video_frames;
DROP POLICY IF EXISTS "rvf_update_own_or_admin" ON public.reference_video_frames;
DROP POLICY IF EXISTS "rvf_delete_admin_only" ON public.reference_video_frames;
DROP POLICY IF EXISTS "rvf_insert_admin_only" ON public.reference_video_frames;
DROP POLICY IF EXISTS "rvf_update_admin_only" ON public.reference_video_frames;

CREATE POLICY "rvf_select_own_or_admin" ON public.reference_video_frames
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.reference_videos rv
      WHERE rv.id = reference_video_id
        AND (rv.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );
CREATE POLICY "rvf_insert_admin_only" ON public.reference_video_frames
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "rvf_update_admin_only" ON public.reference_video_frames
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "rvf_delete_admin_only" ON public.reference_video_frames
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Allow public all reference_video_transcripts" ON public.reference_video_transcripts;
DROP POLICY IF EXISTS "rvt_select_own_or_admin" ON public.reference_video_transcripts;
DROP POLICY IF EXISTS "rvt_insert_own_or_admin" ON public.reference_video_transcripts;
DROP POLICY IF EXISTS "rvt_update_own_or_admin" ON public.reference_video_transcripts;
DROP POLICY IF EXISTS "rvt_delete_admin_only" ON public.reference_video_transcripts;
DROP POLICY IF EXISTS "rvt_insert_admin_only" ON public.reference_video_transcripts;
DROP POLICY IF EXISTS "rvt_update_admin_only" ON public.reference_video_transcripts;

CREATE POLICY "rvt_select_own_or_admin" ON public.reference_video_transcripts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.reference_videos rv
      WHERE rv.id = reference_video_id
        AND (rv.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );
CREATE POLICY "rvt_insert_admin_only" ON public.reference_video_transcripts
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "rvt_update_admin_only" ON public.reference_video_transcripts
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "rvt_delete_admin_only" ON public.reference_video_transcripts
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Allow public all reference_video_topics" ON public.reference_video_topics;
DROP POLICY IF EXISTS "rvtp_select_own_or_admin" ON public.reference_video_topics;
DROP POLICY IF EXISTS "rvtp_insert_own_or_admin" ON public.reference_video_topics;
DROP POLICY IF EXISTS "rvtp_update_own_or_admin" ON public.reference_video_topics;
DROP POLICY IF EXISTS "rvtp_delete_admin_only" ON public.reference_video_topics;
DROP POLICY IF EXISTS "rvtp_insert_admin_only" ON public.reference_video_topics;
DROP POLICY IF EXISTS "rvtp_update_admin_only" ON public.reference_video_topics;

CREATE POLICY "rvtp_select_own_or_admin" ON public.reference_video_topics
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.reference_videos rv
      WHERE rv.id = reference_video_id
        AND (rv.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );
CREATE POLICY "rvtp_insert_admin_only" ON public.reference_video_topics
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "rvtp_update_admin_only" ON public.reference_video_topics
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "rvtp_delete_admin_only" ON public.reference_video_topics
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
