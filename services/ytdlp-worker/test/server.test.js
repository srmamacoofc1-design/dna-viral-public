import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_FORMAT } from "../src/config.js";
import { createYtdlpWorker } from "../src/server.js";

const TOKEN = "test-token-with-at-least-32-characters-long";
const VIDEO_ID = "vjqsNKq05iE";

function makeConfig(tmpRoot, overrides = {}) {
  return {
    host: "127.0.0.1",
    port: 0,
    serviceToken: TOKEN,
    publicBaseUrl: "http://127.0.0.1",
    ytDlpBinary: "yt-dlp",
    tmpRoot,
    maxBytes: 300 * 1024 * 1024,
    maxConcurrentJobs: 2,
    downloadTimeoutMs: 30_000,
    signedUrlTtlMs: 60_000,
    requestBodyMaxBytes: 2_048,
    ...overrides,
  };
}

async function listen(worker, config) {
  await new Promise((resolve, reject) => {
    worker.server.once("error", reject);
    worker.server.listen(0, "127.0.0.1", resolve);
  });
  const address = worker.server.address();
  config.publicBaseUrl = `http://127.0.0.1:${address.port}`;
  return config.publicBaseUrl;
}

async function createFixtureDownloader(tmpRoot, bytes = Buffer.from("0123456789")) {
  return async (options) => {
    assert.equal(options.canonicalUrl, `https://www.youtube.com/watch?v=${VIDEO_ID}`);
    assert.equal(options.format, DEFAULT_FORMAT);
    const jobDir = await mkdtemp(join(tmpRoot, "fake-job-"));
    await mkdir(jobDir, { recursive: true });
    const path = join(jobDir, "video.mp4");
    await writeFile(path, bytes);
    return {
      path,
      jobDir,
      sizeBytes: bytes.length,
      contentType: "video/mp4",
      extension: "mp4",
    };
  };
}

test("implementa o contrato resolve e serve bytes por URL temporária assinada", async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "ytdlp-worker-test-"));
  let currentTime = 2_000_000_000_000;
  const config = makeConfig(tmpRoot);
  const worker = createYtdlpWorker({
    config,
    downloader: await createFixtureDownloader(tmpRoot),
    now: () => currentTime,
    logger: { error() {} },
  });
  t.after(() => worker.close());
  const baseUrl = await listen(worker, config);

  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", active_jobs: 0, max_concurrent_jobs: 2 });

  const unauthorized = await fetch(`${baseUrl}/v1/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: `https://youtube.com/shorts/${VIDEO_ID}` }),
  });
  assert.equal(unauthorized.status, 401);

  const resolved = await fetch(`${baseUrl}/v1/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      url: `https://youtube.com/shorts/${VIDEO_ID}`,
      format: DEFAULT_FORMAT,
    }),
  });
  assert.equal(resolved.status, 200);
  const payload = await resolved.json();
  assert.equal(typeof payload.download_url, "string");
  assert.equal(payload.size_bytes, 10);
  assert.equal(payload.content_type, "video/mp4");
  assert.match(payload.expires_at, /^\d{4}-/);

  const fullDownload = await fetch(payload.download_url);
  assert.equal(fullDownload.status, 200);
  assert.equal(fullDownload.headers.get("content-type"), "video/mp4");
  assert.equal(await fullDownload.text(), "0123456789");

  const ranged = await fetch(payload.download_url, { headers: { Range: "bytes=2-5" } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await ranged.text(), "2345");

  const tampered = new URL(payload.download_url);
  tampered.searchParams.set("signature", `${tampered.searchParams.get("signature")}x`);
  assert.equal((await fetch(tampered)).status, 403);

  currentTime += 60_001;
  assert.equal((await fetch(payload.download_url)).status, 410);
});

test("recusa formatos arbitrários, coleções e JSON acima do limite", async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "ytdlp-worker-test-"));
  const config = makeConfig(tmpRoot, { requestBodyMaxBytes: 256 });
  const worker = createYtdlpWorker({
    config,
    downloader: await createFixtureDownloader(tmpRoot),
    logger: { error() {} },
  });
  t.after(() => worker.close());
  const baseUrl = await listen(worker, config);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };

  const arbitraryFormat = await fetch(`${baseUrl}/v1/resolve`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url: `https://youtube.com/watch?v=${VIDEO_ID}`, format: "best; rm -rf /" }),
  });
  assert.equal(arbitraryFormat.status, 422);
  assert.equal((await arbitraryFormat.json()).error.code, "UNSUPPORTED_FORMAT");

  const collection = await fetch(`${baseUrl}/v1/resolve`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url: "https://youtube.com/@Benji_Curioso" }),
  });
  assert.equal(collection.status, 422);
  assert.equal((await collection.json()).error.code, "YOUTUBE_COLLECTION_NOT_A_VIDEO");

  const oversized = await fetch(`${baseUrl}/v1/resolve`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url: `https://youtube.com/watch?v=${VIDEO_ID}`, padding: "x".repeat(512) }),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, "REQUEST_TOO_LARGE");
});

test("aplica backpressure no limite de concorrência", async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "ytdlp-worker-test-"));
  const config = makeConfig(tmpRoot, { maxConcurrentJobs: 1 });
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  let releaseDownload;
  const released = new Promise((resolve) => { releaseDownload = resolve; });
  const fixture = await createFixtureDownloader(tmpRoot);
  const worker = createYtdlpWorker({
    config,
    downloader: async (options) => {
      signalStarted();
      await released;
      return fixture(options);
    },
    logger: { error() {} },
  });
  t.after(() => worker.close());
  const baseUrl = await listen(worker, config);
  const request = () => fetch(`${baseUrl}/v1/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ url: `https://youtube.com/watch?v=${VIDEO_ID}` }),
  });

  const firstPromise = request();
  await started;
  const second = await request();
  assert.equal(second.status, 429);
  assert.equal(second.headers.get("retry-after"), "10");
  releaseDownload();
  assert.equal((await firstPromise).status, 200);
});
