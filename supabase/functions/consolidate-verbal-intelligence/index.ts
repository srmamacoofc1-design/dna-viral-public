import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALL_FUNCTIONS = ["HOOK", "SETUP", "BUILD", "MICRO_PEAK", "TWIST", "PAYOFF", "CTA", "TRANSITION"];

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function isFragment(a: string, b: string): boolean {
  const na = normalize(a), nb = normalize(b);
  if (na.length < 4 || nb.length < 4) return false;
  return nb.includes(na) || na.includes(nb);
}

function wordSimilarity(a: string, b: string): number {
  const wa = new Set(normalize(a).split(" ").filter(w => w.length > 2));
  const wb = new Set(normalize(b).split(" ").filter(w => w.length > 2));
  if (wa.size === 0 && wb.size === 0) return 1;
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / new Set([...wa, ...wb]).size;
}

interface RawUnit {
  id: string;
  video_id: string;
  block_id: string | null;
  text: string;
  narrative_function: string;
  emotional_intent: string | null;
  emotional_intensity: number;
  confidence_score: number;
  replicable_for_dna: boolean;
  viewer_directed: boolean;
  source: string;
}

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

    // 1) Gather all valid narrative units from judge results
    const allUnits: RawUnit[] = [];

    // Fetch in pages to avoid 1000-row limit
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const { data } = await supabase
        .from("narrative_judge_results")
        .select("id, video_id, block_id, candidate_text, narrative_function, emotional_intent, confidence_score, replicable_for_dna, viewer_directed")
        .in("video_id", approvedScope)
        .eq("is_valid_narrative_unit", true)
        .range(offset, offset + pageSize - 1);
      if (!data || data.length === 0) break;
      for (const j of data) {
        if (!j.candidate_text || !j.narrative_function) continue;
        allUnits.push({
          id: j.id,
          video_id: j.video_id,
          block_id: j.block_id,
          text: j.candidate_text,
          narrative_function: j.narrative_function.toUpperCase(),
          emotional_intent: j.emotional_intent,
          emotional_intensity: j.confidence_score || 0,
          confidence_score: j.confidence_score || 0,
          replicable_for_dna: j.replicable_for_dna || false,
          viewer_directed: j.viewer_directed || false,
          source: "narrative_judge",
        });
      }
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    // CTA auxiliary sources — used ONLY for enrichment, NOT as primary canonical units
    // Build a lookup: video_id+block_id -> { has_cta_event, has_cta_deep, max_intensity, viewer_directed }
    const ctaEnrichmentMap: Record<string, { has_cta_event: boolean; has_cta_deep: boolean; max_intensity: number; cta_event_count: number; cta_deep_count: number }> = {};

    const { data: ctaEvents } = await supabase
      .from("video_cta_events")
      .select("video_id, block_id, cta_intensity")
      .in("video_id", approvedScope);
    for (const e of ctaEvents || []) {
      const key = `${e.video_id}::${e.block_id || 'none'}`;
      if (!ctaEnrichmentMap[key]) ctaEnrichmentMap[key] = { has_cta_event: false, has_cta_deep: false, max_intensity: 0, cta_event_count: 0, cta_deep_count: 0 };
      ctaEnrichmentMap[key].has_cta_event = true;
      ctaEnrichmentMap[key].cta_event_count++;
      ctaEnrichmentMap[key].max_intensity = Math.max(ctaEnrichmentMap[key].max_intensity, e.cta_intensity || 0);
    }

    const { data: ctaDeep } = await supabase
      .from("cta_deep_analysis")
      .select("video_id, confidence_score")
      .in("video_id", approvedScope);
    for (const c of ctaDeep || []) {
      const key = `${c.video_id}::none`;
      if (!ctaEnrichmentMap[key]) ctaEnrichmentMap[key] = { has_cta_event: false, has_cta_deep: false, max_intensity: 0, cta_event_count: 0, cta_deep_count: 0 };
      ctaEnrichmentMap[key].has_cta_deep = true;
      ctaEnrichmentMap[key].cta_deep_count++;
    }

    // Apply CTA enrichment to existing units (boost viewer_directed for CTA-confirmed units)
    for (const u of allUnits) {
      const key = `${u.video_id}::${u.block_id || 'none'}`;
      const enrichment = ctaEnrichmentMap[key];
      if (enrichment) {
        if (enrichment.has_cta_event || enrichment.has_cta_deep) {
          u.viewer_directed = true;
        }
      }
    }

    const auditStats = {
      from_narrative_judge: allUnits.length,
      from_video_cta_events: 0, // no longer primary source
      from_cta_deep_analysis: 0, // no longer primary source
      cta_enrichment_applied: Object.keys(ctaEnrichmentMap).length,
      total_cta_events_as_enrichment_only: (ctaEvents || []).length,
      total_cta_deep_as_enrichment_only: (ctaDeep || []).length,
    };

    // 2) Deduplicate (same logic as audit-cta-dedup)
    const grouped: Record<string, RawUnit[]> = {};
    for (const u of allUnits) {
      const key = `${u.video_id}::${u.narrative_function}`;
      (grouped[key] ??= []).push(u);
    }

    const canonical: RawUnit[] = [];
    for (const [, entries] of Object.entries(grouped)) {
      if (entries.length === 0) continue;
      const used = new Set<string>();
      const sorted = [...entries].sort((a, b) => b.text.length - a.text.length);

      for (let i = 0; i < sorted.length; i++) {
        if (used.has(sorted[i].id)) continue;
        const anchor = sorted[i];

        for (let j = i + 1; j < sorted.length; j++) {
          if (used.has(sorted[j].id)) continue;
          const cand = sorted[j];
          const sameBlock = anchor.block_id && cand.block_id && anchor.block_id === cand.block_id;
          const frag = isFragment(anchor.text, cand.text);
          const sim = wordSimilarity(anchor.text, cand.text);
          if ((sameBlock && frag) || (sameBlock && sim >= 0.6) || (frag && sim >= 0.5) || sim >= 0.75) {
            used.add(cand.id);
            // merge best scores into anchor
            if (cand.confidence_score > anchor.confidence_score) anchor.confidence_score = cand.confidence_score;
            if (cand.replicable_for_dna) anchor.replicable_for_dna = true;
            if (cand.viewer_directed) anchor.viewer_directed = true;
          }
        }
        used.add(anchor.id);
        canonical.push(anchor);
      }
    }

    // 3) Enrich with video data
    const videoIds = [...new Set(canonical.map(c => c.video_id))];
    const videoMap: Record<string, { titulo: string | null; engagement_rate_relative: number | null; views: number | null }> = {};
    for (let i = 0; i < videoIds.length; i += 200) {
      const batch = videoIds.slice(i, i + 200);
      const { data: vids } = await supabase
        .from("videos")
        .select("id, titulo, engagement_rate_relative, views")
        .in("id", batch)
        .eq("approved_for_global", true);
      for (const v of vids || []) {
        videoMap[v.id] = { titulo: v.titulo, engagement_rate_relative: v.engagement_rate_relative, views: v.views };
      }
    }

    // 4) Calculate narrative_replicability_score per unit
    for (const u of canonical) {
      const vid = videoMap[u.video_id];
      const vs = vid?.engagement_rate_relative || 0;
      u.emotional_intensity = Math.min(u.emotional_intensity, 100);
      // narrative_replicability_score = confidence * engagement_weight * replicability_bonus
      const repBonus = u.replicable_for_dna ? 1.3 : 1.0;
      const vdBonus = u.viewer_directed ? 1.1 : 1.0;
      (u as any).narrative_replicability_score = Math.round(
        (u.confidence_score / 100) * (vs / 100) * repBonus * vdBonus * 100
      ) / 100;
    }

    // 5) Persist to verbal_canonical_units (clear + insert)
    await supabase.from("verbal_canonical_units").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    const insertRows = canonical.map((u, idx) => ({
      video_id: u.video_id,
      block_id: u.block_id,
      candidate_text: u.text,
      narrative_function: u.narrative_function,
      emotional_intent: u.emotional_intent,
      emotional_intensity: u.emotional_intensity,
      confidence_score: u.confidence_score,
      replicable_for_dna: u.replicable_for_dna,
      viewer_directed: u.viewer_directed,
      narrative_replicability_score: (u as any).narrative_replicability_score || 0,
      source_judge_id: u.source === "narrative_judge" ? u.id : null,
      video_title: videoMap[u.video_id]?.titulo,
      video_engagement_rate: videoMap[u.video_id]?.engagement_rate_relative,
      video_views: videoMap[u.video_id]?.views,
    }));

    // Insert in batches of 500
    for (let i = 0; i < insertRows.length; i += 500) {
      await supabase.from("verbal_canonical_units").insert(insertRows.slice(i, i + 500));
    }

    // 6) Compute per-function intelligence summary
    const summaries: Record<string, any> = {};
    for (const fn of ALL_FUNCTIONS) {
      const units = canonical.filter(u => u.narrative_function === fn);
      if (units.length === 0) {
        summaries[fn] = { narrative_function: fn, total_canonical_units: 0 };
        continue;
      }

      // Emotion distribution
      const emotionCounts: Record<string, number> = {};
      let totalIntensity = 0, totalConf = 0, totalRep = 0, totalVd = 0, totalVs = 0;
      for (const u of units) {
        if (u.emotional_intent) emotionCounts[u.emotional_intent] = (emotionCounts[u.emotional_intent] || 0) + 1;
        totalIntensity += u.emotional_intensity;
        totalConf += u.confidence_score;
        totalRep += u.replicable_for_dna ? 1 : 0;
        totalVd += u.viewer_directed ? 1 : 0;
        totalVs += (u as any).narrative_replicability_score || 0;
      }

      const sortedEmotions = Object.entries(emotionCounts).sort((a, b) => b[1] - a[1]);
      const n = units.length;

      // Top patterns (recurring text structures)
      const textPatterns: Record<string, number> = {};
      for (const u of units) {
        const words = normalize(u.text).split(" ");
        if (words.length >= 2) {
          const bigram = words.slice(0, 2).join(" ");
          textPatterns[bigram] = (textPatterns[bigram] || 0) + 1;
        }
      }
      const topPatterns = Object.entries(textPatterns)
        .filter(([, c]) => c >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([p, c]) => ({ pattern: p, count: c }));

      // Top units by narrative_replicability_score
      const topUnits = [...units]
        .sort((a, b) => ((b as any).narrative_replicability_score || 0) - ((a as any).narrative_replicability_score || 0))
        .slice(0, 10)
        .map(u => ({
          text: u.text,
          narrative_replicability_score: (u as any).narrative_replicability_score,
          confidence: u.confidence_score,
          emotion: u.emotional_intent,
          video_title: videoMap[u.video_id]?.titulo,
        }));

      summaries[fn] = {
        narrative_function: fn,
        total_canonical_units: n,
        primary_emotion: sortedEmotions[0]?.[0] || null,
        secondary_emotion: sortedEmotions[1]?.[0] || null,
        avg_emotional_intensity: Math.round((totalIntensity / n) * 100) / 100,
        avg_confidence: Math.round((totalConf / n) * 100) / 100,
        avg_replicability: Math.round((totalRep / n) * 100) / 100,
        viewer_directed_rate: Math.round((totalVd / n) * 100) / 100,
        avg_replicability_score: Math.round((totalVs / n) * 100) / 100,
        top_patterns: topPatterns,
        top_units: topUnits,
      };
    }

    // 7) Persist summary
    await supabase.from("verbal_intelligence_summary").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    const summaryRows = Object.values(summaries).map((s: any) => ({
      narrative_function: s.narrative_function,
      total_canonical_units: s.total_canonical_units,
      primary_emotion: s.primary_emotion,
      secondary_emotion: s.secondary_emotion,
      avg_emotional_intensity: s.avg_emotional_intensity || 0,
      avg_confidence: s.avg_confidence || 0,
      avg_replicability: s.avg_replicability || 0,
      viewer_directed_rate: s.viewer_directed_rate || 0,
      avg_replicability_score: s.avg_replicability_score || 0,
      top_patterns: s.top_patterns || [],
      top_units: s.top_units || [],
    }));
    await supabase.from("verbal_intelligence_summary").insert(summaryRows);

    // 8) Mark top-ranked units
    for (const fn of ALL_FUNCTIONS) {
      const fnUnits = canonical
        .filter(u => u.narrative_function === fn)
        .sort((a, b) => ((b as any).narrative_replicability_score || 0) - ((a as any).narrative_replicability_score || 0));
      const topIds = fnUnits.slice(0, 5).map((u, i) => ({ id: u.id, rank: i + 1 }));
      // We already inserted, so update by text match
      for (const t of topIds) {
        const unit = fnUnits.find(u => u.id === t.id);
        if (unit) {
          await supabase.from("verbal_canonical_units")
            .update({ is_top_ranked: true, rank_within_function: t.rank })
            .eq("candidate_text", unit.text)
            .eq("narrative_function", fn);
        }
      }
    }

    return new Response(JSON.stringify({
      status: "ok",
      total_canonical_units: canonical.length,
      total_videos: videoIds.length,
      per_function: Object.fromEntries(
        ALL_FUNCTIONS.map(fn => [fn, summaries[fn]?.total_canonical_units || 0])
      ),
      audit: auditStats,
      source_rule: "primary=narrative_judge_results, CTA_sources=enrichment_only",
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
