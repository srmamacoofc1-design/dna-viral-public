
CREATE TABLE public.dna_base_v2_formal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_name text NOT NULL DEFAULT 'DNA_FORMAL_V1',
  generated_at timestamptz NOT NULL DEFAULT now(),
  source_dna_base_v2_id uuid REFERENCES public.dna_base_v2(id),

  -- 1) structural
  structural jsonb NOT NULL DEFAULT '{}',

  -- 2) temporal
  temporal jsonb NOT NULL DEFAULT '{}',

  -- 3) verbal
  verbal jsonb NOT NULL DEFAULT '{}',

  -- 4) emotional
  emotional jsonb NOT NULL DEFAULT '{}',

  -- 5) performance
  performance jsonb NOT NULL DEFAULT '{}',

  -- full formal object
  formal_dna_json jsonb NOT NULL DEFAULT '{}',

  -- metadata
  total_videos_used integer DEFAULT 0,
  total_blocks_used integer DEFAULT 0,
  data_sources_used jsonb DEFAULT '[]',
  consistency_check jsonb DEFAULT '{}',

  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dna_base_v2_formal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read dna_base_v2_formal"
  ON public.dna_base_v2_formal FOR SELECT
  USING (true);

CREATE POLICY "Allow public insert dna_base_v2_formal"
  ON public.dna_base_v2_formal FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow public delete dna_base_v2_formal"
  ON public.dna_base_v2_formal FOR DELETE
  USING (true);
