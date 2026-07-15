import { useState, useCallback, useMemo } from 'react';
import { Upload, Link as LinkIcon, Send, Loader2, AlertTriangle } from 'lucide-react';
import { Upload as TusUpload } from 'tus-js-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { SEGMENTOS, ESTILOS_VISUAIS, type Segmento, type EstiloVisual } from '@/types/video';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { schedulePendingProcessing } from '@/lib/video-processing';
import {
  BULK_VIDEO_LINK_CHUNK_SIZE,
  MAX_LIBRARY_VIDEO_BYTES,
  parseBulkVideoLinks,
  type BulkVideoLinkItem,
} from '../../supabase/functions/_shared/ingestion';

const LINK_BATCH_CONCURRENCY = 3;

type LinkBatchStatus = 'created' | 'reused' | 'resumed' | 'failed';

interface LinkBatchOutcome {
  item: BulkVideoLinkItem;
  status: LinkBatchStatus;
  message?: string;
}

interface LinkBatchProgress {
  total: number;
  processed: number;
  created: number;
  reused: number;
  resumed: number;
  failed: number;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

async function uploadWithProgress(
  supabaseUrl: string,
  file: File,
  objectName: string,
  token: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const upload = new TusUpload(file, {
      endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
      retryDelays: [0, 1_000, 3_000, 5_000, 10_000, 20_000],
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: { Authorization: `Bearer ${token}`, 'x-upsert': 'true' },
      metadata: {
        bucketName: 'videos',
        objectName,
        contentType: file.type || 'video/mp4',
        cacheControl: '3600',
      },
      onError: (error) => reject(new Error(`Upload resumível falhou: ${error.message}`)),
      onProgress: (uploaded, total) => onProgress(total > 0 ? Math.round((uploaded / total) * 100) : 0),
      onSuccess: () => resolve(),
    });

    upload.findPreviousUploads()
      .then((previous) => {
        if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      })
      .catch(reject);
  });
}

const MAX_UPLOAD_SIZE_BYTES = MAX_LIBRARY_VIDEO_BYTES;

function getValidUploads(files: File[], toast: ReturnType<typeof useToast>['toast']) {
  const videos = files.filter((file) =>
    file.type.startsWith('video/') || /\.(mp4|mov|webm|avi|mpeg|mpg|3gp)$/i.test(file.name)
  );

  if (videos.length === 0) {
    toast({
      title: 'Arquivo inválido',
      description: 'Selecione arquivos de vídeo válidos.',
      variant: 'destructive',
    });
    return [];
  }

  const valid: File[] = [];
  const tooLarge: string[] = [];
  for (const v of videos) {
    if (v.size > MAX_UPLOAD_SIZE_BYTES) {
      tooLarge.push(v.name);
    } else {
      valid.push(v);
    }
  }

  if (tooLarge.length > 0) {
    toast({
      title: 'Arquivos muito grandes',
      description: `${tooLarge.join(', ')} excedem 300 MB e foram ignorados.`,
      variant: 'destructive',
    });
  }

  return valid;
}

async function ensurePendingQueue(videoId: string, priority: number) {
  const { data: existing, error: selectError } = await supabase
    .from('processing_queue')
    .select('id')
    .eq('video_id', videoId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (selectError) throw selectError;
  if (existing?.[0]) {
    const { error } = await supabase.from('processing_queue').update({
      status: 'pending',
      priority,
      started_at: null,
      completed_at: null,
      error_message: null,
    }).eq('id', existing[0].id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('processing_queue').insert({ video_id: videoId, status: 'pending', priority });
    if (error) throw error;
  }
}

async function ensureOriginalLanguage(videoId: string) {
  const { error } = await supabase.from('video_languages').upsert(
    { video_id: videoId, language_code: 'pt', is_original: true },
    { onConflict: 'video_id,language_code' },
  );
  if (error) throw error;
}

export function VideoUploadForm() {
  const [mode, setMode] = useState<'upload' | 'link'>('upload');
  const [link, setLink] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [segmento, setSegmento] = useState<Segmento | null>('curiosidade');
  const [estilo, setEstilo] = useState<EstiloVisual | null>('filme');
  const [titulo, setTitulo] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showEngagement, setShowEngagement] = useState(false);
  const [engViews, setEngViews] = useState('');
  const [engLikes, setEngLikes] = useState('');
  const [engComments, setEngComments] = useState('');
  const [sending, setSending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [linkBatchProgress, setLinkBatchProgress] = useState<LinkBatchProgress | null>(null);
  const [movWarning, setMovWarning] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const linkBatchPreview = useMemo(() => parseBulkVideoLinks(link), [link]);
  const isMultipleLinkBatch = mode === 'link' && linkBatchPreview.accepted.length > 1;

  const checkMovFile = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const isMov = ext === 'mov' || file.type === 'video/quicktime';
    setMovWarning(isMov);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    const valid = getValidUploads(dropped, toast);
    if (valid.length === 0) return;
    if (valid.some(f => { const ext = f.name.split('.').pop()?.toLowerCase(); return ext === 'mov' || f.type === 'video/quicktime'; })) {
      setMovWarning(true);
    } else {
      setMovWarning(false);
    }
    setFiles(prev => [...prev, ...valid]);
  }, [toast]);

  const getEngagementInsertData = () => {
    const v = engViews ? parseInt(engViews) : null;
    const l = engLikes ? parseInt(engLikes) : null;
    const c = engComments ? parseInt(engComments) : null;
    return {
      ...(v != null && v >= 0 ? { views: v } : {}),
      ...(l != null && l >= 0 ? { likes: l } : {}),
      ...(c != null && c >= 0 ? { comments: c } : {}),
    };
  };

  const processLinkBatchItem = async (
    item: BulkVideoLinkItem,
    index: number,
    total: number,
    finalSegmento: Segmento,
    finalEstilo: EstiloVisual,
  ): Promise<LinkBatchOutcome> => {
    let createdVideoId: string | null = null;
    if (!user) return { item, status: 'failed', message: 'Faça login novamente.' };
    const scopedIdempotencyKey = isAdmin
      ? item.idempotencyKey
      : `${user.id}:${item.idempotencyKey}`;

    const reuseExistingVideo = async (duplicateVideoId: string): Promise<LinkBatchOutcome> => {
      const { data: duplicateVideo, error: duplicateVideoError } = await supabase
        .from('videos')
        .select('status')
        .eq('id', duplicateVideoId)
        .maybeSingle();
      if (duplicateVideoError) throw duplicateVideoError;
      if (!duplicateVideo) throw new Error('O registro existente do vídeo não foi encontrado.');

      if (duplicateVideo.status === 'failed') {
        const { error: resetError } = await supabase
          .from('videos')
          .update({ status: 'pending' })
          .eq('id', duplicateVideoId);
        if (resetError) throw resetError;
        await ensurePendingQueue(duplicateVideoId, index);
        return { item, status: 'resumed' };
      }

      return { item, status: 'reused' };
    };

    try {
      const { data: duplicateMetadata, error: duplicateError } = await supabase
        .from('video_metadata')
        .select('video_id')
        .eq('chave', 'source_idempotency_key')
        .eq('valor', scopedIdempotencyKey)
        .order('created_at', { ascending: false })
        .limit(1);
      if (duplicateError) throw duplicateError;

      const duplicateVideoId = duplicateMetadata?.[0]?.video_id;
      if (duplicateVideoId) {
        return reuseExistingVideo(duplicateVideoId);
      }

      const videoTitle = total === 1
        ? (titulo || item.canonicalUrl)
        : (titulo ? `${titulo} (${index + 1})` : item.canonicalUrl);
      const sourceUrl = item.source.kind === 'youtube_video'
        ? item.canonicalUrl
        : item.source.url;
      // One set of manual metrics cannot truthfully describe several videos.
      // In a batch, each video's metrics are collected by its own downloader.
      const engagementData = total === 1 ? getEngagementInsertData() : {};
      const { data: video, error: videoError } = await supabase
        .from('videos')
        .insert({
          titulo: videoTitle,
          origem: sourceUrl,
          tipo_entrada: 'link',
          segmento: finalSegmento,
          estilo_visual: finalEstilo,
          status: 'pending' as const,
          created_by: user.id,
          approved_for_global: isAdmin,
          ...engagementData,
        })
        .select()
        .single();
      if (videoError) throw videoError;
      createdVideoId = video.id;

      const { error: metadataError } = await supabase.from('video_metadata').insert({
        video_id: video.id,
        chave: 'source_idempotency_key',
        valor: scopedIdempotencyKey,
      });
      if (metadataError?.code === '23505') {
        // A second tab may have inserted the same source between our lookup
        // and insert. Keep the winner and remove this unqueued orphan.
        const orphanVideoId = createdVideoId;
        const { error: cleanupError } = await supabase.from('videos').delete().eq('id', orphanVideoId);
        if (cleanupError) throw cleanupError;
        createdVideoId = null;
        const { data: winnerMetadata, error: winnerError } = await supabase
          .from('video_metadata')
          .select('video_id')
          .eq('chave', 'source_idempotency_key')
          .eq('valor', scopedIdempotencyKey)
          .maybeSingle();
        if (winnerError) throw winnerError;
        if (!winnerMetadata?.video_id) throw metadataError;
        return reuseExistingVideo(winnerMetadata.video_id);
      }
      if (metadataError) throw metadataError;
      await ensureOriginalLanguage(video.id);
      // Queue is created last, so an incomplete database record is never claimed.
      await ensurePendingQueue(video.id, index);
      createdVideoId = null;
      return { item, status: 'created' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao adicionar o vídeo.';
      if (createdVideoId) {
        await supabase.from('videos').update({ status: 'failed' }).eq('id', createdVideoId);
        await supabase.from('processing_queue').update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: message,
        }).eq('video_id', createdVideoId);
      }
      return { item, status: 'failed', message };
    }
  };

  const handleSubmit = async () => {
    if (!user) {
      toast({ title: 'Sessão expirada', description: 'Faça login novamente.', variant: 'destructive' });
      return;
    }
    const finalSegmento = segmento || 'curiosidade';
    const finalEstilo = estilo || 'filme';
    if (mode === 'link' && linkBatchPreview.inputCount === 0) {
      toast({ title: 'Link obrigatório', description: 'Cole pelo menos um link de vídeo.', variant: 'destructive' });
      return;
    }
    if (mode === 'link' && linkBatchPreview.accepted.length === 0) {
      toast({
        title: 'Nenhum link de vídeo válido',
        description: linkBatchPreview.rejected[0]?.message ?? 'Revise os links e tente novamente.',
        variant: 'destructive',
      });
      return;
    }
    if (mode === 'upload' && files.length === 0) {
      toast({ title: 'Arquivo obrigatório', description: 'Selecione pelo menos um vídeo.', variant: 'destructive' });
      return;
    }

    setSending(true);
    let createdVideoId: string | null = null;
    let retainLinkProblems = false;

    try {
      if (mode === 'link') {
        const batch = parseBulkVideoLinks(link);
        const total = batch.accepted.length;
        setLinkBatchProgress({ total, processed: 0, created: 0, reused: 0, resumed: 0, failed: 0 });

        const outcomes: LinkBatchOutcome[] = [];
        for (let offset = 0; offset < total; offset += BULK_VIDEO_LINK_CHUNK_SIZE) {
          const chunk = batch.accepted.slice(offset, offset + BULK_VIDEO_LINK_CHUNK_SIZE);
          const chunkOutcomes = await mapWithConcurrency(
            chunk,
            LINK_BATCH_CONCURRENCY,
            async (item, chunkIndex) => {
              const index = offset + chunkIndex;
              const outcome = await processLinkBatchItem(item, index, total, finalSegmento, finalEstilo);
              setLinkBatchProgress((current) => {
                const next = current ?? { total, processed: 0, created: 0, reused: 0, resumed: 0, failed: 0 };
                return {
                  ...next,
                  processed: next.processed + 1,
                  [outcome.status]: next[outcome.status] + 1,
                };
              });
              return outcome;
            },
          );
          outcomes.push(...chunkOutcomes);
        }

        const counts = outcomes.reduce(
          (result, outcome) => ({ ...result, [outcome.status]: result[outcome.status] + 1 }),
          { created: 0, reused: 0, resumed: 0, failed: 0 } as Record<LinkBatchStatus, number>,
        );
        const problematicLinks = [
          ...batch.rejected.map((issue) => issue.rawUrl),
          ...outcomes.filter((outcome) => outcome.status === 'failed').map((outcome) => outcome.item.rawUrl),
        ];

        if (counts.created > 0 || counts.resumed > 0) {
          schedulePendingProcessing().catch(console.error);
        }

        const queued = counts.created + counts.resumed;
        const ignored = counts.reused + batch.duplicates.length;
        const problems = counts.failed + batch.rejected.length;
        retainLinkProblems = problems > 0;
        const summary = [
          `${queued} adicionado${queued === 1 ? '' : 's'} à fila`,
          ignored > 0 ? `${ignored} repetido${ignored === 1 ? '' : 's'} ignorado${ignored === 1 ? '' : 's'}` : null,
          problems > 0 ? `${problems} com erro` : null,
        ].filter(Boolean).join(' • ');

        setLink(problematicLinks.join('\n'));
        toast({
          title: problems > 0 ? 'Lote recebido parcialmente' : 'Lote adicionado à fila',
          description: problems > 0
            ? `${summary}. Corrija os links que permaneceram na caixa.`
            : summary,
          variant: counts.failed > 0 && queued === 0 ? 'destructive' : 'default',
        });

        if (problems === 0) navigate('/queue');
      } else {
        // Upload multiple files
        const totalFiles = files.length;
        for (let i = 0; i < totalFiles; i++) {
          const file = files[i];
          const videoTitle = totalFiles === 1 ? (titulo || file.name) : (titulo ? `${titulo} (${i + 1})` : file.name);

          const engData = getEngagementInsertData();
          const { data: video, error: videoError } = await supabase
            .from('videos')
            .insert({
              titulo: videoTitle,
              origem: 'upload',
              tipo_entrada: 'upload',
              segmento: finalSegmento,
              estilo_visual: finalEstilo,
              status: 'pending' as const,
              created_by: user.id,
              approved_for_global: isAdmin,
              ...engData,
            })
            .select().single();
          if (videoError) throw videoError;
          createdVideoId = video.id;

          const rawExtension = file.name.split('.').pop()?.toLowerCase() || 'mp4';
          const ext = /^(mp4|mov|webm|avi|mpeg|mpg|3gp)$/.test(rawExtension) ? rawExtension : 'mp4';
          const filePath = `library/${user.id}/${video.id}.${ext}`;

          // Extract duration
          let videoDuration: number | undefined;
          try {
            videoDuration = await new Promise<number>((resolve) => {
              const el = document.createElement('video');
              el.preload = 'metadata';
              el.onloadedmetadata = () => { resolve(el.duration); URL.revokeObjectURL(el.src); };
              el.onerror = () => { resolve(0); URL.revokeObjectURL(el.src); };
              el.src = URL.createObjectURL(file);
            });
            if (videoDuration) await supabase.from('videos').update({ duracao: videoDuration }).eq('id', video.id);
          } catch { /* ignore */ }

          setUploadProgress(0);
          const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
          const { data: sessionData } = await supabase.auth.getSession();
          const uploadToken = sessionData.session?.access_token;
          if (!uploadToken) throw new Error('Sua sessão expirou. Faça login novamente.');
          await uploadWithProgress(supabaseUrl, file, filePath, uploadToken, (pct) => setUploadProgress(pct));
          setUploadProgress(null);

          const { error: metadataError } = await supabase.from('video_metadata').insert({ video_id: video.id, chave: 'file_path', valor: filePath });
          if (metadataError) throw metadataError;
          await supabase.from('videos').update({ tamanho: file.size }).eq('id', video.id);
          await ensureOriginalLanguage(video.id);
          // Only make the item claimable after the resumable upload and metadata both exist.
          await ensurePendingQueue(video.id, i);

          toast({ title: `✅ Vídeo ${i + 1}/${totalFiles} enviado!`, description: videoTitle });
          createdVideoId = null;
        }
        schedulePendingProcessing().catch(console.error);
        navigate('/queue');
      }

      if (!retainLinkProblems) {
        setFiles([]);
        setLink('');
        setTitulo('');
        setSegmento('curiosidade');
        setEstilo('filme');
        setEngViews('');
        setEngLikes('');
        setEngComments('');
      }
    } catch (err: any) {
      console.error('Upload error:', err);
      if (createdVideoId) {
        await supabase.from('videos').update({ status: 'failed' }).eq('id', createdVideoId);
      }
      toast({ title: 'Erro ao enviar', description: err.message || 'Verifique sua conexão e tente novamente.', variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <label className="text-sm font-medium text-muted-foreground mb-2 block">
          {mode === 'link' ? 'Título base (opcional)' : 'Título do vídeo'}
        </label>
        <Input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder={mode === 'link'
            ? 'Ex: Vídeos do Benji Curioso (o sistema numera o lote)'
            : 'Ex: O mistério do avião que desapareceu...'}
          className="bg-card border-border"
        />
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2">
        <Button
          variant={mode === 'upload' ? 'default' : 'outline'}
          onClick={() => setMode('upload')}
          className="flex-1"
        >
          <Upload className="w-4 h-4 mr-2" /> Upload
        </Button>
        <Button
          variant={mode === 'link' ? 'default' : 'outline'}
          onClick={() => setMode('link')}
          className="flex-1"
        >
          <LinkIcon className="w-4 h-4 mr-2" /> Link
        </Button>
      </div>

      {/* Upload area or link input */}
      {mode === 'upload' ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={cn(
            'border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer',
            dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground'
          )}
          onClick={() => document.getElementById('file-input')?.click()}
        >
          <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-foreground font-medium">Arraste vídeos ou clique para selecionar</p>
          <p className="text-sm text-muted-foreground mt-1">MP4, MOV, WEBM • até 300 MB • upload retomável</p>
          <input
            id="file-input"
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const nextFiles = Array.from(e.target.files || []);
              const valid = getValidUploads(nextFiles, toast);
              if (valid.length === 0) return;
              if (valid.some(f => { const ext = f.name.split('.').pop()?.toLowerCase(); return ext === 'mov' || f.type === 'video/quicktime'; })) {
                setMovWarning(true);
              } else {
                setMovWarning(false);
              }
              setFiles(prev => [...prev, ...valid]);
            }}
          />
          {files.length > 0 && (
            <div className="mt-4 space-y-1">
              {files.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-sm text-primary">
                  <span className="truncate">{f.name}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setFiles(prev => prev.filter((_, idx) => idx !== i)); }}
                    className="text-muted-foreground hover:text-destructive ml-2 shrink-0 text-xs"
                  >✕</button>
                </div>
              ))}
              {movWarning && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-left">
                  <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-amber-400 font-medium">Arquivo .MOV detectado</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Arquivos .MOV podem não estar otimizados para streaming, o que pode afetar a transcrição.
                      Para melhores resultados, <strong className="text-foreground">converta para MP4</strong> antes de enviar.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <Textarea
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
              setLinkBatchProgress(null);
            }}
            placeholder={'Cole um link de vídeo por linha:\nhttps://youtube.com/shorts/...\nhttps://youtu.be/...\nhttps://tiktok.com/...'}
            className="bg-card border-border min-h-[170px] font-mono text-sm"
            aria-label="Links dos vídeos, um por linha"
            disabled={sending}
          />
          {linkBatchPreview.inputCount > 0 && (
            <div className={cn(
              'rounded-lg border p-3 text-xs space-y-1.5',
              linkBatchPreview.accepted.length > 0
                ? 'bg-primary/5 border-primary/20'
                : 'bg-destructive/5 border-destructive/20',
            )}>
              <p className="font-medium text-foreground">
                {linkBatchPreview.accepted.length} vídeo{linkBatchPreview.accepted.length === 1 ? '' : 's'} válido{linkBatchPreview.accepted.length === 1 ? '' : 's'} para adicionar
                {linkBatchPreview.duplicates.length > 0 && ` • ${linkBatchPreview.duplicates.length} repetido${linkBatchPreview.duplicates.length === 1 ? '' : 's'}`}
                {linkBatchPreview.rejected.length > 0 && ` • ${linkBatchPreview.rejected.length} com erro`}
              </p>
              {linkBatchPreview.rejected.slice(0, 3).map((issue) => (
                <p key={`${issue.line}-${issue.code}`} className="text-destructive">
                  Linha {issue.line}: {issue.message}
                </p>
              ))}
              {linkBatchPreview.rejected.length > 3 && (
                <p className="text-muted-foreground">E mais {linkBatchPreview.rejected.length - 3} linha(s) para revisar.</p>
              )}
            </div>
          )}
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
            <p className="text-xs text-amber-400 font-medium mb-1">
              Links sem limite fixo — um vídeo por linha
            </p>
            <p className="text-xs text-muted-foreground">
              Shorts e vídeos do YouTube, TikTok, Instagram e links diretos são aceitos. O sistema organiza automaticamente em lotes internos de {BULK_VIDEO_LINK_CHUNK_SIZE} para não sobrecarregar a análise.
              No YouTube, endereços de <strong className="text-foreground">canal ou playlist não representam um vídeo</strong> e serão recusados. Em outras redes, cole o endereço da publicação do vídeo.
            </p>
          </div>
        </div>
      )}

      {/* Advanced options toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
      >
        {showAdvanced ? '▼' : '▶'} Classificação manual (opcional — a IA classifica automaticamente)
      </button>

      {showAdvanced && (
        <>
          {/* Segmento */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-3 block">Segmento</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {SEGMENTOS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setSegmento(s.value)}
                  className={cn(
                    'p-3 rounded-lg border text-left transition-colors text-sm font-medium',
                    segmento === s.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card text-muted-foreground hover:border-muted-foreground hover:text-foreground'
                  )}
                >
                  <span className="mr-2">{s.icon}</span>{s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Estilo Visual */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-3 block">Estilo Visual</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ESTILOS_VISUAIS.map((e) => (
                <button
                  key={e.value}
                  onClick={() => setEstilo(e.value)}
                  className={cn(
                    'p-3 rounded-lg border text-left transition-colors text-sm font-medium',
                    estilo === e.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card text-muted-foreground hover:border-muted-foreground hover:text-foreground'
                  )}
                >
                  <span className="mr-2">{e.icon}</span>{e.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      {/* Engagement data (optional) */}
      <button
        onClick={() => setShowEngagement(!showEngagement)}
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
      >
        {showEngagement ? '▼' : '▶'} Dados reais de performance (opcional)
      </button>

      {showEngagement && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Informe dados <strong className="text-foreground">reais</strong> de engajamento da plataforma de publicação.
            Esses dados são opcionais no envio, mas obrigatórios para participar do DNA viral base.
          </p>
          {isMultipleLinkBatch && (
            <p className="text-xs text-amber-400 rounded-md border border-amber-500/20 bg-amber-500/10 p-2">
              Em um lote, cada vídeo precisa ter métricas próprias. Estes campos ficam desativados e o sistema coleta os dados individualmente quando disponíveis.
            </p>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Views</label>
              <Input disabled={isMultipleLinkBatch} type="number" min={0} step={1} value={engViews} onChange={e => setEngViews(e.target.value)} placeholder="—" className="bg-secondary border-border h-8 text-sm" onKeyDown={e => { if (['.', ',', '-', 'e', 'E'].includes(e.key)) e.preventDefault(); }} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Likes</label>
              <Input disabled={isMultipleLinkBatch} type="number" min={0} step={1} value={engLikes} onChange={e => setEngLikes(e.target.value)} placeholder="—" className="bg-secondary border-border h-8 text-sm" onKeyDown={e => { if (['.', ',', '-', 'e', 'E'].includes(e.key)) e.preventDefault(); }} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Comentários</label>
              <Input disabled={isMultipleLinkBatch} type="number" min={0} step={1} value={engComments} onChange={e => setEngComments(e.target.value)} placeholder="—" className="bg-secondary border-border h-8 text-sm" onKeyDown={e => { if (['.', ',', '-', 'e', 'E'].includes(e.key)) e.preventDefault(); }} />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            ⚠ Não preencha com estimativas. Se não souber os dados reais, deixe em branco e preencha depois na ficha do vídeo.
          </p>
        </div>
      )}


      {uploadProgress !== null && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Enviando vídeo...</span>
            <span className="text-primary font-medium">{uploadProgress}%</span>
          </div>
          <Progress value={uploadProgress} className="h-2" />
        </div>
      )}

      {mode === 'link' && linkBatchProgress && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {sending ? 'Adicionando vídeos à fila...' : 'Resultado do último lote'}
            </span>
            <span className="text-primary font-medium">
              {linkBatchProgress.processed}/{linkBatchProgress.total}
            </span>
          </div>
          <Progress
            value={linkBatchProgress.total > 0
              ? (linkBatchProgress.processed / linkBatchProgress.total) * 100
              : 0}
            className="h-2"
          />
          <p className="text-xs text-muted-foreground">
            {linkBatchProgress.created} novos • {linkBatchProgress.resumed} retomados • {linkBatchProgress.reused} já existentes • {linkBatchProgress.failed} falharam
          </p>
        </div>
      )}

      {/* Submit */}
      <Button
        onClick={handleSubmit}
        disabled={sending}
        className="w-full h-12 text-base font-semibold"
        size="lg"
      >
        {sending ? (
          <>
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            {mode === 'link' && linkBatchProgress
              ? `Adicionando ${linkBatchProgress.processed}/${linkBatchProgress.total}...`
              : 'Enviando...'}
          </>
        ) : (
          <>
            <Send className="w-5 h-5 mr-2" />
            {mode === 'link' && linkBatchPreview.accepted.length > 1
              ? `Adicionar ${linkBatchPreview.accepted.length} vídeos à fila`
              : 'Enviar para Processamento'}
          </>
        )}
      </Button>
    </div>
  );
}
