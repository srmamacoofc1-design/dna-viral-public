/**
 * Teste ao vivo do Pacote de Estilo DNA + Presets DNA.
 *
 * Fluxo provado contra o backend real:
 *  1. Cria um Preset DNA com os 5 vídeos de MAIOR engajamento da base
 *     (consolida ganchos campeões + ritmo + palavras ponderadas e salva
 *     em dataset_cohort, igual ao botão "Criar Preset DNA" da Biblioteca)
 *  2. Gera um roteiro de tema usando o DNA desse preset + Gancho Apelão
 *  3. Imprime os blocos e apaga o preset de teste
 *
 * Rodar: npx vite-node scripts/test-style-pack-live.ts
 * (consome ~8 chamadas de gemini-flash no gateway do projeto)
 */

// Node não tem localStorage — polyfill antes de importar o client
if (typeof globalThis.localStorage === "undefined") {
  const localStoragePolyfill: Storage = {
    length: 0,
    clear: () => undefined,
    getItem: () => null,
    key: () => null,
    removeItem: () => undefined,
    setItem: () => undefined,
  };
  Object.defineProperty(globalThis, "localStorage", { value: localStoragePolyfill });
}

function requiredEnv(name: "VITE_SUPABASE_URL" | "VITE_SUPABASE_PUBLISHABLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

const SUPABASE_URL = requiredEnv("VITE_SUPABASE_URL");
const ANON_KEY = requiredEnv("VITE_SUPABASE_PUBLISHABLE_KEY");

interface InvokeResponse {
  [key: string]: unknown;
}

interface GenerationContextResponse extends InvokeResponse {
  generation_context_id?: string;
}

interface ScriptBlockResponse {
  index?: number;
  slot_type?: string;
  word_count?: number;
  generated_text?: string;
  status?: string;
}

interface AssemblyResponse extends InvokeResponse {
  script_assembly_id?: string;
  script_blocks?: ScriptBlockResponse[];
}

function isInvokeResponse(value: unknown): value is InvokeResponse {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function invoke<T extends InvokeResponse>(fn: string, body: unknown): Promise<T> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data: unknown = await resp.json();
  if (!resp.ok) throw new Error(`${fn} HTTP ${resp.status}: ${JSON.stringify(data).slice(0, 300)}`);
  if (!isInvokeResponse(data)) throw new Error(`${fn} retornou uma resposta inválida`);
  return data as T;
}

const THEME = "os bastidores absurdos de como filmes famosos quase deram errado";

const { supabase } = await import("../src/integrations/supabase/client");
const { buildStylePackNotes } = await import("../src/lib/dna-style-pack");
const { createDnaPreset, deleteDnaPreset, listDnaPresets } = await import("../src/lib/dna-presets");

console.log("1/5 Buscando os 5 vídeos de maior engajamento da base...");
const { data: vids } = await supabase
  .from("videos")
  .select("id, titulo, views, likes, comments")
  .eq("status", "completed")
  .gt("views", 0);
const ranked = (vids || [])
  .map(v => ({ ...v, eng: ((Number(v.likes) || 0) + (Number(v.comments) || 0)) / (Number(v.views) || 1) }))
  .sort((a, b) => b.eng - a.eng)
  .slice(0, 5);
console.log(ranked.map(v => `    ${(v.eng * 100).toFixed(1)}% — ${v.titulo}`).join("\n"));

console.log("\n2/5 Criando Preset DNA 'TESTE Top Engajamento' com esses 5 vídeos...");
const preset = await createDnaPreset("TESTE Top Engajamento", ranked.map(v => v.id));
console.log(`    Preset ${preset.id} salvo · confiança ${preset.confidence_score}% · ${preset.style_pack?.block_styles.length} tipos de bloco consolidados`);
for (const bs of preset.style_pack?.block_styles || []) {
  console.log(`    [${bs.block_type}] ${bs.examples.length} ganchos-modelo · ${bs.weighted_words.slice(0, 5).join(", ")}`);
}

console.log("\n3/5 Gerando roteiro com o DNA do preset + GANCHO APELÃO...");
const notes = buildStylePackNotes(preset.style_pack!, { hookApelao: true, presetName: preset.name });
const ctx = await invoke<GenerationContextResponse>("build-complete-generation-context", {
  mode: "theme",
  theme: THEME,
  language: "pt",
  notes,
});
if (!ctx.generation_context_id) throw new Error("Sem generation_context_id: " + JSON.stringify(ctx).slice(0, 300));

const asm = await invoke<AssemblyResponse>("assemble-script", { generation_context_id: ctx.generation_context_id });

console.log("\n───────────── ROTEIRO COM PRESET + GANCHO APELÃO ─────────────");
for (const b of asm.script_blocks || []) {
  console.log(`\n[${b.index}] ${String(b.slot_type).toUpperCase()} (${b.word_count} palavras)`);
  console.log(`    ${b.generated_text || `(${b.status})`}`);
}

console.log("\n4/5 Conferindo persistência do preset (listDnaPresets)...");
const all = await listDnaPresets();
console.log(`    ${all.length} preset(s) no banco: ${all.map(p => p.name).join(" | ")}`);

console.log("\n5/5 Apagando o preset de TESTE...");
await deleteDnaPreset(preset.id);
console.log("    Apagado. (Os presets criados pelo app ficam salvos — este era só do teste.)");
console.log(`\nIDs: ctx=${ctx.generation_context_id} asm=${asm.script_assembly_id}`);
