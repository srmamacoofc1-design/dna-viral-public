import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";
import { geminiOpenAIChat, hasGeminiApiKeys } from "../_shared/gemini-rotation.ts";
import { imageBytesToBase64, readInlineImage } from "../_shared/inline-image.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_ATTEMPTS = 3;

// ── Convert Google Drive share link to direct image URL ──
function driveImageToDirectUrl(url: string): string {
  const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileIdMatch) return `https://drive.google.com/uc?export=view&id=${fileIdMatch[1]}`;
  const idParam = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParam) return `https://drive.google.com/uc?export=view&id=${idParam[1]}`;
  return url;
}

async function downloadImageAsBase64(url: string): Promise<{ base64: string; mimeType: string } | { error: string }> {
  try {
    const directUrl = driveImageToDirectUrl(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(directUrl, {
      signal: controller.signal, redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    clearTimeout(timeout);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const { bytes, mimeType } = await readInlineImage(res);
    return { base64: imageBytesToBase64(bytes), mimeType };
  } catch (err: any) {
    return { error: err.name === "AbortError" ? "Timeout (20s)" : (err.message || "Erro download") };
  }
}

async function extractEngagementFromImage(imageBase64: string, mimeType: string): Promise<{ titulo?: string; views?: number; likes?: number; comments?: number; error?: string }> {
  if (!hasGeminiApiKeys()) return { error: "GEMINI_API_KEY não configurada" };

  try {
    const response = await geminiOpenAIChat({
        model: "gemini-3.5-flash",
        messages: [
          {
            role: "system",
            content: `You analyze screenshots of social media video pages and extract engagement metrics. Extract: titulo, views, likes, comments. Convert abbreviated numbers (K=1000, M=1000000). Use null for fields not found. Portuguese: "visualizações"/"reproduções"=views, "curtidas"=likes, "comentários"=comments. Dots as thousands separators (1.234=1234).`,
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract titulo, views, likes, comments from this screenshot. Return JSON." },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            ],
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "extract_engagement",
            description: "Extract engagement metrics from screenshot",
            parameters: {
              type: "object",
              properties: {
                titulo: { type: "string" },
                views: { type: "number" },
                likes: { type: "number" },
                comments: { type: "number" },
              },
              required: [],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "extract_engagement" } },
    });

    if (!response.ok) {
      if (response.status === 429) return { error: "Rate limit AI" };
      if (response.status === 402) return { error: "Créditos AI insuficientes" };
      return { error: `AI erro HTTP ${response.status}` };
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      const parsed = JSON.parse(toolCall.function.arguments);
      return {
        titulo: parsed.titulo || undefined,
        views: typeof parsed.views === "number" ? parsed.views : undefined,
        likes: typeof parsed.likes === "number" ? parsed.likes : undefined,
        comments: typeof parsed.comments === "number" ? parsed.comments : undefined,
      };
    }
    return { error: "AI não retornou dados estruturados" };
  } catch (err: any) {
    return { error: err.message || "Erro AI vision" };
  }
}

async function upsertMeta(supabase: any, videoId: string, chave: string, valor: string) {
  const { data: existing } = await supabase
    .from("video_metadata").select("id").eq("video_id", videoId).eq("chave", chave).maybeSingle();
  if (existing) await supabase.from("video_metadata").update({ valor }).eq("id", existing.id);
  else await supabase.from("video_metadata").insert({ video_id: videoId, chave, valor });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: candidates } = await supabase
      .from("videos")
      .select("id, titulo, views, likes, comments")
      .is("views", null).is("likes", null).is("comments", null);

    if (!candidates || candidates.length === 0) {
      return new Response(
        JSON.stringify({ message: "Nenhum vídeo sem engajamento", total: 0, atualizados: 0, falhas: 0, ignorados: 0, detalhes: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[rescrape] ${candidates.length} vídeos sem engajamento`);
    const results = { total: candidates.length, atualizados: 0, falhas: 0, ignorados: 0, detalhes: [] as any[] };

    for (let i = 0; i < candidates.length; i++) {
      const video = candidates[i];

      const { data: attemptMeta } = await supabase
        .from("video_metadata").select("valor").eq("video_id", video.id).eq("chave", "scrape_attempt_count").maybeSingle();
      const attempts = parseInt(attemptMeta?.valor || "0");
      if (attempts >= MAX_ATTEMPTS) {
        results.ignorados++;
        results.detalhes.push({ id: video.id, status: "ignorado", motivo: `Já tentou ${attempts}x` });
        continue;
      }

      const { data: imgMeta } = await supabase
        .from("video_metadata").select("valor").eq("video_id", video.id).eq("chave", "link_imagem_engajamento").maybeSingle();

      const { data: linkMeta } = await supabase
        .from("video_metadata").select("valor").eq("video_id", video.id).eq("chave", "link_plataforma").maybeSingle();

      if (!imgMeta?.valor && !linkMeta?.valor) {
        results.ignorados++;
        results.detalhes.push({ id: video.id, status: "ignorado", motivo: "Sem imagem de engajamento e sem link_plataforma" });
        continue;
      }

      const newAttempts = attempts + 1;
      let extracted: { titulo?: string; views?: number; likes?: number; comments?: number; error?: string } = {};
      let source = "nenhum";

      if (imgMeta?.valor) {
        console.log(`[rescrape] Vídeo ${video.id} — tentativa ${newAttempts}/${MAX_ATTEMPTS} — IMAGEM`);

        if (i > 0) await new Promise(r => setTimeout(r, 2000));

        const download = await downloadImageAsBase64(imgMeta.valor);
        if ("error" in download) {
          console.warn(`[rescrape] Falha download imagem: ${download.error}`);
        } else {
          extracted = await extractEngagementFromImage(download.base64, download.mimeType);
          if (!extracted.error || extracted.titulo || extracted.views !== undefined) {
            source = "imagem";
          }
        }
      }

      await upsertMeta(supabase, video.id, "scrape_attempt_count", String(newAttempts));
      await upsertMeta(supabase, video.id, "last_scrape_attempt", new Date().toISOString());
      await upsertMeta(supabase, video.id, "engagement_source", source);

      const ALL = ["titulo", "views", "likes", "comments"] as const;
      const fields_found = ALL.filter(f => (extracted as any)[f] !== undefined && (extracted as any)[f] !== null);
      const fields_missing = ALL.filter(f => !(fields_found as string[]).includes(f));

      let status = "imagem_falhou";
      if (fields_found.length === 4) status = "imagem_sucesso";
      else if (fields_found.length > 0) status = "imagem_parcial";

      await upsertMeta(supabase, video.id, "scrape_status", status);
      await upsertMeta(supabase, video.id, "scrape_fields_found", fields_found.join(",") || "nenhum");
      await upsertMeta(supabase, video.id, "scrape_fields_missing", fields_missing.join(",") || "nenhum");
      await upsertMeta(supabase, video.id, "scrape_error", extracted.error || "nenhum");

      if (fields_found.length > 0) {
        const updateData: Record<string, any> = {};
        if (extracted.titulo && !video.titulo) updateData.titulo = extracted.titulo;
        if (extracted.views !== undefined) updateData.views = extracted.views;
        if (extracted.likes !== undefined) updateData.likes = extracted.likes;
        if (extracted.comments !== undefined) updateData.comments = extracted.comments;

        if (Object.keys(updateData).length > 0) {
          await supabase.from("videos").update(updateData).eq("id", video.id);
        }

        results.atualizados++;
        results.detalhes.push({ id: video.id, status: "atualizado", source, fields: [...fields_found], tentativa: newAttempts });
        console.log(`[rescrape] ${video.id} — ATUALIZADO via ${source} — [${fields_found}]`);
      } else {
        results.falhas++;
        results.detalhes.push({ id: video.id, status: "falhou", source, error: extracted.error, tentativa: newAttempts });
        console.log(`[rescrape] ${video.id} — FALHOU — ${extracted.error}`);
      }

      await supabase.from("video_logs").insert({
        video_id: video.id,
        etapa: "rescrape_engajamento",
        status: fields_found.length > 0 ? "success" : "warning",
        mensagem: `Tentativa ${newAttempts}/${MAX_ATTEMPTS} | ${status} | fonte: ${source} | ${extracted.error || "OK"} | [${fields_found}]`,
      });
    }

    console.log(`[rescrape] Concluído: ${results.atualizados} atualizados, ${results.falhas} falhas, ${results.ignorados} ignorados`);
    return new Response(JSON.stringify(results), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: any) {
    console.error("[rescrape] Erro:", error);
    return new Response(JSON.stringify({ error: error.message || "Erro interno" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
