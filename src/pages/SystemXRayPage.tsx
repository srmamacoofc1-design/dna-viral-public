import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { exportPageAsPDF } from '@/lib/export-pdf';
import { toast } from 'sonner';
import {
  Scan, Database, Layers, Zap, FileDown, BarChart3, Brain,
  ShieldCheck, Activity, Timer, BookOpen, Target, Dna, Search,
  Users, Upload, Shield, Loader2, CheckCircle2, AlertTriangle,
  Server, Code, Route, Component, Lock, Eye, UserCheck, KeyRound
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
// REGISTRO ESTÁTICO COMPLETO DO SISTEMA — Atualizado 2026-04-08
// ═══════════════════════════════════════════════════════════════

// ─── EDGE FUNCTIONS (48) ───

const EDGE_FUNCTIONS = [
  // Pipeline Core (Fase 1 — Base Viral)
  { name: 'download-video', category: 'Pipeline Core', version: 'v1', scope: 'viral_base', description: 'Download de vídeo a partir de URL externa para processamento. Interno, sem UI direta.' },
  { name: 'transcribe-video', category: 'Pipeline Core', version: 'v1', scope: 'viral_base', description: 'Transcrição de áudio do vídeo via Gemini com timestamps detalhados. Interno.' },
  { name: 'analyze-narrative', category: 'Pipeline Core', version: 'v2', scope: 'viral_base', description: 'Análise narrativa principal via IA (Gemini). Extrai blocos, emoções, funções narrativas e estrutura do vídeo.' },
  { name: 'extract-visual-blocks', category: 'Pipeline Core', version: 'v2', scope: 'viral_base', description: 'Extrai blocos visuais do vídeo usando análise de frames.' },
  { name: 'extract-verbal-dna', category: 'Pipeline Core', version: 'v2', scope: 'viral_base', description: 'Motor de DNA Verbal: extrai densidade linguística, pressão semântica, tons e padrões frasais por bloco.' },
  { name: 'extract-block-semantics', category: 'Pipeline Core', version: 'v2', scope: 'viral_base', description: 'Extração semântica individual por bloco (palavras dominantes, raras, emocionais).' },
  { name: 'batch-extract-block-semantics', category: 'Pipeline Core', version: 'v2', scope: 'viral_base', description: 'Extração semântica em lote de todos os blocos de um vídeo.' },
  { name: 'extract-viral-combinations', category: 'Pipeline Core', version: 'v2', scope: 'viral_base', description: 'Gera candidatos narrativos a partir de blocos para avaliação pelo judge.' },
  { name: 'judge-narrative', category: 'Pipeline Core', version: 'v2', scope: 'viral_base', description: 'Juiz narrativo via IA: classifica candidatos em HOOK/SETUP/BUILD/TWIST/PAYOFF/CTA/ACTION.' },
  { name: 'generate-early-event', category: 'Pipeline Core', version: 'v1', scope: 'viral_base', description: 'Geração de early events narrativos para vídeos.' },
  { name: 'generate-hook-suggestions', category: 'Pipeline Core', version: 'v1', scope: 'viral_base', description: 'Sugere hooks narrativos baseados na estrutura do vídeo.' },
  { name: 'rescrape-engagement', category: 'Pipeline Core', version: 'v1', scope: 'viral_base', description: 'Re-coleta métricas de engajamento (views, likes, comments) de vídeos existentes.' },
  { name: 'import-spreadsheet', category: 'Infraestrutura', version: 'v1', scope: 'viral_base', description: 'Importação em massa de vídeos via planilha (JSON array).' },

  // CTA
  { name: 'extract-cta-deep', category: 'CTA', version: 'v1', scope: 'viral_base', description: 'Extração profunda de CTAs via IA: tipo, tom, intensidade, posição.' },
  { name: 'extract-cta-deep-v2', category: 'CTA', version: 'v2', scope: 'viral_base', description: 'Versão refinada da extração CTA com maior precisão e deduplicação.' },
  { name: 'audit-cta-dedup', category: 'Auditoria', version: 'v1', scope: 'viral_base', description: 'Deduplica CTAs repetidos por vídeo, mantendo apenas o de maior confiança.' },

  // Consolidação
  { name: 'analyze-narrative-sequences', category: 'Consolidação', version: 'v2', scope: 'viral_base', description: 'Detecta sequências narrativas recorrentes entre vídeos e calcula frequência.' },
  { name: 'consolidate-block-patterns', category: 'Consolidação', version: 'v2', scope: 'viral_base', description: 'Consolida padrões de palavras e frases por camada narrativa globalmente.' },
  { name: 'consolidate-verbal-intelligence', category: 'Consolidação', version: 'v2', scope: 'viral_base', description: 'Gera sumário de inteligência verbal: top unidades, emoções, replicabilidade.' },
  { name: 'update-viral-lexicon', category: 'Consolidação', version: 'v2', scope: 'viral_base', description: 'Atualiza léxico verbal global com palavras e frases de maior frequência.' },

  // Análise Global
  { name: 'calculate-pattern-correlations', category: 'Análise Global', version: 'v2', scope: 'viral_base', description: 'Calcula correlações observacionais entre padrões narrativos e engagement.' },
  { name: 'calculate-pattern-weights', category: 'Análise Global', version: 'v2', scope: 'viral_base', description: 'Pondera padrões por frequência e engagement observado.' },
  { name: 'calculate-performance-normalization', category: 'Análise Global', version: 'v2', scope: 'viral_base', description: 'Normaliza métricas de performance para comparação relativa entre vídeos.' },
  { name: 'detect-cross-patterns', category: 'Análise Global', version: 'v2', scope: 'viral_base', description: 'Detecta padrões cruzados entre dimensões (estrutura × emoção × verbal).' },

  // Análise Avançada
  { name: 'calculate-text-image-compatibility', category: 'Análise Avançada', version: 'v2', scope: 'viral_base', description: 'Avalia compatibilidade entre texto narrado e elementos visuais por bloco.' },
  { name: 'calculate-text-visual-alignment', category: 'Análise Avançada', version: 'v2', scope: 'viral_base', description: 'Mede alinhamento emocional e de ação entre camada textual e visual.' },
  { name: 'detect-micro-events', category: 'Análise Avançada', version: 'v2', scope: 'viral_base', description: 'Identifica micro-picos de intensidade narrativa (mudanças de cena, viradas emocionais).' },
  { name: 'process-temporal-profile', category: 'Análise Avançada', version: 'v2', scope: 'viral_base', description: 'Perfil temporal por bloco: contagem de cortes, densidade, ritmo.' },

  // DNA
  { name: 'generate-dna-base', category: 'DNA', version: 'v1', scope: 'viral_base', description: 'Geração do DNA Base V1 (legacy): snapshot estrutural do dataset.' },
  { name: 'generate-dna-base-v2', category: 'DNA', version: 'v2', scope: 'viral_base', description: 'Geração do DNA Base V2 refinado com camadas verbal, emocional e de engagement.' },
  { name: 'formalize-dna-v2', category: 'DNA Formal', version: 'v2', scope: 'viral_base', description: 'Formaliza o DNA Base V2 em objeto operacional estruturado (structural, temporal, verbal, emotional, performance).' },

  // Coortes
  { name: 'generate-cohort', category: 'Coortes', version: 'v1', scope: 'viral_base', description: 'Gera coortes de vídeos baseadas em filtros (views, duração, segmento, score).' },
  { name: 'generate-cohort-summary', category: 'Coortes', version: 'v1', scope: 'viral_base', description: 'Calcula sumário analítico consolidado para uma coorte específica.' },

  // Engagement
  { name: 'recalculate-viral-scores', category: 'Engagement', version: 'v2', scope: 'viral_base', description: 'Recalcula engagement_rate_relative normalizado para todo o dataset.' },

  // Reprocessamento
  { name: 'reprocess-v2-create-job', category: 'Reprocessamento', version: 'v2', scope: 'viral_base', description: 'Cria job de reprocessamento em lote com etapas configuráveis.' },
  { name: 'reprocess-v2-worker', category: 'Reprocessamento', version: 'v2', scope: 'viral_base', description: 'Worker que executa as etapas do reprocessamento sequencialmente por vídeo.' },
  { name: 'reprocess-v2-cancel', category: 'Reprocessamento', version: 'v2', scope: 'viral_base', description: 'Cancela um job de reprocessamento em andamento.' },

  // Auditoria
  { name: 'data-readiness-check', category: 'Auditoria', version: 'v2', scope: 'viral_base', description: 'Verifica prontidão de dados para geração de DNA.' },
  { name: 'validate-data-consistency', category: 'Auditoria', version: 'v2', scope: 'viral_base', description: 'Valida consistência dos dados: blocos sem vídeo, transcripts órfãos, scores ausentes.' },
  { name: 'validate-mvp-layers', category: 'Auditoria', version: 'v2', scope: 'viral_base', description: 'Valida cobertura das 16 camadas analíticas do MVP para cada vídeo.' },

  // Infraestrutura
  { name: 'backup-export', category: 'Infraestrutura', version: 'v1', scope: 'shared', description: 'Exporta dados completos em JSON ou CSV por tabela/segmento.' },
  { name: 'backup-restore', category: 'Infraestrutura', version: 'v1', scope: 'shared', description: 'Restaura backup JSON com merge/upsert ou substituição completa.' },
  { name: 'translate', category: 'Infraestrutura', version: 'v1', scope: 'shared', description: 'Tradução de blocos narrativos entre idiomas suportados.' },

  // Pipeline Operacional (Fase 2 — Geração de Roteiros via Vídeo de Referência)
  { name: 'process-reference-video', category: 'Pipeline Operacional', version: 'v2', scope: 'operational', description: 'Processa vídeo de referência enviado pelo usuário: transcrição + frames + topic analysis. Propaga user_id via JWT.' },
  { name: 'analyze-reference-topics', category: 'Pipeline Operacional', version: 'v2', scope: 'operational', description: 'Análise semântica do vídeo de referência: tópico central, progressão narrativa, entidades proibidas, âncoras visuais.' },
  { name: 'build-complete-generation-context', category: 'Pipeline Operacional', version: 'v2', scope: 'operational', description: 'Gera Generation Context completo a partir de blueprint ou vídeo de referência. Propaga user_id via JWT auth.' },
  { name: 'assemble-script', category: 'Pipeline Operacional', version: 'v2', scope: 'operational', description: 'Monta Script Assembly com blocos preenchidos via IA. Propaga user_id via JWT auth.' },
  { name: 'validate-script-against-dna', category: 'Pipeline Operacional', version: 'v2', scope: 'operational', description: 'Valida script montado contra DNA formal: aderência estrutural, verbal e emocional.' },
  { name: 'revise-script-assembly', category: 'Pipeline Operacional', version: 'v2', scope: 'operational', description: 'Revisão automática de script reprovado na validação. Corrige e remonta blocos.' },
  { name: 'promote-script-final', category: 'Pipeline Operacional', version: 'v2', scope: 'operational', description: 'Promove script aprovado para promoted_scripts com trace completo. Propaga user_id via JWT auth.' },
];

// ─── DATABASE TABLES (67+) ───

const DATABASE_TABLES = [
  // ═══ AUTH & MULTI-USER ═══
  { name: 'profiles', category: 'Auth', rls: 'user_id', description: 'Perfis de usuário com display_name e avatar. Criado automaticamente via trigger handle_new_user. RLS: leitura pública, escrita própria.' },
  { name: 'user_roles', category: 'Auth', rls: 'user_id', description: 'Papéis de usuário (admin, member). Tabela separada para segurança. Consultada via has_role() SECURITY DEFINER.' },

  // ═══ CORE — Base Viral (Fase 1) ═══
  { name: 'videos', category: 'Core Viral', rls: 'public', description: 'Tabela principal de vídeos da base viral com metadados, métricas (views, likes, comments) e status de processamento.' },
  { name: 'video_blocks', category: 'Core Viral', rls: 'public', description: 'Blocos narrativos extraídos por IA com tipo, emoção, texto e timestamps.' },
  { name: 'video_transcripts', category: 'Core Viral', rls: 'public', description: 'Transcrições com timestamps por segmento de áudio.' },
  { name: 'video_scripts', category: 'Core Viral', rls: 'public', description: 'Roteiros completos por idioma.' },
  { name: 'video_languages', category: 'Core Viral', rls: 'public', description: 'Idiomas detectados/traduzidos por vídeo.' },
  { name: 'video_metadata', category: 'Core Viral', rls: 'public', description: 'Metadados chave-valor adicionais por vídeo.' },
  { name: 'video_logs', category: 'Core Viral', rls: 'public', description: 'Logs de processamento por etapa com status e duração.' },
  { name: 'processing_queue', category: 'Core Viral', rls: 'public', description: 'Fila de processamento com prioridade e status.' },

  // ═══ VISUAL ═══
  { name: 'video_frames', category: 'Visual', rls: 'public', description: 'Frames extraídos com timestamps, hash visual e intensidade.' },
  { name: 'visual_block_analysis', category: 'Visual', rls: 'public', description: 'Análise visual de blocos com classificação de cena e elementos.' },
  { name: 'visual_emotion_sequence', category: 'Visual', rls: 'public', description: 'Sequência emocional visual extraída por vídeo.' },

  // ═══ CTA ═══
  { name: 'video_cta_events', category: 'CTA', rls: 'public', description: 'Eventos de CTA detectados por bloco com tipo, intensidade e texto.' },
  { name: 'cta_profiles', category: 'CTA', rls: 'public', description: 'Perfil consolidado de CTA por vídeo.' },
  { name: 'cta_deep_analysis', category: 'CTA', rls: 'public', description: 'Análise profunda de CTA via IA com tom, alvo e confiança.' },

  // ═══ VERBAL ═══
  { name: 'block_verbal_analysis', category: 'Verbal', rls: 'public', description: 'Análise verbal por bloco: densidade linguística, pressão semântica, tom, complexidade sintática.' },
  { name: 'block_word_patterns', category: 'Verbal', rls: 'public', description: 'Padrões de palavras por bloco: dominantes, raras, emocionais, de impacto.' },
  { name: 'block_phrase_patterns', category: 'Verbal', rls: 'public', description: 'Padrões de frases por bloco: tipo, força, posição, score ponderado.' },

  // ═══ SEMÂNTICO ═══
  { name: 'block_semantic_patterns', category: 'Semântico', rls: 'public', description: 'Padrões semânticos consolidados por bloco: emoção, tom, palavras-chave.' },
  { name: 'semantic_patterns', category: 'Semântico', rls: 'public', description: 'Padrões semânticos legacy por vídeo: hook, payoff, trigger words.' },

  // ═══ ALINHAMENTO ═══
  { name: 'text_image_compatibility', category: 'Alinhamento', rls: 'public', description: 'Compatibilidade texto-imagem por bloco com scores dimensionais.' },
  { name: 'text_visual_alignment', category: 'Alinhamento', rls: 'public', description: 'Alinhamento emocional/ação entre texto e visual por bloco.' },

  // ═══ TEMPORAL ═══
  { name: 'video_temporal_profile', category: 'Temporal', rls: 'public', description: 'Perfil temporal por bloco: cortes, densidade, ritmo.' },
  { name: 'video_micro_events', category: 'Temporal', rls: 'public', description: 'Micro-eventos de intensidade narrativa por timestamp.' },

  // ═══ NARRATIVA ═══
  { name: 'narrative_judge_results', category: 'Narrativa', rls: 'public', description: 'Resultados do juiz narrativo: aprovação, função, emoção, confiança.' },
  { name: 'verbal_canonical_units', category: 'Narrativa', rls: 'public', description: 'Unidades canônicas aprovadas com função narrativa, replicabilidade e confiança.' },
  { name: 'verbal_noise_archive', category: 'Narrativa', rls: 'public', description: 'Arquivo de candidatos rejeitados com motivo de rejeição.' },

  // ═══ CONSOLIDAÇÃO VERBAL ═══
  { name: 'verbal_intelligence_summary', category: 'Consolidação', rls: 'public', description: 'Sumário global de inteligência verbal por função narrativa.' },
  { name: 'verbal_layer_patterns', category: 'Consolidação', rls: 'public', description: 'Padrões verbais consolidados por camada narrativa.' },
  { name: 'verbal_narrative_sequences', category: 'Consolidação', rls: 'public', description: 'Sequências narrativas recorrentes entre vídeos.' },
  { name: 'verbal_phase2_profile', category: 'Consolidação', rls: 'public', description: 'Perfil Phase 2 por função: emoções, intensidades, unidades top.' },

  // ═══ LÉXICO VIRAL ═══
  { name: 'viral_combination_patterns', category: 'Léxico', rls: 'public', description: 'Padrões de combinação verbal extraídos do dataset.' },
  { name: 'viral_emotional_patterns', category: 'Léxico', rls: 'public', description: 'Padrões emocionais observados globalmente.' },
  { name: 'viral_lexicon_global', category: 'Léxico', rls: 'public', description: 'Léxico verbal global com frequência e engagement observado.' },
  { name: 'viral_phrase_bank', category: 'Léxico', rls: 'public', description: 'Banco de frases recorrentes com métricas de frequência.' },
  { name: 'viral_sequence_patterns', category: 'Léxico', rls: 'public', description: 'Padrões de sequência narrativa observados.' },
  { name: 'viral_timing_patterns', category: 'Léxico', rls: 'public', description: 'Padrões temporais observados por posição de bloco.' },
  { name: 'viral_verbal_patterns', category: 'Léxico', rls: 'public', description: 'Padrões verbais observados globalmente.' },
  { name: 'viral_visual_patterns', category: 'Léxico', rls: 'public', description: 'Padrões visuais observados globalmente.' },
  { name: 'viral_word_combinations', category: 'Léxico', rls: 'public', description: 'Combinações de palavras recorrentes no dataset.' },

  // ═══ PERFORMANCE ═══
  { name: 'pattern_performance_weights', category: 'Performance', rls: 'public', description: 'Frequência e engagement observado por padrão.' },
  { name: 'performance_correlation', category: 'Performance', rls: 'public', description: 'Correlações observacionais entre padrões e engagement.' },
  { name: 'outlier_detection', category: 'Performance', rls: 'public', description: 'Detecção de outliers por z-score e tipo.' },

  // ═══ DNA ENGINE (Admin) ═══
  { name: 'dna_base_versions', category: 'DNA', rls: 'public', description: 'Snapshots DNA Base V1: estrutura dominante, hook, payoff, CTA.' },
  { name: 'dna_base_v2', category: 'DNA', rls: 'public', description: 'Snapshots DNA Base V2: estrutura + verbal + emocional + CTA.' },
  { name: 'dna_base_v2_formal', category: 'DNA', rls: 'public', description: 'DNA Formal V1: objeto operacional estruturado com 5 dimensões.' },
  { name: 'dna_objects', category: 'DNA Engine', rls: 'public', description: 'DNA Object V1: objeto consolidado com sequência dominante, blocos obrigatórios/opcionais, emoções e métricas.' },
  { name: 'template_contexts', category: 'DNA Engine', rls: 'public', description: 'Template Context V1: template estrutural derivado do DNA Object com regras de composição.' },
  { name: 'blueprint_contexts', category: 'DNA Engine', rls: 'public', description: 'Blueprint Context V1: plano estrutural executável com sequência de blocos, posições e tolerâncias.' },

  // ═══ OPERACIONAL MULTI-USER (Fase 2) ═══
  { name: 'generation_contexts', category: 'Operacional', rls: 'user_id + admin', description: 'Generation Context V1: esqueleto narrativo com slots. RLS: user_id = auth.uid() OR admin. Propaga user_id via JWT.' },
  { name: 'script_assemblies', category: 'Operacional', rls: 'user_id + admin', description: 'Script Assembly V1: roteiro montável com blocos preenchíveis. RLS: user_id = auth.uid() OR admin.' },
  { name: 'promoted_scripts', category: 'Operacional', rls: 'user_id + admin', description: 'Repositório final de roteiros aprovados. Unique em source_script_assembly_id. RLS: user_id = auth.uid() OR admin.' },
  { name: 'reference_videos', category: 'Operacional', rls: 'user_id + admin', description: 'Vídeos de referência enviados pelo usuário final para geração. Isolados da base viral. RLS: user_id = auth.uid() OR admin.' },
  { name: 'reference_video_transcripts', category: 'Operacional', rls: 'via reference_videos', description: 'Transcrições dos vídeos de referência com segmentos. RLS via JOIN em reference_videos.user_id.' },
  { name: 'reference_video_frames', category: 'Operacional', rls: 'via reference_videos', description: 'Frames extraídos dos vídeos de referência com timestamps e elementos visuais. RLS via JOIN.' },
  { name: 'reference_video_topics', category: 'Operacional', rls: 'via reference_videos', description: 'Análise semântica do vídeo de referência: tópico central, progressão, entidades proibidas. RLS via JOIN.' },
  { name: 'reference_generation_runs', category: 'Operacional', rls: 'user_id + admin', description: 'Execuções do pipeline de geração por vídeo. Rastreia status, scores e progresso. RLS: user_id = auth.uid() OR admin.' },

  // ═══ COORTES ═══
  { name: 'dataset_cohort', category: 'Coortes', rls: 'public', description: 'Definição de coortes com filtros e regras.' },
  { name: 'dataset_cohort_videos', category: 'Coortes', rls: 'public', description: 'Relação N:N entre coortes e vídeos.' },
  { name: 'cohort_analysis_summary', category: 'Coortes', rls: 'public', description: 'Sumário analítico consolidado por coorte.' },

  // ═══ AUDITORIA ═══
  { name: 'data_consistency_reports', category: 'Auditoria', rls: 'public', description: 'Relatórios de inconsistência de dados por vídeo.' },
  { name: 'extraction_logs', category: 'Auditoria', rls: 'public', description: 'Logs de extração com proveniência, confiança e erros. Limpeza automática 90 dias.' },
  { name: 'audit_trail', category: 'Auditoria', rls: 'public', description: 'Trilha de auditoria completa: insert/update/delete por campo. Limpeza 90 dias.' },
  { name: 'readiness_reports', category: 'Auditoria', rls: 'public', description: 'Snapshots de auditoria de prontidão de dados.' },

  // ═══ INFRAESTRUTURA ═══
  { name: 'viral_score_recalc_queue', category: 'Infraestrutura', rls: 'public', description: 'Fila de recálculo de engagement (nome legacy mantido por triggers/cron).' },
  { name: 'supported_languages', category: 'Config', rls: 'public', description: 'Idiomas suportados pelo sistema.' },
  { name: 'reprocess_jobs', category: 'Reprocessamento', rls: 'public', description: 'Jobs de reprocessamento em lote com progresso.' },
  { name: 'reprocess_job_items', category: 'Reprocessamento', rls: 'public', description: 'Itens individuais de cada job de reprocessamento.' },
];

// ─── PAGES & ROUTES (40+) ───

const PAGES = [
  // Auth
  { path: '/login', name: 'Login', scope: 'public', description: 'Tela de login e cadastro. Redireciona admin → /dashboard, member → /app após autenticação.' },

  // User Dashboard (/app) — member + admin
  { path: '/app', name: 'Gerar Roteiro', scope: 'authenticated', description: 'Interface de geração de roteiros do usuário final. Modo DNA (sem vídeo) ou Modo Vídeo (com upload de referência).' },
  { path: '/app/history', name: 'Meu Histórico', scope: 'authenticated', description: 'Histórico de gerações do usuário autenticado. Filtrado por user_id via RLS.' },
  { path: '/app/scripts', name: 'Meus Roteiros', scope: 'authenticated', description: 'Roteiros promovidos pelo usuário. Filtrado por user_id. Texto completo, blocos e metadados.' },

  // Admin Dashboard (/dashboard) — admin only
  { path: '/dashboard', name: 'Overview', scope: 'admin', description: 'Dashboard principal com contadores reais de templates, blueprints, contexts, assemblies, promoted scripts e usuários.' },
  { path: '/dashboard/dna-engine/build', name: 'Build DNA Object', scope: 'admin', description: 'Construção e rebuild do DNA Object V1 a partir dos dados do dataset viral.' },
  { path: '/dashboard/dna-engine/view', name: 'View DNA Object', scope: 'admin', description: 'Visualização detalhada do DNA Object V1 com blocos e métricas.' },
  { path: '/dashboard/dna-engine/compare', name: 'Compare DNA', scope: 'admin', description: 'Comparação entre versões de DNA Objects.' },
  { path: '/dashboard/templates', name: 'Templates', scope: 'admin', description: 'Gestão de Template Contexts derivados do DNA Object.' },
  { path: '/dashboard/templates/create', name: 'Criar Template', scope: 'admin', description: 'Criação de novo Template Context V1.' },
  { path: '/dashboard/templates/edit', name: 'Editar Template', scope: 'admin', description: 'Edição de Template Context existente.' },
  { path: '/dashboard/blueprints/generate', name: 'Gerar Blueprint', scope: 'admin', description: 'Geração do Blueprint Context V1 a partir do Template.' },
  { path: '/dashboard/blueprints/view', name: 'Visualizar Blueprint', scope: 'admin', description: 'Visualização detalhada do Blueprint.' },
  { path: '/dashboard/blueprints/history', name: 'Histórico Blueprints', scope: 'admin', description: 'Histórico de Blueprints gerados.' },
  { path: '/dashboard/generation', name: 'Generation Context', scope: 'admin', description: 'Esqueleto narrativo com slots e papéis estruturais.' },
  { path: '/dashboard/generation/history', name: 'Histórico Generation', scope: 'admin', description: 'Histórico de Generation Contexts salvos.' },
  { path: '/dashboard/script-assembly', name: 'Script Assembly', scope: 'admin', description: 'Roteiro estrutural montável com blocos preenchíveis.' },
  { path: '/dashboard/script-engine', name: 'Script Engine', scope: 'admin', description: 'Pipeline automatizado: gerar contexto → montar → validar → revisar → promover. Modo DNA e Modo Vídeo.' },
  { path: '/dashboard/promoted', name: 'Promoted Scripts', scope: 'admin', description: 'Repositório global de todos os roteiros promovidos (visão admin).' },
  { path: '/dashboard/validation', name: 'Validação Dashboard', scope: 'admin', description: 'Painel de validação do DNA Engine.' },
  { path: '/dashboard/validation/results', name: 'Resultados Validação', scope: 'admin', description: 'Resultados detalhados de validação.' },
  { path: '/dashboard/reports/viral', name: 'Reports Viral', scope: 'admin', description: 'Relatórios de performance de engagement.' },
  { path: '/dashboard/reports/dna', name: 'Reports DNA', scope: 'admin', description: 'Relatórios de DNA consolidado.' },
  { path: '/dashboard/reports/performance', name: 'Reports Performance', scope: 'admin', description: 'Relatórios de correlação de performance.' },
  { path: '/dashboard/database', name: 'Database', scope: 'admin', description: 'Visualização direta de dados do banco.' },
  { path: '/dashboard/settings', name: 'Settings', scope: 'admin', description: 'Configurações do sistema.' },
  { path: '/dashboard/users', name: 'Admin Users', scope: 'admin', description: 'Gestão de usuários: listagem de perfis, papéis, promoção/remoção de admin.' },

  // Legacy pages (admin access)
  { path: '/old-home', name: 'Upload (Legacy)', scope: 'legacy', description: 'Upload de vídeos por arquivo ou URL. Pipeline automático.' },
  { path: '/queue', name: 'Fila de Processamento', scope: 'legacy', description: 'Monitoramento em tempo real da fila de processamento.' },
  { path: '/library', name: 'Biblioteca', scope: 'legacy', description: 'Biblioteca completa de vídeos com busca e filtros.' },
  { path: '/video/:id', name: 'Detalhe do Vídeo', scope: 'legacy', description: 'Relatório individual completo: blocos, transcrição, timeline, ficha técnica.' },
  { path: '/report', name: 'Relatório Geral', scope: 'legacy', description: 'Relatório consolidado da biblioteca.' },
  { path: '/dna-viral', name: 'DNA Viral', scope: 'legacy', description: 'Scoring viral com fórmula auditável.' },
  { path: '/dna-v2', name: 'DNA V2', scope: 'legacy', description: 'Dashboard do DNA Base V2.' },
  { path: '/import', name: 'Importação', scope: 'legacy', description: 'Importação em massa via planilha JSON.' },
  { path: '/lexicon', name: 'Léxico Viral', scope: 'legacy', description: 'Léxico global de palavras e frases virais.' },
  { path: '/cohorts', name: 'Coortes', scope: 'legacy', description: 'Gestão de coortes e análise comparativa.' },
  { path: '/cta-deep', name: 'CTA Deep', scope: 'legacy', description: 'Análise profunda de CTAs.' },
  { path: '/temporal', name: 'Relatório Temporal', scope: 'legacy', description: 'Análise temporal: ritmo, densidade, padrões de edição.' },
  { path: '/micro-events', name: 'Micro-Picos', scope: 'legacy', description: 'Detecção de micro-eventos de intensidade narrativa.' },
  { path: '/patterns', name: 'Padrões', scope: 'legacy', description: 'Biblioteca de padrões narrativos com correlação de performance.' },
  { path: '/combinacoes', name: 'Combinações Virais', scope: 'legacy', description: 'Combinações verbais avaliadas pelo juiz narrativo.' },
  { path: '/validation', name: 'Validação MVP', scope: 'legacy', description: 'Validação das 16 camadas analíticas do MVP.' },
  { path: '/costs', name: 'Custos AI', scope: 'legacy', description: 'Projeção de custos de processamento por IA.' },
  { path: '/cta-audit', name: 'Auditoria CTA', scope: 'legacy', description: 'Auditoria de deduplicação e qualidade dos CTAs.' },
  { path: '/verbal-intelligence', name: 'Inteligência Verbal', scope: 'legacy', description: 'Dashboard de inteligência verbal.' },
  { path: '/backup', name: 'Backup', scope: 'legacy', description: 'Exportação/importação de backups completos.' },
  { path: '/system-xray', name: 'Raio-X do Sistema', scope: 'legacy', description: 'Auditoria técnica completa de toda a infraestrutura.' },
  { path: '/data-readiness', name: 'Data Readiness', scope: 'legacy', description: 'Verificação de prontidão de dados.' },
  { path: '/master-readiness-report', name: 'Master Readiness Report', scope: 'legacy', description: 'Relatório consolidado de integridade — Fase 1.' },
  { path: '/master-system-report', name: 'Master System Report', scope: 'legacy', description: 'Master report com 17 seções consolidadas.' },
];

// ─── MÓDULOS FUNCIONAIS (17) ───

const FUNCTIONAL_MODULES = [
  {
    module: '🔐 Autenticação & Multi-User',
    description: 'Sistema de auth com email/senha, papéis (admin/member), RLS row-level e redirecionamento automático por role.',
    pages: ['/login', '/app', '/dashboard'],
    capabilities: ['Login/Signup com email', 'Papéis separados (user_roles)', 'RLS por user_id nas tabelas operacionais', 'Redirect pós-login por role', 'Admin: /dashboard, Member: /app', 'Propagação de user_id via JWT nas edge functions'],
  },
  {
    module: '👤 Dashboard do Usuário Final',
    description: 'Interface simplificada para geração de roteiros, histórico e visualização de scripts promovidos. Isolada por user_id.',
    pages: ['/app', '/app/history', '/app/scripts'],
    capabilities: ['Geração Modo DNA (sem vídeo)', 'Geração Modo Vídeo (upload de referência)', 'Pipeline automático: contexto → montagem → validação → revisão → promoção', 'Histórico individual filtrado por RLS', 'Repositório de roteiros finais do usuário'],
  },
  {
    module: '🎬 Pipeline de Vídeo de Referência',
    description: 'Fluxo operacional isolado: o usuário envia vídeo e o sistema gera roteiro baseado no conteúdo do vídeo (transcrição + frames + tópicos). Zero contaminação com base viral.',
    pages: ['/app'],
    capabilities: ['Upload de vídeo → reference_videos', 'Transcrição → reference_video_transcripts', 'Extração de frames → reference_video_frames', 'Análise de tópicos → reference_video_topics', 'Guardrails de conteúdo (entidades proibidas)', 'Score de alinhamento semântico', 'Rastreamento em reference_generation_runs'],
  },
  {
    module: '🛡️ Admin Dashboard',
    description: 'Cockpit administrativo com visão global: métricas consolidadas, DNA Engine, gestão de templates/blueprints, scripts promovidos e gestão de usuários.',
    pages: ['/dashboard', '/dashboard/users', '/dashboard/promoted', '/dashboard/settings'],
    capabilities: ['Overview com contadores reais', 'Gestão de usuários (roles)', 'Visão global de todos os scripts promovidos', 'Acesso total ao DNA Engine', 'Configurações do sistema'],
  },
  {
    module: '🧬 DNA Engine',
    description: 'Motor principal de geração do DNA narrativo. Cadeia: DNA Object → Template → Blueprint → Generation → Assembly.',
    pages: ['/dashboard/dna-engine/build', '/dashboard/dna-engine/view', '/dashboard/dna-engine/compare'],
    capabilities: ['Build DNA Object V1', 'Visualização detalhada', 'Comparação entre versões', 'Diagnóstico de prontidão'],
  },
  {
    module: '📋 Templates',
    description: 'Gestão de Template Contexts derivados do DNA Object.',
    pages: ['/dashboard/templates', '/dashboard/templates/create', '/dashboard/templates/edit'],
    capabilities: ['Listagem de templates', 'Criação a partir do DNA Object', 'Edição de regras e blocos'],
  },
  {
    module: '📐 Blueprints',
    description: 'Planos estruturais executáveis com sequência de blocos, posições e tolerâncias.',
    pages: ['/dashboard/blueprints/generate', '/dashboard/blueprints/view', '/dashboard/blueprints/history'],
    capabilities: ['Geração a partir de Template', 'Visualização com tolerâncias', 'Histórico de versões'],
  },
  {
    module: '⚡ Script Engine',
    description: 'Pipeline automatizado de geração: contexto → montagem → validação → revisão automática → promoção.',
    pages: ['/dashboard/script-engine', '/dashboard/generation', '/dashboard/script-assembly'],
    capabilities: ['Modo DNA (sem vídeo)', 'Modo Vídeo (com upload)', 'Pipeline automatizado completo', 'Validação contra DNA formal', 'Revisão automática', 'Promoção com trace'],
  },
  {
    module: '📊 Reports',
    description: 'Relatórios analíticos consolidados por dimensão: engagement, DNA e performance.',
    pages: ['/dashboard/reports/viral', '/dashboard/reports/dna', '/dashboard/reports/performance'],
    capabilities: ['Relatório de engagement', 'Relatório de DNA consolidado', 'Correlações de performance'],
  },
  {
    module: '📤 Upload & Processamento',
    description: 'Entrada de dados da base viral, fila e monitoramento do pipeline de 12 etapas.',
    pages: ['/old-home', '/queue', '/import'],
    capabilities: ['Upload por arquivo/URL', 'Importação via planilha', 'Fila com status em tempo real', 'Reprocessamento em lote'],
  },
  {
    module: '📚 Biblioteca & Vídeos',
    description: 'Gestão completa da videoteca viral.',
    pages: ['/library', '/video/:id'],
    capabilities: ['Busca e filtros', 'Relatório individual completo', 'Transcrição e timeline', 'Ficha técnica', '19 componentes de relatório'],
  },
  {
    module: '🧠 Inteligência Verbal',
    description: 'Unidades canônicas, sequências narrativas e perfis por função.',
    pages: ['/verbal-intelligence', '/combinacoes'],
    capabilities: ['Unidades canônicas aprovadas', 'Sequências recorrentes', 'Perfis Phase 2', 'Combinações verbais com juiz IA'],
  },
  {
    module: '🔍 Análise Avançada',
    description: 'Módulos especializados: CTA, temporal, micro-eventos, padrões e léxico.',
    pages: ['/cta-deep', '/cta-audit', '/temporal', '/micro-events', '/patterns', '/lexicon'],
    capabilities: ['Análise profunda de CTAs', 'Auditoria de deduplicação', 'Perfil temporal', 'Micro-picos', 'Padrões com correlação', 'Léxico verbal global'],
  },
  {
    module: '👥 Coortes',
    description: 'Segmentação de vídeos em coortes com análise comparativa.',
    pages: ['/cohorts', '/cohorts/:id'],
    capabilities: ['Criação com filtros', 'Sumário analítico', 'Comparação entre coortes'],
  },
  {
    module: '🔎 Auditoria & Integridade',
    description: 'Ferramentas de auditoria, validação de dados e prontidão.',
    pages: ['/validation', '/data-readiness', '/master-readiness-report', '/master-system-report'],
    capabilities: ['Validação de 16 camadas MVP', 'Data readiness check', 'Master Readiness Report', 'Master System Report'],
  },
  {
    module: '⚙️ Infraestrutura',
    description: 'Backup, custos, configurações e monitoramento técnico.',
    pages: ['/backup', '/costs', '/system-xray', '/dashboard/database', '/dashboard/settings'],
    capabilities: ['Export/Import de backups', 'Projeção de custos IA', 'Raio-X completo', 'Visualização de dados'],
  },
];

// ─── CLIENT LIBRARIES (19) ───

const CLIENT_LIBRARIES = [
  { name: 'build-dna-object-v1', description: 'Construção do DNA Object V1 a partir de vídeos e blocos do dataset.' },
  { name: 'build-template-context-v1', description: 'Derivação do Template Context a partir do DNA Object.' },
  { name: 'build-blueprint-context-v1', description: 'Geração do Blueprint Context a partir do Template.' },
  { name: 'build-generation-context-v1', description: 'Criação do Generation Context com slots narrativos a partir do Blueprint.' },
  { name: 'build-script-assembly-v1', description: 'Montagem do Script Assembly com blocos de conteúdo preenchíveis.' },
  { name: 'build-complete-video-object', description: 'Constrói objeto completo de vídeo agregando todas as tabelas relacionadas.' },
  { name: 'viral-score', description: 'Cálculo local de engagement_rate_relative (fórmula observacional).' },
  { name: 'performance-observation', description: 'Funções de observação de performance: normalização e comparação relativa.' },
  { name: 'structural-fit', description: 'Avaliação de aderência estrutural de um vídeo ao DNA formal.' },
  { name: 'video-processing', description: 'Orquestrador do pipeline de processamento de vídeos (12 etapas).' },
  { name: 'reprocess-v2', description: 'Lógica de reprocessamento em lote com controle de jobs e itens.' },
  { name: 'frame-extractor', description: 'Extração de frames de vídeo para análise visual.' },
  { name: 'format-blocks', description: 'Formatação e normalização de blocos narrativos para exibição.' },
  { name: 'export-pdf', description: 'Exportação de páginas como PDF via html2canvas/jsPDF.' },
  { name: 'master-export', description: 'Exportação master em 3 camadas: Executive PDF, Technical Snapshot, Dataset Package.' },
  { name: 'master-system-data', description: 'Global Snapshot: carrega todos os dados do sistema em paralelo para o Master Report.' },
  { name: 'generate-early-event-v1', description: 'Geração de early events narrativos no cliente.' },
  { name: 'generate-hook-v1', description: 'Geração de sugestões de hooks narrativos no cliente.' },
  { name: 'utils', description: 'Utilidades gerais: cn(), formatação, merge de classes.' },
];

// ─── REPORT COMPONENTS (19) ───

const REPORT_COMPONENTS = [
  { name: 'DataIntegrityValidation', description: 'Valida integridade da transcrição real e blocos narrativos.' },
  { name: 'NarrativeRhythm', description: 'Visualiza ritmo narrativo: densidade por bloco, intervalos de estímulo.' },
  { name: 'NarrativeCharts', description: 'Gráficos de distribuição emocional e estrutural.' },
  { name: 'NarrativeDNA', description: 'DNA narrativo individual: sequência de blocos e emoções.' },
  { name: 'BlockAnalysis', description: 'Análise detalhada por bloco: texto, emoção, função.' },
  { name: 'VisualBlockAnalysis', description: 'Análise visual dos blocos com frames e intensidade.' },
  { name: 'StimulusIntervals', description: 'Intervalos de estímulo: picos e vales de intensidade.' },
  { name: 'AIClassification', description: 'Classificação por IA: modelo, confiança, proveniência.' },
  { name: 'TechLog', description: 'Log técnico de processamento com duração por etapa.' },
  { name: 'ExtractionAuditLog', description: 'Log de auditoria de extração: campo, valor, erro, confiança.' },
  { name: 'ConsistencyValidator', description: 'Validador de consistência entre tabelas relacionadas.' },
  { name: 'CTADeepReport', description: 'Relatório profundo de CTA individual.' },
  { name: 'PerformanceWeight', description: 'Pesos de performance por padrão.' },
  { name: 'PerformanceCorrelationReport', description: 'Correlações entre padrões e métricas.' },
  { name: 'TextImageCompatibility', description: 'Compatibilidade texto-imagem por bloco.' },
  { name: 'TextVisualAlignment', description: 'Alinhamento texto-visual por bloco.' },
  { name: 'DNABaseV1', description: 'Visualização do DNA Base V1 legacy.' },
  { name: 'VerbalDNAReport', description: 'Relatório de DNA Verbal: densidade, pressão, tons.' },
  { name: 'AuditTimeline', description: 'Timeline de auditoria com mudanças históricas.' },
];

// ─── UI COMPONENTS (23) ───

const UI_COMPONENTS = [
  // Layouts
  { name: 'AppLayout', category: 'Layout', description: 'Layout principal com navegação lateral legacy (hamburger menu) para páginas fora do dashboard.' },
  { name: 'DashboardLayout', category: 'Layout', description: 'Layout do dashboard admin com sidebar colapsável e outlet para rotas internas. Protegido por requiredRole="admin".' },
  { name: 'DashboardSidebar', category: 'Layout', description: 'Sidebar do dashboard admin com módulos colapsáveis: DNA Engine, Templates, Blueprints, Generation, Validation, Reports, Users.' },
  { name: 'UserDashboardLayout', category: 'Layout', description: 'Layout do dashboard do usuário final (/app). Sidebar simplificada com Gerar, Histórico e Roteiros. Outlet para subrotas.' },
  { name: 'UserSidebar', category: 'Layout', description: 'Sidebar do dashboard do usuário com 3 itens: Gerar Roteiro, Meu Histórico, Meus Roteiros.' },
  { name: 'NavLink', category: 'Layout', description: 'Componente de link com estado ativo baseado na rota atual.' },

  // Auth
  { name: 'ProtectedRoute', category: 'Auth', description: 'Wrapper de rota protegida. Verifica auth + role. Redireciona para /login (sem auth) ou /app (sem permissão admin).' },
  { name: 'AuthProvider', category: 'Auth', description: 'Context provider de autenticação. Gerencia user, session, role, loading. Usa onAuthStateChange + fetchRole com estados authReady/roleReady.' },

  // Upload
  { name: 'VideoUploadForm', category: 'Upload', description: 'Formulário de upload de vídeo com suporte a arquivo local e URL externa.' },
  { name: 'UploadHistory', category: 'Upload', description: 'Histórico de uploads recentes com status de processamento.' },

  // Pipeline
  { name: 'ProcessingBootstrap', category: 'Pipeline', description: 'Bootstrap de processamento: polling automático de fila e disparo de pipeline a cada 4s.' },
  { name: 'ProcessingLogs', category: 'Pipeline', description: 'Visualização de logs de processamento em tempo real por etapa.' },
  { name: 'QueueList', category: 'Pipeline', description: 'Lista da fila de processamento com prioridade e status por vídeo.' },
  { name: 'ReprocessV2Panel', category: 'Pipeline', description: 'Painel de reprocessamento em lote V2 com controle de jobs e progresso.' },

  // Biblioteca
  { name: 'VideoLibrary', category: 'Biblioteca', description: 'Grade de vídeos com busca, filtros, ordenação e exportação.' },
  { name: 'BlocksTable', category: 'Biblioteca', description: 'Tabela de blocos narrativos com tipo, emoção, texto e timestamps.' },

  // Relatório
  { name: 'FichaTecnica', category: 'Relatório', description: 'Ficha técnica individual do vídeo com metadados, métricas e proveniência.' },
  { name: 'TranscriptionTab', category: 'Relatório', description: 'Aba de transcrição com texto segmentado por timestamps.' },
  { name: 'NarrativeTimeline', category: 'Relatório', description: 'Timeline visual de blocos narrativos com cores por tipo e emoção.' },

  // Script Engine
  { name: 'ScriptEngine (sub-components)', category: 'Script Engine', description: 'InputPanel, ModeSelector, PipelineRunner, RunStatusCard, ScriptPreview, ValidationSummary, HeaderStats, AssemblyHistory — componentes modulares do motor de scripts.' },

  // UI
  { name: 'StatusBadge', category: 'UI', description: 'Badge de status de processamento com cores por estado.' },
  { name: 'EngagementBadge', category: 'UI', description: 'Badge de engagement rate relativo com escala visual.' },
  { name: 'MasterSections', category: 'Master Report', description: 'Componente de seções do Master System Report com 17 seções consolidadas e virtualização.' },
];

// ─── DNA ENGINE CHAIN ───

const DNA_ENGINE_CHAIN = [
  { step: 1, name: 'DNA Object V1', table: 'dna_objects', lib: 'build-dna-object-v1', page: '/dashboard/dna-engine/build', description: 'Consolida métricas operacionais do dataset: sequência dominante, blocos obrigatórios/opcionais (P75/P25), emoções, timings.' },
  { step: 2, name: 'Template Context V1', table: 'template_contexts', lib: 'build-template-context-v1', page: '/dashboard/templates/create', description: 'Traduz DNA em diretrizes narrativas: regras textuais, posições de hook/payoff/CTA, nome dinâmico.' },
  { step: 3, name: 'Blueprint Context V1', table: 'blueprint_contexts', lib: 'build-blueprint-context-v1', page: '/dashboard/blueprints/generate', description: 'Plano executável: sequência ordenada de blocos com tolerâncias de posição baseadas em desvio-padrão real.' },
  { step: 4, name: 'Generation Context V1', table: 'generation_contexts', lib: 'build-generation-context-v1', page: '/dashboard/generation', description: 'Esqueleto narrativo: slots com função narrativa, position_role (quartis reais), flag generation_ready.' },
  { step: 5, name: 'Script Assembly V1', table: 'script_assemblies', lib: 'build-script-assembly-v1', page: '/dashboard/script-assembly', description: 'Roteiro montável: blocos preenchíveis slot a slot com estados empty→draft→final.' },
  { step: 6, name: 'Promoted Script', table: 'promoted_scripts', lib: 'promote-script-final (EF)', page: '/app/scripts', description: 'Repositório final de roteiros aprovados. Unique em source_script_assembly_id. Trace completo de promoção.' },
];

// ─── PIPELINE STEPS (Fase 1) ───

const PIPELINE_STEPS = [
  { step: 1, name: 'Upload/Import', functions: ['download-video', 'import-spreadsheet'], description: 'Entrada de dados: upload direto, URL ou planilha.' },
  { step: 2, name: 'Transcrição', functions: ['transcribe-video'], description: 'Transcrição de áudio via Gemini com timestamps.' },
  { step: 3, name: 'Análise Narrativa', functions: ['analyze-narrative'], description: 'Extração de blocos narrativos com tipo, emoção e função.' },
  { step: 4, name: 'Extração Visual', functions: ['extract-visual-blocks'], description: 'Extração de frames e blocos visuais.' },
  { step: 5, name: 'DNA Verbal', functions: ['extract-verbal-dna'], description: 'Motor verbal: densidade, pressão, tons, padrões frasais.' },
  { step: 6, name: 'Semântica', functions: ['extract-block-semantics', 'batch-extract-block-semantics'], description: 'Extração semântica: palavras dominantes, raras, emocionais.' },
  { step: 7, name: 'Combinações', functions: ['extract-viral-combinations'], description: 'Geração de candidatos narrativos por bloco.' },
  { step: 8, name: 'Judge', functions: ['judge-narrative'], description: 'Juiz IA: classifica candidatos em funções narrativas.' },
  { step: 9, name: 'CTA', functions: ['extract-cta-deep-v2'], description: 'Extração profunda de CTAs com deduplicação.' },
  { step: 10, name: 'Temporal', functions: ['process-temporal-profile', 'detect-micro-events'], description: 'Perfil temporal e micro-picos de intensidade.' },
  { step: 11, name: 'Alinhamento', functions: ['calculate-text-visual-alignment', 'calculate-text-image-compatibility'], description: 'Alinhamento texto-visual e compatibilidade texto-imagem.' },
  { step: 12, name: 'Consolidação', functions: ['consolidate-verbal-intelligence', 'consolidate-block-patterns', 'update-viral-lexicon'], description: 'Consolidação global: inteligência verbal, léxico, padrões.' },
];

// ─── PIPELINE OPERACIONAL (Fase 2 — Modo Vídeo) ───

const OPERATIONAL_PIPELINE = [
  { step: 1, name: 'Upload Referência', functions: ['storage upload'], description: 'Usuário envia vídeo → reference_videos com user_id. Armazena no bucket privado "reference-videos".' },
  { step: 2, name: 'Processamento Vídeo', functions: ['process-reference-video'], description: 'Transcrição + extração de frames do vídeo de referência.' },
  { step: 3, name: 'Análise de Tópicos', functions: ['analyze-reference-topics'], description: 'Identifica tópico central, tópicos-chave, progressão narrativa, entidades proibidas.' },
  { step: 4, name: 'Geração de Contexto', functions: ['build-complete-generation-context'], description: 'Gera Generation Context usando dados do vídeo + blueprint como estrutura base.' },
  { step: 5, name: 'Montagem de Roteiro', functions: ['assemble-script'], description: 'Monta Script Assembly com blocos preenchidos por IA baseado no conteúdo do vídeo.' },
  { step: 6, name: 'Validação', functions: ['validate-script-against-dna'], description: 'Valida roteiro contra DNA formal: aderência estrutural, verbal e emocional.' },
  { step: 7, name: 'Revisão Automática', functions: ['revise-script-assembly'], description: 'Se reprovado, corrige automaticamente e remonta. Até 2 tentativas.' },
  { step: 8, name: 'Promoção', functions: ['promote-script-final'], description: 'Promove roteiro aprovado com trace completo. Grava user_id via JWT.' },
];

// ─── DB FUNCTIONS ───

const DB_FUNCTIONS = [
  { name: 'handle_new_user()', type: 'trigger', description: 'SECURITY DEFINER. Cria perfil automático em profiles quando novo usuário é criado em auth.users. Usa display_name do metadata ou email.' },
  { name: 'has_role(_user_id, _role)', type: 'function', description: 'SECURITY DEFINER. Verifica se um usuário possui determinado papel. Usada em todas as policies RLS das tabelas operacionais.' },
  { name: 'audit_trigger_func()', type: 'trigger', description: 'SECURITY DEFINER. Registra todas as alterações (insert/update/delete) na audit_trail com granularidade por campo.' },
  { name: 'enqueue_viral_recalc()', type: 'trigger', description: 'SECURITY DEFINER. Enfileira recálculo de engagement quando views/likes/comments mudam.' },
  { name: 'process_viral_recalc_queue()', type: 'function', description: 'SECURITY DEFINER. Processa fila de recálculo chamando a edge function automaticamente.' },
  { name: 'cleanup_audit_trail()', type: 'function', description: 'SECURITY DEFINER. Limpa registros de auditoria com mais de 90 dias.' },
  { name: 'cleanup_extraction_logs()', type: 'function', description: 'SECURITY DEFINER. Limpa logs de extração com mais de 90 dias.' },
  { name: 'update_updated_at_column()', type: 'trigger', description: 'Trigger genérico que atualiza updated_at em qualquer tabela.' },
];

// ─── HOOKS & TYPES ───

const HOOKS_AND_TYPES = [
  { name: 'useAuth', type: 'hook+context', description: 'Context de autenticação: user, session, role, isAdmin, loading (authReady + roleReady), signUp, signIn, signOut.' },
  { name: 'use-mobile', type: 'hook', description: 'Detecta viewport mobile para responsividade condicional.' },
  { name: 'use-toast', type: 'hook', description: 'Hook de notificações toast com fila e auto-dismiss.' },
  { name: 'video.ts', type: 'type', description: 'Tipos TypeScript para vídeo: VideoData, VideoBlock, ProcessingStatus.' },
];

// ─── RLS SECURITY MODEL ───

const RLS_MODEL = [
  { category: 'Base Viral (Fase 1)', policy: 'leitura compartilhada; mutação admin/service', description: 'O corpus viral continua consultável para compor o DNA. Inserção, atualização, remoção e Storage da Biblioteca exigem administrador validado ou Edge Function com service role.' },
  { category: 'Contextos e referências (Fase 2)', policy: 'owner OR has_role(admin)', description: 'generation_contexts, reference_videos e reference_generation_runs ficam isolados por user_id. O bucket reference-videos é privado e também separa os objetos pelo proprietário.' },
  { category: 'Saídas aprovadas', policy: 'leitura do dono; escrita server/admin', description: 'script_assemblies e promoted_scripts são gravados pelas Edge Functions do loop Escritor/Avaliador. Um navegador comum não pode forjar aprovação, validação ou promoção final.' },
  { category: 'Análises de Referência', policy: 'leitura do dono; escrita server/admin', description: 'reference_video_transcripts, reference_video_frames e reference_video_topics herdam a leitura por user_id da referência pai; somente as Edge Functions de IA ou um admin podem gravar evidências derivadas.' },
  { category: 'Profiles', policy: 'SELECT público, INSERT/UPDATE próprio', description: 'Qualquer um pode ler perfis. Inserção e atualização restrita ao próprio user_id.' },
  { category: 'User Roles', policy: 'Acesso via has_role() SECURITY DEFINER', description: 'Tabela user_roles não exposta diretamente. Consulta exclusivamente via função has_role() para evitar escalação de privilégio.' },
  { category: 'Audit Trail', policy: 'INSERT/SELECT público, sem UPDATE/DELETE', description: 'Trilha de auditoria append-only. Qualquer processo pode inserir e ler, mas ninguém pode alterar ou apagar.' },
];

// ═══════════════════════════════════════════════════════════════

interface TableCount { name: string; count: number; }
function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'erro desconhecido';
}

export default function SystemXRayPage() {
  const [tableCounts, setTableCounts] = useState<TableCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalRecords, setTotalRecords] = useState(0);

  useEffect(() => {
    loadTableCounts();
    const interval = setInterval(loadTableCounts, 60_000);
    return () => clearInterval(interval);
  }, []);

  async function loadTableCounts() {
    setLoading(true);
    try {
      const counts: TableCount[] = [];
      const tables = DATABASE_TABLES.map(t => t.name);
      const results = await Promise.all(
        tables.map(async (t) => {
          try {
            // The static registry intentionally spans every table in the
            // project. Avoid expanding Supabase's full generated union here;
            // that recursive generic exceeds TypeScript's instantiation cap.
            const { count } = await (supabase as any).from(t).select('*', { count: 'exact', head: true });
            return { name: t, count: count || 0 };
          } catch {
            return { name: t, count: -1 };
          }
        })
      );
      counts.push(...results);
      setTableCounts(counts);
      setTotalRecords(counts.reduce((s, c) => s + Math.max(0, c.count), 0));
    } catch (error: unknown) {
      toast.error('Erro ao carregar contagens: ' + errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  const getCount = (name: string) => tableCounts.find(t => t.name === name)?.count ?? -1;

  const categoryColors: Record<string, string> = {
    'Pipeline Core': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    'Pipeline Operacional': 'bg-sky-500/10 text-sky-400 border-sky-500/20',
    'Consolidação': 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    'Análise Global': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    'Análise Avançada': 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    'CTA': 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    'DNA': 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    'DNA Formal': 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    'Engagement': 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    'Coortes': 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    'Auditoria': 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    'Infraestrutura': 'bg-gray-500/10 text-gray-400 border-gray-500/20',
    'Reprocessamento': 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  };

  const tableCategoryColors: Record<string, string> = {
    'Auth': 'bg-red-500/10 text-red-400',
    'Core Viral': 'bg-blue-500/10 text-blue-400',
    'Visual': 'bg-amber-500/10 text-amber-400',
    'CTA': 'bg-rose-500/10 text-rose-400',
    'Verbal': 'bg-purple-500/10 text-purple-400',
    'Semântico': 'bg-emerald-500/10 text-emerald-400',
    'Alinhamento': 'bg-cyan-500/10 text-cyan-400',
    'Temporal': 'bg-yellow-500/10 text-yellow-400',
    'Narrativa': 'bg-indigo-500/10 text-indigo-400',
    'Consolidação': 'bg-violet-500/10 text-violet-400',
    'Performance': 'bg-green-500/10 text-green-400',
    'DNA': 'bg-teal-500/10 text-teal-400',
    'DNA Engine': 'bg-teal-500/10 text-teal-400',
    'Operacional': 'bg-sky-500/10 text-sky-400',
    'Léxico': 'bg-lime-500/10 text-lime-400',
    'Coortes': 'bg-sky-500/10 text-sky-400',
    'Auditoria': 'bg-orange-500/10 text-orange-400',
    'Config': 'bg-gray-500/10 text-gray-400',
    'Infraestrutura': 'bg-gray-500/10 text-gray-400',
    'Reprocessamento': 'bg-pink-500/10 text-pink-400',
  };

  const scopeColors: Record<string, string> = {
    'public': 'bg-gray-500/10 text-gray-400',
    'authenticated': 'bg-blue-500/10 text-blue-400',
    'admin': 'bg-red-500/10 text-red-400',
    'legacy': 'bg-amber-500/10 text-amber-400',
  };

  const v2Count = EDGE_FUNCTIONS.filter(f => f.version === 'v2').length;
  const v1Count = EDGE_FUNCTIONS.filter(f => f.version === 'v1').length;
  const operationalEF = EDGE_FUNCTIONS.filter(f => f.scope === 'operational').length;
  const viralEF = EDGE_FUNCTIONS.filter(f => f.scope === 'viral_base').length;
  const categories = [...new Set(EDGE_FUNCTIONS.map(f => f.category))];
  const operationalTables = DATABASE_TABLES.filter(t => t.rls?.includes('user_id')).length;

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Scan className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Raio-X do Sistema</h1>
              <p className="text-sm text-muted-foreground">Auditoria técnica completa — Multi-User + Pipeline Operacional + Base Viral</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadTableCounts} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
              Atualizar
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportPageAsPDF('Raio-X do Sistema — ViralDNA')}>
              <FileDown className="w-4 h-4 mr-1" /> PDF
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-10 gap-3">
          <Card><CardContent className="pt-4 pb-3 text-center">
            <BarChart3 className="w-5 h-5 mx-auto mb-1 text-primary" />
            <div className="text-2xl font-bold text-foreground">{FUNCTIONAL_MODULES.length}</div>
            <div className="text-xs text-muted-foreground">Módulos</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 text-center">
            <Database className="w-5 h-5 mx-auto mb-1 text-blue-400" />
            <div className="text-2xl font-bold text-foreground">{DATABASE_TABLES.length}</div>
            <div className="text-xs text-muted-foreground">Tabelas</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 text-center">
            <Server className="w-5 h-5 mx-auto mb-1 text-emerald-400" />
            <div className="text-2xl font-bold text-foreground">{EDGE_FUNCTIONS.length}</div>
            <div className="text-xs text-muted-foreground">Edge Funcs</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 text-center">
            <Code className="w-5 h-5 mx-auto mb-1 text-purple-400" />
            <div className="text-2xl font-bold text-foreground">{DB_FUNCTIONS.length}</div>
            <div className="text-xs text-muted-foreground">DB Funcs</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 text-center">
            <BookOpen className="w-5 h-5 mx-auto mb-1 text-teal-400" />
            <div className="text-2xl font-bold text-foreground">{CLIENT_LIBRARIES.length}</div>
            <div className="text-xs text-muted-foreground">Libs</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 text-center">
            <Route className="w-5 h-5 mx-auto mb-1 text-amber-400" />
            <div className="text-2xl font-bold text-foreground">{PAGES.length}</div>
            <div className="text-xs text-muted-foreground">Rotas</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 text-center">
            <Component className="w-5 h-5 mx-auto mb-1 text-rose-400" />
            <div className="text-2xl font-bold text-foreground">{UI_COMPONENTS.length + REPORT_COMPONENTS.length}</div>
            <div className="text-xs text-muted-foreground">Componentes</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 text-center">
            <Lock className="w-5 h-5 mx-auto mb-1 text-red-400" />
            <div className="text-2xl font-bold text-foreground">{operationalTables}</div>
            <div className="text-xs text-muted-foreground">Tabelas RLS</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 text-center">
            <KeyRound className="w-5 h-5 mx-auto mb-1 text-orange-400" />
            <div className="text-2xl font-bold text-foreground">{RLS_MODEL.length}</div>
            <div className="text-xs text-muted-foreground">Policies</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 text-center">
            <Layers className="w-5 h-5 mx-auto mb-1 text-cyan-400" />
            <div className="text-2xl font-bold text-foreground">{loading ? '...' : totalRecords.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Registros</div>
          </CardContent></Card>
        </div>

        {/* ═══ SECURITY MODEL ═══ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Shield className="w-5 h-5 text-red-400" /> Modelo de Segurança — Auth + Roles + RLS
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {RLS_MODEL.map((item) => (
              <div key={item.category} className="p-3 rounded-lg bg-secondary/30 border border-border/50">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-foreground text-sm">{item.category}</span>
                  <Badge variant="outline" className="text-[10px] font-mono">{item.policy}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
            ))}
            <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
              <div className="flex items-center gap-2 mb-1">
                <Lock className="w-4 h-4 text-red-400" />
                <span className="font-medium text-red-400 text-sm">Propagação de Identidade</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Edge functions operacionais (build-complete-generation-context, assemble-script, promote-script-final) extraem user_id do JWT via supabase.auth.getUser(). 
                Nunca confiam em user_id do body. Isso garante que o RLS funcione corretamente quando os dados são inseridos.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ═══ PIPELINE FASE 1 ═══ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Zap className="w-5 h-5 text-primary" /> Pipeline de Processamento — Fase 1 (Base Viral) — {PIPELINE_STEPS.length} Etapas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {PIPELINE_STEPS.map((step) => (
                <div key={step.step} className="flex items-start gap-3 p-3 rounded-lg bg-secondary/30 border border-border/50">
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0">{step.step}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground text-sm">{step.name}</span>
                      {step.functions.map(f => <Badge key={f} variant="outline" className="text-[10px] font-mono">{f}</Badge>)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ═══ PIPELINE OPERACIONAL FASE 2 ═══ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <UserCheck className="w-5 h-5 text-sky-400" /> Pipeline Operacional — Fase 2 (Modo Vídeo) — {OPERATIONAL_PIPELINE.length} Etapas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {OPERATIONAL_PIPELINE.map((step) => (
                <div key={step.step} className="flex items-start gap-3 p-3 rounded-lg bg-sky-500/5 border border-sky-500/20">
                  <div className="w-8 h-8 rounded-full bg-sky-500/10 text-sky-400 flex items-center justify-center text-sm font-bold shrink-0">{step.step}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground text-sm">{step.name}</span>
                      {step.functions.map(f => <Badge key={f} variant="outline" className="text-[10px] font-mono">{f}</Badge>)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ═══ DNA ENGINE CHAIN ═══ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Dna className="w-5 h-5 text-primary" /> DNA Engine — Cadeia Operacional Completa (6 etapas)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {DNA_ENGINE_CHAIN.map((step, i) => (
                <div key={step.step} className="flex items-start gap-3 p-3 rounded-lg bg-secondary/30 border border-border/50">
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0">{step.step}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground text-sm">{step.name}</span>
                      <Badge variant="outline" className="text-[10px] font-mono">{step.table}</Badge>
                      <Badge variant="secondary" className="text-[10px] font-mono">{step.lib}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                    <code className="text-[10px] font-mono text-muted-foreground mt-1 block">{step.page}</code>
                  </div>
                  {i < DNA_ENGINE_CHAIN.length - 1 && <div className="text-muted-foreground text-xs self-center">→</div>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ═══ MÓDULOS FUNCIONAIS ═══ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <BarChart3 className="w-5 h-5 text-primary" /> Módulos Funcionais — {FUNCTIONAL_MODULES.length} módulos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {FUNCTIONAL_MODULES.map((mod) => (
                <div key={mod.module} className="p-3 rounded-lg bg-secondary/30 border border-border/50">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-foreground text-sm">{mod.module}</span>
                    <Badge variant="outline" className="text-[10px]">{mod.pages.length} páginas</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{mod.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {mod.capabilities.map(cap => <Badge key={cap} variant="secondary" className="text-[10px]">{cap}</Badge>)}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {mod.pages.map(p => <code key={p} className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-1 py-0.5 rounded">{p}</code>)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ═══ EDGE FUNCTIONS ═══ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Server className="w-5 h-5 text-emerald-400" /> Edge Functions — {EDGE_FUNCTIONS.length} funções
              <Badge variant="outline" className="ml-2 text-xs">{v2Count} v2</Badge>
              <Badge variant="outline" className="text-xs">{v1Count} v1</Badge>
              <Badge variant="outline" className="text-xs text-sky-400">{operationalEF} operacional</Badge>
              <Badge variant="outline" className="text-xs text-blue-400">{viralEF} viral</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {categories.map(cat => (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className={`text-xs ${categoryColors[cat] || 'bg-secondary text-secondary-foreground'}`}>{cat}</Badge>
                    <span className="text-xs text-muted-foreground">({EDGE_FUNCTIONS.filter(f => f.category === cat).length} funções)</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {EDGE_FUNCTIONS.filter(f => f.category === cat).map(fn => (
                      <div key={fn.name} className="p-2.5 rounded-lg border border-border/50 bg-card/50 hover:bg-secondary/30 transition-colors">
                        <div className="flex items-center gap-2">
                          <code className="text-xs font-mono text-primary">{fn.name}</code>
                          <Badge variant={fn.version === 'v2' ? 'default' : 'secondary'} className="text-[9px] h-4">{fn.version}</Badge>
                          {fn.scope === 'operational' && <Badge className="text-[9px] h-4 bg-sky-500/10 text-sky-400">operacional</Badge>}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{fn.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ═══ DATABASE TABLES ═══ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Database className="w-5 h-5 text-blue-400" /> Tabelas do Banco — {DATABASE_TABLES.length} tabelas
              <Badge variant="outline" className="text-xs text-red-400">{operationalTables} com RLS user_id</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[...new Set(DATABASE_TABLES.map(t => t.category))].map(cat => (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className={`text-xs ${tableCategoryColors[cat] || 'bg-secondary text-secondary-foreground'}`}>{cat}</Badge>
                    <span className="text-xs text-muted-foreground">({DATABASE_TABLES.filter(t => t.category === cat).length} tabelas)</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {DATABASE_TABLES.filter(t => t.category === cat).map(table => {
                      const count = getCount(table.name);
                      return (
                        <div key={table.name} className="p-2.5 rounded-lg border border-border/50 bg-card/50">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <code className="text-xs font-mono text-foreground">{table.name}</code>
                              {table.rls?.includes('user_id') && <Lock className="w-3 h-3 text-red-400" />}
                            </div>
                            <span className={`text-xs font-mono ${count > 0 ? 'text-emerald-400' : count === 0 ? 'text-muted-foreground' : 'text-destructive'}`}>
                              {count >= 0 ? count.toLocaleString() : 'err'}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-1">{table.description}</p>
                          {table.rls && table.rls !== 'public' && (
                            <div className="mt-1">
                              <Badge variant="outline" className="text-[9px] text-red-400 border-red-500/30">RLS: {table.rls}</Badge>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ═══ DB FUNCTIONS ═══ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Code className="w-5 h-5 text-purple-400" /> Database Functions — {DB_FUNCTIONS.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {DB_FUNCTIONS.map(fn => (
                <div key={fn.name} className="p-2.5 rounded-lg border border-border/50 bg-card/50">
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-primary">{fn.name}</code>
                    <Badge variant="outline" className="text-[9px]">{fn.type}</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">{fn.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ═══ PAGES & ROUTES ═══ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Route className="w-5 h-5 text-amber-400" /> Páginas & Rotas — {PAGES.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {['public', 'authenticated', 'admin', 'legacy'].map(scope => {
                const scopePages = PAGES.filter(p => p.scope === scope);
                if (scopePages.length === 0) return null;
                const labels: Record<string, string> = { public: '🌐 Público', authenticated: '👤 Autenticado (member + admin)', admin: '🛡️ Admin Only', legacy: '📦 Legacy (admin access)' };
                return (
                  <div key={scope}>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className={`text-xs ${scopeColors[scope]}`}>{labels[scope]}</Badge>
                      <span className="text-xs text-muted-foreground">({scopePages.length} rotas)</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {scopePages.map(page => (
                        <div key={page.path} className="p-2.5 rounded-lg border border-border/50 bg-card/50">
                          <div className="flex items-center gap-2">
                            <code className="text-xs font-mono text-amber-400">{page.path}</code>
                            <span className="text-xs font-medium text-foreground">{page.name}</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-1">{page.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* ═══ REPORT COMPONENTS ═══ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Component className="w-5 h-5 text-rose-400" /> Componentes de Relatório — {REPORT_COMPONENTS.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {REPORT_COMPONENTS.map(comp => (
                <div key={comp.name} className="p-2.5 rounded-lg border border-border/50 bg-card/50">
                  <code className="text-xs font-mono text-rose-400">{comp.name}</code>
                  <p className="text-[11px] text-muted-foreground mt-1">{comp.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ═══ CLIENT LIBRARIES ═══ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <BookOpen className="w-5 h-5 text-teal-400" /> Bibliotecas Cliente — {CLIENT_LIBRARIES.length} módulos (src/lib/)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {CLIENT_LIBRARIES.map(lib => (
                <div key={lib.name} className="p-2.5 rounded-lg border border-border/50 bg-card/50">
                  <code className="text-xs font-mono text-teal-400">{lib.name}</code>
                  <p className="text-[11px] text-muted-foreground mt-1">{lib.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ═══ UI COMPONENTS ═══ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Component className="w-5 h-5 text-rose-400" /> Componentes de Interface — {UI_COMPONENTS.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[...new Set(UI_COMPONENTS.map(c => c.category))].map(cat => (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="secondary" className="text-xs">{cat}</Badge>
                    <span className="text-xs text-muted-foreground">({UI_COMPONENTS.filter(c => c.category === cat).length})</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {UI_COMPONENTS.filter(c => c.category === cat).map(comp => (
                      <div key={comp.name} className="p-2.5 rounded-lg border border-border/50 bg-card/50">
                        <code className="text-xs font-mono text-rose-400">{comp.name}</code>
                        <p className="text-[11px] text-muted-foreground mt-1">{comp.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ═══ HOOKS & TYPES ═══ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Code className="w-5 h-5 text-purple-400" /> Hooks & Tipos — {HOOKS_AND_TYPES.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {HOOKS_AND_TYPES.map(item => (
                <div key={item.name} className="p-2.5 rounded-lg border border-border/50 bg-card/50">
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-purple-400">{item.name}</code>
                    <Badge variant="outline" className="text-[9px]">{item.type}</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">{item.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ═══ SCORING FORMULA ═══ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Target className="w-5 h-5 text-yellow-400" /> Fórmula de Engagement Rate Relativo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50 font-mono text-sm">
              <p className="text-foreground">engagement_rate_relative = engagement_rate / max_engagement_rate</p>
              <p className="text-muted-foreground mt-2 text-xs">engagement_rate = (likes + comments) / views — derivado da base MVP. Sem pesos inventados.</p>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground py-4 border-t border-border">
          Raio-X gerado em {new Date().toLocaleString('pt-BR')} — {EDGE_FUNCTIONS.length} Edge Functions • {DATABASE_TABLES.length} Tabelas • {PAGES.length} Rotas • {FUNCTIONAL_MODULES.length} Módulos — Pipeline v2_refined + Multi-User
        </div>
      </div>
    </AppLayout>
  );
}
