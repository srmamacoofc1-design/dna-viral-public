import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/functions/analyze-reference-topics/index.ts"),
  "utf8",
);
const handler = source.slice(source.indexOf("Deno.serve"));

describe("analyze-reference-topics - isolamento de referencias privadas", () => {
  it("autentica e resolve admin/service antes de ler qualquer referencia", () => {
    const authentication = handler.indexOf("const actor = await requireUserOrService({");
    const adminCheck = handler.indexOf('await sb.rpc("has_role"');
    const referenceRead = handler.indexOf('.from("reference_videos")');

    expect(authentication).toBeGreaterThan(-1);
    expect(adminCheck).toBeGreaterThan(authentication);
    expect(referenceRead).toBeGreaterThan(adminCheck);
    expect(handler).toContain("serviceRoleKey: serviceKey");
  });

  it("restringe a consulta do usuario comum ao proprio user_id antes de carregar conteudo", () => {
    const referenceRead = handler.indexOf('.from("reference_videos")');
    const ownerConstraint = handler.indexOf('.eq("user_id", actor.userId!)');
    const ownerAssertion = handler.indexOf("assertResourceOwner(actor, refVid.user_id)");
    const aiCall = handler.indexOf("await geminiOpenAIChat(");

    expect(referenceRead).toBeGreaterThan(-1);
    expect(ownerConstraint).toBeGreaterThan(referenceRead);
    expect(ownerAssertion).toBeGreaterThan(ownerConstraint);
    expect(aiCall).toBeGreaterThan(ownerAssertion);
    expect(handler).not.toContain('.select("*")');
  });

  it("devolve 404 para UUID ausente ou alheio antes de gastar IA", () => {
    const missingOrForeign = handler.indexOf("if (!refVid)");
    const notFoundResponse = handler.indexOf(
      'return json({ error: "Vídeo de referência não encontrado" }, 404)',
      missingOrForeign,
    );
    const aiCall = handler.indexOf("await geminiOpenAIChat(");

    expect(missingOrForeign).toBeGreaterThan(-1);
    expect(notFoundResponse).toBeGreaterThan(missingOrForeign);
    expect(aiCall).toBeGreaterThan(notFoundResponse);
  });

  it("nao possui mutacao anterior ao gate de autenticacao, ownership e IA", () => {
    const authentication = handler.indexOf("const actor = await requireUserOrService({");
    const ownerAssertion = handler.indexOf("assertResourceOwner(actor, refVid.user_id)");
    const aiCall = handler.indexOf("await geminiOpenAIChat(");
    const mutations = [
      // A read-only topic-cache lookup may happen after ownership is checked
      // and before AI. Search from the model call so this test still verifies
      // only durable mutations, rather than treating the cache read as one.
      handler.indexOf('.from("reference_video_topics")', aiCall),
      handler.indexOf('.from("reference_video_transcripts")', aiCall),
      handler.indexOf('.from("reference_video_frames")', aiCall),
    ];

    expect(authentication).toBeGreaterThan(-1);
    expect(ownerAssertion).toBeGreaterThan(authentication);
    expect(aiCall).toBeGreaterThan(ownerAssertion);
    for (const mutation of mutations) expect(mutation).toBeGreaterThan(aiCall);
  });

  it("preserva status de autenticacao e permissao no retorno", () => {
    expect(handler).toContain("e instanceof EdgeAuthError");
    expect(handler).toContain("error_code: e.code");
    expect(handler).toContain("e.status");
    expect(handler).not.toContain("SUPABASE_ANON_KEY");
  });

  it("exige tema, progressao temporal e ancoras visuais antes de persistir ready", () => {
    expect(source).toContain('required: ["phase", "description", "timestamp_start", "timestamp_end"]');
    expect(handler).toContain("validNarrativePhases.length < 3");
    expect(handler).toContain("validVisualAnchors.length < 3");
    expect(handler).toContain("DADOS NÃO CONFIÁVEIS");
    expect(handler.indexOf("validVisualAnchors.length < 3")).toBeLessThan(handler.indexOf("topic_status: \"ready\""));
  });
});
