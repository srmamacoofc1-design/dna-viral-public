import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_CODEX_MANUAL_AUDIT_IDS,
  canonicalCodexVideoPayloadHash,
  materializeCodexAuditVideoFrames,
  prepareCodexAuditManifest,
  sha256Text,
  youtubeIdFromSourceUrl,
  type ArtifactInspector,
} from "../../../scripts/lib/codex-manual-audit";

const DURATION = 120;

function sourceUrl(id: string): string {
  return `https://www.youtube.com/shorts/${id}`;
}

function segments(id: string) {
  return Array.from({ length: 12 }, (_, index) => ({
    index,
    start: index * 10,
    end: (index + 1) * 10,
    text: `${id} trecho auditado ${index + 1}`,
  }));
}

function moments(id: string) {
  return Array.from({ length: 30 }, (_, index) => ({
    timestamp_seconds: Number((0.5 + index * (117.5 / 29)).toFixed(6)),
    description: `Descrição visual factual ${id} quadro ${index + 1}`,
    action: `Ação observável ${index + 1}`,
    objects: [`objeto-${index + 1}`],
    human_presence: true,
    animal_presence: false,
    text_on_screen: false,
    emotion: "curiosidade",
    surprise_score: 70,
    intensity_score: 75,
    source_frame_path: `frames/${id}-${index + 1}.jpg`,
  }));
}

function blocks(id: string, visualMoments: ReturnType<typeof moments>) {
  return Array.from({ length: 12 }, (_, index) => {
    const start = index * 10;
    const end = (index + 1) * 10;
    const representative = visualMoments.reduce((best, moment) =>
      Math.abs(moment.timestamp_seconds - (start + 5)) < Math.abs(best.timestamp_seconds - (start + 5))
        ? moment
        : best
    );
    return {
      index,
      start,
      end,
      type: index === 0 ? "hook" : index === 11 ? "payoff" : index === 9 ? "revelacao" : "desenvolvimento",
      emotion: index === 11 ? "alívio" : "curiosidade",
      function: `Função narrativa auditada ${index + 1}`,
      text: `${id} trecho auditado ${index + 1}`,
      evidence_scope: index % 3 === 0 ? "visual_confirmed" : index % 3 === 1 ? "mixed" : "narration_only",
      transcript_segment_indexes: [index],
      visual_description: representative.description,
      visual_action: representative.action,
      visual_objects: representative.objects,
      visual_moment_timestamp: representative.timestamp_seconds,
      source_frame_path: representative.source_frame_path,
    };
  });
}

function manifestFixture() {
  const videos = EXPECTED_CODEX_MANUAL_AUDIT_IDS.map((id) => {
    const visualMoments = moments(id);
    return {
      youtube_id: id,
      source_url: sourceUrl(id),
      title: `Título ${id}`,
      channel: "Canal auditado",
      duration_seconds: DURATION,
      media_duration_seconds: DURATION,
      transcript_language: "pt-orig",
      transcript_segments: segments(id),
      visual_moments: visualMoments,
      narrative_blocks: blocks(id, visualMoments),
    };
  });
  return {
    schema_version: 1,
    generated_at: "2026-07-14T12:00:00.000Z",
    evidence_policy: "Somente evidência visual local revisada.",
    videos,
    validation: { valid: true, errors: [], counts: {} },
  };
}

const inspector: ArtifactInspector = async (rawPath, constraints) => {
  const absolute = path.resolve(rawPath);
  const isVideo = constraints.extensions.includes(".mp4");
  const size = isVideo ? 1_000_000 : constraints.extensions.some((extension) =>
    [".jpg", ".jpeg", ".png", ".webp"].includes(extension)
  ) ? 2_000 : 1_000;
  return { path: absolute, size, sha256: sha256Text(absolute) };
};

function transcriptArtifact(absolutePath: string, divergentId?: string): string {
  const id = path.basename(absolutePath).replace(/\.transcript\.json$/, "");
  const artifactSegments = segments(id).map(({ start, end, text }, index) => ({
    start,
    end,
    text: divergentId === id && index === 0 ? `${text} adulterado` : text,
  }));
  return JSON.stringify({
    youtube_id: id,
    title: `Título ${id}`,
    channel: "Canal auditado",
    duration_seconds: DURATION,
    language: "pt-orig",
    source: sourceUrl(id),
    generated_from: `${id}.pt-orig.json3`,
    segments: artifactSegments,
  });
}

function options(divergentId?: string) {
  return {
    projectRoot: path.resolve("."),
    manifestPath: path.resolve(".runtime/four-video-local-analysis/codex-audit-manifest.json"),
    manifestSha256: "a".repeat(64),
    inspectArtifact: inspector,
    probeMediaDuration: async () => DURATION,
    readArtifactText: async (absolutePath: string) => transcriptArtifact(absolutePath, divergentId),
  };
}

describe("Codex manual audit manifest gate", () => {
  it("accepts only the exact 16-video, evidence-linked inventory", async () => {
    const prepared = await prepareCodexAuditManifest(manifestFixture(), options());
    expect(prepared.videos.map((video) => video.youtube_id)).toEqual(
      [...EXPECTED_CODEX_MANUAL_AUDIT_IDS],
    );
    expect(prepared.videos.every((video) => video.visual_moments.length === 30)).toBe(true);
    expect(prepared.videos.every((video) => video.blocks.length === 12)).toBe(true);
    expect(new Set(prepared.videos.flatMap((video) =>
      video.visual_moments.map((moment) => moment.frame_hash)
    )).size).toBe(16 * 30);
    const scopes = prepared.videos[0].blocks.reduce<Record<string, typeof prepared.videos[0]["blocks"][number]>>(
      (result, block) => ({ ...result, [block.evidence_scope]: block }),
      {},
    );
    expect(scopes.visual_confirmed.alignment.alignment_score).toBeLessThan(100);
    expect(scopes.mixed.alignment.alignment_score).toBeLessThan(
      Number(scopes.visual_confirmed.alignment.alignment_score),
    );
    expect(scopes.narration_only.alignment.action_alignment_score).toBeLessThanOrEqual(30);
    expect(scopes.narration_only.compatibility.compatibility_score).toBeLessThanOrEqual(45);
    expect(scopes.narration_only.compatibility.text_requires_visual_boost).toBe(true);
    expect(scopes.narration_only.compatibility.visual_underpowered).toBe(true);
  });

  it("rejects a source URL that points at another YouTube video", async () => {
    const fixture = manifestFixture();
    fixture.videos[0].source_url = sourceUrl(EXPECTED_CODEX_MANUAL_AUDIT_IDS[1]);
    await expect(prepareCodexAuditManifest(fixture, options())).rejects.toThrow(
      /source_url does not canonicalize to its youtube_id/,
    );
  });

  it("rejects a verified transcript artifact whose text diverges from the manifest", async () => {
    const divergentId = EXPECTED_CODEX_MANUAL_AUDIT_IDS[0];
    await expect(prepareCodexAuditManifest(manifestFixture(), options(divergentId))).rejects.toThrow(
      /transcript artifact segments differ from manifest\.transcript_segments/,
    );
  });

  it("rejects a block title/paraphrase that is not exact referenced speech", async () => {
    const fixture = manifestFixture();
    fixture.videos[0].narrative_blocks[0].text = "TÍTULO APELATIVO QUE NÃO FOI FALADO";
    await expect(prepareCodexAuditManifest(fixture, options())).rejects.toThrow(
      /text is not the exact referenced transcript speech/,
    );
  });

  it("canonicalizes supported YouTube URL forms without accepting foreign hosts", () => {
    expect(youtubeIdFromSourceUrl("https://youtu.be/Zpi10UTydLU")).toBe("Zpi10UTydLU");
    expect(youtubeIdFromSourceUrl("https://youtube.com/watch?v=Zpi10UTydLU")).toBe("Zpi10UTydLU");
    expect(youtubeIdFromSourceUrl("https://example.com/shorts/Zpi10UTydLU")).toBeNull();
  });

  it("materializes public frame URLs, preserves local traceability and recalculates the payload hash", async () => {
    const prepared = await prepareCodexAuditManifest(manifestFixture(), options());
    const source = prepared.videos[0];
    const beforeHash = source.video_payload_sha256;
    const published = await materializeCodexAuditVideoFrames(source, async (frame) => ({
      publicUrl: `https://your-project-ref.supabase.co/storage/v1/object/public/videos/frames/codex-manual/${frame.youtubeId}/${String(frame.frameNumber).padStart(3, "0")}-${frame.expectedSha256}.jpg`,
      downloadedSha256: frame.expectedSha256,
    }), 2);

    expect(published.video_payload_sha256).not.toBe(beforeHash);
    expect(published.video_payload_sha256).toBe(canonicalCodexVideoPayloadHash(published));
    expect(published.visual_moments.every((frame) => frame.file_path.startsWith("https://"))).toBe(true);
    expect(published.visual_moments.every((frame) => path.isAbsolute(frame.source_local_path))).toBe(true);
    for (const block of published.blocks) {
      const frame = published.visual_moments.find((item) =>
        item.frame_number === block.representative_frame_number
      );
      expect(block.representative_frame_path).toBe(frame?.file_path);
      expect(block.representative_source_local_path).toBe(frame?.source_local_path);
    }
    expect(source.visual_moments.every((frame) => path.isAbsolute(frame.file_path))).toBe(true);
  });

  it("blocks persistence when downloaded storage bytes do not match the reviewed frame hash", async () => {
    const prepared = await prepareCodexAuditManifest(manifestFixture(), options());
    await expect(materializeCodexAuditVideoFrames(prepared.videos[0], async (frame) => ({
      publicUrl: `https://your-project-ref.supabase.co/storage/v1/object/public/videos/frames/codex-manual/${frame.youtubeId}/${String(frame.frameNumber).padStart(3, "0")}-${frame.expectedSha256}.jpg`,
      downloadedSha256: "f".repeat(64),
    }), 1)).rejects.toThrow(/post-upload SHA-256 mismatch/);
  });

  it("rejects a lookalike public path served by an attacker-controlled host", async () => {
    const prepared = await prepareCodexAuditManifest(manifestFixture(), options());
    await expect(materializeCodexAuditVideoFrames(prepared.videos[0], async (frame) => ({
      publicUrl: `https://attacker.invalid/storage/v1/object/public/videos/frames/codex-manual/${frame.youtubeId}/${String(frame.frameNumber).padStart(3, "0")}-${frame.expectedSha256}.jpg`,
      downloadedSha256: frame.expectedSha256,
    }), 1)).rejects.toThrow(/not a public videos-bucket URL/);
  });
});
