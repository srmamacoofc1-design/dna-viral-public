import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";
import {
  geminiOpenAIChat,
  hasGeminiApiKeys,
} from "../_shared/gemini-rotation.ts";
import { imageBytesToBase64, readInlineImage } from "../_shared/inline-image.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SpreadsheetRow {
  codigo_planilha: string | null;
  link_drive_video: string;
  link_plataforma: string | null;
  link_imagem_engajamento: string | null;
  titulo: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
}

interface EngagementResult {
  titulo?: string;
  views?: number;
  likes?: number;
  comments?: number;
  error?: string;
  fields_found: string[];
  fields_missing: string[];
  status: "imagem_sucesso" | "imagem_parcial" | "imagem_falhou" | "imagem_nao_tentado" | "scrape_sucesso" | "scrape_parcial" | "scrape_falhou" | "scrape_nao_tentado" | "plataforma_nao_suportada";
  source: "imagem" | "scrape" | "nenhum";
}

function normalize(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function extractDriveFileId(url: string): string {
  const trimmed = url.trim();
  const match = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  return trimmed;
}

const COLUMN_ALIASES: Record<string, string[]> = {
  codigo_planilha: ["codigo_planilha", "codigo", "code"],
  link_drive_video: ["link_drive_video", "link_drive", "drive_video_url"],
  link_plataforma: ["link_plataforma", "link_publicacao", "link_publicado", "plataforma"],
  link_imagem_engajamento: ["link_imagem_engajamento", "imagem_engajamento", "engagement_image", "print_engajamento"],
  titulo: ["titulo", "title", "nome"],
  views: ["views", "visualizacoes", "reproduções", "reproduces"],
  likes: ["likes", "curtidas"],
  comments: ["comments", "comentarios", "comentários"],
};

function mapHeaders(rawHeaders: string[]): Record<number, string> {
  const mapping: Record<number, string> = {};
  const normalized = rawHeaders.map(normalize);
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (let i = 0; i < normalized.length; i++) {
      if (mapping[i] !== undefined) continue;
      if (aliases.includes(normalized[i])) {
        mapping[i] = field;
        break;
      }
    }
  }
  return mapping;
}

function parseCSVText(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let inQuotes = false;
  let row: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ",") { row.push(current); current = ""; }
      else if (ch === "\r" && next === "\n") { row.push(current); current = ""; rows.push(row); row = []; i++; }
      else if (ch === "\n") { row.push(current); current = ""; rows.push(row); row = []; }
      else { current += ch; }
    }
  }
  if (current || row.length > 0) { row.push(current); rows.push(row); }
  return rows;
}

function parseCSV(text: string): { rows: SpreadsheetRow[]; errors: Array<{ linha: number; codigo: string | null; motivo: string }> } {
  const rawRows = parseCSVText(text);
  if (rawRows.length < 2) return { rows: [], errors: [] };

  const headerRow = rawRows[0];
  const mapping = mapHeaders(headerRow);
  const mappedFields = new Set(Object.values(mapping));

  if (!mappedFields.has("link_drive_video")) {
    return {
      rows: [],
      errors: [{ linha: 1, codigo: null, motivo: `Coluna "link_drive_video" não encontrada. Cabeçalhos detectados: ${headerRow.join(", ")}` }],
    };
  }

  const rows: SpreadsheetRow[] = [];
  const errors: Array<{ linha: number; codigo: string | null; motivo: string }> = [];

  for (let i = 1; i < rawRows.length; i++) {
    const values = rawRows[i];
    if (values.every((v) => !v.trim())) continue;

    const obj: Record<string, string> = {};
    for (const [idx, field] of Object.entries(mapping)) {
      obj[field] = (values[parseInt(idx)] || "").trim();
    }

    const codigo = obj["codigo_planilha"]?.trim() || null;
    const lineNum = i + 1;
    const link = obj["link_drive_video"] || "";

    if (!link) {
      errors.push({ linha: lineNum, codigo, motivo: "link_drive_video vazio" });
      continue;
    }

    const manualTitulo = obj["titulo"]?.trim() || null;
    const rawViews = obj["views"]?.trim() ? parseAbbreviated(obj["views"]) : NaN;
    const rawLikes = obj["likes"]?.trim() ? parseAbbreviated(obj["likes"]) : NaN;
    const rawComments = obj["comments"]?.trim() ? parseAbbreviated(obj["comments"]) : NaN;
    const manualViews = !isNaN(rawViews) && rawViews >= 0 && rawViews <= 50_000_000_000 ? rawViews : null;
    const manualLikes = !isNaN(rawLikes) && rawLikes >= 0 && rawLikes <= 1_000_000_000 ? rawLikes : null;
    const manualComments = !isNaN(rawComments) && rawComments >= 0 && rawComments <= 500_000_000 ? rawComments : null;

    rows.push({
      codigo_planilha: codigo,
      link_drive_video: link,
      link_plataforma: obj["link_plataforma"]?.trim() || null,
      link_imagem_engajamento: obj["link_imagem_engajamento"]?.trim() || null,
      titulo: manualTitulo,
      views: isNaN(manualViews as number) ? null : manualViews,
      likes: isNaN(manualLikes as number) ? null : manualLikes,
      comments: isNaN(manualComments as number) ? null : manualComments,
    });
  }

  return { rows, errors };
}

async function fetchGoogleSheet(url: string): Promise<string> {
  let csvUrl = url;
  const sheetIdMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (sheetIdMatch) {
    const sheetId = sheetIdMatch[1];
    csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    const gidMatch = url.match(/gid=(\d+)/);
    if (gidMatch) csvUrl += `&gid=${gidMatch[1]}`;
  }
  const response = await fetch(csvUrl);
  if (!response.ok) throw new Error(`Falha ao acessar a planilha: ${response.status} ${response.statusText}`);
  return await response.text();
}

// ── Convert Google Drive share link to direct image URL ──
function driveImageToDirectUrl(url: string): string {
  const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileIdMatch) {
    return `https://drive.google.com/uc?export=view&id=${fileIdMatch[1]}`;
  }
  const idParam = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParam) {
    return `https://drive.google.com/uc?export=view&id=${idParam[1]}`;
  }
  return url;
}

// ── Download image and convert to base64 ──
async function downloadImageAsBase64(url: string): Promise<{ base64: string; mimeType: string } | { error: string }> {
  try {
    const directUrl = driveImageToDirectUrl(url);
    console.log(`[image] Baixando imagem: ${directUrl}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const res = await fetch(directUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { error: `HTTP ${res.status} ao baixar imagem` };
    }

    const { bytes, mimeType } = await readInlineImage(res);
    const base64 = imageBytesToBase64(bytes);
    console.log(`[image] Imagem baixada: ${bytes.length} bytes, tipo: ${mimeType}`);

    return { base64, mimeType };
  } catch (err: any) {
    const msg = err.name === "AbortError" ? "Timeout (20s) ao baixar imagem" : (err.message || "Erro ao baixar imagem");
    console.error(`[image] Exceção: ${msg}`);
    return { error: msg };
  }
}

// ── Use AI vision to extract engagement data from image ──
async function extractEngagementFromImage(imageBase64: string, mimeType: string): Promise<{ titulo?: string; views?: number; likes?: number; comments?: number; error?: string }> {
  if (!hasGeminiApiKeys()) {
    return { error: "GEMINI_API_KEYS não configurada" };
  }

  try {
    const response = await geminiOpenAIChat({
        model: "gemini-3.5-flash",
        messages: [
          {
            role: "system",
            content: `You are a data extraction assistant. You analyze screenshots of social media video pages (Instagram, YouTube, TikTok, etc.) and extract engagement metrics.

Extract the following fields from the image:
- titulo: the video title or caption visible
- views: number of views/plays (convert abbreviated like 1.2M to 1200000, 5K to 5000)
- likes: number of likes/hearts
- comments: number of comments

IMPORTANT RULES:
- Return ONLY valid JSON, nothing else
- Use null for fields you cannot find in the image
- Convert abbreviated numbers: K=1000, M=1000000, B=1000000000
- Remove dots/commas used as thousand separators
- If the image is not a social media page or is unreadable, return all nulls with error field
- The numbers in Portuguese use dots for thousands (1.234 = 1234) and may use "mil" for thousands
- "visualizações" or "reproduções" = views
- "curtidas" = likes
- "comentários" = comments`,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract titulo, views, likes, and comments from this social media screenshot. Return only JSON like: {\"titulo\": \"...\", \"views\": 1234, \"likes\": 56, \"comments\": 7}",
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_engagement",
              description: "Extract engagement metrics from a social media screenshot",
              parameters: {
                type: "object",
                properties: {
                  titulo: { type: "string", description: "Video title or caption" },
                  views: { type: "number", description: "Number of views/plays" },
                  likes: { type: "number", description: "Number of likes" },
                  comments: { type: "number", description: "Number of comments" },
                },
                required: [],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_engagement" } },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[image-ai] Gemini error: ${response.status} ${errText}`);
      if (response.status === 429) return { error: "Rate limit da AI — tente novamente mais tarde" };
      if (response.status === 402) return { error: "Quota Gemini indisponível" };
      return { error: `Gemini erro HTTP ${response.status}` };
    }

    const data = await response.json();

    // Extract from tool call response
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      const parsed = JSON.parse(toolCall.function.arguments);
      console.log(`[image-ai] Dados extraídos: titulo=${parsed.titulo}, views=${parsed.views}, likes=${parsed.likes}, comments=${parsed.comments}`);
      return {
        titulo: parsed.titulo || undefined,
        views: typeof parsed.views === "number" && parsed.views >= 0 && parsed.views <= 50_000_000_000 ? parsed.views : undefined,
        likes: typeof parsed.likes === "number" && parsed.likes >= 0 && parsed.likes <= 1_000_000_000 ? parsed.likes : undefined,
        comments: typeof parsed.comments === "number" && parsed.comments >= 0 && parsed.comments <= 500_000_000 ? parsed.comments : undefined,
      };
    }

    // Fallback: try parsing content as JSON
    const content = data.choices?.[0]?.message?.content;
    if (content) {
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            titulo: parsed.titulo || undefined,
            views: typeof parsed.views === "number" && parsed.views >= 0 && parsed.views <= 50_000_000_000 ? parsed.views : undefined,
            likes: typeof parsed.likes === "number" && parsed.likes >= 0 && parsed.likes <= 1_000_000_000 ? parsed.likes : undefined,
            comments: typeof parsed.comments === "number" && parsed.comments >= 0 && parsed.comments <= 500_000_000 ? parsed.comments : undefined,
          };
        }
      } catch (_) {}
    }

    return { error: "AI não retornou dados estruturados" };
  } catch (err: any) {
    console.error(`[image-ai] Exceção: ${err.message}`);
    return { error: err.message || "Erro ao chamar AI vision" };
  }
}

// ── Process engagement image ──
async function processEngagementImage(imageUrl: string): Promise<EngagementResult> {
  const download = await downloadImageAsBase64(imageUrl);
  if ("error" in download) {
    return {
      status: "imagem_falhou",
      source: "imagem",
      fields_found: [],
      fields_missing: ["titulo", "views", "likes", "comments"],
      error: `Falha ao baixar imagem: ${download.error}`,
    };
  }

  const extracted = await extractEngagementFromImage(download.base64, download.mimeType);
  if (extracted.error && !extracted.titulo && extracted.views === undefined && extracted.likes === undefined && extracted.comments === undefined) {
    return {
      status: "imagem_falhou",
      source: "imagem",
      fields_found: [],
      fields_missing: ["titulo", "views", "likes", "comments"],
      error: `Falha na extração AI: ${extracted.error}`,
    };
  }

  const ALL_FIELDS = ["titulo", "views", "likes", "comments"] as const;
  const fields_found: string[] = [];
  const fields_missing: string[] = [];

  for (const f of ALL_FIELDS) {
    if (extracted[f] !== undefined && extracted[f] !== null) fields_found.push(f);
    else fields_missing.push(f);
  }

  let status: EngagementResult["status"];
  if (fields_found.length === ALL_FIELDS.length) status = "imagem_sucesso";
  else if (fields_found.length > 0) status = "imagem_parcial";
  else status = "imagem_falhou";

  let error: string | undefined;
  if (status === "imagem_falhou") {
    error = extracted.error || "Nenhum dado extraído da imagem";
  } else if (status === "imagem_parcial") {
    error = `Imagem parcial: encontrados [${fields_found.join(", ")}], ausentes [${fields_missing.join(", ")}]`;
  }

  return {
    titulo: extracted.titulo,
    views: extracted.views,
    likes: extracted.likes,
    comments: extracted.comments,
    status,
    source: "imagem",
    fields_found,
    fields_missing,
    error,
  };
}

// ── Platform detection (kept for fallback scrape) ──
function detectPlatform(url: string): string | null {
  const u = url.toLowerCase();
  if (u.includes("youtube.com") || u.includes("youtu.be") || u.includes("youtube.com/shorts")) return "youtube";
  if (u.includes("instagram.com")) return "instagram";
  if (u.includes("tiktok.com")) return "tiktok";
  return null;
}

// Max sane values for engagement metrics (no video in history exceeds these)
const MAX_SANE_VIEWS = 50_000_000_000; // 50 billion
const MAX_SANE_LIKES = 1_000_000_000;  // 1 billion
const MAX_SANE_COMMENTS = 500_000_000; // 500 million

function sanitizeMetric(value: number | undefined | null, max: number): number | null {
  if (value === undefined || value === null || isNaN(value)) return null;
  if (value < 0) return null;
  if (value > max) {
    console.warn(`[sanity] Valor ${value} excede limite máximo ${max} — rejeitado`);
    return null;
  }
  return value;
}

function parseAbbreviated(raw: string): number {
  let s = raw.replace(/,/g, "").replace(/\s/g, "");
  const suffixMatch = s.match(/([kmb])$/i);
  let mult = 1;
  if (suffixMatch) {
    const sf = suffixMatch[1].toLowerCase();
    if (sf === "k") mult = 1_000;
    else if (sf === "m") mult = 1_000_000;
    else if (sf === "b") mult = 1_000_000_000;
    s = s.slice(0, -1);
  }
  s = s.replace(",", ".");
  const num = parseFloat(s);
  if (isNaN(num)) return NaN;
  return Math.round(num * mult);
}

function parseYouTube(html: string) {
  const result: { titulo?: string; views?: number; likes?: number; comments?: number } = {};
  const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (ogTitle) result.titulo = ogTitle[1];
  const interactionMatch = html.match(/"interactionCount"\s*:\s*"?(\d+)"?/);
  if (interactionMatch) result.views = parseInt(interactionMatch[1]);
  if (result.views === undefined) {
    const viewMeta = html.match(/<meta[^>]*(?:name|property)=["'](?:og:video:view_count|interactionCount)["'][^>]*content=["'](\d+)["']/i);
    if (viewMeta) result.views = parseInt(viewMeta[1]);
  }
  const likeMatch = html.match(/"userInteractionCount"\s*:\s*"?(\d+)"?[^}]*"interactionType"[^}]*"LikeAction"/s);
  if (likeMatch) result.likes = parseInt(likeMatch[1]);
  const commentMatch = html.match(/"commentCount"\s*:\s*"?(\d+)"?/);
  if (commentMatch) result.comments = parseInt(commentMatch[1]);
  return result;
}

function parseInstagram(html: string) {
  const result: { titulo?: string; views?: number; likes?: number; comments?: number } = {};
  const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (ogTitle) result.titulo = ogTitle[1];
  const interactionMatch = html.match(/"interactionCount"\s*:\s*"?(\d+)"?/);
  if (interactionMatch) result.views = parseInt(interactionMatch[1]);
  const ogDesc = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  if (ogDesc) {
    const likesInDesc = ogDesc[1].match(/([\d,.]+[KMB]?)\s*(?:likes|curtidas)/i);
    if (likesInDesc) { const n = parseAbbreviated(likesInDesc[1]); if (!isNaN(n)) result.likes = n; }
    const commentsInDesc = ogDesc[1].match(/([\d,.]+[KMB]?)\s*(?:comments|comentários|comentarios)/i);
    if (commentsInDesc) { const n = parseAbbreviated(commentsInDesc[1]); if (!isNaN(n)) result.comments = n; }
  }
  return result;
}

function parseTikTok(html: string) {
  const result: { titulo?: string; views?: number; likes?: number; comments?: number } = {};
  const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (ogTitle) result.titulo = ogTitle[1];
  else { const t = html.match(/<title[^>]*>([^<]+)<\/title>/i); if (t) result.titulo = t[1].trim(); }
  const playCount = html.match(/"playCount"\s*:\s*(\d+)/);
  if (playCount) result.views = parseInt(playCount[1]);
  const diggCount = html.match(/"diggCount"\s*:\s*(\d+)/);
  if (diggCount) result.likes = parseInt(diggCount[1]);
  const commentCount = html.match(/"commentCount"\s*:\s*(\d+)/);
  if (commentCount) result.comments = parseInt(commentCount[1]);
  return result;
}

async function scrapePublicData(url: string): Promise<EngagementResult> {
  const platform = detectPlatform(url);

  if (!platform) {
    let hostname = "desconhecido";
    try { hostname = new URL(url).hostname; } catch (_) {}
    return {
      status: "plataforma_nao_suportada",
      source: "scrape",
      platform: hostname,
      fields_found: [],
      fields_missing: ["titulo", "views", "likes", "comments"],
      error: `Plataforma não suportada: ${hostname}`,
    } as any;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
      signal: controller.signal, redirect: "follow",
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { status: "scrape_falhou", source: "scrape", fields_found: [], fields_missing: ["titulo", "views", "likes", "comments"], error: `HTTP ${res.status} ao acessar ${platform}` };
    }

    const html = await res.text();
    let parsed: { titulo?: string; views?: number; likes?: number; comments?: number };
    if (platform === "youtube") parsed = parseYouTube(html);
    else if (platform === "instagram") parsed = parseInstagram(html);
    else parsed = parseTikTok(html);

    const ALL = ["titulo", "views", "likes", "comments"] as const;
    const fields_found: string[] = [];
    const fields_missing: string[] = [];
    for (const f of ALL) {
      if (parsed[f] !== undefined && parsed[f] !== null) fields_found.push(f);
      else fields_missing.push(f);
    }

    let status: EngagementResult["status"];
    if (fields_found.length === ALL.length) status = "scrape_sucesso";
    else if (fields_found.length > 0) status = "scrape_parcial";
    else status = "scrape_falhou";

    let error: string | undefined;
    if (status === "scrape_falhou") error = `HTTP OK mas nenhum dado extraído de ${platform}`;
    else if (status === "scrape_parcial") error = `Parcial: [${fields_found}] ok, [${fields_missing}] ausentes`;

    return { ...parsed, status, source: "scrape", fields_found, fields_missing, error };
  } catch (err: any) {
    return { status: "scrape_falhou", source: "scrape", fields_found: [], fields_missing: ["titulo", "views", "likes", "comments"], error: err.message || "Erro scrape" };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { csv_text, sheet_url } = body as { csv_text?: string; sheet_url?: string };

    if (!csv_text && !sheet_url) {
      return new Response(
        JSON.stringify({ error: "Forneça csv_text ou sheet_url" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let csvData: string;
    if (csv_text) csvData = csv_text;
    else csvData = await fetchGoogleSheet(sheet_url!);

    const { rows, errors: parseErrors } = parseCSV(csvData);

    if (rows.length === 0 && parseErrors.length > 0 && parseErrors[0].linha === 1) {
      return new Response(
        JSON.stringify({
          error: parseErrors[0].motivo,
          total_lidas: 0, importados: 0, ignorados: 0, erros: 1,
          detalhes: parseErrors.map((e) => ({ linha: e.linha, codigo: e.codigo, status: "erro" as const, motivo: e.motivo })),
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: existingVideos } = await supabase.from("videos").select("id, origem, titulo, views, likes, comments");
    const existingVideoMap = new Map<string, { id: string; titulo: string | null; views: number | null; likes: number | null; comments: number | null }>();
    for (const v of (existingVideos || [])) {
      if (v.origem) {
        const fid = extractDriveFileId(v.origem);
        existingVideoMap.set(fid, { id: v.id, titulo: v.titulo, views: v.views, likes: v.likes, comments: v.comments });
      }
    }
    const processedFileIds = new Set<string>();

    const results = {
      total_lidas: rows.length + parseErrors.length,
      importados: 0,
      atualizados: 0,
      ignorados: 0,
      erros: parseErrors.length,
      detalhes: parseErrors.map((e) => ({
        linha: e.linha,
        codigo: e.codigo,
        status: "erro" as const,
        motivo: e.motivo,
      })) as Array<{
        linha: number;
        codigo: string | null;
        status: "erro" | "ignorado" | "atualizado" | "importado";
        motivo: string;
      }>,
    };

    const PLATFORM_DELAYS: Record<string, number> = {
      youtube: 1500,
      instagram: 4000,
      tiktok: 3000,
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const lineNum = i + 2;
      const label = row.codigo_planilha ? `Linha ${lineNum} / ${row.codigo_planilha}` : `Linha ${lineNum}`;

      const rowFileId = extractDriveFileId(row.link_drive_video);

      // Prevent duplicate processing within same import
      if (processedFileIds.has(rowFileId)) {
        results.ignorados++;
        results.detalhes.push({ linha: lineNum, codigo: row.codigo_planilha, status: "ignorado", motivo: "Linha duplicada nesta importação" });
        continue;
      }
      processedFileIds.add(rowFileId);

      const existingVideo = existingVideoMap.get(rowFileId);

      // ── Manual fields from spreadsheet (highest priority) ──
      const manualTitulo = row.titulo;
      const manualViews = row.views;
      const manualLikes = row.likes;
      const manualComments = row.comments;

      const hasManualTitulo = manualTitulo !== null;
      const hasManualViews = manualViews !== null;
      const hasManualLikes = manualLikes !== null;
      const hasManualComments = manualComments !== null;
      const allManual = hasManualTitulo && hasManualViews && hasManualLikes && hasManualComments;

      // Track which fields still need filling
      let finalTitulo: string | null = manualTitulo;
      let finalViews: number | null = manualViews;
      let finalLikes: number | null = manualLikes;
      let finalComments: number | null = manualComments;

      let engagementSource = allManual ? "planilha" : "nenhum";
      let engagementStatus = allManual ? "planilha_completa" : "planilha_parcial";
      let engagementError: string | undefined;
      const manualFields: string[] = [];
      if (hasManualTitulo) manualFields.push("titulo");
      if (hasManualViews) manualFields.push("views");
      if (hasManualLikes) manualFields.push("likes");
      if (hasManualComments) manualFields.push("comments");

      // Strategy 1: Image fills gaps (only fields NOT set manually)
      if (!allManual && row.link_imagem_engajamento) {
        console.log(`${label} — Extraindo engajamento da IMAGEM (gaps: ${["titulo","views","likes","comments"].filter(f => !(manualFields.includes(f))).join(", ")})`);
        const imgResult = await processEngagementImage(row.link_imagem_engajamento);
        console.log(`${label} — Imagem resultado: ${imgResult.status} | Encontrados: [${imgResult.fields_found.join(", ")}]`);

        if (!hasManualTitulo && imgResult.titulo) finalTitulo = imgResult.titulo;
        if (!hasManualViews && imgResult.views !== undefined) finalViews = imgResult.views;
        if (!hasManualLikes && imgResult.likes !== undefined) finalLikes = imgResult.likes;
        if (!hasManualComments && imgResult.comments !== undefined) finalComments = imgResult.comments;

        engagementSource = manualFields.length > 0 ? "planilha+imagem" : "imagem";
        if (imgResult.error) engagementError = imgResult.error;
      }

      // Strategy 2: Scrape fills remaining gaps
      const needsMore = finalTitulo === null || finalViews === null || finalLikes === null || finalComments === null;
      if (needsMore && row.link_plataforma) {
        const platform = detectPlatform(row.link_plataforma);
        const delayMs = platform ? (PLATFORM_DELAYS[platform] || 1500) : 1500;
        if (i > 0 || row.link_imagem_engajamento) {
          console.log(`${label} — Fallback scrape: ${platform || "desconhecida"} — delay ${delayMs}ms`);
          await new Promise(r => setTimeout(r, delayMs));
        }
        const scrape = await scrapePublicData(row.link_plataforma);
        if (scrape.fields_found.length > 0) {
          if (finalTitulo === null && scrape.titulo) finalTitulo = scrape.titulo;
          if (finalViews === null && scrape.views !== undefined) finalViews = scrape.views;
          if (finalLikes === null && scrape.likes !== undefined) finalLikes = scrape.likes;
          if (finalComments === null && scrape.comments !== undefined) finalComments = scrape.comments;
          engagementSource = engagementSource === "nenhum" ? "scrape" : engagementSource + "+scrape";
        }
        if (scrape.error && !engagementError) engagementError = scrape.error;
      }

      // Calculate final field status
      const ALL_FIELDS = ["titulo", "views", "likes", "comments"] as const;
      const finalValues: Record<string, any> = { titulo: finalTitulo, views: finalViews, likes: finalLikes, comments: finalComments };
      const fields_found = ALL_FIELDS.filter(f => finalValues[f] !== null && finalValues[f] !== undefined);
      const fields_missing = ALL_FIELDS.filter(f => finalValues[f] === null || finalValues[f] === undefined);

      if (fields_found.length === 4) engagementStatus = "completo";
      else if (fields_found.length > 0) engagementStatus = "parcial";
      else engagementStatus = "ausente";

      // ── UPSERT LOGIC ──
      let videoId: string;

      if (existingVideo) {
        // ── UPDATE: fill only missing fields in DB ──
        const updateFields: Record<string, any> = {};
        const updatedFieldNames: string[] = [];

        if (!existingVideo.titulo && finalTitulo) { updateFields.titulo = finalTitulo; updatedFieldNames.push("titulo"); }
        if ((existingVideo.views === null || existingVideo.views === 0) && finalViews !== null) { updateFields.views = finalViews; updatedFieldNames.push("views"); }
        if ((existingVideo.likes === null || existingVideo.likes === 0) && finalLikes !== null) { updateFields.likes = finalLikes; updatedFieldNames.push("likes"); }
        if ((existingVideo.comments === null || existingVideo.comments === 0) && finalComments !== null) { updateFields.comments = finalComments; updatedFieldNames.push("comments"); }

        // Also update link_plataforma / link_imagem_engajamento if missing
        // (checked via metadata later)

        if (updatedFieldNames.length === 0) {
          results.ignorados++;
          results.detalhes.push({ linha: lineNum, codigo: row.codigo_planilha, status: "ignorado", motivo: "Vídeo já existe e não há campos novos para atualizar" });
          continue;
        }

        const { error: updateError } = await supabase
          .from("videos")
          .update(updateFields)
          .eq("id", existingVideo.id);

        if (updateError) {
          results.erros++;
          results.detalhes.push({ linha: lineNum, codigo: row.codigo_planilha, status: "erro", motivo: `Erro ao atualizar: ${updateError.message}` });
          continue;
        }

        videoId = existingVideo.id;

        // Save update metadata
        const metaEntries: Array<{ video_id: string; chave: string; valor: string }> = [
          { video_id: videoId, chave: "reimport_updated_fields", valor: updatedFieldNames.join(",") },
          { video_id: videoId, chave: "reimport_date", valor: new Date().toISOString() },
          { video_id: videoId, chave: "reimport_source", valor: engagementSource },
        ];
        if (row.link_plataforma) metaEntries.push({ video_id: videoId, chave: "link_plataforma", valor: row.link_plataforma });
        if (row.link_imagem_engajamento) metaEntries.push({ video_id: videoId, chave: "link_imagem_engajamento", valor: row.link_imagem_engajamento });
        await supabase.from("video_metadata").insert(metaEntries);

        await supabase.from("video_logs").insert({
          video_id: videoId,
          etapa: "reimport",
          status: "success",
          mensagem: `Campos atualizados: [${updatedFieldNames.join(", ")}] via ${engagementSource}`,
        });

        results.atualizados++;
        results.detalhes.push({
          linha: lineNum,
          codigo: row.codigo_planilha,
          status: "atualizado",
          motivo: `Campos preenchidos: [${updatedFieldNames.join(", ")}]`,
        });
      } else {
        // ── INSERT: new video ──
        const { data: video, error: insertError } = await supabase
          .from("videos")
          .insert({
            titulo: finalTitulo || null,
            origem: row.link_drive_video,
            tipo_entrada: "planilha",
            status: "pending" as const,
            views: finalViews,
            likes: finalLikes,
            comments: finalComments,
          })
          .select("id")
          .single();

        if (insertError) {
          results.erros++;
          results.detalhes.push({ linha: lineNum, codigo: row.codigo_planilha, status: "erro", motivo: insertError.message });
          continue;
        }

        videoId = video.id;

        // ── Save metadata ──
        const metadataEntries: Array<{ video_id: string; chave: string; valor: string }> = [];
        if (row.codigo_planilha) metadataEntries.push({ video_id: videoId, chave: "codigo_planilha", valor: row.codigo_planilha });
        if (row.link_plataforma) metadataEntries.push({ video_id: videoId, chave: "link_plataforma", valor: row.link_plataforma });
        if (row.link_imagem_engajamento) metadataEntries.push({ video_id: videoId, chave: "link_imagem_engajamento", valor: row.link_imagem_engajamento });
        metadataEntries.push({ video_id: videoId, chave: "engagement_source", valor: engagementSource });
        metadataEntries.push({ video_id: videoId, chave: "scrape_status", valor: engagementStatus });
        metadataEntries.push({ video_id: videoId, chave: "scrape_fields_found", valor: fields_found.join(",") || "nenhum" });
        metadataEntries.push({ video_id: videoId, chave: "scrape_fields_missing", valor: fields_missing.join(",") || "nenhum" });
        metadataEntries.push({ video_id: videoId, chave: "scrape_error", valor: engagementError || "nenhum" });
        if (manualFields.length > 0) metadataEntries.push({ video_id: videoId, chave: "manual_fields", valor: manualFields.join(",") });
        await supabase.from("video_metadata").insert(metadataEntries);

        // ── Log ──
        const logStatus = engagementStatus === "completo" ? "success" : "warning";
        const logMsg = `Fonte: ${engagementSource} | ${engagementStatus} | Encontrados: [${fields_found.join(", ")}]${manualFields.length > 0 ? ` | Manuais: [${manualFields.join(", ")}]` : ""}${engagementError ? ` | ${engagementError}` : ""}`;
        await supabase.from("video_logs").insert({ video_id: videoId, etapa: "engajamento", status: logStatus, mensagem: logMsg });

        await supabase.from("processing_queue").insert({ video_id: videoId, status: "pending" as const, priority: 0 });
        await supabase.from("video_languages").insert({ video_id: videoId, language_code: "pt", is_original: true });

        results.importados++;

        let motivo: string;
        if (engagementStatus === "completo") motivo = `Engajamento completo via ${engagementSource}`;
        else if (engagementStatus === "parcial") motivo = `Engajamento parcial (${engagementSource}): [${fields_found.join(", ")}]`;
        else motivo = `Engajamento ausente${engagementError ? `: ${engagementError}` : ""}`;

        results.detalhes.push({ linha: lineNum, codigo: row.codigo_planilha, status: "importado", motivo });
      }
    }

    results.detalhes.sort((a, b) => a.linha - b.linha);

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Import error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
