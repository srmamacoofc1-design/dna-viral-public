
-- Drop insecure public policies on reference video child tables
DROP POLICY IF EXISTS "Allow public all reference_video_frames" ON public.reference_video_frames;
DROP POLICY IF EXISTS "Allow public all reference_video_transcripts" ON public.reference_video_transcripts;
DROP POLICY IF EXISTS "Allow public all reference_video_topics" ON public.reference_video_topics;

-- reference_video_frames: isolate via parent reference_videos.user_id
CREATE POLICY "rvf_select_own_or_admin" ON public.reference_video_frames
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.reference_videos rv WHERE rv.id = reference_video_id AND (rv.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))
  );

CREATE POLICY "rvf_insert_own_or_admin" ON public.reference_video_frames
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.reference_videos rv WHERE rv.id = reference_video_id AND (rv.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))
  );

CREATE POLICY "rvf_update_own_or_admin" ON public.reference_video_frames
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.reference_videos rv WHERE rv.id = reference_video_id AND (rv.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))
  );

CREATE POLICY "rvf_delete_admin_only" ON public.reference_video_frames
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- reference_video_transcripts
CREATE POLICY "rvt_select_own_or_admin" ON public.reference_video_transcripts
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.reference_videos rv WHERE rv.id = reference_video_id AND (rv.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))
  );

CREATE POLICY "rvt_insert_own_or_admin" ON public.reference_video_transcripts
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.reference_videos rv WHERE rv.id = reference_video_id AND (rv.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))
  );

CREATE POLICY "rvt_update_own_or_admin" ON public.reference_video_transcripts
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.reference_videos rv WHERE rv.id = reference_video_id AND (rv.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))
  );

CREATE POLICY "rvt_delete_admin_only" ON public.reference_video_transcripts
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- reference_video_topics
CREATE POLICY "rvtp_select_own_or_admin" ON public.reference_video_topics
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.reference_videos rv WHERE rv.id = reference_video_id AND (rv.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))
  );

CREATE POLICY "rvtp_insert_own_or_admin" ON public.reference_video_topics
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.reference_videos rv WHERE rv.id = reference_video_id AND (rv.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))
  );

CREATE POLICY "rvtp_update_own_or_admin" ON public.reference_video_topics
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.reference_videos rv WHERE rv.id = reference_video_id AND (rv.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))
  );

CREATE POLICY "rvtp_delete_admin_only" ON public.reference_video_topics
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
