import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migratedFunctions = [
  "analyze-reference-topics",
  "assemble-script",
  "judge-narrative",
  "validate-script-against-dna",
  "extract-cta-deep-v2",
  "rescrape-engagement",
] as const;

function readFunction(name: string): string {
  return fs.readFileSync(
    path.resolve(__dirname, `../../../supabase/functions/${name}/index.ts`),
    "utf8",
  );
}

describe("Edge Functions — migração para rotação Gemini", () => {
  it.each(migratedFunctions)("%s usa somente o helper Gemini compartilhado", (name) => {
    const source = readFunction(name);

    expect(source).toContain('../_shared/gemini-rotation.ts');
    expect(source).toContain("hasGeminiApiKeys");
    expect(source).toContain("geminiOpenAIChat");
    expect(source).not.toContain("LOVABLE_API_KEY");
    expect(source).not.toContain("ai.gateway.lovable.dev");
    expect(source).not.toMatch(/Authorization\s*:\s*`Bearer/);
  });

  it("preserva os contratos JSON estruturados e a entrada multimodal", () => {
    const topics = readFunction("analyze-reference-topics");
    const engagement = readFunction("rescrape-engagement");

    expect(topics).toContain("tools: [topicAnalysisTool]");
    expect(topics).toContain('name: "save_topic_analysis"');
    expect(topics).toContain("tool_choice:");
    expect(engagement).toContain('type: "image_url"');
    expect(engagement).toContain('name: "extract_engagement"');
    expect(engagement).toContain("tool_choice:");
  });

  it("preserva o loop Escritor/Avaliador e seus guardas fail-closed", () => {
    const assembly = readFunction("assemble-script");
    const validation = readFunction("validate-script-against-dna");

    expect(assembly).toContain("runViralWriterEvaluatorLoop({");
    expect(assembly).toContain("evaluateDraftAsViralEvaluator");
    expect(assembly).toContain("reviseDraftAsDnaWriter");
    expect(assembly).toContain("assessProtectedCopyGuard");
    expect(assembly).toContain("passed: false");
    expect(validation).toContain("visual_judge_error");
    expect(validation).toContain('criterion(false, "ai_inference"');
  });

  it("agrupa todos os julgamentos semanticos em uma unica chamada limitada", () => {
    const validation = readFunction("validate-script-against-dna");

    expect(validation).toContain("evaluateSlotSemanticBundle");
    expect(validation).toContain("evaluateSemanticBatch");
    expect(validation).toContain("SEMANTIC_VALIDATION_PROVIDER_CALLS_MAX = 1");
    expect(validation).toContain('semantic_validation_mode: "single_batched_judge_for_all_slots"');
    expect(validation).toContain("totalAIInferenceCriteria");
    expect(validation).not.toContain("await evalCTAAlignment(");
    expect(validation).not.toContain("await evalPayoffAlignment(");
    expect(validation).not.toContain("await evalEmotionalAlignment(");
    expect(validation).not.toContain("await evalMicropeakAlignment(");
    expect(validation).not.toContain("await evalVisualSyncAlignment(");
  });

  it("falha explicitamente quando nenhuma chave Gemini está configurada", () => {
    for (const name of migratedFunctions) {
      const source = readFunction(name);
      expect(source.indexOf("hasGeminiApiKeys()"), name).toBeGreaterThan(-1);
      expect(source, name).toContain("GEMINI_API_KEY");
    }
  });
});
