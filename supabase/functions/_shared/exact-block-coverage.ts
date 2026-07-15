export type CanonicalTextBlock = {
  id: string;
  tipo_bloco?: unknown;
  texto?: unknown;
  tempo_inicio?: unknown;
  tempo_fim?: unknown;
};

export type NormalizedSemanticBlock = Record<string, unknown> & {
  block_id: string;
  block_type: unknown;
  block_text: unknown;
  timestamp_start: number;
  timestamp_end: number;
};

export class ExactBlockCoverageError extends Error {
  readonly missingIds: string[];
  readonly duplicateIds: string[];
  readonly unknownIds: string[];

  constructor(
    message: string,
    details: {
      missingIds?: string[];
      duplicateIds?: string[];
      unknownIds?: string[];
    } = {},
  ) {
    super(message);
    this.name = "ExactBlockCoverageError";
    this.missingIds = details.missingIds ?? [];
    this.duplicateIds = details.duplicateIds ?? [];
    this.unknownIds = details.unknownIds ?? [];
  }
}

/**
 * Accepts AI output only when it contains each canonical text block exactly once.
 * The returned array follows database order and replaces every identity/timing field
 * with its canonical database value, so model-provided IDs can never drift into FKs.
 */
export function normalizeExactBlockCoverage(
  canonicalBlocks: readonly CanonicalTextBlock[],
  aiBlocks: unknown,
): NormalizedSemanticBlock[] {
  if (canonicalBlocks.length === 0) {
    throw new ExactBlockCoverageError("Canonical block set is empty");
  }

  const canonicalById = new Map<string, CanonicalTextBlock>();
  for (const block of canonicalBlocks) {
    const id = typeof block.id === "string" ? block.id : "";
    if (!id || id.trim() !== id) {
      throw new ExactBlockCoverageError("Canonical block contains an invalid ID");
    }
    if (canonicalById.has(id)) {
      throw new ExactBlockCoverageError(`Canonical block ID is duplicated: ${id}`, {
        duplicateIds: [id],
      });
    }
    canonicalById.set(id, block);
  }

  if (!Array.isArray(aiBlocks)) {
    throw new ExactBlockCoverageError("AI output did not contain a blocks array", {
      missingIds: [...canonicalById.keys()],
    });
  }

  const aiById = new Map<string, Record<string, unknown>>();
  const duplicateIds = new Set<string>();
  const unknownIds = new Set<string>();

  for (const item of aiBlocks) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      unknownIds.add("<invalid-block-object>");
      continue;
    }

    const aiBlock = item as Record<string, unknown>;
    const id = typeof aiBlock.block_id === "string" ? aiBlock.block_id : "";
    if (!id || !canonicalById.has(id)) {
      unknownIds.add(id || "<missing-block-id>");
      continue;
    }
    if (aiById.has(id)) {
      duplicateIds.add(id);
      continue;
    }
    aiById.set(id, aiBlock);
  }

  const missingIds = [...canonicalById.keys()].filter((id) => !aiById.has(id));
  if (
    missingIds.length > 0 ||
    duplicateIds.size > 0 ||
    unknownIds.size > 0 ||
    aiBlocks.length !== canonicalBlocks.length
  ) {
    const details = {
      missingIds,
      duplicateIds: [...duplicateIds],
      unknownIds: [...unknownIds],
    };
    throw new ExactBlockCoverageError(
      `AI block coverage mismatch: expected ${canonicalBlocks.length} unique canonical blocks, received ${aiBlocks.length}; ` +
        `missing=${details.missingIds.join(",") || "none"}; ` +
        `duplicates=${details.duplicateIds.join(",") || "none"}; ` +
        `unknown=${details.unknownIds.join(",") || "none"}`,
      details,
    );
  }

  return canonicalBlocks.map((canonical) => {
    const aiBlock = aiById.get(canonical.id)!;
    return {
      ...aiBlock,
      block_id: canonical.id,
      block_type: canonical.tipo_bloco,
      block_text: canonical.texto,
      timestamp_start: Number(canonical.tempo_inicio),
      timestamp_end: Number(canonical.tempo_fim),
    };
  });
}

