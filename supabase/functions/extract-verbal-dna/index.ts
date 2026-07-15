import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PHRASE_PATTERNS = ["pergunta", "afirmacao", "alerta", "segredo", "erro", "proibicao", "promessa", "descoberta"];
const TONES = ["misterioso", "urgente", "emocional", "tecnico", "neutro", "chocante"];

// Strong trigger words — narratively relevant, not generic
const TRIGGER_WORDS_STRONG = [
  "nunca", "jamais", "proibido", "secreto", "chocante", "inacreditável",
  "revelado", "verdade", "mentira", "perigo", "cuidado", "atenção",
  "impressionante", "surpreendente", "misterioso", "assustador",
  "impossível", "fatal", "mortal", "bizarro", "estranho", "raro",
];

// Weak/generic words — only counted but not as triggers
const WEAK_WORDS = new Set([
  "único", "primeiro", "último", "maior", "pior", "melhor",
  "ninguém", "todos", "incrível", "urgente", "descoberta",
]);

function detectPhrasePattern(text: string): { pattern: string; confidence: number } {
  const t = text.trim().toLowerCase();
  const sentences = t.split(/[.!?]+/).filter(s => s.trim().length > 0);
  
  // Count indicators for each pattern
  const scores: Record<string, number> = {};
  
  // Pergunta: needs actual question structure, not just "?"
  const questionSentences = sentences.filter(s => s.trim().endsWith("?") || t.endsWith("?"));
  if (questionSentences.length > 0 && questionSentences.length >= sentences.length * 0.5) {
    scores.pergunta = 30 + (questionSentences.length / Math.max(1, sentences.length)) * 40;
  }
  
  // Proibição: needs prohibition language + consequence or emphasis
  const prohibitionWords = ["nunca", "jamais", "proibido", "não pode", "não faça", "não tente", "não deveria"];
  const prohibCount = prohibitionWords.filter(w => t.includes(w)).length;
  if (prohibCount >= 2) scores.proibicao = 50 + prohibCount * 15;
  else if (prohibCount === 1 && (t.includes("!") || t.includes("perigo"))) scores.proibicao = 40;
  
  // Segredo: needs secrecy language + revelation context
  const secretWords = ["segredo", "escondido", "ninguém sabe", "ninguém conta", "oculto", "por trás"];
  const secretCount = secretWords.filter(w => t.includes(w)).length;
  if (secretCount >= 2) scores.segredo = 60 + secretCount * 10;
  else if (secretCount === 1 && t.length > 30) scores.segredo = 35;
  
  // Alerta: warning language with intensity
  const alertWords = ["cuidado", "perigo", "atenção", "aviso", "alerta", "tome cuidado"];
  const alertCount = alertWords.filter(w => t.includes(w)).length;
  if (alertCount >= 2) scores.alerta = 55 + alertCount * 10;
  else if (alertCount === 1 && t.includes("!")) scores.alerta = 40;
  
  // Erro: problem/mistake language
  const errorWords = ["erro", "falha", "problema", "errado", "equívoco", "engano"];
  const errorCount = errorWords.filter(w => t.includes(w)).length;
  if (errorCount >= 2) scores.erro = 50 + errorCount * 15;
  else if (errorCount === 1 && sentences.length > 1) scores.erro = 35;
  
  // Promessa: needs commitment language + future action
  const promiseWords = ["prometo", "garanto", "vai mudar", "vai descobrir", "vou mostrar", "vai aprender"];
  const promiseCount = promiseWords.filter(w => t.includes(w)).length;
  if (promiseCount >= 1) scores.promessa = 45 + promiseCount * 15;
  
  // Descoberta: revelation + evidence
  const discoveryWords = ["descobriu", "revelou", "encontrou", "descobriram", "revelação", "encontraram"];
  const discoveryCount = discoveryWords.filter(w => t.includes(w)).length;
  if (discoveryCount >= 1) scores.descoberta = 45 + discoveryCount * 15;
  
  // Select highest scoring pattern
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0 && sorted[0][1] >= 35) {
    return { pattern: sorted[0][0], confidence: Math.min(95, sorted[0][1]) };
  }
  
  return { pattern: "afirmacao", confidence: 50 };
}

function detectTone(text: string, triggers: string[], phrasePattern: string): { tone: string; confidence: number } {
  const t = text.toLowerCase();
  const sentences = t.split(/[.!?]+/).filter(s => s.trim().length > 0);
  
  const toneScores: Record<string, number> = {};
  
  // Chocante: needs multiple shock indicators, not just trigger words
  const shockWords = ["chocante", "inacreditável", "impossível", "absurdo", "horrível", "terrível"];
  const shockCount = shockWords.filter(w => t.includes(w)).length;
  if (shockCount >= 2 || (shockCount >= 1 && triggers.length >= 3)) {
    toneScores.chocante = 40 + shockCount * 15 + triggers.length * 5;
  }
  
  // Urgente: needs urgency + imperative/action
  const urgencyWords = ["agora", "rápido", "corre", "imediatamente", "já", "antes que"];
  const urgencyCount = urgencyWords.filter(w => t.includes(w)).length;
  const hasImperative = t.includes("!") || t.includes("faça") || t.includes("pare");
  if (urgencyCount >= 2 || (urgencyCount >= 1 && hasImperative)) {
    toneScores.urgente = 40 + urgencyCount * 15;
  }
  
  // Misterioso: needs mystery atmosphere, not just one word
  const mysteryWords = ["mistério", "misterioso", "enigma", "segredo", "inexplicável", "estranho", "desconhecido"];
  const mysteryCount = mysteryWords.filter(w => t.includes(w)).length;
  if (mysteryCount >= 2 || (mysteryCount >= 1 && phrasePattern === "segredo")) {
    toneScores.misterioso = 40 + mysteryCount * 15;
  }
  
  // Emocional: needs emotional language + intensity
  const emotionalWords = ["triste", "emocionante", "chorar", "coração", "dor", "amor", "lágrimas", "saudade"];
  const emotionalCount = emotionalWords.filter(w => t.includes(w)).length;
  if (emotionalCount >= 2) {
    toneScores.emocional = 45 + emotionalCount * 10;
  } else if (emotionalCount === 1 && sentences.length > 1) {
    toneScores.emocional = 30;
  }
  
  // Técnico: needs technical vocabulary density
  const techWords = ["técnica", "ciência", "estudo", "pesquisa", "dados", "análise", "método", "processo"];
  const techCount = techWords.filter(w => t.includes(w)).length;
  if (techCount >= 2) {
    toneScores.tecnico = 45 + techCount * 10;
  }
  
  const sorted = Object.entries(toneScores).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0 && sorted[0][1] >= 35) {
    return { tone: sorted[0][0], confidence: Math.min(90, sorted[0][1]) };
  }
  
  return { tone: "neutro", confidence: 60 };
}

function findTriggers(text: string): string[] {
  const words = text.toLowerCase().split(/\s+/);
  return TRIGGER_WORDS_STRONG.filter(tw => words.some(w => w.includes(tw)));
}

function countSentences(text: string): number {
  return Math.max(1, (text.match(/[.!?]+/g) || []).length);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const { video_id } = await req.json();
    if (!video_id) return new Response(JSON.stringify({ error: "video_id required" }), { status: 400, headers: corsHeaders });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: blocks } = await supabase
      .from("video_blocks")
      .select("id, video_id, tipo_bloco, texto, tempo_inicio, tempo_fim")
      .eq("video_id", video_id)
      .order("bloco_id");

    if (!blocks?.length) {
      return new Response(JSON.stringify({ error: "No blocks found", count: 0 }), { headers: corsHeaders });
    }

    // Delete existing
    await supabase.from("block_verbal_analysis").delete().eq("video_id", video_id);

    const results = [];
    for (const block of blocks) {
      const text = block.texto || "";
      if (!text.trim()) continue;

      const duration = Math.max(0.1, Number(block.tempo_fim) - Number(block.tempo_inicio));
      const words = text.split(/\s+/).filter(Boolean);
      const wordCount = words.length;
      const sentenceCount = countSentences(text);
      const triggers = findTriggers(text);
      
      const { pattern: phrasePattern, confidence: patternConf } = detectPhrasePattern(text);
      const { tone, confidence: toneConf } = detectTone(text, triggers, phrasePattern);
      
      const linguisticDensity = +(wordCount / duration).toFixed(4);
      const avgSentenceLen = +(wordCount / sentenceCount).toFixed(2);
      
      // Recalibrated emotional intensity:
      // Trigger words contribute less alone; pattern and tone matter more
      const triggerContribution = Math.min(30, triggers.length * 8);
      const patternContribution = phrasePattern !== "afirmacao" ? 15 : 0;
      const toneContribution = tone !== "neutro" ? 12 : 0;
      // Require compound evidence for high intensity
      const emotionalIntensity = Math.min(95, triggerContribution + patternContribution + toneContribution + 
        (triggers.length > 0 && phrasePattern !== "afirmacao" ? 15 : 0));
      
      // Recalibrated semantic pressure: needs compound signals
      let pressureBase = 0;
      if (triggers.length > 0) pressureBase += Math.min(25, triggers.length * 7);
      if (phrasePattern === "promessa") pressureBase += 15;
      if (phrasePattern === "segredo") pressureBase += 12;
      if (phrasePattern === "alerta") pressureBase += 10;
      if (tone === "urgente") pressureBase += 12;
      if (tone === "chocante") pressureBase += 15;
      // Diminish if only single signal
      const signalCount = (triggers.length > 0 ? 1 : 0) + (phrasePattern !== "afirmacao" ? 1 : 0) + (tone !== "neutro" ? 1 : 0);
      const pressureMultiplier = signalCount >= 3 ? 1.2 : signalCount === 2 ? 1.0 : 0.6;
      const semanticPressure = +(pressureBase * pressureMultiplier).toFixed(2);
      
      // Confidence: compound of word count, pattern confidence, tone confidence
      const baseConfidence = wordCount > 20 ? 70 : wordCount > 10 ? 55 : wordCount > 5 ? 40 : 25;
      const confidence = Math.min(95, Math.round((baseConfidence + patternConf + toneConf) / 3));

      results.push({
        video_id,
        block_id: block.id,
        full_text: text,
        word_count: wordCount,
        phrase_count: sentenceCount,
        phrase_pattern: phrasePattern,
        tone,
        trigger_words: triggers,
        linguistic_density: linguisticDensity,
        emotional_intensity: emotionalIntensity,
        syntactic_complexity: avgSentenceLen,
        semantic_pressure_score: semanticPressure,
        confidence_score: confidence,
        data_source_type: "ai_extraction",
        origin_level: "calculated",
      });
    }

    if (results.length) {
      await supabase.from("block_verbal_analysis").insert(results);
    }

    // Log
    await supabase.from("extraction_logs").insert({
      video_id,
      extraction_step: "extract_verbal_dna",
      field_name: "block_verbal_analysis",
      extracted_value: JSON.stringify({ 
        count: results.length,
        avg_intensity: results.length ? Math.round(results.reduce((s, r) => s + r.emotional_intensity, 0) / results.length) : 0,
        avg_pressure: results.length ? +(results.reduce((s, r) => s + r.semantic_pressure_score, 0) / results.length).toFixed(2) : 0,
      }),
      confidence_score: results.length ? Math.round(results.reduce((s, r) => s + r.confidence_score, 0) / results.length) : 0,
      source_type: "ai_extraction",
      origin_level: "calculated",
    });

    return new Response(JSON.stringify({ success: true, count: results.length }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
