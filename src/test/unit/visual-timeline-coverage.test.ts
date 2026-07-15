import { describe, expect, it } from "vitest";
import {
  assessVisualTimelineCoverage,
  limitVisualTimeline,
  requiredVisualMomentCount,
} from "../../../supabase/functions/_shared/visual-timeline-coverage";

describe("visual timeline coverage", () => {
  it("requires approximately one moment per three seconds up to each cap", () => {
    expect(requiredVisualMomentCount(82.95, { maxMoments: 30 })).toBe(27);
    expect(requiredVisualMomentCount(149, { maxMoments: 30 })).toBe(30);
    expect(requiredVisualMomentCount(149, { maxMoments: 40 })).toBe(40);
  });

  it("rejects a dense-looking timeline that stops before the final 10 percent", () => {
    const moments = Array.from({ length: 40 }, (_, index) => ({ timestamp_seconds: index * (113 / 39) }));
    const result = assessVisualTimelineCoverage(moments, 149, { maxMoments: 40 });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("ending_not_covered");
    expect(result.required_moments).toBe(40);
  });

  it("preserves opening and ending when limiting an over-complete timeline", () => {
    const moments = Array.from({ length: 61 }, (_, index) => ({ timestamp_seconds: index * 2 }));
    const limited = limitVisualTimeline(moments, 30);
    expect(limited).toHaveLength(30);
    expect(limited[0].timestamp_seconds).toBe(0);
    expect(limited.at(-1)?.timestamp_seconds).toBe(120);
    expect(assessVisualTimelineCoverage(limited, 120, { maxMoments: 30 }).passed).toBe(true);
  });

  it("requires two opening moments inside an absolute five-second cap", () => {
    const oneOpeningMoment = [
      { timestamp_seconds: 4.9 },
      ...Array.from({ length: 26 }, (_, index) => ({ timestamp_seconds: 8 + index * 3 })),
      { timestamp_seconds: 89 },
    ];
    const failed = assessVisualTimelineCoverage(oneOpeningMoment, 90, { maxMoments: 40 });
    expect(failed.opening_deadline_seconds).toBe(5);
    expect(failed.opening_moment_count).toBe(1);
    expect(failed.reasons).toContain("opening_moments_1_below_2");

    const passed = assessVisualTimelineCoverage(
      [{ timestamp_seconds: 1.5 }, ...oneOpeningMoment],
      90,
      { maxMoments: 40 },
    );
    expect(passed.covers_opening).toBe(true);
  });

  it("does not count duplicate timestamps as distinct opening evidence", () => {
    const moments = [
      { timestamp_seconds: 1.5 },
      { timestamp_seconds: 1.5 },
      ...Array.from({ length: 27 }, (_, index) => ({ timestamp_seconds: 7 + index * 3 })),
      { timestamp_seconds: 89 },
    ];
    const result = assessVisualTimelineCoverage(moments, 90, { maxMoments: 40 });
    expect(result.opening_moment_count).toBe(1);
    expect(result.reasons).toContain("visual_duplicate_timestamps_1");
    expect(result.reasons).toContain("opening_moments_1_below_2");
  });

  it("does not accept an impossible timestamp as proof of ending coverage", () => {
    const moments = Array.from({ length: 10 }, (_, index) => ({ timestamp_seconds: index * 3 }));
    moments[moments.length - 1].timestamp_seconds = 999;
    const result = assessVisualTimelineCoverage(moments, 30, { maxMoments: 30 });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("visual_timestamps_out_of_bounds_1");
    expect(result.covers_ending).toBe(false);
  });
});
