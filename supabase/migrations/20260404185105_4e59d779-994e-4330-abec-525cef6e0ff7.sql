
-- Rename misleading columns in videos table to observational names
ALTER TABLE public.videos RENAME COLUMN viral_score TO engagement_rate_relative;
ALTER TABLE public.videos RENAME COLUMN viral_score_pct TO engagement_percentile;
ALTER TABLE public.videos RENAME COLUMN viral_score_log TO engagement_rate_log;
ALTER TABLE public.videos RENAME COLUMN hero_score_pct TO engagement_percentile_display;
ALTER TABLE public.videos RENAME COLUMN peso_percentual TO dataset_weight_pct;
