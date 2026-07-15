import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

export const LOCAL_VIDEO_MAX_INPUT_BYTES = 300 * 1024 * 1024;
export const LOCAL_VIDEO_STORAGE_TARGET_BYTES = 45 * 1024 * 1024;
export const LOCAL_VIDEO_MAX_DURATION_SECONDS = 60 * 60;

const MIN_VIDEO_BYTES = 10 * 1024;
const MAX_STDERR_BYTES = 128 * 1024;
const PROBE_TIMEOUT_MS = 30_000;
const TRANSCODE_TIMEOUT_MS = 20 * 60_000;
const PROCESS_CLOSE_TIMEOUT_MS = 8_000;

export interface LocalVideoProbe {
  durationSeconds: number;
  hasAudio: boolean;
  videoCodec: string;
  width: number;
  height: number;
  framesPerSecond: number;
}

export interface LocalTranscodeProfile {
  videoBitrate: number;
  audioBitrate: number;
  maxDimension: number;
  framesPerSecond: number;
}

export interface LocalNormalizedVideo {
  filePath: string;
  size: number;
  durationSeconds: number;
  hadAudio: boolean;
  normalized: boolean;
  contentType: "video/mp4";
}

interface ProcessOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  spawnProcess?: typeof spawn;
}

interface NormalizeOptions {
  signal?: AbortSignal;
  force?: boolean;
  targetBytes?: number;
  ffmpegBinary?: string;
  ffprobeBinary?: string;
}

function positiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseFrameRate(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return 0;
  const [numerator, denominator = "1"] = value.split("/");
  const top = Number(numerator);
  const bottom = Number(denominator);
  return Number.isFinite(top) && Number.isFinite(bottom) && top > 0 && bottom > 0
    ? top / bottom
    : 0;
}

export function parseFfprobePayload(payload: unknown): LocalVideoProbe {
  if (!payload || typeof payload !== "object") throw new Error("O ffprobe retornou metadados inválidos.");
  const record = payload as Record<string, unknown>;
  const streams = Array.isArray(record.streams) ? record.streams : [];
  const video = streams.find((entry) => (
    entry && typeof entry === "object" && (entry as Record<string, unknown>).codec_type === "video"
  )) as Record<string, unknown> | undefined;
  if (!video) throw new Error("O arquivo não possui uma faixa de vídeo válida.");

  const format = record.format && typeof record.format === "object"
    ? record.format as Record<string, unknown>
    : {};
  const durationSeconds = positiveNumber(format.duration) ?? positiveNumber(video.duration);
  if (!durationSeconds || durationSeconds > LOCAL_VIDEO_MAX_DURATION_SECONDS) {
    throw new Error(`A duração precisa estar entre 0 e ${LOCAL_VIDEO_MAX_DURATION_SECONDS} segundos.`);
  }

  return {
    durationSeconds,
    hasAudio: streams.some((entry) => (
      entry && typeof entry === "object" && (entry as Record<string, unknown>).codec_type === "audio"
    )),
    videoCodec: typeof video.codec_name === "string" ? video.codec_name : "unknown",
    width: Math.max(0, Math.round(Number(video.width) || 0)),
    height: Math.max(0, Math.round(Number(video.height) || 0)),
    framesPerSecond: parseFrameRate(video.avg_frame_rate ?? video.r_frame_rate),
  };
}

export function calculateLocalTranscodeProfile(
  probe: LocalVideoProbe,
  targetBytes = LOCAL_VIDEO_STORAGE_TARGET_BYTES,
): LocalTranscodeProfile {
  if (!Number.isSafeInteger(targetBytes) || targetBytes < 1024 * 1024) {
    throw new Error("O teto de saída da normalização é inválido.");
  }
  const audioBitrate = !probe.hasAudio
    ? 0
    : probe.durationSeconds <= 10 * 60
      ? 96_000
      : probe.durationSeconds <= 30 * 60
        ? 64_000
        : 48_000;
  // Leave six percent for MP4/container overhead. A hard size check after both
  // passes is still authoritative.
  const totalBitrate = Math.floor((targetBytes * 8 * 0.94) / probe.durationSeconds);
  const videoBitrate = Math.max(40_000, Math.min(4_500_000, totalBitrate - audioBitrate));
  const maxDimension = videoBitrate >= 2_000_000
    ? 1280
    : videoBitrate >= 800_000
      ? 960
      : videoBitrate >= 350_000
        ? 720
        : 480;
  const fpsCap = videoBitrate >= 800_000 ? 30 : videoBitrate >= 350_000 ? 24 : 15;
  const sourceFps = probe.framesPerSecond > 0 ? probe.framesPerSecond : fpsCap;

  return {
    videoBitrate,
    audioBitrate,
    maxDimension,
    framesPerSecond: Math.max(1, Math.min(fpsCap, sourceFps)),
  };
}

export function buildLocalFfmpegArgs(options: {
  inputPath: string;
  outputPath: string;
  passLogPath: string;
  pass: 1 | 2;
  profile: LocalTranscodeProfile;
  hasAudio: boolean;
}): string[] {
  const { profile } = options;
  const videoFilter = `scale='min(${profile.maxDimension},iw)':'min(${profile.maxDimension},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=${profile.framesPerSecond.toFixed(3)}`;
  const common = [
    "-y",
    "-hide_banner",
    "-loglevel", "error",
    "-i", options.inputPath,
    "-map", "0:v:0",
    "-sn",
    "-dn",
    "-vf", videoFilter,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-b:v", String(profile.videoBitrate),
    "-pass", String(options.pass),
    "-passlogfile", options.passLogPath,
  ];
  if (options.pass === 1) return [...common, "-an", "-f", "null", "-"];

  const audio = options.hasAudio
    ? ["-map", "0:a:0?", "-c:a", "aac", "-b:a", String(profile.audioBitrate), "-ac", "2", "-ar", "48000"]
    : ["-an"];
  return [...common, ...audio, "-map_metadata", "-1", "-movflags", "+faststart", options.outputPath];
}

function appendBounded(current: string, chunk: unknown): string {
  const combined = current + String(chunk);
  return combined.length <= MAX_STDERR_BYTES ? combined : combined.slice(-MAX_STDERR_BYTES);
}

function processExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForClose(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (processExited(child)) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(finish, timeoutMs);
    timeout.unref?.();
    const onClose = () => finish();
    function finish() {
      clearTimeout(timeout);
      child.removeListener("close", onClose);
      resolve();
    }
    child.once("close", onClose);
  });
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (processExited(child)) return;
  if (process.platform === "win32" && child.pid) {
    await new Promise<void>((resolve) => {
      execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        timeout: PROCESS_CLOSE_TIMEOUT_MS,
      }, () => resolve());
    });
  } else {
    child.kill("SIGTERM");
  }
  await waitForClose(child, PROCESS_CLOSE_TIMEOUT_MS);
  if (!processExited(child)) child.kill("SIGKILL");
}

function runProcess(command: string, args: readonly string[], options: ProcessOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = (options.spawnProcess ?? spawn)(command, [...args], {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stderr = "";
    let settled = false;
    let requestedError: Error | null = null;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      child.stderr?.removeAllListeners("data");
      if (error) reject(error);
      else resolve();
    };
    const stop = (error: Error) => {
      if (requestedError || settled) return;
      requestedError = error;
      void terminateProcessTree(child).then(
        () => finish(requestedError ?? error),
        () => finish(requestedError ?? error),
      );
    };
    const onAbort = () => stop(
      options.signal?.reason instanceof Error
        ? options.signal.reason
        : new Error("A normalização foi cancelada."),
    );
    const timeout = setTimeout(
      () => stop(new Error("O ffmpeg excedeu o tempo limite de normalização.")),
      options.timeoutMs ?? TRANSCODE_TIMEOUT_MS,
    );
    timeout.unref?.();

    child.stderr?.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.once("error", (error) => finish(requestedError ?? error));
    child.once("close", (code) => {
      if (requestedError) finish(requestedError);
      else if (code === 0) finish();
      else finish(new Error((stderr || `ffmpeg terminou com código ${code}`).trim().slice(-1200)));
    });
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function probeLocalVideo(
  filePath: string,
  options: Pick<NormalizeOptions, "signal" | "ffprobeBinary"> = {},
): Promise<LocalVideoProbe> {
  const executable = options.ffprobeBinary || process.env.FFPROBE_BINARY || "ffprobe";
  return new Promise((resolve, reject) => {
    execFile(executable, [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,duration",
      "-of", "json",
      "--",
      filePath,
    ], {
      windowsHide: true,
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 512 * 1024,
      signal: options.signal,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((String(stderr || error.message) || "O ffprobe falhou.").trim().slice(-1200)));
        return;
      }
      try {
        resolve(parseFfprobePayload(JSON.parse(stdout)));
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

async function transcodeTwoPass(options: {
  inputPath: string;
  outputPath: string;
  jobDirectory: string;
  probe: LocalVideoProbe;
  targetBytes: number;
  signal?: AbortSignal;
  ffmpegBinary?: string;
  attempt: number;
}) {
  const profile = calculateLocalTranscodeProfile(options.probe, options.targetBytes);
  const passLogPath = path.join(options.jobDirectory, `ffmpeg-pass-${options.attempt}`);
  const executable = options.ffmpegBinary || process.env.FFMPEG_BINARY || "ffmpeg";
  await runProcess(executable, buildLocalFfmpegArgs({
    inputPath: options.inputPath,
    outputPath: options.outputPath,
    passLogPath,
    pass: 1,
    profile,
    hasAudio: options.probe.hasAudio,
  }), { signal: options.signal });
  await runProcess(executable, buildLocalFfmpegArgs({
    inputPath: options.inputPath,
    outputPath: options.outputPath,
    passLogPath,
    pass: 2,
    profile,
    hasAudio: options.probe.hasAudio,
  }), { signal: options.signal });
}

export async function normalizeLocalVideoForStorage(
  inputPath: string,
  jobDirectory: string,
  options: NormalizeOptions = {},
): Promise<LocalNormalizedVideo> {
  const inputStat = await stat(inputPath);
  if (!inputStat.isFile() || inputStat.size < MIN_VIDEO_BYTES) throw new Error("O arquivo de vídeo está vazio ou incompleto.");
  if (inputStat.size > LOCAL_VIDEO_MAX_INPUT_BYTES) throw new Error("O vídeo excede o limite de 300 MB.");

  const inputProbe = await probeLocalVideo(inputPath, options);
  const targetBytes = options.targetBytes ?? LOCAL_VIDEO_STORAGE_TARGET_BYTES;
  const isMp4 = path.extname(inputPath).toLowerCase() === ".mp4";
  if (!options.force && inputStat.size <= targetBytes && isMp4) {
    return {
      filePath: inputPath,
      size: inputStat.size,
      durationSeconds: inputProbe.durationSeconds,
      hadAudio: inputProbe.hasAudio,
      normalized: false,
      contentType: "video/mp4",
    };
  }

  const outputPath = path.join(jobDirectory, "normalized.mp4");
  await transcodeTwoPass({
    inputPath,
    outputPath,
    jobDirectory,
    probe: inputProbe,
    targetBytes,
    signal: options.signal,
    ffmpegBinary: options.ffmpegBinary,
    attempt: 1,
  });
  let outputStat = await stat(outputPath);
  if (outputStat.size > targetBytes) {
    // VBR/container overhead can vary slightly. A second bounded attempt keeps
    // the Storage contract deterministic rather than trusting bitrate math.
    await transcodeTwoPass({
      inputPath,
      outputPath,
      jobDirectory,
      probe: inputProbe,
      targetBytes: Math.floor(targetBytes * 0.88),
      signal: options.signal,
      ffmpegBinary: options.ffmpegBinary,
      attempt: 2,
    });
    outputStat = await stat(outputPath);
  }
  if (outputStat.size > targetBytes) {
    throw new Error(`A versão normalizada ainda excedeu ${Math.floor(targetBytes / 1024 / 1024)} MB.`);
  }

  const outputProbe = await probeLocalVideo(outputPath, options);
  const durationDelta = Math.abs(outputProbe.durationSeconds - inputProbe.durationSeconds);
  if (durationDelta > Math.max(0.75, inputProbe.durationSeconds * 0.01)) {
    throw new Error("A normalização alterou a duração do vídeo além da tolerância segura.");
  }
  if (inputProbe.hasAudio && !outputProbe.hasAudio) {
    throw new Error("A normalização removeu a faixa de áudio do vídeo.");
  }

  return {
    filePath: outputPath,
    size: outputStat.size,
    durationSeconds: inputProbe.durationSeconds,
    hadAudio: inputProbe.hasAudio,
    normalized: true,
    contentType: "video/mp4",
  };
}
