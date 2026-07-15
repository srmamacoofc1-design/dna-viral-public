import { supabase } from '@/integrations/supabase/client';
import { extractRealStructuralFrames } from '@/lib/frame-extractor';

// ── Types ────────────────────────────────────────────────────────────
export type ReprocessProgress = {
  videoId: string;
  videoTitle: string;
  step: string;
  current: number;
  total: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
};

export type BatchProgress = {
  videosTotal: number;
  videosEligible: number;
  videosSkipped: number;
  videosCompleted: number;
  videosFailed: number;
  currentVideo: ReprocessProgress | null;
  phase: 'idle' | 'reprocessing' | 'finalizing' | 'done';
  failedVideos: { id: string; title: string; step: string; error: string }[];
};

type ProgressCallback = (progress: BatchProgress) => void;

type EligibleVideo = {
  id: string;
  titulo: string | null;
  block_segmentation_version: string | null;
  status: string;
};

type StructuralBlockAudit = {
  blockId: string;
  blocoId: number;
  blockType: string;
  total: number;
  start: number;
  middle: number;
  end: number;
  missingFilePath: number;
  missingFrameHash: number;
};

type StructuralCoverageAudit = {
  totalBlocks: number;
  expectedFrames: number;
  validFrames: number;
  orphanFrames: number;
  invalidRoleFrames: number;
  framesWithoutPath: number;
  framesWithoutHash: number;
  invalidBlocks: StructuralBlockAudit[];
};

// ── Helpers ──────────────────────────────────────────────────────────
function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logStep(videoId: string, etapa: string, mensagem: string, status = 'success') {
  await supabase.from('video_logs').insert({ video_id: videoId, etapa, status, mensagem });
}

async function auditStructuralCoverage(videoId: string): Promise<StructuralCoverageAudit> {
  const [{ data: blocks, error: blocksError }, { data: frames, error: framesError }] = await Promise.all([
    supabase
      .from('video_blocks')
      .select('id, bloco_id, tipo_bloco')
      .eq('video_id', videoId)
      .order('bloco_id'),
    supabase
      .from('video_frames')
      .select('block_id, frame_role, file_path, frame_hash')
      .eq('video_id', videoId)
      .eq('source_method', 'block_structural_extraction'),
  ]);

  if (blocksError) {
    throw new Error(blocksError.message);
  }

  if (framesError) {
    throw new Error(framesError.message);
  }

  const validRoles = new Set(['start', 'middle', 'end']);
  const blockAudit = new Map<string, StructuralBlockAudit>();

  for (const block of blocks ?? []) {
    blockAudit.set(block.id, {
      blockId: block.id,
      blocoId: block.bloco_id,
      blockType: block.tipo_bloco,
      total: 0,
      start: 0,
      middle: 0,
      end: 0,
      missingFilePath: 0,
      missingFrameHash: 0,
    });
  }

  let orphanFrames = 0;
  let invalidRoleFrames = 0;
  let framesWithoutPath = 0;
  let framesWithoutHash = 0;

  for (const frame of frames ?? []) {
    if (!frame.block_id || !blockAudit.has(frame.block_id)) {
      orphanFrames++;
      continue;
    }

    const role = frame.frame_role ?? '';
    if (!validRoles.has(role)) {
      invalidRoleFrames++;
      continue;
    }

    const current = blockAudit.get(frame.block_id)!;
    current.total += 1;

    if (role === 'start') current.start += 1;
    if (role === 'middle') current.middle += 1;
    if (role === 'end') current.end += 1;

    if (!frame.file_path) {
      current.missingFilePath += 1;
      framesWithoutPath += 1;
    }

    if (!frame.frame_hash) {
      current.missingFrameHash += 1;
      framesWithoutHash += 1;
    }
  }

  const invalidBlocks = Array.from(blockAudit.values()).filter(
    (block) =>
      block.total !== 3 ||
      block.start !== 1 ||
      block.middle !== 1 ||
      block.end !== 1 ||
      block.missingFilePath > 0 ||
      block.missingFrameHash > 0,
  );

  return {
    totalBlocks: blocks?.length ?? 0,
    expectedFrames: (blocks?.length ?? 0) * 3,
    validFrames: Array.from(blockAudit.values()).reduce((sum, block) => sum + block.total, 0),
    orphanFrames,
    invalidRoleFrames,
    framesWithoutPath,
    framesWithoutHash,
    invalidBlocks,
  };
}

async function invokeEdge(fnName: string, body: any): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke(fnName, { body });
    if (error) return { ok: false, error: error.message };
    if (data?.error) return { ok: false, error: data.error };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// ── Step A: Safe cleanup (does NOT delete video_frames) ──────────────
async function cleanDependentDataSafe(videoId: string) {
  await Promise.all([
    supabase.from('block_word_patterns').delete().eq('video_id', videoId),
    supabase.from('block_phrase_patterns').delete().eq('video_id', videoId),
    supabase.from('block_semantic_patterns').delete().eq('video_id', videoId),
    supabase.from('block_verbal_analysis').delete().eq('video_id', videoId),
    supabase.from('visual_block_analysis').delete().eq('video_id', videoId),
    supabase.from('text_visual_alignment').delete().eq('video_id', videoId),
    supabase.from('text_image_compatibility').delete().eq('video_id', videoId),
    supabase.from('cta_deep_analysis').delete().eq('video_id', videoId),
    supabase.from('video_cta_events').delete().eq('video_id', videoId),
    supabase.from('semantic_patterns').delete().eq('video_id', videoId),
    supabase.from('visual_emotion_sequence' as any).delete().eq('video_id', videoId),
    supabase.from('cta_profiles').delete().eq('video_id', videoId),
    supabase.from('video_frames').delete().eq('video_id', videoId).eq('source_method', 'block_structural_extraction'),
  ]);
}

// ── Step C: Real structural frame extraction per block ───────────────
async function regenerateStructuralFrames(videoId: string): Promise<{ ok: boolean; count: number; error?: string }> {
  // Get new blocks
  const { data: blocks, error: blocksErr } = await supabase
    .from('video_blocks')
    .select('id, bloco_id, tempo_inicio, tempo_fim')
    .eq('video_id', videoId)
    .order('bloco_id');

  if (blocksErr || !blocks?.length) {
    return { ok: false, count: 0, error: blocksErr?.message || 'No blocks found after narrative analysis' };
  }

  // Use real frame extractor (browser Canvas + Video)
  const result = await extractRealStructuralFrames(videoId, blocks);
  return result;
}

// ── Emotion sequence builder ─────────────────────────────────────────
async function buildEmotionSequence(videoId: string) {
  const { data: blockEmotions } = await supabase
    .from('video_blocks')
    .select('emocao, bloco_id')
    .eq('video_id', videoId)
    .order('bloco_id');

  if (!blockEmotions?.length) return;

  const emotions = blockEmotions.map(b => b.emocao).filter(Boolean);
  const transitions = emotions.slice(1).map((e, i) => `${emotions[i]}→${e}`);
  const counts: Record<string, number> = {};
  transitions.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  await supabase.from('visual_emotion_sequence' as any).upsert({
    video_id: videoId,
    emotion_sequence: emotions,
    sequence_string: emotions.join(' → '),
    dominant_transition: dominant,
    transition_count: transitions.length,
    confidence_score: Math.min(100, emotions.length * 15),
  }, { onConflict: 'video_id' });
}

// ── Checkpoint validation ────────────────────────────────────────────
async function runCheckpoints(videoId: string): Promise<{ ok: boolean; details: string }> {
  const [
    { count: blocksCount },
    { data: videoData },
    { count: visualCount },
    { count: alignCount },
    { count: compatCount },
    { count: semanticCount },
    { count: verbalCount },
    structuralAudit,
  ] = await Promise.all([
    supabase.from('video_blocks').select('*', { count: 'exact', head: true }).eq('video_id', videoId),
    supabase.from('videos').select('block_segmentation_version').eq('id', videoId).single(),
    supabase.from('visual_block_analysis').select('*', { count: 'exact', head: true }).eq('video_id', videoId),
    supabase.from('text_visual_alignment').select('*', { count: 'exact', head: true }).eq('video_id', videoId),
    supabase.from('text_image_compatibility').select('*', { count: 'exact', head: true }).eq('video_id', videoId),
    supabase.from('block_semantic_patterns').select('*', { count: 'exact', head: true }).eq('video_id', videoId),
    supabase.from('block_verbal_analysis').select('*', { count: 'exact', head: true }).eq('video_id', videoId),
    auditStructuralCoverage(videoId),
  ]);

  const blocks = blocksCount ?? 0;
  const failures: string[] = [];

  if (blocks === 0) failures.push('video_blocks = 0');
  if (videoData?.block_segmentation_version !== 'v2_refined') failures.push('version != v2_refined');
  if ((visualCount ?? 0) < blocks) failures.push(`visual_block_analysis: ${visualCount}/${blocks}`);
  if ((alignCount ?? 0) < blocks) failures.push(`text_visual_alignment: ${alignCount}/${blocks}`);
  if ((compatCount ?? 0) < blocks) failures.push(`text_image_compatibility: ${compatCount}/${blocks}`);
  if ((semanticCount ?? 0) === 0) failures.push('block_semantic_patterns = 0');
  if ((verbalCount ?? 0) === 0) failures.push('block_verbal_analysis = 0');

  // Validate structural frames: must have 3 per block, each with file_path + frame_hash
  if (structuralAudit.validFrames !== structuralAudit.expectedFrames) {
    failures.push(`structural_frames_válidos: ${structuralAudit.validFrames}/${structuralAudit.expectedFrames}`);
  }
  if (structuralAudit.orphanFrames > 0) failures.push(`frames_estruturais_órfãos: ${structuralAudit.orphanFrames}`);
  if (structuralAudit.invalidRoleFrames > 0) failures.push(`frames_roles_inválidos: ${structuralAudit.invalidRoleFrames}`);
  if (structuralAudit.framesWithoutPath > 0) failures.push(`frames_sem_file_path: ${structuralAudit.framesWithoutPath}`);
  if (structuralAudit.framesWithoutHash > 0) failures.push(`frames_sem_frame_hash: ${structuralAudit.framesWithoutHash}`);
  if (structuralAudit.invalidBlocks.length > 0) {
    failures.push(
      `blocos_inválidos: ${structuralAudit.invalidBlocks
        .map(
          (block) =>
            `#${block.blocoId}[total=${block.total},start=${block.start},middle=${block.middle},end=${block.end},sem_path=${block.missingFilePath},sem_hash=${block.missingFrameHash}]`,
        )
        .join(', ')}`,
    );
  }

  if (failures.length > 0) {
    return { ok: false, details: failures.join('; ') };
  }

  return {
    ok: true,
    details: `blocks=${blocks} visual=${visualCount} align=${alignCount} compat=${compatCount} semantic=${semanticCount} verbal=${verbalCount} structural=${structuralAudit.validFrames}/${structuralAudit.expectedFrames}`,
  };
}

// ── Pipeline definition ──────────────────────────────────────────────
type StepDef = {
  name: string;
  critical: boolean;
  run: (videoId: string) => Promise<{ ok: boolean; error?: string; detail?: string }>;
};

const PIPELINE: StepDef[] = [
  // A. Safe cleanup
  {
    name: 'Limpeza Segura',
    critical: true,
    run: async (vid) => {
      await cleanDependentDataSafe(vid);
      return { ok: true };
    },
  },
  // B. Analyze narrative v2
  {
    name: 'Análise Narrativa v2',
    critical: true,
    run: async (vid) => {
      // analyze-narrative internally: creates blocks, auto-calls extract-block-semantics + extract-visual-blocks
      const r = await invokeEdge('analyze-narrative', { video_id: vid });
      if (!r.ok) return { ok: false, error: r.error };
      // Wait for auto-calls to settle
      await wait(2000);
      return { ok: true, detail: `${r.data?.blocks_count ?? '?'} blocos` };
    },
  },
  // C. Regenerate structural frames per block
  {
    name: 'Frames Estruturais por Bloco',
    critical: true,
    run: async (vid) => {
      const r = await regenerateStructuralFrames(vid);
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, detail: `${r.count} frames` };
    },
  },
  // D. Re-run extract-visual-blocks (now with correct structural frames)
  {
    name: 'Extração Visual por Bloco',
    critical: true,
    run: async (vid) => invokeEdge('extract-visual-blocks', { video_id: vid }),
  },
  // E. Extract block semantics (may have been auto-called, but re-run for safety)
  {
    name: 'Semântica por Bloco',
    critical: true,
    run: async (vid) => invokeEdge('extract-block-semantics', { video_id: vid }),
  },
  // F. Extract verbal DNA
  {
    name: 'DNA Verbal',
    critical: true,
    run: async (vid) => invokeEdge('extract-verbal-dna', { video_id: vid }),
  },
  // G. CTA Deep v2 (non-critical)
  {
    name: 'CTA Deep v2',
    critical: false,
    run: async (vid) => invokeEdge('extract-cta-deep-v2', { video_id: vid }),
  },
  // H. Text-Visual Alignment
  {
    name: 'Alinhamento Texto-Visual',
    critical: true,
    run: async (vid) => invokeEdge('calculate-text-visual-alignment', { video_id: vid }),
  },
  // I. Emotion Sequence
  {
    name: 'Sequência Emocional',
    critical: false,
    run: async (vid) => {
      await buildEmotionSequence(vid);
      return { ok: true };
    },
  },
  // J. Text-Image Compatibility
  {
    name: 'Compatibilidade Texto-Imagem',
    critical: true,
    run: async (vid) => invokeEdge('calculate-text-image-compatibility', { video_id: vid }),
  },
  // K. Viral Lexicon (non-critical)
  {
    name: 'Léxico Viral',
    critical: false,
    run: async (vid) => invokeEdge('update-viral-lexicon', { video_id: vid }),
  },
  // L. Performance Normalization (non-critical)
  {
    name: 'Normalização Performance',
    critical: false,
    run: async (vid) => invokeEdge('calculate-performance-normalization', { video_id: vid }),
  },
];

// ── Single video reprocessing ────────────────────────────────────────
async function reprocessSingleVideo(
  videoId: string,
  videoTitle: string,
  videoIndex: number,
  totalVideos: number,
  onProgress: (vp: ReprocessProgress) => void,
): Promise<{ success: boolean; failedStep?: string; error?: string }> {
  const report = (step: string, status: ReprocessProgress['status'], error?: string) => {
    onProgress({ videoId, videoTitle, step, current: videoIndex + 1, total: totalVideos, status, error });
  };

  let criticalFailed = false;
  let failedStep = '';
  let failedError = '';

  for (const step of PIPELINE) {
    report(step.name, 'processing');
    await logStep(videoId, step.name, `Iniciando ${step.name}...`);

    let result: { ok: boolean; error?: string; detail?: string };

    // Retry critical steps up to 2 times
    const maxRetries = step.critical ? 2 : 0;
    let attempt = 0;
    do {
      result = await step.run(videoId);
      if (result.ok) break;
      attempt++;
      if (attempt <= maxRetries) {
        await logStep(videoId, step.name, `⚠ Tentativa ${attempt} falhou, retentando...`, 'warning');
        await wait(3000);
      }
    } while (attempt <= maxRetries);

    if (!result.ok) {
      const errMsg = result.error || 'Unknown error';
      await logStep(videoId, step.name, `❌ ${step.name} falhou: ${errMsg}`, 'error');

      if (step.critical) {
        criticalFailed = true;
        failedStep = step.name;
        failedError = errMsg;
        report(step.name, 'failed', errMsg);
        break; // Stop pipeline for this video
      } else {
        // Non-critical: log and continue
        await logStep(videoId, step.name, `⚠ ${step.name} falhou (não-crítico): ${errMsg}`, 'warning');
        report(step.name, 'completed'); // Mark as completed with warning
      }
    } else {
      await logStep(videoId, step.name, `✅ ${step.name} concluído${result.detail ? ` — ${result.detail}` : ''}`);
      report(step.name, 'completed');
    }
  }

  // ── Checkpoint Final ──────────────────────────────────────────────
  if (!criticalFailed) {
    report('Checkpoint Final', 'processing');
    await logStep(videoId, 'Checkpoint Final do Vídeo', 'Validando integridade...');

    const checkpoint = await runCheckpoints(videoId);

    if (!checkpoint.ok) {
      criticalFailed = true;
      failedStep = 'Checkpoint Final';
      failedError = checkpoint.details;
      await logStep(videoId, 'Checkpoint Final do Vídeo', `❌ Falha no checkpoint: ${checkpoint.details}`, 'error');
      report('Checkpoint Final', 'failed', checkpoint.details);
    } else {
      // All good — mark as v2_refined + completed
      await supabase.from('videos').update({
        block_segmentation_version: 'v2_refined',
        status: 'completed',
      }).eq('id', videoId);

      // Log summary
      await logStep(videoId, 'Checkpoint Final do Vídeo', `✅ Checkpoint OK — ${checkpoint.details}`);
      report('Checkpoint Final', 'completed');
    }
  }

  if (criticalFailed) {
    // Mark video as failed, do NOT update to v2_refined
    await supabase.from('videos').update({ status: 'failed' }).eq('id', videoId);
    await logStep(videoId, 'Resultado Final', `❌ Reprocessamento falhou na etapa: ${failedStep} — ${failedError}`, 'error');
    return { success: false, failedStep, error: failedError };
  }

  // Generate final summary log
  const [
    { count: blocksC },
    { count: visualC },
    { count: semanticC },
    { count: verbalC },
    { count: alignC },
    { count: compatC },
    structuralAudit,
  ] = await Promise.all([
    supabase.from('video_blocks').select('*', { count: 'exact', head: true }).eq('video_id', videoId),
    supabase.from('visual_block_analysis').select('*', { count: 'exact', head: true }).eq('video_id', videoId),
    supabase.from('block_semantic_patterns').select('*', { count: 'exact', head: true }).eq('video_id', videoId),
    supabase.from('block_verbal_analysis').select('*', { count: 'exact', head: true }).eq('video_id', videoId),
    supabase.from('text_visual_alignment').select('*', { count: 'exact', head: true }).eq('video_id', videoId),
    supabase.from('text_image_compatibility').select('*', { count: 'exact', head: true }).eq('video_id', videoId),
    auditStructuralCoverage(videoId),
  ]);

  await logStep(videoId, 'Resumo Final',
    `✅ blocos=${blocksC} frames_estruturais_válidos=${structuralAudit.validFrames}/${structuralAudit.expectedFrames} órfãos=${structuralAudit.orphanFrames} visual=${visualC} semântica=${semanticC} verbal=${verbalC} alignment=${alignC} compatibility=${compatC}`
  );

  return { success: true };
}

async function runGlobalFinalization(progress: BatchProgress, onProgress: ProgressCallback) {
  progress.phase = 'finalizing';
  progress.currentVideo = {
    videoId: '', videoTitle: '', step: 'DNA Base v2 + Correlações + Validação',
    current: Math.max(progress.videosCompleted + progress.videosFailed, 1),
    total: Math.max(progress.videosEligible, 1), status: 'processing',
  };
  onProgress({ ...progress });

  await invokeEdge('generate-dna-base-v2', {});
  await invokeEdge('calculate-pattern-correlations', {});
  await invokeEdge('validate-mvp-layers', {});

  progress.phase = 'done';
  progress.currentVideo = null;
  onProgress({ ...progress });
}

async function fetchEligibleVideos(): Promise<EligibleVideo[]> {
  const { data, error } = await supabase
    .from('videos')
    .select('id, titulo, block_segmentation_version, status')
    .eq('status', 'completed')
    .order('created_at');

  if (error || !data?.length) return [];

  return data.filter(
    (video) => !video.block_segmentation_version || video.block_segmentation_version === 'v1_legacy'
  );
}

export async function reprocessOneV2(
  videoId: string,
  onProgress: ProgressCallback,
  signal?: AbortSignal,
): Promise<BatchProgress> {
  const { data: video, error } = await supabase
    .from('videos')
    .select('id, titulo, block_segmentation_version, status')
    .eq('id', videoId)
    .eq('status', 'completed')
    .maybeSingle();

  const progress: BatchProgress = {
    videosTotal: video ? 1 : 0,
    videosEligible: video && (!video.block_segmentation_version || video.block_segmentation_version === 'v1_legacy') ? 1 : 0,
    videosSkipped: video && video.block_segmentation_version === 'v2_refined' ? 1 : 0,
    videosCompleted: 0,
    videosFailed: 0,
    currentVideo: null,
    phase: 'idle',
    failedVideos: [],
  };

  if (error || !video || progress.videosEligible === 0) {
    progress.phase = 'done';
    onProgress({ ...progress });
    return progress;
  }

  if (signal?.aborted) {
    progress.phase = 'done';
    onProgress({ ...progress });
    return progress;
  }

  progress.phase = 'reprocessing';
  onProgress({ ...progress });

  const title = video.titulo || 'Vídeo 1';
  const result = await reprocessSingleVideo(
    video.id,
    title,
    0,
    1,
    (vp) => {
      progress.currentVideo = vp;
      onProgress({ ...progress });
    },
  );

  if (result.success) {
    progress.videosCompleted = 1;
  } else {
    progress.videosFailed = 1;
    progress.failedVideos.push({
      id: video.id,
      title,
      step: result.failedStep || 'Unknown',
      error: result.error || 'Unknown',
    });
  }

  onProgress({ ...progress });
  await runGlobalFinalization(progress, onProgress);
  return progress;
}

// ── Batch orchestrator ───────────────────────────────────────────────
export async function reprocessAllV2(
  onProgress: (progress: BatchProgress) => void,
  signal?: AbortSignal,
): Promise<BatchProgress> {
  // Fetch ALL completed videos to determine eligible vs skipped
  const { data: allVideos, error } = await supabase
    .from('videos')
    .select('id, titulo, block_segmentation_version, status')
    .eq('status', 'completed')
    .order('created_at');

  if (error || !allVideos?.length) {
    const result: BatchProgress = {
      videosTotal: 0, videosEligible: 0, videosSkipped: 0,
      videosCompleted: 0, videosFailed: 0,
      currentVideo: null, phase: 'done', failedVideos: [],
    };
    onProgress(result);
    return result;
  }

  // Filter: only v1_legacy or NULL
  const eligible = await fetchEligibleVideos();
  const skipped = allVideos.length - eligible.length;

  const progress: BatchProgress = {
    videosTotal: allVideos.length,
    videosEligible: eligible.length,
    videosSkipped: skipped,
    videosCompleted: 0,
    videosFailed: 0,
    currentVideo: null,
    phase: eligible.length > 0 ? 'reprocessing' : 'done',
    failedVideos: [],
  };
  onProgress({ ...progress });

  if (eligible.length === 0) return progress;

  // Process sequentially
  for (let i = 0; i < eligible.length; i++) {
    if (signal?.aborted) break;

    const video = eligible[i];
    const title = video.titulo || `Vídeo ${i + 1}`;

    const result = await reprocessSingleVideo(
      video.id, title, i, eligible.length,
      (vp) => {
        progress.currentVideo = vp;
        onProgress({ ...progress });
      },
    );

    if (result.success) {
      progress.videosCompleted++;
    } else {
      progress.videosFailed++;
      progress.failedVideos.push({
        id: video.id,
        title,
        step: result.failedStep || 'Unknown',
        error: result.error || 'Unknown',
      });
    }

    onProgress({ ...progress });

    // Delay between videos
    if (i < eligible.length - 1) await wait(4000);
  }

  await runGlobalFinalization(progress, onProgress);
  return progress;
}
