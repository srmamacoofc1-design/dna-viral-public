import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '@/components/StatusBadge';
import { SEGMENTOS } from '@/types/video';
import { Clock, HardDrive, Hash, Trash2, RotateCcw, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import type { Tables } from '@/integrations/supabase/types';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/hooks/useAuth';

type VideoRow = Tables<'videos'>;

type ReprocessDoneItem = {
  id: string;
  video_id: string;
  video_title: string | null;
  status: string;
  error_message: string | null;
  finished_at: string | null;
};

export function UploadHistory() {
  const { user, isAdmin } = useAuth();
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [reprocessDone, setReprocessDone] = useState<ReprocessDoneItem[]>([]);
  const [codigosMap, setCodigosMap] = useState<Record<string, string>>({});
  const [errorLogsMap, setErrorLogsMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);

  const fetchHistory = async () => {
    setLoading(true);
    let historyQuery = supabase
      .from('videos')
      .select('*')
      .in('status', ['completed', 'failed'])
      .order('updated_at', { ascending: false });
    if (!isAdmin && user) historyQuery = historyQuery.eq('created_by', user.id);
    const { data } = await historyQuery;

    const list = data || [];
    setVideos(list);

    if (list.length > 0) {
      const { data: metaRows } = await supabase
        .from('video_metadata')
        .select('video_id, valor')
        .eq('chave', 'codigo_planilha')
        .in('video_id', list.map(v => v.id));
      if (metaRows) {
        const map: Record<string, string> = {};
        metaRows.forEach(r => { if (r.valor) map[r.video_id] = r.valor; });
        setCodigosMap(map);
      }
    }

    const failedIds = list.filter(v => v.status === 'failed').map(v => v.id);
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

    // Fetch completed/failed reprocess v2 items from latest job
    const { data: latestJob } = isAdmin
      ? await supabase
          .from('reprocess_jobs')
          .select('id')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };

    if (latestJob) {
      const { data: doneItems } = await supabase
        .from('reprocess_job_items')
        .select('id, video_id, video_title, status, error_message, finished_at')
        .eq('job_id', latestJob.id)
        .in('status', ['completed', 'failed'])
        .order('finished_at', { ascending: false });
      setReprocessDone((doneItems as ReprocessDoneItem[]) ?? []);
    } else {
      setReprocessDone([]);
    }

    setLoading(false);
  };

  useEffect(() => { fetchHistory(); }, [isAdmin, user?.id]);

  // Realtime for reprocess completions
  useEffect(() => {
    const channel = supabase
      .channel('history-reprocess-updates')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'reprocess_job_items' }, (payload) => {
        const newStatus = (payload.new as any)?.status;
        if (newStatus === 'completed' || newStatus === 'failed') {
          fetchHistory();
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const deleteVideo = async (id: string) => {
    const { error } = await supabase.from('videos').delete().eq('id', id);
    if (error) { toast.error('Erro ao apagar vídeo'); return; }
    toast.success('Vídeo apagado');
    fetchHistory();
  };

  const reprocessVideo = async (id: string) => {
    setReprocessingId(id);
    const { error } = await supabase.from('videos').update({ status: 'pending' as any }).eq('id', id);
    if (error) { toast.error('Erro ao reprocessar'); setReprocessingId(null); return; }
    await supabase.from('processing_queue').update({ status: 'pending' as any, error_message: null, started_at: null, completed_at: null }).eq('video_id', id);
    toast.success('Vídeo enviado para reprocessamento');
    setReprocessingId(null);
    fetchHistory();
  };

  if (loading) return <p className="text-center text-muted-foreground py-10">Carregando histórico...</p>;
  
  const hasContent = videos.length > 0 || reprocessDone.length > 0;
  if (!hasContent) return <p className="text-center text-muted-foreground py-10">Nenhum upload processado ainda.</p>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{videos.length} vídeo(s) no histórico</p>

      {/* Reprocess v2 completed items */}
      {reprocessDone.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-primary flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Reprocessamento v2 — {reprocessDone.length} concluído(s)
          </p>
          {reprocessDone.map((item) => (
            <div key={item.id} className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  {item.status === 'completed' ? (
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-destructive" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-foreground truncate">
                    {item.video_title || item.video_id}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant={item.status === 'completed' ? 'default' : 'destructive'} className="text-[10px] px-1.5 py-0">
                      {item.status === 'completed' ? 'v2 OK' : 'v2 Falhou'}
                    </Badge>
                    {item.finished_at && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(item.finished_at).toLocaleString('pt-BR')}
                      </span>
                    )}
                  </div>
                  {item.error_message && (
                    <p className="text-xs text-destructive mt-1">{item.error_message}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Regular history */}
      {videos.map((video) => {
        const seg = SEGMENTOS.find(s => s.value === video.segmento);
        const codigo = codigosMap[video.id];
        return (
          <div key={video.id} className="bg-card border border-border rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center text-xl shrink-0">{seg?.icon || '📹'}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  {codigo && (
                    <span className="inline-flex items-center gap-1 bg-primary/10 text-primary text-[10px] font-bold px-2 py-0.5 rounded shrink-0">
                      <Hash className="w-3 h-3" /> {codigo}
                    </span>
                  )}
                  <StatusBadge status={video.status} />
                </div>
                <Link to={`/video/${video.id}`} className="block">
                  <p className="font-medium text-sm text-foreground truncate hover:text-primary transition-colors">{video.titulo || 'Sem título'}</p>
                </Link>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{video.duracao ? `${Number(video.duracao).toFixed(0)}s` : '—'}</span>
                  <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" />{video.tamanho ? `${(Number(video.tamanho) / 1e6).toFixed(1)}MB` : '—'}</span>
                  {video.views && Number(video.views) > 0 && (
                    <span>{Number(video.views).toLocaleString('pt-BR')} views</span>
                  )}
                </div>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-card border-border">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Apagar vídeo?</AlertDialogTitle>
                    <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteVideo(video.id)} className="bg-destructive text-destructive-foreground">Apagar</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            {video.status === 'completed' && (
              <div className="pl-14">
                <p className="text-xs text-green-400">✓ Processamento concluído</p>
              </div>
            )}
            {video.status === 'failed' && (
              <div className="pl-14 space-y-2">
                <p className="text-xs text-destructive">✗ Falha no processamento</p>
                {errorLogsMap[video.id] && (
                  <p className="text-[10px] text-destructive bg-destructive/10 rounded px-2 py-1">
                    ⚠ {errorLogsMap[video.id]}
                  </p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => reprocessVideo(video.id)}
                  disabled={reprocessingId === video.id}
                  className="text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
                >
                  <RotateCcw className={`w-3 h-3 ${reprocessingId === video.id ? 'animate-spin' : ''}`} />
                  Reprocessar
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
