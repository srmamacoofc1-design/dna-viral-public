import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const functionsRoot = path.resolve(__dirname, "../../../supabase/functions");

const migratedFunctions = [
  "analyze-narrative",
  "extract-block-semantics",
  "generate-early-event",
  "generate-hook-suggestions",
  "translate",
  "import-spreadsheet",
] as const;

const readFunction = (name: (typeof migratedFunctions)[number]) =>
  fs.readFileSync(path.join(functionsRoot, name, "index.ts"), "utf8");

describe("Gemini text and vision function migration", () => {
  it.each(migratedFunctions)("routes %s through the shared Gemini rotation", (name) => {
    const source = readFunction(name);

    expect(source).toContain('../_shared/gemini-rotation.ts');
    expect(source).toContain("hasGeminiApiKeys(");
    expect(source).toContain("geminiOpenAIChat({");
    expect(source).toContain('model: "gemini-3.5-flash"');
    expect(source).not.toContain("LOVABLE_API_KEY");
    expect(source).not.toContain("ai.gateway.lovable.dev");
    expect(source).not.toContain('model: "google/');
  });

  it.each(["analyze-narrative", "extract-block-semantics", "translate", "import-spreadsheet"] as const)(
    "keeps structured tool output in %s",
    (name) => {
      const source = readFunction(name);
      expect(source).toContain("tools:");
      expect(source).toContain("tool_choice:");
      expect(source).toContain("message?.tool_calls?.[0]");
    },
  );

  it.each(["generate-early-event", "generate-hook-suggestions"] as const)(
    "keeps JSON-only suggestion output in %s",
    (name) => {
      const source = readFunction(name);
      expect(source).toContain('response_format: { type: "json_object" }');
      expect(source).toContain("JSON.parse(content.trim()");
      expect(source).toContain("outputAttempt < 2");
      expect(source).toContain("parsed.suggestions.length !== 3");
    },
  );

  it("keeps multimodal image input for spreadsheet engagement extraction", () => {
    const source = readFunction("import-spreadsheet");
    expect(source).toContain('type: "image_url"');
    expect(source).toContain('url: `data:${mimeType};base64,${imageBase64}`');
  });
});
