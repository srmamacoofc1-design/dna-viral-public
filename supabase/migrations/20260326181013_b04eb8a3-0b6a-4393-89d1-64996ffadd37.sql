
-- Add language_code to video_transcripts
ALTER TABLE public.video_transcripts ADD COLUMN language_code text NOT NULL DEFAULT 'pt';

-- Add language_code to video_blocks
ALTER TABLE public.video_blocks ADD COLUMN language_code text NOT NULL DEFAULT 'pt';

-- Create supported_languages table
CREATE TABLE public.supported_languages (
  code text PRIMARY KEY,
  name text NOT NULL,
  native_name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.supported_languages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read supported_languages" ON public.supported_languages FOR SELECT TO public USING (true);

-- Insert initial languages
INSERT INTO public.supported_languages (code, name, native_name) VALUES
  ('pt', 'Português', 'Português'),
  ('en', 'English', 'English'),
  ('es', 'Español', 'Español'),
  ('fr', 'Français', 'Français');

-- Create video_languages table (which languages a video has)
CREATE TABLE public.video_languages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  language_code text NOT NULL REFERENCES public.supported_languages(code),
  is_original boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(video_id, language_code)
);

ALTER TABLE public.video_languages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read video_languages" ON public.video_languages FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert video_languages" ON public.video_languages FOR INSERT TO public WITH CHECK (true);

-- Create video_scripts table for multilingual scripts
CREATE TABLE public.video_scripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  language_code text NOT NULL REFERENCES public.supported_languages(code),
  roteiro text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(video_id, language_code)
);

ALTER TABLE public.video_scripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read video_scripts" ON public.video_scripts FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert video_scripts" ON public.video_scripts FOR INSERT TO public WITH CHECK (true);
