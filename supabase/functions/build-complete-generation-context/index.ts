import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  assertResourceOwner,
  EdgeAuthError,
  requireUserOrService,
} from "../_shared/edge-auth.ts";
import { resolveOperationalVideoContentProfile } from "../_shared/video-content-mode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type DnaPresetBootstrap = {
  id: string;
  name: string;
  stylePack: any;
  strategies: Record<string, any>;
};

/**
 * A v3 preset is sufficient evidence to bootstrap an operational context when
 * older, optional analysis tables are empty. Only abstract strategy fields are
 * carried forward; protected source text is never copied into slots here.
 */
function resolveDnaPresetBootstrap(row: any): DnaPresetBootstrap | null {
  const pack = row?.rules_json?.style_pack;
  if (!pack || Number(pack.version) < 3 || pack.scope !== "preset") return null;
  if (pack.strategy_contract?.fail_closed !== true) return null;
  if (!Number.isFinite(Number(pack.total_videos)) || Number(pack.total_videos) < 1) return null;
  if (typeof pack.dominant_sequence !== "string" || !pack.dominant_sequence.trim()) return null;
  const structural = pack.structural_contract;
  if (structural?.contract_type !== "abstract_narrative_order"
    || structural?.visual_chronology_priority !== true
    || structural?.literal_source_sequence_required !== false
    || structural?.fail_closed_for_video_slot_order !== true) return null;
  if (!Array.isArray(pack.block_styles) || pack.block_styles.length === 0) return null;
  const strategies: Record<string, any> = {};
  for (const block of pack.block_styles) {
    const type = typeof block?.block_type === "string" ? block.block_type.trim() : "";
    if (type && block?.strategy && typeof block.strategy === "object") {
      // Source-specific scene wording is never used to bootstrap a prompt.
      const { dominant_visual_actions: _sourceActions, ...abstractStrategy } = block.strategy;
      strategies[type] = abstractStrategy;
    }
  }
  const required = Array.isArray(pack.strategy_contract?.required_block_types)
    ? pack.strategy_contract.required_block_types
    : ["hook", "desenvolvimento", "payoff"];
  if (required.length === 0 || required.some((type: unknown) => typeof type !== "string" || !strategies[type])) return null;
  return {
    id: String(row.id),
    name: String(row.cohort_name || "Preset DNA"),
    stylePack: pack,
    strategies,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Método não permitido", error_code: "METHOD_NOT_ALLOWED" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // This function uses a service-role client and therefore bypasses RLS.
    // Authenticate before any database read and derive ownership exclusively
    // from the authenticated actor. Browser-supplied user_id is never trusted.
    const actor = await requireUserOrService({
      req,
      supabaseUrl,
      serviceRoleKey: serviceKey,
    });

    // ═══════════════════════════════════════════════════
    // 0. PARSE INPUT — ALL MODE FIELDS
    // ═══════════════════════════════════════════════════
    let inputMode: string = "video";
    let referenceVideoId: string | null = null;
    let theme: string | null = null;
    let niche: string | null = null;
    let objective: string | null = null;
    let originalScript: string | null = null;
    let preserveMeaning: boolean | null = null;
    let language: string | null = null;
    let notes: string | null = null;
    let blueprintId: string | null = null;
    let dnaPresetId: string | null = null;
    let requestUserId: string;

    const body = await req.json().catch(() => ({}));
    inputMode = typeof body?.mode === "string" ? body.mode : "video";
    referenceVideoId = typeof body?.reference_video_id === "string" && body.reference_video_id.trim()
      ? body.reference_video_id.trim()
      : null;
    theme = typeof body?.theme === "string" ? body.theme : null;
    niche = typeof body?.niche === "string" ? body.niche : null;
    objective = typeof body?.objective === "string" ? body.objective : null;
    originalScript = typeof body?.original_script === "string" ? body.original_script : null;
    preserveMeaning = typeof body?.preserve_meaning === "boolean" ? body.preserve_meaning : null;
    language = typeof body?.language === "string" ? body.language : null;
    notes = typeof body?.notes === "string" ? body.notes : null;
    blueprintId = typeof body?.blueprint_id === "string" && body.blueprint_id.trim()
      ? body.blueprint_id.trim()
      : null;
    dnaPresetId = typeof body?.dna_preset_id === "string" && body.dna_preset_id.trim()
      ? body.dna_preset_id.trim()
      : null;

    if (actor.kind === "user") {
      requestUserId = actor.userId!;
    } else {
      // Internal service-role callers have no user identity of their own. They
      // must explicitly name the target owner in an internal-only field; the
      // public user_id field is deliberately ignored for every caller.
      const internalUserId = typeof body?.internal_user_id === "string"
        ? body.internal_user_id.trim()
        : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(internalUserId)) {
        return json({
          error: "Chamada interna requer internal_user_id válido.",
          error_code: "INTERNAL_USER_ID_REQUIRED",
        }, 400);
      }
      requestUserId = internalUserId;
    }

    // Validate mode-specific required fields
    if (inputMode === "video" && !referenceVideoId) {
      return json({ status: "insufficient_data", status_reason: "Modo vídeo requer reference_video_id (upload de novo vídeo operacional)" }, 400);
    }
    if (inputMode === "theme" && !theme) {
      return json({ status: "insufficient_data", status_reason: "Modo tema requer campo 'theme'" }, 400);
    }
    if (inputMode === "transform" && !originalScript) {
      return json({ status: "insufficient_data", status_reason: "Modo transform requer campo 'original_script'" }, 400);
    }

    // ═══════════════════════════════════════════════════
    // 1. LOAD BLUEPRINT (with resolution trace)
    // ═══════════════════════════════════════════════════
    let blueprint: any = null;
    let blueprintResolutionMode = "fallback_latest";
    let blueprintResolutionReason = "Nenhum blueprint_id fornecido, usando mais recente";

    if (blueprintId) {
      const { data } = await sb.from("blueprint_contexts").select("*").eq("id", blueprintId).single();
      blueprint = data;
      blueprintResolutionMode = "explicit";
      blueprintResolutionReason = "blueprint_id fornecido explicitamente no payload";
    } else {
      const { data } = await sb.from("blueprint_contexts").select("*").order("created_at", { ascending: false }).limit(1).single();
      blueprint = data;
    }

    if (!blueprint || blueprint.status === "no_data") {
      return json({
        status: "no_data",
        status_reason: !blueprint
          ? "Nenhum Blueprint encontrado na base"
          : "Blueprint sem dados",
        generation_context: null,
      });
    }

    // ═══════════════════════════════════════════════════
    // A v3 preset is a first-class viral base. Legacy global analysis tables
    // enrich a run, but a valid selected/shared preset is enough to build an
    // operational context because its strategy profiles are consolidated.
    // This also makes "Base Global" usable for every authenticated account.
    let dnaPresetBootstrap: DnaPresetBootstrap | null = null;
    let dnaPresetResolutionMode: "explicit" | "shared_default" | "none" = dnaPresetId
      ? "explicit"
      : "shared_default";
    let selectedDnaPresetRow: any = null;

    if (dnaPresetId) {
      const { data, error } = await sb
        .from("dataset_cohort")
        .select("id, cohort_name, cohort_type, active, created_by, rules_json")
        .eq("id", dnaPresetId)
        .maybeSingle();
      if (error) throw error;
      selectedDnaPresetRow = data;
    } else {
      const { data, error } = await sb
        .from("dataset_cohort")
        .select("id, cohort_name, cohort_type, active, created_by, rules_json")
        .eq("cohort_type", "dna_preset")
        .eq("active", true)
        .is("created_by", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      selectedDnaPresetRow = data;
    }

    if (selectedDnaPresetRow) {
      const isSharedPreset = selectedDnaPresetRow.created_by == null;
      const isOwnedPreset = selectedDnaPresetRow.created_by === requestUserId;
      const eligible = (isSharedPreset || isOwnedPreset)
        && selectedDnaPresetRow.cohort_type === "dna_preset"
        && selectedDnaPresetRow.active === true;
      if (!eligible && dnaPresetId) {
        // Do not disclose whether a private preset exists for another user.
        return json({
          status: "insufficient_data",
          status_reason: "Preset DNA nÃ£o encontrado ou indisponÃ­vel para esta conta.",
          error_code: "DNA_PRESET_UNAVAILABLE",
        }, 404);
      }
      if (eligible) {
        dnaPresetBootstrap = resolveDnaPresetBootstrap(selectedDnaPresetRow);
        if (!dnaPresetBootstrap && dnaPresetId) {
          return json({
            status: "insufficient_data",
            status_reason: "O Preset DNA selecionado nÃ£o possui contrato v3 pronto para geraÃ§Ã£o.",
            error_code: "DNA_PRESET_NOT_READY",
          }, 400);
        }
      }
    } else if (dnaPresetId) {
      return json({
        status: "insufficient_data",
        status_reason: "Preset DNA nÃ£o encontrado ou indisponÃ­vel para esta conta.",
        error_code: "DNA_PRESET_UNAVAILABLE",
      }, 404);
    }
    if (!dnaPresetBootstrap) dnaPresetResolutionMode = "none";

    // 2. LOAD DNA FORMAL
    // ═══════════════════════════════════════════════════
    const { data: dnaFormal } = await sb.from("dna_base_v2_formal").select("*").order("created_at", { ascending: false }).limit(1).single();

    // ═══════════════════════════════════════════════════
    // 3. MODE-SPECIFIC: LOAD VIDEO REFERENCE (video mode)
    // ═══════════════════════════════════════════════════
    let referenceVideoData: any = null;
    const videoTablesUsed: string[] = [];

    if (inputMode === "video") {
      // ONLY uploaded reference videos — never from base viral
      if (referenceVideoId) {
        // Resolve elevated access before the query can load private transcript
        // or visual frames. A regular user's query is constrained by owner at
        // the SQL level, so a foreign UUID is indistinguishable from a missing
        // UUID and cannot disclose either existence or processing state.
        let canReadAnyReference = actor.kind === "service";
        if (actor.kind === "user") {
          const { data: isAdmin, error: roleError } = await sb.rpc("has_role", {
            _user_id: actor.userId,
            _role: "admin",
          });
          if (roleError) {
            throw new EdgeAuthError(
              "ROLE_CHECK_FAILED",
              "Não foi possível validar sua permissão de administrador.",
              503,
            );
          }
          canReadAnyReference = isAdmin === true;
        }

        let referenceQuery = sb
          .from("reference_videos")
          .select("id, user_id, status, file_name, duration_seconds, transcription, transcription_segments, frames")
          .eq("id", referenceVideoId);
        if (!canReadAnyReference) {
          referenceQuery = referenceQuery.eq("user_id", requestUserId);
        }
        const { data: refVid, error: referenceError } = await referenceQuery.maybeSingle();

        if (referenceError) throw referenceError;
        if (!refVid) {
          return json({
            status: "insufficient_data",
            status_reason: "Vídeo de referência não encontrado",
          }, 404);
        }
        // A service-role caller names the owner that will receive the durable
        // generation context. Elevated read access must not allow a private
        // reference owned by somebody else to be copied into that context.
        if (actor.kind === "service" && refVid.user_id !== requestUserId) {
          return json({
            status: "insufficient_data",
            status_reason: "Vídeo de referência não encontrado",
          }, 404);
        }
        if (!canReadAnyReference) assertResourceOwner(actor, refVid.user_id);

        if (refVid.status === "ready") {
          referenceVideoData = refVid;
          videoTablesUsed.push("reference_videos");
        } else {
          return json({
            status: "insufficient_data",
            status_reason: `Vídeo de referência ainda não foi processado (status: ${refVid.status})`,
          }, 400);
        }
      }
    }

    // ═══════════════════════════════════════════════════
    // 3b. MODE-SPECIFIC: ANALYZE ORIGINAL SCRIPT (transform mode)
    // ═══════════════════════════════════════════════════
    let sourceTextAnalysis: any = null;
    if (inputMode === "transform" && originalScript) {
      const lines = originalScript.split(/\n/).filter((l: string) => l.trim().length > 0);
      const words = originalScript.split(/\s+/).filter(Boolean);
      const sentences = originalScript.split(/[.!?]+/).filter((s: string) => s.trim().length > 0);

      // Detect structural elements from text
      const hasQuestion = /\?/.test(originalScript);
      const hasExclamation = /!/.test(originalScript);
      const hasImperative = /\b(clique|inscreva|comente|compartilhe|link|bio|descri[çc][aã]o)\b/i.test(originalScript);
      const hasCTASignal = hasImperative;

      // Estimate block potential based on paragraph breaks
      const paragraphs = originalScript.split(/\n\s*\n/).filter((p: string) => p.trim().length > 0);

      sourceTextAnalysis = {
        total_characters: originalScript.length,
        total_words: words.length,
        total_lines: lines.length,
        total_sentences: sentences.length,
        total_paragraphs: paragraphs.length,
        estimated_block_potential: Math.max(paragraphs.length, Math.ceil(sentences.length / 3)),
        structural_signals: {
          has_question: hasQuestion,
          has_exclamation: hasExclamation,
          has_cta_signal: hasCTASignal,
          detected_cta_words: hasImperative ? originalScript.match(/\b(clique|inscreva|comente|compartilhe|link|bio|descri[çc][aã]o)\b/gi) : [],
        },
        density_estimate: words.length > 0 && sentences.length > 0
          ? Math.round((words.length / sentences.length) * 10) / 10
          : null,
        analysis_method: "deterministic_text_analysis",
        analysis_limitations: [
          "Análise puramente textual sem IA",
          "Detecção de CTA limitada a palavras-chave em português",
          "Estimativa de blocos baseada em parágrafos/sentenças",
        ],
      };
    }

    // ═══════════════════════════════════════════════════
    // 4. PARALLEL LOAD — TODAS AS FAMÍLIAS (global MVP base)
    // ═══════════════════════════════════════════════════
    // The service-role client bypasses RLS, so every per-video query must be
    // explicitly constrained to the administrator-approved shared corpus.
    // A user's personal preset is injected later by applyDnaStylePack and must
    // never leak into another account's global generation context.
    const [{ data: officialVideoRows, error: officialVideosError }, { data: sharedCohortRows, error: sharedCohortsError }] = await Promise.all([
      sb.from("videos").select("id").eq("status", "completed").eq("approved_for_global", true),
      sb.from("dataset_cohort").select("id").is("created_by", null),
    ]);
    if (officialVideosError) throw officialVideosError;
    if (sharedCohortsError) throw sharedCohortsError;
    const emptyScopeId = "00000000-0000-0000-0000-000000000000";
    const officialVideoIds = officialVideoRows?.map((video) => video.id) ?? [];
    const officialVideoScope = officialVideoIds.length ? officialVideoIds : [emptyScopeId];
    const sharedCohortIds = sharedCohortRows?.map((cohort) => cohort.id) ?? [];
    const sharedCohortScope = sharedCohortIds.length ? sharedCohortIds : [emptyScopeId];

    const [
      { data: verbalIntel },
      { data: verbalLayers },
      { data: canonicalUnits },
      { data: perfWeights },
      { data: perfCorrelation },
      { data: ctaProfiles },
      { data: cohortSummary },
      { data: blocks },
      { data: videos },
      { data: wordPatterns },
      { data: blockSemantics },
      { data: blockPhrases },
      { data: microEvents },
      { data: temporalProfiles },
      { data: judgeResults },
      { data: visualBlocks },
      { data: visualEmotionSeq },
      { data: textVisualAlign },
      { data: textImageCompat },
      { data: videoFrames },
      { data: viralWordCombos },
      { data: viralCombPatterns },
      { data: viralEmotionalPat },
      { data: viralSeqPatterns },
      { data: viralTimingPat },
      { data: viralVisualPat },
      { data: verbalNoise },
      { data: ctaDeep },
      { data: ctaEvents },
      { data: cohorts },
      { data: cohortVideos },
      { data: outliers },
      { data: readinessReports },
      { data: validationReports },
      { data: consistencyReports },
      { data: viralPhraseBank },
      { data: verbalSequences },
      { data: semanticPatterns },
      { data: blockVerbalAnalysis },
      { data: verbalPhase2 },
      { data: viralLexicon },
      { data: viralVerbalPat },
    ] = await Promise.all([
      sb.from("verbal_intelligence_summary").select("*"),
      sb.from("verbal_layer_patterns").select("*"),
      sb.from("verbal_canonical_units").select("*").in("video_id", officialVideoScope).eq("is_top_ranked", true).order("narrative_replicability_score", { ascending: false }).limit(100),
      sb.from("pattern_performance_weights").select("*").order("strength_score", { ascending: false }).limit(50),
      sb.from("performance_correlation").select("*"),
      sb.from("cta_profiles").select("*").in("video_id", officialVideoScope),
      sb.from("cohort_analysis_summary").select("*").in("cohort_id", sharedCohortScope).order("created_at", { ascending: false }),
      sb.from("video_blocks").select("id, video_id, tipo_bloco, funcao_narrativa, tempo_inicio, tempo_fim, texto, bloco_id").in("video_id", officialVideoScope),
      sb.from("videos").select("id, titulo, duracao, views, likes, comments, engagement_rate, status").in("id", officialVideoScope),
      sb.from("block_word_patterns").select("block_type, word, word_frequency, is_dominant, is_emotional, weighted_score").in("video_id", officialVideoScope).order("weighted_score", { ascending: false }).limit(500),
      sb.from("block_semantic_patterns").select("*").in("video_id", officialVideoScope),
      sb.from("block_phrase_patterns").select("*").in("video_id", officialVideoScope),
      sb.from("video_micro_events").select("*").in("video_id", officialVideoScope).order("timestamp_seconds", { ascending: true }),
      sb.from("video_temporal_profile").select("*").in("video_id", officialVideoScope),
      sb.from("narrative_judge_results").select("*").in("video_id", officialVideoScope),
      sb.from("visual_block_analysis").select("*").in("video_id", officialVideoScope),
      sb.from("visual_emotion_sequence").select("*").in("video_id", officialVideoScope),
      sb.from("text_visual_alignment").select("*").in("video_id", officialVideoScope),
      sb.from("text_image_compatibility").select("*").in("video_id", officialVideoScope),
      sb.from("video_frames").select("id, video_id, frame_number, timestamp_seconds, scene_type").in("video_id", officialVideoScope),
      sb.from("viral_word_combinations").select("*").in("video_id", officialVideoScope),
      sb.from("viral_combination_patterns").select("*"),
      sb.from("viral_emotional_patterns").select("*"),
      sb.from("viral_sequence_patterns").select("*"),
      sb.from("viral_timing_patterns").select("*"),
      sb.from("viral_visual_patterns").select("*"),
      sb.from("verbal_noise_archive").select("*").in("video_id", officialVideoScope),
      sb.from("cta_deep_analysis").select("*").in("video_id", officialVideoScope),
      sb.from("video_cta_events").select("*").in("video_id", officialVideoScope),
      sb.from("dataset_cohort").select("*").in("id", sharedCohortScope),
      sb.from("dataset_cohort_videos").select("*").in("cohort_id", sharedCohortScope).in("video_id", officialVideoScope),
      sb.from("outlier_detection").select("*").in("video_id", officialVideoScope),
      sb.from("readiness_reports").select("*").order("generated_at", { ascending: false }).limit(1),
      sb.from("validation_reports").select("*").in("video_id", officialVideoScope).order("created_at", { ascending: false }).limit(20),
      sb.from("data_consistency_reports").select("*").in("video_id", officialVideoScope),
      sb.from("viral_phrase_bank").select("*"),
      sb.from("verbal_narrative_sequences").select("*").order("frequency", { ascending: false }),
      sb.from("semantic_patterns").select("*").in("video_id", officialVideoScope),
      sb.from("block_verbal_analysis").select("*").in("video_id", officialVideoScope),
      sb.from("verbal_phase2_profile").select("*"),
      sb.from("viral_lexicon_global").select("*"),
      sb.from("viral_verbal_patterns").select("*"),
    ]);

    // ═══════════════════════════════════════════════════
    // 5. DERIVE NARRATIVE FUNCTION MAP
    // ═══════════════════════════════════════════════════
    const narrativeFnMap: Record<string, string> = {};
    if (blocks && blocks.length > 0) {
      const typeMap: Record<string, Record<string, number>> = {};
      for (const b of blocks) {
        if (!b.funcao_narrativa) continue;
        if (!typeMap[b.tipo_bloco]) typeMap[b.tipo_bloco] = {};
        typeMap[b.tipo_bloco][b.funcao_narrativa] = (typeMap[b.tipo_bloco][b.funcao_narrativa] || 0) + 1;
      }
      for (const [type, counts] of Object.entries(typeMap)) {
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        if (sorted[0]) narrativeFnMap[type] = sorted[0][0];
      }
    }

    // ═══════════════════════════════════════════════════
    // 6. DERIVE POSITION ROLE MAP
    // ═══════════════════════════════════════════════════
    const positionRoleMap: Record<string, string> = {};
    if (blocks && blocks.length > 0 && videos && videos.length > 0) {
      const durMap = Object.fromEntries(videos.map((v: any) => [v.id, Number(v.duracao) || 0]));
      const allPcts: number[] = [];
      const typePcts: Record<string, number[]> = {};
      for (const b of blocks) {
        const dur = durMap[b.video_id];
        if (!dur || dur <= 0) continue;
        const pct = (Number(b.tempo_inicio) / dur) * 100;
        allPcts.push(pct);
        if (!typePcts[b.tipo_bloco]) typePcts[b.tipo_bloco] = [];
        typePcts[b.tipo_bloco].push(pct);
      }
      if (allPcts.length > 0) {
        allPcts.sort((a, b) => a - b);
        const q25 = allPcts[Math.floor(allPcts.length * 0.25)];
        const q50 = allPcts[Math.floor(allPcts.length * 0.50)];
        const q75 = allPcts[Math.floor(allPcts.length * 0.75)];
        for (const [type, pcts] of Object.entries(typePcts)) {
          const sorted = pcts.sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          if (median <= q25) positionRoleMap[type] = "opening";
          else if (median <= q50) positionRoleMap[type] = "middle";
          else if (median <= q75) positionRoleMap[type] = "late";
          else positionRoleMap[type] = "closing";
        }
      }
    }

    // ═══════════════════════════════════════════════════
    // 7. VOCAB REFERENCE
    // ═══════════════════════════════════════════════════
    const vocabRef: Record<string, any[]> = {};
    if (wordPatterns) {
      for (const w of wordPatterns) {
        if (!vocabRef[w.block_type]) vocabRef[w.block_type] = [];
        if (vocabRef[w.block_type].length < 20) {
          vocabRef[w.block_type].push({
            word: w.word,
            frequency: w.word_frequency,
            is_dominant: w.is_dominant,
            is_emotional: w.is_emotional,
            score: w.weighted_score,
          });
        }
      }
    }

    // ═══════════════════════════════════════════════════
    // 8. FEW-SHOT EXAMPLES
    // ═══════════════════════════════════════════════════
    const fewShot: any[] = [];
    if (videos && videos.length > 0 && blocks) {
      const topVideos = [...videos]
        .sort((a: any, b: any) => (Number(b.engagement_rate) || 0) - (Number(a.engagement_rate) || 0))
        .slice(0, 5);
      for (const v of topVideos) {
        const vBlocks = blocks
          .filter((b: any) => b.video_id === v.id)
          .sort((a: any, b: any) => Number(a.tempo_inicio) - Number(b.tempo_inicio));
        fewShot.push({
          video_id: v.id,
          title: v.titulo,
          engagement_rate: v.engagement_rate,
          views: v.views,
          block_sequence: vBlocks.map((b: any) => ({
            type: b.tipo_bloco,
            function: b.funcao_narrativa,
            text: b.texto?.substring(0, 200),
          })),
        });
      }
    }

    // ═══════════════════════════════════════════════════
    // 9. WORD COUNT RULES
    // ═══════════════════════════════════════════════════
    const wordCountRules: Record<string, { p10: number; p90: number; avg: number }> = {};
    if (blocks) {
      const typeCounts: Record<string, number[]> = {};
      for (const b of blocks) {
        if (!b.texto) continue;
        const wc = b.texto.split(/\s+/).filter(Boolean).length;
        if (!typeCounts[b.tipo_bloco]) typeCounts[b.tipo_bloco] = [];
        typeCounts[b.tipo_bloco].push(wc);
      }
      for (const [type, counts] of Object.entries(typeCounts)) {
        const sorted = counts.sort((a, b) => a - b);
        const p10 = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
        const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
        const avg = Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length);
        wordCountRules[type] = { p10, p90, avg };
      }
    }

    // ═══════════════════════════════════════════════════
    // 10. SLOT SEQUENCE
    // ═══════════════════════════════════════════════════
    const bpBlocks = (blueprint.block_sequence as any[]) ?? [];
    const slots = bpBlocks.map((block: any, position: number) => {
      let positionPct: number | null = null;
      if (block.block_type === "hook" && blueprint.hook_expected_position_pct != null) {
        positionPct = Number(blueprint.hook_expected_position_pct);
      } else if (block.block_type === "payoff" && blueprint.payoff_expected_position_pct != null) {
        positionPct = Number(blueprint.payoff_expected_position_pct);
      }

      const narrativeFn = narrativeFnMap[block.block_type] ?? null;
      const posRole = positionRoleMap[block.block_type] ?? null;
      const vocab = vocabRef[block.block_type] ?? [];
      const wcRule = wordCountRules[block.block_type] ?? null;
      const presetStrategy = dnaPresetBootstrap?.strategies[block.block_type] ?? null;
      const relativePosition = bpBlocks.length <= 1 ? 0 : position / (bpBlocks.length - 1);
      const fallbackPositionRole = relativePosition <= 0.25
        ? "opening"
        : relativePosition >= 0.75
        ? "closing"
        : "middle";
      const strategyRange = presetStrategy?.word_range;
      const fallbackWordCountRule = strategyRange
        && Number.isFinite(Number(strategyRange.min))
        && Number.isFinite(Number(strategyRange.max))
        && Number.isFinite(Number(strategyRange.target))
        ? {
          p10: Number(strategyRange.min),
          p90: Number(strategyRange.max),
          avg: Number(strategyRange.target),
        }
        : null;
      const effectiveNarrativeFn = narrativeFn ?? (presetStrategy ? block.block_type : null);
      const effectivePositionRole = posRole ?? (presetStrategy ? fallbackPositionRole : null);
      const effectiveWordCountRule = wcRule ?? fallbackWordCountRule;

      const slotCanonicals = (canonicalUnits ?? [])
        .filter((u: any) => {
          const fn = u.narrative_function?.toLowerCase();
          return fn === block.block_type || fn === narrativeFn?.toLowerCase();
        })
        .slice(0, 5)
        .map((u: any) => ({
          text: u.candidate_text,
          emotion: u.emotional_intent,
          confidence: u.confidence_score,
          replicability: u.narrative_replicability_score,
      }));

      const missingFields: string[] = [];
      if (!effectiveNarrativeFn) missingFields.push("narrative_function");
      if (!effectivePositionRole) missingFields.push("position_role");
      // A v3 preset works from abstract strategy, not borrowed vocabulary.
      if (vocab.length === 0 && !presetStrategy) missingFields.push("vocab_ref");

      return {
        index: block.index,
        slot_type: block.block_type,
        is_required: block.is_required,
        expected_position_pct: positionPct,
        narrative_function: effectiveNarrativeFn,
        position_role: effectivePositionRole,
        vocab_ref: vocab,
        word_count_rule: effectiveWordCountRule,
        canonical_examples: slotCanonicals,
        dna_strategy_ref: presetStrategy ?? undefined,
        generation_ready: missingFields.length === 0,
        missing_fields: missingFields.length > 0 ? missingFields : undefined,
      };
    });

    // ═══════════════════════════════════════════════════
    // 10. BLOCOS DO context_payload
    // ═══════════════════════════════════════════════════

    const videoIds = (videos ?? []).map((v: any) => v.id);
    const scope_resolution = {
      total_videos: videoIds.length,
      total_blocks: (blocks ?? []).length,
      video_ids: videoIds,
      blueprint_id: blueprint.id,
      dna_formal_id: dnaFormal?.id ?? null,
      dna_preset_id: dnaPresetBootstrap?.id ?? null,
      dna_preset_resolution: dnaPresetResolutionMode,
      resolved_at: new Date().toISOString(),
    };

    const structural_plan = dnaFormal ? {
      structural: dnaFormal.structural,
      temporal: dnaFormal.temporal,
      dominant_sequence: dnaFormal.structural?.dominant_sequence ?? null,
      total_videos_used: dnaFormal.total_videos_used,
      total_blocks_used: dnaFormal.total_blocks_used,
    } : dnaPresetBootstrap ? {
      source: "dna_preset_v3",
      structural: {
        dominant_sequence: dnaPresetBootstrap.stylePack.dominant_sequence,
        contract: dnaPresetBootstrap.stylePack.structural_contract,
      },
      temporal: null,
      dominant_sequence: dnaPresetBootstrap.stylePack.dominant_sequence,
      total_videos_used: dnaPresetBootstrap.stylePack.total_videos,
      total_blocks_used: null,
    } : null;

    // verbal_plan
    const verbalAnalysisByType: Record<string, { tones: Record<string, number>; avg_intensity: number[]; avg_density: number[]; count: number }> = {};
    for (const bva of (blockVerbalAnalysis ?? [])) {
      const blk = (blocks ?? []).find((b: any) => b.id === bva.block_id);
      const bt = blk?.tipo_bloco ?? "unknown";
      if (!verbalAnalysisByType[bt]) verbalAnalysisByType[bt] = { tones: {}, avg_intensity: [], avg_density: [], count: 0 };
      verbalAnalysisByType[bt].count++;
      if (bva.tone) verbalAnalysisByType[bt].tones[bva.tone] = (verbalAnalysisByType[bt].tones[bva.tone] || 0) + 1;
      if (bva.emotional_intensity != null) verbalAnalysisByType[bt].avg_intensity.push(Number(bva.emotional_intensity));
      if (bva.linguistic_density != null) verbalAnalysisByType[bt].avg_density.push(Number(bva.linguistic_density));
    }
    const verbalAnalysisSummary: Record<string, any> = {};
    for (const [bt, data] of Object.entries(verbalAnalysisByType)) {
      const topTone = Object.entries(data.tones).sort((a, b) => b[1] - a[1])[0];
      verbalAnalysisSummary[bt] = {
        count: data.count,
        dominant_tone: topTone ? topTone[0] : null,
        avg_emotional_intensity: data.avg_intensity.length > 0 ? Math.round(data.avg_intensity.reduce((s, v) => s + v, 0) / data.avg_intensity.length * 10) / 10 : null,
        avg_linguistic_density: data.avg_density.length > 0 ? Math.round(data.avg_density.reduce((s, v) => s + v, 0) / data.avg_density.length * 100) / 100 : null,
      };
    }

    const verbal_plan = {
      verbal_summary: (verbalIntel ?? []).map((vi: any) => ({
        narrative_function: vi.narrative_function,
        total_canonical_units: vi.total_canonical_units,
        avg_replicability: vi.avg_replicability_score,
        primary_emotion: vi.primary_emotion,
        secondary_emotion: vi.secondary_emotion,
        avg_emotional_intensity: vi.avg_emotional_intensity,
        viewer_directed_rate: vi.viewer_directed_rate,
      })),
      verbal_layers: (verbalLayers ?? []).map((lp: any) => ({
        layer_type: lp.layer_type,
        top_words: lp.top_words,
        top_phrases: lp.top_phrases,
        top_emotions: lp.top_emotions,
        top_tones: lp.top_tones,
        engagement_weighted_words: lp.engagement_weighted_words,
        engagement_weighted_phrases: lp.engagement_weighted_phrases,
        total_blocks_analyzed: lp.total_blocks_analyzed,
        total_videos_analyzed: lp.total_videos_analyzed,
      })),
      narrative_sequences: (verbalSequences ?? []).map((ns: any) => ({
        sequence_pattern: ns.sequence_pattern,
        frequency: ns.frequency,
        sequence_length: ns.sequence_length,
        dominant_emotion: ns.dominant_emotion,
        avg_engagement_rate: ns.avg_engagement_rate,
        avg_replicability_score: ns.avg_replicability_score,
        viewer_directed_rate: ns.viewer_directed_rate,
      })),
      block_verbal_analysis_summary: verbalAnalysisSummary,
      total_block_verbal_records: (blockVerbalAnalysis ?? []).length,
      phase2_profiles: (verbalPhase2 ?? []).map((p: any) => ({
        narrative_function: p.narrative_function,
        primary_emotion: p.primary_emotion,
        secondary_emotion: p.secondary_emotion,
        avg_replicability_score: p.avg_replicability_score,
        avg_emotional_intensity: p.avg_emotional_intensity,
        avg_confidence: p.avg_confidence,
        top_verbal_patterns: p.top_verbal_patterns,
        top_units: p.top_units,
        emotion_distribution: p.emotion_distribution,
      })),
      dna_verbal: dnaFormal?.verbal ?? null,
    };

    const lexical_plan = {
      vocab_ref: vocabRef,
      word_count_rules: wordCountRules,
      global_lexicon: (viralLexicon ?? []).map((l: any) => ({
        word: l.word,
        total_frequency: l.total_frequency,
        video_count: l.video_count,
        avg_engagement_rate: l.avg_engagement_rate,
        is_emotional: l.is_emotional,
        is_impact: l.is_impact,
        dominant_block_type: l.dominant_block_type,
      })),
      verbal_patterns: (viralVerbalPat ?? []).map((vp: any) => ({
        pattern_name: vp.pattern_name,
        pattern_type: vp.pattern_type,
        frequency: vp.frequency,
        avg_engagement_rate: vp.avg_engagement_rate,
        sample_phrases: vp.sample_phrases,
      })),
      total_lexicon_entries: (viralLexicon ?? []).length,
      total_verbal_patterns: (viralVerbalPat ?? []).length,
    };

    const semanticByType: Record<string, any[]> = {};
    for (const sp of (blockSemantics ?? [])) {
      if (!semanticByType[sp.block_type]) semanticByType[sp.block_type] = [];
      semanticByType[sp.block_type].push({
        block_id: sp.block_id, video_id: sp.video_id,
        keywords: sp.block_keywords, emotional_type: sp.block_emotional_type,
        emotional_intensity: sp.block_emotional_intensity, verbal_tone: sp.block_verbal_tone,
        dominant_words: sp.dominant_words, rare_words: sp.rare_words,
        strong_phrases: sp.block_strong_phrases, repeated_words: sp.block_repeated_words,
        weighted_word_score: sp.weighted_word_score, weighted_phrase_score: sp.weighted_phrase_score,
      });
    }
    const videoSemanticSummary = (semanticPatterns ?? []).map((sp: any) => ({
      video_id: sp.video_id, hook_text: sp.hook_text,
      hook_emotional_type: sp.hook_emotional_type, hook_emotional_intensity: sp.hook_emotional_intensity,
      hook_phrase_type: sp.hook_phrase_type, payoff_text: sp.payoff_text,
      payoff_emotional_type: sp.payoff_emotional_type, payoff_pattern: sp.payoff_pattern,
      dominant_verbal_tone: sp.dominant_verbal_tone, cta_exists: sp.cta_exists,
      cta_type: sp.cta_type, cta_tone: sp.cta_tone,
      trigger_words: sp.trigger_words, strong_phrases: sp.strong_phrases,
      repeated_words: sp.repeated_words,
    }));
    const semantic_plan = {
      total_block_semantics: (blockSemantics ?? []).length,
      by_block_type: semanticByType,
      video_semantic_patterns: videoSemanticSummary,
      total_video_semantic_patterns: videoSemanticSummary.length,
    };

    const phrasesByType: Record<string, any[]> = {};
    for (const pp of (blockPhrases ?? [])) {
      if (!phrasesByType[pp.block_type]) phrasesByType[pp.block_type] = [];
      phrasesByType[pp.block_type].push({
        phrase: pp.phrase, phrase_type: pp.phrase_type, phrase_category: pp.phrase_category,
        is_emotional: pp.is_emotional, is_repeated: pp.is_repeated, is_strong: pp.is_strong,
        phrase_strength_score: pp.phrase_strength_score, weighted_score: pp.weighted_score,
      });
    }
    const phrase_plan = {
      total_records: (blockPhrases ?? []).length,
      by_block_type: phrasesByType,
      phrase_bank: (viralPhraseBank ?? []).map((vp: any) => ({
        phrase: vp.phrase, phrase_type: vp.phrase_type, frequency: vp.frequency,
        avg_engagement: vp.avg_engagement_rate, block_type: vp.block_type,
        emotional_intent: vp.emotional_intent,
      })),
    };

    const combination_plan = {
      word_combinations: (viralWordCombos ?? []).map((wc: any) => ({
        combination: wc.combination_text ?? wc.word_combination, frequency: wc.frequency,
        block_type: wc.block_type, avg_engagement: wc.avg_engagement_rate,
        combination_type: wc.combination_type,
      })),
      combination_patterns: (viralCombPatterns ?? []).map((cp: any) => ({
        pattern_name: cp.pattern_name, pattern_type: cp.pattern_type,
        frequency: cp.frequency, avg_engagement: cp.avg_engagement_rate,
        sample_combinations: cp.sample_combinations,
      })),
      total_word_combos: (viralWordCombos ?? []).length,
      total_patterns: (viralCombPatterns ?? []).length,
    };

    const emotional_plan = {
      dna_emotional: dnaFormal?.emotional ?? null,
      emotional_patterns: (viralEmotionalPat ?? []).map((ep: any) => ({
        pattern_name: ep.pattern_name, pattern_type: ep.pattern_type,
        frequency: ep.frequency, avg_engagement: ep.avg_engagement_rate,
        dominant_emotion: ep.dominant_emotion, emotional_arc: ep.emotional_arc,
      })),
      sequence_patterns: (viralSeqPatterns ?? []).map((sp: any) => ({
        pattern_name: sp.pattern_name, sequence: sp.sequence_pattern,
        frequency: sp.frequency, avg_engagement: sp.avg_engagement_rate,
      })),
      timing_patterns: (viralTimingPat ?? []).map((tp: any) => ({
        pattern_name: tp.pattern_name, timing_type: tp.timing_type,
        frequency: tp.frequency, avg_engagement: tp.avg_engagement_rate,
      })),
      visual_patterns: (viralVisualPat ?? []).map((vp: any) => ({
        pattern_name: vp.pattern_name, visual_type: vp.visual_type,
        frequency: vp.frequency, avg_engagement: vp.avg_engagement_rate,
      })),
    };

    const microEventsByType: Record<string, number> = {};
    const microEventPositions: number[] = [];
    for (const me of (microEvents ?? [])) {
      const t = me.event_type ?? "unknown";
      microEventsByType[t] = (microEventsByType[t] || 0) + 1;
      if (me.timestamp_seconds != null) microEventPositions.push(Number(me.timestamp_seconds));
    }
    const temporalSummary = (temporalProfiles ?? []).map((tp: any) => ({
      video_id: tp.video_id, tension_arc: tp.tension_arc, rhythm_pattern: tp.rhythm_pattern,
      peak_moment_seconds: tp.peak_moment_seconds, total_turning_points: tp.total_turning_points,
      intensity_curve: tp.intensity_curve,
    }));
    const judgeByFunction: Record<string, { total: number; valid: number; replicable: number }> = {};
    for (const jr of (judgeResults ?? [])) {
      const fn = jr.narrative_function ?? "unclassified";
      if (!judgeByFunction[fn]) judgeByFunction[fn] = { total: 0, valid: 0, replicable: 0 };
      judgeByFunction[fn].total++;
      if (jr.is_valid_narrative_unit) judgeByFunction[fn].valid++;
      if (jr.replicable_for_dna) judgeByFunction[fn].replicable++;
    }
    const micropeak_plan = {
      total_micro_events: (microEvents ?? []).length,
      event_type_distribution: microEventsByType,
      position_range: microEventPositions.length > 0 ? {
        min_seconds: Math.min(...microEventPositions),
        max_seconds: Math.max(...microEventPositions),
      } : null,
      temporal_profiles: temporalSummary,
      total_temporal_profiles: temporalSummary.length,
      judge_summary: judgeByFunction,
      total_judge_results: (judgeResults ?? []).length,
    };

    const visualByBlockType: Record<string, any[]> = {};
    for (const vb of (visualBlocks ?? [])) {
      const bt = vb.block_type ?? "unknown";
      if (!visualByBlockType[bt]) visualByBlockType[bt] = [];
      visualByBlockType[bt].push({
        block_id: vb.block_id, video_id: vb.video_id, visual_intensity: vb.visual_intensity,
        dominant_color: vb.dominant_color, scene_type: vb.scene_type,
        motion_level: vb.motion_level, face_detected: vb.face_detected,
      });
    }
    const alignByType: Record<string, { scores: number[]; count: number }> = {};
    for (const a of (textVisualAlign ?? [])) {
      const blk = (blocks ?? []).find((b: any) => b.id === a.block_id);
      const bt = blk?.tipo_bloco ?? "unknown";
      if (!alignByType[bt]) alignByType[bt] = { scores: [], count: 0 };
      if (a.alignment_score != null) {
        alignByType[bt].scores.push(Number(a.alignment_score));
        alignByType[bt].count++;
      }
    }
    const alignmentAvgByType: Record<string, number> = {};
    for (const [bt, data] of Object.entries(alignByType)) {
      if (data.scores.length > 0) {
        alignmentAvgByType[bt] = Math.round(data.scores.reduce((s, v) => s + v, 0) / data.scores.length);
      }
    }
    const compatLabels: Record<string, number> = {};
    for (const c of (textImageCompat ?? [])) {
      const label = c.compatibility_label ?? "unknown";
      compatLabels[label] = (compatLabels[label] || 0) + 1;
    }
    const visual_sync_plan = {
      visual_blocks_by_type: visualByBlockType,
      total_visual_blocks: (visualBlocks ?? []).length,
      emotion_sequence: (visualEmotionSeq ?? []).map((es: any) => ({
        video_id: es.video_id, sequence: es.emotion_sequence, dominant_emotion: es.dominant_emotion,
      })),
      alignment_avg_by_type: alignmentAvgByType,
      total_alignments: (textVisualAlign ?? []).length,
      compatibility_distribution: compatLabels,
      total_compatibility_records: (textImageCompat ?? []).length,
      total_frames: (videoFrames ?? []).length,
    };

    const cta_payoff_plan = {
      dominant_type: blueprint.dominant_cta_type,
      expected_position_seconds: blueprint.cta_expected_position_seconds,
      profiles: (ctaProfiles ?? []).map((c: any) => ({
        video_id: c.video_id, type: c.cta_type, action: c.cta_action,
        emotion: c.cta_emotion, intensity: c.cta_intensity,
        text: c.cta_text, position_seconds: c.cta_position_seconds,
      })),
      deep_analysis: (ctaDeep ?? []).map((cd: any) => ({
        video_id: cd.video_id, cta_type: cd.cta_type, cta_text: cd.cta_text,
        cta_tone: cd.cta_tone, cta_intensity: cd.cta_intensity,
        cta_position: cd.cta_position, cta_target: cd.cta_target,
        implicit_cta_detected: cd.implicit_cta_detected, confidence_score: cd.confidence_score,
      })),
      cta_events: (ctaEvents ?? []).map((ce: any) => ({
        video_id: ce.video_id, event_type: ce.event_type,
        timestamp_seconds: ce.timestamp_seconds, cta_text: ce.cta_text,
      })),
      total_profiles: (ctaProfiles ?? []).length,
      total_deep: (ctaDeep ?? []).length,
      total_events: (ctaEvents ?? []).length,
    };

    const noiseByReason: Record<string, number> = {};
    for (const n of (verbalNoise ?? [])) {
      const reason = n.rejection_reason ?? "unknown";
      noiseByReason[reason] = (noiseByReason[reason] || 0) + 1;
    }
    const noise_guardrails = {
      total_noise_records: (verbalNoise ?? []).length,
      rejection_distribution: noiseByReason,
      blocked_combinations: (verbalNoise ?? []).slice(0, 50).map((n: any) => ({
        text: n.combination_text, reason: n.rejection_reason,
        block_type: n.source_block_type, dominant_function: n.dominant_function,
      })),
    };

    const cluster_context = {
      cohorts: (cohorts ?? []).map((c: any) => ({
        id: c.id, cohort_name: c.cohort_name, cohort_type: c.cohort_type,
        video_count: c.video_count, active: c.active, filter_segment: c.filter_segment,
        filter_views_min: c.filter_views_min, filter_views_max: c.filter_views_max,
        filter_duration_min: c.filter_duration_min, filter_duration_max: c.filter_duration_max,
        video_ids: c.video_ids,
      })),
      cohort_videos: (cohortVideos ?? []).length,
      summaries: (cohortSummary ?? []).map((cs: any) => ({
        cohort_name: cs.cohort_name, cohort_id: cs.cohort_id, video_count: cs.video_count,
        avg_engagement_rate: cs.avg_engagement_rate, avg_performance: cs.avg_performance,
        dominant_structure: cs.dominant_structure, dominant_emotion: cs.dominant_emotion,
        dominant_emotional_arc: cs.dominant_emotional_arc, dominant_cta_pattern: cs.dominant_cta_pattern,
        dominant_verbal_pattern: cs.dominant_verbal_pattern, dominant_patterns: cs.dominant_patterns,
        avg_alignment_score: cs.avg_alignment_score,
      })),
      total_cohorts: (cohorts ?? []).length,
      total_summaries: (cohortSummary ?? []).length,
    };

    const outlierFlagged = (outliers ?? []).filter((o: any) => o.outlier_flag === true);
    const outlier_context = {
      total_records: (outliers ?? []).length,
      total_flagged: outlierFlagged.length,
      flagged_video_ids: outlierFlagged.map((o: any) => o.video_id),
      outliers: outlierFlagged.map((o: any) => ({
        video_id: o.video_id, outlier_type: o.outlier_type, outlier_reason: o.outlier_reason,
        z_score: o.z_score, reference_mean: o.reference_mean,
        reference_stddev: o.reference_stddev, confidence_score: o.confidence_score,
      })),
    };

    const latestReadiness = (readinessReports ?? [])[0] ?? null;
    const criticalIssues = (consistencyReports ?? []).filter((r: any) => r.severity === "critical");
    const readiness_context = {
      latest_readiness: latestReadiness ? {
        readiness_score: latestReadiness.readiness_score,
        total_videos: latestReadiness.total_videos, total_blocks: latestReadiness.total_blocks,
        validation_status: latestReadiness.validation_status, generated_at: latestReadiness.generated_at,
        report_json: latestReadiness.report_json,
      } : null,
      recent_validations: (validationReports ?? []).map((vr: any) => ({
        validation_type: vr.validation_type, anomaly_detected: vr.anomaly_detected,
        confidence_score: vr.confidence_score, created_at: vr.created_at,
      })),
      consistency_issues: {
        total: (consistencyReports ?? []).length, critical: criticalIssues.length,
        issues: criticalIssues.slice(0, 20).map((r: any) => ({
          video_id: r.video_id, issue_type: r.issue_type, field_name: r.field_name,
          severity: r.severity, expected_rule: r.expected_rule, current_value: r.current_value,
        })),
      },
    };

    // ═══════════════════════════════════════════════════
    // 12. MODE-SPECIFIC CONSTRAINTS (added to context_payload)
    // ═══════════════════════════════════════════════════

    // Video reference context — ONLY from uploaded reference video (never from base viral)
    let video_reference_context: any = null;
    if (inputMode === "video" && referenceVideoData) {
      const transcriptionSegments = Array.isArray(referenceVideoData.transcription_segments)
        ? referenceVideoData.transcription_segments : [];
      const visualFrames = Array.isArray(referenceVideoData.frames)
        ? referenceVideoData.frames : [];

      // Load topic analysis from reference_video_topics
      let topicAnalysis: any = null;
      const { data: topicData } = await sb
        .from("reference_video_topics")
        .select("*")
        .eq("reference_video_id", referenceVideoData.id)
        .maybeSingle();
      
      if (topicData && topicData.topic_status === "ready") {
        topicAnalysis = {
          central_topic: topicData.central_topic,
          key_topics: topicData.key_topics,
          semantic_summary: topicData.semantic_summary,
          detected_language: topicData.detected_language,
          narrative_progression: topicData.narrative_progression,
          forbidden_foreign_entities: topicData.forbidden_foreign_entities,
          visual_anchor_points: topicData.visual_anchor_points,
          estimated_target_word_count: topicData.estimated_target_word_count,
          semantic_alignment_rules: topicData.semantic_alignment_rules,
        };
      }

      video_reference_context = {
        source_type: "uploaded_reference_video",
        reference_video_id: referenceVideoData.id,
        file_name: referenceVideoData.file_name,
        duration_seconds: referenceVideoData.duration_seconds,
        transcription_full: referenceVideoData.transcription ?? "",
        transcription_segments: transcriptionSegments.map((s: any) => ({
          start: s.start,
          end: s.end,
          text: s.text,
        })),
        total_transcription_segments: transcriptionSegments.length,
        visual_frames: visualFrames.map((f: any) => ({
          timestamp_seconds: f.timestamp_seconds,
          description: f.description,
          scene_type: f.scene_type,
          visual_elements: f.visual_elements,
          main_action: f.main_action,
          emotional_tone: f.emotional_tone,
          surprise_score: f.surprise_score,
          text_on_screen: f.text_on_screen,
          subject_role: f.subject_role,
          layer: f.layer,
          region: f.region,
          subject_id: f.subject_id,
        })),
        total_visual_frames: visualFrames.length,
        topic_analysis: topicAnalysis,
        usage_instructions: [
          "O CONTEÚDO do roteiro vem da transcrição e frames deste vídeo",
          "A base viral fornece APENAS estrutura (blocos, ritmo, intensidade)",
          "A base viral NÃO fornece conteúdo textual",
          "Sincronizar blocos com momentos visuais dos frames",
          "Respeitar duração do vídeo para dimensionar texto",
          "Classificar automaticamente react, história falada, história visual sem voz ou comportamento cotidiano",
          "Em react, nunca misturar o reagente com os personagens do vídeo incorporado",
          "Sem história falada, construir a conexão narrativa somente a partir da sequência visual",
          language && !/^pt(?:-br)?$/i.test(language.trim())
            ? `Usar linguagem falada e cotidiana no idioma solicitado (${language}); rótulos fortes só com evidência local`
            : "Usar PT-BR cotidiano; polêmica popular só quando a evidência local sustentar o rótulo",
          "Traição, profissão sexual, crime ou relação escondida nunca podem ser inferidos apenas de roupa, aparência ou música",
          "Este vídeo NÃO faz parte da base de dados principal",
        ],
      };
      video_reference_context.content_profile = resolveOperationalVideoContentProfile(video_reference_context);
    }

    // Theme constraints — user input registered as generation restrictions
    let theme_constraints: any = null;
    if (inputMode === "theme") {
      theme_constraints = {
        theme: theme,
        niche: niche ?? null,
        objective: objective ?? null,
        language: language ?? null,
        notes: notes ?? null,
        constraint_type: "user_defined_theme",
        usage_instructions: [
          "Gerar conteúdo sobre o tema informado",
          "Manter estrutura viral conforme base MVP (blueprint + DNA formal)",
          "Usar linguagem compatível com o nicho, se informado",
          "Não inventar fatos sobre o tema",
          "Restrições do usuário devem ser respeitadas nos slots de geração",
        ],
      };
    }

    // Transform constraints — original script + analysis
    let transform_constraints: any = null;
    if (inputMode === "transform") {
      transform_constraints = {
        original_script: originalScript,
        preserve_meaning: preserveMeaning ?? true,
        language: language ?? null,
        notes: notes ?? null,
        source_text_analysis: sourceTextAnalysis,
        constraint_type: "script_transformation",
        usage_instructions: [
          "Usar o roteiro original como matéria-prima narrativa",
          "Preservar assunto e intenção do texto original",
          preserveMeaning ? "Preservar significado/núcleo semântico original" : "Pode adaptar significado livremente",
          "Injetar estrutura viral da base MVP (blocos, ritmo, tensão, CTA, micro-picos)",
          "Não substituir tudo por um contexto genérico",
          "O roteiro original deve influenciar diretamente o conteúdo dos slots",
        ],
      };
    }

    // ═══════════════════════════════════════════════════
    // 13. DATA FAMILIES + VALIDATION SUMMARY
    // ═══════════════════════════════════════════════════
    const dataFamilies: Record<string, { loaded: boolean; count: number }> = {
      dna_preset_v3: { loaded: !!dnaPresetBootstrap, count: dnaPresetBootstrap ? 1 : 0 },
      dna_formal: { loaded: !!dnaFormal, count: dnaFormal ? 1 : 0 },
      verbal_intelligence: { loaded: (verbalIntel?.length ?? 0) > 0, count: verbalIntel?.length ?? 0 },
      verbal_layers: { loaded: (verbalLayers?.length ?? 0) > 0, count: verbalLayers?.length ?? 0 },
      verbal_sequences: { loaded: (verbalSequences?.length ?? 0) > 0, count: verbalSequences?.length ?? 0 },
      canonical_units: { loaded: (canonicalUnits?.length ?? 0) > 0, count: canonicalUnits?.length ?? 0 },
      performance_weights: { loaded: (perfWeights?.length ?? 0) > 0, count: perfWeights?.length ?? 0 },
      performance_correlations: { loaded: (perfCorrelation?.length ?? 0) > 0, count: perfCorrelation?.length ?? 0 },
      cta_profiles: { loaded: (ctaProfiles?.length ?? 0) > 0, count: ctaProfiles?.length ?? 0 },
      cta_deep_analysis: { loaded: (ctaDeep?.length ?? 0) > 0, count: ctaDeep?.length ?? 0 },
      cta_events: { loaded: (ctaEvents?.length ?? 0) > 0, count: ctaEvents?.length ?? 0 },
      cohort_summaries: { loaded: (cohortSummary?.length ?? 0) > 0, count: cohortSummary?.length ?? 0 },
      cohorts: { loaded: (cohorts?.length ?? 0) > 0, count: cohorts?.length ?? 0 },
      word_patterns: { loaded: (wordPatterns?.length ?? 0) > 0, count: wordPatterns?.length ?? 0 },
      block_semantics: { loaded: (blockSemantics?.length ?? 0) > 0, count: blockSemantics?.length ?? 0 },
      block_phrases: { loaded: (blockPhrases?.length ?? 0) > 0, count: blockPhrases?.length ?? 0 },
      micro_events: { loaded: (microEvents?.length ?? 0) > 0, count: microEvents?.length ?? 0 },
      temporal_profiles: { loaded: (temporalProfiles?.length ?? 0) > 0, count: temporalProfiles?.length ?? 0 },
      judge_results: { loaded: (judgeResults?.length ?? 0) > 0, count: judgeResults?.length ?? 0 },
      visual_blocks: { loaded: (visualBlocks?.length ?? 0) > 0, count: visualBlocks?.length ?? 0 },
      visual_emotion_seq: { loaded: (visualEmotionSeq?.length ?? 0) > 0, count: visualEmotionSeq?.length ?? 0 },
      text_visual_alignment: { loaded: (textVisualAlign?.length ?? 0) > 0, count: textVisualAlign?.length ?? 0 },
      text_image_compatibility: { loaded: (textImageCompat?.length ?? 0) > 0, count: textImageCompat?.length ?? 0 },
      video_frames: { loaded: (videoFrames?.length ?? 0) > 0, count: videoFrames?.length ?? 0 },
      viral_word_combos: { loaded: (viralWordCombos?.length ?? 0) > 0, count: viralWordCombos?.length ?? 0 },
      viral_combination_patterns: { loaded: (viralCombPatterns?.length ?? 0) > 0, count: viralCombPatterns?.length ?? 0 },
      viral_emotional_patterns: { loaded: (viralEmotionalPat?.length ?? 0) > 0, count: viralEmotionalPat?.length ?? 0 },
      viral_sequence_patterns: { loaded: (viralSeqPatterns?.length ?? 0) > 0, count: viralSeqPatterns?.length ?? 0 },
      viral_timing_patterns: { loaded: (viralTimingPat?.length ?? 0) > 0, count: viralTimingPat?.length ?? 0 },
      viral_visual_patterns: { loaded: (viralVisualPat?.length ?? 0) > 0, count: viralVisualPat?.length ?? 0 },
      verbal_noise: { loaded: (verbalNoise?.length ?? 0) > 0, count: verbalNoise?.length ?? 0 },
      outliers: { loaded: (outliers?.length ?? 0) > 0, count: outliers?.length ?? 0 },
      readiness_reports: { loaded: !!latestReadiness, count: latestReadiness ? 1 : 0 },
      consistency_reports: { loaded: (consistencyReports?.length ?? 0) > 0, count: consistencyReports?.length ?? 0 },
      viral_phrase_bank: { loaded: (viralPhraseBank?.length ?? 0) > 0, count: viralPhraseBank?.length ?? 0 },
      few_shot_examples: { loaded: fewShot.length > 0, count: fewShot.length },
      semantic_patterns: { loaded: (semanticPatterns?.length ?? 0) > 0, count: semanticPatterns?.length ?? 0 },
      block_verbal_analysis: { loaded: (blockVerbalAnalysis?.length ?? 0) > 0, count: blockVerbalAnalysis?.length ?? 0 },
      verbal_phase2_profile: { loaded: (verbalPhase2?.length ?? 0) > 0, count: verbalPhase2?.length ?? 0 },
      viral_lexicon_global: { loaded: (viralLexicon?.length ?? 0) > 0, count: viralLexicon?.length ?? 0 },
      viral_verbal_patterns: { loaded: (viralVerbalPat?.length ?? 0) > 0, count: viralVerbalPat?.length ?? 0 },
    };

    // Add video reference family if in video mode
    if (inputMode === "video") {
      dataFamilies["video_reference"] = {
        loaded: !!referenceVideoData,
        count: referenceVideoData ? 1 : 0,
      };
    }

    const missingFamilies: string[] = [];
    // A valid v3 preset contains the same operational concepts as these
    // historical tables (block strategy, rhythm and structural contract).
    // Keep their absence visible as non-critical diagnostics, but do not
    // reject a context that can be generated safely from the preset itself.
    if (!dnaPresetBootstrap) {
      if (!dnaFormal) missingFamilies.push("dna_base_v2_formal");
      if (!verbalIntel || verbalIntel.length === 0) missingFamilies.push("verbal_intelligence_summary");
      if (!verbalLayers || verbalLayers.length === 0) missingFamilies.push("verbal_layer_patterns");
      if (!perfWeights || perfWeights.length === 0) missingFamilies.push("pattern_performance_weights");
    }

    // Mode-specific validation
    if (inputMode === "video" && !referenceVideoData) {
      missingFamilies.push("video_reference (nenhum vídeo de referência carregado)");
    }

    const insufficientFamilies: string[] = [];
    for (const [name, info] of Object.entries(dataFamilies)) {
      if (!info.loaded && !missingFamilies.includes(name)) {
        insufficientFamilies.push(name);
      }
    }

    const slotsReady = slots.filter((s: any) => s.generation_ready).length;
    const slotsTotal = slots.length;
    const allSlotsReady = slotsReady === slotsTotal && slotsTotal > 0;

    let status: string;
    let statusReason: string | null = null;

    if (missingFamilies.length > 0) {
      status = "insufficient_data";
      statusReason = `Famílias críticas ausentes: ${missingFamilies.join(", ")}`;
    } else if (!allSlotsReady) {
      status = "incomplete";
      const notReady = slots.filter((s: any) => !s.generation_ready);
      statusReason = `${slotsReady}/${slotsTotal} slots prontos. Pendentes: ${notReady.map((s: any) => `${s.slot_type} (${(s.missing_fields ?? []).join(", ")})`).join("; ")}`;
    } else {
      status = "ready";
    }

    // ═══════════════════════════════════════════════════
    // 14. INPUT RESOLUTION & INPUT TRACE
    // ═══════════════════════════════════════════════════
    const input_resolution = {
      reference_video_id: referenceVideoId ?? null,
      theme: theme ?? null,
      niche: niche ?? null,
      objective: objective ?? null,
      original_script_present: !!originalScript,
      original_script_length: originalScript ? originalScript.length : null,
      preserve_meaning: preserveMeaning ?? null,
      language: language ?? null,
      notes_present: !!notes,
      dna_preset_requested_id: dnaPresetId ?? null,
      dna_preset_resolved_id: dnaPresetBootstrap?.id ?? null,
      dna_preset_resolution: dnaPresetResolutionMode,
      reference_video_loaded: inputMode === "video" ? !!referenceVideoData : null,
      reference_video_source: inputMode === "video"
        ? (referenceVideoData ? "uploaded" : null)
        : null,
      reference_video_assets_loaded: inputMode === "video" ? videoTablesUsed : null,
    };

    const modeSpecificConstraintsApplied: string[] = [];
    if (video_reference_context) modeSpecificConstraintsApplied.push("video_reference_context");
    if (theme_constraints) modeSpecificConstraintsApplied.push("theme_constraints");
    if (transform_constraints) modeSpecificConstraintsApplied.push("transform_constraints");

    const input_trace = {
      input_mode: inputMode,
      input_resolution,
      reference_video_loaded: inputMode === "video" ? !!referenceVideoData : null,
      video_tables_used: inputMode === "video" ? videoTablesUsed : null,
      blueprint_id_used: blueprint.id,
      blueprint_resolution_mode: blueprintResolutionMode,
      blueprint_resolution_reason: blueprintResolutionReason,
      dna_preset_id_used: dnaPresetBootstrap?.id ?? null,
      dna_preset_resolution_mode: dnaPresetResolutionMode,
      mode_specific_constraints_applied: modeSpecificConstraintsApplied,
      theme_mode_used_base_families: inputMode === "theme"
        ? Object.entries(dataFamilies).filter(([_, f]) => f.loaded).map(([name]) => name)
        : null,
    };

    // ═══════════════════════════════════════════════════
    // 15. SOURCE TRACE
    // ═══════════════════════════════════════════════════
    const tables_used = [
      { table: "blueprint_contexts", filters: { id: blueprint.id }, record_count: 1 },
      {
        table: "dataset_cohort",
        filters: { dna_preset_id: dnaPresetBootstrap?.id ?? null, resolution: dnaPresetResolutionMode },
        record_count: dnaPresetBootstrap ? 1 : 0,
      },
      { table: "dna_base_v2_formal", filters: { latest: true }, record_count: dnaFormal ? 1 : 0 },
      { table: "videos", filters: { status: "completed" }, record_count: videoIds.length },
      { table: "video_blocks", filters: {}, record_count: (blocks ?? []).length },
      { table: "verbal_intelligence_summary", filters: {}, record_count: (verbalIntel ?? []).length },
      { table: "verbal_layer_patterns", filters: {}, record_count: (verbalLayers ?? []).length },
      { table: "verbal_narrative_sequences", filters: {}, record_count: (verbalSequences ?? []).length },
      { table: "verbal_canonical_units", filters: { is_top_ranked: true, limit: 100 }, record_count: (canonicalUnits ?? []).length },
      { table: "pattern_performance_weights", filters: { limit: 50 }, record_count: (perfWeights ?? []).length },
      { table: "performance_correlation", filters: {}, record_count: (perfCorrelation ?? []).length },
      { table: "cta_profiles", filters: {}, record_count: (ctaProfiles ?? []).length },
      { table: "cta_deep_analysis", filters: {}, record_count: (ctaDeep ?? []).length },
      { table: "video_cta_events", filters: {}, record_count: (ctaEvents ?? []).length },
      { table: "cohort_analysis_summary", filters: {}, record_count: (cohortSummary ?? []).length },
      { table: "dataset_cohort", filters: {}, record_count: (cohorts ?? []).length },
      { table: "dataset_cohort_videos", filters: {}, record_count: (cohortVideos ?? []).length },
      { table: "block_word_patterns", filters: { limit: 500 }, record_count: (wordPatterns ?? []).length },
      { table: "block_semantic_patterns", filters: {}, record_count: (blockSemantics ?? []).length },
      { table: "block_phrase_patterns", filters: {}, record_count: (blockPhrases ?? []).length },
      { table: "video_micro_events", filters: {}, record_count: (microEvents ?? []).length },
      { table: "video_temporal_profile", filters: {}, record_count: (temporalProfiles ?? []).length },
      { table: "narrative_judge_results", filters: {}, record_count: (judgeResults ?? []).length },
      { table: "visual_block_analysis", filters: {}, record_count: (visualBlocks ?? []).length },
      { table: "visual_emotion_sequence", filters: {}, record_count: (visualEmotionSeq ?? []).length },
      { table: "text_visual_alignment", filters: {}, record_count: (textVisualAlign ?? []).length },
      { table: "text_image_compatibility", filters: {}, record_count: (textImageCompat ?? []).length },
      { table: "video_frames", filters: {}, record_count: (videoFrames ?? []).length },
      { table: "viral_word_combinations", filters: {}, record_count: (viralWordCombos ?? []).length },
      { table: "viral_combination_patterns", filters: {}, record_count: (viralCombPatterns ?? []).length },
      { table: "viral_emotional_patterns", filters: {}, record_count: (viralEmotionalPat ?? []).length },
      { table: "viral_sequence_patterns", filters: {}, record_count: (viralSeqPatterns ?? []).length },
      { table: "viral_timing_patterns", filters: {}, record_count: (viralTimingPat ?? []).length },
      { table: "viral_visual_patterns", filters: {}, record_count: (viralVisualPat ?? []).length },
      { table: "verbal_noise_archive", filters: {}, record_count: (verbalNoise ?? []).length },
      { table: "outlier_detection", filters: {}, record_count: (outliers ?? []).length },
      { table: "readiness_reports", filters: { latest: true }, record_count: latestReadiness ? 1 : 0 },
      { table: "validation_reports", filters: { limit: 20 }, record_count: (validationReports ?? []).length },
      { table: "data_consistency_reports", filters: {}, record_count: (consistencyReports ?? []).length },
      { table: "viral_phrase_bank", filters: {}, record_count: (viralPhraseBank ?? []).length },
      { table: "semantic_patterns", filters: {}, record_count: (semanticPatterns ?? []).length },
      { table: "block_verbal_analysis", filters: {}, record_count: (blockVerbalAnalysis ?? []).length },
      { table: "verbal_phase2_profile", filters: {}, record_count: (verbalPhase2 ?? []).length },
      { table: "viral_lexicon_global", filters: {}, record_count: (viralLexicon ?? []).length },
      { table: "viral_verbal_patterns", filters: {}, record_count: (viralVerbalPat ?? []).length },
    ];

    const loadedCount = Object.values(dataFamilies).filter(f => f.loaded).length;
    const missingCount = Object.values(dataFamilies).filter(f => !f.loaded).length;
    const totalFamilies = Object.keys(dataFamilies).length;

    const data_families_loaded_summary = {
      total_families: totalFamilies,
      loaded_count: loadedCount,
      missing_count: missingCount,
      missing_names: Object.entries(dataFamilies).filter(([_, f]) => !f.loaded).map(([name]) => name),
    };

    const physical_tables_traced_summary = {
      traced_count: tables_used.length,
      tables_with_data: tables_used.filter(t => t.record_count > 0).length,
      tables_empty: tables_used.filter(t => t.record_count === 0).length,
      empty_table_names: tables_used.filter(t => t.record_count === 0).map(t => t.table),
      total_records_loaded: tables_used.reduce((sum, t) => sum + t.record_count, 0),
    };

    const source_trace = {
      dna_formal_id: dnaFormal?.id ?? null,
      dna_preset_id: dnaPresetBootstrap?.id ?? null,
      dna_preset_name: dnaPresetBootstrap?.name ?? null,
      dna_preset_resolution: dnaPresetResolutionMode,
      blueprint_id: blueprint.id,
      generated_at: new Date().toISOString(),
      mode: inputMode,
      input_trace,
      data_families_loaded_summary,
      physical_tables_traced_summary,
      tables_used,
    };

    const validation_summary = {
      status,
      status_reason: statusReason,
      data_families: dataFamilies,
      data_families_loaded_summary,
      physical_tables_traced_summary,
      missing_critical: missingFamilies,
      insufficient_non_critical: insufficientFamilies,
      slots_ready: slotsReady,
      slots_total: slotsTotal,
      outlier_contamination: outlierFlagged.length > 0 ? {
        flagged_count: outlierFlagged.length,
        flagged_video_ids: outlierFlagged.map((o: any) => o.video_id),
      } : null,
      readiness_score: latestReadiness?.readiness_score ?? null,
      critical_consistency_issues: criticalIssues.length,
    };

    // ═══════════════════════════════════════════════════
    // 16. CONTEXT PAYLOAD COMPLETO (with mode-specific blocks)
    // ═══════════════════════════════════════════════════
    const context_payload: any = {
      scope_resolution,
      dna_preset_bootstrap: dnaPresetBootstrap ? {
        preset_id: dnaPresetBootstrap.id,
        preset_name: dnaPresetBootstrap.name,
        resolution: dnaPresetResolutionMode,
        total_source_videos: dnaPresetBootstrap.stylePack.total_videos,
        dominant_sequence: dnaPresetBootstrap.stylePack.dominant_sequence,
        strategy_contract: dnaPresetBootstrap.stylePack.strategy_contract,
        structural_contract: dnaPresetBootstrap.stylePack.structural_contract,
        strategy_types: Object.keys(dnaPresetBootstrap.strategies).sort(),
        source_text_included: false,
      } : null,
      structural_plan,
      verbal_plan,
      lexical_plan,
      semantic_plan,
      phrase_plan,
      combination_plan,
      emotional_plan,
      micropeak_plan,
      visual_sync_plan,
      cta_payoff_plan,
      noise_guardrails,
      cluster_context,
      outlier_context,
      readiness_context,
      few_shot_examples: fewShot,
      performance_patterns: (perfWeights ?? []).slice(0, 20).map((p: any) => ({
        pattern_type: p.pattern_type, pattern_value: p.pattern_value,
        strength_score: p.strength_score, frequency: p.frequency,
      })),
      correlations: (perfCorrelation ?? []).map((c: any) => ({
        pattern_type: c.pattern_type, pattern_name: c.pattern_name,
        correlation_engagement: c.correlation_with_engagement,
        correlation_views: c.correlation_with_views,
      })),
    };

    // Inject mode-specific blocks
    if (video_reference_context) {
      context_payload.video_reference_context = video_reference_context;
    }
    if (theme_constraints) {
      context_payload.theme_constraints = theme_constraints;
    }
    if (transform_constraints) {
      context_payload.transform_constraints = transform_constraints;
    }

    // ═══════════════════════════════════════════════════
    // 17. PERSIST
    // ═══════════════════════════════════════════════════
    const seqStr = slots.map((s: any) => s.slot_type.substring(0, 3).toUpperCase()).join(" → ");
    const modeLabel = inputMode === "video" ? "VID" : inputMode === "theme" ? "THM" : "TRF";
    const generationName = `Generation [${modeLabel}] ${seqStr} V1`;

    const persistPayload: Record<string, any> = {
      source_blueprint_id: blueprint.id,
      generation_name: generationName,
      slot_sequence: slots,
      slot_count_expected: slotsTotal,
      generation_rules: {
        input_mode: inputMode,
        input_resolution,
        input_trace,
        context_payload,
        source_trace,
        validation_summary,
      },
      status,
    };
    persistPayload.user_id = requestUserId;

    const { data: saved, error: saveErr } = await sb
      .from("generation_contexts")
      .insert(persistPayload)
      .select()
      .single();

    if (saveErr) throw saveErr;

    // Log validation if insufficient
    if (status === "insufficient_data") {
      await sb.from("validation_reports").insert({
        validation_type: "autoprotect_block",
        report_data: {
          module: "build-complete-generation-context",
          input_mode: inputMode,
          reason: statusReason,
          missing_families: missingFamilies,
          insufficient_families: insufficientFamilies,
        },
      });
    }

    return json({
      status,
      status_reason: statusReason,
      generation_context_id: saved.id,
      generation_context: {
        id: saved.id,
        generation_name: saved.generation_name,
        slot_count: slotsTotal,
        slots_ready: slotsReady,
        source_blueprint_id: blueprint.id,
        source_dna_formal_id: dnaFormal?.id ?? null,
        source_dna_preset_id: dnaPresetBootstrap?.id ?? null,
        dna_preset_resolution: dnaPresetResolutionMode,
        input_mode: inputMode,
        input_resolution,
        input_trace,
        data_families_loaded_summary,
        physical_tables_traced_summary,
        validation_summary,
        source_trace,
        data_families_loaded: dataFamilies,
      },
    });
  } catch (err: unknown) {
    console.error("build-complete-generation-context error:", err);
    if (err instanceof EdgeAuthError) {
      return json({ error: err.message, error_code: err.code }, err.status);
    }
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
