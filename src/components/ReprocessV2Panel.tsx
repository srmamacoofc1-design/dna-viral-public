import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Play, XCircle, CheckCircle2, AlertTriangle, Loader2, Info, RotateCcw } from 'lucide-react';

type Job = {
  id: string;
  status: string;
  total_videos: number;
  completed_videos: number;
  failed_videos: number;
  skipped_videos: number;
  current_step: string | null;
  current_video_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

type JobItem = {
  id: string;
  video_id: string;
  video_title: string | null;
  status: string;
  current_step: string | null;
  progress_pct: number;
  error_message: string | null;
  attempts: number;
};

interface ReprocessV2PanelProps {
  onJobStarted?: () => void;
}

export function ReprocessV2Panel({ onJobStarted }: ReprocessV2PanelProps) {
  const [job, setJob] = useState<Job | null>(null);
  const [items, setItems] = useState<JobItem[]>([]);
  const [eligibleCount, setEligibleCount] = useState<number | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const checkEligible = async () => {
    const { data } = await supabase
      .from('videos')
      .select('id, block_segmentation_version')
      .eq('status', 'completed');
    if (data) {
      setTotalCount(data.length);
      setEligibleCount(data.filter(v => !v.block_segmentation_version || v.block_segmentation_version === 'v1_legacy').length);
    }
  };

  const loadJob = async () => {
    const { data } = await supabase
      .from('reprocess_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setJob(data as Job | null);

    if (data) {
      const { data: jobItems } = await supabase
        .from('reprocess_job_items')
        .select('*')
        .eq('job_id', data.id)
        .order('created_at');
      setItems((jobItems as JobItem[]) ?? []);
    }
  };

  useEffect(() => {
    checkEligible();
    loadJob();
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel('reprocess-job-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reprocess_jobs' }, () => {
        loadJob();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reprocess_job_items' }, () => {
        loadJob();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleCreateJob = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('reprocess-v2-create-job', {
        body: {},
      });
      if (error) {
        console.error('Failed to create job:', error);
      } else {
        console.log('Job created:', data);
        await loadJob();
        await checkEligible();
        onJobStarted?.();
      }
    } finally {
      setCreating(false);
    }
  };

  const handleCancel = async () => {
    if (!job) return;
    await supabase.functions.invoke('reprocess-v2-cancel', {
      body: { job_id: job.id },
    });
    await loadJob();
  };

  const handleResume = async () => {
    if (!job) return;
    await supabase.functions.invoke('reprocess-v2-worker', {
      body: { job_id: job.id },
    });
    await supabase.from('reprocess_jobs').update({ status: 'running' }).eq('id', job.id);
    await loadJob();
    onJobStarted?.();
  };

  const isActive = job && (job.status === 'queued' || job.status === 'running');
  const isDone = job && (job.status === 'completed' || job.status === 'canceled');
  const canResume = job && (job.status === 'running' || job.status === 'queued') === false && 
    items.some(i => i.status === 'queued');

  const processed = job ? job.completed_videos + job.failed_videos : 0;
  const pct = job && job.total_videos > 0 ? Math.round((processed / job.total_videos) * 100) : 0;

  const completedItems = items.filter(i => i.status === 'completed');
  const failedItems = items.filter(i => i.status === 'failed');
  const runningItem = items.find(i => i.status === 'running');
  const queuedItems = items.filter(i => i.status === 'queued');

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <RefreshCw className="w-5 h-5 text-primary" />
          Reprocessamento v2 — Backend Persistente
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Jobs assíncronos no servidor. Continua rodando mesmo com o app fechado.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {eligibleCount !== null && !isActive && (
          <div className="bg-muted/50 rounded-lg p-3 space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <Info className="w-4 h-4 text-primary shrink-0" />
              <span className="text-foreground">
                <strong>{eligibleCount}</strong> vídeos elegíveis (v1_legacy) de <strong>{totalCount}</strong> totais
              </span>
            </div>
            {eligibleCount === 0 && (
              <p className="text-xs text-muted-foreground ml-6">
                Todos os vídeos já estão em v2_refined.
              </p>
            )}
          </div>
        )}

        {!isActive && (eligibleCount ?? 0) > 0 && (
          <Button onClick={handleCreateJob} disabled={creating} className="gap-2">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Iniciar Reprocessamento ({eligibleCount} vídeos)
          </Button>
        )}

        {canResume && (
          <Button onClick={handleResume} variant="outline" className="gap-2">
            <RotateCcw className="w-4 h-4" /> Retomar Job Interrompido ({queuedItems.length} restantes)
          </Button>
        )}

        {isActive && (
          <Button variant="destructive" onClick={handleCancel} className="gap-2">
            <XCircle className="w-4 h-4" /> Cancelar Job
          </Button>
        )}

        {job && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {job.status === 'queued' && 'Iniciando...'}
                {job.status === 'running' && 'Processando no servidor...'}
                {job.status === 'completed' && '✅ Concluído!'}
                {job.status === 'canceled' && '⛔ Cancelado'}
              </span>
              <span className="font-mono text-foreground">{processed}/{job.total_videos}</span>
            </div>
            <Progress value={pct} className="h-2" />

            <div className="flex flex-wrap gap-2">
              {completedItems.length > 0 && (
                <Badge variant="default" className="gap-1">
                  <CheckCircle2 className="w-3 h-3" /> {completedItems.length} sucesso
                </Badge>
              )}
              {failedItems.length > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <XCircle className="w-3 h-3" /> {failedItems.length} falhas
                </Badge>
              )}
              {queuedItems.length > 0 && isActive && (
                <Badge variant="secondary" className="gap-1">
                  {queuedItems.length} na fila
                </Badge>
              )}
              {job.skipped_videos > 0 && (
                <Badge variant="secondary" className="gap-1">
                  {job.skipped_videos} já v2
                </Badge>
              )}
            </div>

            {isDone && (eligibleCount ?? 0) > 0 && (
              <Button onClick={handleCreateJob} variant="outline" className="gap-2 mt-2" disabled={creating}>
                <RefreshCw className="w-4 h-4" /> Novo Reprocessamento
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
