import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // Load all data needed
    const [videosRes, blocksRes, verbalRes, canonicalRes] = await Promise.all([
      sb.from("videos").select("id, titulo, duracao, status").eq("status", "completed"),
      sb.from("video_blocks").select("id, video_id, bloco_id, tipo_bloco, tempo_inicio, tempo_fim, texto, emocao, funcao_narrativa"),
      sb.from("block_verbal_analysis").select("id, block_id, video_id, word_count, linguistic_density, emotional_intensity, tone"),
      sb.from("verbal_canonical_units").select("id, video_id, block_id, narrative_function"),
    ]);

    const videos = videosRes.data || [];
    const blocks = blocksRes.data || [];
    const verbal = verbalRes.data || [];
    const canonical = canonicalRes.data || [];

    const issues: any[] = [];
    const videoMap = new Map<string, any[]>();
    blocks.forEach(b => {
      if (!videoMap.has(b.video_id)) videoMap.set(b.video_id, []);
      videoMap.get(b.video_id)!.push(b);
    });

    const verbalByBlock = new Map<string, any>();
    verbal.forEach(v => verbalByBlock.set(v.block_id, v));

    const canonicalByVideo = new Map<string, any[]>();
    canonical.forEach(c => {
      if (!canonicalByVideo.has(c.video_id)) canonicalByVideo.set(c.video_id, []);
      canonicalByVideo.get(c.video_id)!.push(c);
    });

    // Per-video validation
    const videoReports: any[] = [];
    let totalIssues = 0;

    for (const video of videos) {
      const vBlocks = videoMap.get(video.id) || [];
      const vIssues: any[] = [];

      // === 1. STRUCTURAL INTEGRITY ===
      if (vBlocks.length === 0) {
        vIssues.push({ dimension: "structural", issue: "no_blocks", detail: "Vídeo sem blocos" });
      } else {
        // Check ordering
        const sorted = [...vBlocks].sort((a, b) => a.bloco_id - b.bloco_id);
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i].bloco_id <= sorted[i - 1].bloco_id) {
            vIssues.push({ dimension: "structural", issue: "invalid_order", detail: `bloco_id ${sorted[i].bloco_id} desordenado` });
          }
        }
        // Check for missing tipo_bloco
        for (const b of vBlocks) {
          if (!b.tipo_bloco) {
            vIssues.push({ dimension: "structural", issue: "missing_block_type", detail: `Bloco ${b.bloco_id} sem tipo_bloco` });
          }
        }
      }

      // === 2. TEMPORAL INTEGRITY ===
      for (const b of vBlocks) {
        if (b.tempo_inicio >= b.tempo_fim) {
          vIssues.push({ dimension: "temporal", issue: "invalid_range", detail: `Bloco ${b.bloco_id}: inicio(${b.tempo_inicio}) >= fim(${b.tempo_fim})` });
        }
        if (video.duracao && b.tempo_fim > video.duracao * 1.05) {
          vIssues.push({ dimension: "temporal", issue: "exceeds_duration", detail: `Bloco ${b.bloco_id}: fim(${b.tempo_fim}) > duração(${video.duracao})` });
        }
      }
      // Check overlaps
      const sortedByTime = [...vBlocks].sort((a, b) => a.tempo_inicio - b.tempo_inicio);
      for (let i = 1; i < sortedByTime.length; i++) {
        const overlap = sortedByTime[i - 1].tempo_fim - sortedByTime[i].tempo_inicio;
        if (overlap > 0.5) {
          vIssues.push({ dimension: "temporal", issue: "overlap", detail: `Blocos ${sortedByTime[i - 1].bloco_id}-${sortedByTime[i].bloco_id}: sobreposição de ${overlap.toFixed(1)}s` });
        }
      }

      // === 3. VERBAL INTEGRITY ===
      let blocksWithText = 0;
      let blocksWithVerbal = 0;
      for (const b of vBlocks) {
        const hasText = b.texto && b.texto.trim().length > 0;
        if (hasText) blocksWithText++;
        
        const va = verbalByBlock.get(b.id);
        if (va) {
          blocksWithVerbal++;
          if (!va.word_count || va.word_count === 0) {
            vIssues.push({ dimension: "verbal", issue: "zero_word_count", detail: `Bloco ${b.bloco_id}: word_count = 0` });
          }
          if (va.linguistic_density === null || va.linguistic_density === undefined) {
            vIssues.push({ dimension: "verbal", issue: "null_density", detail: `Bloco ${b.bloco_id}: linguistic_density null` });
          }
        } else if (hasText) {
          vIssues.push({ dimension: "verbal", issue: "missing_verbal_analysis", detail: `Bloco ${b.bloco_id}: tem texto mas sem análise verbal` });
        }
      }

      // === 4. EMOTIONAL INTEGRITY ===
      for (const b of vBlocks) {
        if (!b.emocao) {
          vIssues.push({ dimension: "emotional", issue: "missing_emotion", detail: `Bloco ${b.bloco_id}: sem emoção atribuída` });
        }
        const va = verbalByBlock.get(b.id);
        if (va && (va.emotional_intensity === null || va.emotional_intensity === undefined)) {
          vIssues.push({ dimension: "emotional", issue: "null_intensity", detail: `Bloco ${b.bloco_id}: emotional_intensity null` });
        }
      }

      // === 5. RELATIONAL INTEGRITY ===
      // Orphan blocks (video_id not in completed videos)
      // Already filtered by video loop
      // Check canonical coverage
      const vCanonical = canonicalByVideo.get(video.id) || [];
      const functionsFound = new Set(vCanonical.map(c => c.narrative_function));
      
      // Check for canonical units referencing non-existent blocks
      const blockIds = new Set(vBlocks.map(b => b.id));
      for (const c of vCanonical) {
        if (c.block_id && !blockIds.has(c.block_id)) {
          vIssues.push({ dimension: "relational", issue: "orphan_canonical", detail: `Canonical unit ${c.id} referencia bloco inexistente` });
        }
      }

      totalIssues += vIssues.length;
      issues.push(...vIssues.map(i => ({ ...i, video_id: video.id, video_title: video.titulo })));

      videoReports.push({
        video_id: video.id,
        video_title: video.titulo,
        total_blocks: vBlocks.length,
        blocks_with_text: blocksWithText,
        blocks_with_verbal: blocksWithVerbal,
        canonical_units: vCanonical.length,
        narrative_functions: functionsFound.size,
        issues_count: vIssues.length,
        status: vIssues.length === 0 ? "READY" : vIssues.length <= 3 ? "MINOR_ISSUES" : "NEEDS_ATTENTION",
      });
    }

    // Check for orphan verbal analyses
    const allBlockIds = new Set(blocks.map(b => b.id));
    const orphanVerbal = verbal.filter(v => !allBlockIds.has(v.block_id));
    if (orphanVerbal.length > 0) {
      issues.push({ dimension: "relational", issue: "orphan_verbal_analysis", detail: `${orphanVerbal.length} análises verbais sem bloco correspondente`, video_id: null, video_title: "GLOBAL" });
      totalIssues += orphanVerbal.length;
    }

    // Dimension summary
    const dimensions = ["structural", "temporal", "verbal", "emotional", "relational"];
    const dimensionSummary: Record<string, any> = {};
    for (const dim of dimensions) {
      const dimIssues = issues.filter(i => i.dimension === dim);
      const affectedVideos = new Set(dimIssues.filter(i => i.video_id).map(i => i.video_id));
      dimensionSummary[dim] = {
        total_issues: dimIssues.length,
        affected_videos: affectedVideos.size,
        pass_rate: videos.length > 0 ? Math.round(((videos.length - affectedVideos.size) / videos.length) * 100) : 0,
        status: dimIssues.length === 0 ? "PASS" : affectedVideos.size <= Math.ceil(videos.length * 0.1) ? "ACCEPTABLE" : "FAIL",
      };
    }

    // Readiness score = average of pass_rates
    const passRates = Object.values(dimensionSummary).map((d: any) => d.pass_rate);
    const readinessScore = Math.round(passRates.reduce((a: number, b: number) => a + b, 0) / passRates.length);

    const readyVideos = videoReports.filter(v => v.status === "READY").length;
    const validationStatus = readinessScore >= 90 ? "READY_FOR_PHASE_2" : readinessScore >= 70 ? "ACCEPTABLE_WITH_CAVEATS" : "NEEDS_REMEDIATION";

    const report = {
      generated_at: new Date().toISOString(),
      total_videos: videos.length,
      total_blocks: blocks.length,
      total_verbal_analyses: verbal.length,
      total_canonical_units: canonical.length,
      readiness_score: readinessScore,
      validation_status: validationStatus,
      ready_videos: readyVideos,
      videos_with_issues: videos.length - readyVideos,
      dimension_summary: dimensionSummary,
      detected_issues: issues.length,
      issue_breakdown: issues,
      video_reports: videoReports,
    };

    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
