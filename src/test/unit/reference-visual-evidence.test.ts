import { describe, expect, it } from "vitest";
import {
  assessReferenceVisualEvidenceContract,
  limitReferenceVisualTimelineByTimestamp,
  uniqueReferenceVisualTimestamps,
} from "../../../supabase/functions/_shared/reference-visual-evidence";

function row(
  timestamp: number,
  role: "reactor" | "embedded" | "unknown",
  description: string,
  subjectId = role === "reactor" ? "reactor_1" : role === "embedded" ? "embedded_subject_1" : "unknown_subject_1",
) {
  return {
    timestamp_seconds: timestamp,
    description,
    main_action: description,
    visual_elements: [],
    text_on_screen: "",
    subject_role: role,
    layer: role,
    region: role === "reactor" ? "bottom" : "full_frame",
    subject_id: subjectId,
  };
}

describe("reference visual layered evidence", () => {
  it("counts a reactor and embedded row at the same instant as one temporal sample", () => {
    const frames = [
      row(0, "embedded", "A pilot lifts a white object."),
      row(0, "reactor", "A man keeps a neutral facial expression."),
      row(3, "embedded", "The pilot walks toward a door."),
      row(3, "reactor", "The man raises his eyebrows."),
      row(6, "embedded", "The pilot opens the door."),
    ];

    expect(uniqueReferenceVisualTimestamps(frames).map((frame) => frame.timestamp_seconds)).toEqual([0, 3, 6]);
    const limited = limitReferenceVisualTimelineByTimestamp(frames, 3);
    expect(uniqueReferenceVisualTimestamps(limited)).toHaveLength(3);
    expect(limited.filter((frame) => frame.timestamp_seconds === 0).map((frame) => frame.layer).sort())
      .toEqual(["embedded", "reactor"]);
  });

  it("applies the cap to timestamps while retaining at most one row per reaction plane", () => {
    const frames = Array.from({ length: 35 }, (_, timestamp) => [
      row(timestamp * 2, "embedded", `Embedded physical action ${timestamp}.`, `embedded_subject_${timestamp + 1}`),
      row(timestamp * 2, "reactor", `Reactor facial expression ${timestamp}.`),
      row(timestamp * 2, "reactor", `Duplicate reactor detail ${timestamp}.`),
    ]).flat();

    const limited = limitReferenceVisualTimelineByTimestamp(frames, 30);
    expect(uniqueReferenceVisualTimestamps(limited)).toHaveLength(30);
    expect(limited.length).toBeLessThanOrEqual(60);
    expect(limited[0].timestamp_seconds).toBe(0);
    expect(limited.at(-1)?.timestamp_seconds).toBe(68);
    const byTimestamp = new Map<number, typeof limited>();
    for (const frame of limited) {
      const bucket = byTimestamp.get(frame.timestamp_seconds) || [];
      bucket.push(frame);
      byTimestamp.set(frame.timestamp_seconds, bucket);
    }
    expect([...byTimestamp.values()].every((bucket) => bucket.filter((frame) => frame.layer === "reactor").length <= 1))
      .toBe(true);
    expect([...byTimestamp.values()].every((bucket) => bucket.filter((frame) => frame.layer === "embedded").length <= 1))
      .toBe(true);
  });

  it("rejects the exact PQIc failure shape instead of silently treating it as direct footage", () => {
    const contract = assessReferenceVisualEvidenceContract([{
      ...row(
        0,
        "embedded",
        "An animated officer displays an object. A man is visible in the bottom layer, reacting with a neutral expression.",
      ),
      subject_id: "embedded_subject_1",
    }], { requireStructuredMetadata: true });

    expect(contract.reaction_layout_detected).toBe(true);
    expect(contract.passed).toBe(false);
    expect(contract.reasons).toContain("reaction_reactor_row_missing");
    expect(contract.reasons).toContain("reaction_opening_reactor_baseline_missing");
    expect(contract.reasons).toContain("reaction_frame_0_mixed_layers_in_single_row");
  });

  it("accepts a separated opening baseline and embedded action at the same timestamp", () => {
    const contract = assessReferenceVisualEvidenceContract([
      row(0, "embedded", "An animated pilot raises a white object."),
      row(0, "reactor", "A man in the bottom panel keeps a neutral facial expression."),
      row(3, "embedded", "The animated pilot lowers the object."),
    ], {
      requireStructuredMetadata: true,
      enforceObservableLanguage: true,
    });

    expect(contract.passed).toBe(true);
    expect(contract.reaction_layout_detected).toBe(true);
    expect(contract.unique_timestamps).toBe(2);
  });

  it("rejects a row that mentions the opposite screen region", () => {
    const embedded = {
      ...row(0, "embedded", "The man in the bottom frame stays neutral. In the top frame, a soldier raises a test."),
      region: "top_frame",
    };
    const reactor = {
      ...row(0, "reactor", "A man in the bottom frame stays neutral."),
      region: "bottom_frame",
    };
    const contract = assessReferenceVisualEvidenceContract([embedded, reactor], {
      requireStructuredMetadata: true,
    });

    expect(contract.passed).toBe(false);
    expect(contract.reasons).toContain("reaction_frame_0_opposing_region_in_single_row");
  });

  it("fails closed on relationship, motive and judgment labels without literal local evidence", () => {
    const contract = assessReferenceVisualEvidenceContract([
      row(0, "unknown", "The cheating man orders her away and looks smug, arrogant and proud as a family watches."),
    ], {
      requireStructuredMetadata: true,
      enforceObservableLanguage: true,
    });

    expect(contract.passed).toBe(false);
    expect(contract.reasons).toContain("frame_0_relationship_inference");
    expect(contract.reasons).toContain("frame_0_motive_or_control_inference");
    expect(contract.reasons).toContain("frame_0_judgment_inference");
  });

  it("rejects inferred help and defiance while keeping the visible actions", () => {
    const help = assessReferenceVisualEvidenceContract([
      row(0, "unknown", "The mechanic extends his hand to offer help."),
    ], {
      requireStructuredMetadata: true,
      enforceObservableLanguage: true,
    });
    expect(help.passed).toBe(false);
    expect(help.reasons).toContain("frame_0_motive_or_control_inference");

    const defiance = assessReferenceVisualEvidenceContract([
      row(0, "unknown", "They exchange defiant glances."),
    ], {
      requireStructuredMetadata: true,
      enforceObservableLanguage: true,
    });
    expect(defiance.passed).toBe(false);
    expect(defiance.reasons).toContain("frame_0_judgment_inference");

    const observable = assessReferenceVisualEvidenceContract([
      row(0, "unknown", "The mechanic extends his hand toward the woman."),
      row(3, "unknown", "They exchange glances. The soldier looks sternly."),
    ], {
      requireStructuredMetadata: true,
      enforceObservableLanguage: true,
    });
    expect(observable.passed).toBe(true);
  });

  it("rejects inferred parenthood while preserving a plain observable baby", () => {
    const inferred = assessReferenceVisualEvidenceContract([
      row(0, "unknown", "The mother and father hold their baby and became parents together."),
    ], {
      requireStructuredMetadata: true,
      enforceObservableLanguage: true,
    });
    expect(inferred.passed).toBe(false);
    expect(inferred.reasons).toContain("frame_0_relationship_inference");

    const observable = assessReferenceVisualEvidenceContract([
      row(0, "unknown", "A woman and a man hold a baby wrapped in a white blanket."),
    ], {
      requireStructuredMetadata: true,
      enforceObservableLanguage: true,
    });
    expect(observable.passed).toBe(true);
  });

  it("rejects lazy and shameless labels emitted by vision instead of treating them as actions", () => {
    for (const description of [
      "A lazy man lies on a wooden staircase.",
      "Um homem preguicoso desliza no chao.",
      "O cara de pau aponta para a porta.",
      "A shameless woman raises one hand.",
    ]) {
      const contract = assessReferenceVisualEvidenceContract([
        row(0, "unknown", description),
      ], {
        requireStructuredMetadata: true,
        enforceObservableLanguage: true,
      });
      expect(contract.passed, description).toBe(false);
      expect(contract.reasons, description).toContain("frame_0_judgment_inference");
    }
  });

  it("allows an otherwise restricted literal label only when local OCR explicitly states it", () => {
    const frame = {
      ...row(4, "unknown", "The word family appears on the sign."),
      text_on_screen: "FAMILY",
    };
    const contract = assessReferenceVisualEvidenceContract([frame], {
      requireStructuredMetadata: true,
      enforceObservableLanguage: true,
    });
    expect(contract.passed).toBe(true);
  });
});
