/**
 * Importa a amostra pública do Benji Curioso já baixada com yt-dlp,
 * persiste transcrição + frames estruturais reais, executa a análise narrativa
 * e cria um Preset DNA cross-language (estratégia ES -> roteiro PT).
 *
 * Uso:
 *   $env:BENJI_ROOT='C:\\caminho\\work\\benji'
 *   $env:BENJI_DETERMINISTIC='1' # dispensa os extratores dependentes de IA
 *   npx vite-node scripts/import-benji-preset-live.ts
 */

(globalThis as any).localStorage = (globalThis as any).localStorage ?? {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SOURCES = [
  { id: "vjqsNKq05iE", url: "https://www.youtube.com/shorts/vjqsNKq05iE" },
  { id: "adcOHqnTEZY", url: "https://www.youtube.com/shorts/adcOHqnTEZY" },
  { id: "FaZGE4SyeUc", url: "https://www.youtube.com/shorts/FaZGE4SyeUc" },
  { id: "ybTdVLMyxTA", url: "https://www.youtube.com/shorts/ybTdVLMyxTA" },
  { id: "NB3n-OFF7Nw", url: "https://www.youtube.com/shorts/NB3n-OFF7Nw" },
  { id: "9ZNzEeIZGOo", url: "https://www.youtube.com/shorts/9ZNzEeIZGOo" },
  { id: "sQdSlqAflKg", url: "https://www.youtube.com/shorts/sQdSlqAflKg" },
] as const;

type VisualEvidence = {
  at: number;
  action: string;
  description: string;
  emotion: string;
  intensity: number;
  objects: string[];
};

type TranscriptSegment = { start: number; end: number; text: string };
type DnaBlockType = "hook" | "setup" | "desenvolvimento" | "tensao" | "revelacao" | "payoff";
type DnaEmotion = "curiosidade" | "surpresa" | "medo" | "tensao" | "alivio" | "expectativa" | "impacto";

const SPANISH_STOPWORDS = new Set([
  "a", "al", "algo", "ante", "asi", "aun", "aunque", "cada", "como", "con", "contra", "cual",
  "cuando", "de", "del", "desde", "donde", "dos", "el", "ella", "ellas", "ellos", "en", "era",
  "es", "esa", "ese", "eso", "esta", "este", "esto", "fue", "ha", "hasta", "hay", "la", "las",
  "le", "les", "lo", "los", "mas", "me", "mi", "mientras", "muy", "ni", "no", "nos", "o",
  "para", "pero", "por", "porque", "que", "se", "sin", "sobre", "su", "sus", "tambien", "te",
  "tenia", "todo", "un", "una", "uno", "y", "ya",
]);

const EMOTIONAL_WORDS = new Set([
  "absurdo", "alegria", "ataco", "atrapado", "choque", "dolor", "engano", "espanto", "fatal",
  "feliz", "fuego", "horror", "miedo", "muerte", "peligro", "sorpresa", "sorprendido", "terrible",
  "trampa", "venganza", "verdad",
]);

const NARRATIVE_FUNCTION: Record<DnaBlockType, string> = {
  hook: "interromper o padrao com uma acao visual extrema",
  setup: "estabelecer personagem, regra e objetivo sem perder ritmo",
  desenvolvimento: "escalar a cadeia causal com uma micro-revelacao por unidade",
  tensao: "aumentar o risco e adiar a resolucao",
  revelacao: "recontextualizar a situacao com uma virada",
  payoff: "entregar a consequencia extrema prometida pelo gancho",
};

const VISUAL_EVIDENCE: Record<string, VisualEvidence[]> = {
  vjqsNKq05iE: [
    { at: 0.03, action: "atravessar", description: "Uma taça azul atravessa uma taça vermelha; o líquido muda de cor e volume.", emotion: "surpresa", intensity: 92, objects: ["taças", "vinho"] },
    { at: 0.23, action: "imitar", description: "A taça vermelha tenta repetir o truque, mas somente as taças azuis crescem.", emotion: "frustracao", intensity: 72, objects: ["taças azuis", "taça vermelha"] },
    { at: 0.53, action: "escalar tentativa", description: "A vermelha atravessa várias taças de uma vez e todas crescem, menos ela.", emotion: "desespero", intensity: 82, objects: ["grupo de taças"] },
    { at: 0.75, action: "absorver", description: "Uma taça vazia absorve todo o vinho da personagem vermelha.", emotion: "choque", intensity: 96, objects: ["taça vazia", "vinho"] },
    { at: 0.94, action: "transformar", description: "Duas taças compartilham vinho e a personagem cresce e se transforma em azul.", emotion: "alivio", intensity: 88, objects: ["taças", "transformação"] },
  ],
  adcOHqnTEZY: [
    { at: 0.03, action: "introduzir inseto", description: "Um homem coloca uma barata no ouvido da companheira adormecida.", emotion: "nojo", intensity: 98, objects: ["barata", "ouvido", "casal"] },
    { at: 0.18, action: "derreter", description: "Ele derrete a cera retirada e a transforma em líquido dourado.", emotion: "curiosidade", intensity: 84, objects: ["cera", "panela"] },
    { at: 0.31, action: "fabricar joia", description: "A substância é moldada em brincos com aparência de ouro.", emotion: "surpresa", intensity: 79, objects: ["brincos", "pedras"] },
    { at: 0.49, action: "lucrar", description: "O homem recebe dinheiro por joias e planeja produzir ainda mais.", emotion: "ganancia", intensity: 76, objects: ["dinheiro", "joias"] },
    { at: 0.68, action: "descobrir", description: "A mulher encontra o inseto e percebe a verdade sobre o frasco de cera.", emotion: "choque", intensity: 90, objects: ["mulher", "barata", "frasco"] },
    { at: 0.83, action: "reverter armadilha", description: "Ela finge dormir, domina o homem e o amarra no laboratório.", emotion: "vinganca", intensity: 94, objects: ["cadeira", "laboratório"] },
    { at: 0.96, action: "extrair", description: "Uma máquina retira a cera do ouvido dele; a mulher abre uma loja de velas.", emotion: "ironia", intensity: 99, objects: ["máquina", "velas"] },
  ],
  FaZGE4SyeUc: [
    { at: 0.03, action: "engolir", description: "Um homem engole a esposa miniaturizada de uma só vez.", emotion: "choque", intensity: 100, objects: ["homem", "mulher miniatura"] },
    { at: 0.2, action: "cair no estomago", description: "A mulher atravessa a garganta e cai dentro do estômago.", emotion: "perigo", intensity: 91, objects: ["estômago", "mulher"] },
    { at: 0.38, action: "encontrar aliada", description: "Ela encontra outra mulher presa no interior do corpo.", emotion: "surpresa", intensity: 78, objects: ["duas mulheres"] },
    { at: 0.56, action: "sabotar", description: "As duas atacam os rins para enfraquecer o homem e buscar uma saída.", emotion: "tensao", intensity: 89, objects: ["rins", "mulheres"] },
    { at: 0.73, action: "escalar nariz", description: "Elas chegam às fossas nasais e aparecem parcialmente pela narina.", emotion: "absurdo", intensity: 97, objects: ["nariz", "pernas"] },
    { at: 0.86, action: "espirrar", description: "Cócegas provocam um espirro que arremessa as duas para fora.", emotion: "alivio", intensity: 93, objects: ["espirro", "mulheres"] },
    { at: 0.97, action: "inverter destino", description: "Uma poção restaura as mulheres, encolhe o homem e ele é dado como comida.", emotion: "ironia", intensity: 100, objects: ["poção", "homem miniatura"] },
  ],
  ybTdVLMyxTA: [
    { at: 0.03, action: "descartar", description: "Uma mulher joga um homem no vaso sanitário e apaga sua foto.", emotion: "choque", intensity: 98, objects: ["vaso", "celular"] },
    { at: 0.18, action: "rastrear", description: "A empregada lança um fone no vaso e acompanha o trajeto pelo celular.", emotion: "curiosidade", intensity: 86, objects: ["fone", "mapa", "esgoto"] },
    { at: 0.34, action: "resgatar", description: "Ela desce ao esgoto e encontra três homens presos.", emotion: "surpresa", intensity: 82, objects: ["esgoto", "homens"] },
    { at: 0.5, action: "trair", description: "Os homens resgatados atacam e lançam as duas mulheres no vaso.", emotion: "traicao", intensity: 95, objects: ["homens", "mulheres"] },
    { at: 0.64, action: "desentupir", description: "A empregada fica presa no cano e é empurrada com um desentupidor.", emotion: "absurdo", intensity: 97, objects: ["cano", "desentupidor"] },
    { at: 0.79, action: "revelar verdade", description: "No esgoto, a mulher revela que os homens eram golpistas.", emotion: "revelacao", intensity: 84, objects: ["duas mulheres"] },
    { at: 0.94, action: "reverter castigo", description: "Uma mangueira puxa os homens de volta ao esgoto, onde recebem o castigo.", emotion: "vinganca", intensity: 96, objects: ["mangueira", "esgoto"] },
  ],
  "NB3n-OFF7Nw": [
    { at: 0.05, action: "preparar", description: "Uma família inicia a limpeza da casa antes do piquenique.", emotion: "expectativa", intensity: 55, objects: ["família", "casa"] },
    { at: 0.24, action: "cortar com laser", description: "O irmão usa os olhos laser do bebê como cortador de grama.", emotion: "absurdo", intensity: 94, objects: ["bebê", "laser", "grama"] },
    { at: 0.43, action: "limpar com magia", description: "A irmã movimenta objetos e limpa o quarto por magia.", emotion: "surpresa", intensity: 76, objects: ["livro", "objetos"] },
    { at: 0.59, action: "esticar braço", description: "A mãe estica o braço para salvar um filho que cai da janela.", emotion: "perigo", intensity: 86, objects: ["braço elástico", "janela"] },
    { at: 0.74, action: "lavar remotamente", description: "O pai usa um controle e supervelocidade para lavar o carro.", emotion: "humor", intensity: 78, objects: ["controle", "carro"] },
    { at: 0.93, action: "cozinhar com poder", description: "Uma barreira protege da chuva e o bebê vira fogo para cozinhar.", emotion: "payoff", intensity: 91, objects: ["barreira", "fogo", "família"] },
  ],
  "9ZNzEeIZGOo": [
    { at: 0.04, action: "sabotar concurso", description: "Um cão trapaceiro joga milhares de pulgas no rival durante uma competição.", emotion: "tensao", intensity: 88, objects: ["cães", "pulgas"] },
    { at: 0.2, action: "poupar", description: "O cão vê uma pulga alimentando o filhote e decide não se coçar.", emotion: "empatia", intensity: 70, objects: ["cão", "pulgas"] },
    { at: 0.34, action: "impulsionar", description: "As pulgas instalam molas nas patas e o cão supera obstáculos.", emotion: "surpresa", intensity: 85, objects: ["molas", "pista"] },
    { at: 0.52, action: "brilhar", description: "Os dentes limpos brilham com força exagerada diante dos jurados.", emotion: "absurdo", intensity: 92, objects: ["dentes", "jurados"] },
    { at: 0.69, action: "cozinhar figura", description: "O cão apresenta um prato com forma humana e vence outra prova.", emotion: "humor", intensity: 80, objects: ["prato", "comida"] },
    { at: 0.84, action: "concentrar energia", description: "As pulgas unem energia e o cão dispara um ataque no rival.", emotion: "climax", intensity: 96, objects: ["energia", "cães"] },
    { at: 0.97, action: "esmagar acidentalmente", description: "Na comemoração, a dona pisa sem perceber nas pulgas que ajudaram.", emotion: "ironia", intensity: 99, objects: ["pulgas", "pé"] },
  ],
  sQdSlqAflKg: [
    { at: 0.04, action: "comprar", description: "Alimentos animados comemoram ao sair do supermercado.", emotion: "alegria", intensity: 65, objects: ["alimentos", "carrinho"] },
    { at: 0.2, action: "alertar", description: "Uma garrafa de mel avisa que os humanos vão matar todos e se joga do carrinho.", emotion: "medo", intensity: 90, objects: ["mel", "alimentos"] },
    { at: 0.39, action: "descobrir destino", description: "Os alimentos dançam até verem uma batata ser descascada e fervida.", emotion: "choque", intensity: 95, objects: ["batata", "panela"] },
    { at: 0.58, action: "cortar", description: "Tomate, repolho e queijo são cortados diante dos demais.", emotion: "terror", intensity: 93, objects: ["faca", "vegetais"] },
    { at: 0.73, action: "capturar", description: "Duas cenouras tentam fugir, mas são capturadas e comidas no ar.", emotion: "perigo", intensity: 96, objects: ["cenouras", "mulher"] },
    { at: 0.91, action: "fugir", description: "Duas salsichas correm para a janela enquanto uma faca as persegue.", emotion: "tensao", intensity: 94, objects: ["salsichas", "faca"] },
    { at: 0.98, action: "atravessar", description: "A faca atravessa uma salsicha; a outra cai pela janela.", emotion: "climax", intensity: 99, objects: ["faca", "salsichas"] },
  ],
};

function parseTime(value: string): number {
  const parts = value.trim().split(":").map(Number);
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}

function parseVtt(vtt: string): TranscriptSegment[] {
  const pieces: TranscriptSegment[] = [];
  for (const cue of vtt.split(/\r?\n\r?\n/)) {
    const timing = cue.match(/(\d{2}:\d{2}:\d{2}\.\d+)\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d+)/);
    if (!timing) continue;
    const tagged = cue.split(/\r?\n/).filter(line => /<(?:\d{2}:|c>)/.test(line));
    const text = tagged.join(" ").replace(/<[^>]+>/g, "").replace(/\[música\]/gi, "").replace(/\s+/g, " ").trim();
    if (text) pieces.push({ start: parseTime(timing[1]), end: parseTime(timing[2]), text });
  }
  const segments: TranscriptSegment[] = [];
  let current: TranscriptSegment | null = null;
  for (const piece of pieces) {
    if (!current) current = { ...piece };
    else {
      current.text = `${current.text} ${piece.text}`.replace(/\s+/g, " ");
      current.end = piece.end;
    }
    if (/[.!?]$/.test(current.text) || current.end - current.start >= 7 || current.text.split(/\s+/).length >= 28) {
      segments.push(current);
      current = null;
    }
  }
  if (current) segments.push(current);
  return segments;
}

function normalizeWord(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("es")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normalizeWord)
    .filter(word => word.length > 1);
}

function blockTypesForEvidence(count: number): DnaBlockType[] {
  if (count < 3) throw new Error(`Evidencia visual insuficiente para formar DNA: ${count} pontos`);
  if (count === 3) return ["hook", "desenvolvimento", "payoff"];
  if (count === 4) return ["hook", "setup", "desenvolvimento", "payoff"];
  if (count === 5) return ["hook", "setup", "desenvolvimento", "revelacao", "payoff"];
  if (count === 6) return ["hook", "setup", "desenvolvimento", "tensao", "revelacao", "payoff"];
  if (count === 7) return ["hook", "setup", "desenvolvimento", "tensao", "revelacao", "desenvolvimento", "payoff"];

  const middle: DnaBlockType[] = ["setup", "desenvolvimento"];
  while (middle.length < count - 3) middle.push(middle.length % 2 === 0 ? "tensao" : "desenvolvimento");
  middle.push("revelacao");
  return ["hook", ...middle.slice(0, count - 2), "payoff"];
}

function toDnaEmotion(value: string): DnaEmotion {
  const emotion = normalizeWord(value);
  if (emotion === "curiosidade") return "curiosidade";
  if (emotion === "surpresa") return "surpresa";
  if (["medo", "perigo", "terror", "nojo"].includes(emotion)) return "medo";
  if (["tensao", "climax", "desespero", "frustracao", "traicao"].includes(emotion)) return "tensao";
  if (["alivio", "alegria", "humor", "payoff"].includes(emotion)) return "alivio";
  if (emotion === "expectativa") return "expectativa";
  return "impacto";
}

function transcriptTextForWindow(
  segments: TranscriptSegment[],
  start: number,
  end: number,
  fallbackDescription: string,
): string {
  const midpoint = (start + end) / 2;
  const overlapping = segments.filter(segment => segment.end > start && segment.start < end);
  const selected = overlapping.length
    ? overlapping
    : [...segments]
        .sort((a, b) => Math.abs((a.start + a.end) / 2 - midpoint) - Math.abs((b.start + b.end) / 2 - midpoint))
        .slice(0, 1);
  const unique = [...new Set(selected.map(segment => segment.text.replace(/\s+/g, " ").trim()).filter(Boolean))];
  return unique.join(" ").replace(/\s+/g, " ").trim() || fallbackDescription;
}

function deterministicBlockRows(
  videoId: string,
  requestedDuration: number,
  segments: TranscriptSegment[],
  evidence: VisualEvidence[],
) {
  const transcriptDuration = Math.max(0, ...segments.map(segment => segment.end));
  const duration = Math.max(requestedDuration, transcriptDuration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Duracao invalida para segmentacao deterministica");

  const types = blockTypesForEvidence(evidence.length);
  const centers = evidence.map(item => Math.min(duration, Math.max(0, item.at * duration)));
  return evidence.map((item, index) => {
    const start = index === 0 ? 0 : (centers[index - 1] + centers[index]) / 2;
    const end = index === evidence.length - 1 ? duration : (centers[index] + centers[index + 1]) / 2;
    const text = transcriptTextForWindow(segments, start, end, item.description);
    const wordsPerSecond = tokenize(text).length / Math.max(0.1, end - start);
    const previousIntensity = index > 0 ? evidence[index - 1].intensity : 0;
    const type = types[index];
    return {
      video_id: videoId,
      bloco_id: index + 1,
      tempo_inicio: +start.toFixed(3),
      tempo_fim: +end.toFixed(3),
      texto: text,
      tipo_bloco: type,
      funcao_narrativa: NARRATIVE_FUNCTION[type],
      emocao: toDnaEmotion(item.emotion),
      elemento_visual: item.objects.join(", "),
      descricao_visual: item.description,
      language_code: "es",
      block_density_score: +Math.min(10, wordsPerSecond).toFixed(4),
      semantic_shift_score: type === "hook" || type === "revelacao" || type === "payoff" ? 1 : 0.7,
      visual_shift_score: +Math.min(1, 0.5 + Math.abs(item.intensity - previousIntensity) / 100).toFixed(3),
    };
  });
}

function strongPhrases(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);
  const source = sentences.length ? sentences : [text];
  return source
    .map(sentence => sentence.split(/\s+/).slice(0, 15).join(" "))
    .filter(phrase => tokenize(phrase).length >= 2)
    .slice(0, 3);
}

function deterministicSemanticRow(
  videoId: string,
  block: { id: string; tipo_bloco: string; texto: string | null; emocao: string | null },
  engagementRate: number,
  visualIntensity: number,
) {
  const text = String(block.texto || "").replace(/\s+/g, " ").trim();
  const tokens = tokenize(text);
  const frequencies = new Map<string, number>();
  for (const token of tokens) frequencies.set(token, (frequencies.get(token) || 0) + 1);
  const ranked = [...frequencies.entries()]
    .filter(([word]) => word.length >= 3 && !SPANISH_STOPWORDS.has(word))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]));
  const keywords = ranked.slice(0, 10).map(([word]) => word);
  const repeated = ranked.filter(([, count]) => count > 1).slice(0, 8).map(([word]) => word);
  const emotional = ranked.filter(([word]) => EMOTIONAL_WORDS.has(word)).slice(0, 8).map(([word]) => word);
  const rare = ranked.filter(([word, count]) => count === 1 && word.length >= 7).slice(0, 5).map(([word]) => word);
  const dominant = ranked.slice(0, 5).map(([word]) => word);
  const phrases = strongPhrases(text);
  const tone = block.tipo_bloco === "hook"
    ? "provocativo"
    : block.tipo_bloco === "tensao"
      ? "alarmante"
      : block.tipo_bloco === "revelacao"
        ? "curioso"
        : block.tipo_bloco === "payoff"
          ? "emocional"
          : "familiar";

  return {
    video_id: videoId,
    block_id: block.id,
    block_type: block.tipo_bloco,
    block_text: text,
    block_keywords: keywords,
    block_emotional_words: emotional,
    block_repeated_words: repeated,
    block_strong_phrases: phrases,
    rare_words: rare,
    dominant_words: dominant,
    block_emotional_type: block.emocao || "impacto",
    block_emotional_intensity: Math.max(1, Math.min(5, Math.round(visualIntensity / 20))),
    block_verbal_tone: tone,
    weighted_word_score: +(keywords.length * Math.max(0, engagementRate)).toFixed(6),
    weighted_phrase_score: +(phrases.length * Math.max(0, engagementRate)).toFixed(6),
  };
}

async function invoke(supabase: any, name: string, body: unknown, required = false) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  const message = error?.message || data?.error;
  if (message && required) throw new Error(`${name}: ${message}`);
  if (message) console.warn(`    aviso ${name}: ${message}`);
  return data;
}

function extractFrame(
  videoPath: string,
  outputPath: string,
  requestedTimestamp: number,
  fallbackTimestamps: number[],
): number {
  const candidates = [requestedTimestamp, ...fallbackTimestamps]
    .map(value => Math.max(0, value))
    .filter((value, index, values) => values.findIndex(candidate => Math.abs(candidate - value) < 0.001) === index);

  let lastError: unknown = null;
  for (const timestamp of candidates) {
    rmSync(outputPath, { force: true });
    try {
      execFileSync("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-ss", timestamp.toFixed(3),
        "-i", videoPath,
        "-frames:v", "1",
        "-vf", "scale=640:-2,format=yuvj420p",
        "-strict", "unofficial",
        "-q:v", "3",
        outputPath,
      ]);
      if (existsSync(outputPath) && readFileSync(outputPath).byteLength > 0) return timestamp;
      lastError = new Error(`ffmpeg não produziu frame em ${timestamp.toFixed(3)}s`);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Não foi possível extrair frame de ${path.basename(videoPath)}: ${String(lastError)}`);
}

const benjiRoot = process.env.BENJI_ROOT;
if (!benjiRoot) throw new Error("BENJI_ROOT é obrigatório");
const deterministicMode = /^(1|true|yes)$/i.test(process.env.BENJI_DETERMINISTIC || "");

const { supabase } = await import("../src/integrations/supabase/client");
const { createDnaPreset, deleteDnaPreset, listDnaPresets } = await import("../src/lib/dna-presets");
const { validateDnaStylePack } = await import("../src/lib/dna-style-pack");

const importedVideoIds: string[] = [];
const startId = process.env.BENJI_START_ID;
const startIndex = startId ? SOURCES.findIndex(source => source.id === startId) : 0;
if (startId && startIndex < 0) throw new Error(`BENJI_START_ID desconhecido: ${startId}`);
const sourcesToProcess = SOURCES.slice(Math.max(0, startIndex));

for (const source of sourcesToProcess) {
  const dir = path.join(benjiRoot, source.id);
  const videoPath = path.join(dir, `${source.id}.mp4`);
  const infoPath = path.join(dir, `${source.id}.info.json`);
  const vttPath = path.join(dir, `${source.id}.es-orig.vtt`);
  if (![videoPath, infoPath, vttPath].every(existsSync)) throw new Error(`Arquivos incompletos para ${source.id}`);

  const info = JSON.parse(readFileSync(infoPath, "utf8"));
  const buffer = readFileSync(videoPath);
  const duration = Number(info.duration) || 0;
  const engagementRate = ((Number(info.like_count) || 0) + (Number(info.comment_count) || 0)) / Math.max(1, Number(info.view_count) || 0);
  const payload = {
    titulo: info.title || source.id,
    origem: source.url,
    tipo_entrada: "link",
    segmento: "curiosidade",
    estilo_visual: "animacao",
    status: "processing",
    idioma: "es",
    duracao: duration,
    tamanho: buffer.byteLength,
    views: Number(info.view_count) || 0,
    likes: Number(info.like_count) || 0,
    comments: Number(info.comment_count) || 0,
    engagement_rate: engagementRate,
  } as const;

  const { data: existing, error: existingError } = await supabase
    .from("videos")
    .select("id")
    .eq("origem", source.url)
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error(`consulta ${source.id}: ${existingError.message}`);
  let videoId: string;
  if (existing?.id) {
    videoId = existing.id;
    const { error } = await supabase.from("videos").update(payload).eq("id", videoId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase.from("videos").insert(payload).select("id").single();
    if (error || !data) throw error || new Error(`Falha ao criar ${source.id}`);
    videoId = data.id;
  }
  importedVideoIds.push(videoId);
  console.log(`[${source.id}] vídeo ${videoId}`);

  const storagePath = `dna-sources/benji/${videoId}.mp4`;
  const { error: uploadError } = await supabase.storage.from("videos").upload(
    storagePath,
    new Blob([new Uint8Array(buffer)], { type: "video/mp4" }),
    { upsert: true, contentType: "video/mp4" },
  );
  if (uploadError && !/row-level security/i.test(uploadError.message)) {
    throw new Error(`upload ${source.id}: ${uploadError.message}`);
  }
  if (uploadError) console.log(`    storage: objeto existente reutilizado`);

  const sourceCleanup = await Promise.all([
    supabase.from("video_metadata").delete().eq("video_id", videoId),
    supabase.from("video_languages").delete().eq("video_id", videoId),
    supabase.from("video_transcripts").delete().eq("video_id", videoId),
    supabase.from("processing_queue").delete().eq("video_id", videoId),
  ]);
  const cleanupLabels = ["metadados", "idiomas", "transcrição", "fila"];
  sourceCleanup.forEach((result, index) => {
    if (result.error) throw new Error(`limpeza de ${cleanupLabels[index]} ${source.id}: ${result.error.message}`);
  });
  const { error: metadataError } = await supabase.from("video_metadata").insert([
    { video_id: videoId, chave: "file_path", valor: storagePath },
    { video_id: videoId, chave: "youtube_id", valor: source.id },
    { video_id: videoId, chave: "source_channel", valor: "Benji Curioso" },
    { video_id: videoId, chave: "upload_date", valor: String(info.upload_date || "") },
    {
      video_id: videoId,
      chave: "analysis_source",
      valor: deterministicMode
        ? "deterministic VTT segmentation + structural real-frame audit"
        : "yt-dlp captions + structural real frames",
    },
  ]);
  if (metadataError) throw new Error(`metadados ${source.id}: ${metadataError.message}`);
  const { error: languageError } = await supabase
    .from("video_languages")
    .insert({ video_id: videoId, language_code: "es", is_original: true });
  if (languageError) throw new Error(`idioma ${source.id}: ${languageError.message}`);
  const { error: queueInsertError } = await supabase
    .from("processing_queue")
    .insert({ video_id: videoId, status: "processing", priority: 0 });
  if (queueInsertError) throw new Error(`fila ${source.id}: ${queueInsertError.message}`);

  const segments = parseVtt(readFileSync(vttPath, "utf8"));
  const { error: transcriptError } = await supabase.from("video_transcripts").insert(segments.map(segment => ({
    video_id: videoId,
    tempo_inicio: +segment.start.toFixed(2),
    tempo_fim: +segment.end.toFixed(2),
    duracao: +(segment.end - segment.start).toFixed(2),
    texto: segment.text,
    language_code: "es",
  })));
  if (transcriptError) throw new Error(`transcrição ${source.id}: ${transcriptError.message}`);

  const evidence = VISUAL_EVIDENCE[source.id];
  if (deterministicMode) {
    // video_frames.block_id is not backed by a foreign key in the historical schema,
    // so clear frames before replacing blocks to avoid orphan rows on a rerun.
    const { error: staleFramesError } = await supabase.from("video_frames").delete().eq("video_id", videoId);
    if (staleFramesError) throw new Error(`limpeza de frames ${source.id}: ${staleFramesError.message}`);
    const { error: staleBlocksError } = await supabase.from("video_blocks").delete().eq("video_id", videoId);
    if (staleBlocksError) throw new Error(`limpeza de blocos ${source.id}: ${staleBlocksError.message}`);

    const blockRows = deterministicBlockRows(videoId, duration, segments, evidence);
    const { error: deterministicBlocksError } = await supabase.from("video_blocks").insert(blockRows);
    if (deterministicBlocksError) {
      throw new Error(`blocos determinísticos ${source.id}: ${deterministicBlocksError.message}`);
    }
  } else {
    const narrative = await invoke(supabase, "analyze-narrative", { video_id: videoId }, true);
    console.log(`    narrativa: ${narrative?.blocks_count || 0} blocos`);
  }

  const { data: blocks, error: blocksError } = await supabase
    .from("video_blocks")
    .select("id, bloco_id, tipo_bloco, tempo_inicio, tempo_fim, texto, emocao")
    .eq("video_id", videoId)
    .order("bloco_id");
  if (blocksError || !blocks?.length) throw blocksError || new Error(`Sem blocos para ${source.id}`);

  if (deterministicMode) {
    const semanticRows = blocks.map((block, index) => deterministicSemanticRow(
      videoId,
      block,
      engagementRate,
      evidence[index]?.intensity ?? 80,
    ));
    const { error: semanticError } = await supabase.from("block_semantic_patterns").insert(semanticRows);
    if (semanticError) throw new Error(`semântica determinística ${source.id}: ${semanticError.message}`);
    console.log(`    narrativa determinística: ${blocks.length} blocos / ${semanticRows.length} perfis semânticos`);
  }

  const visualCleanup = await Promise.all([
    supabase.from("video_frames").delete().eq("video_id", videoId),
    supabase.from("visual_block_analysis").delete().eq("video_id", videoId),
  ]);
  if (visualCleanup[0].error) throw new Error(`limpeza video_frames ${source.id}: ${visualCleanup[0].error.message}`);
  if (visualCleanup[1].error) throw new Error(`limpeza visual_block_analysis ${source.id}: ${visualCleanup[1].error.message}`);
  const tmp = path.join(tmpdir(), `dna-benji-${source.id}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const frameRows: any[] = [];
  const visualRows: any[] = [];
  let frameNumber = 1;

  for (const block of blocks) {
    const start = Math.max(0, Number(block.tempo_inicio) || 0);
    const end = Math.min(duration, Number(block.tempo_fim) || duration);
    const midpoint = (start + end) / 2;
    const selected = [...evidence].sort((a, b) => Math.abs(a.at - midpoint / duration) - Math.abs(b.at - midpoint / duration))[0];
    let representativePath: string | null = null;
    const safeEnd = Math.max(start, Math.min(Math.max(0, duration - 1), end - 0.5));
    for (const [role, timestamp] of [["start", start], ["middle", midpoint], ["end", safeEnd]] as const) {
      const jpg = path.join(tmp, `block-${block.bloco_id}-${role}.jpg`);
      const actualTimestamp = extractFrame(videoPath, jpg, timestamp, [midpoint, start, Math.max(0, duration - 1.5)]);
      const jpgBuffer = readFileSync(jpg);
      const framePath = `frames/${videoId}/benji/block_${String(block.bloco_id).padStart(3, "0")}_${role}.jpg`;
      const { error } = await supabase.storage.from("videos").upload(framePath, new Blob([new Uint8Array(jpgBuffer)], { type: "image/jpeg" }), { upsert: true, contentType: "image/jpeg" });
      if (error && !/row-level security/i.test(error.message)) {
        throw new Error(`frame ${source.id}/${block.bloco_id}: ${error.message}`);
      }
      if (role === "middle") representativePath = `videos/${framePath}`;
      frameRows.push({
        video_id: videoId,
        block_id: block.id,
        frame_number: frameNumber++,
        timestamp_seconds: +actualTimestamp.toFixed(3),
        file_path: `videos/${framePath}`,
        frame_hash: createHash("sha256").update(jpgBuffer).digest("hex").slice(0, 32),
        frame_role: role,
        source_method: "benji_visual_audit_real_frame",
        scene_change_flag: role === "start",
        visual_intensity_score: selected.intensity,
      });
    }
    visualRows.push({
      video_id: videoId,
      block_id: block.id,
      block_type: block.tipo_bloco,
      main_action: selected.action,
      main_objects: selected.objects,
      scene_description: selected.description,
      visual_emotion: selected.emotion,
      avg_visual_intensity_score: selected.intensity,
      visual_intensity_level: selected.intensity >= 90 ? "muito_alta" : selected.intensity >= 75 ? "alta" : "media",
      scene_change_count: 1,
      scene_change_detected: true,
      representative_frame_path: representativePath,
      representative_timestamp: +midpoint.toFixed(3),
      text_on_screen_presence: true,
      human_presence: /homem|mulher|família|dona|empregada/i.test(selected.description),
      animal_presence: /cão|pulga|barata/i.test(selected.description),
      confidence_score: 96,
      data_source_type: "direct_observation",
      origin_level: "visual_audit",
    });
  }
  rmSync(tmp, { recursive: true, force: true });
  const { error: framesError } = await supabase.from("video_frames").insert(frameRows);
  if (framesError) throw new Error(`video_frames ${source.id}: ${framesError.message}`);
  const { error: visualError } = await supabase.from("visual_block_analysis").insert(visualRows);
  if (visualError) throw new Error(`visual_block_analysis ${source.id}: ${visualError.message}`);

  const postProcessors = [
    ...(!deterministicMode ? [{ name: "extract-block-semantics", body: { video_id: videoId }, required: false }] : []),
    { name: "extract-verbal-dna", body: { video_id: videoId }, required: deterministicMode },
    { name: "calculate-text-visual-alignment", body: { video_id: videoId }, required: deterministicMode },
    { name: "calculate-text-image-compatibility", body: { video_id: videoId }, required: deterministicMode },
    { name: "analyze-narrative-sequences", body: { video_id: videoId }, required: deterministicMode },
    // mode=single is intentional: the incremental default only sees completed videos,
    // while this video remains processing until every required layer succeeds.
    { name: "process-temporal-profile", body: { video_id: videoId, mode: "single" }, required: deterministicMode },
    { name: "calculate-performance-normalization", body: { video_id: videoId }, required: false },
  ];
  for (const processor of postProcessors) {
    await invoke(supabase, processor.name, processor.body, processor.required);
  }

  const hookBlock = blocks.find(block => block.tipo_bloco === "hook") || blocks[0];
  const revealBlock = blocks.find(block => block.tipo_bloco === "revelacao");
  const payoffBlock = blocks.find(block => block.tipo_bloco === "payoff") || blocks[blocks.length - 1];
  const strongestEvidence = [...evidence].sort((a, b) => b.intensity - a.intensity)[0];
  const completionPayload = {
    status: "completed" as const,
    numero_frames: frameRows.length,
    numero_blocos: blocks.length,
    ...(deterministicMode ? {
      gancho_detectado: true,
      tempo_gancho: Number(hookBlock.tempo_inicio),
      duracao_gancho: +(Number(hookBlock.tempo_fim) - Number(hookBlock.tempo_inicio)).toFixed(3),
      tipo_gancho: "acao" as const,
      emocao_predominante: toDnaEmotion(strongestEvidence.emotion),
      intensidade_emocional: strongestEvidence.intensity >= 80 ? "alta" as const : "media" as const,
      tempo_primeiro_evento: +(evidence[0].at * duration).toFixed(3),
      tempo_primeira_revelacao: revealBlock ? Number(revealBlock.tempo_inicio) : null,
      tempo_payoff: Number(payoffBlock.tempo_inicio),
      loop_detectado: false,
    } : {}),
  };
  const { error: completionError } = await supabase.from("videos").update(completionPayload).eq("id", videoId);
  if (completionError) throw new Error(`conclusão ${source.id}: ${completionError.message}`);
  const { error: queueCompletionError } = await supabase
    .from("processing_queue")
    .update({ status: "completed", completed_at: new Date().toISOString(), error_message: null })
    .eq("video_id", videoId);
  if (queueCompletionError) throw new Error(`conclusão da fila ${source.id}: ${queueCompletionError.message}`);
  const { error: logError } = await supabase.from("video_logs").insert({
    video_id: videoId,
    etapa: "Preset Benji",
    status: "success",
    mensagem: `Importado com ${segments.length} segmentos, ${blocks.length} blocos e ${frameRows.length} frames reais.`,
  });
  if (logError) throw new Error(`log ${source.id}: ${logError.message}`);
  console.log(`    visual: ${frameRows.length} frames reais / ${visualRows.length} blocos`);
}

const presetName = "Benji Curioso — Virais Jun-Jul 2026";
const { data: allSourceRows, error: allSourceError } = await supabase
  .from("videos")
  .select("id, origem")
  .in("origem", SOURCES.map(source => source.url));
if (allSourceError) throw allSourceError;
const allVideoIds = SOURCES
  .map(source => allSourceRows?.find(row => row.origem === source.url)?.id)
  .filter((id): id is string => Boolean(id));
const uniqueSourceIds = new Set(allVideoIds);
if (allVideoIds.length !== SOURCES.length || uniqueSourceIds.size !== SOURCES.length) {
  throw new Error(`Base incompleta: ${uniqueSourceIds.size}/${SOURCES.length} vídeos únicos encontrados`);
}

// Keep the previous good preset available until the replacement has passed the
// full 7/7 contract. A failed replacement is removed as rollback.
const previousPresets = (await listDnaPresets()).filter(preset => preset.name === presetName);
const preset = await createDnaPreset(presetName, allVideoIds, "pt");
try {
  const readiness = validateDnaStylePack(preset.style_pack);
  if (!readiness.ready) throw new Error(`contrato base: ${readiness.reasons.join(", ")}`);
  if (preset.video_count !== 7 || new Set(preset.video_ids).size !== 7) {
    throw new Error(`fontes persistidas: ${new Set(preset.video_ids).size}/7`);
  }
  if (preset.confidence_score !== 100) throw new Error(`confiança: ${preset.confidence_score ?? "nula"}/100`);
  if (preset.style_pack?.total_videos !== 7) throw new Error(`total_videos: ${preset.style_pack?.total_videos ?? 0}/7`);

  const quality = preset.style_pack?.extraction_quality;
  if (
    quality?.video_coverage !== 1
    || quality?.text_strategy_coverage !== 1
    || quality?.visual_strategy_coverage !== 1
    || quality?.overall !== 1
  ) {
    throw new Error(
      `cobertura incompleta: vídeo=${quality?.video_coverage ?? 0}, texto=${quality?.text_strategy_coverage ?? 0}, visual=${quality?.visual_strategy_coverage ?? 0}, geral=${quality?.overall ?? 0}`,
    );
  }

  for (const requiredType of ["hook", "desenvolvimento", "payoff"]) {
    const blockStyle = preset.style_pack?.block_styles.find(block => block.block_type === requiredType);
    if (blockStyle?.strategy?.source_video_count !== 7) {
      throw new Error(`${requiredType}: ${blockStyle?.strategy?.source_video_count ?? 0}/7 fontes de estratégia`);
    }
    const protectedVideoIds = new Set(
      (blockStyle.protected_examples || [])
        .map(example => example.video_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    );
    if (protectedVideoIds.size !== 7 || [...uniqueSourceIds].some(id => !protectedVideoIds.has(id))) {
      throw new Error(`${requiredType}: ${protectedVideoIds.size}/7 referências protegidas únicas`);
    }
  }
} catch (error) {
  try {
    await deleteDnaPreset(preset.id);
  } catch (rollbackError) {
    const failure = error instanceof Error ? error.message : String(error);
    const rollbackFailure = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
    throw new Error(`Preset novo inválido (${failure}); rollback também falhou (${rollbackFailure})`);
  }
  throw error;
}

for (const previous of previousPresets) await deleteDnaPreset(previous.id);

console.log(JSON.stringify({
  preset_id: preset.id,
  preset_name: preset.name,
  videos: importedVideoIds.length,
  confidence_score: preset.confidence_score,
  extraction_quality: preset.style_pack?.extraction_quality,
  strategies: preset.style_pack?.block_styles.map(block => ({
    block_type: block.block_type,
    strategy: block.strategy,
  })),
}, null, 2));
