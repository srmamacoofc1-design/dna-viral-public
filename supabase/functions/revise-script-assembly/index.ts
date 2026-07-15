import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  assertResourceOwner,
  EdgeAuthError,
  internalFunctionHeaders,
  requireUserOrService,
} from "../_shared/edge-auth.ts";
import { assessRequiredViralReview, resolveScriptInputMode } from "../_shared/required-viral-review.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function invokeInternal(
  supabaseUrl: string,
  serviceKey: string,
  functionName: string,
  body: unknown,
): Promise<{ response: Response; payload: any }> {
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...internalFunctionHeaders(serviceKey),
    },
    body: JSON.stringify(body),
  });
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = { status_reason: `Resposta inválida de ${functionName}` };
  }
  return { response, payload };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);
    const actor = await requireUserOrService({ req, supabaseUrl, serviceRoleKey: serviceKey });

    const body = await req.json();
    const scriptAssemblyId = body?.script_assembly_id;
    if (!scriptAssemblyId) {
      return json({ status: "error", status_reason: "script_assembly_id é obrigatório" }, 400);
    }

    const { data: assembly, error: assemblyError } = await sb
      .from("script_assemblies")
      .select("*")
      .eq("id", scriptAssemblyId)
      .maybeSingle();
    if (assemblyError || !assembly) {
      return json({
        status: "insufficient_data",
        status_reason: assemblyError ? `DB error: ${assemblyError.message}` : "Script assembly não encontrado",
        source_script_assembly_id: scriptAssemblyId,
        new_script_assembly_id: null,
      }, 404);
    }
    assertResourceOwner(actor, assembly.user_id);

    if (!assembly.validation_result) {
      return json({
        status: "insufficient_data",
        status_reason: "A montagem ainda não foi validada",
        source_script_assembly_id: scriptAssemblyId,
        new_script_assembly_id: null,
      }, 422);
    }
    if (!Array.isArray(assembly.script_blocks) || assembly.script_blocks.length === 0) {
      return json({
        status: "insufficient_data",
        status_reason: "script_blocks está vazio",
        source_script_assembly_id: scriptAssemblyId,
        new_script_assembly_id: null,
      }, 422);
    }
    if (!assembly.source_generation_context_id) {
      return json({
        status: "insufficient_data",
        status_reason: "source_generation_context_id ausente",
        source_script_assembly_id: scriptAssemblyId,
        new_script_assembly_id: null,
      }, 422);
    }

    const { data: generationContext, error: contextError } = await sb
      .from("generation_contexts")
      .select("id, user_id, generation_rules")
      .eq("id", assembly.source_generation_context_id)
      .maybeSingle();
    if (contextError || !generationContext) {
      return json({
        status: "insufficient_data",
        status_reason: contextError ? `DB error: ${contextError.message}` : "Generation context não encontrado",
        source_script_assembly_id: scriptAssemblyId,
        new_script_assembly_id: null,
      }, 404);
    }
    assertResourceOwner(actor, generationContext.user_id);

    const stylePack = (generationContext.generation_rules as any)?.style_pack;
    if (!stylePack || stylePack.status !== "ready" || Number(stylePack.version) < 3) {
      return json({
        status: "dna_not_ready",
        status_reason: "Revisão bloqueada: pacote DNA v3 ausente",
        source_script_assembly_id: scriptAssemblyId,
        new_script_assembly_id: null,
      }, 422);
    }

    const inputMode = resolveScriptInputMode(null, generationContext.generation_rules);

    // Não existe caminho legado de revisão textual: toda revisão passa pelo
    // mesmo motor, guardas e evidência visual da geração original.
    const regeneratedCall = await invokeInternal(supabaseUrl, serviceKey, "assemble-script", {
      generation_context_id: generationContext.id,
      revision_feedback: {
        source_script_assembly_id: scriptAssemblyId,
        source_generation_context_id: generationContext.id,
        source_validation_version: assembly.validation_version,
        source_validation_status: assembly.validation_status,
        validation_result: assembly.validation_result,
      },
    });
    const regenerated = regeneratedCall.payload;
    const regeneratedId = regenerated?.script_assembly_id || regenerated?.assembly_id;
    if (!regeneratedCall.response.ok || !regeneratedId) {
      return json({
        status: "revision_failed",
        status_reason: regenerated?.status_reason || regenerated?.error || `assemble-script HTTP ${regeneratedCall.response.status}`,
        source_script_assembly_id: scriptAssemblyId,
        new_script_assembly_id: null,
      }, 422);
    }

    // Fail closed: a DNA-v3-valid script is still not eligible for revision
    // approval when the independent Viral Evaluator exhausted its safe loop.
    const viralReviewGate = assessRequiredViralReview(
      inputMode,
      regenerated?.writer_evaluator_loop,
    );
    if (viralReviewGate.passed !== true) {
      return json({
        status: "revision_failed",
        status_reason: viralReviewGate.reason
          || "A nova montagem não atingiu o gate estimado do Avaliador Viral",
        source_script_assembly_id: scriptAssemblyId,
        new_script_assembly_id: null,
        failed_script_assembly_id: regeneratedId,
        assemble_status: regenerated?.status || null,
        summary: regenerated?.summary || null,
        writer_evaluator_loop: regenerated.writer_evaluator_loop,
      }, 422);
    }

    const assemblePassed = regenerated?.status === "draft"
      && Number(regenerated?.summary?.required_missing || 0) === 0
      && Number(regenerated?.summary?.strategy_failed_slots || 0) === 0
      && Number(regenerated?.summary?.error_slots || 0) === 0;
    if (!assemblePassed) {
      return json({
        status: "revision_failed",
        status_reason: regenerated?.status_reason || "A nova montagem não passou pelo contrato DNA v3",
        source_script_assembly_id: scriptAssemblyId,
        new_script_assembly_id: null,
        failed_script_assembly_id: regeneratedId,
        assemble_status: regenerated?.status || null,
        summary: regenerated?.summary || null,
      }, 422);
    }

    const validationCall = await invokeInternal(supabaseUrl, serviceKey, "validate-script-against-dna", {
      script_assembly_id: regeneratedId,
    });
    const validation = validationCall.payload;
    if (!validationCall.response.ok || validation?.validation_status !== "approved") {
      return json({
        status: "revision_failed",
        status_reason: validation?.status_reason || validation?.error || "A nova montagem falhou na validação DNA v3",
        source_script_assembly_id: scriptAssemblyId,
        new_script_assembly_id: null,
        failed_script_assembly_id: regeneratedId,
        validation_status: validation?.validation_status || null,
        summary: validation?.summary || regenerated?.summary || null,
      }, 422);
    }

    const { data: regeneratedRow, error: regeneratedError } = await sb
      .from("script_assemblies")
      .select("assembly_rules")
      .eq("id", regeneratedId)
      .single();
    if (regeneratedError) throw regeneratedError;
    const regeneratedRules = typeof regeneratedRow?.assembly_rules === "object" && regeneratedRow.assembly_rules !== null
      ? regeneratedRow.assembly_rules
      : {};
    const { error: traceError } = await sb.from("script_assemblies").update({
      assembly_rules: {
        ...regeneratedRules,
        revision_trace: {
          source_script_assembly_id: scriptAssemblyId,
          source_validation_status: assembly.validation_status,
          strategy: "full_dna_v3_regeneration",
          revised_at: new Date().toISOString(),
          validated: true,
          viral_review_passed: viralReviewGate.required ? viralReviewGate.passed : null,
          viral_review_iterations: regenerated?.writer_evaluator_loop?.iterations_completed ?? null,
          formal_feedback_fingerprint: (regeneratedRules as any)?.formal_revision_feedback?.fingerprint ?? null,
        },
      },
    }).eq("id", regeneratedId);
    if (traceError) throw traceError;

    return json({
      status: "revised",
      status_reason: "Montagem regenerada e aprovada pelo contrato DNA v3",
      source_script_assembly_id: scriptAssemblyId,
      new_script_assembly_id: regeneratedId,
      summary: regenerated?.summary || null,
      validation_status: validation.validation_status,
      writer_evaluator_loop: regenerated?.writer_evaluator_loop || null,
      total_latency_ms: Date.now() - startedAt,
    });
  } catch (err: any) {
    console.error("revise-script-assembly error:", err);
    if (err instanceof EdgeAuthError) {
      return json({ status: "auth_error", error_code: err.code, status_reason: err.message }, err.status);
    }
    return json({ status: "error", status_reason: err?.message || "Erro inesperado" }, 500);
  }
});
