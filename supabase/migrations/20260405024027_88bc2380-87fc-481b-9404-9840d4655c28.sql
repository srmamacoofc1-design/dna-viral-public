
-- dna_objects
ALTER TABLE public.dna_objects RENAME COLUMN avg_viral_score TO avg_engagement_rate;

-- verbal_canonical_units
ALTER TABLE public.verbal_canonical_units RENAME COLUMN viral_strength TO narrative_replicability_score;
ALTER TABLE public.verbal_canonical_units RENAME COLUMN video_viral_score TO video_engagement_rate;

-- verbal_narrative_sequences
ALTER TABLE public.verbal_narrative_sequences RENAME COLUMN avg_viral_score TO avg_engagement_rate;
ALTER TABLE public.verbal_narrative_sequences RENAME COLUMN avg_viral_strength TO avg_replicability_score;

-- verbal_intelligence_summary
ALTER TABLE public.verbal_intelligence_summary RENAME COLUMN avg_viral_strength TO avg_replicability_score;

-- verbal_layer_patterns
ALTER TABLE public.verbal_layer_patterns RENAME COLUMN avg_viral_score TO avg_engagement_rate;
ALTER TABLE public.verbal_layer_patterns RENAME COLUMN viral_weighted_words TO engagement_weighted_words;
ALTER TABLE public.verbal_layer_patterns RENAME COLUMN viral_weighted_phrases TO engagement_weighted_phrases;

-- cohort_analysis_summary
ALTER TABLE public.cohort_analysis_summary RENAME COLUMN avg_viral_score TO avg_engagement_rate;

-- verbal_phase2_profile
ALTER TABLE public.verbal_phase2_profile RENAME COLUMN avg_viral_strength TO avg_replicability_score;
