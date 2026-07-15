import { useParams, Link } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { FichaTecnica } from '@/components/FichaTecnica';
import { NarrativeTimeline } from '@/components/NarrativeTimeline';
import { BlocksTable } from '@/components/BlocksTable';
import { ProcessingLogs } from '@/components/ProcessingLogs';
import { TranscriptionTab } from '@/components/TranscriptionTab';
import { DataIntegrityValidation } from '@/components/report/DataIntegrityValidation';
import { NarrativeRhythm } from '@/components/report/NarrativeRhythm';
import { BlockAnalysis } from '@/components/report/BlockAnalysis';
import { StimulusIntervals } from '@/components/report/StimulusIntervals';
import { NarrativeCharts } from '@/components/report/NarrativeCharts';
import { NarrativeDNA } from '@/components/report/NarrativeDNA';
import { PerformanceWeight } from '@/components/report/PerformanceWeight';
import { TechLog } from '@/components/report/TechLog';
import { ExtractionAuditLog } from '@/components/report/ExtractionAuditLog';
import { ConsistencyValidator } from '@/components/report/ConsistencyValidator';
import { AuditTimeline } from '@/components/report/AuditTimeline';
import { AIClassification } from '@/components/report/AIClassification';
import { VisualBlockAnalysis } from '@/components/report/VisualBlockAnalysis';
import { TextVisualAlignment } from '@/components/report/TextVisualAlignment';
import { VerbalDNAReport } from '@/components/report/VerbalDNAReport';
import { CTADeepReport } from '@/components/report/CTADeepReport';
import { TextImageCompatibility } from '@/components/report/TextImageCompatibility';
import { ArrowLeft, Globe, Languages, Loader2, Eye, Heart, MessageCircle, ShieldCheck, ShieldAlert, FileDown } from 'lucide-react';
import { Download, Printer } from 'lucide-react';
import { exportPageAsPDF } from '@/lib/export-pdf';
import { exportCompleteVideoObject } from '@/lib/build-complete-video-object';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Video, VideoBlock, VideoTranscript, ProcessingLog, EngagementStatus } from '@/types/video';
import { isEligibleForDNA, ENGAGEMENT_STATUS_LABELS } from '@/types/video';
import type { Tables } from '@/integrations/supabase/types';
import { useAuth } from '@/hooks/useAuth';

const LANGUAGES_LIST = [
  { code: 'pt', label: 'PT', full: 'Português' },
  { code: 'en', label: 'EN', full: 'English' },
  { code: 'es', label: 'ES', full: 'Español' },
  { code: 'fr', label: 'FR', full: 'Français' },
];

function deriveEngagementStatus(row: any): EngagementStatus {
  // If the DB has an engagement_status column, use it; otherwise derive from data
  if (row.engagement_status && ['ausente', 'informado', 'importado_pendente', 'importado_confirmado'].includes(row.engagement_status)) {
    return row.engagement_status as EngagementStatus;
  }
  const v = Number(row.views) || 0;
  const l = Number(row.likes) || 0;
  const c = Number(row.comments) || 0;
  // If all are 0 or null, status is absent
  if (v === 0 && l === 0 && c === 0) return 'ausente';
  // If there are values but no explicit status, mark as informed (legacy data)
  return 'informado';
}

function mapDbToVideo(row: Tables<'videos'>): Video {
  return {
    id: row.id,
    titulo: row.titulo,
    origem: row.origem || '',
    tipo_entrada: row.tipo_entrada as 'upload' | 'link',
    segmento: row.segmento,
    estilo_visual: row.estilo_visual,
    data_envio: row.created_at,
    status: row.status,
    duracao: row.duracao ? Number(row.duracao) : undefined,
    resolucao: row.resolucao || undefined,
    fps: row.fps || undefined,
    tamanho: row.tamanho ? Number(row.tamanho) : undefined,
    codec: row.codec || undefined,
    thumbnail: row.thumbnail || undefined,
    numero_frames: row.numero_frames || undefined,
    numero_blocos: row.numero_blocos || undefined,
    idioma: row.idioma || undefined,
    tipo_viral: row.tipo_viral || undefined,
    gancho_detectado: row.gancho_detectado ?? undefined,
    tempo_gancho: row.tempo_gancho != null ? Number(row.tempo_gancho) : undefined,
    duracao_gancho: row.duracao_gancho != null ? Number(row.duracao_gancho) : undefined,
    tipo_gancho: row.tipo_gancho || undefined,
    emocao_predominante: row.emocao_predominante || undefined,
    intensidade_emocional: row.intensidade_emocional || undefined,
    tempo_primeiro_evento: row.tempo_primeiro_evento ? Number(row.tempo_primeiro_evento) : undefined,
    tempo_primeira_revelacao: row.tempo_primeira_revelacao ? Number(row.tempo_primeira_revelacao) : undefined,
    tempo_payoff: row.tempo_payoff ? Number(row.tempo_payoff) : undefined,
    loop_detectado: row.loop_detectado || undefined,
    views: (row as any).views != null ? Number((row as any).views) : null,
    likes: (row as any).likes != null ? Number((row as any).likes) : null,
    comments: (row as any).comments != null ? Number((row as any).comments) : null,
    engagement_status: deriveEngagementStatus(row),
  };
}

function mapDbBlock(row: Tables<'video_blocks'>): VideoBlock {
  return {
    id: row.id,
    video_id: row.video_id,
    bloco_id: row.bloco_id,
    tempo_inicio: Number(row.tempo_inicio),
    tempo_fim: Number(row.tempo_fim),
    texto: row.texto || undefined,
    frame_url: row.frame_url || undefined,
    tipo_bloco: row.tipo_bloco as VideoBlock['tipo_bloco'],
    funcao_narrativa: row.funcao_narrativa || '',
    emocao: row.emocao as VideoBlock['emocao'],
    elemento_visual: row.elemento_visual || undefined,
    descricao_visual: row.descricao_visual || undefined,
  };
}

function mapDbTranscript(row: Tables<'video_transcripts'>): VideoTranscript {
  return {
    id: row.id,
    video_id: row.video_id,
    tempo_inicio: Number(row.tempo_inicio),
    tempo_fim: Number(row.tempo_fim),
    texto: row.texto,
    duracao: Number(row.duracao),
  };
}

function mapDbLog(row: Tables<'video_logs'>): ProcessingLog {
  return {
    id: row.id,
    video_id: row.video_id,
    etapa: row.etapa,
    status: (row.status === 'ok' ? 'success' : row.status === 'error' ? 'error' : 'success') as ProcessingLog['status'],
    mensagem: row.mensagem || '',
    timestamp: row.created_at,
    duracao_ms: row.duracao_ms || undefined,
  };
}

/** Calculate library totals only from eligible videos */
function calculateEligibleTotals(rows: any[]): { views: number; likes: number; comments: number; eligibleCount: number } {
  const totals = { views: 0, likes: 0, comments: 0, eligibleCount: 0 };
  rows.forEach((r: any) => {
    const status = deriveEngagementStatus(r);
    const vid = { views: Number(r.views) || 0, likes: Number(r.likes) || 0, comments: Number(r.comments) || 0, engagement_status: status };
    if (isEligibleForDNA(vid)) {
      totals.views += vid.views;
      totals.likes += vid.likes;
      totals.comments += vid.comments;
      totals.eligibleCount++;
    }
  });
  return totals;
}

async function translateTexts(texts: string[], sourceLang: string, targetLang: string): Promise<string[]> {
  const { data, error } = await supabase.functions.invoke('translate', {
    body: { texts, source_lang: sourceLang, target_lang: targetLang },
  });
  if (error) throw new Error(error.message || 'Translation failed');
  if (data?.error) throw new Error(data.error);
  return data.translations;
}

export default function VideoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, isAdmin } = useAuth();
  const [videoRaw, setVideoRaw] = useState<Tables<'videos'> | null>(null);
  const [video, setVideo] = useState<Video | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedLang, setSelectedLang] = useState('pt');
  const [activeBlockId, setActiveBlockId] = useState<string | undefined>();
  const [translating, setTranslating] = useState(false);

  const [blocksByLang, setBlocksByLang] = useState<Record<string, VideoBlock[]>>({});
  const [transcriptsByLang, setTranscriptsByLang] = useState<Record<string, VideoTranscript[]>>({});
  const [logs, setLogs] = useState<ProcessingLog[]>([]);
  const [availableLangs, setAvailableLangs] = useState<Set<string>>(new Set(['pt']));
  const [libraryTotals, setLibraryTotals] = useState({ views: 0, likes: 0, comments: 0, eligibleCount: 0 });
  const canManageVideo = Boolean(videoRaw && (isAdmin || videoRaw.created_by === user?.id));

  const getPrimaryLanguage = useCallback((langs: Iterable<string>, detected?: string | null) => {
    const normalized = Array.from(new Set(Array.from(langs).filter(Boolean)));
    if (detected && normalized.includes(detected)) return detected;
    if (normalized.includes('pt')) return 'pt';
    return normalized[0] || 'pt';
  }, []);

  useEffect(() => {
    if (!id) return;
    const fetchAll = async () => {
      const [videoRes, blocksRes, transcriptsRes, logsRes, langsRes, allVideosRes] = await Promise.all([
        supabase.from('videos').select('*').eq('id', id).single(),
        supabase.from('video_blocks').select('*').eq('video_id', id).order('bloco_id'),
        supabase.from('video_transcripts').select('*').eq('video_id', id).order('tempo_inicio'),
        supabase.from('video_logs').select('*').eq('video_id', id).order('created_at'),
        supabase.from('video_languages').select('language_code').eq('video_id', id),
        supabase.from('videos').select('views,likes,comments').eq('status', 'completed'),
      ]);

      if (videoRes.data) {
        setVideoRaw(videoRes.data);
        setVideo(mapDbToVideo(videoRes.data));
      }

      // Calculate library totals ONLY from eligible videos
      if (allVideosRes.data) {
        setLibraryTotals(calculateEligibleTotals(allVideosRes.data));
      }

      const blocksGrouped: Record<string, VideoBlock[]> = {};
      (blocksRes.data || []).forEach(row => {
        const lang = row.language_code || 'pt';
        if (!blocksGrouped[lang]) blocksGrouped[lang] = [];
        blocksGrouped[lang].push(mapDbBlock(row));
      });
      setBlocksByLang(blocksGrouped);

      const transcriptsGrouped: Record<string, VideoTranscript[]> = {};
      (transcriptsRes.data || []).forEach(row => {
        const lang = row.language_code || 'pt';
        if (!transcriptsGrouped[lang]) transcriptsGrouped[lang] = [];
        transcriptsGrouped[lang].push(mapDbTranscript(row));
      });
      setTranscriptsByLang(transcriptsGrouped);

      setLogs((logsRes.data || []).map(mapDbLog));

      const langs = new Set((langsRes.data || []).map(l => l.language_code));
      Object.keys(blocksGrouped).forEach(l => langs.add(l));
      Object.keys(transcriptsGrouped).forEach(l => langs.add(l));
      setAvailableLangs(langs);
      setSelectedLang(getPrimaryLanguage(langs, videoRes.data?.idioma));

      setLoading(false);
    };
    fetchAll();
  }, [id, getPrimaryLanguage]);

  const fallbackLang = getPrimaryLanguage(
    new Set([...Object.keys(blocksByLang), ...Object.keys(transcriptsByLang), ...Array.from(availableLangs)]),
    video?.idioma,
  );

  const currentBlocks = blocksByLang[selectedLang] || blocksByLang[fallbackLang] || [];
  const currentTranscripts = transcriptsByLang[selectedLang] || transcriptsByLang[fallbackLang] || [];

  const handleTranslate = useCallback(async (targetLang: string) => {
    if (availableLangs.has(targetLang) && (blocksByLang[targetLang] || transcriptsByLang[targetLang])) return;
    if (!video || !canManageVideo) return;

    const sourceLang = getPrimaryLanguage(
      new Set([...Object.keys(blocksByLang), ...Object.keys(transcriptsByLang)]),
      video.idioma,
    );
    const sourceBlocks = blocksByLang[sourceLang] || [];
    const sourceTranscripts = transcriptsByLang[sourceLang] || [];

    if (sourceBlocks.length === 0 && sourceTranscripts.length === 0) {
      toast.error('Sem dados disponíveis no idioma original para traduzir.');
      return;
    }

    setTranslating(true);
    const langName = LANGUAGES_LIST.find(l => l.code === targetLang)?.full || targetLang;
    toast.info(`Traduzindo para ${langName}...`);

    try {
      if (sourceTranscripts.length > 0) {
        const texts = sourceTranscripts.map(t => t.texto);
        const translated: string[] = [];
        for (let i = 0; i < texts.length; i += 20) {
          const chunk = texts.slice(i, i + 20);
          const result = await translateTexts(chunk, sourceLang, targetLang);
          translated.push(...result);
        }

        const newTranscripts = sourceTranscripts.map((t, i) => ({
          ...t,
          id: `${t.id}-${targetLang}`,
          texto: translated[i] || t.texto,
        }));
        setTranscriptsByLang(prev => ({ ...prev, [targetLang]: newTranscripts }));

        await supabase.from('video_transcripts').insert(
          newTranscripts.map(t => ({
            video_id: video.id,
            language_code: targetLang,
            tempo_inicio: t.tempo_inicio,
            tempo_fim: t.tempo_fim,
            texto: t.texto,
            duracao: t.duracao,
          }))
        );
      }

      if (sourceBlocks.length > 0) {
        const blockTexts = sourceBlocks.map(b => b.texto || '');
        const nonEmptyIdx = blockTexts.map((t, i) => t ? i : -1).filter(i => i >= 0);
        const nonEmptyTexts = nonEmptyIdx.map(i => blockTexts[i]);

        if (nonEmptyTexts.length > 0) {
          const translated: string[] = [];
          for (let i = 0; i < nonEmptyTexts.length; i += 20) {
            const chunk = nonEmptyTexts.slice(i, i + 20);
            const result = await translateTexts(chunk, sourceLang, targetLang);
            translated.push(...result);
          }

          const textMap = new Map<number, string>();
          nonEmptyIdx.forEach((origIdx, i) => textMap.set(origIdx, translated[i]));

          const newBlocks = sourceBlocks.map((b, i) => ({
            ...b,
            id: `${b.id}-${targetLang}`,
            texto: textMap.get(i) || b.texto,
          }));
          setBlocksByLang(prev => ({ ...prev, [targetLang]: newBlocks }));

          await supabase.from('video_blocks').insert(
            newBlocks.map(b => ({
              video_id: video.id,
              language_code: targetLang,
              bloco_id: b.bloco_id,
              tempo_inicio: b.tempo_inicio,
              tempo_fim: b.tempo_fim,
              texto: b.texto || null,
              tipo_bloco: b.tipo_bloco,
              funcao_narrativa: b.funcao_narrativa,
              emocao: b.emocao,
              elemento_visual: b.elemento_visual || null,
              descricao_visual: b.descricao_visual || null,
              frame_url: b.frame_url || null,
            }))
          );
        }
      }

      await supabase.from('video_languages').insert({
        video_id: video.id,
        language_code: targetLang,
        is_original: false,
      });

      setAvailableLangs(prev => new Set([...prev, targetLang]));
      setSelectedLang(targetLang);
      toast.success(`Tradução para ${langName} concluída!`);
    } catch (err: any) {
      console.error('Translation error:', err);
      toast.error(err.message || 'Erro na tradução');
    } finally {
      setTranslating(false);
    }
  }, [video, blocksByLang, transcriptsByLang, availableLangs, canManageVideo]);

  const handleLangSelect = (code: string) => {
    if (availableLangs.has(code) && (blocksByLang[code] || transcriptsByLang[code])) {
      setSelectedLang(code);
    } else {
      handleTranslate(code);
    }
  };

  /** Save engagement field, update status, recalculate totals */
  const saveEngagement = async (key: 'views' | 'likes' | 'comments', rawValue: string) => {
    if (!video || !canManageVideo) return;
    const parsed = parseInt(rawValue);
    if (isNaN(parsed) || parsed < 0) {
      toast.error('Valor inválido. Use apenas números inteiros positivos.');
      return;
    }
    const val = Math.floor(parsed);
    const currentVal = video[key] ?? null;
    if (val === currentVal) return;

    // Determine new engagement status
    const updatedVideo = { ...video, [key]: val };
    const hasAnyData = (updatedVideo.views ?? 0) > 0 || (updatedVideo.likes ?? 0) > 0 || (updatedVideo.comments ?? 0) > 0;
    const newStatus: EngagementStatus = hasAnyData ? 'informado' : 'ausente';

    const { error } = await supabase.from('videos').update({
      [key]: val,
      // engagement_status not in DB yet, we derive it client-side
    } as any).eq('id', video.id);

    if (error) {
      toast.error('Erro ao salvar. Tente novamente.');
      return;
    }

    setVideo(prev => prev ? { ...prev, [key]: val, engagement_status: newStatus } : prev);

    // Recalculate library totals from eligible videos only
    const { data: allVids } = await supabase.from('videos').select('views,likes,comments').eq('status', 'completed');
    if (allVids) {
      // Override the current video's data in the list since the DB might not have propagated yet
      const adjusted = allVids.map((r: any) => r.id === video.id ? { ...r, [key]: val } : r);
      setLibraryTotals(calculateEligibleTotals(adjusted.length > 0 ? adjusted : allVids));
    }

    toast.success(`${key === 'views' ? 'Views' : key === 'likes' ? 'Likes' : 'Comentários'} atualizado: ${val.toLocaleString('pt-BR')}`);
  };

  if (loading) {
    return <AppLayout><div className="max-w-4xl mx-auto px-4 py-20 text-center"><p className="text-muted-foreground">Carregando...</p></div></AppLayout>;
  }

  if (!video) {
    return (
      <AppLayout>
        <div className="max-w-4xl mx-auto px-4 py-20 text-center">
          <p className="text-muted-foreground">Vídeo não encontrado.</p>
          <Link to="/library"><button className="mt-4 px-4 py-2 bg-card border border-border rounded-lg text-sm text-foreground hover:bg-secondary">Voltar à Biblioteca</button></Link>
        </div>
      </AppLayout>
    );
  }

  const handleBlockClick = (block: VideoBlock) => {
    setActiveBlockId(block.id);
    const el = document.getElementById(`block-${block.id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const hasData = currentBlocks.length > 0 || currentTranscripts.length > 0;
  const engStatusInfo = ENGAGEMENT_STATUS_LABELS[video.engagement_status];
  const eligible = isEligibleForDNA(video);

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Link to="/library" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
          <ArrowLeft className="w-4 h-4" /> Biblioteca
        </Link>

        {/* Top bar: language selector + actions */}
        <div className="flex items-center gap-2 mb-6 flex-wrap print:hidden">
          <Globe className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground mr-1">Idioma:</span>
          {LANGUAGES_LIST.map(lang => {
            const hasLangData = availableLangs.has(lang.code) && (blocksByLang[lang.code] || transcriptsByLang[lang.code]);
            const isActive = selectedLang === lang.code;
            return (
              <button
                key={lang.code}
                onClick={() => handleLangSelect(lang.code)}
                disabled={translating || (!canManageVideo && !hasLangData)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                  isActive
                    ? 'bg-primary/10 text-primary border border-primary/30'
                    : hasLangData
                      ? 'bg-card text-foreground border border-border hover:bg-secondary'
                      : 'bg-card text-muted-foreground border border-border/50 hover:border-primary/30 hover:text-primary'
                }`}
              >
                {!hasLangData && <Languages className="w-3 h-3" />}
                {lang.label}
                {!hasLangData && <span className="text-[10px] opacity-60">traduzir</span>}
              </button>
            );
          })}
          {translating && <Loader2 className="w-4 h-4 text-primary animate-spin" />}

          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5"
              onClick={async () => {
                try {
                  toast.info('Gerando objeto completo...');
                  await exportCompleteVideoObject(video.id, video.titulo);
                  toast.success('Video Object exportado com sucesso!');
                } catch (err: any) {
                  console.error(err);
                  toast.error('Erro ao exportar: ' + (err.message || 'Desconhecido'));
                }
              }}
            >
              <Download className="w-3.5 h-3.5" /> Export Video Object
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5"
              onClick={() => exportPageAsPDF(`Relatório — ${video.titulo || 'Vídeo'}`)}
            >
              <FileDown className="w-3.5 h-3.5" /> Exportar PDF
            </Button>
          </div>
        </div>

        {/* Technical Status Panel */}
        <div className="bg-card border border-border rounded-lg p-4 mb-6">
          <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            🔍 Status Técnico do Processamento
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground">Transcrição:</span>
              <span className={`ml-2 font-medium ${currentTranscripts.length > 0 ? 'text-green-400' : 'text-amber-400'}`}>
                {currentTranscripts.length > 0 ? '✔ Real (IA Gemini)' : '⚠ Sem dados'}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Blocos narrativos:</span>
              <span className={`ml-2 font-medium ${currentBlocks.length > 0 ? 'text-green-400' : 'text-amber-400'}`}>
                {currentBlocks.length > 0 ? '✔ Reais (IA)' : '⚠ Sem dados'}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Timeline:</span>
              <span className={`ml-2 font-medium ${currentBlocks.length > 0 ? 'text-green-400' : 'text-amber-400'}`}>
                {currentBlocks.length > 0 ? '✔ Derivada dos blocos reais' : '⚠ Sem dados'}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Idioma detectado:</span>
              <span className="ml-2 font-medium text-foreground">{video.idioma?.toUpperCase() || '—'}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Segmentos transcrição:</span>
              <span className="ml-2 font-medium text-foreground">{currentTranscripts.length}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Origem:</span>
              <span className="ml-2 font-medium text-foreground">
                {video.status === 'completed' && currentTranscripts.length > 0
                  ? 'Speech-to-Text IA (Gemini)'
                  : video.status === 'pending' ? 'Aguardando processamento'
                  : video.status === 'processing' ? 'Em processamento'
                  : 'Falhou'}
              </span>
            </div>
            {/* Engagement status */}
            <div className="col-span-2 md:col-span-3 border-t border-border pt-2 mt-1">
              <span className="text-muted-foreground">Engajamento:</span>
              <span className={`ml-2 font-medium ${engStatusInfo.color}`}>
                {engStatusInfo.icon} {engStatusInfo.label}
              </span>
              <span className="ml-3">
                {eligible 
                  ? <span className="text-green-400 text-[10px]">✔ Elegível para DNA viral</span>
                  : <span className="text-amber-400 text-[10px]">✗ Fora do DNA viral</span>
                }
              </span>
            </div>
          </div>
        </div>

        <Tabs defaultValue="ficha" className="space-y-6">
          <TabsList className="bg-secondary border border-border w-full justify-start overflow-x-auto">
            <TabsTrigger value="ficha">Ficha</TabsTrigger>
            <TabsTrigger value="relatorio">Relatório</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="blocos">Blocos{currentBlocks.length > 0 && ` (${currentBlocks.length})`}</TabsTrigger>
            <TabsTrigger value="transcricao">Transcrição{currentTranscripts.length > 0 && ` (${currentTranscripts.length})`}</TabsTrigger>
            <TabsTrigger value="logs">Logs{logs.length > 0 && ` (${logs.length})`}</TabsTrigger>
          </TabsList>

          <TabsContent value="ficha">
            <FichaTecnica video={video} />
            {/* Engagement metrics editor */}
            <div className="bg-card border border-border rounded-lg p-4 mt-6">
              <h3 className="text-xs uppercase tracking-wider mb-2 font-semibold text-primary flex items-center gap-2">
                📊 Dados Reais de Performance
              </h3>
              <p className="text-xs text-muted-foreground mb-1">
                Insira os dados <strong className="text-foreground">reais</strong> de performance da plataforma onde o vídeo foi publicado (YouTube, TikTok, Instagram, etc.).
              </p>
              <p className="text-[10px] text-muted-foreground mb-3">
                Esses dados são obrigatórios para que o vídeo participe do cálculo do DNA viral base. Não preencha com estimativas ou valores fictícios.
              </p>

              {/* Current status */}
              <div className={`flex items-center gap-2 mb-3 text-xs font-medium ${engStatusInfo.color}`}>
                {eligible ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                <span>{engStatusInfo.icon} {engStatusInfo.label}</span>
                {eligible && <span className="text-green-400 text-[10px] ml-2">→ Participa do DNA viral</span>}
              </div>

              <div className="grid grid-cols-3 gap-3">
                {([
                  { key: 'views' as const, label: 'Views', icon: <Eye className="w-3.5 h-3.5" /> },
                  { key: 'likes' as const, label: 'Likes', icon: <Heart className="w-3.5 h-3.5" /> },
                  { key: 'comments' as const, label: 'Comentários', icon: <MessageCircle className="w-3.5 h-3.5" /> },
                ]).map(({ key, label, icon }) => (
                  <div key={key}>
                    <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">{icon} {label}</label>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      disabled={!canManageVideo}
                      defaultValue={video[key] ?? ''}
                      placeholder="—"
                      className="bg-secondary border-border h-8 text-sm"
                      onBlur={(e) => saveEngagement(key, e.target.value)}
                      onKeyDown={(e) => {
                        // Block decimal points, minus, 'e'
                        if (['.', ',', '-', 'e', 'E'].includes(e.key)) e.preventDefault();
                      }}
                    />
                  </div>
                ))}
              </div>

              {!eligible && (
                <p className="text-[10px] text-amber-400 mt-2">
                  ⚠ Preencha views, likes e comentários com dados reais para incluir este vídeo na base do DNA viral.
                </p>
              )}
              {!canManageVideo && (
                <p className="text-[10px] text-muted-foreground mt-2">
                  Este vídeo pertence à Base Global. Somente o administrador pode alterar suas métricas.
                </p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="relatorio">
            <div className="space-y-6">
              {videoRaw && <AIClassification video={videoRaw} />}
              <DataIntegrityValidation video={video} transcripts={currentTranscripts} blocks={currentBlocks} logs={logs} />
              <NarrativeRhythm video={video} blocks={currentBlocks} transcripts={currentTranscripts} />
              <BlockAnalysis video={video} blocks={currentBlocks} />
              <StimulusIntervals blocks={currentBlocks} />
              <NarrativeCharts video={video} blocks={currentBlocks} transcripts={currentTranscripts} />
              <NarrativeDNA video={video} blocks={currentBlocks} />
              <VisualBlockAnalysis videoId={video.id} blocks={currentBlocks} duracao={video.duracao} />
              <TextVisualAlignment videoId={video.id} avgScore={(video as any).avg_alignment_score} />
              <VerbalDNAReport videoId={video.id} />
              <CTADeepReport videoId={video.id} />
              <TextImageCompatibility videoId={video.id} />
              <PerformanceWeight video={video} libraryTotals={libraryTotals} />
              <TechLog video={video} logs={logs} />
              <ExtractionAuditLog videoId={video.id} />
              <ConsistencyValidator videoId={video.id} />
              <AuditTimeline videoId={video.id} />
            </div>
          </TabsContent>

          <TabsContent value="timeline">
            {currentBlocks.length > 0 ? (
              <NarrativeTimeline video={video} blocks={currentBlocks} onBlockClick={handleBlockClick} />
            ) : (
              <div className="text-center py-10 text-muted-foreground">
                <p>Nenhum bloco narrativo disponível.</p>
                <p className="text-xs mt-1">Blocos são gerados durante o processamento do vídeo.</p>
              </div>
            )}
          </TabsContent>
          <TabsContent value="blocos">
            {currentBlocks.length > 0 ? (
              <BlocksTable blocks={currentBlocks} activeBlockId={activeBlockId} videoId={video.id} />
            ) : (
              <div className="text-center py-10 text-muted-foreground">
                <p>Nenhum bloco narrativo disponível.</p>
              </div>
            )}
          </TabsContent>
          <TabsContent value="transcricao"><TranscriptionTab transcripts={currentTranscripts} /></TabsContent>
          <TabsContent value="logs"><ProcessingLogs logs={logs} /></TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
