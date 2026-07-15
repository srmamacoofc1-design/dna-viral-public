export type Segmento = 'meme' | 'curiosidade' | 'misterio' | 'terror' | 'historia_real' | 'narrativa_biblica';
export type EstiloVisual = 'filme' | '3d' | 'live_action' | 'animacao' | 'cgi' | 'stock_footage';
export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type TipoBloco = 'hook' | 'setup' | 'desenvolvimento' | 'tensao' | 'revelacao' | 'payoff' | 'transicao' | 'loop';
export type Emocao = 'curiosidade' | 'surpresa' | 'medo' | 'tensao' | 'alivio' | 'expectativa' | 'impacto';
export type EmocaoExtended = Emocao | 'humor' | 'suspense' | 'choque';
export type TipoGancho = 'visual' | 'texto' | 'acao' | 'pergunta';
export type IntensidadeEmocional = 'baixa' | 'media' | 'alta';

// Narrative Intelligence Layer types
export type HookPhrasePattern = 'pergunta' | 'afirmacao' | 'negacao' | 'alerta' | 'promessa' | 'misterio' | 'descoberta' | 'erro' | 'proibicao';
export type HookTypeVerbal = 'emocional' | 'tecnico' | 'misterioso' | 'alerta' | 'familiar' | 'curioso' | 'sensacionalista' | 'informativo';
export type HookEmotionVerbal = 'curiosidade' | 'medo' | 'alerta' | 'surpresa' | 'expectativa' | 'choque' | 'interesse';
export type NarrativeProgressionType = 'linear' | 'crescente' | 'oscilante' | 'fragmentada' | 'escalonada';
export type MicroTurnType = 'visual' | 'emocional' | 'informacional' | 'revelacao' | 'surpresa';
export type PayoffType = 'resposta' | 'revelacao' | 'choque' | 'confirmacao' | 'descoberta' | 'solucao';
export type PayoffEmotion = 'alivio' | 'choque' | 'surpresa' | 'satisfacao' | 'admiracao';
export type CtaType = 'direta' | 'emocional' | 'familiar' | 'reflexiva' | 'provocativa' | 'social';

/**
 * Engagement data status — critical for DNA viral base integrity.
 * - 'ausente': no engagement data provided (default)
 * - 'informado': manually entered by the user
 * - 'importado_pendente': imported from external source, awaiting user confirmation
 * - 'importado_confirmado': imported and confirmed by user
 */
export type EngagementStatus = 'ausente' | 'informado' | 'importado_pendente' | 'importado_confirmado';

export interface Video {
  id: string;
  titulo: string;
  origem: string;
  tipo_entrada: 'upload' | 'link';
  segmento?: Segmento | null;
  estilo_visual?: EstiloVisual | null;
  data_envio: string;
  status: ProcessingStatus;
  duracao?: number;
  resolucao?: string;
  fps?: number;
  tamanho?: number;
  codec?: string;
  thumbnail?: string;
  numero_frames?: number;
  numero_blocos?: number;
  idioma?: string;
  tipo_viral?: string;
  gancho_detectado?: boolean;
  tempo_gancho?: number;
  duracao_gancho?: number;
  tipo_gancho?: TipoGancho;
  emocao_predominante?: Emocao;
  intensidade_emocional?: IntensidadeEmocional;
  tempo_primeiro_evento?: number;
  tempo_primeira_revelacao?: number;
  tempo_payoff?: number;
  loop_detectado?: boolean;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  engagement_status: EngagementStatus;

  // Narrative Intelligence Layer
  first_impact_time?: number;
  hook_text?: string;
  hook_keywords?: string[];
  hook_phrase_pattern?: HookPhrasePattern;
  hook_type_verbal?: HookTypeVerbal;
  hook_emotion_verbal?: HookEmotionVerbal;
  hook_emotion_intensity?: number;
  narrative_progression_type?: NarrativeProgressionType;
  micro_turn_count?: number;
  micro_turn_types?: MicroTurnType[];
  payoff_text?: string;
  payoff_type?: PayoffType;
  payoff_emotion?: PayoffEmotion;
  cta_text?: string;
  cta_type?: CtaType;
  cta_position_time?: number;
  cta_intrusion_score?: number;
  cta_flow_break_score?: number;
}

/**
 * Returns true if a video has real, confirmed engagement data
 * and is eligible to participate in the DNA viral base calculations.
 */
export function isEligibleForDNA(video: Pick<Video, 'views' | 'likes' | 'comments' | 'engagement_status'>): boolean {
  if (video.engagement_status === 'ausente' || video.engagement_status === 'importado_pendente') {
    return false;
  }
  // Must have at least views, likes, and comments filled with real values (> 0 for at least one)
  const v = video.views ?? null;
  const l = video.likes ?? null;
  const c = video.comments ?? null;
  if (v === null && l === null && c === null) return false;
  return true;
}

/**
 * DNA viral base weight configuration — prepared for future adjustment
 */
export const DNA_WEIGHT_CONFIG = {
  views: 0.75,
  likes: 0.10,
  comments: 0.10,
  engagement_rate: 0.05,
};

export const ENGAGEMENT_STATUS_LABELS: Record<EngagementStatus, { label: string; color: string; icon: string }> = {
  ausente: { label: 'Engajamento ausente', color: 'text-amber-400', icon: '⚠' },
  informado: { label: 'Engajamento informado', color: 'text-green-400', icon: '✔' },
  importado_pendente: { label: 'Importado — pendente de confirmação', color: 'text-orange-400', icon: '⏳' },
  importado_confirmado: { label: 'Importado e confirmado', color: 'text-green-400', icon: '✔' },
};

export interface VideoBlock {
  id: string;
  video_id: string;
  bloco_id: number;
  tempo_inicio: number;
  tempo_fim: number;
  texto?: string;
  frame_url?: string;
  tipo_bloco: TipoBloco;
  funcao_narrativa: string;
  emocao: Emocao;
  elemento_visual?: string;
  descricao_visual?: string;
}

export interface VideoTranscript {
  id: string;
  video_id: string;
  tempo_inicio: number;
  tempo_fim: number;
  texto: string;
  duracao: number;
}

export interface ProcessingLog {
  id: string;
  video_id: string;
  etapa: string;
  status: 'success' | 'error' | 'warning';
  mensagem: string;
  timestamp: string;
  duracao_ms?: number;
}

export type DataSourceType = 'transcription' | 'visual_detection' | 'metadata_import' | 'manual_entry' | 'calculated' | 'ai_extraction';
export type DataOriginLevel = 'raw' | 'calculated';

export interface ExtractionLog {
  id: string;
  video_id: string;
  created_at: string;
  extraction_step: string;
  field_name: string;
  extracted_value: string | null;
  confidence_score: number;
  source_type: DataSourceType;
  origin_level: DataOriginLevel;
  error_flag: boolean;
  error_message?: string | null;
}

export const SEGMENTOS: { value: Segmento; label: string; icon: string }[] = [
  { value: 'meme', label: 'Meme', icon: '😂' },
  { value: 'curiosidade', label: 'Curiosidade', icon: '🔍' },
  { value: 'misterio', label: 'Mistério', icon: '🕵️' },
  { value: 'terror', label: 'Terror', icon: '👻' },
  { value: 'historia_real', label: 'História Real', icon: '📖' },
  { value: 'narrativa_biblica', label: 'Narrativa Bíblica', icon: '✝️' },
];

export const ESTILOS_VISUAIS: { value: EstiloVisual; label: string; icon: string }[] = [
  { value: 'filme', label: 'Filme', icon: '🎬' },
  { value: '3d', label: '3D', icon: '🧊' },
  { value: 'live_action', label: 'Live Action', icon: '📹' },
  { value: 'animacao', label: 'Animação', icon: '🎨' },
  { value: 'cgi', label: 'CGI', icon: '💻' },
  { value: 'stock_footage', label: 'Stock Footage', icon: '📁' },
];

export const TIPO_BLOCOS: { value: TipoBloco; label: string; color: string }[] = [
  { value: 'hook', label: 'HOOK', color: '#F97316' },
  { value: 'setup', label: 'SETUP', color: '#38BDF8' },
  { value: 'desenvolvimento', label: 'DESENVOLVIMENTO', color: '#6366F1' },
  { value: 'tensao', label: 'TENSÃO', color: '#EF4444' },
  { value: 'revelacao', label: 'REVELAÇÃO', color: '#22C55E' },
  { value: 'payoff', label: 'PAYOFF', color: '#EAB308' },
  { value: 'transicao', label: 'TRANSIÇÃO', color: '#94A3B8' },
  { value: 'loop', label: 'LOOP', color: '#A855F7' },
];

export const EMOCOES: { value: Emocao; label: string; icon: string }[] = [
  { value: 'curiosidade', label: 'Curiosidade', icon: '🤔' },
  { value: 'surpresa', label: 'Surpresa', icon: '😲' },
  { value: 'medo', label: 'Medo', icon: '😨' },
  { value: 'tensao', label: 'Tensão', icon: '😰' },
  { value: 'alivio', label: 'Alívio', icon: '😌' },
  { value: 'expectativa', label: 'Expectativa', icon: '🤩' },
  { value: 'impacto', label: 'Impacto', icon: '💥' },
];

export const EMOCOES_EXTENDED: { value: EmocaoExtended; label: string; icon: string }[] = [
  ...EMOCOES,
  { value: 'humor', label: 'Humor', icon: '😂' },
  { value: 'suspense', label: 'Suspense', icon: '🫣' },
  { value: 'choque', label: 'Choque', icon: '⚡' },
];

// ===== Emotion & Impact Score Utilities =====

const EMOTION_INTENSITY: Record<string, number> = {
  impacto: 95, choque: 92, medo: 85, tensao: 80, surpresa: 78,
  suspense: 75, curiosidade: 65, expectativa: 55, humor: 50, alivio: 30,
};

export function getEmotionIntensity(emocao?: string): number {
  if (!emocao) return 0;
  return EMOTION_INTENSITY[emocao] ?? 40;
}

export function calculateBlockImpactScore(
  block: VideoBlock,
  totalDuration: number,
  totalBlocks: number,
  payoffTime?: number,
): number {
  let score = 0;

  // Emotion weight (0-35)
  score += (getEmotionIntensity(block.emocao) / 100) * 35;

  // Position weight (0-25): hook position and payoff proximity boost
  const blockMid = (block.tempo_inicio + block.tempo_fim) / 2;
  const posRatio = totalDuration > 0 ? blockMid / totalDuration : 0;
  if (posRatio < 0.1) score += 22;
  else if (posRatio > 0.85) score += 20;
  else if (posRatio > 0.6) score += 15;
  else score += 10;

  // Payoff proximity (0-20)
  if (payoffTime && totalDuration > 0) {
    const distToPayoff = Math.abs(blockMid - payoffTime) / totalDuration;
    score += Math.max(0, 20 * (1 - distToPayoff));
  }

  // Narrative density (0-20): words per second
  const dur = block.tempo_fim - block.tempo_inicio;
  const words = block.texto ? block.texto.split(/\s+/).filter(Boolean).length : 0;
  const wps = dur > 0 ? words / dur : 0;
  score += Math.min(20, wps * 5);

  return Math.min(100, Math.round(score));
}
