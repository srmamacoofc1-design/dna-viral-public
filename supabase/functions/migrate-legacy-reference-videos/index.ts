import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import { requireLibraryAdminOrService } from "../_shared/edge-auth.ts";
import {
  clampLegacyMigrationBatchLimit,
  isExclusiveLegacyReferencePath,
  legacySourceRemovalDecision,
  LEGACY_REFERENCE_SOURCE_BUCKET,
  normalizeLegacyReferencePath,
  PRIVATE_REFERENCE_DESTINATION_BUCKET,
  verifyLegacyReferenceCopy,
} from "../_shared/legacy-reference-migration.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type MigrationJob = {
  id: string;
  reference_video_id: string;
  owner_user_id: string | null;
  source_bucket: string;
  source_path: string;
  destination_bucket: string;
  destination_path: string;
  status: string;
  source_size_bytes: number | null;
  destination_size_bytes: number | null;
};

type StorageInfo = Record<string, unknown>;

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  for (const value of [record.status, record.statusCode]) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Erro desconhecido");
}

async function getStorageInfo(
  supabase: ReturnType<typeof createClient>,
  bucket: string,
  storagePath: string,
): Promise<StorageInfo | null> {
  const { data, error } = await supabase.storage.from(bucket).info(storagePath);
  if (!error && data) return data as unknown as StorageInfo;
  if (errorStatus(error) === 404 || /not.?found/i.test(errorMessage(error))) return null;
  throw new Error(`Falha ao consultar ${bucket}/${storagePath}: ${errorMessage(error)}`);
}

async function updateJob(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  workerId: string,
  patch: Record<string, unknown>,
) {
  const { data, error } = await supabase
    .from("reference_video_storage_migrations")
    .update(patch)
    .eq("id", jobId)
    .eq("lease_owner", workerId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Falha ao registrar o estado da migração: ${error.message}`);
  if (!data) throw new Error("O lease da migração expirou antes da confirmação.");
}

async function ensurePrivateCopy(options: {
  supabase: ReturnType<typeof createClient>;
  job: MigrationJob;
}): Promise<{ sourceInfo: StorageInfo | null; sourceSize: number; destinationSize: number }> {
  const sourceInfo = await getStorageInfo(
    options.supabase,
    LEGACY_REFERENCE_SOURCE_BUCKET,
    options.job.source_path,
  );
  let destinationInfo = await getStorageInfo(
    options.supabase,
    PRIVATE_REFERENCE_DESTINATION_BUCKET,
    options.job.destination_path,
  );

  if (!destinationInfo) {
    if (!sourceInfo) throw new Error("O objeto legado não existe e nenhuma cópia privada foi encontrada.");
    const { error: copyError } = await options.supabase.storage
      .from(LEGACY_REFERENCE_SOURCE_BUCKET)
      .copy(options.job.source_path, options.job.destination_path, {
        destinationBucket: PRIVATE_REFERENCE_DESTINATION_BUCKET,
      });
    if (copyError) {
      // A resposta pode ter sido perdida depois de o Storage confirmar a cópia.
      destinationInfo = await getStorageInfo(
        options.supabase,
        PRIVATE_REFERENCE_DESTINATION_BUCKET,
        options.job.destination_path,
      );
      if (!destinationInfo) throw new Error(`A cópia server-side falhou: ${copyError.message}`);
    } else {
      destinationInfo = await getStorageInfo(
        options.supabase,
        PRIVATE_REFERENCE_DESTINATION_BUCKET,
        options.job.destination_path,
      );
    }
  }

  if (!destinationInfo) throw new Error("O destino privado não existe após a cópia.");
  const verified = verifyLegacyReferenceCopy({
    sourceInfo,
    destinationInfo,
    previouslyVerifiedSourceSize: options.job.source_size_bytes,
  });
  return {
    sourceInfo,
    sourceSize: verified.sourceSize,
    destinationSize: verified.destinationSize,
  };
}

async function pointReferenceAtPrivateCopy(options: {
  supabase: ReturnType<typeof createClient>;
  job: MigrationJob;
}) {
  const { data: current, error: currentError } = await options.supabase
    .from("reference_videos")
    .select("id,user_id,storage_bucket,storage_path")
    .eq("id", options.job.reference_video_id)
    .maybeSingle();
  if (currentError || !current) {
    throw new Error(currentError?.message || "A referência da migração não existe mais.");
  }
  if ((current.user_id ?? null) !== (options.job.owner_user_id ?? null)) {
    throw new Error("O proprietário da referência mudou; a migração exige revisão administrativa.");
  }

  if (
    current.storage_bucket === PRIVATE_REFERENCE_DESTINATION_BUCKET
    && current.storage_path === options.job.destination_path
  ) return;
  if (
    current.storage_bucket !== LEGACY_REFERENCE_SOURCE_BUCKET
    || current.storage_path !== options.job.source_path
  ) {
    throw new Error("A referência aponta para um objeto diferente do registrado no ledger.");
  }

  const { data: swapped, error: swapError } = await options.supabase
    .from("reference_videos")
    .update({
      storage_bucket: PRIVATE_REFERENCE_DESTINATION_BUCKET,
      storage_path: options.job.destination_path,
    })
    .eq("id", options.job.reference_video_id)
    .eq("storage_bucket", LEGACY_REFERENCE_SOURCE_BUCKET)
    .eq("storage_path", options.job.source_path)
    .select("id,storage_bucket,storage_path")
    .maybeSingle();
  if (swapError) throw new Error(`Falha ao trocar a referência para o bucket privado: ${swapError.message}`);
  if (swapped?.storage_bucket === PRIVATE_REFERENCE_DESTINATION_BUCKET
    && swapped?.storage_path === options.job.destination_path) return;

  // A resposta do UPDATE pode ter sido perdida. Reconcile before failing.
  const { data: reconciled } = await options.supabase
    .from("reference_videos")
    .select("storage_bucket,storage_path")
    .eq("id", options.job.reference_video_id)
    .maybeSingle();
  if (reconciled?.storage_bucket !== PRIVATE_REFERENCE_DESTINATION_BUCKET
    || reconciled?.storage_path !== options.job.destination_path) {
    throw new Error("A troca atômica da referência não foi confirmada.");
  }
}

async function countRemainingLegacyReferences(
  supabase: ReturnType<typeof createClient>,
  job: MigrationJob,
): Promise<number> {
  const { count, error } = await supabase
    .from("reference_videos")
    .select("id", { count: "exact", head: true })
    .eq("storage_bucket", LEGACY_REFERENCE_SOURCE_BUCKET)
    .eq("storage_path", job.source_path)
    .neq("id", job.reference_video_id);
  if (error) throw new Error(`Falha ao verificar referências compartilhadas: ${error.message}`);
  return count ?? 0;
}

async function countLibraryReferences(
  supabase: ReturnType<typeof createClient>,
  sourcePath: string,
): Promise<number> {
  const basename = sourcePath.split("/").pop() ?? "";
  const libraryVideoId = basename.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.[a-z0-9]+$/i,
  )?.[1] ?? null;

  const queries = [
    supabase.from("videos").select("id", { count: "exact", head: true }).eq("origem", sourcePath),
    supabase.from("video_metadata").select("id", { count: "exact", head: true })
      .eq("chave", "file_path").eq("valor", sourcePath),
    supabase.from("video_frames").select("id", { count: "exact", head: true }).eq("file_path", sourcePath),
    libraryVideoId
      ? supabase.from("videos").select("id", { count: "exact", head: true }).eq("id", libraryVideoId)
      : Promise.resolve({ count: 0, error: null }),
  ];
  const results = await Promise.all(queries);
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(`Falha ao proteger objetos da biblioteca viral: ${failed.error.message}`);
  return results.reduce((sum, result) => sum + (result.count ?? 0), 0);
}

async function removeSourceAndVerify(
  supabase: ReturnType<typeof createClient>,
  sourcePath: string,
) {
  const { error } = await supabase.storage.from(LEGACY_REFERENCE_SOURCE_BUCKET).remove([sourcePath]);
  if (error) throw new Error(`Falha ao remover a origem pública: ${error.message}`);
  const remaining = await getStorageInfo(supabase, LEGACY_REFERENCE_SOURCE_BUCKET, sourcePath);
  if (remaining) throw new Error("A origem pública ainda existe após a remoção.");
}

async function migrateOne(options: {
  supabase: ReturnType<typeof createClient>;
  job: MigrationJob;
  workerId: string;
  forceUnscopedDelete: boolean;
}) {
  const job: MigrationJob = {
    ...options.job,
    source_path: normalizeLegacyReferencePath(options.job.source_path),
    destination_path: normalizeLegacyReferencePath(options.job.destination_path),
  };
  if (job.source_bucket !== LEGACY_REFERENCE_SOURCE_BUCKET
    || job.destination_bucket !== PRIVATE_REFERENCE_DESTINATION_BUCKET
    || !job.destination_path.startsWith("reference/")) {
    throw new Error("O ledger contém buckets ou destino não permitidos.");
  }

  const copy = await ensurePrivateCopy({ supabase: options.supabase, job });
  await updateJob(options.supabase, job.id, options.workerId, {
    status: "copied_verified",
    verification_method: "exact_size",
    source_size_bytes: copy.sourceSize,
    destination_size_bytes: copy.destinationSize,
    last_error: null,
  });

  // This row swap is deliberately after destination verification and before
  // any attempt to remove public bytes.
  await pointReferenceAtPrivateCopy({ supabase: options.supabase, job });

  const sourceStillExists = copy.sourceInfo !== null
    || await getStorageInfo(options.supabase, LEGACY_REFERENCE_SOURCE_BUCKET, job.source_path) !== null;
  if (!sourceStillExists) {
    await updateJob(options.supabase, job.id, options.workerId, {
      status: "completed",
      source_removed: true,
      source_retained_reason: null,
      completed_at: new Date().toISOString(),
      lease_owner: null,
      lease_expires_at: null,
    });
    return { status: "completed", source_removed: true, reason: "source_already_absent" };
  }

  const [remainingLegacyReferences, libraryReferences] = await Promise.all([
    countRemainingLegacyReferences(options.supabase, job),
    countLibraryReferences(options.supabase, job.source_path),
  ]);
  const removal = legacySourceRemovalDecision({
    sourcePath: job.source_path,
    ownerUserId: job.owner_user_id,
    remainingLegacyReferences,
    libraryReferences,
    forceUnscopedDelete: options.forceUnscopedDelete,
  });

  if (removal.remove) {
    await removeSourceAndVerify(options.supabase, job.source_path);
    await updateJob(options.supabase, job.id, options.workerId, {
      status: "completed",
      source_removed: true,
      source_retained_reason: null,
      completed_at: new Date().toISOString(),
      lease_owner: null,
      lease_expires_at: null,
    });
    return { status: "completed", source_removed: true, reason: removal.reason };
  }

  await updateJob(options.supabase, job.id, options.workerId, {
    status: "source_retained",
    source_removed: false,
    source_retained_reason: removal.reason,
    completed_at: new Date().toISOString(),
    lease_owner: null,
    lease_expires_at: null,
  });
  return {
    status: "source_retained",
    source_removed: false,
    reason: removal.reason,
    scoped_reference_path: isExclusiveLegacyReferencePath(job.source_path, job.owner_user_id),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Método não permitido." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) return json(503, { error: "Supabase não configurado." });

  try {
    await requireLibraryAdminOrService({ req, supabaseUrl, serviceRoleKey });
    const body = await req.json().catch(() => ({}));
    const limit = clampLegacyMigrationBatchLimit(body?.limit);
    const dryRun = body?.dry_run === true;
    const includeSourceRetained = body?.include_source_retained === true;
    const forceUnscopedDelete = body?.force_unscoped_delete === true;
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    if (dryRun) {
      const statuses = includeSourceRetained
        ? ["pending", "failed", "copied_verified", "copying", "source_retained"]
        : ["pending", "failed", "copied_verified", "copying"];
      const { data, error } = await supabase
        .from("reference_video_storage_migrations")
        .select("reference_video_id,owner_user_id,source_path,destination_path,status,attempt_count,last_error,source_retained_reason")
        .in("status", statuses)
        .order("created_at")
        .limit(limit);
      if (error) throw error;
      return json(200, { dry_run: true, count: data?.length ?? 0, jobs: data ?? [] });
    }

    const workerId = crypto.randomUUID();
    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_reference_video_storage_migrations",
      {
        _worker_id: workerId,
        _limit: limit,
        _lease_seconds: 1800,
        _include_source_retained: includeSourceRetained,
      },
    );
    if (claimError) throw new Error(`Falha ao reservar jobs de migração: ${claimError.message}`);

    const outcomes: Array<Record<string, unknown>> = [];
    for (const rawJob of (claimed ?? []) as MigrationJob[]) {
      try {
        const result = await migrateOne({
          supabase,
          job: rawJob,
          workerId,
          forceUnscopedDelete,
        });
        outcomes.push({ reference_video_id: rawJob.reference_video_id, ...result });
      } catch (error) {
        const message = errorMessage(error).slice(0, 2000);
        try {
          await updateJob(supabase, rawJob.id, workerId, {
            status: "failed",
            last_error: message,
            lease_owner: null,
            lease_expires_at: null,
          });
        } catch (ledgerError) {
          console.error("legacy reference ledger update failed", ledgerError);
        }
        outcomes.push({ reference_video_id: rawJob.reference_video_id, status: "failed", error: message });
      }
    }

    const summary = outcomes.reduce(
      (acc, outcome) => {
        const status = String(outcome.status || "failed");
        if (status === "completed") acc.completed += 1;
        else if (status === "source_retained") acc.source_retained += 1;
        else acc.failed += 1;
        return acc;
      },
      { claimed: outcomes.length, completed: 0, source_retained: 0, failed: 0 },
    );
    return json(summary.failed > 0 ? 207 : 200, {
      success: summary.failed === 0,
      worker_id: workerId,
      summary,
      outcomes,
      note: "source_retained significa que a cópia privada está ativa, mas a origem pública foi preservada por ser compartilhada ou exigir revisão explícita.",
    });
  } catch (error) {
    const record = error as { status?: number; code?: string; retryable?: boolean };
    const status = Number(record?.status) || 500;
    return json(status, {
      error: errorMessage(error),
      error_code: record?.code ?? "LEGACY_REFERENCE_MIGRATION_FAILED",
      retryable: record?.retryable === true || status >= 500,
    });
  }
});
