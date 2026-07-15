import { describe, expect, it } from "vitest";
import {
  sanitizePostgresJsonUnicode,
  sanitizePostgresText,
} from "../../../supabase/functions/_shared/unicode-safety";

describe("Postgres Unicode safety", () => {
  it("replaces NUL and lone surrogates while preserving valid Unicode pairs", () => {
    expect(sanitizePostgresText("antes\0depois")).toBe("antes\uFFFDdepois");
    expect(sanitizePostgresText("alto-\uD800-fim")).toBe("alto-\uFFFD-fim");
    expect(sanitizePostgresText("baixo-\uDC00-fim")).toBe("baixo-\uFFFD-fim");
    expect(sanitizePostgresText("emoji-\uD83D\uDE80-fim")).toBe("emoji-\uD83D\uDE80-fim");
  });

  it("sanitizes every nested Gemini string and object key before persistence", () => {
    const parsed = JSON.parse(
      '{"segments":[{"text":"fala\\u0000ruim"}],"moments":[{"description":"quebrado\\ud800"}],"chave\\udc00":"valor"}',
    );

    const sanitized = sanitizePostgresJsonUnicode(parsed);
    const serialized = JSON.stringify(sanitized);

    expect(sanitized).toEqual({
      segments: [{ text: "fala\uFFFDruim" }],
      moments: [{ description: "quebrado\uFFFD" }],
      "chave\uFFFD": "valor",
    });
    expect(serialized).not.toContain("\\u0000");
    expect(serialized).not.toMatch(/\\ud[89ab][0-9a-f]{2}|\\ud[c-f][0-9a-f]{2}/i);
  });
});
