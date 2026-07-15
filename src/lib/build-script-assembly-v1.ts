import { supabase } from "@/integrations/supabase/client";
import { loadLatestGenerationContext } from "./build-generation-context-v1";

export interface ScriptBlock {
  index: number;
  block_type: string;
  narrative_function: string;
  position_role: string;
  expected_position_pct: number | null;
  is_required: boolean;
  text_content: string | null;
  text_status: "empty" | "draft" | "final";
  assembly_ready: boolean;
}

export interface ScriptAssemblyV1 {
  id?: string;
  created_at?: string;
  source_generation_context_id: string | null;
  assembly_name: string;
  script_blocks: ScriptBlock[];
  block_count_expected: number | null;
  assembly_rules: string[];
  status: "ready" | "incomplete" | "no_data";
  status_reason: string;
}

export async function buildScriptAssemblyV1(): Promise<ScriptAssemblyV1> {
  const gen = await loadLatestGenerationContext();

  if (!gen) {
    return {
      source_generation_context_id: null,
      assembly_name: "Script Assembly V1",
      script_blocks: [],
      block_count_expected: null,
      assembly_rules: [],
      status: "no_data",
      status_reason: "Sem Generation Context disponível",
    };
  }

  const slots = (gen.slot_sequence as any[]) ?? [];

  if (gen.status !== "ready") {
    return {
      source_generation_context_id: gen.id,
      assembly_name: "Script Assembly V1",
      script_blocks: [],
      block_count_expected: null,
      assembly_rules: [],
      status: "incomplete",
      status_reason: "Generation Context ainda não está READY",
    };
  }

  const blocks: ScriptBlock[] = slots.map((slot) => {
    const hasType = !!slot.slot_type;
    const hasFn = !!slot.narrative_function;
    const hasRole = !!slot.position_role;
    return {
      index: slot.index,
      block_type: slot.slot_type,
      narrative_function: slot.narrative_function ?? "",
      position_role: slot.position_role ?? "middle",
      expected_position_pct: slot.expected_position_pct ?? null,
      is_required: slot.is_required ?? false,
      text_content: null,
      text_status: "empty" as const,
      assembly_ready: hasType && hasFn && hasRole,
    };
  });

  const rules: string[] = [
    "Cada bloco deve receber conteúdo textual coerente com sua função",
    "Blocos obrigatórios devem ser preenchidos antes dos opcionais",
    "Hook deve ser preenchido antes da progressão narrativa",
    "Payoff deve ser preenchido antes da validação final",
    "A ordem dos blocos não pode ser alterada",
    "Blocos não podem permanecer vazios após geração final",
  ];

  const genName = (gen as any).generation_name || "";
  const assemblyName = genName
    ? `Script Assembly — ${genName}`
    : "Script Assembly V1";

  const isReady = blocks.length > 0;

  return {
    source_generation_context_id: gen.id,
    assembly_name: assemblyName,
    script_blocks: blocks,
    block_count_expected: blocks.length || null,
    assembly_rules: rules,
    status: isReady ? "ready" : "incomplete",
    status_reason: isReady ? "Todos os blocos estruturais presentes" : "Blocos ainda não preenchidos",
  };
}

export async function saveScriptAssembly(obj: ScriptAssemblyV1) {
  const { data, error } = await supabase
    .from("script_assemblies")
    .insert({
      source_generation_context_id: obj.source_generation_context_id,
      assembly_name: obj.assembly_name,
      script_blocks: obj.script_blocks as any,
      block_count_expected: obj.block_count_expected,
      assembly_rules: obj.assembly_rules as any,
      status: obj.status,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function loadLatestScriptAssembly() {
  const { data, error } = await supabase
    .from("script_assemblies")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function updateScriptBlockText(
  assemblyId: string,
  blockIndex: number,
  newTextContent: string | null,
  newTextStatus: "empty" | "draft" | "final"
) {
  const { data: current, error: fetchErr } = await supabase
    .from("script_assemblies")
    .select("script_blocks")
    .eq("id", assemblyId)
    .single();

  if (fetchErr) throw fetchErr;

  const blocks = (current.script_blocks as unknown as ScriptBlock[]) ?? [];
  const updated = blocks.map((b) =>
    b.index === blockIndex ? { ...b, text_content: newTextContent, text_status: newTextStatus } : b
  );

  const { error: updateErr } = await supabase
    .from("script_assemblies")
    .update({ script_blocks: updated as any })
    .eq("id", assemblyId);

  if (updateErr) throw updateErr;
  return updated;
}

export async function checkAssemblyOutdated(sourceGenId: string | null): Promise<boolean> {
  if (!sourceGenId) return false;
  const { data } = await supabase
    .from("generation_contexts")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (!data) return false;
  return data.id !== sourceGenId;
}
