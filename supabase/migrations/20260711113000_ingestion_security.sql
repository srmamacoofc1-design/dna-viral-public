-- The viral library is a shared administrator-owned corpus. Older policies
-- allowed the anon key to mutate every video, queue row and Storage object.
-- Keep existing public reads for backwards compatibility, but require an
-- authenticated administrator for all corpus mutations.

DROP POLICY IF EXISTS "Allow public insert videos" ON public.videos;
DROP POLICY IF EXISTS "Allow public update videos" ON public.videos;
DROP POLICY IF EXISTS "Allow public delete videos" ON public.videos;
CREATE POLICY "videos_admin_mutation" ON public.videos
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Allow public insert video_frames" ON public.video_frames;
DROP POLICY IF EXISTS "Allow public update video_frames" ON public.video_frames;
DROP POLICY IF EXISTS "Allow public delete video_frames" ON public.video_frames;
CREATE POLICY "video_frames_admin_mutation" ON public.video_frames
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Allow public insert video_transcripts" ON public.video_transcripts;
DROP POLICY IF EXISTS "Allow public delete video_transcripts" ON public.video_transcripts;
CREATE POLICY "video_transcripts_admin_mutation" ON public.video_transcripts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Allow public insert video_blocks" ON public.video_blocks;
DROP POLICY IF EXISTS "Allow public delete video_blocks" ON public.video_blocks;
CREATE POLICY "video_blocks_admin_mutation" ON public.video_blocks
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Allow public insert video_metadata" ON public.video_metadata;
DROP POLICY IF EXISTS "Allow public update video_metadata" ON public.video_metadata;
DROP POLICY IF EXISTS "Allow public delete video_metadata" ON public.video_metadata;
CREATE POLICY "video_metadata_admin_mutation" ON public.video_metadata
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Allow public insert processing_queue" ON public.processing_queue;
DROP POLICY IF EXISTS "Allow public update processing_queue" ON public.processing_queue;
DROP POLICY IF EXISTS "Allow public delete processing_queue" ON public.processing_queue;
CREATE POLICY "processing_queue_admin_mutation" ON public.processing_queue
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Allow public insert video_logs" ON public.video_logs;
DROP POLICY IF EXISTS "Allow public delete video_logs" ON public.video_logs;
CREATE POLICY "video_logs_admin_mutation" ON public.video_logs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- The bucket must stay public until legacy library frame URLs are migrated to
-- signed URLs. Mutations, however, must never be anonymous. Members may upload
-- only generation-reference objects under reference/<own-user-id>/... .
DROP POLICY IF EXISTS "Allow public upload videos" ON storage.objects;
DROP POLICY IF EXISTS "Allow public delete videos" ON storage.objects;

CREATE POLICY "videos_storage_authenticated_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'videos'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR (
        (storage.foldername(name))[1] = 'reference'
        AND (storage.foldername(name))[2] = auth.uid()::text
      )
    )
  );

CREATE POLICY "videos_storage_authenticated_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'videos'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR (
        (storage.foldername(name))[1] = 'reference'
        AND (storage.foldername(name))[2] = auth.uid()::text
      )
    )
  )
  WITH CHECK (
    bucket_id = 'videos'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR (
        (storage.foldername(name))[1] = 'reference'
        AND (storage.foldername(name))[2] = auth.uid()::text
      )
    )
  );

CREATE POLICY "videos_storage_authenticated_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'videos'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR (
        (storage.foldername(name))[1] = 'reference'
        AND (storage.foldername(name))[2] = auth.uid()::text
      )
    )
  );
