import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import { authorizeLibraryAdminOrServiceRequest } from "../_shared/edge-auth.ts";
import { geminiOpenAIChat, hasGeminiApiKeys } from "../_shared/gemini-rotation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── CONFIG ──────────────────────────────────────────────────────────
const DEFAULT_MODEL = "gemini-3.5-flash";
const BATCH_SIZE = 20;
const MAX_RETRIES = 2;

// ── FUNCTIONAL UNIT VALIDATION ──────────────────────────────────────
// Minimum requirements for a candidate to be considered a real narrative unit
const STOPWORDS = new Set([
  "a", "o", "os", "as", "um", "uma", "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas",
  "por", "para", "pra", "com", "sem", "que", "se", "e", "ou", "mas", "isso", "eu", "tu", "ele", "ela",
  "me", "te", "lhe", "my", "your", "you", "he", "she", "it", "we", "they", "the", "an", "of", "to",
  "in", "on", "at", "for", "with", "from", "by", "and", "or", "but", "if", "then", "so", "is", "are",
  "was", "were", "be", "been", "am", "do", "did", "does", "have", "has", "had", "i", "this", "that",
]);

const FILLER_PATTERNS = [
  /^(uh|um|ah|oh|hmm|hm|eh|er|like|well|right|ok|okay|yeah|yes|no|sure|anyway|so+)\s*$/i,
  /^(tipo|né|sabe|tá|aí|hein|ahn|bom|então|pois)\s*$/i,
];

// ── NARRATIVE ACTION/EMOTION WORD LISTS ─────────────────────────────
const ACTION_WORDS = new Set([
  "olha", "veja", "vê", "assiste", "escuta", "espera", "pare", "descobre", "descubra", "entenda",
  "clica", "clique", "inscreve", "inscreva", "segue", "siga", "compra", "compre", "corre", "corra",
  "watch", "look", "wait", "stop", "click", "buy", "follow", "subscribe", "listen", "see", "check",
  "imagine", "believe", "try", "run", "grab", "go", "come", "take", "make", "give",
  "faz", "faça", "tenta", "pega", "vai", "vem", "toma", "dá",
]);

const EMOTION_WORDS = new Set([
  "coragem", "segredo", "ninguém", "ninguem", "nunca", "jamais", "agora", "alerta", "cuidado",
  "perigo", "choque", "surpresa", "absurdo", "proibido", "erro", "verdade", "mentira", "revelação",
  "revelacao", "incrível", "inacreditável", "impossível", "chocante", "assustador", "loucura",
  "believe", "crazy", "secret", "danger", "warning", "never", "nobody", "shocking", "insane",
  "unbelievable", "impossible", "incredible", "terrifying", "amazing", "mind-blowing",
]);

const CURIOSITY_WORDS = new Set([
  "see", "wait", "guess", "imagine", "wonder", "happens", "happened",
  "veja", "espera", "adivinha", "imagina", "acontece", "aconteceu",
]);

const TENSION_WORDS = new Set([
  "suddenly", "unexpected", "out of nowhere", "careful", "danger", "warning", "don't",
  "de repente", "inesperado", "do nada", "cuidado", "perigo", "alerta", "não",
]);

const PROMISE_CONSEQUENCE_PATTERNS = [
  /\b(mudou|changed|transformou|transformed|descobri[ur]?|revealed|happened)\b/i,
  /\b(resultado|result|segredo|secret|verdade|truth)\b/i,
  /\b(por isso|that's why|é por isso|foi aí|that's when|foi quando)\b/i,
  /\b(antes de|before|depois de|after|até o final|until the end)\b/i,
  /\b(nunca mais|never again|jamais|tudo mudou|everything changed)\b/i,
];

const VIEWER_DIRECTED_PATTERNS = [
  /\b(you|your|you'll|you're|você|voce|tu |te |seu |sua )\b/i,
  /\b(olha|veja|espera|watch|look|wait|check|listen|imagine|guess)\b/i,
  /\b(inscreva|subscribe|siga|follow|clique|click|compre|buy)\b/i,
  /\b(não pule|don't skip|até o final|wait until|antes que)\b/i,
];

const PURELY_DESCRIPTIVE_PATTERNS = [
  /^(eu |i |ele |ela |he |she |they |eles |elas |nós |we )(peguei|comprei|abri|sentei|olhei|andei|comi|bebi|coloquei|tirei|levantei|entrei|saí|cheguei|voltei|fui |bought|grabbed|opened|sat|looked|walked|ate|drank|put|took|stood|entered|left|arrived|went)\b/i,
  /^(estava|estavam|was|were) (sentad|deitad|parad|olhand|andand|sitting|lying|standing|looking|walking)/i,
];

function hasWordFromSet(text: string, wordSet: Set<string>): boolean {
  const lower = text.toLowerCase();
  for (const w of wordSet) {
    if (lower.includes(w)) return true;
  }
  return false;
}

function isRealNarrativeUnit(text: string): { valid: boolean; reason: string } {
  if (!text || typeof text !== "string") return { valid: false, reason: "empty_text" };

  const trimmed = text.trim();
  if (trimmed.length < 6) return { valid: false, reason: "too_short" };

  const words = trimmed.split(/\s+/);
  if (words.length < 2) return { valid: false, reason: "single_word" };

  // Reject pure fillers
  if (FILLER_PATTERNS.some(p => p.test(trimmed))) return { valid: false, reason: "filler_only" };

  // Must have at least 1 meaningful word (non-stopword, 3+ chars)
  const meaningful = words.filter(w => !STOPWORDS.has(w.toLowerCase()) && w.length >= 3);
  if (meaningful.length < 1) return { valid: false, reason: "no_meaningful_words" };

  // Must have verb-like or action-like content (heuristic: at least one word with 4+ chars)
  const hasSubstantiveWord = words.some(w => w.length >= 4 && !STOPWORDS.has(w.toLowerCase()));
  if (!hasSubstantiveWord) return { valid: false, reason: "no_substantive_content" };

  // Reject if ALL words are just pronouns/articles/prepositions
  const contentRatio = meaningful.length / words.length;
  if (contentRatio < 0.2 && words.length > 3) return { valid: false, reason: "content_ratio_too_low" };

  return { valid: true, reason: "ok" };
}

// ── NARRATIVE FUNCTIONAL UNIT FILTER ────────────────────────────────
// Second filter: checks if the phrase has NARRATIVE POTENTIAL, not just linguistic validity.
// Uses both textual signals (words) and external signals (alignment, micro-events, etc.)
interface ExternalSignals {
  alignment_score: number;
  has_micro_event: boolean;
  rhythm_level: string | null;
  has_cta_signal: boolean;
}

function isNarrativeFunctionalUnit(
  text: string,
  signals: ExternalSignals
): { valid: boolean; reason: string } {
  const lower = text.toLowerCase().trim();

  // ── CRITERION 3: Reject purely descriptive without tension ──
  if (PURELY_DESCRIPTIVE_PATTERNS.some(p => p.test(lower))) {
    // Even descriptive phrases pass if they have external signal confirmation
    if (signals.alignment_score >= 55 || signals.has_micro_event || signals.has_cta_signal) {
      // External signal overrides descriptive rejection
    } else {
      return { valid: false, reason: "purely_descriptive_no_tension" };
    }
  }

  // ── CRITERION 1: Internal textual narrative signals ──
  const hasAction = hasWordFromSet(lower, ACTION_WORDS);
  const hasEmotion = hasWordFromSet(lower, EMOTION_WORDS);
  const hasCuriosity = hasWordFromSet(lower, CURIOSITY_WORDS);
  const hasTension = hasWordFromSet(lower, TENSION_WORDS);
  const hasPromise = PROMISE_CONSEQUENCE_PATTERNS.some(p => p.test(lower));
  const hasViewerDirection = VIEWER_DIRECTED_PATTERNS.some(p => p.test(lower));

  const hasTextualSignal = hasAction || hasEmotion || hasCuriosity || hasTension || hasPromise || hasViewerDirection;

  if (hasTextualSignal) return { valid: true, reason: "textual_narrative_signal" };

  // ── CRITERION 2: External signal confirmation ──
  if (signals.alignment_score >= 55) return { valid: true, reason: "high_alignment" };
  if (signals.has_micro_event) return { valid: true, reason: "micro_event_confirmed" };
  if (signals.rhythm_level === "high" || signals.rhythm_level === "explosive") return { valid: true, reason: "high_rhythm" };
  if (signals.has_cta_signal) return { valid: true, reason: "cta_signal_confirmed" };

  return { valid: false, reason: "no_narrative_potential" };
}

// ── SYSTEM PROMPT (with anti-anchoring instruction) ─────────────────
const SYSTEM_PROMPT = `You are a Narrative Judge for viral video analysis.

You receive pre-filtered verbal combinations with ENRICHED CONTEXT from multiple analytical modules.
Your job: use the provided signals to make a FINAL classification. Do NOT re-analyze what has already been computed.

Each candidate includes pre-computed signals:
- block_type, position_in_video (start/middle/end)
- verbal signals: tone, emotional_intensity, phrase_pattern
- visual signals: alignment_score, has_micro_event, micro_event_strength
- temporal signals: rhythm_level, tempo_pattern
- cta signals: has_cta_signal, cta_type
- computed scores: approval_score, semantic_coherence, emotional_score

IMPORTANT — ANTI-ANCHORING RULE:
The field "current_function_guess" is ONLY a preliminary suggestion from an earlier heuristic stage.
It is NOT a confirmed classification. You MUST evaluate independently.
You are FREE to disagree and assign a completely different narrative_function.
Do NOT anchor on the guess. Judge the text + signals on their own merit.

USE the pre-computed signals as evidence. Do not contradict them unless clearly wrong.

For EACH candidate, return a JSON object:
- is_valid: boolean
- narrative_function: HOOK | SETUP | BUILD | MICRO_PEAK | TWIST | PAYOFF | CTA | ACTION
- emotional_intent: string (e.g. "curiosidade", "urgência", "surpresa", "medo", "empatia")
- viewer_directed: boolean
- replicable_for_dna: boolean — true if this phrase pattern could work in other videos
- confidence: integer 0-100
- short_reason: max 20 words

═══════════════════════════════════════════════════
CRITICAL — ACTION IS NOT A FALLBACK CLASS
═══════════════════════════════════════════════════

Do NOT use ACTION as a catch-all or fallback category.

If a phrase is ANY of the following, set is_valid = false (NOT ACTION):
- A fragment or broken n-gram (e.g. "came front i ve seen", "know with ishida asato")
- A generic observation without narrative tension
- A purely descriptive/functional statement without dramatic arc (e.g. "buttons change the sets of stops")
- A phrase too neutral or vague to be reusable in viral DNA
- An incomplete thought or truncated sentence
- A phrase with no emotional, dramatic, or structural value

ACTION can ONLY be used when ALL of these are true:
1. The phrase is semantically complete (full coherent thought)
2. It describes a clear, specific action with narrative consequence
3. It represents real narrative progression (movement that advances the story)
4. It has reusable value for viral DNA (the pattern could work in other videos)

Examples that MUST be is_valid = false (NOT ACTION):
- "came front i ve seen" → fragment, invalid
- "know with ishida asato" → incoherent, invalid
- "one corresponds to a different" → generic description, invalid
- "buttons change the sets of stops" → functional description, no narrative value, invalid
- "honestly i don t know who" → incomplete thought, invalid

═══════════════════════════════════════════════════
FUNCTION CLASSIFICATION GUIDELINES
═══════════════════════════════════════════════════

TWIST should include:
- Explicit shock lines AND implicit expectation breaks
- Phrases where the narrative direction changes unexpectedly
- Moments of revelation that contradict prior setup
- Examples: "business trip and never returned", "why are you following me"

BUILD should include:
- Tension accumulation and suspense development
- Suspicious or ominous narrative progression before payoff
- Rising stakes, escalating conflict, growing uncertainty
- Examples: "take away their butter now", "started noticing something strange"

PAYOFF should include:
- Emotional resolution and consequence landing
- Reveal completion (the answer to a setup question)
- Dramatic outcome or result delivery
- Examples: "looks at me and says lucy", "that's when everything changed"

═══════════════════════════════════════════════════
CRITICAL — POSITIONAL CONTEXT FOR CLASSIFICATION
═══════════════════════════════════════════════════

Each candidate includes "relative_position_pct" (0-100, where in the video timeline it appears)
and "original_block_type" (the structural block type from narrative segmentation: gancho, desenvolvimento, revelacao, tensao, payoff, etc.)

USE THESE SIGNALS for accurate classification:

1. A phrase at relative_position_pct > 60% with original_block_type = "revelacao" or "payoff"
   is MUCH more likely to be TWIST or PAYOFF than BUILD or SETUP.
   Do NOT classify late-video resolution moments as BUILD.

2. A phrase at relative_position_pct < 25% is more likely HOOK or SETUP.

3. original_block_type provides structural context:
   - "gancho" → favors HOOK
   - "desenvolvimento" → favors BUILD or SETUP
   - "tensao" → favors BUILD or TWIST
   - "revelacao" → favors TWIST or PAYOFF
   - "payoff" → strongly favors PAYOFF
   - "cta" → favors CTA

4. When text + position + block_type all align toward TWIST/PAYOFF,
   classify as TWIST/PAYOFF even if the text alone seems like BUILD.

 SETUP should include:
- Context establishment and scene-setting
- Introduction of characters, situations, or stakes
- Framing that creates conditions for later tension

HOOK should include:
- Immediate curiosity generators
- Mental loop openers that demand continuation
- Strong first-impression phrases

CTA should include:
- Direct viewer imperatives (subscribe, follow, click, etc.)
- Calls to external action

═══════════════════════════════════════════════════
MICRO_PEAK — EXPANDED DETECTION CRITERIA
═══════════════════════════════════════════════════

MICRO_PEAK is NOT a climax or major revelation. It is NOT a TWIST.
MICRO_PEAK is any verbal moment that momentarily spikes viewer attention.
It creates a small rupture, acceleration, or curiosity bump in the narrative flow.

Classify as MICRO_PEAK if the phrase meets ANY of these:
1. Contains intensifiers or attention markers: wait, look, listen, bro, no way, guess, suddenly, oh my god, hold on, yo, damn, whoa, seriously, literally, actually, right now, check this
2. Indicates an immediate state change: "and then", "out of nowhere", "suddenly", "all of a sudden", "next thing I know", "that's when"
3. Provokes instant micro-reaction: curiosity spike, mild shock, anticipation, disbelief
4. Interrupts or accelerates narrative rhythm: short punchy phrases that break the pacing

MICRO_PEAK does NOT require:
- High emotional charge (low-to-medium is fine)
- Resolution or consequence (that's PAYOFF)
- Strong expectation break (that's TWIST)
- Full dramatic arc

MICRO_PEAK vs other functions:
- MICRO_PEAK vs TWIST: TWIST changes the narrative direction; MICRO_PEAK just spikes attention momentarily
- MICRO_PEAK vs BUILD: BUILD accumulates tension gradually; MICRO_PEAK is a sharp momentary bump
- MICRO_PEAK vs PAYOFF: PAYOFF resolves something; MICRO_PEAK is an unreolved attention spike

Examples of valid MICRO_PEAK:
- "wait wait wait" → attention lock
- "and then this happened" → state change marker
- "bro look at this" → viewer attention spike
- "guess what she said" → micro-curiosity
- "no way that's real" → disbelief spike
- "hold on hold on" → rhythm interruption
- "out of nowhere" → sudden state shift

Other decision rules:
- High alignment_score + micro_event → likely valid, boost confidence
- CTA signal confirmed → classify as CTA unless text contradicts
- High rhythm/tempo signal → likely TWIST or MICRO_PEAK
- Fillers, pleasantries, fragments → invalid
- Replicable means the PATTERN (not exact words) could work in similar videos
- The current_function_guess may be WRONG — override it if evidence suggests otherwise

Return ONLY a JSON array. No markdown outside the array.`;

// ── MAIN ────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authFailure = await authorizeLibraryAdminOrServiceRequest(req, corsHeaders);
  if (authFailure) return authFailure;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const videoId = typeof body?.video_id === "string" ? body.video_id : null;
    const limit = Math.min(Number(body?.limit) || 300, 600);
    const dryRun = body?.dry_run === true;
    const model = typeof body?.model === "string" ? body.model : DEFAULT_MODEL;
    // Optional: filter by a single narrative function to avoid timeouts
    const singleFunction = typeof body?.function === "string" ? body.function.toUpperCase().trim() : null;

    if (!hasGeminiApiKeys()) return jsonError("GEMINI_API_KEY not configured", 503);

    // ── STEP 1: CANDIDATE SELECTION ──
    const FUNCTION_QUOTAS: Record<string, number> = {
      HOOK: 60, SETUP: 60, BUILD: 60, MICRO_PEAK: 60,
      TWIST: 60, PAYOFF: 60, CTA: 40, ACTION: 15,
    };

    // When a single function is requested, only query that function
    const targetFunctions = singleFunction
      ? (FUNCTION_QUOTAS[singleFunction] ? [singleFunction] : Object.keys(FUNCTION_QUOTAS))
      : Object.keys(FUNCTION_QUOTAS);

    // Read candidates per function in parallel
    const functionQueries = targetFunctions.map(fn => {
      let q = supabase
        .from("viral_word_combinations")
        .select("id, video_id, block_id, combination_text, block_type, dominant_function, emotional_intent, approval_score, semantic_coherence_score, emotional_score, linked_micro_event, linked_temporal_signal, linked_visual_signal, videos!inner(approved_for_global)")
        .eq("dominant_function", fn)
        .order("approval_score", { ascending: false })
        .limit(singleFunction ? limit : FUNCTION_QUOTAS[fn]);
      if (videoId) q = q.eq("video_id", videoId);
      else q = q.eq("videos.approved_for_global", true);
      return q;
    });

    const functionResults = await Promise.all(functionQueries);
    
    // Merge all candidates, deduplicate by id
    const candidateMap = new Map<string, any>();
    const candidatesByFunction: Record<string, number> = {};
    for (let i = 0; i < targetFunctions.length; i++) {
      const fn = targetFunctions[i];
      const res = functionResults[i];
      if (res.error) throw res.error;
      const items = res.data || [];
      candidatesByFunction[fn] = items.length;
      for (const item of items) {
        candidateMap.set(item.id, item);
      }
    }
    
    const candidates = [...candidateMap.values()];
    
    if (!candidates.length) {
      return jsonResponse({ 
        status: "no_candidates", total_candidates: 0, 
        single_function_filter: singleFunction,
        candidates_by_function: candidatesByFunction,
        judged: 0, valid: 0, invalid: 0, by_function: {} 
      });
    }

    // ── STEP 1.5: FUNCTIONAL UNIT PRE-FILTER ──
    // Validate that each candidate is a real narrative phrase, not a fragment or n-gram noise.
    // This catches anything that slipped through extract-viral-combinations but isn't
    // a functional sentence/phrase suitable for narrative classification.
    const validCandidates: typeof candidates = [];
    const rejectedAsNonUnit: Array<{ text: string; reason: string }> = [];

    for (const c of candidates) {
      const check = isRealNarrativeUnit(c.combination_text);
      if (check.valid) {
        validCandidates.push(c);
      } else {
        rejectedAsNonUnit.push({ text: c.combination_text, reason: check.reason });
      }
    }

    if (!validCandidates.length) {
      return jsonResponse({
        status: "all_rejected_pre_filter",
        total_candidates: candidates.length,
        rejected_as_non_unit: rejectedAsNonUnit.length,
        rejection_samples: rejectedAsNonUnit.slice(0, 10),
        judged: 0, valid: 0, invalid: 0, by_function: {},
      });
    }

    // ── STEP 2: READ pre-computed signals from existing modules (NO recalculation) ──
    const blockIds = [...new Set(validCandidates.map((c: any) => c.block_id).filter(Boolean))];
    const videoIds = [...new Set(validCandidates.map((c: any) => c.video_id))];

    // Parallel reads from 5 existing analytical tables
    const [verbalRes, microRes, temporalRes, alignmentRes, ctaRes] = await Promise.all([
      blockIds.length > 0
        ? supabase.from("block_verbal_analysis").select("block_id, tone, emotional_intensity, phrase_pattern, linguistic_density").in("block_id", blockIds)
        : Promise.resolve({ data: [], error: null }),
      blockIds.length > 0
        ? supabase.from("video_micro_events").select("block_id, event_strength, event_type").in("block_id", blockIds)
        : Promise.resolve({ data: [], error: null }),
      blockIds.length > 0
        ? supabase.from("video_temporal_profile").select("block_id, rhythm_level, tempo_pattern").in("block_id", blockIds)
        : Promise.resolve({ data: [], error: null }),
      blockIds.length > 0
        ? supabase.from("text_visual_alignment").select("block_id, alignment_score, text_emotion, visual_emotion").in("block_id", blockIds)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("cta_deep_analysis").select("video_id, cta_type, cta_tone, cta_intensity, implicit_cta_detected").in("video_id", videoIds),
    ]);

    // Also read block positions from video_blocks
    const blocksRes = blockIds.length > 0
      ? await supabase.from("video_blocks").select("id, tempo_inicio, tempo_fim, funcao_narrativa, tipo_bloco").in("id", blockIds)
      : { data: [], error: null };

    // Read video durations for position calculation
    const videosRes = await supabase.from("videos").select("id, duracao").in("id", videoIds);

    // ── STEP 3: Build signal lookup maps (pure reads, zero computation) ──
    const verbalMap = new Map<string, { tone: string | null; emotional_intensity: number; phrase_pattern: string | null; linguistic_density: number }>();
    for (const v of (verbalRes.data || [])) {
      verbalMap.set(v.block_id, {
        tone: v.tone, emotional_intensity: Number(v.emotional_intensity || 0),
        phrase_pattern: v.phrase_pattern, linguistic_density: Number(v.linguistic_density || 0),
      });
    }

    const microMap = new Map<string, { strength: number; type: string }>();
    for (const m of (microRes.data || [])) {
      const existing = microMap.get(m.block_id);
      const strength = Number(m.event_strength || 0);
      if (!existing || strength > existing.strength) {
        microMap.set(m.block_id, { strength, type: m.event_type });
      }
    }

    const temporalMap = new Map<string, { rhythm: string; pattern: string }>();
    for (const t of (temporalRes.data || [])) {
      temporalMap.set(t.block_id, { rhythm: t.rhythm_level, pattern: t.tempo_pattern });
    }

    const alignMap = new Map<string, { score: number; textEmo: string | null; visualEmo: string | null }>();
    for (const a of (alignmentRes.data || [])) {
      alignMap.set(a.block_id, { score: Number(a.alignment_score || 0), textEmo: a.text_emotion, visualEmo: a.visual_emotion });
    }

    const ctaMap = new Map<string, { type: string; tone: string; intensity: number; implicit: boolean }>();
    for (const c of (ctaRes.data || [])) {
      ctaMap.set(c.video_id, {
        type: c.cta_type || "", tone: c.cta_tone || "",
        intensity: Number(c.cta_intensity || 0), implicit: Boolean(c.implicit_cta_detected),
      });
    }

    const blockPosMap = new Map<string, { start: number; end: number; func: string | null; tipo: string | null }>();
    for (const b of (blocksRes.data || [])) {
      blockPosMap.set(b.id, { start: Number(b.tempo_inicio), end: Number(b.tempo_fim), func: b.funcao_narrativa, tipo: b.tipo_bloco });
    }

    const videoDurMap = new Map<string, number>();
    for (const v of (videosRes.data || [])) {
      videoDurMap.set(v.id, Number(v.duracao || 60));
    }

    // ── STEP 3.5: NARRATIVE FUNCTIONAL UNIT FILTER ──
    // Second pre-filter: checks narrative potential using text + external signals.
    // Removes purely descriptive phrases without tension before sending to AI.
    const functionalCandidates: typeof validCandidates = [];
    const rejectedAsNonFunctional: Array<{ text: string; reason: string }> = [];

    for (const c of validCandidates) {
      const blockId = c.block_id;
      const align = blockId ? alignMap.get(blockId) : null;
      const micro = blockId ? microMap.get(blockId) : null;
      const temporal = blockId ? temporalMap.get(blockId) : null;
      const cta = ctaMap.get(c.video_id);

      const check = isNarrativeFunctionalUnit(c.combination_text, {
        alignment_score: align?.score || 0,
        has_micro_event: Boolean(micro),
        rhythm_level: temporal?.rhythm || null,
        has_cta_signal: Boolean(cta),
      });

      if (check.valid) {
        functionalCandidates.push(c);
      } else {
        rejectedAsNonFunctional.push({ text: c.combination_text, reason: check.reason });
      }
    }

    if (!functionalCandidates.length) {
      return jsonResponse({
        status: "all_rejected_functional_filter",
        total_candidates: candidates.length,
        rejected_as_non_unit: rejectedAsNonUnit.length,
        rejected_as_non_functional: rejectedAsNonFunctional.length,
        rejection_functional_samples: rejectedAsNonFunctional.slice(0, 10),
        judged: 0, valid: 0, invalid: 0, by_function: {},
      });
    }

    // ── STEP 4: Build enriched candidates (consolidated signals, minimal payload) ──
    // REFINEMENT 1: Use "current_function_guess" instead of "current_function"
    // to signal to the AI that this is a preliminary suggestion, not a confirmed label.
    const enrichedCandidates = (functionalCandidates as any[]).map((c, i) => {
      const blockId = c.block_id;
      const verbal = blockId ? verbalMap.get(blockId) : null;
      const micro = blockId ? microMap.get(blockId) : null;
      const temporal = blockId ? temporalMap.get(blockId) : null;
      const align = blockId ? alignMap.get(blockId) : null;
      const cta = ctaMap.get(c.video_id);
      const blockPos = blockId ? blockPosMap.get(blockId) : null;
      const duration = videoDurMap.get(c.video_id) || 60;

      // Position label and relative percentage
      let position = "middle";
      let relPosPct = 50;
      if (blockPos) {
        const relPos = blockPos.start / duration;
        relPosPct = Math.round(relPos * 100);
        if (relPos <= 0.15) position = "start";
        else if (relPos >= 0.75) position = "end";
      }

      return {
        index: i,
        text: c.combination_text,
        block_type: c.block_type,
        original_block_type: blockPos?.tipo || c.block_type,
        current_function_guess: c.dominant_function,
        position_in_video: position,
        relative_position_pct: relPosPct,
        // Pre-computed scores (READ from extract-viral-combinations)
        approval_score: Number(c.approval_score || 0),
        semantic_coherence: Number(c.semantic_coherence_score || 0),
        emotional_score: Number(c.emotional_score || 0),
        // Verbal signals (READ from block_verbal_analysis)
        verbal_tone: verbal?.tone || null,
        verbal_intensity: verbal?.emotional_intensity || 0,
        phrase_pattern: verbal?.phrase_pattern || null,
        // Visual/alignment signals (READ from text_visual_alignment)
        alignment_score: align?.score || 0,
        // Micro-event signals (READ from video_micro_events)
        has_micro_event: Boolean(micro),
        micro_event_strength: micro?.strength || 0,
        // Temporal signals (READ from video_temporal_profile)
        rhythm_level: temporal?.rhythm || null,
        tempo_pattern: temporal?.pattern || null,
        // CTA signals (READ from cta_deep_analysis)
        has_cta_signal: Boolean(cta),
        cta_type: cta?.type || null,
      };
    });

    // ── STEP 5: Send to AI in batches (ONLY classification, no analysis) ──
    const allResults: Array<{ candidate: any; result: JudgeResult }> = [];
    const batches = chunkArray(enrichedCandidates, BATCH_SIZE);
    let totalTokensUsed = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchPrompt = `Evaluate these ${batch.length} verbal combinations. Use the pre-computed signals as evidence.\nRemember: "current_function_guess" is JUST a guess — override it freely based on evidence.\n\nCandidates:\n${JSON.stringify(batch, null, 2)}\n\nReturn a JSON array with exactly ${batch.length} objects (one per candidate, same order).`;

      let parsed: JudgeResult[] | null = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await geminiOpenAIChat({
              model,
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: batchPrompt },
              ],
              temperature: 0.1,
              max_tokens: 4000,
          });

          if (!response.ok) {
            const errText = await response.text();
            console.error(`AI error (attempt ${attempt + 1}): ${response.status} - ${errText}`);
            if (attempt === MAX_RETRIES) throw new Error(`Gemini API failed: ${response.status}`);
            await sleep(1000 * (attempt + 1));
            continue;
          }

          const aiResponse = await response.json();
          totalTokensUsed += aiResponse.usage?.total_tokens || 0;
          const content = aiResponse.choices?.[0]?.message?.content || "";
          parsed = parseAIResponse(content, batch.length);
          if (parsed) break;

          console.warn(`Parse failed (attempt ${attempt + 1})`);
          if (attempt === MAX_RETRIES) console.error("Max retries, skipping batch", i);
        } catch (err) {
          if (attempt === MAX_RETRIES) console.error(`Batch ${i} failed:`, err);
          else await sleep(1000 * (attempt + 1));
        }
      }

      if (parsed) {
        for (let j = 0; j < batches[i].length && j < parsed.length; j++) {
          allResults.push({ candidate: functionalCandidates[i * BATCH_SIZE + j], result: parsed[j] });
        }
      }

      if (i < batches.length - 1) await sleep(500);
    }

    // ── STEP 6: Persist results ──
    const batchId = crypto.randomUUID();
    const judgeRows = allResults.map(({ candidate, result }) => ({
      video_id: candidate.video_id,
      block_id: candidate.block_id || null,
      candidate_text: candidate.combination_text,
      is_valid_narrative_unit: result.is_valid,
      narrative_function: result.narrative_function,
      emotional_intent: result.emotional_intent,
      viewer_directed: result.viewer_directed,
      replicable_for_dna: result.replicable_for_dna,
      confidence_score: Math.min(Math.max(result.confidence, 0), 100),
      short_reason: (result.short_reason || "").slice(0, 500),
      batch_id: batchId,
      model,
      provider: "gemini",
    }));

    if (!dryRun && judgeRows.length > 0) {
      // When filtering by single function, only delete results for THAT function
      // to preserve results from other function runs
      if (singleFunction) {
        const vids = [...new Set(judgeRows.map(r => r.video_id))];
        for (const vid of vids) {
          await supabase.from("narrative_judge_results")
            .delete()
            .eq("video_id", vid)
            .eq("narrative_function", singleFunction);
          // Also delete invalid results that came from this function's candidates
          // (they won't have narrative_function = singleFunction, so delete by batch approach)
        }
        // Delete previous invalid results for these videos from this function's candidate pool
        // by matching on candidate texts that were re-judged
        const rejudgedTexts = new Set(judgeRows.map(r => r.candidate_text));
        for (const vid of vids) {
          const { data: existing } = await supabase
            .from("narrative_judge_results")
            .select("id, candidate_text")
            .eq("video_id", vid);
          if (existing) {
            const toDelete = existing.filter(e => rejudgedTexts.has(e.candidate_text)).map(e => e.id);
            if (toDelete.length > 0) {
              await supabase.from("narrative_judge_results").delete().in("id", toDelete);
            }
          }
        }
      } else if (videoId) {
        await supabase.from("narrative_judge_results").delete().eq("video_id", videoId);
      } else {
        const vids = [...new Set(judgeRows.map(r => r.video_id))];
        for (const vid of vids) {
          await supabase.from("narrative_judge_results").delete().eq("video_id", vid);
        }
      }

      for (let i = 0; i < judgeRows.length; i += 200) {
        const chunk = judgeRows.slice(i, i + 200);
        const { error } = await supabase.from("narrative_judge_results").insert(chunk);
        if (error) throw error;
      }
    }

    // ── Stats ──
    const valid = allResults.filter(r => r.result.is_valid);
    const invalid = allResults.filter(r => !r.result.is_valid);
    const byFunction: Record<string, number> = {};
    for (const r of valid) {
      const fn = r.result.narrative_function || "BUILD";
      byFunction[fn] = (byFunction[fn] || 0) + 1;
    }

    const replicable = valid.filter(r => r.result.replicable_for_dna).length;

    return jsonResponse({
      status: "completed",
      architecture: "read_consolidate_judge",
      batch_id: batchId,
      model,
      dry_run: dryRun,
      single_function_filter: singleFunction,
      // Candidate origin traceability
      candidate_origin: {
        source_table: "viral_word_combinations",
        produced_by: "extract-viral-combinations edge function",
        text_source: "video_blocks.texto (block transcription text)",
        extraction_method: "n-grams (2-6 words) + clause spans from splitClauses()",
        pre_filters_applied: [
          "blocklist (common fillers/pleasantries)",
          "stopword-only rejection",
          "contraction fragment rejection",
          "semantic completeness (auxiliary-only, weak verb without object)",
          "emotional signal check",
          "quota-based selection by narrative function",
          "semantic deduplication",
        ],
        unit_definition: "Each candidate is a 2-6 word n-gram OR a full clause (2-8 words) extracted from block text, surviving hard-reject + scoring + quota selection",
      },
      // Pre-filter stats — AUDIT: shows where each function dies
      total_raw_candidates: candidates.length,
      candidates_by_function_input: candidatesByFunction,
      rejected_as_non_unit: rejectedAsNonUnit.length,
      rejection_unit_samples: rejectedAsNonUnit.slice(0, 5),
      passed_unit_filter: validCandidates.length,
      rejected_as_non_functional: rejectedAsNonFunctional.length,
      rejection_functional_samples: rejectedAsNonFunctional.slice(0, 5),
      candidates_sent_to_ai: functionalCandidates.length,
      // AUDIT: survival by function at each stage
      survival_by_function: buildSurvivalAudit(candidates, validCandidates, functionalCandidates, allResults),
      // AI results
      judged: allResults.length,
      valid: valid.length,
      invalid: invalid.length,
      replicable_for_dna: replicable,
      avg_confidence: allResults.length > 0
        ? Math.round(allResults.reduce((s, r) => s + r.result.confidence, 0) / allResults.length)
        : 0,
      tokens_used: totalTokensUsed,
      estimated_cost_usd: Number(((totalTokensUsed * 0.15) / 1_000_000 + (totalTokensUsed * 0.3 * 0.60) / 1_000_000).toFixed(6)),
      signals_read: {
        block_verbal_analysis: verbalMap.size,
        video_micro_events: microMap.size,
        video_temporal_profile: temporalMap.size,
        text_visual_alignment: alignMap.size,
        cta_deep_analysis: ctaMap.size,
        video_blocks: blockPosMap.size,
      },
      signals_NOT_recalculated: [
        "frames", "alignment", "micro-events", "CTA deep",
        "temporal profile", "block semantics", "verbal analysis",
      ],
      by_function: byFunction,
      top_valid: valid
        .sort((a, b) => b.result.confidence - a.result.confidence)
        .slice(0, 15)
        .map(r => ({
          text: r.candidate.combination_text,
          function: r.result.narrative_function,
          intent: r.result.emotional_intent,
          viewer_directed: r.result.viewer_directed,
          replicable: r.result.replicable_for_dna,
          confidence: r.result.confidence,
          reason: r.result.short_reason,
        })),
    });
  } catch (error) {
    console.error("Fatal error in judge-narrative:", error);
    return jsonError(error instanceof Error ? error.message : "Unknown error", 500);
  }
});

// ── TYPES & HELPERS ─────────────────────────────────────────────────
interface JudgeResult {
  is_valid: boolean;
  narrative_function: string;
  emotional_intent: string;
  viewer_directed: boolean;
  replicable_for_dna: boolean;
  confidence: number;
  short_reason: string;
}

function parseAIResponse(content: string, expectedLength: number): JudgeResult[] | null {
  try {
    let jsonStr = content.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    const arrayStart = jsonStr.indexOf("[");
    const arrayEnd = jsonStr.lastIndexOf("]");
    if (arrayStart !== -1 && arrayEnd > arrayStart) jsonStr = jsonStr.slice(arrayStart, arrayEnd + 1);

    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return null;

    const results: JudgeResult[] = parsed.map((item: any) => ({
      is_valid: Boolean(item.is_valid),
      narrative_function: normalizeFunction(item.narrative_function),
      emotional_intent: String(item.emotional_intent || "impacto"),
      viewer_directed: Boolean(item.viewer_directed),
      replicable_for_dna: Boolean(item.replicable_for_dna ?? item.replicable ?? true),
      confidence: Math.min(Math.max(Number(item.confidence) || 0, 0), 100),
      short_reason: String(item.short_reason || "").slice(0, 200),
    }));

    if (results.length >= expectedLength * 0.8) return results;
    return null;
  } catch (err) {
    console.error("Failed to parse AI response:", err);
    return null;
  }
}

function normalizeFunction(fn: string | undefined): string {
  const valid = ["HOOK", "SETUP", "BUILD", "MICRO_PEAK", "TWIST", "PAYOFF", "CTA", "ACTION"];
  const upper = String(fn || "").toUpperCase().trim();
  return valid.includes(upper) ? upper : "BUILD";
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
  });
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}

function buildSurvivalAudit(
  raw: any[],
  afterUnit: any[],
  afterFunctional: any[],
  aiResults: Array<{ candidate: any; result: JudgeResult }>
): Record<string, { raw: number; after_unit_filter: number; after_functional_filter: number; sent_to_ai: number; ai_valid: number; ai_rejected: number }> {
  const functions = ["HOOK", "SETUP", "BUILD", "MICRO_PEAK", "TWIST", "PAYOFF", "CTA", "ACTION"];
  const audit: Record<string, any> = {};
  
  for (const fn of functions) {
    const rawCount = raw.filter(c => c.dominant_function === fn).length;
    const unitCount = afterUnit.filter(c => c.dominant_function === fn).length;
    const funcCount = afterFunctional.filter(c => c.dominant_function === fn).length;
    const validCount = aiResults.filter(r => r.candidate.dominant_function === fn && r.result.is_valid).length;
    const rejectedCount = aiResults.filter(r => r.candidate.dominant_function === fn && !r.result.is_valid).length;
    
    audit[fn] = {
      raw: rawCount,
      after_unit_filter: unitCount,
      after_functional_filter: funcCount,
      sent_to_ai: funcCount,
      ai_valid: validCount,
      ai_rejected: rejectedCount,
    };
  }
  
  return audit;
}
