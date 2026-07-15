export const LEGACY_REFERENCE_SOURCE_BUCKET = "videos";
export const PRIVATE_REFERENCE_DESTINATION_BUCKET = "reference-videos";
export const LEGACY_REFERENCE_MAX_BATCH_SIZE = 50;

const SAFE_VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mov",
  "webm",
  "avi",
  "mpeg",
  "mpg",
  "m4v",
  "3gp",
]);

function safeUuid(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new Error(`${label} inválido.`);
  }
  return normalized;
}

export function normalizeLegacyReferencePath(value: unknown): string {
  const normalized = String(value ?? "").trim().replace(/^\/+/, "");
  if (!normalized || normalized.length > 1024 || normalized.includes("\\") || normalized.includes("\0")) {
    throw new Error("Caminho de Storage legado inválido.");
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Caminho de Storage legado inválido.");
  }
  return normalized;
}

export function legacyReferenceExtension(storagePath: string, fileName?: string | null): string {
  for (const candidate of [storagePath, fileName ?? ""]) {
    const extension = String(candidate).split(/[?#]/, 1)[0].split(".").pop()?.toLowerCase();
    if (extension && SAFE_VIDEO_EXTENSIONS.has(extension)) return extension;
  }
  return "mp4";
}

export function legacyReferenceDestinationPath(options: {
  referenceVideoId: string;
  ownerUserId?: string | null;
  sourcePath: string;
  fileName?: string | null;
}): string {
  const referenceVideoId = safeUuid(options.referenceVideoId, "referenceVideoId");
  const ownerSegment = options.ownerUserId
    ? safeUuid(options.ownerUserId, "ownerUserId")
    : "unowned";
  const extension = legacyReferenceExtension(
    normalizeLegacyReferencePath(options.sourcePath),
    options.fileName,
  );
  return `reference/${ownerSegment}/legacy/${referenceVideoId}.${extension}`;
}

export function storageObjectSize(info: unknown): number | null {
  if (!info || typeof info !== "object") return null;
  const record = info as Record<string, unknown>;
  const metadata = record.metadata && typeof record.metadata === "object"
    ? record.metadata as Record<string, unknown>
    : {};
  for (const value of [record.size, metadata.size, metadata.contentLength, metadata.content_length]) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

export function verifyLegacyReferenceCopy(options: {
  sourceInfo?: unknown;
  destinationInfo: unknown;
  previouslyVerifiedSourceSize?: number | null;
}): { sourceSize: number; destinationSize: number; verifiedBy: "exact_size" } {
  const sourceSize = storageObjectSize(options.sourceInfo)
    ?? (Number.isSafeInteger(options.previouslyVerifiedSourceSize)
      && Number(options.previouslyVerifiedSourceSize) > 0
      ? Number(options.previouslyVerifiedSourceSize)
      : null);
  const destinationSize = storageObjectSize(options.destinationInfo);
  if (!sourceSize || !destinationSize || sourceSize !== destinationSize) {
    throw new Error("A cópia privada não passou na verificação de tamanho exato.");
  }
  return { sourceSize, destinationSize, verifiedBy: "exact_size" };
}

/**
 * The old authenticated upload policy only allowed generation references under
 * reference/<own-user-id>/... . That namespace is therefore safe to clean once
 * no database row still points at the source object.
 */
export function isExclusiveLegacyReferencePath(
  sourcePath: string,
  ownerUserId?: string | null,
): boolean {
  const segments = normalizeLegacyReferencePath(sourcePath).split("/");
  if (segments[0] !== "reference" || segments.length < 3) return false;
  if (!ownerUserId) return true;
  return segments[1]?.toLowerCase() === String(ownerUserId).trim().toLowerCase();
}

export function legacySourceRemovalDecision(options: {
  sourcePath: string;
  ownerUserId?: string | null;
  remainingLegacyReferences: number;
  libraryReferences: number;
  forceUnscopedDelete?: boolean;
}): { remove: boolean; reason: string } {
  if (options.remainingLegacyReferences > 0) {
    return { remove: false, reason: "shared_by_other_legacy_reference_rows" };
  }
  if (options.libraryReferences > 0) {
    return { remove: false, reason: "referenced_by_viral_library" };
  }
  if (
    !isExclusiveLegacyReferencePath(options.sourcePath, options.ownerUserId)
    && options.forceUnscopedDelete !== true
  ) {
    return { remove: false, reason: "unscoped_source_requires_explicit_admin_review" };
  }
  return {
    remove: true,
    reason: options.forceUnscopedDelete === true
      ? "explicit_admin_cleanup_after_reference_checks"
      : "exclusive_legacy_reference_namespace",
  };
}

export function clampLegacyMigrationBatchLimit(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return 10;
  return Math.max(1, Math.min(LEGACY_REFERENCE_MAX_BATCH_SIZE, parsed));
}
