-- Create storage bucket for video files
INSERT INTO storage.buckets (id, name, public)
VALUES ('videos', 'videos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public uploads to the videos bucket
CREATE POLICY "Allow public upload videos"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (bucket_id = 'videos');

-- Allow public read from videos bucket
CREATE POLICY "Allow public read videos"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'videos');

-- Allow public delete from videos bucket
CREATE POLICY "Allow public delete videos"
ON storage.objects
FOR DELETE
TO public
USING (bucket_id = 'videos');