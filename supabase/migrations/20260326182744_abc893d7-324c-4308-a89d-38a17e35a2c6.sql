
-- Allow public delete on videos (cascade handles related tables)
CREATE POLICY "Allow public delete videos" ON public.videos FOR DELETE TO public USING (true);

-- Allow public delete on processing_queue
CREATE POLICY "Allow public delete processing_queue" ON public.processing_queue FOR DELETE TO public USING (true);

-- Allow public delete on video_languages
CREATE POLICY "Allow public delete video_languages" ON public.video_languages FOR DELETE TO public USING (true);

-- Allow public delete on video_blocks
CREATE POLICY "Allow public delete video_blocks" ON public.video_blocks FOR DELETE TO public USING (true);

-- Allow public delete on video_transcripts
CREATE POLICY "Allow public delete video_transcripts" ON public.video_transcripts FOR DELETE TO public USING (true);

-- Allow public delete on video_logs
CREATE POLICY "Allow public delete video_logs" ON public.video_logs FOR DELETE TO public USING (true);

-- Allow public delete on video_metadata
CREATE POLICY "Allow public delete video_metadata" ON public.video_metadata FOR DELETE TO public USING (true);

-- Allow public delete on video_frames
CREATE POLICY "Allow public delete video_frames" ON public.video_frames FOR DELETE TO public USING (true);

-- Allow public delete on video_scripts
CREATE POLICY "Allow public delete video_scripts" ON public.video_scripts FOR DELETE TO public USING (true);
