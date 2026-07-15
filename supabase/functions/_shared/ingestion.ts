export const MEBIBYTE = 1024 * 1024;
export const MAX_LIBRARY_VIDEO_BYTES = 300 * MEBIBYTE;
export const MAX_REFERENCE_VIDEO_BYTES = 300 * MEBIBYTE;
export const REFERENCE_VIDEO_BUCKET = "reference-videos";
/** Internal work chunk; this is not a user-facing maximum. */
export const BULK_VIDEO_LINK_CHUNK_SIZE = 25;

export type SourceKind =
  | "direct_video"
  | "youtube_video"
  | "youtube_collection"
  | "social_video";

export interface ParsedVideoSource {
  url: string;
  kind: SourceKind;
  platform: string | null;
  videoId: string | null;
}

export interface BulkVideoLinkItem {
  /** One-based line number in the pasted textarea. */
  line: number;
  rawUrl: string;
  canonicalUrl: string;
  idempotencyKey: string;
  source: ParsedVideoSource;
}

export interface BulkVideoLinkIssue {
  /** One-based line number in the pasted textarea. */
  line: number;
  rawUrl: string;
  code: string;
  message: string;
  duplicateOfLine?: number;
}

export interface BulkVideoLinkParseResult {
  /** Unique, concrete video links that are safe to enqueue independently. */
  accepted: BulkVideoLinkItem[];
  /** Invalid URLs, channels/playlists and optional caller-defined overflow. */
  rejected: BulkVideoLinkIssue[];
  /** Repeated links, kept separate so the UI can explain that they were ignored. */
  duplicates: BulkVideoLinkIssue[];
  /** Number of non-empty lines supplied by the user. */
  inputCount: number;
}

export class IngestionError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status = 400,
    retryable = false,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "IngestionError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

const SOCIAL_HOSTS: Array<{ suffix: string; platform: string }> = [
  { suffix: "tiktok.com", platform: "TikTok" },
  { suffix: "instagram.com", platform: "Instagram" },
  { suffix: "facebook.com", platform: "Facebook" },
  { suffix: "fb.watch", platform: "Facebook" },
  { suffix: "twitter.com", platform: "X/Twitter" },
  { suffix: "x.com", platform: "X/Twitter" },
  { suffix: "reddit.com", platform: "Reddit" },
  { suffix: "drive.google.com", platform: "GoogleDrive" },
];

function hostMatches(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((value) => value > 255)) return false;
  const [a, b] = octets;
  return a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127);
}

function assertPublicHttpUrl(parsed: URL): void {
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new IngestionError("INVALID_URL_PROTOCOL", "Use um link HTTP ou HTTPS.", 422);
  }
  if (parsed.username || parsed.password) {
    throw new IngestionError("URL_CREDENTIALS_NOT_ALLOWED", "Links com credenciais embutidas não são aceitos.", 422);
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname === "::1" ||
    // Literal IPv6 targets are not needed by the supported video providers
    // and are easy to abuse to reach loopback, link-local or ULA networks.
    // Domain names and public IPv4 literals remain supported.
    hostname.includes(":") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal" ||
    isPrivateIpv4(hostname)
  ) {
    throw new IngestionError("PRIVATE_URL_NOT_ALLOWED", "O link aponta para uma rede privada e foi bloqueado.", 422);
  }
}

export function extractYouTubeVideoId(parsed: URL): string | null {
  const hostname = parsed.hostname.toLowerCase();
  let candidate: string | null = null;

  if (hostMatches(hostname, "youtu.be")) {
    candidate = parsed.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (hostMatches(hostname, "youtube.com") || hostMatches(hostname, "youtube-nocookie.com")) {
    candidate = parsed.searchParams.get("v");
    if (!candidate) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "live"].includes(parts[0] ?? "")) candidate = parts[1] ?? null;
    }
  }

  return candidate && /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
}

function isYouTubeCollectionUrl(parsed: URL): boolean {
  const hostname = parsed.hostname.toLowerCase();
  if (!hostMatches(hostname, "youtube.com")) return false;
  const parts = parsed.pathname.split("/").filter(Boolean);
  return parsed.pathname === "/playlist" ||
    parts[0]?.startsWith("@") === true ||
    ["channel", "c", "user", "feed"].includes(parts[0] ?? "");
}

export function parseVideoSource(rawUrl: string): ParsedVideoSource {
  const value = rawUrl?.trim();
  if (!value) throw new IngestionError("URL_REQUIRED", "Informe o link do vídeo.", 400);

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new IngestionError("INVALID_URL", "O link informado não é uma URL válida.", 422);
  }
  assertPublicHttpUrl(parsed);

  // Fragments are never sent to the remote server and only make idempotency noisy.
  parsed.hash = "";
  const hostname = parsed.hostname.toLowerCase();
  const isYouTube = hostMatches(hostname, "youtube.com") ||
    hostMatches(hostname, "youtu.be") ||
    hostMatches(hostname, "youtube-nocookie.com");

  if (isYouTube) {
    const videoId = extractYouTubeVideoId(parsed);
    if (videoId) {
      return { url: parsed.toString(), kind: "youtube_video", platform: "YouTube", videoId };
    }
    if (isYouTubeCollectionUrl(parsed)) {
      return { url: parsed.toString(), kind: "youtube_collection", platform: "YouTube", videoId: null };
    }
    throw new IngestionError(
      "YOUTUBE_VIDEO_ID_NOT_FOUND",
      "O link do YouTube não contém um vídeo identificável. Use a URL de um vídeo ou Short.",
      422,
    );
  }

  const social = SOCIAL_HOSTS.find(({ suffix }) => hostMatches(hostname, suffix));
  if (social) {
    return { url: parsed.toString(), kind: "social_video", platform: social.platform, videoId: null };
  }
  return { url: parsed.toString(), kind: "direct_video", platform: null, videoId: null };
}

/** A stable source token used to make link ingestion safe to retry. */
export function sourceIdempotencyKey(source: ParsedVideoSource): string {
  if (source.kind === "youtube_video" && source.videoId) return `youtube:${source.videoId}`;
  const parsed = new URL(source.url);
  parsed.hostname = parsed.hostname.toLowerCase();
  if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) {
    parsed.port = "";
  }
  parsed.searchParams.sort();
  return `${source.kind}:${parsed.toString()}`;
}

/**
 * Returns a stable, user-facing URL for a parsed source.
 *
 * YouTube share, Shorts, live and watch URLs all become the same watch URL.
 * For every other provider we preserve query parameters (some are signed), but
 * remove fragments and sort the query string so equivalent links are stable.
 */
export function canonicalizeVideoSource(source: ParsedVideoSource): string {
  if (source.kind === "youtube_video" && source.videoId) {
    return `https://www.youtube.com/watch?v=${source.videoId}`;
  }

  const parsed = new URL(source.url);
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) {
    parsed.port = "";
  }
  parsed.searchParams.sort();
  return parsed.toString();
}

/**
 * Parses a textarea containing one video URL per line without failing the
 * entire batch when one line is bad. The caller can enqueue `accepted` items
 * independently and present `rejected`/`duplicates` as a partial result.
 * There is no default link limit; callers may pass one for a constrained job.
 */
export function parseBulkVideoLinks(
  rawInput: string,
  maxLinks?: number,
): BulkVideoLinkParseResult {
  const accepted: BulkVideoLinkItem[] = [];
  const rejected: BulkVideoLinkIssue[] = [];
  const duplicates: BulkVideoLinkIssue[] = [];
  const lines = String(rawInput ?? "")
    .split(/\r?\n/)
    .map((rawUrl, index) => ({ line: index + 1, rawUrl: rawUrl.trim() }))
    .filter(({ rawUrl }) => rawUrl.length > 0);

  const normalizedLimit = Number.isInteger(maxLinks) && Number(maxLinks) > 0
    ? Number(maxLinks)
    : Number.POSITIVE_INFINITY;
  const firstLineByKey = new Map<string, number>();

  for (const [index, entry] of lines.entries()) {
    if (index >= normalizedLimit) {
      rejected.push({
        ...entry,
        code: "BULK_LINK_LIMIT_EXCEEDED",
        message: `Este processamento aceita no máximo ${normalizedLimit} links por envio.`,
      });
      continue;
    }

    try {
      const parsed = parseVideoSource(entry.rawUrl);
      if (parsed.kind === "youtube_collection") {
        rejected.push({
          ...entry,
          code: "YOUTUBE_COLLECTION_NOT_A_VIDEO",
          message: "Esse endereço é de um canal ou playlist. Cole o link de um vídeo ou Short específico.",
        });
        continue;
      }

      const idempotencyKey = sourceIdempotencyKey(parsed);
      const duplicateOfLine = firstLineByKey.get(idempotencyKey);
      if (duplicateOfLine !== undefined) {
        duplicates.push({
          ...entry,
          code: "DUPLICATE_VIDEO_LINK",
          message: `O mesmo vídeo já apareceu na linha ${duplicateOfLine}.`,
          duplicateOfLine,
        });
        continue;
      }

      firstLineByKey.set(idempotencyKey, entry.line);
      const canonicalUrl = canonicalizeVideoSource(parsed);
      accepted.push({
        ...entry,
        canonicalUrl,
        idempotencyKey,
        // Keep the validated source URL for the actual download. Reordering
        // query parameters can invalidate provider/CDN signatures; canonicalUrl
        // is only the stable display/storage form.
        source: parsed,
      });
    } catch (error) {
      const ingestionError = asIngestionError(error);
      rejected.push({
        ...entry,
        code: ingestionError.code,
        message: ingestionError.message,
      });
    }
  }

  return { accepted, rejected, duplicates, inputCount: lines.length };
}

export function assertVideoSize(sizeBytes: number, maxBytes = MAX_REFERENCE_VIDEO_BYTES): void {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new IngestionError("INVALID_VIDEO_SIZE", "O arquivo de vídeo está vazio ou possui tamanho inválido.", 422);
  }
  if (sizeBytes > maxBytes) {
    throw new IngestionError(
      "VIDEO_TOO_LARGE",
      `O vídeo excede o limite de ${Math.floor(maxBytes / MEBIBYTE)} MB.`,
      413,
      false,
      { size_bytes: sizeBytes, max_bytes: maxBytes },
    );
  }
}

export function normalizeStoragePath(value: string): string {
  const path = value?.trim().replace(/^\/+/, "");
  if (!path || path.length > 1024 || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new IngestionError("INVALID_STORAGE_PATH", "Caminho de arquivo inválido.", 422);
  }
  return path;
}

export function extensionForMimeType(contentType: string | null, sourceUrl = ""): string {
  const mime = (contentType ?? "").split(";", 1)[0].trim().toLowerCase();
  const byMime: Record<string, string> = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/x-msvideo": "avi",
    "video/mpeg": "mpeg",
    "video/3gpp": "3gp",
  };
  if (byMime[mime]) return byMime[mime];
  try {
    const ext = new URL(sourceUrl).pathname.split(".").pop()?.toLowerCase();
    if (ext && /^(mp4|webm|mov|avi|mpeg|mpg|3gp)$/.test(ext)) return ext;
  } catch {
    // Ignore malformed source URL here; it was validated earlier in the pipeline.
  }
  return "mp4";
}

export function asIngestionError(error: unknown): IngestionError {
  if (error instanceof IngestionError) return error;
  const message = error instanceof Error ? error.message : "Erro desconhecido na ingestão";
  return new IngestionError("INGESTION_FAILED", message, 500, true);
}

export function jsonResponse(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
