import { supabase } from "@/integrations/supabase/client";
import { loadLatestBlueprintContext, type BlueprintBlock } from "./build-blueprint-context-v1";
import { formatSequence } from "./format-blocks";

export interface GenerationSlot {
  index: number;
  slot_type: string;
  narrative_function: string;
  position_role: string;
  expected_position_pct: number | null;
  is_required: boolean;
  generation_ready: boolean;
}

export interface GenerationContextV1 {
  id?: string;
  created_at?: string;
  source_blueprint_id: string | null;
  generation_name: string;
  slot_sequence: GenerationSlot[];
  slot_count_expected: number | null;
  generation_rules: string[];
  status: "ready" | "incomplete" | "no_data";
}

/* ── Narrative function: derived from DB funcao_narrativa field ── */

async function fetchNarrativeFunctionMap(): Promise<Record<string, string>> {
  const { data } = await supabase
    .from("video_blocks")
    .select("tipo_bloco, funcao_narrativa")
    .not("funcao_narrativa", "is", null);
  
  if (!data || data.length === 0) return {};

  // Build map: for each block type, find the most common funcao_narrativa
  const typeMap: Record<string, Record<string, number>> = {};
  data.forEach((b) => {
    if (!b.funcao_narrativa) return;
    if (!typeMap[b.tipo_bloco]) typeMap[b.tipo_bloco] = {};
    typeMap[b.tipo_bloco][b.funcao_narrativa] = (typeMap[b.tipo_bloco][b.funcao_narrativa] || 0) + 1;
  });

  const result: Record<string, string> = {};
  Object.entries(typeMap).forEach(([type, counts]) => {
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (sorted[0]) result[type] = sorted[0][0];
  });

  return result;
}

/* ── Position role: derived from real block positions in videos ── */

async function fetchPositionRoleMap(): Promise<Record<string, string>> {
  const { data: blocks } = await supabase
    .from("video_blocks")
    .select("tipo_bloco, tempo_inicio, video_id");
  
  const { data: videos } = await supabase
    .from("videos")
    .select("id, duracao")
    .eq("status", "completed");

  if (!blocks || blocks.length === 0 || !videos || videos.length === 0) return {};

  const durationMap = Object.fromEntries(videos.map(v => [v.id, Number(v.duracao) || 0]));

  // Calculate all position percentages across all block types
  const allPositions: number[] = [];
  const typePositions: Record<string, number[]> = {};
  blocks.forEach((b) => {
    const dur = durationMap[b.video_id];
    if (!dur || dur <= 0) return;
    const pct = (Number(b.tempo_inicio) / dur) * 100;
    allPositions.push(pct);
    if (!typePositions[b.tipo_bloco]) typePositions[b.tipo_bloco] = [];
    typePositions[b.tipo_bloco].push(pct);
  });

  if (allPositions.length === 0) return {};

  // Calculate quartiles from REAL data distribution
  allPositions.sort((a, b) => a - b);
  const q25 = allPositions[Math.floor(allPositions.length * 0.25)];
  const q50 = allPositions[Math.floor(allPositions.length * 0.50)];
  const q75 = allPositions[Math.floor(allPositions.length * 0.75)];

  // Assign position roles based on real quartile boundaries
  const result: Record<string, string> = {};
  Object.entries(typePositions).forEach(([type, pcts]) => {
    const median = pcts.sort((a, b) => a - b)[Math.floor(pcts.length / 2)];
    if (median <= q25) result[type] = "opening";
    else if (median <= q50) result[type] = "middle";
    else if (median <= q75) result[type] = "late";
    else result[type] = "closing";
  });

  return result;
}

function getNarrativeFunction(blockType: string, map: Record<string, string>): string {
  return map[blockType] ?? `${blockType} (função não identificada na base)`;
}

function getPositionRole(blockType: string, map: Record<string, string>): string {
  return map[blockType] ?? `unknown (posição não calculada)`;
}

export async function buildGenerationContextV1(): Promise<GenerationContextV1> {
  const bp = await loadLatestBlueprintContext();

  if (!bp || bp.status === "no_data") {
    return {
      source_blueprint_id: null,
      generation_name: "Generation V1",
      slot_sequence: [],
      slot_count_expected: null,
      generation_rules: [],
      status: "no_data",
    };
  }

  // Fetch real mappings from DB
  const [narrativeFnMap, positionRoleMap] = await Promise.all([
    fetchNarrativeFunctionMap(),
    fetchPositionRoleMap(),
  ]);

  const blocks = (bp.block_sequence as unknown as BlueprintBlock[]) ?? [];

  const slots: GenerationSlot[] = blocks.map((block) => {
    let positionPct: number | null = null;
    if (block.block_type === "hook" && bp.hook_expected_position_pct != null) {
      positionPct = Number(bp.hook_expected_position_pct);
    } else if (block.block_type === "payoff" && bp.payoff_expected_position_pct != null) {
      positionPct = Number(bp.payoff_expected_position_pct);
    }

    const narrativeFn = getNarrativeFunction(block.block_type, narrativeFnMap);
    return {
      index: block.index,
      slot_type: block.block_type,
      narrative_function: narrativeFn,
      position_role: getPositionRole(block.block_type, positionRoleMap),
      expected_position_pct: positionPct,
      is_required: block.is_required,
      generation_ready: !!block.block_type && !!narrativeFn,
    };
  });

  const rules: string[] = [
    "Sequência narrativa deve seguir ordem definida",
    "Cada slot deve ser preenchido respeitando sua função narrativa",
    "Slots obrigatórios devem receber conteúdo",
    "Hook e Payoff devem respeitar posição esperada",
    "A ordem dos slots não pode ser alterada",
    "Slots devem ser preenchidos antes da geração final",
  ];

  const isReady = bp.status === "ready" && slots.length > 0;
  const status: GenerationContextV1["status"] = isReady ? "ready" : "incomplete";

  const seqStr = slots.map((s) => s.slot_type).join(" → ");
  const formatted = formatSequence(seqStr);
  const generationName = formatted ? `Generation ${formatted} V1` : "Generation V1";

  return {
    source_blueprint_id: bp.id,
    generation_name: generationName,
    slot_sequence: slots,
    slot_count_expected: slots.length || null,
    generation_rules: rules,
    status,
  };
}

export async function saveGenerationContext(obj: GenerationContextV1) {
  const { data, error } = await supabase
    .from("generation_contexts")
    .insert({
      source_blueprint_id: obj.source_blueprint_id,
      generation_name: obj.generation_name,
      slot_sequence: obj.slot_sequence as any,
      slot_count_expected: obj.slot_count_expected,
      generation_rules: obj.generation_rules as any,
      status: obj.status,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function loadLatestGenerationContext() {
  const { data, error } = await supabase
    .from("generation_contexts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}
