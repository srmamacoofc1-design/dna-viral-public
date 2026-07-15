import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireLibraryAdminOrService } from "../_shared/edge-auth.ts";
import {
  asIngestionError,
  extensionForMimeType,
  IngestionError,
  jsonResponse,
  MAX_LIBRARY_VIDEO_BYTES,
  parseVideoSource,
} from "../_shared/ingestion.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SOCIAL_PATTERNS = [
  { pattern: /(?:youtube\.com|youtu\.be)/i, name: "YouTube" },
  { pattern: /(?:tiktok\.com)/i, name: "TikTok" },
  { pattern: /(?:instagram\.com)/i, name: "Instagram" },
  { pattern: /(?:facebook\.com|fb\.watch)/i, name: "Facebook" },
  { pattern: /(?:twitter\.com|x\.com)/i, name: "X/Twitter" },
  { pattern: /(?:reddit\.com)/i, name: "Reddit" },
  { pattern: /(?:drive\.google\.com)/i, name: "GoogleDrive" },
];

const EXTRACTOR_TIMEOUT_MS = 30_000;
const DOWNLOAD_HEADER_TIMEOUT_MS = 30_000;
const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new IngestionError("REMOTE_TIMEOUT", "O serviço remoto excedeu o tempo limite.", 504, true);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function detectSocialPlatform(url: string): string | null {
  for (const { pattern, name } of SOCIAL_PATTERNS) {
    if (pattern.test(url)) return name;
  }
  return null;
}

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

async function getDirectUrlViaInvidious(videoId: string): Promise<string> {
  const instances = [
    "https://inv.nadeko.net",
    "https://yewtu.be",
    "https://invidious.nerdvpn.de",
  ];

  let lastError = "";

  for (const instance of instances) {
    try {
      console.log(`Trying Invidious instance: ${instance}`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(
        `${instance}/api/v1/videos/${videoId}?fields=formatStreams,adaptiveFormats`,
        {
          headers: { "Accept": "application/json" },
          signal: controller.signal,
        }
      );
      clearTimeout(timeout);

      const text = await response.text();

      if (!response.ok) {
        lastError = `${instance}: HTTP ${response.status}`;
        continue;
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        lastError = `${instance}: invalid JSON`;
        continue;
      }

      // Try formatStreams first (progressive - has audio+video)
      if (data.formatStreams?.length > 0) {
        // Prefer 720p or 360p mp4
        const preferred = data.formatStreams.find(
          (s: any) => s.container === "mp4" && s.qualityLabel?.includes("720")
        ) || data.formatStreams.find(
          (s: any) => s.container === "mp4"
        ) || data.formatStreams[0];

        if (preferred?.url) {
          console.log(`Invidious ${instance}: found ${preferred.qualityLabel || "unknown"} stream`);
          return preferred.url;
        }
      }

      lastError = `${instance}: no suitable format found`;
    } catch (e) {
      lastError = `${instance}: ${e instanceof Error ? e.message : String(e)}`;
      console.error(lastError);
    }
  }

  throw new Error(`Invidious fallback failed: ${lastError}`);
}

async function getDirectUrlViaCobalt(url: string): Promise<string> {
  const instances = [
    "https://cobalt-api.ayo.tf",
    "https://cobalt.api.timelessnesses.me",
    "https://api.cobalt.tools",
  ];

  let lastError = "";

  for (const instance of instances) {
    try {
      console.log(`Trying cobalt instance: ${instance}`);

      const response = await fetchWithTimeout(instance, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          videoQuality: "720",
          filenameStyle: "basic",
        }),
      }, EXTRACTOR_TIMEOUT_MS);

      const responseText = await response.text();
      console.log(`Cobalt ${instance} status: ${response.status}, body: ${responseText.substring(0, 500)}`);

      if (!response.ok) {
        lastError = `${instance}: HTTP ${response.status}`;
        continue;
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        lastError = `${instance}: invalid JSON response`;
        continue;
      }

      if (data.status === "redirect" || data.status === "stream" || data.status === "tunnel") {
        if (data.url) return data.url;
      }

      if (data.status === "picker" && data.picker?.length > 0) {
        const videoItem = data.picker.find((item: any) => item.type === "video") || data.picker[0];
        if (videoItem?.url) return videoItem.url;
      }

      if (data.url && !data.status) {
        return data.url;
      }

      if (data.status === "error") {
        lastError = `${instance}: ${data.error?.code || data.text || JSON.stringify(data)}`;
        continue;
      }

      lastError = `${instance}: unexpected response: ${responseText.substring(0, 200)}`;
    } catch (e) {
      lastError = `${instance}: ${e instanceof Error ? e.message : String(e)}`;
      console.error(lastError);
    }
  }

  throw new Error(`Cobalt failed: ${lastError}`);
}

function extractGoogleDriveFileId(url: string): string | null {
  // Matches /file/d/FILE_ID/ or id=FILE_ID
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function getGoogleDriveDirectUrl(fileId: string): string {
  return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
}

async function getDirectUrlViaYtDlpService(url: string): Promise<string | null> {
  const serviceUrl = Deno.env.get("YTDLP_SERVICE_URL")?.trim();
  if (!serviceUrl) return null;
  let endpoint: URL;
  try {
    endpoint = new URL(serviceUrl);
  } catch {
    throw new Error("YTDLP_SERVICE_URL não é uma URL válida");
  }
  if (endpoint.protocol !== "https:") {
    throw new Error("YTDLP_SERVICE_URL deve usar HTTPS");
  }
  const token = Deno.env.get("YTDLP_SERVICE_TOKEN")?.trim();
  const response = await fetchWithTimeout(endpoint.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      url,
      format: "best[height<=720][ext=mp4]/best[height<=720]/best",
    }),
  }, EXTRACTOR_TIMEOUT_MS);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`yt-dlp service: HTTP ${response.status} — ${body.slice(0, 200)}`);
  }
  const payload = await response.json();
  const directUrl = payload?.download_url ?? payload?.url;
  if (typeof directUrl !== "string" || !directUrl.startsWith("http")) {
    throw new Error("yt-dlp service não retornou download_url");
  }
  return directUrl;
}

async function getDirectUrl(url: string, platform: string): Promise<{ url: string; method: string }> {
  // Google Drive: convert to direct download link
  if (platform === "GoogleDrive") {
    const fileId = extractGoogleDriveFileId(url);
    if (fileId) {
      return { url: getGoogleDriveDirectUrl(fileId), method: "google-drive" };
    }
    throw new Error("Não foi possível extrair o ID do arquivo do link do Google Drive.");
  }

  // Production path: a private service running the real yt-dlp binary.
  try {
    const ytDlpUrl = await getDirectUrlViaYtDlpService(url);
    if (ytDlpUrl) return { url: ytDlpUrl, method: "yt-dlp" };
  } catch (ytDlpError) {
    console.error("yt-dlp service failed, trying public extractors...", ytDlpError);
  }

  // Try Cobalt first
  try {
    return { url: await getDirectUrlViaCobalt(url), method: "cobalt" };
  } catch (cobaltErr) {
    console.error("Cobalt failed, trying fallbacks...", cobaltErr);
  }

  // For YouTube, try Invidious as fallback
  if (platform === "YouTube") {
    const videoId = extractYouTubeId(url);
    if (videoId) {
      try {
        return { url: await getDirectUrlViaInvidious(videoId), method: "invidious" };
      } catch (invErr) {
        console.error("Invidious failed too:", invErr);
      }
    }
  }

  throw new Error(
    `Não foi possível extrair o vídeo automaticamente. ` +
    `Todas as instâncias de extração estão indisponíveis. ` +
    `Baixe o vídeo manualmente e envie por upload.`
  );
}

async function fetchWithValidatedRedirects(url: string, maxRedirects = 6): Promise<Response> {
  let current = parseVideoSource(url).url;
  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    const response = await fetchWithTimeout(current, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      redirect: "manual",
    }, DOWNLOAD_HEADER_TIMEOUT_MS);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new IngestionError("INVALID_REDIRECT", "O servidor retornou um redirecionamento sem destino.", 502, true);
    current = parseVideoSource(new URL(location, current).toString()).url;
  }
  throw new IngestionError("TOO_MANY_REDIRECTS", "O link entrou em um ciclo de redirecionamentos.", 422);
}

function encodedStoragePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function streamIntoStorage(options: {
  response: Response;
  supabaseUrl: string;
  serviceKey: string;
  filePath: string;
  contentType: string;
}): Promise<number> {
  if (!options.response.body) throw new IngestionError("EMPTY_DOWNLOAD", "O download não retornou dados.", 502, true);
  const declaredSize = Number(options.response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_LIBRARY_VIDEO_BYTES) {
    await options.response.body.cancel();
    throw new IngestionError("VIDEO_TOO_LARGE", "O vídeo excede o limite de 300 MB.", 413);
  }

  let receivedBytes = 0;
  let idleTimeout: number | undefined;
  const resetIdleTimeout = (controller: TransformStreamDefaultController<Uint8Array>) => {
    if (idleTimeout !== undefined) clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => {
      controller.error(new IngestionError("DOWNLOAD_STALLED", "O download ficou sem transmitir dados por muito tempo.", 504, true));
    }, DOWNLOAD_IDLE_TIMEOUT_MS);
  };
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      resetIdleTimeout(controller);
    },
    transform(chunk, controller) {
      resetIdleTimeout(controller);
      receivedBytes += chunk.byteLength;
      if (receivedBytes > MAX_LIBRARY_VIDEO_BYTES) {
        controller.error(new IngestionError("VIDEO_TOO_LARGE", "O vídeo excede o limite de 300 MB.", 413));
        return;
      }
      controller.enqueue(chunk);
    },
    flush() {
      if (idleTimeout !== undefined) clearTimeout(idleTimeout);
    },
  });

  let uploadResponse: Response;
  try {
    uploadResponse = await fetch(
      `${options.supabaseUrl}/storage/v1/object/videos/${encodedStoragePath(options.filePath)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.serviceKey}`,
          apikey: options.serviceKey,
          "Content-Type": options.contentType,
          "x-upsert": "true",
          ...(Number.isFinite(declaredSize) && declaredSize > 0 ? { "Content-Length": String(declaredSize) } : {}),
        },
        body: options.response.body.pipeThrough(limiter),
      },
    );
  } finally {
    if (idleTimeout !== undefined) clearTimeout(idleTimeout);
  }
  if (!uploadResponse.ok) {
    const body = await uploadResponse.text();
    throw new IngestionError("STORAGE_STREAM_FAILED", `Falha ao salvar vídeo no Storage (HTTP ${uploadResponse.status}).`, 502, true, {
      storage_message: body.slice(0, 300),
    });
  }
  if (receivedBytes < 10 * 1024) {
    throw new IngestionError("VIDEO_TOO_SMALL", "O arquivo baixado é pequeno demais para ser um vídeo válido.", 422);
  }
  return receivedBytes;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não permitido", code: "METHOD_NOT_ALLOWED" }, 405, {
      ...corsHeaders,
      Allow: "POST, OPTIONS",
    });
  }

  let videoId: string | null = null;
  let supabase: ReturnType<typeof createClient> | null = null;
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    await requireLibraryAdminOrService({ req, supabaseUrl, serviceRoleKey: serviceKey });
    const body = await req.json();
    videoId = typeof body?.video_id === "string" ? body.video_id : null;
    if (!videoId || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(videoId)) {
      throw new IngestionError("INVALID_VIDEO_ID", "video_id inválido.", 422);
    }
    const source = parseVideoSource(body?.url ?? "");
    if (source.kind === "youtube_collection") {
      throw new IngestionError(
        "YOUTUBE_COLLECTION_NOT_A_VIDEO",
        "Esse endereço é de um canal ou playlist. Cole o link de um vídeo ou Short específico.",
        422,
      );
    }

    supabase = createClient(supabaseUrl, serviceKey);
    const { data: video, error: videoError } = await supabase
      .from("videos")
      .select("id")
      .eq("id", videoId)
      .maybeSingle();
    if (videoError) throw videoError;
    if (!video) throw new IngestionError("VIDEO_NOT_FOUND", "Vídeo não encontrado.", 404);

    // A retry after an Edge timeout reuses the object already committed to Storage.
    const { data: existingMetadata } = await supabase
      .from("video_metadata")
      .select("valor")
      .eq("video_id", videoId)
      .eq("chave", "file_path")
      .order("created_at", { ascending: false })
      .limit(1);
    const existingPath = typeof existingMetadata?.[0]?.valor === "string" ? existingMetadata[0].valor : null;
    if (existingPath) {
      const head = await fetch(`${supabaseUrl}/storage/v1/object/videos/${encodedStoragePath(existingPath)}`, {
        method: "HEAD",
        headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
      });
      if (head.ok && Number(head.headers.get("content-length")) > 10 * 1024) {
        return jsonResponse({ success: true, reused: true, file_path: existingPath }, 200, corsHeaders);
      }
    }

    const platform = source.platform;
    await supabase.from("video_logs").insert({
      video_id: videoId,
      etapa: "Download",
      status: "success",
      mensagem: platform ? `🔗 ${platform} detectado; extraindo o vídeo específico...` : "📥 Baixando link direto...",
    });

    let downloadUrl = source.url;
    let extractorName = "direct";
    if (platform) {
      const resolved = await getDirectUrl(source.url, platform);
      downloadUrl = resolved.url;
      extractorName = resolved.method;
    }
    const response = await fetchWithValidatedRedirects(downloadUrl);
    if (!response.ok) throw new IngestionError("VIDEO_DOWNLOAD_FAILED", `Falha ao baixar vídeo (HTTP ${response.status}).`, 502, response.status >= 500);
    const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].toLowerCase();
    if (!contentType.startsWith("video/") && !contentType.includes("octet-stream")) {
      await response.body?.cancel();
      throw new IngestionError(
        "URL_IS_NOT_VIDEO",
        "O endereço resolvido não entregou um arquivo de vídeo. Use um vídeo/Short específico ou faça upload do arquivo.",
        422,
        false,
        { content_type: contentType || "unknown" },
      );
    }

    const extension = extensionForMimeType(contentType, downloadUrl);
    const filePath = `${videoId}.${extension}`;
    let sizeBytes = 0;
    try {
      sizeBytes = await streamIntoStorage({
        response,
        supabaseUrl,
        serviceKey,
        filePath,
        contentType: contentType.startsWith("video/") ? contentType : `video/${extension}`,
      });
    } catch (error) {
      await supabase.storage.from("videos").remove([filePath]);
      throw error;
    }

    await supabase.from("video_metadata").delete().eq("video_id", videoId).in("chave", ["file_path", "download_method"]);
    await supabase.from("video_metadata").insert([
      { video_id: videoId, chave: "file_path", valor: filePath },
      { video_id: videoId, chave: "download_method", valor: extractorName },
    ]);
    await supabase.from("videos").update({ tamanho: sizeBytes }).eq("id", videoId);
    await supabase.from("video_logs").insert({
      video_id: videoId,
      etapa: "Download",
      status: "success",
      mensagem: `✅ ${(sizeBytes / 1024 / 1024).toFixed(1)} MB transmitidos ao Storage sem carregar o arquivo inteiro na memória`,
    });

    return jsonResponse({
      success: true,
      reused: false,
      file_path: filePath,
      size_mb: sizeBytes / 1024 / 1024,
      method: extractorName,
      platform,
    }, 200, corsHeaders);
  } catch (error) {
    const failure = asIngestionError(error);
    console.error("download-video error:", failure);
    if (videoId && supabase) {
      await supabase.from("video_logs").insert({
        video_id: videoId,
        etapa: "Download",
        status: "error",
        mensagem: `❌ [${failure.code}] ${failure.message}`,
      });
    }
    return jsonResponse({
      error: failure.message,
      code: failure.code,
      retryable: failure.retryable,
      details: failure.details,
    }, failure.status, corsHeaders);
  }
});
