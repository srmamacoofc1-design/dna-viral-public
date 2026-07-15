import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  resolvePromotedBlockIndex,
  sortPromotableScriptBlocks,
} from "../../../supabase/functions/_shared/promoted-script-blocks";

describe("promoted script block indexes", () => {
  it("prefers index and falls back to slot_index when needed", () => {
    expect(resolvePromotedBlockIndex({ index: 4, slot_index: 40 })).toBe(4);
    expect(resolvePromotedBlockIndex({ index: "invalid", slot_index: "7" })).toBe(7);
    expect(resolvePromotedBlockIndex({ index: null, slot_index: 6 })).toBe(6);
    expect(resolvePromotedBlockIndex({ slot_index: 2 })).toBe(2);
    expect(resolvePromotedBlockIndex({})).toBeNull();
  });

  it("sorts both assembly formats numerically and keeps unindexed blocks stable at the end", () => {
    const blocks = [
      { generated_text: "unindexed-a" },
      { slot_index: "10", generated_text: "ten" },
      { index: 2, generated_text: "two" },
      { slot_index: 1, generated_text: "one" },
      { generated_text: "unindexed-b" },
    ];

    expect(sortPromotableScriptBlocks(blocks).map((block) => block.generated_text)).toEqual([
      "one",
      "two",
      "ten",
      "unindexed-a",
      "unindexed-b",
    ]);
  });

  it("uses the resolved index for both promoted block fields", () => {
    const promoter = fs.readFileSync(
      path.resolve(__dirname, "../../../supabase/functions/promote-script-final/index.ts"),
      "utf8",
    );
    expect(promoter).toContain("sortPromotableScriptBlocks(scriptBlocks)");
    expect(promoter).toContain("const blockIndex = resolvePromotedBlockIndex(block)");
    expect(promoter).toContain("index: blockIndex");
    expect(promoter).toContain("slot_index: blockIndex");
  });
});
