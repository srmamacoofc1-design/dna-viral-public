import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { requirePrivateYtDlpWorker } from "../../../supabase/functions/_shared/reference-import";

const source = (relativePath: string) => fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");

describe("durable private reference-link ingestion", () => {
  it("uses a dedicated user Edge Function and never creates a public.videos row", () => {
    const panel = source("../../components/script-engine/InputPanel.tsx");
    const flow = panel.slice(
      panel.indexOf("async function processReferenceLink("),
      panel.indexOf("async function handleAddReferenceLinks()"),
    );
    expect(panel).toContain('invoke("import-reference-video"');
    expect(flow).toContain("localDownload.referenceVideoId");
    expect(flow).toContain("createAndAnalyzeReference");
    expect(flow).not.toContain('.from("videos")');
    expect(flow).not.toContain('invoke("download-video"');
    expect(flow).not.toContain("temporaryVideoId");
    expect(panel).toContain("serializeReferenceLinkQueue(referenceLinkQueue)");
    expect(panel).toContain("referenceQueueEntriesToResume(referenceLinkQueue)");
  });

  it("reserves a durable private row before starting a resumable file upload", () => {
    const panel = source("../../components/script-engine/InputPanel.tsx");
    const upload = panel.slice(
      panel.indexOf("async function handleVideoUpload("),
      panel.indexOf("const patchReferenceQueueEntry"),
    );
    const reservation = upload.indexOf('.from("reference_videos").insert(');
    const tusStart = upload.indexOf("uploadWithTus(file, initialPath, attempt)");
    expect(reservation).toBeGreaterThanOrEqual(0);
    expect(tusStart).toBeGreaterThan(reservation);
    expect(upload).toContain("durableReferenceUploadPath");
    expect(panel).toContain('"x-upsert": "true"');
    expect(upload).toContain("storage_bucket: REFERENCE_VIDEO_BUCKET");
    expect(upload).toContain('status: "uploading"');
  });

  it("creates a private bucket, removes public-reference access and enforces ownership", () => {
    const migration = source("../../../supabase/migrations/20260713130000_private_reference_video_imports.sql");
    expect(migration).toContain("'reference-videos'");
    expect(migration).toContain("false,");
    expect(migration).toContain("reference_videos_storage_insert_own");
    expect(migration).toContain("(storage.foldername(name))[2] = auth.uid()::text");
    expect(migration).toContain('DROP POLICY IF EXISTS "Allow public all reference_videos"');
    expect(migration).toContain("source_idempotency_key");
    expect(migration).toContain("reference_videos_user_source_unique");
    expect(migration).not.toContain("OR user_id IS NULL");
  });

  it("keeps legacy bucket fallback row-driven while all new media uses the private bucket", () => {
    const processor = source("../../../supabase/functions/process-reference-video/index.ts");
    const importer = source("../../../supabase/functions/import-reference-video/index.ts");
    const media = source("../../../supabase/functions/_shared/gemini-video.ts");
    expect(processor).toContain('existing.storage_bucket === "videos" ? "videos" : REFERENCE_VIDEO_BUCKET');
    expect(processor).toContain("storage_bucket: REFERENCE_VIDEO_BUCKET");
    expect(processor).toContain("storageBucket,");
    expect(importer).toContain("REFERENCE_VIDEO_BUCKET");
    expect(importer).not.toContain('.from("videos")');
    expect(media).toContain("options.storageBucket ?? \"videos\"");
  });

  it("fails closed without an HTTPS worker and binds signed downloads to its origin", () => {
    expect(() => requirePrivateYtDlpWorker(undefined)).toThrow(/não está configurada/i);
    expect(() => requirePrivateYtDlpWorker("http://worker.example/v1/resolve")).toThrow(/HTTPS/i);
    expect(requirePrivateYtDlpWorker("https://worker.example/v1/resolve").toString())
      .toBe("https://worker.example/v1/resolve");
    const shared = source("../../../supabase/functions/_shared/reference-import.ts");
    expect(shared).toContain("parsedDownload.origin !== options.endpoint.origin");
    expect(shared).toContain("STORAGE_UPLOAD_TIMEOUT");
    expect(shared).toContain("signal: uploadController.signal");
  });

  it("holds the backend import lease longer than all configured network ceilings", () => {
    const importer = source("../../../supabase/functions/import-reference-video/index.ts");
    expect(importer).toContain("const ACTIVE_IMPORT_MS = 20 * 60_000");
    expect(importer).toContain("source_idempotency_key");
    expect(importer).toContain('insertError.code !== "23505"');
    expect(importer).toContain('status: "uploading"');
  });
});
