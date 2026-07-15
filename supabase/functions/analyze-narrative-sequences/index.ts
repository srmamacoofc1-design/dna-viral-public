import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALL_FUNCTIONS = ["HOOK", "SETUP", "BUILD", "MICRO_PEAK", "TWIST", "PAYOFF", "CTA", "TRANSITION", "ACTION"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: approvedVideos, error: approvedVideosError } = await supabase
      .from("videos")
      .select("id")
      .eq("approved_for_global", true);
    if (approvedVideosError) throw approvedVideosError;
    const approvedIds = approvedVideos?.map((video) => video.id) ?? [];
    const approvedScope = approvedIds.length
      ? approvedIds
      : ["00000000-0000-0000-0000-000000000000"];

    // 1) Load all canonical units
    const allUnits: any[] = [];
    let offset = 0;
    while (true) {
      const { data } = await supabase
        .from("verbal_canonical_units")
        .select("*")
        .in("video_id", approvedScope)
        .range(offset, offset + 999);
      if (!data || data.length === 0) break;
      allUnits.push(...data);
      if (data.length < 1000) break;
      offset += 1000;
    }

    // Load video data for engagement_rate_relative
    const videoIds = [...new Set(allUnits.map(u => u.video_id))];
    const videoMap: Record<string, any> = {};
    for (let i = 0; i < videoIds.length; i += 200) {
      const { data: vids } = await supabase
        .from("videos")
        .select("id, titulo, engagement_rate_relative, views")
        .in("id", videoIds.slice(i, i + 200))
        .eq("approved_for_global", true);
      for (const v of vids || []) videoMap[v.id] = v;
    }

    // Load block data for temporal ordering
    const blockIds = [...new Set(allUnits.filter(u => u.block_id).map(u => u.block_id))];
    const blockMap: Record<string, { tempo_inicio: number; tipo_bloco: string }> = {};
    for (let i = 0; i < blockIds.length; i += 200) {
      const { data: blocks } = await supabase
        .from("video_blocks")
        .select("id, tempo_inicio, tipo_bloco")
        .in("id", blockIds.slice(i, i + 200));
      for (const b of blocks || []) blockMap[b.id] = { tempo_inicio: b.tempo_inicio, tipo_bloco: b.tipo_bloco };
    }

    // 2) Build per-video sequences ordered by block tempo_inicio
    const videoUnits: Record<string, any[]> = {};
    for (const u of allUnits) {
      (videoUnits[u.video_id] ??= []).push(u);
    }

    const perVideoSequences: { video_id: string; sequence: string[]; units: any[] }[] = [];

    for (const [vid, units] of Object.entries(videoUnits)) {
      // Sort by block tempo_inicio, then by confidence desc
      const sorted = units.sort((a: any, b: any) => {
        const ta = a.block_id && blockMap[a.block_id] ? blockMap[a.block_id].tempo_inicio : 9999;
        const tb = b.block_id && blockMap[b.block_id] ? blockMap[b.block_id].tempo_inicio : 9999;
        if (ta !== tb) return ta - tb;
        return (b.confidence_score || 0) - (a.confidence_score || 0);
      });

      // Deduplicate consecutive same-function entries
      const sequence: string[] = [];
      const seqUnits: any[] = [];
      for (const u of sorted) {
        const fn = u.narrative_function;
        if (sequence.length === 0 || sequence[sequence.length - 1] !== fn) {
          sequence.push(fn);
          seqUnits.push(u);
        }
      }

      if (sequence.length >= 2) {
        perVideoSequences.push({ video_id: vid, sequence, units: seqUnits });
      }
    }

    // 3) Count sequence patterns
    const patternMap: Record<string, { count: number; videoIds: string[]; units: any[] }> = {};

    for (const vs of perVideoSequences) {
      const pattern = vs.sequence.join(" → ");
      if (!patternMap[pattern]) patternMap[pattern] = { count: 0, videoIds: [], units: [] };
      patternMap[pattern].count++;
      patternMap[pattern].videoIds.push(vs.video_id);
      patternMap[pattern].units.push(...vs.units);
    }

    // Also detect sub-sequences (windows of 2-5 from each video)
    const subPatternMap: Record<string, { count: number; videoIds: Set<string>; units: any[] }> = {};
    for (const vs of perVideoSequences) {
      for (let windowSize = 2; windowSize <= Math.min(5, vs.sequence.length); windowSize++) {
        for (let start = 0; start <= vs.sequence.length - windowSize; start++) {
          const sub = vs.sequence.slice(start, start + windowSize).join(" → ");
          if (!subPatternMap[sub]) subPatternMap[sub] = { count: 0, videoIds: new Set(), units: [] };
          if (!subPatternMap[sub].videoIds.has(vs.video_id)) {
            subPatternMap[sub].count++;
            subPatternMap[sub].videoIds.add(vs.video_id);
            subPatternMap[sub].units.push(...vs.units.slice(start, start + windowSize));
          }
        }
      }
    }

    // Merge full patterns + sub-patterns (sub-patterns only if freq >= 2)
    const allPatterns: Record<string, { count: number; videoIds: string[]; units: any[] }> = {};
    for (const [p, v] of Object.entries(patternMap)) {
      allPatterns[p] = v;
    }
    for (const [p, v] of Object.entries(subPatternMap)) {
      if (v.count >= 2 && !allPatterns[p]) {
        allPatterns[p] = { count: v.count, videoIds: [...v.videoIds], units: v.units };
      }
    }

    // 4) Compute metrics per pattern
    const sequenceRows = Object.entries(allPatterns)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 50)
      .map(([pattern, data]) => {
        const vids = data.videoIds;
        const viralScores = vids.map(v => videoMap[v]?.engagement_rate_relative || 0);
        const units = data.units;
        const emotions: Record<string, number> = {};
        let totalIntensity = 0, totalConf = 0, totalVs = 0, totalVd = 0, totalRep = 0;
        for (const u of units) {
          if (u.emotional_intent) emotions[u.emotional_intent] = (emotions[u.emotional_intent] || 0) + 1;
          totalIntensity += u.emotional_intensity || 0;
          totalConf += u.confidence_score || 0;
          totalVs += u.narrative_replicability_score || 0;
          totalVd += u.viewer_directed ? 1 : 0;
          totalRep += u.replicable_for_dna ? 1 : 0;
        }
        const n = units.length || 1;
        const dominantEmotion = Object.entries(emotions).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

        return {
          sequence_pattern: pattern,
          sequence_length: pattern.split(" → ").length,
          frequency: data.count,
          video_ids: vids,
          avg_engagement_rate: Math.round((viralScores.reduce((a, b) => a + b, 0) / vids.length) * 100) / 100,
          avg_emotional_intensity: Math.round((totalIntensity / n) * 100) / 100,
          avg_confidence: Math.round((totalConf / n) * 100) / 100,
          avg_replicability_score: Math.round((totalVs / n) * 10000) / 10000,
          viewer_directed_rate: Math.round((totalVd / n) * 100) / 100,
          avg_replicability: Math.round((totalRep / n) * 100) / 100,
          dominant_emotion: dominantEmotion,
          sample_videos: vids.slice(0, 5).map(v => ({
            id: v,
            title: videoMap[v]?.titulo || "—",
            engagement_rate_relative: videoMap[v]?.engagement_rate_relative || 0,
          })),
        };
      });

    // 5) Persist sequences
    await supabase.from("verbal_narrative_sequences").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (sequenceRows.length > 0) {
      await supabase.from("verbal_narrative_sequences").insert(sequenceRows);
    }

    // 6) Build final Phase 2 verbal profile per function
    const profileRows = ALL_FUNCTIONS.map(fn => {
      const units = allUnits.filter(u => u.narrative_function === fn);
      if (units.length === 0) return null;

      const emotions: Record<string, number> = {};
      let totalIntensity = 0, totalConf = 0, totalRep = 0, totalVd = 0, totalVs = 0;
      for (const u of units) {
        if (u.emotional_intent) emotions[u.emotional_intent] = (emotions[u.emotional_intent] || 0) + 1;
        totalIntensity += u.emotional_intensity || 0;
        totalConf += u.confidence_score || 0;
        totalRep += u.replicable_for_dna ? 1 : 0;
        totalVd += u.viewer_directed ? 1 : 0;
        totalVs += u.narrative_replicability_score || 0;
      }
      const n = units.length;
      const sortedEmotions = Object.entries(emotions).sort((a, b) => b[1] - a[1]);

      // Top verbal patterns (trigrams from candidate_text)
      const patternCounts: Record<string, number> = {};
      for (const u of units) {
        const words = (u.candidate_text || "").toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter((w: string) => w.length > 2);
        for (let i = 0; i < words.length - 1; i++) {
          const bigram = `${words[i]} ${words[i + 1]}`;
          patternCounts[bigram] = (patternCounts[bigram] || 0) + 1;
        }
      }
      const topPatterns = Object.entries(patternCounts)
        .filter(([, c]) => c >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([p, c]) => ({ pattern: p, count: c }));

      // Top units
      const topUnits = [...units]
        .sort((a, b) => (b.narrative_replicability_score || 0) - (a.narrative_replicability_score || 0))
        .slice(0, 10)
        .map(u => ({
          text: u.candidate_text,
          narrative_replicability_score: u.narrative_replicability_score,
          confidence: u.confidence_score,
          emotion: u.emotional_intent,
          video_title: u.video_title,
          viewer_directed: u.viewer_directed,
          replicable: u.replicable_for_dna,
        }));

      // Intensity histogram (buckets: 0-20, 20-40, 40-60, 60-80, 80-100)
      const buckets = [0, 0, 0, 0, 0];
      for (const u of units) {
        const idx = Math.min(Math.floor((u.emotional_intensity || 0) / 20), 4);
        buckets[idx]++;
      }

      return {
        narrative_function: fn,
        total_units: n,
        primary_emotion: sortedEmotions[0]?.[0] || null,
        secondary_emotion: sortedEmotions[1]?.[0] || null,
        avg_emotional_intensity: Math.round((totalIntensity / n) * 100) / 100,
        avg_confidence: Math.round((totalConf / n) * 100) / 100,
        avg_replicability: Math.round((totalRep / n) * 100) / 100,
        viewer_directed_rate: Math.round((totalVd / n) * 100) / 100,
        avg_replicability_score: Math.round((totalVs / n) * 10000) / 10000,
        top_verbal_patterns: topPatterns,
        top_units: topUnits,
        emotion_distribution: emotions,
        intensity_histogram: buckets.map((c, i) => ({ range: `${i * 20}-${(i + 1) * 20}`, count: c })),
      };
    }).filter(Boolean);

    // Persist
    await supabase.from("verbal_phase2_profile").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (profileRows.length > 0) {
      await supabase.from("verbal_phase2_profile").insert(profileRows);
    }

    return new Response(JSON.stringify({
      status: "ok",
      total_canonical_units: allUnits.length,
      total_videos_with_sequences: perVideoSequences.length,
      total_sequence_patterns: sequenceRows.length,
      top_sequences: sequenceRows.slice(0, 10).map(s => ({
        pattern: s.sequence_pattern,
        frequency: s.frequency,
        avg_engagement: s.avg_engagement_rate,
      })),
      phase2_profile_functions: profileRows.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
