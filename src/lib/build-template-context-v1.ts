import { supabase } from "@/integrations/supabase/client";
import { loadLatestDNAObject } from "./build-dna-object-v1";

export interface TemplateContextV1 {
  id?: string;
  created_at?: string;
  source_dna_object_id: string | null;
  template_name: string;
  dominant_sequence: string | null;
  required_blocks: string[];
  optional_blocks: string[];
  hook_position_pct: number | null;
  payoff_position_pct: number | null;
  cta_position_seconds: number | null;
  dominant_emotion: string | null;
  secondary_emotion: string | null;
  dominant_cta_type: string | null;
  avg_block_count: number | null;
  avg_video_duration: number | null;
  template_rules: string[];
  notes: string | null;
  status: "ready" | "incomplete" | "no_data";
}

export async function buildTemplateContextV1(): Promise<TemplateContextV1> {
  const dna = await loadLatestDNAObject();

  if (!dna) {
    return {
      source_dna_object_id: null,
      template_name: "Template V1",
      dominant_sequence: null,
      required_blocks: [],
      optional_blocks: [],
      hook_position_pct: null,
      payoff_position_pct: null,
      cta_position_seconds: null,
      dominant_emotion: null,
      secondary_emotion: null,
      dominant_cta_type: null,
      avg_block_count: null,
      avg_video_duration: null,
      template_rules: [],
      notes: null,
      status: "no_data",
    };
  }

  const requiredBlocks = (dna.required_blocks as string[]) ?? [];
  const optionalBlocks = (dna.optional_blocks as string[]) ?? [];
  const dominantSequence = dna.dominant_sequence;
  const hookPct = dna.avg_hook_time;
  const payoffPct = dna.avg_payoff_time;
  const ctaSec = dna.avg_cta_time;
  const dominantEmotion = dna.dominant_emotion;
  const dominantCtaType = dna.dominant_cta_type;

  // Build simple text rules from DNA data
  const rules: string[] = [];
  if (requiredBlocks.length > 0)
    rules.push(`Required blocks must be present: ${requiredBlocks.join(", ")}`);
  if (optionalBlocks.length > 0)
    rules.push(`Optional blocks may appear: ${optionalBlocks.join(", ")}`);
  if (dominantSequence)
    rules.push(`Dominant sequence should be preserved: ${dominantSequence}`);
  if (hookPct != null)
    rules.push(`Hook should happen near ${hookPct}% of the video`);
  if (payoffPct != null)
    rules.push(`Payoff should happen near ${payoffPct}% of the video`);
  if (ctaSec != null)
    rules.push(`CTA should happen near ${ctaSec}s`);
  if (dominantEmotion)
    rules.push(`Dominant emotion should be: ${dominantEmotion}`);
  if (dominantCtaType)
    rules.push(`CTA type should follow: ${dominantCtaType}`);

  // Status
  let status: TemplateContextV1["status"];
  if (
    dominantSequence != null &&
    requiredBlocks.length > 0 &&
    dominantEmotion != null
  ) {
    status = "ready";
  } else {
    status = "incomplete";
  }

  return {
    source_dna_object_id: dna.id,
    template_name: "Template V1",
    dominant_sequence: dominantSequence,
    required_blocks: requiredBlocks,
    optional_blocks: optionalBlocks,
    hook_position_pct: hookPct,
    payoff_position_pct: payoffPct,
    cta_position_seconds: ctaSec,
    dominant_emotion: dominantEmotion,
    secondary_emotion: dna.secondary_emotion,
    dominant_cta_type: dominantCtaType,
    avg_block_count: dna.avg_block_count,
    avg_video_duration: dna.avg_video_duration,
    template_rules: rules,
    notes: null,
    status,
  };
}

export async function saveTemplateContext(obj: TemplateContextV1) {
  const { data, error } = await supabase
    .from("template_contexts")
    .insert({
      source_dna_object_id: obj.source_dna_object_id,
      template_name: obj.template_name,
      dominant_sequence: obj.dominant_sequence,
      required_blocks: obj.required_blocks,
      optional_blocks: obj.optional_blocks,
      hook_position_pct: obj.hook_position_pct,
      payoff_position_pct: obj.payoff_position_pct,
      cta_position_seconds: obj.cta_position_seconds,
      dominant_emotion: obj.dominant_emotion,
      secondary_emotion: obj.secondary_emotion,
      dominant_cta_type: obj.dominant_cta_type,
      avg_block_count: obj.avg_block_count,
      avg_video_duration: obj.avg_video_duration,
      template_rules: obj.template_rules,
      notes: obj.notes,
      status: obj.status,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function loadLatestTemplateContext() {
  const { data, error } = await supabase
    .from("template_contexts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function loadTemplateContextById(templateId: string) {
  const { data, error } = await supabase
    .from("template_contexts")
    .select("*")
    .eq("id", templateId)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}
