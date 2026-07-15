/**
 * DNA PRESETS — Bases DNA nomeadas e reutilizáveis
 *
 * Um preset é um subconjunto de vídeos da biblioteca ("Preset Filmes",
 * "Preset Curiosidades"...) cujo DNA consolidado — ganchos campeões,
 * ritmo, palavras ponderadas por engajamento, sequência dominante — fica
 * SALVO no banco e pode ser ativado em qualquer geração.
 *
 * Persistência: tabela existente `dataset_cohort` (RLS por proprietário) com
 * cohort_type = "dna_preset":
 *   - cohort_name  → nome do preset
 *   - video_ids    → lista explícita dos vídeos da base
 *   - rules_json   → { kind: "dna_preset", style_pack: <pacote consolidado> }
 *   - confidence_score → % dos vídeos do preset com blocos extraídos
 *
 * O pacote consolidado é o mesmo formato do DNA Style Pack
 * (ver dna-style-pack.ts) — pronto para injetar na geração.
 */
import { supabase } from "@/integrations/supabase/client";
import { buildDnaStylePack, validateDnaStylePack, type DnaStylePack, type TargetLang } from "@/lib/dna-style-pack";

export const DNA_PRESET_COHORT_TYPE = "dna_preset";

export interface DnaPreset {
  id: string;
  created_by: string | null;
  name: string;
  video_ids: string[];
  video_count: number;
  confidence_score: number | null;
  active: boolean;
  style_pack: DnaStylePack | null;
  created_at: string;
  updated_at: string;
}

function rowToPreset(row: any): DnaPreset {
  const rules = (row.rules_json as any) || {};
  return {
    id: row.id,
    created_by: row.created_by ?? null,
    name: row.cohort_name,
    video_ids: Array.isArray(row.video_ids) ? row.video_ids : [],
    video_count: row.video_count ?? 0,
    confidence_score: row.confidence_score ?? null,
    active: row.active ?? true,
    style_pack: rules.style_pack ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Consolida o DNA do conjunto e calcula a confiança (% vídeos com blocos). */
async function consolidatePreset(videoIds: string[], targetLang: TargetLang) {
  const uniqueVideoIds = [...new Set(videoIds.filter(Boolean))];
  if (uniqueVideoIds.length < 3) {
    throw new Error("Um Preset DNA v3 precisa de pelo menos 3 vídeos distintos processados");
  }
  const pack = await buildDnaStylePack(targetLang, { videoIds: uniqueVideoIds });
  if (!pack || !pack.block_styles.length) {
    throw new Error(
      "Nenhum DNA extraível dos vídeos selecionados — eles precisam estar com status 'Concluído' (processados, com blocos narrativos e engajamento).",
    );
  }
  const readiness = validateDnaStylePack(pack);
  if (!readiness.ready) {
    throw new Error(`DNA incompleto: ${readiness.reasons.join(", ")}`);
  }
  const confidence = Math.round((pack.total_videos / uniqueVideoIds.length) * 100);
  return { pack, confidence, videoIds: uniqueVideoIds };
}

/**
 * Cria um preset DNA a partir de vídeos selecionados da biblioteca.
 * Consolida imediatamente os ganchos campeões e salva tudo no banco.
 */
export async function createDnaPreset(
  name: string,
  videoIds: string[],
  targetLang: TargetLang = "pt",
): Promise<DnaPreset> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Dê um nome ao preset (ex.: Preset Filmes)");
  if (!videoIds.length) throw new Error("Selecione pelo menos 1 vídeo da biblioteca");

  const { pack, confidence, videoIds: consolidatedVideoIds } = await consolidatePreset(videoIds, targetLang);
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("Faça login novamente para salvar o preset");

  const { data, error } = await supabase
    .from("dataset_cohort")
    .insert({
      cohort_name: trimmed,
      created_by: userData.user.id,
      cohort_type: DNA_PRESET_COHORT_TYPE,
      video_ids: consolidatedVideoIds,
      video_count: consolidatedVideoIds.length,
      confidence_score: confidence,
      active: true,
      data_source_type: "derived",
      origin_level: "calculated",
      rules_json: {
        kind: "dna_preset",
        target_lang: targetLang,
        style_pack: pack,
        consolidated_at: new Date().toISOString(),
      } as any,
    })
    .select()
    .single();

  if (error) throw new Error(`Falha ao salvar preset: ${error.message}`);
  return rowToPreset(data);
}

/** Lista os presets DNA salvos (mais recentes primeiro). */
export async function listDnaPresets(): Promise<DnaPreset[]> {
  const { data, error } = await supabase
    .from("dataset_cohort")
    .select("*")
    .eq("cohort_type", DNA_PRESET_COHORT_TYPE)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(rowToPreset);
}

/** Reconsolida o DNA de um preset (ex.: após reprocessar vídeos). */
export async function rebuildDnaPreset(
  presetId: string,
  targetLang: TargetLang = "pt",
): Promise<DnaPreset> {
  const { data: row, error } = await supabase
    .from("dataset_cohort")
    .select("*")
    .eq("id", presetId)
    .single();
  if (error || !row) throw new Error(error?.message || "Preset não encontrado");

  const videoIds = Array.isArray(row.video_ids) ? (row.video_ids as string[]) : [];
  const { pack, confidence, videoIds: consolidatedVideoIds } = await consolidatePreset(videoIds, targetLang);

  const { data: updated, error: upErr } = await supabase
    .from("dataset_cohort")
    .update({
      confidence_score: confidence,
      video_ids: consolidatedVideoIds,
      video_count: consolidatedVideoIds.length,
      rules_json: {
        ...((row.rules_json as any) || {}),
        kind: "dna_preset",
        target_lang: targetLang,
        style_pack: pack,
        consolidated_at: new Date().toISOString(),
      } as any,
    })
    .eq("id", presetId)
    .select()
    .single();
  if (upErr) throw new Error(upErr.message);
  return rowToPreset(updated);
}

/** Apaga um preset DNA (não afeta os vídeos da biblioteca). */
export async function deleteDnaPreset(presetId: string): Promise<void> {
  const { error } = await supabase
    .from("dataset_cohort")
    .delete()
    .eq("id", presetId)
    .eq("cohort_type", DNA_PRESET_COHORT_TYPE);
  if (error) throw new Error(error.message);
}
