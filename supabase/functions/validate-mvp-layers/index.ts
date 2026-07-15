import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Get all completed videos as baseline
    const { data: completedVideos } = await supabase.from("videos").select("id, engagement_rate_relative, normalized_performance_score, avg_alignment_score, views, likes, comments").eq("status", "completed");
    const allVideoIds = new Set((completedVideos || []).map(v => v.id));
    const totalCompleted = allVideoIds.size;

    const results: Record<string, any> = {};

    // Helper: coverage check
    const coverageStatus = (covered: number, total: number) => {
      const pct = total > 0 ? covered / total : 0;
      if (pct >= 0.9) return { status: "ok", pct: +(pct * 100).toFixed(1) };
      if (pct >= 0.5) return { status: "attention", pct: +(pct * 100).toFixed(1) };
      return { status: "critical", pct: +(pct * 100).toFixed(1) };
    };

    // ===== 1. BLOCOS NARRATIVOS =====
    const { data: blocks } = await supabase.from("video_blocks").select("video_id");
    const blockVideoIds = new Set((blocks || []).map(b => b.video_id));
    const blocksCoverage = coverageStatus(blockVideoIds.size, totalCompleted);
    const blocksReport = {
      total_records: (blocks || []).length,
      videos_covered: blockVideoIds.size,
      total_videos: totalCompleted,
      coverage_pct: blocksCoverage.pct,
      status: blocksCoverage.status,
      missing_videos: [...allVideoIds].filter(id => !blockVideoIds.has(id)).length,
    };
    results.blocks = blocksReport;

    // ===== 2. TRANSCRIÇÕES =====
    const { data: transcripts } = await supabase.from("video_transcripts").select("video_id");
    const transcriptVideoIds = new Set((transcripts || []).map(t => t.video_id));
    const transcriptCoverage = coverageStatus(transcriptVideoIds.size, totalCompleted);
    const transcriptReport = {
      total_records: (transcripts || []).length,
      videos_covered: transcriptVideoIds.size,
      total_videos: totalCompleted,
      coverage_pct: transcriptCoverage.pct,
      status: transcriptCoverage.status,
    };
    results.transcripts = transcriptReport;

    // ===== 3. ANÁLISE VERBAL (block_verbal_analysis) =====
    const { data: verbal } = await supabase.from("block_verbal_analysis").select("video_id, linguistic_density, semantic_pressure_score, emotional_intensity, phrase_pattern, tone");
    const verbalVideoIds = new Set((verbal || []).map(b => b.video_id));
    const verbalCoverage = coverageStatus(verbalVideoIds.size, totalCompleted);
    
    const verbalBlocks = verbal || [];
    let totalDensity = 0, totalPressure = 0, totalIntensity = 0;
    const patternDist: Record<string, number> = {};
    let highIntensityCount = 0;
    for (const b of verbalBlocks) {
      totalDensity += Number(b.linguistic_density) || 0;
      totalPressure += Number(b.semantic_pressure_score) || 0;
      totalIntensity += Number(b.emotional_intensity) || 0;
      if (b.phrase_pattern) patternDist[b.phrase_pattern] = (patternDist[b.phrase_pattern] || 0) + 1;
      if ((Number(b.emotional_intensity) || 0) > 95) highIntensityCount++;
    }
    const n = verbalBlocks.length || 1;

    const verbalReport = {
      total_blocks: verbalBlocks.length,
      videos_covered: verbalVideoIds.size,
      total_videos: totalCompleted,
      coverage_pct: verbalCoverage.pct,
      status: verbalCoverage.status,
      linguistic_density_mean: +(totalDensity / n).toFixed(2),
      semantic_pressure_mean: +(totalPressure / n).toFixed(2),
      emotional_intensity_mean: +(totalIntensity / n).toFixed(2),
      high_intensity_count: highIntensityCount,
      pattern_distribution: patternDist,
    };
    results.verbal = verbalReport;

    // ===== 4. SEMÂNTICA DE BLOCOS =====
    const { data: semantics } = await supabase.from("block_semantic_patterns").select("video_id");
    const semanticVideoIds = new Set((semantics || []).map(s => s.video_id));
    const semanticCoverage = coverageStatus(semanticVideoIds.size, totalCompleted);
    results.semantics = {
      total_records: (semantics || []).length,
      videos_covered: semanticVideoIds.size,
      total_videos: totalCompleted,
      coverage_pct: semanticCoverage.pct,
      status: semanticCoverage.status,
      missing_videos: [...allVideoIds].filter(id => !semanticVideoIds.has(id)).length,
    };

    // ===== 5. WORD/PHRASE PATTERNS =====
    // Use count to avoid 1000-row limit
    const { count: wordCount } = await supabase.from("block_word_patterns").select("*", { count: "exact", head: true });
    // Get distinct video_ids by paginating
    const wordVideoIds = new Set<string>();
    let wordOffset = 0;
    while (true) {
      const { data: wp } = await supabase.from("block_word_patterns").select("video_id").range(wordOffset, wordOffset + 999);
      if (!wp || wp.length === 0) break;
      wp.forEach((w: any) => wordVideoIds.add(w.video_id));
      if (wp.length < 1000) break;
      wordOffset += 1000;
    }
    const wordCoverage = coverageStatus(wordVideoIds.size, totalCompleted);
    results.word_patterns = {
      total_records: wordCount || 0,
      videos_covered: wordVideoIds.size,
      total_videos: totalCompleted,
      coverage_pct: wordCoverage.pct,
      status: wordCoverage.status,
      missing_videos: [...allVideoIds].filter(id => !wordVideoIds.has(id)).length,
    };

    // ===== 6. CTA (video_cta_events) =====
    const { data: ctaEvents } = await supabase.from("video_cta_events").select("video_id, cta_type, cta_intensity, cta_text");
    const ctaVideoIds = new Set((ctaEvents || []).map(c => c.video_id));
    const ctaCoverage = coverageStatus(ctaVideoIds.size, totalCompleted);
    const ctaAll = ctaEvents || [];
    const ctaTypeDist: Record<string, number> = {};
    ctaAll.forEach(c => { if (c.cta_type) ctaTypeDist[c.cta_type] = (ctaTypeDist[c.cta_type] || 0) + 1; });
    const avgIntensity = ctaAll.length > 0 ? +(ctaAll.reduce((s, c) => s + (Number(c.cta_intensity) || 0), 0) / ctaAll.length).toFixed(2) : 0;

    results.cta = {
      total_ctas: ctaAll.length,
      videos_covered: ctaVideoIds.size,
      total_videos: totalCompleted,
      coverage_pct: ctaCoverage.pct,
      status: ctaCoverage.status,
      cta_distribution: ctaTypeDist,
      average_intensity: avgIntensity,
      missing_videos: [...allVideoIds].filter(id => !ctaVideoIds.has(id)).length,
    };

    // ===== 7. VISUAL BLOCK ANALYSIS =====
    const { data: visualBlocks } = await supabase.from("visual_block_analysis").select("video_id");
    const visualVideoIds = new Set((visualBlocks || []).map(v => v.video_id));
    const visualCoverage = coverageStatus(visualVideoIds.size, totalCompleted);
    results.visual = {
      total_records: (visualBlocks || []).length,
      videos_covered: visualVideoIds.size,
      total_videos: totalCompleted,
      coverage_pct: visualCoverage.pct,
      status: visualCoverage.status,
    };

    // ===== 8. TEXT-VISUAL ALIGNMENT =====
    const { data: alignments } = await supabase.from("text_visual_alignment").select("video_id, alignment_score");
    const alignVideoIds = new Set((alignments || []).map(a => a.video_id));
    const alignCoverage = coverageStatus(alignVideoIds.size, totalCompleted);
    const alignScores = (alignments || []).map(a => Number(a.alignment_score) || 0);
    const avgAlign = alignScores.length > 0 ? +(alignScores.reduce((a, b) => a + b, 0) / alignScores.length).toFixed(2) : 0;
    
    // Also check avg_alignment_score on videos table
    const videosWithAlignment = (completedVideos || []).filter(v => v.avg_alignment_score != null).length;

    results.alignment = {
      total_records: (alignments || []).length,
      videos_covered: alignVideoIds.size,
      videos_with_avg_score: videosWithAlignment,
      total_videos: totalCompleted,
      coverage_pct: alignCoverage.pct,
      status: alignCoverage.status,
      avg_alignment: avgAlign,
    };

    // ===== 9. EMOTION SEQUENCE =====
    const { data: emotions } = await supabase.from("visual_emotion_sequence").select("video_id");
    const emotionVideoIds = new Set((emotions || []).map(e => e.video_id));
    const emotionCoverage = coverageStatus(emotionVideoIds.size, totalCompleted);
    results.emotion = {
      total_records: (emotions || []).length,
      videos_covered: emotionVideoIds.size,
      total_videos: totalCompleted,
      coverage_pct: emotionCoverage.pct,
      status: emotionCoverage.status,
    };

    // ===== 10. PERFORMANCE NORMALIZADA =====
    const videosWithPerf = (completedVideos || []).filter(v => v.normalized_performance_score != null);
    const perfCoverage = coverageStatus(videosWithPerf.length, totalCompleted);
    const perfScores = videosWithPerf.map(v => Number(v.normalized_performance_score) || 0);
    const perfMean = perfScores.length > 0 ? +(perfScores.reduce((a, b) => a + b, 0) / perfScores.length).toFixed(4) : 0;

    results.performance = {
      videos_calculated: videosWithPerf.length,
      total_videos: totalCompleted,
      coverage_pct: perfCoverage.pct,
      status: perfCoverage.status,
      mean_score: perfMean,
    };

    // ===== 11. ENGAGEMENT RATE =====
    const videosWithEngagement = (completedVideos || []).filter(v => v.engagement_rate_relative != null);
    const engagementCoverage = coverageStatus(videosWithEngagement.length, totalCompleted);
    results.engagement_observation = {
      videos_calculated: videosWithEngagement.length,
      total_videos: totalCompleted,
      coverage_pct: engagementCoverage.pct,
      status: engagementCoverage.status,
    };

    // ===== 12. LÉXICO VIRAL =====
    const { data: lexicon } = await supabase.from("viral_lexicon_global").select("id, frequency_total, performance_weighted_score");
    const lexAll = lexicon || [];
    const lowFreq = lexAll.filter(w => (Number(w.frequency_total) || 0) < 3);
    const noiseRatio = lexAll.length > 0 ? +(lowFreq.length / lexAll.length).toFixed(4) : 0;
    results.lexicon = {
      total_words: lexAll.length,
      active_words: lexAll.length - lowFreq.length,
      noise_count: lowFreq.length,
      noise_ratio: noiseRatio,
      status: lexAll.length === 0 ? "critical" : noiseRatio > 0.7 ? "attention" : "ok",
    };

    // ===== 13. DNA BASE V2 =====
    const { data: dna } = await supabase.from("dna_base_v2").select("*").order("created_at", { ascending: false }).limit(1);
    const latestDna = dna?.[0];
    results.dna = {
      exists: !!latestDna,
      videos_used: latestDna ? Number(latestDna.total_videos_used) : 0,
      total_videos: totalCompleted,
      coverage_pct: latestDna ? +((Number(latestDna.total_videos_used) / totalCompleted) * 100).toFixed(1) : 0,
      status: !latestDna ? "critical" : (Number(latestDna.total_videos_used) / totalCompleted) >= 0.9 ? "ok" : "attention",
      dominant_structure: latestDna?.dominant_structure_sequence || null,
      dominant_verbal: latestDna?.dominant_verbal_pattern || null,
      dominant_cta: latestDna?.dominant_cta_pattern || null,
    };

    // ===== 14. CORRELAÇÕES =====
    const { data: corrs } = await supabase.from("performance_correlation").select("*");
    const corrAll = corrs || [];
    const reliableCorrs = corrAll.filter(c => (Number(c.sample_size) || 0) >= 5);
    results.correlations = {
      total: corrAll.length,
      reliable: reliableCorrs.length,
      unreliable: corrAll.length - reliableCorrs.length,
      status: corrAll.length === 0 ? "critical" : reliableCorrs.length >= corrAll.length * 0.5 ? "ok" : "attention",
      avg_confidence: corrAll.length > 0 ? +(corrAll.reduce((s, c) => s + (Number(c.confidence_score) || 0), 0) / corrAll.length).toFixed(2) : 0,
    };

    // ===== 15. OUTLIER DETECTION =====
    const { data: outliers } = await supabase.from("outlier_detection").select("video_id");
    const outlierVideoIds = new Set((outliers || []).map(o => o.video_id));
    results.outliers = {
      total_records: (outliers || []).length,
      videos_covered: outlierVideoIds.size,
      total_videos: totalCompleted,
      coverage_pct: coverageStatus(outlierVideoIds.size, totalCompleted).pct,
      status: (outliers || []).length === 0 ? "critical" : "ok",
    };

    // ===== 16. TEXT-IMAGE COMPATIBILITY =====
    const { data: compat } = await supabase.from("text_image_compatibility").select("video_id, compatibility_score, compatibility_label, confidence_score");
    const compatAll = compat || [];
    const compatVideoIds = new Set(compatAll.map(c => c.video_id));
    const compatCoverage = coverageStatus(compatVideoIds.size, totalCompleted);
    const compatLabels = compatAll.reduce((acc: Record<string, number>, c: any) => {
      acc[c.compatibility_label] = (acc[c.compatibility_label] || 0) + 1;
      return acc;
    }, {});
    results.text_image_compatibility = {
      total_records: compatAll.length,
      videos_covered: compatVideoIds.size,
      total_videos: totalCompleted,
      coverage_pct: compatCoverage.pct,
      status: compatCoverage.status,
      avg_compatibility_score: compatAll.length > 0 ? +(compatAll.reduce((s: number, c: any) => s + (Number(c.compatibility_score) || 0), 0) / compatAll.length).toFixed(2) : 0,
      avg_confidence: compatAll.length > 0 ? +(compatAll.reduce((s: number, c: any) => s + (Number(c.confidence_score) || 0), 0) / compatAll.length).toFixed(2) : 0,
      label_distribution: compatLabels,
    };

    // ===== GLOBAL SUMMARY =====
    const allLayers = Object.entries(results);
    const okLayers = allLayers.filter(([_, v]) => v.status === "ok").length;
    const attentionLayers = allLayers.filter(([_, v]) => v.status === "attention").length;
    const criticalLayers = allLayers.filter(([_, v]) => v.status === "critical").length;
    const qualityScore = allLayers.length > 0 ? +((okLayers / allLayers.length) * 100).toFixed(1) : 0;

    const globalSummary = {
      layers_validated: allLayers.length,
      ok_count: okLayers,
      attention_count: attentionLayers,
      critical_count: criticalLayers,
      quality_score: qualityScore,
      timestamp: new Date().toISOString(),
    };

    // Clean old validation reports before inserting fresh ones
    await supabase.from("validation_reports").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    // Persist each layer as a validation_report
    for (const [layerName, layerData] of allLayers) {
      const status = layerData.status;
      await supabase.from("validation_reports").insert({
        validation_type: layerName,
        report_data: layerData,
        anomaly_detected: status === "critical",
        confidence_score: status === "ok" ? 90 : status === "attention" ? 60 : 20,
      });
    }

    // Persist global summary
    await supabase.from("validation_reports").insert({
      validation_type: "global_summary",
      report_data: { ...globalSummary, layer_results: results },
      anomaly_detected: criticalLayers > 0,
      confidence_score: qualityScore >= 80 ? 90 : qualityScore >= 50 ? 60 : 30,
    });

    return new Response(JSON.stringify({ success: true, summary: globalSummary, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
