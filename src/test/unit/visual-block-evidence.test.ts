import { describe, expect, it } from "vitest";
import {
  assessAndAssignPersistedGeminiMoments,
  type NarrativeVisualBlock,
} from "../../../supabase/functions/_shared/visual-block-evidence";

function moment(timestamp: number, description = `frame at ${timestamp}`) {
  return {
    timestamp_seconds: timestamp,
    description,
    main_action: `action ${timestamp}`,
    main_objects: [`object ${timestamp}`],
    surprise_score: timestamp,
  };
}

function block(id: string, start: number, end: number): NarrativeVisualBlock {
  return { id, tempo_inicio: start, tempo_fim: end };
}

describe("exact persisted Gemini evidence per visual block", () => {
  it("uses overlapping real moments and bounded nearest real moments for every block", () => {
    const moments = [0, 3, 6, 9, 12].map((timestamp) => moment(timestamp));
    const blocks = [
      block("opening", 0, 0.5),
      block("between-samples", 1.9, 2.1),
      block("development", 3, 7),
      block("payoff", 10.8, 11),
    ];

    const result = assessAndAssignPersistedGeminiMoments(moments, blocks, 12);

    expect(result.passed).toBe(true);
    expect(result.assigned_blocks).toBe(blocks.length);
    expect(result.nearest_assignments).toBe(2);
    expect(result.nearest_assignment_limit_seconds).toBeCloseTo(1.5);
    expect(result.assignments[1].moments[0]).toBe(moments[1]);
    expect(result.assignments[3].moments[0]).toBe(moments[4]);
    const persistedObjects = new Set<unknown>(moments);
    expect(result.assignments.every((assignment) => persistedObjects.has(assignment.representative_moment))).toBe(true);
  });

  it("rejects a clustered timeline with a large uncovered middle even when count and endpoints pass", () => {
    const moments = [0, 1, 2, 3, 4, 5, 6, 7, 8, 30].map((timestamp) => moment(timestamp));
    const result = assessAndAssignPersistedGeminiMoments(
      moments,
      [block("whole-video", 0, 30)],
      30,
    );

    expect(result.timeline_coverage.passed).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.maximum_observed_gap_seconds).toBe(22);
    expect(result.reasons.some((reason) => reason.startsWith("visual_timeline_sparse_gap_"))).toBe(true);
  });

  it("downsamples more than forty real points for coverage while preserving endpoints and evidence objects", () => {
    const moments = Array.from({ length: 61 }, (_, timestamp) => moment(timestamp));
    const blocks = [
      block("opening", 0, 10),
      block("development", 10, 50),
      block("payoff", 50, 60),
    ];
    const result = assessAndAssignPersistedGeminiMoments(moments, blocks, 60);

    expect(result.passed).toBe(true);
    expect(result.persisted_moments).toBe(61);
    expect(result.unique_timestamps).toBe(61);
    expect(result.assessed_timestamps).toBe(40);
    expect(result.timeline_coverage.observed_moments).toBe(40);
    expect(result.timeline_coverage.first_timestamp_seconds).toBe(0);
    expect(result.timeline_coverage.last_timestamp_seconds).toBe(60);
    const persistedObjects = new Set<unknown>(moments);
    expect(result.assignments.flatMap((assignment) => assignment.moments)
      .every((assignedMoment) => persistedObjects.has(assignedMoment))).toBe(true);
  });

  it("rejects a timeline that has enough moments but stops before the final ten percent", () => {
    const moments = Array.from({ length: 10 }, (_, index) => moment(index * (26.9 / 9)));
    const result = assessAndAssignPersistedGeminiMoments(
      moments,
      [block("whole-video", 0, 30)],
      30,
    );

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("ending_not_covered");
    expect(result.timeline_coverage.observed_moments).toBe(10);
  });

  it("fails instead of silently accepting invalid or observation-free persisted entries", () => {
    const moments = [
      moment(0),
      { timestamp_seconds: 3, description: "" },
      moment(6),
      moment(9),
      moment(12),
    ];
    const result = assessAndAssignPersistedGeminiMoments(
      moments,
      [block("whole-video", 0, 12)],
      12,
    );

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("persisted_gemini_moments_invalid_1");
  });
});
