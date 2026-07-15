import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '@/components/StatusBadge';
import { EngagementBadge, getEngagementPercentile } from '@/components/EngagementBadge';
import { SEGMENTOS, ESTILOS_VISUAIS, EMOCOES, isEligibleForDNA } from '@/types/video';
import type { EngagementStatus } from '@/types/video';
import { Eye, Zap, ArrowRight, Globe, Search, Trash2, CheckSquare, AlertTriangle, ShieldCheck, ShieldAlert, BarChart3, RefreshCw, ChevronDown, ChevronUp, Hash, RotateCcw, Dna, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { createDnaPreset, listDnaPresets, type DnaPreset } from '@/lib/dna-presets';
import {
  ACTIVE_DNA_PRESET_STORAGE_KEY,
  DNA_PRESET_SELECTION_EVENT,
  presetGenerationUrl,
  readActiveDnaPresetId,
  setActiveDnaPresetId,
} from '@/services/dna-preset-selection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import type { Tables } from '@/integrations/supabase/types';
import { useAuth } from '@/hooks/useAuth';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

type VideoRow = Tables<'videos'>;

const LANGUAGES = [
  { code: 'all', label: 'Todos' },
  { code: 'pt', label: 'Português' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
];

function deriveEngagementStatus(row: any): EngagementStatus {
  if (row.engagement_status && ['ausente', 'informado', 'importado_pendente', 'importado_confirmado'].includes(row.engagement_status)) {
    return row.engagement_status;
  }
  const v = Number(row.views) || 0;
  const l = Number(row.likes) || 0;
  const c = Number(row.comments) || 0;
  if (v === 0 && l === 0 && c === 0) return 'ausente';
  return 'informado';
}

function mapRow(row: VideoRow) {
  return {
    ...row,
    origem: row.origem || '',
    data_envio: row.created_at,
    duracao: row.duracao ? Number(row.duracao) : undefined,
    tamanho: row.tamanho ? Number(row.tamanho) : undefined,
    tempo_gancho: row.tempo_gancho ? Number(row.tempo_gancho) : undefined,
    duracao_gancho: row.duracao_gancho ? Number(row.duracao_gancho) : undefined,
    tempo_primeiro_evento: row.tempo_primeiro_evento ? Number(row.tempo_primeiro_evento) : undefined,
    tempo_primeira_revelacao: row.tempo_primeira_revelacao ? Number(row.tempo_primeira_revelacao) : undefined,
    tempo_payoff: row.tempo_payoff ? Number(row.tempo_payoff) : undefined,
    gancho_detectado: row.gancho_detectado ?? undefined,
    loop_detectado: row.loop_detectado ?? undefined,
    intensidade_emocional: row.intensidade_emocional ?? undefined,
    tipo_gancho: row.tipo_gancho ?? undefined,
    emocao_predominante: row.emocao_predominante ?? undefined,
    engagement_status: deriveEngagementStatus(row),
  } as any;
}

export function VideoLibrary() {
  const { user, isAdmin } = useAuth();
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [langFilter, setLangFilter] = useState('all');
  const [segFilter, setSegFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [emoFilter, setEmoFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [presetName, setPresetName] = useState('');
  const [creatingPreset, setCreatingPreset] = useState(false);
  const [dnaPresets, setDnaPresets] = useState<DnaPreset[]>([]);
  const [activePresetId, setActivePresetIdState] = useState<string | null>(() => readActiveDnaPresetId());
  const [presetsLoading, setPresetsLoading] = useState(true);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [clearConfirmText, setClearConfirmText] = useState('');
  const [rescraping, setRescraping] = useState(false);
  const [showIneligible, setShowIneligible] = useState(false);
  const [codigosMap, setCodigosMap] = useState<Record<string, string>>({});
  const [failedVideos, setFailedVideos] = useState<VideoRow[]>([]);
  const [showFailed, setShowFailed] = useState(false);
  const [errorLogsMap, setErrorLogsMap] = useState<Record<string, string>>({});
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);
  const [alignFilter, setAlignFilter] = useState('all');

  const fetchVideos = async () => {
    setLoading(true);
    let query = supabase.from('videos').select('*').order('created_at', { ascending: false });

    if (langFilter !== 'all') {
      const { data: langData } = await supabase.from('video_languages').select('video_id').eq('language_code', langFilter);
      const ids = langData?.map(l => l.video_id) || [];
      if (ids.length === 0) { setVideos([]); setLoading(false); return; }
      query = query.in('id', ids);
    }
    if (segFilter !== 'all') query = query.eq('segmento', segFilter as any);
    query = query.eq('status', (statusFilter === 'all' ? 'completed' : statusFilter) as any);
    if (emoFilter !== 'all') query = query.eq('emocao_predominante', emoFilter as any);

    const { data, error: videosError } = await query;
    if (videosError) {
      toast.error(`Não foi possível carregar a biblioteca: ${videosError.message}`);
    }
    setVideos(data || []);

    // Fetch failed/pending videos (not in main list)
    let problemQuery = supabase
      .from('videos')
      .select('*')
      .in('status', ['failed', 'pending'])
      .order('created_at', { ascending: false });
    if (!isAdmin && user) problemQuery = problemQuery.eq('created_by', user.id);
    const { data: problemVideos } = await problemQuery;
    setFailedVideos(problemVideos || []);

    // Fetch error logs for failed videos
    const failedIds = (problemVideos || []).filter(v => v.status === 'failed').map(v => v.id);
    if (failedIds.length > 0) {
      const { data: errorLogs } = await supabase
        .from('video_logs')
        .select('video_id, mensagem, etapa')
        .eq('status', 'erro')
        .in('video_id', failedIds)
        .order('created_at', { ascending: false });
      if (errorLogs) {
        const map: Record<string, string> = {};
        errorLogs.forEach(l => {
          if (!map[l.video_id]) map[l.video_id] = `[${l.etapa}] ${l.mensagem || 'Erro desconhecido'}`;
        });
        setErrorLogsMap(map);
      }
    }

    // Fetch codigo_planilha from metadata for all videos
    const allIds = [...(data || []).map(v => v.id), ...(problemVideos || []).map(v => v.id)];
    if (allIds.length > 0) {
      const { data: metaRows } = await supabase
        .from('video_metadata')
        .select('video_id, valor')
        .eq('chave', 'codigo_planilha')
        .in('video_id', allIds);
      if (metaRows) {
        const map: Record<string, string> = {};
        metaRows.forEach(r => { if (r.valor) map[r.video_id] = r.valor; });
        setCodigosMap(map);
      }
    }

    setLoading(false);
  };

  useEffect(() => { fetchVideos(); }, [langFilter, segFilter, statusFilter, emoFilter, isAdmin, user?.id]);

  const canManageVideo = (video: VideoRow | undefined) => Boolean(
    video && (isAdmin || video.created_by === user?.id),
  );

  const selectedAreManageable = Array.from(selected).every((id) =>
    canManageVideo(videos.find((video) => video.id === id) || failedVideos.find((video) => video.id === id)),
  );

  const fetchDnaPresets = async () => {
    setPresetsLoading(true);
    setPresetsError(null);
    try {
      const saved = (await listDnaPresets()).filter((preset) => preset.active);
      setDnaPresets(saved);
      const selectedId = readActiveDnaPresetId();
      if (selectedId && !saved.some((preset) => preset.id === selectedId)) {
        setActiveDnaPresetId(null);
        setActivePresetIdState(null);
      } else {
        setActivePresetIdState(selectedId);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Falha ao carregar presets DNA';
      setPresetsError(message);
    } finally {
      setPresetsLoading(false);
    }
  };

  useEffect(() => {
    void fetchDnaPresets();
    const syncSelection = (event: Event) => {
      setActivePresetIdState((event as CustomEvent<{ presetId?: string | null }>).detail?.presetId ?? null);
    };
    const syncStorageSelection = (event: StorageEvent) => {
      if (event.key === ACTIVE_DNA_PRESET_STORAGE_KEY) {
        setActivePresetIdState(event.newValue?.trim() || null);
      }
    };
    window.addEventListener(DNA_PRESET_SELECTION_EVENT, syncSelection);
    window.addEventListener('storage', syncStorageSelection);
    return () => {
      window.removeEventListener(DNA_PRESET_SELECTION_EVENT, syncSelection);
      window.removeEventListener('storage', syncStorageSelection);
    };
  }, []);

  const activatePreset = (presetId: string | null) => {
    setActiveDnaPresetId(presetId);
    setActivePresetIdState(presetId);
    const preset = dnaPresets.find((item) => item.id === presetId);
    toast.success(preset ? `Preset DNA "${preset.name}" ativado.` : 'Base DNA Global ativada.');
  };

  const filtered = videos.filter(v => {
    if (search && !(v.titulo || '').toLowerCase().includes(search.toLowerCase())) return false;
    if (alignFilter !== 'all') {
      const score = v.avg_alignment_score != null ? Number(v.avg_alignment_score) : null;
      if (alignFilter === 'high' && (score === null || score < 75)) return false;
      if (alignFilter === 'medium' && (score === null || score < 40 || score >= 75)) return false;
      if (alignFilter === 'low' && (score === null || score >= 40)) return false;
      if (alignFilter === 'none' && score !== null) return false;
    }
    return true;
  });

  // DNA eligibility stats
  const eligibleVideos = filtered.filter(v => {
    const mapped = mapRow(v);
    return isEligibleForDNA(mapped);
  });
  const ineligibleCount = filtered.length - eligibleVideos.length;
  const totalViews = eligibleVideos.reduce((s, v) => s + (Number(v.views) || 0), 0);
  const totalLikes = eligibleVideos.reduce((s, v) => s + (Number(v.likes) || 0), 0);
  const totalComments = eligibleVideos.reduce((s, v) => s + (Number(v.comments) || 0), 0);

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const deleteSelected = async () => {
    const ids = Array.from(selected);
    if (!selectedAreManageable) {
      toast.error('Você só pode apagar vídeos enviados pela sua conta.');
      return;
    }
    const { error } = await supabase.from('videos').delete().in('id', ids);
    if (error) { toast.error('Erro ao apagar vídeos'); return; }
    toast.success(`${ids.length} vídeo(s) apagado(s)`);
    setSelected(new Set());
    setSelectMode(false);
    fetchVideos();
  };

  const clearLibrary = async () => {
    if (!isAdmin) return;
    if (clearConfirmText !== 'CONFIRMAR') return;
    const { error } = await supabase.from('videos').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) { toast.error('Erro ao limpar biblioteca'); return; }
    toast.success('Biblioteca limpa');
    setClearConfirmText('');
    fetchVideos();
  };

  const reprocessVideo = async (id: string, e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    const target = [...videos, ...failedVideos].find((video) => video.id === id);
    if (!canManageVideo(target)) return;
    setReprocessingId(id);
    const { error } = await supabase.from('videos').update({ status: 'pending' as any }).eq('id', id);
    if (error) { toast.error('Erro ao reprocessar'); setReprocessingId(null); return; }
    // Also reset processing queue entry if exists
    await supabase.from('processing_queue').update({ status: 'pending' as any, error_message: null, started_at: null, completed_at: null }).eq('video_id', id);
    toast.success('Vídeo enviado para reprocessamento');
    setReprocessingId(null);
    fetchVideos();
  };

  const deleteSingleVideo = async (id: string, e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    const target = [...videos, ...failedVideos].find((video) => video.id === id);
    if (!canManageVideo(target)) return;
    const { error } = await supabase.from('videos').delete().eq('id', id);
    if (error) { toast.error('Erro ao apagar vídeo'); return; }
    toast.success('Vídeo apagado');
    fetchVideos();
  };

  const deleteMultipleVideos = async (ids: string[]) => {
    if (!ids.every((id) => canManageVideo(failedVideos.find((video) => video.id === id)))) return;
    const { error } = await supabase.from('videos').delete().in('id', ids);
    if (error) { toast.error('Erro ao apagar vídeos'); return; }
    toast.success(`${ids.length} vídeo(s) apagado(s)`);
    fetchVideos();
  };

  const handleRescrape = async () => {
    setRescraping(true);
    toast.info('Iniciando re-scrape de engajamento...');
    try {
      const { data, error } = await supabase.functions.invoke('rescrape-engagement');
      if (error) {
        const msg = typeof data === 'object' && data?.error ? data.error : error.message;
        toast.error(`Erro no re-scrape: ${msg}`);
      } else if (data) {
        const { atualizados, falhas, ignorados, total } = data;
        if (atualizados > 0) {
          toast.success(`Re-scrape concluído: ${atualizados} atualizado(s), ${falhas} falha(s), ${ignorados} ignorado(s)`);
          fetchVideos();
        } else if (total === 0) {
          toast.info('Nenhum vídeo sem engajamento encontrado');
        } else {
          toast.warning(`Re-scrape: ${falhas} falha(s), ${ignorados} ignorado(s), 0 atualizados`);
        }
      }
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setRescraping(false);
    }
  };

  if (loading) {
    return <p className="text-center text-muted-foreground py-10">Carregando biblioteca...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-primary/25 rounded-lg p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Dna className="w-4 h-4 text-primary" /> Presets DNA salvos
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              A base ativa é aplicada automaticamente na geração de novos roteiros.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <select
              aria-label="Preset DNA ativo"
              value={activePresetId ?? 'global'}
              disabled={presetsLoading}
              onChange={(event) => activatePreset(event.target.value === 'global' ? null : event.target.value)}
              className="h-9 min-w-56 bg-background border border-border rounded-md px-3 text-sm text-foreground"
            >
              <option value="global">Base Global (vídeos aprovados)</option>
              {dnaPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name} ({preset.video_count} vídeos)
                </option>
              ))}
            </select>
            <Button asChild size="sm">
              <Link to={presetGenerationUrl('/app', activePresetId)}>
                Usar na Geração <ArrowRight className="w-4 h-4 ml-1" />
              </Link>
            </Button>
            {isAdmin && (
              <Button asChild size="sm" variant="outline">
                <Link to={presetGenerationUrl('/dashboard/script-engine', activePresetId)}>
                  Abrir Script Engine
                </Link>
              </Button>
            )}
          </div>
        </div>
        {presetsError && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <span>{presetsError}</span>
            <Button type="button" variant="ghost" size="sm" className="h-7" onClick={() => void fetchDnaPresets()}>
              <RefreshCw className="w-3 h-3 mr-1" /> Tentar novamente
            </Button>
          </div>
        )}
        {!presetsLoading && !presetsError && dnaPresets.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Ainda não há preset. Clique em “Selecionar”, marque os vídeos modeladores e crie a primeira base DNA.
          </p>
        )}
      </div>

      {/* DNA Viral Base Status */}
      {filtered.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-xs uppercase tracking-wider mb-3 font-semibold text-primary flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Status da Base Viral
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="text-center">
              <p className="text-lg font-bold text-foreground">{filtered.length}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Total de vídeos</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-green-400">{eligibleVideos.length}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Elegíveis DNA</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-amber-400">{ineligibleCount}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Sem engajamento</p>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground mt-1">
                {totalViews.toLocaleString('pt-BR')} <span className="text-muted-foreground">views</span>
              </p>
              <p className="text-sm font-medium text-foreground">
                {totalLikes.toLocaleString('pt-BR')} <span className="text-muted-foreground">likes</span> · {totalComments.toLocaleString('pt-BR')} <span className="text-muted-foreground">com.</span>
              </p>
            </div>
          </div>
          {eligibleVideos.length === 0 && (
            <p className="text-[10px] text-amber-400 mt-2 text-center">
              ⚠ Nenhum vídeo possui dados reais de engajamento. Preencha views, likes e comentários para formar a base viral.
            </p>
          )}
          {ineligibleCount > 0 && (
            <div className="mt-3 space-y-2">
              <div className="flex justify-center gap-2">
                {isAdmin && <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRescrape}
                  disabled={rescraping}
                  className="text-xs gap-2"
                >
                  <RefreshCw className={`w-3 h-3 ${rescraping ? 'animate-spin' : ''}`} />
                  {rescraping ? 'Re-scraping...' : `Rever ${ineligibleCount} vídeo(s) sem engajamento`}
                </Button>}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowIneligible(!showIneligible)}
                  className="text-xs gap-1"
                >
                  {showIneligible ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {showIneligible ? 'Ocultar lista' : 'Ver lista'}
                </Button>
              </div>
              {showIneligible && (() => {
                const ineligibleVideos = filtered.filter(v => {
                  const mapped = mapRow(v);
                  return !isEligibleForDNA(mapped);
                });
                return (
                  <div className="mt-2 border border-border rounded-lg overflow-hidden">
                    <div className="divide-y divide-border">
                      {ineligibleVideos.map(v => {
                        const codigo = codigosMap[v.id];
                        return (
                          <div key={v.id} className="flex items-start gap-3 p-3 hover:bg-secondary/50 transition-colors min-w-0">
                            <Link to={`/video/${v.id}`} className="min-w-0 flex-1 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                {codigo && (
                                  <span className="inline-flex items-center gap-1 bg-primary/10 text-primary text-[10px] font-bold px-2 py-0.5 rounded shrink-0">
                                    <Hash className="w-3 h-3" /> {codigo}
                                  </span>
                                )}
                                <StatusBadge status={v.status} />
                              </div>
                              <p className="text-sm font-medium text-foreground truncate">{v.titulo || 'Sem título'}</p>
                              {v.origem && (
                                <p className="text-[10px] text-muted-foreground truncate">{v.origem}</p>
                              )}
                              <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                                <span>Views: {Number(v.views) || '—'}</span>
                                <span>Likes: {Number(v.likes) || '—'}</span>
                                <span>Comments: {Number(v.comments) || '—'}</span>
                              </div>
                            </Link>
                            {canManageVideo(v) && <button
                              onClick={(e) => deleteSingleVideo(v.id, e)}
                              className="shrink-0 mt-1 p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                              title="Apagar vídeo"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground mt-2 text-center">
            O engagement rate relativo será recalculado quando novos dados forem adicionados à base.
          </p>
        </div>
      )}

      {/* Vídeos com Problema */}
      {failedVideos.length > 0 && (
        <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs uppercase tracking-wider font-semibold text-destructive flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Vídeos com Problema ({failedVideos.length})
            </h3>
            <div className="flex items-center gap-2">
              {failedVideos.length > 1 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="text-xs text-destructive border-destructive/30 hover:bg-destructive/10 gap-1">
                      <Trash2 className="w-3 h-3" /> Apagar todos
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-card border-border">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Apagar {failedVideos.length} vídeo(s) com problema?</AlertDialogTitle>
                      <AlertDialogDescription>Isso inclui vídeos com falha na transcrição ou pendentes. Esta ação não pode ser desfeita.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteMultipleVideos(failedVideos.map(v => v.id))} className="bg-destructive text-destructive-foreground">Apagar todos</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <Button variant="ghost" size="sm" onClick={() => setShowFailed(!showFailed)} className="text-xs gap-1">
                {showFailed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {showFailed ? 'Ocultar' : 'Ver lista'}
              </Button>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mb-2">
            Vídeos que falharam no processamento (transcrição, download, etc.) ou estão pendentes há muito tempo.
          </p>
          {showFailed && (
            <div className="border border-border rounded-lg overflow-hidden bg-card">
              <div className="divide-y divide-border">
                {failedVideos.map(v => {
                  const codigo = codigosMap[v.id];
                  return (
                    <div key={v.id} className="flex items-start gap-3 p-3 hover:bg-secondary/50 transition-colors min-w-0">
                      <Link to={`/video/${v.id}`} className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {codigo && (
                            <span className="inline-flex items-center gap-1 bg-primary/10 text-primary text-[10px] font-bold px-2 py-0.5 rounded shrink-0">
                              <Hash className="w-3 h-3" /> {codigo}
                            </span>
                          )}
                          <StatusBadge status={v.status} />
                        </div>
                        <p className="text-sm font-medium text-foreground truncate">{v.titulo || 'Sem título'}</p>
                        {v.origem && (
                          <p className="text-[10px] text-muted-foreground truncate">{v.origem}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground">
                          Criado em {new Date(v.created_at).toLocaleString('pt-BR')}
                        </p>
                        {v.status === 'failed' && errorLogsMap[v.id] && (
                          <p className="text-[10px] text-destructive bg-destructive/10 rounded px-2 py-1 mt-1">
                            ⚠ {errorLogsMap[v.id]}
                          </p>
                        )}
                      </Link>
                      <div className="shrink-0 flex flex-col gap-1 mt-1">
                        {v.status === 'failed' && (
                          <button
                            onClick={(e) => reprocessVideo(v.id, e)}
                            disabled={reprocessingId === v.id}
                            className="p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                            title="Reprocessar"
                          >
                            <RotateCcw className={`w-4 h-4 ${reprocessingId === v.id ? 'animate-spin' : ''}`} />
                          </button>
                        )}
                        <button
                          onClick={(e) => deleteSingleVideo(v.id, e)}
                          className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          title="Apagar vídeo"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar vídeo..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 bg-card border-border"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 text-xs">
        <Globe className="w-4 h-4 text-muted-foreground" />
        {LANGUAGES.map(l => (
          <button key={l.code} onClick={() => setLangFilter(l.code)}
            className={`px-2 py-1 rounded-lg transition-colors ${langFilter === l.code ? 'bg-primary/10 text-primary border border-primary/30' : 'bg-card text-muted-foreground border border-border hover:text-foreground'}`}>
            {l.label}
          </button>
        ))}
        <select value={segFilter} onChange={e => setSegFilter(e.target.value)}
          className="bg-card border border-border rounded-lg px-2 py-1 text-xs text-foreground">
          <option value="all">Segmento</option>
          {SEGMENTOS.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}
        </select>
        <select value={emoFilter} onChange={e => setEmoFilter(e.target.value)}
          className="bg-card border border-border rounded-lg px-2 py-1 text-xs text-foreground">
          <option value="all">Emoção</option>
          {EMOCOES.map(e => <option key={e.value} value={e.value}>{e.icon} {e.label}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="bg-card border border-border rounded-lg px-2 py-1 text-xs text-foreground">
          <option value="all">Status</option>
          <option value="pending">Pendente</option>
          <option value="processing">Processando</option>
          <option value="completed">Completo</option>
          <option value="failed">Falhou</option>
        </select>
        <select value={alignFilter} onChange={e => setAlignFilter(e.target.value)}
          className="bg-card border border-border rounded-lg px-2 py-1 text-xs text-foreground">
          <option value="all">Alinhamento</option>
          <option value="high">🟢 Alto (≥75)</option>
          <option value="medium">🟡 Médio (40-74)</option>
          <option value="low">🔴 Baixo (&lt;40)</option>
          <option value="none">— Sem score</option>
        </select>
      </div>

      {/* Actions bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => { setSelectMode(!selectMode); setSelected(new Set()); }}>
          <CheckSquare className="w-4 h-4 mr-1" /> {selectMode ? 'Cancelar Seleção' : 'Selecionar'}
        </Button>
        {selectMode && selected.size > 0 && (
          <div className="flex items-center gap-2">
            <Input
              value={presetName}
              onChange={e => setPresetName(e.target.value)}
              placeholder="Nome do preset (ex: Filmes)"
              className="h-9 w-48 bg-secondary border-border"
            />
            <Button
              size="sm"
              disabled={creatingPreset || !presetName.trim() || selected.size < 3}
              onClick={async () => {
                setCreatingPreset(true);
                try {
                  const preset = await createDnaPreset(presetName, Array.from(selected));
                  setActiveDnaPresetId(preset.id);
                  setActivePresetIdState(preset.id);
                  await fetchDnaPresets();
                  toast.success(`Preset DNA "${preset.name}" criado e ativado com ${preset.video_count} vídeos (confiança ${preset.confidence_score}%).`);
                  setPresetName('');
                  setSelected(new Set());
                  setSelectMode(false);
                } catch (err: any) {
                  toast.error(err.message);
                } finally {
                  setCreatingPreset(false);
                }
              }}
            >
              {creatingPreset ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Dna className="w-4 h-4 mr-1" />}
              Criar Preset DNA ({selected.size})
            </Button>
            {selected.size < 3 && (
              <span className="text-xs text-muted-foreground">
                Selecione pelo menos 3 vídeos concluídos com visualizações.
              </span>
            )}
          </div>
        )}
        {selectMode && selected.size > 0 && selectedAreManageable && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm"><Trash2 className="w-4 h-4 mr-1" /> Apagar {selected.size} selecionado(s)</Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-card border-border">
              <AlertDialogHeader>
                <AlertDialogTitle>Apagar {selected.size} vídeo(s)?</AlertDialogTitle>
                <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={deleteSelected} className="bg-destructive text-destructive-foreground">Apagar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {isAdmin && <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10 ml-auto">
              <AlertTriangle className="w-4 h-4 mr-1" /> Limpar Biblioteca
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="bg-card border-border">
            <AlertDialogHeader>
              <AlertDialogTitle>Limpar toda a biblioteca?</AlertDialogTitle>
              <AlertDialogDescription>
                Digite <strong>CONFIRMAR</strong> para prosseguir. Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input value={clearConfirmText} onChange={e => setClearConfirmText(e.target.value)} placeholder="CONFIRMAR" className="bg-secondary border-border" />
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setClearConfirmText('')}>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={clearLibrary} disabled={clearConfirmText !== 'CONFIRMAR'} className="bg-destructive text-destructive-foreground">Limpar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground"><p className="text-lg">Nenhum vídeo encontrado.</p></div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map((video) => {
            const seg = SEGMENTOS.find(s => s.value === video.segmento);
            const est = ESTILOS_VISUAIS.find(e => e.value === video.estilo_visual);
            const mapped = mapRow(video);
            const heroScore = getEngagementPercentile(video);
            const eligible = isEligibleForDNA(mapped);
            const isSelected = selected.has(video.id);
            return (
              <div key={video.id} className="relative">
                {selectMode && (
                  <button
                    onClick={() => toggleSelect(video.id)}
                    className={`absolute top-2 left-2 z-10 w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-primary border-primary text-primary-foreground' : 'bg-card border-border'}`}
                  >
                    {isSelected && '✓'}
                  </button>
                )}
                <Link to={`/video/${video.id}`}
                  className={`block bg-card border rounded-lg overflow-hidden hover:border-primary/50 transition-colors group ${isSelected ? 'border-primary' : 'border-border'}`}>
                  <div className="h-32 bg-secondary relative overflow-hidden">
                    <div className="absolute bottom-2 left-2 flex gap-1"><StatusBadge status={video.status} /></div>
                    <div className="absolute bottom-2 right-2 bg-background/80 backdrop-blur-sm rounded px-2 py-0.5 text-xs text-foreground">
                      {video.duracao ? `${video.duracao}s` : '—'}
                    </div>
                    <div className="absolute top-2 right-2">
                      <EngagementBadge percentile={heroScore} size="sm" />
                    </div>
                    {/* DNA eligibility indicator */}
                    <div className="absolute top-2 left-2">
                      {eligible 
                        ? <span className="bg-green-500/20 text-green-400 text-[9px] px-1.5 py-0.5 rounded flex items-center gap-0.5"><ShieldCheck className="w-3 h-3" /> DNA</span>
                        : <span className="bg-amber-500/20 text-amber-400 text-[9px] px-1.5 py-0.5 rounded flex items-center gap-0.5"><ShieldAlert className="w-3 h-3" /> Sem eng.</span>
                      }
                    </div>
                  </div>
                  <div className="p-4 space-y-3 overflow-hidden">
                    <h3 className="font-medium text-sm text-foreground line-clamp-2 group-hover:text-primary transition-colors break-words">{video.titulo || 'Sem título'}</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {seg ? <span className="text-xs bg-secondary rounded px-2 py-0.5 text-muted-foreground">{seg.icon} {seg.label}</span> : <span className="text-xs bg-secondary rounded px-2 py-0.5 text-muted-foreground italic">Aguardando classificação</span>}
                      {est && <span className="text-xs bg-secondary rounded px-2 py-0.5 text-muted-foreground">{est.icon} {est.label}</span>}
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <div className="flex items-center gap-3">
                        {video.gancho_detectado && <span className="flex items-center gap-1 text-primary"><Zap className="w-3 h-3" /> Gancho: {video.tempo_gancho}s</span>}
                        <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {video.numero_blocos || 0} blocos</span>
                        {video.avg_alignment_score != null && (() => {
                          const s = Number(video.avg_alignment_score);
                          const color = s >= 75 ? 'text-green-500' : s >= 40 ? 'text-yellow-500' : 'text-destructive';
                          const label = s >= 75 ? 'Alto' : s >= 40 ? 'Médio' : 'Baixo';
                          return <span className={`flex items-center gap-1 ${color}`}>🎯 {s}% {label}</span>;
                        })()}
                      </div>
                      <ArrowRight className="w-4 h-4 group-hover:text-primary transition-colors" />
                    </div>
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
