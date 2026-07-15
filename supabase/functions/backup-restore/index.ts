import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Restore order respects foreign key dependencies
const RESTORE_ORDER = ["videos", "video_transcripts", "video_blocks", "processing_queue", "video_logs"];
const DELETE_ORDER = [...RESTORE_ORDER].reverse();

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const { backup, clear_existing = false } = await req.json();

    if (!backup || typeof backup !== "object") {
      return new Response(JSON.stringify({ error: "Invalid backup data" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const results: Record<string, { deleted: number; inserted: number; errors: string[] }> = {};

    // Step 1: Clear existing data if requested (reverse order for FK integrity)
    if (clear_existing) {
      for (const table of DELETE_ORDER) {
        if (!backup[table]) continue;
        const { error, count } = await supabase.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
        results[table] = { deleted: count || 0, inserted: 0, errors: [] };
        if (error) results[table].errors.push(`Delete error: ${error.message}`);
      }
    }

    // Step 2: Insert data in correct order
    for (const table of RESTORE_ORDER) {
      const rows = backup[table];
      if (!rows || !Array.isArray(rows) || rows.length === 0) continue;

      if (!results[table]) results[table] = { deleted: 0, inserted: 0, errors: [] };

      // Insert in batches of 100
      const batchSize = 100;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const { error } = await supabase.from(table).upsert(batch, { onConflict: "id" });
        if (error) {
          results[table].errors.push(`Batch ${i}-${i + batch.length}: ${error.message}`);
        } else {
          results[table].inserted += batch.length;
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      restored_at: new Date().toISOString(),
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("backup-restore error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
