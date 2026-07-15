import { describe, expect, it } from "vitest";
import {
  LOCAL_VIDEO_STORAGE_TARGET_BYTES,
  buildLocalFfmpegArgs,
  calculateLocalTranscodeProfile,
  parseFfprobePayload,
} from "../../../scripts/local-video-normalizer";

describe("local video normalizer", () => {
  const probe = parseFfprobePayload({
    format: { duration: "42.301" },
    streams: [
      {
        codec_type: "video",
        codec_name: "av1",
        width: 2160,
        height: 3840,
        avg_frame_rate: "60/1",
      },
      { codec_type: "audio", codec_name: "opus" },
    ],
  });

  it("extracts an authoritative duration, video geometry, FPS and audio presence", () => {
    expect(probe).toEqual({
      durationSeconds: 42.301,
      hasAudio: true,
      videoCodec: "av1",
      width: 2160,
      height: 3840,
      framesPerSecond: 60,
    });
  });

  it("rejects non-video and overlong payloads before ffmpeg", () => {
    expect(() => parseFfprobePayload({
      format: { duration: "10" },
      streams: [{ codec_type: "audio" }],
    })).toThrow(/faixa de vídeo/);
    expect(() => parseFfprobePayload({
      format: { duration: "3601" },
      streams: [{ codec_type: "video" }],
    })).toThrow(/3600/);
  });

  it("leaves headroom below 45 MiB and adapts resolution/FPS to bitrate", () => {
    const shortProfile = calculateLocalTranscodeProfile(probe);
    expect(shortProfile.videoBitrate).toBeLessThanOrEqual(4_500_000);
    expect(shortProfile.audioBitrate).toBe(96_000);
    expect(shortProfile.maxDimension).toBe(1280);
    expect(shortProfile.framesPerSecond).toBe(30);

    const longProfile = calculateLocalTranscodeProfile({
      ...probe,
      durationSeconds: 3600,
      framesPerSecond: 60,
    });
    expect(longProfile.audioBitrate).toBe(48_000);
    expect(longProfile.maxDimension).toBe(480);
    expect(longProfile.framesPerSecond).toBe(15);
    expect((longProfile.videoBitrate + longProfile.audioBitrate) * 3600 / 8)
      .toBeLessThan(LOCAL_VIDEO_STORAGE_TARGET_BYTES);
  });

  it("builds fixed two-pass commands without a shell, cuts or caller-provided filters", () => {
    const profile = calculateLocalTranscodeProfile(probe);
    const passOne = buildLocalFfmpegArgs({
      inputPath: "C:\\temp\\source with spaces.mp4",
      outputPath: "C:\\temp\\normalized.mp4",
      passLogPath: "C:\\temp\\pass",
      pass: 1,
      profile,
      hasAudio: true,
    });
    const passTwo = buildLocalFfmpegArgs({
      inputPath: "C:\\temp\\source with spaces.mp4",
      outputPath: "C:\\temp\\normalized.mp4",
      passLogPath: "C:\\temp\\pass",
      pass: 2,
      profile,
      hasAudio: true,
    });

    expect(passOne).toContain("-an");
    expect(passOne).toContain("null");
    expect(passOne).not.toContain("-ss");
    expect(passOne).not.toContain("-t");
    expect(passTwo).toContain("0:a:0?");
    expect(passTwo).toContain("aac");
    expect(passTwo).toContain("+faststart");
    expect(passTwo.at(-1)).toBe("C:\\temp\\normalized.mp4");
    const filter = passTwo[passTwo.indexOf("-vf") + 1];
    expect(filter).toContain("force_original_aspect_ratio=decrease");
    expect(filter).toContain("fps=30.000");
  });

  it("keeps a silent source silent", () => {
    const silent = { ...probe, hasAudio: false };
    const profile = calculateLocalTranscodeProfile(silent);
    const args = buildLocalFfmpegArgs({
      inputPath: "input.mp4",
      outputPath: "output.mp4",
      passLogPath: "pass",
      pass: 2,
      profile,
      hasAudio: false,
    });
    expect(profile.audioBitrate).toBe(0);
    expect(args).toContain("-an");
    expect(args).not.toContain("aac");
  });
});
