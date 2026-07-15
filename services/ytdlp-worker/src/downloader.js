import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const CONTENT_TYPES = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
};
const MEDIA_EXTENSION = /\.(mp4|webm|mkv|mov|mpeg|mpg)$/i;
const MAX_DIAGNOSTIC_CHARS = 16_384;

export class DownloadError extends Error {
  constructor(code, message, status = 502, retryable = true, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "DownloadError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function buildYtDlpArgs({ canonicalUrl, format, outputTemplate, maxBytes }) {
  return [
    "--no-playlist",
    "--no-progress",
    "--no-warnings",
    "--restrict-filenames",
    "--socket-timeout", "30",
    "--retries", "3",
    "--fragment-retries", "3",
    "--format", format,
    "--merge-output-format", "mp4",
    "--max-filesize", String(maxBytes),
    "--output", outputTemplate,
    "--",
    canonicalUrl,
  ];
}

async function listRegularFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(directory, entry.name);
    const fileStat = await stat(path);
    files.push({ path, name: entry.name, size: fileStat.size });
  }
  return files;
}

async function assertDirectoryWithinBudget(directory, maxBytes) {
  const files = await listRegularFiles(directory);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  // During a merge, yt-dlp can briefly retain video, audio and the muxed result.
  // No individual output may cross the hard limit and temporary disk use is capped.
  if (files.some((file) => file.size > maxBytes) || total > maxBytes * 3) {
    throw new DownloadError(
      "VIDEO_TOO_LARGE",
      `O vídeo excede o limite de ${Math.floor(maxBytes / 1024 / 1024)} MiB.`,
      413,
      false,
    );
  }
}

function appendBounded(current, chunk, limit = MAX_DIAGNOSTIC_CHARS) {
  if (current.length >= limit) return current;
  return (current + chunk.toString("utf8")).slice(0, limit);
}

async function runYtDlp({ binary, args, jobDir, maxBytes, timeoutMs, signal, spawnImpl }) {
  await new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let stderr = "";
    let stdout = "";
    let monitorBusy = false;
    const child = spawnImpl(binary, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const settle = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(monitor);
      signal?.removeEventListener("abort", onAbort);
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    const terminate = (error) => {
      if (settled) return;
      child.kill("SIGKILL");
      settle(error);
    };
    const onAbort = () => terminate(new DownloadError("REQUEST_ABORTED", "A requisição foi cancelada.", 499, true));

    const timeout = setTimeout(() => {
      terminate(new DownloadError("DOWNLOAD_TIMEOUT", "O download excedeu o tempo limite.", 504, true));
    }, timeoutMs);
    const monitor = setInterval(async () => {
      if (monitorBusy || settled) return;
      monitorBusy = true;
      try {
        await assertDirectoryWithinBudget(jobDir, maxBytes);
      } catch (error) {
        terminate(error);
      } finally {
        monitorBusy = false;
      }
    }, 250);
    monitor.unref();

    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (chunk) => { stdout = appendBounded(stdout, chunk, 4_096); });
    child.stderr?.on("data", (chunk) => { stderr = appendBounded(stderr, chunk); });
    child.once("error", (error) => {
      settle(new DownloadError("YTDLP_NOT_AVAILABLE", "Não foi possível iniciar o yt-dlp.", 503, true, error));
    });
    child.once("close", (code, processSignal) => {
      if (settled) return;
      if (code === 0) return settle();
      const diagnostic = (stderr || stdout).trim().slice(0, 1_000);
      const suffix = diagnostic ? ` Detalhe: ${diagnostic}` : "";
      settle(new DownloadError(
        "YTDLP_FAILED",
        `O yt-dlp terminou com código ${code ?? "desconhecido"}${processSignal ? ` (${processSignal})` : ""}.${suffix}`,
        502,
        true,
      ));
    });
  });
}

function contentTypeFor(filename) {
  const extension = filename.match(/\.[^.]+$/)?.[0]?.toLowerCase() || "";
  return CONTENT_TYPES[extension] || "application/octet-stream";
}

export async function downloadYouTubeVideo(options) {
  const {
    canonicalUrl,
    format,
    ytDlpBinary,
    tmpRoot,
    maxBytes,
    timeoutMs,
    signal,
    spawnImpl = spawn,
  } = options;

  await mkdir(tmpRoot, { recursive: true, mode: 0o700 });
  const jobDir = await mkdtemp(join(tmpRoot, "job-"));
  const outputTemplate = join(jobDir, "video.%(ext)s");

  try {
    const args = buildYtDlpArgs({ canonicalUrl, format, outputTemplate, maxBytes });
    await runYtDlp({
      binary: ytDlpBinary,
      args,
      jobDir,
      maxBytes,
      timeoutMs,
      signal,
      spawnImpl,
    });
    await assertDirectoryWithinBudget(jobDir, maxBytes);

    const files = (await listRegularFiles(jobDir))
      .filter((file) => MEDIA_EXTENSION.test(file.name) && !/\.(part|ytdl)$/i.test(file.name))
      .sort((a, b) => b.size - a.size);
    const selected = files[0];
    if (!selected || selected.size <= 0) {
      throw new DownloadError("EMPTY_DOWNLOAD", "O yt-dlp não produziu um arquivo de vídeo válido.", 502, true);
    }
    if (selected.size > maxBytes) {
      throw new DownloadError(
        "VIDEO_TOO_LARGE",
        `O vídeo excede o limite de ${Math.floor(maxBytes / 1024 / 1024)} MiB.`,
        413,
        false,
      );
    }

    const jobRoot = `${await realpath(jobDir)}${sep}`;
    const selectedRealPath = await realpath(selected.path);
    if (!`${selectedRealPath}${sep}`.startsWith(jobRoot)) {
      throw new DownloadError("INVALID_OUTPUT_PATH", "O yt-dlp produziu um caminho de saída inválido.", 502, false);
    }

    return {
      path: resolve(selectedRealPath),
      jobDir,
      sizeBytes: selected.size,
      contentType: contentTypeFor(selected.name),
      extension: selected.name.split(".").pop()?.toLowerCase() || "mp4",
    };
  } catch (error) {
    await rm(jobDir, { recursive: true, force: true }).catch(() => {});
    if (error instanceof DownloadError) throw error;
    throw new DownloadError("YTDLP_FAILED", "Falha inesperada ao baixar o vídeo.", 502, true, error);
  }
}
