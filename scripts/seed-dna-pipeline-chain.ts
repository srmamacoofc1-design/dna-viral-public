/**
 * Cria/atualiza uma cadeia DNA -> Template -> Blueprint a partir de um
 * Preset DNA já consolidado. Não chama IA e não lê/copía texto de roteiro.
 *
 * Variáveis obrigatórias:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Seleção do preset (opcional, nesta ordem):
 *   DNA_PRESET_ID
 *   DNA_PRESET_NAME
 *   sem ambos: usa o preset DNA ativo atualizado mais recentemente
 *
 * Segurança:
 *   DNA_CHAIN_DRY_RUN=1 valida toda a evidência sem gravar.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "../src/integrations/supabase/types";
import type { DnaStylePack } from "../src/lib/dna-style-pack";
import {
  buildDeterministicDnaChain,
  type DnaChainBlockEvidence,
  type DnaChainCtaEvidence,
  type DnaChainVideoEvidence,
} from "../src/lib/deterministic-dna-chain";

function requiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

function parseBoolean(value: string | undefined): boolean {
  return /^(1|true|yes)$/i.test(value?.trim() ?? "");
}

const supabaseUrl = requiredEnv("SUPABASE_URL");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const parsedUrl = new URL(supabaseUrl);
if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error("SUPABASE_URL precisa usar HTTP(S)");

const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

const presetId = process.env.DNA_PRESET_ID?.trim();
const presetName = process.env.DNA_PRESET_NAME?.trim();
const dryRun = parseBoolean(process.env.DNA_CHAIN_DRY_RUN);

let presetQuery = supabase
  .from("dataset_cohort")
  .select("id, cohort_name, video_ids, rules_json, active, updated_at")
  .eq("cohort_type", "dna_preset");

if (presetId) {
  presetQuery = presetQuery.eq("id", presetId);
} else if (presetName) {
  presetQuery = presetQuery.eq("cohort_name", presetName);
} else {
  presetQuery = presetQuery.eq("active", true);
}

const { data: presetRows, error: presetError } = await presetQuery
  .order("updated_at", { ascending: false })
  .limit(1);
if (presetError) throw new Error(`Falha ao buscar Preset DNA: ${presetError.message}`);
const presetRow = presetRows?.[0];
if (!presetRow) throw new Error("Nenhum Preset DNA correspondente foi encontrado");

const videoIds = Array.isArray(presetRow.video_ids)
  ? [...new Set(presetRow.video_ids.filter((value): value is string => typeof value === "string" && value.length > 0))]
  : [];
if (videoIds.length < 3) throw new Error("O Preset DNA selecionado precisa conter pelo menos 3 vídeos distintos");
const rules = presetRow.rules_json && typeof presetRow.rules_json === "object" && !Array.isArray(presetRow.rules_json)
  ? presetRow.rules_json as Record<string, Json | undefined>
  : null;
const stylePack = rules?.style_pack as unknown as DnaStylePack | undefined;
if (!stylePack) throw new Error("Preset DNA não possui style_pack persistido");

const [videosResult, blocksResult, ctaProfilesResult, ctaAnalysisResult] = await Promise.all([
  supabase
    .from("videos")
    .select("id, status, duracao, engagement_rate, engagement_rate_relative, engagement_percentile_display, views, likes, comments, emocao_predominante, cta_type")
    .in("id", videoIds),
  supabase
    .from("video_blocks")
    .select("id, video_id, bloco_id, tipo_bloco, tempo_inicio, tempo_fim, emocao")
    .in("video_id", videoIds),
  supabase
    .from("cta_profiles")
    .select("video_id, cta_type, cta_position_seconds")
    .in("video_id", videoIds),
  supabase
    .from("cta_deep_analysis")
    .select("video_id, cta_type")
    .in("video_id", videoIds),
]);

for (const [label, result] of [
  ["videos", videosResult],
  ["video_blocks", blocksResult],
  ["cta_profiles", ctaProfilesResult],
  ["cta_deep_analysis", ctaAnalysisResult],
] as const) {
  if (result.error) throw new Error(`Falha ao ler ${label}: ${result.error.message}`);
}

const ctas: DnaChainCtaEvidence[] = [
  ...(ctaProfilesResult.data ?? []),
  ...(ctaAnalysisResult.data ?? []).map((row) => ({
    video_id: row.video_id,
    cta_type: row.cta_type,
    cta_position_seconds: null,
  })),
];

const chain = buildDeterministicDnaChain({
  preset: {
    id: presetRow.id,
    name: presetRow.cohort_name,
    video_ids: videoIds,
    style_pack: stylePack,
  },
  videos: (videosResult.data ?? []) as DnaChainVideoEvidence[],
  blocks: (blocksResult.data ?? []) as DnaChainBlockEvidence[],
  ctas,
});

if (dryRun) {
  console.log(JSON.stringify({
    ok: true,
    dry_run: true,
    preset_name: presetRow.cohort_name,
    source_scope: chain.source_scope,
    statuses: { dna: chain.dna.status, template: chain.template.status, blueprint: chain.blueprint.status },
    audit: chain.audit,
  }, null, 2));
  process.exit(0);
}

const { data: existingDnaRows, error: existingDnaError } = await supabase
  .from("dna_objects")
  .select("id")
  .eq("source_scope", chain.source_scope)
  .order("created_at", { ascending: true })
  .limit(1);
if (existingDnaError) throw new Error(`Falha ao localizar DNA existente: ${existingDnaError.message}`);

const existingDnaId = existingDnaRows?.[0]?.id;
const dnaWrite = existingDnaId
  ? await supabase.from("dna_objects").update(chain.dna).eq("id", existingDnaId).select("id, status, source_scope").single()
  : await supabase.from("dna_objects").insert(chain.dna).select("id, status, source_scope").single();
if (dnaWrite.error || !dnaWrite.data) throw new Error(`Falha ao persistir DNA: ${dnaWrite.error?.message ?? "sem retorno"}`);
const dna = dnaWrite.data;

const { data: existingTemplateRows, error: existingTemplateError } = await supabase
  .from("template_contexts")
  .select("id")
  .eq("source_dna_object_id", dna.id)
  .eq("template_name", chain.template_name)
  .order("created_at", { ascending: true })
  .limit(1);
if (existingTemplateError) throw new Error(`Falha ao localizar Template existente: ${existingTemplateError.message}`);

const templatePayload = { ...chain.template, source_dna_object_id: dna.id };
const existingTemplateId = existingTemplateRows?.[0]?.id;
const templateWrite = existingTemplateId
  ? await supabase.from("template_contexts").update(templatePayload).eq("id", existingTemplateId).select("id, status, source_dna_object_id").single()
  : await supabase.from("template_contexts").insert(templatePayload).select("id, status, source_dna_object_id").single();
if (templateWrite.error || !templateWrite.data) {
  throw new Error(`Falha ao persistir Template: ${templateWrite.error?.message ?? "sem retorno"}`);
}
const template = templateWrite.data;

const { data: existingBlueprintRows, error: existingBlueprintError } = await supabase
  .from("blueprint_contexts")
  .select("id")
  .eq("source_template_context_id", template.id)
  .eq("blueprint_name", chain.blueprint_name)
  .order("created_at", { ascending: true })
  .limit(1);
if (existingBlueprintError) throw new Error(`Falha ao localizar Blueprint existente: ${existingBlueprintError.message}`);

const blueprintPayload = { ...chain.blueprint, source_template_context_id: template.id };
const existingBlueprintId = existingBlueprintRows?.[0]?.id;
const blueprintWrite = existingBlueprintId
  ? await supabase.from("blueprint_contexts").update(blueprintPayload).eq("id", existingBlueprintId).select("id, status, source_template_context_id").single()
  : await supabase.from("blueprint_contexts").insert(blueprintPayload).select("id, status, source_template_context_id").single();
if (blueprintWrite.error || !blueprintWrite.data) {
  throw new Error(`Falha ao persistir Blueprint: ${blueprintWrite.error?.message ?? "sem retorno"}`);
}
const blueprint = blueprintWrite.data;

if (
  dna.status !== "ready"
  || template.status !== "ready"
  || blueprint.status !== "ready"
  || template.source_dna_object_id !== dna.id
  || blueprint.source_template_context_id !== template.id
) {
  throw new Error("Verificação pós-gravação falhou: cadeia não está integralmente ligada e pronta");
}

console.log(JSON.stringify({
  ok: true,
  dry_run: false,
  preset_name: presetRow.cohort_name,
  actions: {
    dna: existingDnaId ? "updated" : "inserted",
    template: existingTemplateId ? "updated" : "inserted",
    blueprint: existingBlueprintId ? "updated" : "inserted",
  },
  chain: {
    dna_id: dna.id,
    template_id: template.id,
    blueprint_id: blueprint.id,
    status: "ready",
  },
  audit: chain.audit,
}, null, 2));
