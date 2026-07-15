import { useEffect, useState, useRef } from 'react';
import { StatusBadge } from '@/components/StatusBadge';
import { SEGMENTOS } from '@/types/video';
import { Clock, HardDrive, RefreshCw, XCircle, Hash, Loader2 } from 'lucide-react';
import { RotateCcw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { processVideoReal, processVideoFromLink } from '@/lib/video-processing';
import { Badge } from '@/components/ui/badge';
import type { Tables } from '@/integrations/supabase/types';
import { useAuth } from '@/hooks/useAuth';

type VideoRow = Tables<'videos'>;

const TOTAL_STAGES = 10;

interface VideoWithProgress extends VideoRow {
  currentStage?: string;
  stageProgress?: number;
}

type ReprocessItem = {
  id: string;
  video_id: string;
  video_title: string | null;
  status: string;
  current_step: string | null;
  progress_pct: number;
  error_message: string | null;
  attempts: number;
  job_id: string;
};

export function QueueList() {
  const { user, isAdmin } = useAuth();
  const [videos, setVideos] = useState<VideoWithProgress[]>([]);
  const [reprocessItems, setReprocessItems] = useState<ReprocessItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [codigosMap, setCodigosMap] = useState<Record<string, string>>({});
  const isInitialLoad = useRef(true);

  const fetchQueue = async () => {
    if (isInitialLoad.current) setLoading(true);

    // Fetch regular pipeline videos
    let videoQuery = supabase
      .from('videos')
      .select('*')
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false });
    if (!isAdmin && user) videoQuery = videoQuery.eq('created_by', user.id);
    const { data: videoData } = await videoQuery;

    if (!videoData) { setVideos([]); } else {
      const processingIds = videoData.filter(v => v.status === 'processing').map(v => v.id);
      let logMap: Record<string, { stage: string; count: number }> = {};

      if (processingIds.length > 0) {
        const { data: logData } = await supabase
          .from('video_logs')
          .select('video_id, etapa')
          .in('video_id', processingIds)
          .order('created_at', { ascending: false });

        if (logData) {
          const countMap: Record<string, number> = {};
          const latestMap: Record<string, string> = {};
          logData.forEach(log => {
            countMap[log.video_id] = (countMap[log.video_id] || 0) + 1;
            if (!latestMap[log.video_id]) latestMap[log.video_id] = log.etapa;
          });
          Object.keys(latestMap).forEach(vid => {
            logMap[vid] = { stage: latestMap[vid], count: countMap[vid] };
          });
        }
      }

      const enriched: VideoWithProgress[] = videoData.map(v => {
        const base: any = { ...v };
        if (v.status === 'processing' && logMap[v.id]) {
          base.currentStage = logMap[v.id].stage;
          base.stageProgress = Math.min(Math.round((logMap[v.id].count / TOTAL_STAGES) * 100), 95);
        }
        return base;
      });

      const allIds = videoData.map(v => v.id);
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

      setVideos(enriched);
    }

    // Fetch active reprocess v2 job items (queued or running)
    const { data: activeJob } = isAdmin
      ? await supabase
          .from('reprocess_jobs')
          .select('id')
          .in('status', ['queued', 'running'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };

    if (activeJob) {
      const { data: jobItems } = await supabase
        .from('reprocess_job_items')
        .select('*')
        .eq('job_id', activeJob.id)
        .in('status', ['queued', 'running'])
        .order('created_at');
      setReprocessItems((jobItems as ReprocessItem[]) ?? []);
    } else {
      setReprocessItems([]);
    }

    setLoading(false);
    isInitialLoad.current = false;
  };

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 5000);
    return () => clearInterval(interval);
  }, [isAdmin, user?.id]);

  // Realtime for reprocess items
  useEffect(() => {
    const channel = supabase
      .channel('queue-reprocess-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reprocess_job_items' }, () => {
        fetchQueue();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reprocess_jobs' }, () => {
        fetchQueue();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const cancelVideo = async (id: string) => {
    await supabase.from('videos').update({ status: 'failed' }).eq('id', id);
    toast.success('Vídeo cancelado');
    fetchQueue();
  };

  const cancelPending = async () => {
    let cancelQuery = supabase.from('videos').update({ status: 'failed' }).eq('status', 'pending');
    if (!isAdmin && user) cancelQuery = cancelQuery.eq('created_by', user.id);
    await cancelQuery;
    toast.success('Pendentes cancelados');
    fetchQueue();
  };

  const retryVideo = async (video: VideoRow) => {
    await supabase.from('videos').update({ status: 'pending' }).eq('id', video.id);
    await supabase.from('processing_queue').update({
      status: 'pending',
      started_at: null,
      completed_at: null,
      error_message: null,
    }).eq('video_id', video.id);

    toast.success('Reprocessando vídeo...');
    fetchQueue();

    const { data: meta } = await supabase
      .from('video_metadata')
      .select('valor')
      .eq('video_id', video.id)
      .eq('chave', 'file_path')
      .maybeSingle();

    if (video.origem && video.origem !== 'upload') {
      processVideoFromLink(video.id, video.origem).catch(console.error);
    } else if (meta?.valor) {
      processVideoReal(video.id, meta.valor).catch(console.error);
    } else {
      toast.error('Não foi possível encontrar o arquivo para reprocessar.');
    }
  };

  if (loading) return <p className="text-center text-muted-foreground py-10">Carregando fila...</p>;

  const hasContent = videos.length > 0 || reprocessItems.length > 0;
  if (!hasContent) return <p className="text-center text-muted-foreground py-10">Nenhum vídeo na fila. Vídeos processados aparecem no Histórico de Uploads.</p>;

  const statusOrder: Record<string, number> = { processing: 0, pending: 1 };
  const sorted = [...videos].sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9));
  const hasPending = videos.some(v => v.status === 'pending');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={fetchQueue}><RefreshCw className="w-4 h-4 mr-1" /> Atualizar</Button>
        {hasPending && (
          <Button variant="outline" size="sm" onClick={cancelPending} className="text-warning border-warning/30">
            <XCircle className="w-4 h-4 mr-1" /> Cancelar Pendentes
          </Button>
        )}
      </div>

      {/* Reprocess v2 items in queue */}
      {reprocessItems.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-primary flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Reprocessamento v2 — {reprocessItems.length} vídeo(s) na fila
          </p>
          {reprocessItems.map((item) => (
            <div key={item.id} className="bg-card border border-primary/20 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <RefreshCw className={`w-5 h-5 text-primary ${item.status === 'running' ? 'animate-spin' : ''}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-foreground truncate">
                    {item.video_title || item.video_id}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant={item.status === 'running' ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0">
                      {item.status === 'running' ? 'Processando' : 'Na fila'}
                    </Badge>
                    {item.current_step && (
                      <span className="text-xs text-muted-foreground truncate">{item.current_step}</span>
                    )}
                  </div>
                </div>
              </div>
              {item.status === 'running' && (
                <div className="pl-14 space-y-1">
                  <Progress value={item.progress_pct} className="h-2" />
                  <p className="text-xs text-muted-foreground text-right">{item.progress_pct}%</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Regular pipeline videos */}
      {sorted.map((video) => {
        const seg = SEGMENTOS.find(s => s.value === video.segmento);
        const codigo = codigosMap[video.id];
        return (
          <div key={video.id} className="bg-card border border-border rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center text-xl shrink-0">{seg?.icon || '📹'}</div>
              <div className="flex-1 min-w-0">
                {codigo && (
                  <span className="inline-flex items-center gap-1 bg-primary/10 text-primary text-[10px] font-bold px-2 py-0.5 rounded mb-1">
                    <Hash className="w-3 h-3" /> {codigo}
                  </span>
                )}
                <p className="font-medium text-sm text-foreground truncate">{video.titulo || 'Sem título'}</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{video.duracao ? `${video.duracao}s` : '—'}</span>
                  <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" />{video.tamanho ? `${(Number(video.tamanho) / 1e6).toFixed(1)}MB` : '—'}</span>
                </div>
              </div>
              <StatusBadge status={video.status} />
              {(video.status === 'pending' || video.status === 'processing') && (
                <Button variant="ghost" size="sm" onClick={() => cancelVideo(video.id)} className="text-destructive hover:bg-destructive/10 shrink-0">
                  <XCircle className="w-4 h-4" />
                </Button>
              )}
            </div>
            {video.status === 'processing' && video.currentStage && (
              <div className="space-y-1 pl-14">
                <p className="text-xs text-primary">{video.currentStage}...</p>
                <Progress value={video.stageProgress || 0} className="h-2" />
                <p className="text-xs text-muted-foreground text-right">{video.stageProgress || 0}%</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
