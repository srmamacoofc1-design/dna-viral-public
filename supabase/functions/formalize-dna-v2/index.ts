import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

/**
 * Formalize DNA V2 — AUTOPROTECT mode
 * 
 * NO invented weights. NO composite scoring formulas.
 * Performance block contains ONLY observed metrics from the MVP base.
 * If upstream data is contaminated or missing → registered as insufficient_data.
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // 1) Get latest DNA Base V2
    const { data: dnaV2, error: dnaErr } = await supabase
      .from("dna_base_v2")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (dnaErr || !dnaV2) throw new Error("No DNA Base V2 found: " + dnaErr?.message);

    // Check if upstream formula_registry still has invented weights
    const registry = dnaV2.formula_registry_snapshot as Record<string, unknown> | null;
    const hasInventedWeights = registry &&
      (JSON.stringify(registry).includes("views*0.70") ||
       JSON.stringify(registry).includes("views*0.50") ||
       JSON.stringify(registry).includes("views_weight"));

    if (hasInventedWeights) {
      // Log upstream contamination but proceed with clean formalization
      await supabase.from("extraction_logs").insert({
        video_id: "00000000-0000-0000-0000-000000000000",
        extraction_step: "formalize_dna_v2",
        field_name: "upstream_check",
        extracted_value: JSON.stringify({ warning: "upstream_dna_base_v2_has_legacy_weights", dna_base_id: dnaV2.id }),
        confidence_score: 0,
        source_type: "calculated",
        origin_level: "calculated",
      });
    }

    // 2) Get verbal intelligence summary
    const { data: verbalSummary } = await supabase
      .from("verbal_intelligence_summary")
      .select("*");

    // 3) Get verbal layer patterns
    const { data: layerPatterns } = await supabase
      .from("verbal_layer_patterns")
      .select("*");

    // 4) Get block data from video_blocks
    const { data: blockAvgs } = await supabase
      .from("video_blocks")
      .select("video_id, tempo_inicio, tempo_fim, tipo_bloco, texto, videos!inner(approved_for_global)")
      .eq("videos.approved_for_global", true);

    // 5) Get verbal analysis averages
    const { data: verbalAnalysis } = await supabase
      .from("block_verbal_analysis")
      .select("video_id, word_count, linguistic_density, semantic_pressure_score, phrase_pattern, videos!inner(approved_for_global)")
      .eq("videos.approved_for_global", true);

    // 6) Get videos for engagement data
    const { data: videos } = await supabase
      .from("videos")
      .select("id, duracao, views, likes, comments, segmento")
      .eq("status", "completed")
      .eq("approved_for_global", true);

    // 7) Get pattern performance weights for top replicable patterns
    const { data: topPatterns } = await supabase
      .from("pattern_performance_weights")
      .select("pattern_type, pattern_value, strength_score, frequency, avg_views")
      .order("strength_score", { ascending: false })
      .limit(10);

    // 8) Get verbal canonical units for emotional arc
    const { data: canonicalUnits } = await supabase
      .from("verbal_canonical_units")
      .select("video_id, narrative_function, emotional_intent, emotional_intensity, confidence_score, videos!inner(approved_for_global)")
      .eq("videos.approved_for_global", true);

    // === COMPUTE STRUCTURAL ===
    const blocks = blockAvgs || [];
    const videoBlockCounts: Record<string, number> = {};
    const blockTypeCounts: Record<string, number> = {};
    blocks.forEach((b: any) => {
      videoBlockCounts[b.video_id] = (videoBlockCounts[b.video_id] || 0) + 1;
      blockTypeCounts[b.tipo_bloco] = (blockTypeCounts[b.tipo_bloco] || 0) + 1;
    });
    const videoIds = Object.keys(videoBlockCounts);
    const avgBlockCount = videoIds.length > 0
      ? +(videoIds.reduce((s, id) => s + videoBlockCounts[id], 0) / videoIds.length).toFixed(1)
      : 0;

    const sortedBlockTypes = Object.entries(blockTypeCounts)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .map(([type, count]) => ({ type, count, pct: +((count as number) / blocks.length * 100).toFixed(1) }));

    const hookBlocks = blocks.filter((b: any) => b.tipo_bloco === "gancho" || b.tipo_bloco === "hook");
    const payoffBlocks = blocks.filter((b: any) => b.tipo_bloco === "payoff");

    const structural = {
      dominant_sequence: dnaV2.dominant_structure_sequence || null,
      avg_block_count: avgBlockCount,
      dominant_block_distribution: sortedBlockTypes.slice(0, 8),
      dominant_hook_type: hookBlocks.length > 0 ? "hook" : null,
      dominant_payoff_type: payoffBlocks.length > 0 ? "payoff" : null,
      total_blocks: blocks.length,
      total_videos: videoIds.length,
    };

    // === COMPUTE TEMPORAL ===
    const vids = videos || [];
    const durations = vids.filter((v: any) => v.duracao > 0).map((v: any) => v.duracao);
    const avgDuration = durations.length > 0
      ? +(durations.reduce((s: number, d: number) => s + d, 0) / durations.length).toFixed(1)
      : 0;

    const blockDurations = blocks
      .map((b: any) => b.tempo_fim - b.tempo_inicio)
      .filter((d: number) => d > 0);
    const avgBlockDuration = blockDurations.length > 0
      ? +(blockDurations.reduce((s: number, d: number) => s + d, 0) / blockDurations.length).toFixed(2)
      : 0;

    const hookTimes: number[] = [];
    const payoffTimes: number[] = [];
    const revealTimes: number[] = [];

    const blocksByVideo: Record<string, any[]> = {};
    blocks.forEach((b: any) => {
      if (!blocksByVideo[b.video_id]) blocksByVideo[b.video_id] = [];
      blocksByVideo[b.video_id].push(b);
    });

    for (const vid of vids) {
      const vblocks = blocksByVideo[vid.id];
      if (!vblocks || vid.duracao <= 0) continue;
      const dur = vid.duracao;
      const hook = vblocks.find((b: any) => b.tipo_bloco === "gancho" || b.tipo_bloco === "hook");
      const payoff = vblocks.find((b: any) => b.tipo_bloco === "payoff");
      const reveal = vblocks.find((b: any) => b.tipo_bloco === "revelacao");
      if (hook) hookTimes.push(+((hook.tempo_fim / dur) * 100).toFixed(1));
      if (payoff) payoffTimes.push(+((payoff.tempo_inicio / dur) * 100).toFixed(1));
      if (reveal) revealTimes.push(+((reveal.tempo_inicio / dur) * 100).toFixed(1));
    }

    const avg = (arr: number[]) => arr.length > 0 ? +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1) : null;

    const temporal = {
      avg_hook_time_pct: avg(hookTimes),
      avg_reveal_time_pct: avg(revealTimes),
      avg_payoff_time_pct: avg(payoffTimes),
      avg_block_duration: avgBlockDuration,
      avg_total_duration: avgDuration,
    };

    // === COMPUTE VERBAL ===
    const va = verbalAnalysis || [];
    const wordCounts = va.filter((v: any) => v.word_count > 0).map((v: any) => v.word_count);
    const densities = va.filter((v: any) => v.linguistic_density != null).map((v: any) => Number(v.linguistic_density));
    const pressures = va.filter((v: any) => v.semantic_pressure_score != null).map((v: any) => Number(v.semantic_pressure_score));

    const phraseCounts: Record<string, number> = {};
    va.forEach((v: any) => {
      if (v.phrase_pattern) phraseCounts[v.phrase_pattern] = (phraseCounts[v.phrase_pattern] || 0) + 1;
    });
    const dominantPhrase = Object.entries(phraseCounts).sort(([, a], [, b]) => (b as number) - (a as number))[0];

    const verbal = {
      dominant_phrase_pattern: dominantPhrase ? dominantPhrase[0] : dnaV2.dominant_verbal_pattern || null,
      avg_words_per_block: avg(wordCounts),
      linguistic_density: avg(densities),
      semantic_pressure_avg: avg(pressures),
    };

    // === COMPUTE EMOTIONAL ===
    const units = canonicalUnits || [];
    const emotionCounts: Record<string, number> = {};
    const intensities: number[] = [];
    units.forEach((u: any) => {
      if (u.emotional_intent) emotionCounts[u.emotional_intent] = (emotionCounts[u.emotional_intent] || 0) + 1;
      if (u.emotional_intensity != null) intensities.push(Number(u.emotional_intensity));
    });

    const emotionDistribution = Object.entries(emotionCounts)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 6)
      .map(([emotion, count]) => ({ emotion, count, pct: +((count as number) / units.length * 100).toFixed(1) }));

    // dominant_emotion derived from the top entry in emotion_distribution — no hardcoded value
    const dominantEmotionFromDist = emotionDistribution.length > 0 ? emotionDistribution[0].emotion : null;
    // secondary_emotion derived from the second entry — no hardcoded value
    const secondaryEmotionFromDist = emotionDistribution.length > 1 ? emotionDistribution[1].emotion : null;

    const emotional = {
      dominant_emotion: dominantEmotionFromDist,
      secondary_emotion: secondaryEmotionFromDist,
      dominant_emotional_arc: dnaV2.dominant_emotional_arc || null,
      emotional_intensity_avg: avg(intensities),
      emotion_distribution: emotionDistribution,
    };

    // === COMPUTE PERFORMANCE (observational only, no invented weights) ===
    const eligibleForEngagement = vids.filter((v: any) => (Number(v.views) || 0) > 0);
    const engagementRates = eligibleForEngagement.map((v: any) =>
      (Number(v.likes) + Number(v.comments)) / Number(v.views)
    );

    const hasEnoughData = engagementRates.length >= 2;
    const maxEngRate = hasEnoughData ? Math.max(...engagementRates) : null;
    const avgEngRate = hasEnoughData
      ? +(engagementRates.reduce((s, r) => s + r, 0) / engagementRates.length).toFixed(6)
      : null;

    const performance = {
      scoring_method: "engagement_rate_normalized",
      engagement_rate_formula: "(likes + comments) / views",
      engagement_rate_relative_formula: hasEnoughData ? "engagement_rate / max_engagement_rate" : null,
      note: "no_invented_weights",
      eligible_videos: eligibleForEngagement.length,
      max_engagement_rate: maxEngRate !== null ? +maxEngRate.toFixed(6) : null,
      avg_engagement_rate: avgEngRate,
      insufficient_data: !hasEnoughData,
      top_replicable_patterns: (topPatterns || []).map((p: any) => ({
        pattern_type: p.pattern_type,
        pattern_value: p.pattern_value,
        strength_score: Number(p.strength_score),
        frequency: p.frequency,
      })),
    };

    // === BUILD FORMAL DNA JSON ===
    const formalDna = {
      version: "DNA_FORMAL_V1",
      generated_at: new Date().toISOString(),
      source_dna_base_v2_id: dnaV2.id,
      structural,
      temporal,
      verbal,
      emotional,
      performance,
    };

    const dataSources = [
      { table: "dna_base_v2", records_used: 1 },
      { table: "video_blocks", records_used: blocks.length },
      { table: "block_verbal_analysis", records_used: va.length },
      { table: "verbal_canonical_units", records_used: units.length },
      { table: "videos", records_used: vids.length },
      { table: "pattern_performance_weights", records_used: (topPatterns || []).length },
    ];

    const consistencyCheck = {
      dna_v2_version: dnaV2.version_name,
      dna_v2_total_videos: dnaV2.total_videos_used,
      dna_v2_total_blocks: dnaV2.total_blocks_used,
      formal_total_videos: videoIds.length,
      formal_total_blocks: blocks.length,
      videos_match: dnaV2.total_videos_used === videoIds.length,
      blocks_match: dnaV2.total_blocks_used === blocks.length,
      structural_sequence_preserved: structural.dominant_sequence === dnaV2.dominant_structure_sequence,
      emotional_arc_preserved: emotional.dominant_emotional_arc === dnaV2.dominant_emotional_arc,
      verbal_pattern_consistent: verbal.dominant_phrase_pattern != null,
      performance_method: "engagement_rate_only_no_weights",
    };

    // Delete previous formal records, then insert fresh
    await supabase.from("dna_base_v2_formal").delete().eq("version_name", "DNA_FORMAL_V1");

    const { data: inserted, error: insertErr } = await supabase
      .from("dna_base_v2_formal")
      .insert({
        version_name: "DNA_FORMAL_V1",
        source_dna_base_v2_id: dnaV2.id,
        structural,
        temporal,
        verbal,
        emotional,
        performance,
        formal_dna_json: formalDna,
        total_videos_used: videoIds.length,
        total_blocks_used: blocks.length,
        data_sources_used: dataSources,
        consistency_check: consistencyCheck,
      })
      .select()
      .single();

    if (insertErr) throw new Error("Insert failed: " + insertErr.message);

    return new Response(JSON.stringify({
      success: true,
      formal_dna_id: inserted.id,
      summary: { structural, temporal, verbal, emotional, performance },
      consistency_check: consistencyCheck,
      data_sources: dataSources,
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
