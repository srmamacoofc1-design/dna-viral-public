/** Mechanically combines the three independently reviewed audit fragments. */
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { EXPECTED_CODEX_MANUAL_AUDIT_IDS } from "./lib/codex-manual-audit.ts";

type RawManifest = {
  schema_version: number;
  generated_at: string;
  evidence_policy: string;
  videos: Array<Record<string, unknown> & { youtube_id: string }>;
  validation: { valid: boolean; errors: unknown[]; counts: Record<string, unknown> };
};

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, ".runtime", "four-video-local-analysis", "codex-audit-manifest.json");
const inputs = [
  path.join(root, ".runtime", "four-video-local-analysis", "codex-audit-main5-fragment.json"),
  path.join(root, ".runtime", "overflow-audit-a", "codex-audit-fragment.json"),
  path.join(root, ".runtime", "overflow-audit-b", "codex-audit-fragment.json"),
];
const expectedByInput = [
  EXPECTED_CODEX_MANUAL_AUDIT_IDS.slice(0, 5),
  EXPECTED_CODEX_MANUAL_AUDIT_IDS.slice(5, 10),
  EXPECTED_CODEX_MANUAL_AUDIT_IDS.slice(10),
] as const;

const manifests = await Promise.all(inputs.map(async (input) =>
  JSON.parse(await readFile(input, "utf8")) as RawManifest
));
for (const [index, manifest] of manifests.entries()) {
  if (manifest.schema_version !== 1 || manifest.validation?.valid !== true ||
      !Array.isArray(manifest.validation.errors) || manifest.validation.errors.length) {
    throw new Error(`source manifest ${inputs[index]} is not valid`);
  }
  const allowed = expectedByInput[index];
  const authoritativeRows = manifest.videos.filter((video) =>
    allowed.includes(video.youtube_id as never)
  );
  const ids = authoritativeRows.map((video) => video.youtube_id);
  const missing = allowed.filter((id) => !ids.includes(id));
  const duplicate = ids.length !== new Set(ids).size;
  // Every reviewed fragment is immutable and disjoint. The merged output is
  // never accepted as an input, so an old review cannot silently leak back in.
  const unexpected = manifest.videos.filter((video) =>
    !allowed.includes(video.youtube_id as never)
  );
  if (missing.length || duplicate || authoritativeRows.length !== allowed.length || unexpected.length) {
    throw new Error(`source inventory ${inputs[index]} is not its exact disjoint partition`);
  }
}

const byId = new Map<string, RawManifest["videos"][number]>();
const counts: Record<string, unknown> = {};
for (const [manifestIndex, manifest] of manifests.entries()) {
  const allowed = expectedByInput[manifestIndex];
  for (const video of manifest.videos.filter((row) => allowed.includes(row.youtube_id as never))) {
    if (byId.has(video.youtube_id)) throw new Error(`partitions overlap at ${video.youtube_id}`);
    byId.set(video.youtube_id, video);
  }
  for (const id of allowed) counts[id] = manifest.validation.counts?.[id];
}
const actual = [...byId.keys()];
const missing = EXPECTED_CODEX_MANUAL_AUDIT_IDS.filter((id) => !byId.has(id));
const unexpected = actual.filter((id) =>
  !EXPECTED_CODEX_MANUAL_AUDIT_IDS.includes(id as typeof EXPECTED_CODEX_MANUAL_AUDIT_IDS[number])
);
if (missing.length || unexpected.length || byId.size !== EXPECTED_CODEX_MANUAL_AUDIT_IDS.length) {
  throw new Error(`inventory mismatch; missing=${missing.join(",")}; unexpected=${unexpected.join(",")}`);
}

const merged = {
  schema_version: 1,
  generated_at: manifests.map((manifest) => manifest.generated_at).sort().at(-1),
  evidence_policy: `Exactly ${EXPECTED_CODEX_MANUAL_AUDIT_IDS.length} disjoint videos are included in this independent local Codex audit. Visual descriptions, actions and objects contain only conservative pixel-visible facts from reviewed local MP4 frames. Narration-only identity, causality, intention and mental-state claims remain explicitly separated from visual facts. Every selected source is pinned by a recomputed media SHA-256 and timestamped frame evidence.`,
  videos: EXPECTED_CODEX_MANUAL_AUDIT_IDS.map((id) => byId.get(id)),
  validation: { valid: true, errors: [], counts },
};
const temporary = `${output}.tmp-${process.pid}`;
try {
  await writeFile(temporary, `${JSON.stringify(merged, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporary, output);
} catch (error) {
  await rm(temporary, { force: true });
  throw error;
}
console.log(`Merged ${merged.videos.length} exact manual audits into ${output}`);
