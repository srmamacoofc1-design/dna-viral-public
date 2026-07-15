import { tmpdir } from "node:os";
import { join } from "node:path";

export const MEBIBYTE = 1024 * 1024;
export const HARD_MAX_VIDEO_MIB = 300;
export const DEFAULT_FORMAT = "best[height<=720][ext=mp4]/best[height<=720]/best";
export const ALLOWED_FORMATS = new Set([
  DEFAULT_FORMAT,
  "best[height<=720]/best",
  "best[ext=mp4]/best",
  "best",
]);

function integerFromEnv(env, name, fallback, minimum, maximum) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} deve ser um inteiro entre ${minimum} e ${maximum}`);
  }
  return value;
}

function requireStrongToken(value) {
  if (typeof value !== "string" || value.length < 32) {
    throw new Error("YTDLP_SERVICE_TOKEN deve conter pelo menos 32 caracteres");
  }
  return value;
}

function normalizePublicBaseUrl(rawValue, production) {
  if (!rawValue) throw new Error("PUBLIC_BASE_URL é obrigatório");
  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error("PUBLIC_BASE_URL não é uma URL válida");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("PUBLIC_BASE_URL não pode conter credenciais, query string ou fragmento");
  }
  if (parsed.pathname !== "/") {
    throw new Error("PUBLIC_BASE_URL deve conter somente a origem, sem caminho");
  }
  if (production && parsed.protocol !== "https:") {
    throw new Error("PUBLIC_BASE_URL deve usar HTTPS em produção");
  }
  if (!production && !["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("PUBLIC_BASE_URL deve usar HTTP ou HTTPS");
  }
  return parsed.origin;
}

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const maxVideoMiB = integerFromEnv(
    env,
    "MAX_VIDEO_MIB",
    HARD_MAX_VIDEO_MIB,
    1,
    HARD_MAX_VIDEO_MIB,
  );

  return {
    host: env.HOST || "0.0.0.0",
    port: integerFromEnv(env, "PORT", 8787, 1, 65535),
    serviceToken: requireStrongToken(env.YTDLP_SERVICE_TOKEN),
    publicBaseUrl: normalizePublicBaseUrl(env.PUBLIC_BASE_URL, production),
    ytDlpBinary: env.YT_DLP_BINARY || "yt-dlp",
    tmpRoot: env.TMP_ROOT || join(tmpdir(), "dna-ytdlp-worker"),
    maxBytes: maxVideoMiB * MEBIBYTE,
    maxConcurrentJobs: integerFromEnv(env, "MAX_CONCURRENT_JOBS", 2, 1, 8),
    downloadTimeoutMs: integerFromEnv(env, "DOWNLOAD_TIMEOUT_MS", 900_000, 10_000, 1_800_000),
    signedUrlTtlMs: integerFromEnv(env, "SIGNED_URL_TTL_MS", 900_000, 60_000, 3_600_000),
    requestBodyMaxBytes: integerFromEnv(env, "REQUEST_BODY_MAX_BYTES", 16_384, 1_024, 65_536),
  };
}
