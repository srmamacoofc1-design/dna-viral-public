import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TABLES = ["videos", "video_transcripts", "video_blocks", "processing_queue", "video_logs"];

function toCsv(data: any[]): string {
  if (!data.length) return "";
  const headers = Object.keys(data[0]);
  const rows = [headers.join(",")];
  for (const row of data) {
    const values = headers.map(h => {
      const val = row[h];
      if (val === null || val === undefined) return "";
      const str = typeof val === "object" ? JSON.stringify(val) : String(val);
      return str.includes(",") || str.includes('"') || str.includes("\n")
        ? `"${str.replace(/"/g, '""')}"` : str;
    });
    rows.push(values.join(","));
  }
  return rows.join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    let segmento: string | null = null;
    let format = "json";
    let table: string | null = null;

    // Support both GET (query params) and POST (body)
    if (req.method === "POST") {
      const body = await req.json();
      segmento = body.segmento || null;
      format = body.format || "json";
      table = body.table || null;
    } else {
      const url = new URL(req.url);
      segmento = url.searchParams.get("segmento");
      format = url.searchParams.get("format") || "json";
      table = url.searchParams.get("table");
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    async function getVideoIds(): Promise<string[]> {
      if (!segmento) return [];
      const { data } = await supabase.from("videos").select("id").eq("segmento", segmento);
      return (data || []).map((v: any) => v.id);
    }

    async function fetchTable(t: string) {
      let query = supabase.from(t).select("*");
      if (segmento) {
        if (t === "videos") {
          query = query.eq("segmento", segmento);
        } else {
          const ids = await getVideoIds();
          if (ids.length === 0) return [];
          query = query.in("video_id", ids);
        }
      }
      const { data, error } = await query;
      if (error) throw new Error(`Query ${t}: ${error.message}`);
      return data || [];
    }

    // Single table CSV
    if (format === "csv" && table) {
      if (!TABLES.includes(table)) {
        return new Response(JSON.stringify({ error: `Invalid table: ${table}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const data = await fetchTable(table);
      const today = new Date().toISOString().split("T")[0];
      return new Response(toCsv(data), {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="${table}_backup_${today}.csv"`,
        },
      });
    }

    // Full JSON backup
    const backup: Record<string, any> = {
      backup_date: new Date().toISOString(),
      version: "1.0",
    };
    for (const t of TABLES) {
      backup[t] = await fetchTable(t);
    }

    const today = new Date().toISOString().split("T")[0];
    const filename = segmento ? `backup_${segmento}_${today}.json` : `full_backup_${today}.json`;

    return new Response(JSON.stringify(backup, null, 2), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    console.error("backup-export error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
