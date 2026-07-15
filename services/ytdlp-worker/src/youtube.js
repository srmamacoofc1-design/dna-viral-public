const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const LONG_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

export class YouTubeUrlError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "YouTubeUrlError";
    this.code = code;
    this.status = 422;
  }
}

function collectionError() {
  return new YouTubeUrlError(
    "YOUTUBE_COLLECTION_NOT_A_VIDEO",
    "Envie o link de um vídeo ou Short individual; canais e playlists não são aceitos.",
  );
}

export function parseYouTubeVideoUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new YouTubeUrlError("INVALID_URL", "A URL informada é inválida.");
  }

  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new YouTubeUrlError("INVALID_URL", "Use uma URL HTTP ou HTTPS sem credenciais.");
  }

  const hostname = parsed.hostname.toLowerCase();
  const isShortHost = hostname === "youtu.be" || hostname === "www.youtu.be";
  if (!isShortHost && !LONG_HOSTS.has(hostname)) {
    throw new YouTubeUrlError("UNSUPPORTED_HOST", "Somente links individuais do YouTube são aceitos.");
  }

  if (parsed.searchParams.has("list") || parsed.searchParams.has("index")) {
    throw collectionError();
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (
    parts[0]?.startsWith("@") ||
    ["channel", "c", "user", "feed", "playlist"].includes(parts[0] || "")
  ) {
    throw collectionError();
  }

  let videoId = null;
  if (isShortHost) {
    if (parts.length === 1) videoId = parts[0];
  } else if (parsed.pathname === "/watch") {
    const candidates = parsed.searchParams.getAll("v");
    if (candidates.length === 1) videoId = candidates[0];
  } else if (["shorts", "embed", "live"].includes(parts[0] || "") && parts.length === 2) {
    videoId = parts[1];
  }

  if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) {
    throw new YouTubeUrlError(
      "YOUTUBE_VIDEO_ID_NOT_FOUND",
      "O link não contém um vídeo individual identificável do YouTube.",
    );
  }

  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
