import { supabase } from "@/integrations/supabase/client";
import { loadLatestTemplateContext } from "./build-template-context-v1";
import { formatSequence } from "./format-blocks";

export interface BlueprintBlock {
  index: number;
  block_type: string;
  is_required: boolean;
}

export interface BlueprintContextV1 {
  id?: string;
  created_at?: string;
  source_template_context_id: string | null;
  blueprint_name: string;
  block_sequence: BlueprintBlock[];
  block_count_expected: number | null;
  hook_expected_position_pct: number | null;
  payoff_expected_position_pct: number | null;
  cta_expected_position_seconds: number | null;
  hook_position_tolerance_pct: number | null;
  payoff_position_tolerance_pct: number | null;
  cta_position_tolerance_seconds: number | null;
  dominant_emotion: string | null;
  dominant_cta_type: string | null;
  blueprint_rules: string[];
  status: "ready" | "incomplete" | "no_data";
}

/** Reverse map: display name / abbreviation → raw DB value */
const DISPLAY_TO_RAW: Record<string, string> = {
  hook: "hook",
  setup: "setup",
  tensão: "tensao",
  tensao: "tensao",
  desenvolvimento: "desenvolvimento",
  revelação: "revelacao",
  revelacao: "revelacao",
  payoff: "payoff",
  transição: "transicao",
  transicao: "transicao",
  loop: "loop",
  // abbreviations
  hoo: "hook",
  set: "setup",
  ten: "tensao",
  des: "desenvolvimento",
  rev: "revelacao",
  pay: "payoff",
  tra: "transicao",
  loo: "loop",
};

function toRawBlockType(token: string): string {
  const lower = token.toLowerCase();
  return DISPLAY_TO_RAW[lower] ?? lower;
}

function parseSequenceToRawTypes(seq: string): string[] {
  return seq
    .split(/\s*→\s*/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(toRawBlockType);
}

export async function buildBlueprintContextV1(): Promise<BlueprintContextV1> {
  const tpl = await loadLatestTemplateContext();

  if (!tpl) {
    return {
      source_template_context_id: null,
      blueprint_name: "Blueprint V1",
      block_sequence: [],
      block_count_expected: null,
      hook_expected_position_pct: null,
      payoff_expected_position_pct: null,
      cta_expected_position_seconds: null,
      hook_position_tolerance_pct: null,
      payoff_position_tolerance_pct: null,
      cta_position_tolerance_seconds: null,
      dominant_emotion: null,
      dominant_cta_type: null,
      blueprint_rules: [],
      status: "no_data",
    };
  }

  const requiredBlocks = (tpl.required_blocks as string[]) ?? [];
  const optionalBlocks = (tpl.optional_blocks as string[]) ?? [];
  const dominantSequence = tpl.dominant_sequence;

  // --- CORREÇÃO 1 & 5: Build block_sequence using RAW names ---
  const sequence: BlueprintBlock[] = [];
  const usedTypes = new Set<string>();

  // Step A: Add blocks from dominant_sequence
  if (dominantSequence) {
    const rawTypes = parseSequenceToRawTypes(dominantSequence);
    rawTypes.forEach((bt) => {
      if (!usedTypes.has(bt)) {
        sequence.push({
          index: 0, // will be re-indexed
          block_type: bt,
          is_required: requiredBlocks.includes(bt),
        });
        usedTypes.add(bt);
      }
    });
  }

  // Step B: Ensure ALL required_blocks are present (CORREÇÃO 1)
  requiredBlocks.forEach((bt) => {
    if (!usedTypes.has(bt)) {
      sequence.push({
        index: 0,
        block_type: bt,
        is_required: true,
      });
      usedTypes.add(bt);
    }
  });

  // Step C: Append optional blocks not already present
  optionalBlocks.forEach((bt) => {
    if (!usedTypes.has(bt)) {
      sequence.push({
        index: 0,
        block_type: bt,
        is_required: false,
      });
      usedTypes.add(bt);
    }
  });

  // --- CORREÇÃO 2: Re-index continuously ---
  sequence.forEach((block, i) => {
    block.index = i + 1;
  });

  // --- CORREÇÃO 3: block_count_expected = sequence.length ---
  const blockCountExpected = sequence.length > 0 ? sequence.length : null;

  // --- Compute real tolerances from DB data ---
  // Fetch stddev of hook/payoff positions to derive tolerances
  let hookTolerance: number | null = null;
  let payoffTolerance: number | null = null;
  let ctaTolerance: number | null = null;

  try {
    // Use real position variation from videos to compute tolerance
    const { data: hookBlocks } = await supabase
      .from("video_blocks")
      .select("tempo_inicio, video_id")
      .eq("tipo_bloco", "hook");
    
    if (hookBlocks && hookBlocks.length > 1) {
      const { data: videos } = await supabase
        .from("videos")
        .select("id, duracao")
        .eq("status", "completed");
      
      if (videos && videos.length > 0) {
        const durationMap = Object.fromEntries(videos.map(v => [v.id, Number(v.duracao) || 0]));
        const hookPcts = hookBlocks
          .map(b => {
            const dur = durationMap[b.video_id];
            return dur > 0 ? (Number(b.tempo_inicio) / dur) * 100 : null;
          })
          .filter((v): v is number => v !== null);
        
        if (hookPcts.length > 1) {
          const mean = hookPcts.reduce((a, b) => a + b, 0) / hookPcts.length;
          const variance = hookPcts.reduce((sum, v) => sum + (v - mean) ** 2, 0) / hookPcts.length;
          hookTolerance = Math.round(Math.sqrt(variance) * 10) / 10;
        }

        // Payoff
        const { data: payoffBlocks } = await supabase
          .from("video_blocks")
          .select("tempo_inicio, video_id")
          .eq("tipo_bloco", "payoff");
        
        if (payoffBlocks && payoffBlocks.length > 1) {
          const payoffPcts = payoffBlocks
            .map(b => {
              const dur = durationMap[b.video_id];
              return dur > 0 ? (Number(b.tempo_inicio) / dur) * 100 : null;
            })
            .filter((v): v is number => v !== null);
          
          if (payoffPcts.length > 1) {
            const mean = payoffPcts.reduce((a, b) => a + b, 0) / payoffPcts.length;
            const variance = payoffPcts.reduce((sum, v) => sum + (v - mean) ** 2, 0) / payoffPcts.length;
            payoffTolerance = Math.round(Math.sqrt(variance) * 10) / 10;
          }
        }
      }
    }

    // CTA tolerance from real data
    const { data: ctaPositions } = await supabase
      .from("cta_profiles")
      .select("cta_position_seconds")
      .not("cta_position_seconds", "is", null);
    
    if (ctaPositions && ctaPositions.length > 1) {
      const vals = ctaPositions.map(c => Number(c.cta_position_seconds));
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance = vals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / vals.length;
      ctaTolerance = Math.round(Math.sqrt(variance) * 10) / 10;
    }
  } catch { /* non-critical — tolerances stay null */ }

  // Rules — only from real data
  const rules: string[] = [];
  if (dominantSequence) rules.push("Block order must follow dominant sequence");
  if (tpl.hook_position_pct != null && hookTolerance != null) {
    rules.push(`Hook must appear near ${tpl.hook_position_pct}% of the video (±${hookTolerance}%)`);
  } else if (tpl.hook_position_pct != null) {
    rules.push(`Hook must appear near ${tpl.hook_position_pct}% (tolerance not calculated — insufficient data)`);
  }
  if (tpl.payoff_position_pct != null && payoffTolerance != null) {
    rules.push(`Payoff must appear near ${tpl.payoff_position_pct}% of the video (±${payoffTolerance}%)`);
  } else if (tpl.payoff_position_pct != null) {
    rules.push(`Payoff must appear near ${tpl.payoff_position_pct}% (tolerance not calculated — insufficient data)`);
  }
  if (tpl.cta_position_seconds != null && ctaTolerance != null) {
    rules.push(`CTA must appear near ${tpl.cta_position_seconds}s (±${ctaTolerance}s)`);
  } else if (tpl.cta_position_seconds != null) {
    rules.push(`CTA must appear near ${tpl.cta_position_seconds}s (tolerance not calculated — insufficient data)`);
  }
  if (tpl.dominant_cta_type) rules.push(`CTA must follow dominant type: ${tpl.dominant_cta_type}`);
  if (tpl.dominant_emotion) rules.push(`Dominant emotion should be: ${tpl.dominant_emotion}`);
  rules.push("All required blocks must be present in the script");

  // --- CORREÇÃO 6: Stricter status ---
  const isReady =
    sequence.length > 0 &&
    requiredBlocks.length > 0 &&
    tpl.dominant_emotion != null &&
    tpl.hook_position_pct != null &&
    tpl.payoff_position_pct != null;

  const status: BlueprintContextV1["status"] = isReady ? "ready" : "incomplete";

  // Name
  const formatted = formatSequence(dominantSequence);
  const blueprintName = formatted ? `Blueprint ${formatted} V1` : "Blueprint V1";

  return {
    source_template_context_id: tpl.id,
    blueprint_name: blueprintName,
    block_sequence: sequence,
    block_count_expected: blockCountExpected,
    hook_expected_position_pct: tpl.hook_position_pct,
    payoff_expected_position_pct: tpl.payoff_position_pct,
    cta_expected_position_seconds: tpl.cta_position_seconds,
    hook_position_tolerance_pct: hookTolerance,
    payoff_position_tolerance_pct: payoffTolerance,
    cta_position_tolerance_seconds: ctaTolerance,
    dominant_emotion: tpl.dominant_emotion,
    dominant_cta_type: tpl.dominant_cta_type,
    blueprint_rules: rules,
    status,
  };
}

export async function saveBlueprintContext(obj: BlueprintContextV1) {
  const { data, error } = await supabase
    .from("blueprint_contexts")
    .insert({
      source_template_context_id: obj.source_template_context_id,
      blueprint_name: obj.blueprint_name,
      block_sequence: obj.block_sequence as any,
      block_count_expected: obj.block_count_expected,
      hook_expected_position_pct: obj.hook_expected_position_pct,
      payoff_expected_position_pct: obj.payoff_expected_position_pct,
      cta_expected_position_seconds: obj.cta_expected_position_seconds,
      hook_position_tolerance_pct: obj.hook_position_tolerance_pct,
      payoff_position_tolerance_pct: obj.payoff_position_tolerance_pct,
      cta_position_tolerance_seconds: obj.cta_position_tolerance_seconds,
      dominant_emotion: obj.dominant_emotion,
      dominant_cta_type: obj.dominant_cta_type,
      blueprint_rules: obj.blueprint_rules as any,
      status: obj.status,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function loadLatestBlueprintContext() {
  const { data, error } = await supabase
    .from("blueprint_contexts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}
