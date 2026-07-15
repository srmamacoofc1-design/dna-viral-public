import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALL_FUNCTIONS = ["HOOK", "SETUP", "BUILD", "MICRO_PEAK", "TWIST", "PAYOFF", "CTA", "TRANSITION"];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isFragment(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (na.length < 4 || nb.length < 4) return false;
  return nb.includes(na) || na.includes(nb);
}

function wordSimilarity(a: string, b: string): number {
  const wa = new Set(normalize(a).split(" ").filter(w => w.length > 2));
  const wb = new Set(normalize(b).split(" ").filter(w => w.length > 2));
  if (wa.size === 0 && wb.size === 0) return 1;
  if (wa.size === 0 || wb.size === 0) return 0;
  let intersection = 0;
  for (const w of wa) if (wb.has(w)) intersection++;
  const union = new Set([...wa, ...wb]).size;
  return intersection / union;
}

interface NarrativeEntry {
  id: string;
  video_id: string;
  block_id: string | null;
  text: string;
  narrative_function: string;
  intensity: number;
  source: string;
}

interface DedupGroup {
  kept: NarrativeEntry;
  duplicates: NarrativeEntry[];
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

    const body = await req.json().catch(() => ({}));
    const videoFilter = body.video_id || null;

    const allEntries: NarrativeEntry[] = [];

    // 1) narrative_judge_results — all valid narrative units
    let q1 = supabase
      .from("narrative_judge_results")
      .select("id, video_id, block_id, candidate_text, narrative_function, confidence_score")
      .eq("is_valid_narrative_unit", true);
    if (videoFilter) q1 = q1.eq("video_id", videoFilter);
    const { data: judgeData } = await q1;
    for (const j of judgeData || []) {
      if (!j.candidate_text || !j.narrative_function) continue;
      allEntries.push({
        id: j.id,
        video_id: j.video_id,
        block_id: j.block_id,
        text: j.candidate_text,
        narrative_function: j.narrative_function.toUpperCase(),
        intensity: j.confidence_score || 0,
        source: "narrative_judge",
      });
    }

    // 2) video_cta_events (CTA-specific source)
    let q2 = supabase.from("video_cta_events").select("id, video_id, block_id, cta_text, cta_type, cta_intensity");
    if (videoFilter) q2 = q2.eq("video_id", videoFilter);
    const { data: ctaEvents } = await q2;
    for (const e of ctaEvents || []) {
      if (!e.cta_text) continue;
      allEntries.push({
        id: e.id,
        video_id: e.video_id,
        block_id: e.block_id,
        text: e.cta_text,
        narrative_function: "CTA",
        intensity: e.cta_intensity || 0,
        source: "video_cta_events",
      });
    }

    // 3) cta_deep_analysis (CTA-specific source)
    let q3 = supabase.from("cta_deep_analysis").select("id, video_id, cta_text, cta_type, cta_intensity");
    if (videoFilter) q3 = q3.eq("video_id", videoFilter);
    const { data: deepCta } = await q3;
    for (const d of deepCta || []) {
      if (!d.cta_text) continue;
      allEntries.push({
        id: d.id,
        video_id: d.video_id,
        block_id: null,
        text: d.cta_text,
        narrative_function: "CTA",
        intensity: d.cta_intensity || 0,
        source: "cta_deep_analysis",
      });
    }

    // 4) block_verbal_analysis — HOOK/BUILD/etc from full_text
    let q4 = supabase
      .from("block_verbal_analysis")
      .select("id, video_id, block_id, full_text, tone, emotional_intensity")
      .not("full_text", "is", null);
    if (videoFilter) q4 = q4.eq("video_id", videoFilter);
    const { data: verbalData } = await q4;

    // We need block type to assign narrative_function
    const blockIds = new Set((verbalData || []).map(v => v.block_id));
    const blockTypeMap: Record<string, string> = {};
    if (blockIds.size > 0) {
      const ids = [...blockIds];
      // Fetch in batches of 200
      for (let i = 0; i < ids.length; i += 200) {
        const batch = ids.slice(i, i + 200);
        const { data: blocks } = await supabase
          .from("video_blocks")
          .select("id, tipo_bloco")
          .in("id", batch);
        for (const b of blocks || []) {
          blockTypeMap[b.id] = (b.tipo_bloco || "").toUpperCase();
        }
      }
    }

    for (const v of verbalData || []) {
      if (!v.full_text || v.full_text.length < 5) continue;
      const blockType = blockTypeMap[v.block_id] || "";
      // Map tipo_bloco to narrative function
      const fnMap: Record<string, string> = {
        HOOK: "HOOK", GANCHO: "HOOK",
        SETUP: "SETUP", CONTEXTO: "SETUP",
        BUILD: "BUILD", DESENVOLVIMENTO: "BUILD",
        TWIST: "TWIST", VIRADA: "TWIST",
        PAYOFF: "PAYOFF", RESOLUCAO: "PAYOFF",
        CTA: "CTA",
        TRANSICAO: "TRANSITION", TRANSITION: "TRANSITION",
        MICRO_PEAK: "MICRO_PEAK",
      };
      const narFunc = fnMap[blockType] || "BUILD";
      allEntries.push({
        id: v.id,
        video_id: v.video_id,
        block_id: v.block_id,
        text: v.full_text,
        narrative_function: narFunc,
        intensity: v.emotional_intensity || 0,
        source: "block_verbal_analysis",
      });
    }

    // Group by video_id + narrative_function
    const grouped: Record<string, NarrativeEntry[]> = {};
    for (const e of allEntries) {
      const key = `${e.video_id}::${e.narrative_function}`;
      (grouped[key] ??= []).push(e);
    }

    const allGroups: DedupGroup[] = [];
    const perFunction: Record<string, { raw: number; unique: number; duplicates: number }> = {};
    for (const fn of ALL_FUNCTIONS) {
      perFunction[fn] = { raw: 0, unique: 0, duplicates: 0 };
    }

    let totalRaw = 0, totalDuplicates = 0;

    for (const [, entries] of Object.entries(grouped)) {
      if (entries.length === 0) continue;
      const fn = entries[0].narrative_function;
      const fnStats = perFunction[fn] || (perFunction[fn] = { raw: 0, unique: 0, duplicates: 0 });
      fnStats.raw += entries.length;
      totalRaw += entries.length;

      const used = new Set<string>();
      // Sort by text length desc (longest = most complete)
      const sorted = [...entries].sort((a, b) => b.text.length - a.text.length);

      for (let i = 0; i < sorted.length; i++) {
        if (used.has(sorted[i].id)) continue;
        const anchor = sorted[i];
        const dupes: NarrativeEntry[] = [];

        for (let j = i + 1; j < sorted.length; j++) {
          if (used.has(sorted[j].id)) continue;
          const candidate = sorted[j];

          const sameBlock = anchor.block_id && candidate.block_id && anchor.block_id === candidate.block_id;
          const fragment = isFragment(anchor.text, candidate.text);
          const similarity = wordSimilarity(anchor.text, candidate.text);

          let isDuplicate = false;
          if (sameBlock && fragment) isDuplicate = true;
          else if (sameBlock && similarity >= 0.6) isDuplicate = true;
          else if (fragment && similarity >= 0.5) isDuplicate = true;
          else if (similarity >= 0.75) isDuplicate = true;

          if (isDuplicate) {
            dupes.push(candidate);
            used.add(candidate.id);
          }
        }

        used.add(anchor.id);
        if (dupes.length > 0) {
          allGroups.push({ kept: anchor, duplicates: dupes });
          fnStats.duplicates += dupes.length;
          totalDuplicates += dupes.length;
        }
      }
    }

    // Compute unique counts
    for (const fn of Object.keys(perFunction)) {
      perFunction[fn].unique = perFunction[fn].raw - perFunction[fn].duplicates;
    }
    const totalUnique = totalRaw - totalDuplicates;

    // Group examples (top 30)
    const groupExamples = allGroups.slice(0, 30).map(g => ({
      kept_text: g.kept.text,
      kept_source: g.kept.source,
      kept_intensity: g.kept.intensity,
      narrative_function: g.kept.narrative_function,
      video_id: g.kept.video_id,
      block_id: g.kept.block_id,
      collapsed_fragments: g.duplicates.map(d => ({
        text: d.text,
        source: d.source,
        intensity: d.intensity,
      })),
    }));

    const result = {
      summary: {
        total_raw_units: totalRaw,
        total_unique_units: totalUnique,
        total_duplicates_removed: totalDuplicates,
        dedup_ratio: totalRaw > 0 ? `${Math.round((totalDuplicates / totalRaw) * 100)}%` : "0%",
        sources_analyzed: ["narrative_judge_results", "video_cta_events", "cta_deep_analysis", "block_verbal_analysis"],
      },
      per_function: perFunction,
      collapsed_groups: groupExamples,
      total_groups: allGroups.length,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
