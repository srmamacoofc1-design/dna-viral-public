
CREATE TYPE public.video_segmento AS ENUM ('meme', 'curiosidade', 'misterio', 'terror', 'historia_real', 'narrativa_biblica');
CREATE TYPE public.video_estilo_visual AS ENUM ('filme', '3d', 'live_action', 'animacao', 'cgi', 'stock_footage');
CREATE TYPE public.processing_status AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TYPE public.tipo_bloco AS ENUM ('hook', 'setup', 'desenvolvimento', 'tensao', 'revelacao', 'payoff', 'transicao', 'loop');
CREATE TYPE public.emocao AS ENUM ('curiosidade', 'surpresa', 'medo', 'tensao', 'alivio', 'expectativa', 'impacto');
CREATE TYPE public.tipo_gancho AS ENUM ('visual', 'texto', 'acao', 'pergunta');
CREATE TYPE public.intensidade_emocional AS ENUM ('baixa', 'media', 'alta');

CREATE TABLE public.videos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo TEXT NOT NULL,
  origem TEXT,
  tipo_entrada TEXT NOT NULL CHECK (tipo_entrada IN ('upload', 'link')),
  segmento video_segmento NOT NULL,
  estilo_visual video_estilo_visual NOT NULL,
  status processing_status NOT NULL DEFAULT 'pending',
  duracao NUMERIC,
  resolucao TEXT,
  fps INTEGER,
  tamanho BIGINT,
  codec TEXT,
  thumbnail TEXT,
  numero_frames INTEGER,
  numero_blocos INTEGER,
  idioma TEXT,
  tipo_viral TEXT,
  gancho_detectado BOOLEAN DEFAULT FALSE,
  tempo_gancho NUMERIC,
  duracao_gancho NUMERIC,
  tipo_gancho tipo_gancho,
  emocao_predominante emocao,
  intensidade_emocional intensidade_emocional,
  tempo_primeiro_evento NUMERIC,
  tempo_primeira_revelacao NUMERIC,
  tempo_payoff NUMERIC,
  loop_detectado BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.video_frames (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  frame_number INTEGER NOT NULL,
  timestamp_seconds NUMERIC NOT NULL,
  file_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.video_transcripts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  tempo_inicio NUMERIC NOT NULL,
  tempo_fim NUMERIC NOT NULL,
  texto TEXT NOT NULL,
  duracao NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.video_blocks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  bloco_id INTEGER NOT NULL,
  tempo_inicio NUMERIC NOT NULL,
  tempo_fim NUMERIC NOT NULL,
  texto TEXT,
  frame_url TEXT,
  tipo_bloco tipo_bloco NOT NULL,
  funcao_narrativa TEXT,
  emocao emocao,
  elemento_visual TEXT,
  descricao_visual TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.video_metadata (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  chave TEXT NOT NULL,
  valor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.processing_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  status processing_status NOT NULL DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.video_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  etapa TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'warning')),
  mensagem TEXT,
  duracao_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_videos_status ON public.videos(status);
CREATE INDEX idx_video_frames_video_id ON public.video_frames(video_id);
CREATE INDEX idx_video_transcripts_video_id ON public.video_transcripts(video_id);
CREATE INDEX idx_video_blocks_video_id ON public.video_blocks(video_id);
CREATE INDEX idx_video_metadata_video_id ON public.video_metadata(video_id);
CREATE INDEX idx_processing_queue_status ON public.processing_queue(status);
CREATE INDEX idx_video_logs_video_id ON public.video_logs(video_id);

ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read videos" ON public.videos FOR SELECT USING (true);
CREATE POLICY "Allow public insert videos" ON public.videos FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update videos" ON public.videos FOR UPDATE USING (true);
CREATE POLICY "Allow public read video_frames" ON public.video_frames FOR SELECT USING (true);
CREATE POLICY "Allow public insert video_frames" ON public.video_frames FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public read video_transcripts" ON public.video_transcripts FOR SELECT USING (true);
CREATE POLICY "Allow public insert video_transcripts" ON public.video_transcripts FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public read video_blocks" ON public.video_blocks FOR SELECT USING (true);
CREATE POLICY "Allow public insert video_blocks" ON public.video_blocks FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public read video_metadata" ON public.video_metadata FOR SELECT USING (true);
CREATE POLICY "Allow public insert video_metadata" ON public.video_metadata FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public read processing_queue" ON public.processing_queue FOR SELECT USING (true);
CREATE POLICY "Allow public insert processing_queue" ON public.processing_queue FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update processing_queue" ON public.processing_queue FOR UPDATE USING (true);
CREATE POLICY "Allow public read video_logs" ON public.video_logs FOR SELECT USING (true);
CREATE POLICY "Allow public insert video_logs" ON public.video_logs FOR INSERT WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_videos_updated_at BEFORE UPDATE ON public.videos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_processing_queue_updated_at BEFORE UPDATE ON public.processing_queue FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
