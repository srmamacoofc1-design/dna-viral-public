import { supabase } from '@/integrations/supabase/client';

const processingLocks = new Set<string>();
let queueRunner: Promise<void> | null = null;
const PROCESSING_LEASE_MS = 45 * 60 * 1000;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logStep(videoId: string, etapa: string, mensagem: string, status = 'success') {
  await supabase.from('video_logs').insert({ video_id: videoId, etapa, status, mensagem });
}

async function claimPendingVideo(videoId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('processing_queue')
    .update({
      status: 'processing',
      started_at: now,
      completed_at: null,
      error_message: null,
    })
    .eq('video_id', videoId)
    .eq('status', 'pending')
    .select('video_id');
  if (error) throw new Error(`Não foi possível reservar o item da fila: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** Non-blocking pipeline step wrapper */
async function safeStep(videoId: string, stepName: string, fn: () => Promise<{ data: any; error: any }>) {
  try {
    await logStep(videoId, stepName, `Iniciando ${stepName}...`);
    const { data, error } = await fn();
    if (error || data?.error) {
      const errMsg = error?.message || data?.error || 'Erro desconhecido';
      await logStep(videoId, stepName, `⚠ ${stepName} falhou (não-bloqueante): ${errMsg}`, 'warning');
      await supabase.from('extraction_logs').insert({
        video_id: videoId,
        extraction_step: stepName.replace(/\s/g, '_').toLowerCase(),
        field_name: stepName,
        error_flag: true,
        error_message: errMsg,
        confidence_score: 0,
        source_type: 'calculated',
        origin_level: 'calculated',
      });
      return null;
    }
    await logStep(videoId, stepName, `✅ ${stepName} concluído`);
    return data;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`${stepName} failed (non-blocking):`, err);
    await logStep(videoId, stepName, `⚠ Erro não-bloqueante: ${errMsg}`, 'warning');
    return null;
  }
}

async function runPipeline(videoId: string, filePath: string, videoDuration?: number) {
  // ===== STEP 1: Multimodal source analysis (critical) =====
  await logStep(videoId, 'Análise Multimodal', 'Lendo áudio e pixels reais do vídeo...');
  const { data: transcribeResult, error: transcribeError } = await supabase.functions.invoke(
    'transcribe-video',
    { body: { video_id: videoId, file_path: filePath, video_duration: videoDuration } }
  );
  if (transcribeError) throw new Error(`Falha na transcrição: ${transcribeError.message}`);
  if (transcribeResult?.error) throw new Error(`Falha na transcrição: ${transcribeResult.error}`);
  if (!transcribeResult?.segments_count || !transcribeResult?.visual_moments) {
    throw new Error('A análise multimodal não produziu transcrição e momentos visuais suficientes.');
  }
  await logStep(
    videoId,
    'Análise Multimodal',
    `✅ ${transcribeResult.segments_count} segmentos + ${transcribeResult.visual_moments} momentos visuais reais (${transcribeResult.language ?? 'idioma detectado'})`,
  );

  // ===== STEP 2: Narrative Analysis (blocking) =====
  await logStep(videoId, 'Análise Narrativa', 'Analisando estrutura narrativa com IA...');
  const { data: analyzeResult, error: analyzeError } = await supabase.functions.invoke(
    'analyze-narrative',
    { body: { video_id: videoId, orchestrated: true } }
  );
  if (analyzeError) throw new Error(`Falha na análise narrativa: ${analyzeError.message}`);
  if (analyzeResult?.error) throw new Error(`Falha na análise narrativa: ${analyzeResult.error}`);
  await logStep(videoId, 'Análise Narrativa', `✅ Análise concluída: ${analyzeResult.blocks_count} blocos narrativos identificados`);

  // ===== STEP 3: Bind actual visual observations to narrative blocks (critical) =====
  await logStep(videoId, 'DNA Visual', 'Ligando ações realmente vistas aos blocos do roteiro...');
  const { data: visualResult, error: visualError } = await supabase.functions.invoke(
    'extract-visual-blocks',
    { body: { video_id: videoId } },
  );
  if (visualError) throw new Error(`Falha na análise visual: ${visualError.message}`);
  if (visualResult?.error) throw new Error(`Falha na análise visual: ${visualResult.error}`);
  if (!visualResult?.observed_blocks || !visualResult?.multimodal_moments) {
    throw new Error('Nenhum bloco foi ligado a observações visuais reais; o vídeo não pode entrar no DNA.');
  }
  await logStep(videoId, 'DNA Visual', `✅ ${visualResult.observed_blocks}/${visualResult.blocks_processed} blocos baseados nos pixels do vídeo`);

  // ===== STEP 4: Block semantics (non-blocking) =====
  await safeStep(videoId, 'Semântica por Bloco', () =>
    supabase.functions.invoke('extract-block-semantics', { body: { video_id: videoId } })
  );

  // ===== STEP 5: Extract Verbal DNA (non-blocking) =====
  await safeStep(videoId, 'DNA Verbal', () =>
    supabase.functions.invoke('extract-verbal-dna', { body: { video_id: videoId } })
  );

  // ===== STEP 6: Extract CTA Deep (non-blocking) =====
  await safeStep(videoId, 'CTA Profundo', () =>
    supabase.functions.invoke('extract-cta-deep', { body: { video_id: videoId } })
  );

  // ===== STEP 7: Text-Visual Alignment (non-blocking) =====
  try {
    await logStep(videoId, 'Alinhamento Texto-Visual', 'Verificando pré-requisitos...');
    const [{ count: blocksCount }, { count: visualCount }] = await Promise.all([
      supabase.from('video_blocks').select('*', { count: 'exact', head: true }).eq('video_id', videoId),
      supabase.from('visual_block_analysis').select('*', { count: 'exact', head: true }).eq('video_id', videoId),
    ]);

    if ((blocksCount ?? 0) > 0 && (visualCount ?? 0) > 0) {
      await safeStep(videoId, 'Alinhamento Texto-Visual', () =>
        supabase.functions.invoke('calculate-text-visual-alignment', { body: { video_id: videoId } })
      );
    } else {
      await logStep(videoId, 'Alinhamento Texto-Visual', `⚠ Pré-requisitos insuficientes: ${blocksCount ?? 0} blocos, ${visualCount ?? 0} visuais — pulando`, 'warning');
    }
  } catch (err) {
    console.error('Text-visual alignment failed (non-blocking):', err);
  }

  // ===== STEP 8: Visual Emotion Sequence (non-blocking, built from existing data) =====
  try {
    const { data: blockEmotions } = await supabase
      .from('video_blocks')
      .select('emocao, bloco_id')
      .eq('video_id', videoId)
      .order('bloco_id');

    if (blockEmotions?.length) {
      const emotions = blockEmotions.map(b => b.emocao).filter(Boolean);
      const transitions = emotions.slice(1).map((e, i) => `${emotions[i]}→${e}`);
      const transitionCounts: Record<string, number> = {};
      transitions.forEach(t => { transitionCounts[t] = (transitionCounts[t] || 0) + 1; });
      const dominantTransition = Object.entries(transitionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

      await supabase.from('visual_emotion_sequence' as any).upsert({
        video_id: videoId,
        emotion_sequence: emotions,
        sequence_string: emotions.join(' → '),
        dominant_transition: dominantTransition,
        transition_count: transitions.length,
        confidence_score: Math.min(100, emotions.length * 15),
      }, { onConflict: 'video_id' });
      await logStep(videoId, 'Sequência Emocional', `✅ ${emotions.length} emoções mapeadas`);
    }
  } catch (err) {
    console.error('Emotion sequence failed (non-blocking):', err);
  }

  // ===== STEP 9: Text-Image Compatibility (non-blocking) =====
  await safeStep(videoId, 'Compatibilidade Texto-Imagem', () =>
    supabase.functions.invoke('calculate-text-image-compatibility', { body: { video_id: videoId } })
  );

  // ===== STEP 10: Update Viral Lexicon (non-blocking) =====
  await safeStep(videoId, 'Léxico Viral', () =>
    supabase.functions.invoke('update-viral-lexicon', { body: { video_id: videoId } })
  );

  // ===== STEP 11: Performance Normalization (non-blocking) =====
  await safeStep(videoId, 'Normalização Performance', () =>
    supabase.functions.invoke('calculate-performance-normalization', { body: { video_id: videoId } })
  );

  await logStep(videoId, 'Finalização', '✅ Pipeline completo concluído com sucesso');
}

export async function processVideoReal(videoId: string, filePath: string, videoDuration?: number) {
  if (processingLocks.has(videoId)) return;
  processingLocks.add(videoId);

  try {
    const { data: dispatch, error: dispatchError } = await supabase.functions.invoke('process-video-pipeline', {
      body: { video_id: videoId, file_path: filePath, video_duration: videoDuration },
    });
    if (!dispatchError && !dispatch?.error) return;

    // Compatibility fallback while the new orchestrator is being deployed.
    console.warn('Server pipeline unavailable; using foreground compatibility pipeline:', dispatchError ?? dispatch?.error);
    if (!await claimPendingVideo(videoId)) return;
    await supabase.from('videos').update({ status: 'processing' }).eq('id', videoId);

    await logStep(videoId, 'Upload', 'Arquivo salvo no storage com sucesso');
    await runPipeline(videoId, filePath, videoDuration);

    await supabase.from('videos').update({ status: 'completed' }).eq('id', videoId);
    await supabase.from('processing_queue').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    }).eq('video_id', videoId);
  } catch (error) {
    console.error('processVideoReal failed:', error);
    const msg = error instanceof Error ? error.message : 'Processing failed';
    await logStep(videoId, 'Erro', `❌ ${msg}`, 'error');
    await supabase.from('videos').update({ status: 'failed' }).eq('id', videoId);
    await supabase.from('processing_queue').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: msg,
    }).eq('video_id', videoId);
  } finally {
    processingLocks.delete(videoId);
  }
}

async function processPendingQueue() {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return;

  const { data: adminRole } = await supabase.rpc('has_role', {
    _user_id: user.id,
    _role: 'admin',
  });
  let videoScopeQuery = supabase
    .from('videos')
    .select('id, origem, duracao, status, created_by')
    .in('status', ['pending', 'processing']);
  if (adminRole !== true) videoScopeQuery = videoScopeQuery.eq('created_by', user.id);

  const { data: scopedVideos, error: scopeError } = await videoScopeQuery;
  if (scopeError || !scopedVideos?.length) return;
  const videoIds = scopedVideos.map((video) => video.id);
  const videosById = new Map(scopedVideos.map((video) => [video.id, video]));

  const leaseExpiredBefore = new Date(Date.now() - PROCESSING_LEASE_MS).toISOString();
  await supabase
    .from('processing_queue')
    .update({ status: 'pending', started_at: null, error_message: null })
    .in('video_id', videoIds)
    .eq('status', 'processing')
    .lt('started_at', leaseExpiredBefore);

  const { data: stuckVideos } = await supabase
    .from('processing_queue')
    .select('video_id')
    .in('video_id', videoIds)
    .eq('status', 'pending');

  if (stuckVideos?.length) {
    for (const sv of stuckVideos) {
      if (!processingLocks.has(sv.video_id)) {
        await supabase.from('videos').update({ status: 'pending' }).eq('id', sv.video_id).eq('status', 'processing');
      }
    }
  }

  const { data, error } = await supabase
    .from('processing_queue')
    .select('video_id, priority, status')
    .in('video_id', videoIds)
    .eq('status', 'pending')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true });

  if (error || !data?.length) return;

  for (const item of data) {
    if (processingLocks.has(item.video_id)) continue;

    const video = videosById.get(item.video_id);
    if (!video) continue;

    if (video.origem === 'upload') {
      const { data: metadataRows } = await supabase
        .from('video_metadata')
        .select('valor')
        .eq('video_id', video.id)
        .eq('chave', 'file_path')
        .order('created_at', { ascending: false })
        .limit(1);

      if (metadataRows?.[0]?.valor) {
        await processVideoReal(video.id, metadataRows[0].valor, video.duracao ?? undefined);
        await wait(2500);
      } else {
        const message = 'Upload sem file_path; envie o arquivo novamente.';
        await supabase.from('videos').update({ status: 'failed' }).eq('id', video.id);
        await supabase.from('processing_queue').update({
          status: 'failed', completed_at: new Date().toISOString(), error_message: message,
        }).eq('video_id', video.id).eq('status', 'pending');
      }
    } else if (video.origem) {
      await processVideoFromLink(video.id, video.origem);
      await wait(2500);
    }
  }
}

export function schedulePendingProcessing() {
  if (queueRunner) return queueRunner;
  queueRunner = processPendingQueue().finally(() => { queueRunner = null; });
  return queueRunner;
}

export async function processVideoFromLink(videoId: string, url: string) {
  if (processingLocks.has(videoId)) return;
  processingLocks.add(videoId);

  try {
    const { data: dispatch, error: dispatchError } = await supabase.functions.invoke('process-video-pipeline', {
      body: { video_id: videoId, url },
    });
    if (!dispatchError && !dispatch?.error) return;

    // Compatibility fallback while the new orchestrator is being deployed.
    console.warn('Server pipeline unavailable; using foreground compatibility pipeline:', dispatchError ?? dispatch?.error);
    if (!await claimPendingVideo(videoId)) return;
    await supabase.from('videos').update({ status: 'processing' }).eq('id', videoId);

    const { data: downloadResult, error: downloadError } = await supabase.functions.invoke(
      'download-video',
      { body: { video_id: videoId, url } }
    );
    if (downloadError) throw new Error(`Falha ao baixar vídeo: ${downloadError.message}`);
    if (downloadResult?.error) throw new Error(`Falha no download: ${downloadResult.error}`);

    await runPipeline(videoId, downloadResult.file_path);

    await supabase.from('videos').update({ status: 'completed' }).eq('id', videoId);
    await supabase.from('processing_queue').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    }).eq('video_id', videoId);
  } catch (error) {
    console.error('processVideoFromLink failed:', error);
    const msg = error instanceof Error ? error.message : 'Processing failed';
    await logStep(videoId, 'Erro', `❌ ${msg}`, 'error');
    await supabase.from('videos').update({ status: 'failed' }).eq('id', videoId);
    await supabase.from('processing_queue').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: msg,
    }).eq('video_id', videoId);
  } finally {
    processingLocks.delete(videoId);
  }
}

export async function resumePendingProcessing() {
  schedulePendingProcessing().catch(console.error);
}
