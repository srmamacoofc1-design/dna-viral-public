import { AlertTriangle, CheckCircle, XCircle, Shield } from 'lucide-react';
import type { Video, VideoTranscript, VideoBlock, ProcessingLog } from '@/types/video';

interface Props {
  video: Video;
  transcripts: VideoTranscript[];
  blocks: VideoBlock[];
  logs: ProcessingLog[];
}

function StatusIcon({ ok }: { ok: boolean }) {
  return ok
    ? <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
    : <XCircle className="w-4 h-4 text-red-400 shrink-0" />;
}

export function DataIntegrityValidation({ video, transcripts, blocks, logs }: Props) {
  const hasTranscripts = transcripts.length > 0;
  const hasBlocks = blocks.length > 0;
  const hasDuration = !!video.duracao;
  const hasSize = !!video.tamanho;

  // Find transcription model from logs
  const transcriptionLog = logs.find(l => l.etapa === 'transcricao' || l.etapa === 'transcrição');
  const analysisLog = logs.find(l => l.etapa === 'analise_narrativa' || l.etapa === 'análise narrativa');

  // Validate timestamps are sequential
  const sortedTranscripts = [...transcripts].sort((a, b) => a.tempo_inicio - b.tempo_inicio);
  let timestampsValid = true;
  for (let i = 1; i < sortedTranscripts.length; i++) {
    if (sortedTranscripts[i].tempo_inicio < sortedTranscripts[i - 1].tempo_inicio) {
      timestampsValid = false;
      break;
    }
  }

  // Check blocks sync
  const sortedBlocks = [...blocks].sort((a, b) => a.tempo_inicio - b.tempo_inicio);
  let blocksSequential = true;
  let blocksOverlap = false;
  for (let i = 1; i < sortedBlocks.length; i++) {
    if (sortedBlocks[i].tempo_inicio < sortedBlocks[i - 1].tempo_inicio) blocksSequential = false;
    if (sortedBlocks[i].tempo_inicio < sortedBlocks[i - 1].tempo_fim) blocksOverlap = true;
  }

  // Audio duration from last transcript
  const lastTranscript = sortedTranscripts[sortedTranscripts.length - 1];
  const audioDuration = lastTranscript ? lastTranscript.tempo_fim : 0;

  const allValid = hasTranscripts && hasBlocks && hasDuration && timestampsValid && blocksSequential && !blocksOverlap;
  const integrityLabel = allValid ? 'Integridade completa' : 'Integridade parcial';

  return (
    <div className={`border rounded-lg p-4 ${allValid ? 'bg-green-500/5 border-green-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}>
      <h3 className="text-xs uppercase tracking-wider mb-3 flex items-center gap-2 font-semibold">
        <Shield className="w-4 h-4 text-primary" />
        Validação de Integridade — <span className={allValid ? 'text-green-400' : 'text-amber-400'}>{integrityLabel}</span>
      </h3>

      {!allValid && (
        <div className="flex items-center gap-2 mb-3 p-2 bg-amber-500/10 rounded text-xs text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          DADOS INCOMPLETOS OU NÃO CONFIÁVEIS
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-2">
          <StatusIcon ok={hasTranscripts} />
          <span className="text-muted-foreground">Transcrição real:</span>
          <span className="text-foreground font-medium">{hasTranscripts ? `${transcripts.length} segmentos` : 'Ausente'}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusIcon ok={hasBlocks} />
          <span className="text-muted-foreground">Blocos narrativos:</span>
          <span className="text-foreground font-medium">{hasBlocks ? `${blocks.length} blocos` : 'Ausentes'}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusIcon ok={hasDuration} />
          <span className="text-muted-foreground">Duração detectada:</span>
          <span className="text-foreground font-medium">{hasDuration ? `${video.duracao}s` : '—'}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusIcon ok={hasSize} />
          <span className="text-muted-foreground">Tamanho do arquivo:</span>
          <span className="text-foreground font-medium">{hasSize ? `${(video.tamanho! / 1e6).toFixed(1)} MB` : '—'}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusIcon ok={timestampsValid} />
          <span className="text-muted-foreground">Timestamps crescentes:</span>
          <span className="text-foreground font-medium">{timestampsValid ? '✔ Válido' : '⚠ Inconsistente'}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusIcon ok={!blocksOverlap} />
          <span className="text-muted-foreground">Sem sobreposição:</span>
          <span className="text-foreground font-medium">{!blocksOverlap ? '✔ Válido' : '⚠ Sobreposição detectada'}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusIcon ok={blocksSequential} />
          <span className="text-muted-foreground">Blocos sequenciais:</span>
          <span className="text-foreground font-medium">{blocksSequential ? '✔ Válido' : '⚠ Desordenados'}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusIcon ok={!!video.idioma} />
          <span className="text-muted-foreground">Idioma detectado:</span>
          <span className="text-foreground font-medium">{video.idioma?.toUpperCase() || '—'}</span>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-muted-foreground">Modelo transcrição:</span>
          <span className="ml-2 text-foreground">Gemini 2.5 Flash (Speech-to-Text)</span>
        </div>
        <div>
          <span className="text-muted-foreground">Modelo análise:</span>
          <span className="ml-2 text-foreground">Gemini 2.5 Flash (Narrative)</span>
        </div>
        <div>
          <span className="text-muted-foreground">Duração áudio detectado:</span>
          <span className="ml-2 text-foreground">{audioDuration > 0 ? `${audioDuration.toFixed(1)}s` : '—'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Coerência duração:</span>
          <span className="ml-2 text-foreground">
            {hasDuration && hasBlocks && sortedBlocks.length > 0
              ? (() => {
                  const lastBlock = sortedBlocks[sortedBlocks.length - 1];
                  const gap = Math.abs(video.duracao! - lastBlock.tempo_fim);
                  return gap <= 3 ? '✔ Coerente' : `⚠ Gap de ${gap.toFixed(1)}s`;
                })()
              : '—'}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Blocos válidos:</span>
          <span className="ml-2 text-foreground">
            {hasBlocks ? (blocks.length >= 2 && blocks.length <= 30 ? `✔ ${blocks.length} blocos` : `⚠ ${blocks.length} blocos (incomum)`) : '—'}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Processamento:</span>
          <span className="ml-2 text-foreground">
            {transcriptionLog?.duracao_ms ? `Transcrição: ${(transcriptionLog.duracao_ms / 1000).toFixed(1)}s` : '—'}
            {analysisLog?.duracao_ms ? ` · Análise: ${(analysisLog.duracao_ms / 1000).toFixed(1)}s` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
