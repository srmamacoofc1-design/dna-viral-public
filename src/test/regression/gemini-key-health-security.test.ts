import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const handlerPath = path.resolve(
  __dirname,
  "../../../supabase/functions/gemini-key-health/index.ts",
);
const source = fs.readFileSync(handlerPath, "utf8");

describe("gemini-key-health security contract", () => {
  it("authorizes admin/service before reading the key pool or contacting providers", () => {
    const optionsReturn = source.indexOf('req.method === "OPTIONS"');
    const authorization = source.indexOf("await authorizeLibraryAdminOrServiceRequest(");
    const poolRead = source.indexOf("getGeminiApiKeys()");
    const providerProbe = source.indexOf("await probePath(");

    expect(authorization).toBeGreaterThan(optionsReturn);
    expect(poolRead).toBeGreaterThan(authorization);
    expect(providerProbe).toBeGreaterThan(poolRead);
  });

  it("bounds every provider request and global concurrency", () => {
    expect(source).toContain("const REQUEST_TIMEOUT_MS = 12_000;");
    expect(source).toContain("const MAX_CONCURRENCY = 4;");
    expect(source).toContain("Math.min(MAX_CONCURRENCY, totalTasks)");
    expect(source).toContain("controller.abort()");
  });

  it("tests both provider paths with the configured model", () => {
    expect(source).toContain('"openai_compatible"');
    expect(source).toContain('"native_generate_content"');
    expect(source).toContain("/v1beta/openai/chat/completions");
    expect(source).toContain(":generateContent");
    expect(source).toContain("const model = normalizeGeminiModel(undefined);");
  });

  it("never reads, logs, or serializes provider bodies or credentials", () => {
    expect(source).not.toMatch(/response\.(?:text|json|arrayBuffer|blob|formData)\s*\(/);
    expect(source).not.toMatch(/console\.(?:log|info|warn|error|debug)\s*\(/);
    expect(source).toContain("await response.body?.cancel()");
    const responseCalls = [...source.matchAll(/return jsonResponse\((.+)\);/g)]
      .map((match) => match[1]);
    expect(responseCalls).toHaveLength(4);
    for (const payload of responseCalls) {
      expect(payload).not.toMatch(/apiKey|api_key|\bkeys\b|\bmodel\b|headers|request|response|body/i);
    }

    const outcomeContract = source.slice(
      source.indexOf("interface ProbeOutcome"),
      source.indexOf("interface ProbeTotals"),
    );
    expect(outcomeContract).toContain("http_status: number | null;");
    expect(outcomeContract).toContain("category: ProbeCategory;");
    expect(outcomeContract).toContain("latency_ms: number;");
    expect(outcomeContract).not.toMatch(/api.?key|credential|secret|body|headers|model/i);

    expect(source).toContain("return jsonResponse({ results, totals });");
    expect(source).not.toContain("String(error)");
    expect(source).not.toContain("error.message");
    expect(source).not.toContain("error.stack");
  });
});
