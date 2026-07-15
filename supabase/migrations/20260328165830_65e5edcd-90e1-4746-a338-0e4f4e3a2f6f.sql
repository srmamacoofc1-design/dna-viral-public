ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS viral_score numeric NULL,
  ADD COLUMN IF NOT EXISTS peso_percentual numeric NULL,
  ADD COLUMN IF NOT EXISTS views_norm numeric NULL,
  ADD COLUMN IF NOT EXISTS likes_norm numeric NULL,
  ADD COLUMN IF NOT EXISTS comments_norm numeric NULL,
  ADD COLUMN IF NOT EXISTS engagement_rate numeric NULL,
  ADD COLUMN IF NOT EXISTS engagement_rate_norm numeric NULL;