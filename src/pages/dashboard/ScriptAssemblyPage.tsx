import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, FileText, CheckCircle, AlertTriangle, XCircle, Info, Save, PenLine, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  buildScriptAssemblyV1,
  saveScriptAssembly,
  loadLatestScriptAssembly,
  checkAssemblyOutdated,
  updateScriptBlockText,
  type ScriptAssemblyV1,
  type ScriptBlock,
} from "@/lib/build-script-assembly-v1";
import { buildHookProfile, generateHookSuggestions, type HookSuggestion, type HookGenerationResult } from "@/lib/generate-hook-v1";
import { buildEarlyEventProfile, generateEarlyEventSuggestions, type EarlyEventSuggestion, type EarlyEventGenerationResult } from "@/lib/generate-early-event-v1";
import { formatBlockName } from "@/lib/format-blocks";

const statusConfig = {
  ready: { label: "READY", icon: CheckCircle, color: "bg-green-500/20 text-green-400 border-green-500/30" },
  incomplete: { label: "INCOMPLETE", icon: AlertTriangle, color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  no_data: { label: "NO DATA", icon: XCircle, color: "bg-red-500/20 text-red-400 border-red-500/30" },
};

const ROLE_LABELS: Record<string, string> = {
  opening: "Opening",
  middle: "Middle",
  late: "Late",
  closing: "Closing",
};

const TEXT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  empty: { label: "Vazio", color: "bg-muted text-muted-foreground" },
  draft: { label: "Rascunho", color: "bg-yellow-500/20 text-yellow-400" },
  final: { label: "Final", color: "bg-green-500/20 text-green-400" },
};

function deriveTextProgress(blocks: ScriptBlock[]) {
  const total = blocks.length;
  const empty = blocks.filter((b) => b.text_status === "empty").length;
  const draft = blocks.filter((b) => b.text_status === "draft").length;
  const final_ = blocks.filter((b) => b.text_status === "final").length;
  const requiredFinal = blocks.filter((b) => b.is_required).every((b) => b.text_status === "final");

  let derivedLabel = "vazio";
  let derivedColor = "text-muted-foreground";
  if (total > 0 && empty === total) {
    derivedLabel = "Vazio";
    derivedColor = "text-muted-foreground";
  } else if (final_ === total) {
    derivedLabel = "Completo";
    derivedColor = "text-green-400";
  } else if (requiredFinal) {
    derivedLabel = "Pronto para próxima etapa";
    derivedColor = "text-green-400";
  } else if (draft > 0 || final_ > 0) {
    derivedLabel = "Em andamento";
    derivedColor = "text-yellow-400";
  }

  return { total, empty, draft, final: final_, derivedLabel, derivedColor };
}

function EvidenceBadges({ evidence }: { evidence: { word_count_in_range?: boolean | null; matched_emotional_words?: string[]; matched_impact_words?: string[]; matched_tension_words?: string[]; matched_action_words?: string[]; matched_progression_words?: string[]; continuity_with_hook_detected?: boolean | null; duplicate_blocked?: boolean; blacklist_blocked?: boolean; has_positive_evidence?: boolean } }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {evidence.blacklist_blocked && (
        <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/30">Blacklist</Badge>
      )}
      {evidence.duplicate_blocked && (
        <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/30">Duplicado</Badge>
      )}
      {evidence.word_count_in_range === true && (
        <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-400 border-green-500/30">Faixa OK</Badge>
      )}
      {evidence.word_count_in_range === false && (
        <Badge variant="outline" className="text-[10px] bg-yellow-500/10 text-yellow-400 border-yellow-500/30">Fora da faixa</Badge>
      )}
      {(evidence.matched_emotional_words?.length ?? 0) > 0 && (
        <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-400 border-green-500/30">
          Emocionais: {evidence.matched_emotional_words!.length}
        </Badge>
      )}
      {(evidence.matched_impact_words?.length ?? 0) > 0 && (
        <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-400 border-green-500/30">
          Impacto: {evidence.matched_impact_words!.length}
        </Badge>
      )}
      {(evidence.matched_tension_words?.length ?? 0) > 0 && (
        <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-400 border-green-500/30">
          Tensão: {evidence.matched_tension_words!.length}
        </Badge>
      )}
      {(evidence.matched_action_words?.length ?? 0) > 0 && (
        <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-400 border-green-500/30">
          Ação: {evidence.matched_action_words!.length}
        </Badge>
      )}
      {(evidence.matched_progression_words?.length ?? 0) > 0 && (
        <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-400 border-green-500/30">
          Progressão: {evidence.matched_progression_words!.length}
        </Badge>
      )}
      {evidence.continuity_with_hook_detected === true && (
        <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-400 border-green-500/30">Continuidade</Badge>
      )}
      {evidence.has_positive_evidence && !evidence.blacklist_blocked && !evidence.duplicate_blocked && (
        <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">✓ Evidência real</Badge>
      )}
    </div>
  );
}

export default function ScriptAssemblyPage() {
  const [assembly, setAssembly] = useState<ScriptAssemblyV1 | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [outdated, setOutdated] = useState(false);

  const [editTexts, setEditTexts] = useState<Record<number, string>>({});
  const [editStatuses, setEditStatuses] = useState<Record<number, string>>({});
  const [savingBlock, setSavingBlock] = useState<number | null>(null);

  const [hookSuggestions, setHookSuggestions] = useState<HookSuggestion[]>([]);
  const [generatingHook, setGeneratingHook] = useState(false);
  const [previousHookSuggestions, setPreviousHookSuggestions] = useState<HookSuggestion[]>([]);
  const [lowQualityWarning, setLowQualityWarning] = useState(false);

  const [earlyEventSuggestions, setEarlyEventSuggestions] = useState<EarlyEventSuggestion[]>([]);
  const [generatingEarlyEvent, setGeneratingEarlyEvent] = useState(false);
  const [previousEarlyEventSuggestions, setPreviousEarlyEventSuggestions] = useState<EarlyEventSuggestion[]>([]);
  const [earlyEventLowQuality, setEarlyEventLowQuality] = useState(false);

  useEffect(() => {
    loadLatestScriptAssembly()
      .then(async (data) => {
        if (data) {
          const obj = mapDataToAssembly(data);
          setAssembly(obj);
          initEditState(obj.script_blocks);
          const isOutdated = await checkAssemblyOutdated(data.source_generation_context_id);
          setOutdated(isOutdated);
        }
      })
      .catch(() => {})
      .finally(() => setInitialLoad(false));
  }, []);

  function mapDataToAssembly(data: any): ScriptAssemblyV1 {
    const obj: ScriptAssemblyV1 = {
      id: data.id,
      created_at: data.created_at,
      source_generation_context_id: data.source_generation_context_id,
      assembly_name: data.assembly_name,
      script_blocks: (data.script_blocks as any) ?? [],
      block_count_expected: data.block_count_expected,
      assembly_rules: (data.assembly_rules as any) ?? [],
      status: data.status as ScriptAssemblyV1["status"],
      status_reason: "",
    };
    if (obj.status === "no_data") obj.status_reason = "Sem Generation Context disponível";
    else if (obj.status === "incomplete") obj.status_reason = "Generation Context ainda não está READY";
    else obj.status_reason = "Todos os blocos estruturais presentes";
    return obj;
  }

  function initEditState(blocks: ScriptBlock[]) {
    const texts: Record<number, string> = {};
    const statuses: Record<number, string> = {};
    blocks.forEach((b) => {
      texts[b.index] = b.text_content ?? "";
      statuses[b.index] = b.text_status;
    });
    setEditTexts(texts);
    setEditStatuses(statuses);
  }

  const handleBuild = async () => {
    setLoading(true);
    try {
      const result = await buildScriptAssemblyV1();
      const saved = await saveScriptAssembly(result);
      const built = { ...result, id: saved.id, created_at: saved.created_at };
      setAssembly(built);
      initEditState(built.script_blocks);
      setOutdated(false);
      toast.success("Script Assembly V1 gerado com sucesso");
    } catch (e: any) {
      toast.error(e.message || "Erro ao gerar Script Assembly");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveBlock = async (block: ScriptBlock) => {
    if (!assembly?.id) return;
    setSavingBlock(block.index);
    try {
      const newText = editTexts[block.index] ?? "";
      const newStatus = (editStatuses[block.index] ?? "empty") as "empty" | "draft" | "final";
      const updatedBlocks = await updateScriptBlockText(assembly.id, block.index, newText || null, newStatus);
      setAssembly((prev) => prev ? { ...prev, script_blocks: updatedBlocks } : prev);
      toast.success(`Bloco #${block.index} salvo`);
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar bloco");
    } finally {
      setSavingBlock(null);
    }
  };

  const handleGenerateHook = async (block: ScriptBlock) => {
    setGeneratingHook(true);
    setLowQualityWarning(false);
    try {
      const profile = await buildHookProfile(block);
      const result: HookGenerationResult = await generateHookSuggestions(profile, previousHookSuggestions);
      setHookSuggestions(result.suggestions);
      setLowQualityWarning(result.low_quality_warning);
      toast.success(`${result.suggestions.length} sugestões de Hook geradas`);
    } catch (e: any) {
      toast.error(e.message || "Erro ao gerar sugestões de hook");
    } finally {
      setGeneratingHook(false);
    }
  };

  const handleRegenerateHook = async (block: ScriptBlock) => {
    setPreviousHookSuggestions((prev) => [...prev, ...hookSuggestions]);
    setHookSuggestions([]);
    setGeneratingHook(true);
    setLowQualityWarning(false);
    try {
      const profile = await buildHookProfile(block);
      const allPrevious = [...previousHookSuggestions, ...hookSuggestions];
      const result: HookGenerationResult = await generateHookSuggestions(profile, allPrevious);
      setHookSuggestions(result.suggestions);
      setLowQualityWarning(result.low_quality_warning);
      toast.success("Novas sugestões geradas");
    } catch (e: any) {
      toast.error(e.message || "Erro ao gerar sugestões");
    } finally {
      setGeneratingHook(false);
    }
  };

  const handleUseHook = async (block: ScriptBlock, suggestion: HookSuggestion) => {
    if (!assembly?.id) return;
    setSavingBlock(block.index);
    try {
      const updatedBlocks = await updateScriptBlockText(assembly.id, block.index, suggestion.text, "draft");
      // Persist evidence into the block
      const blocks = updatedBlocks.map((b) =>
        b.index === block.index
          ? { ...b, hook_evidence: suggestion.evidence }
          : b
      );
      const { error } = await (await import("@/integrations/supabase/client")).supabase
        .from("script_assemblies")
        .update({ script_blocks: blocks as any })
        .eq("id", assembly.id);
      if (!error) {
        setAssembly((prev) => prev ? { ...prev, script_blocks: blocks } : prev);
      } else {
        setAssembly((prev) => prev ? { ...prev, script_blocks: updatedBlocks } : prev);
      }
      setEditTexts((prev) => ({ ...prev, [block.index]: suggestion.text }));
      setEditStatuses((prev) => ({ ...prev, [block.index]: "draft" }));
      setHookSuggestions([]);
      setLowQualityWarning(false);
      toast.success("Hook aplicado como rascunho");
    } catch (e: any) {
      toast.error(e.message || "Erro ao aplicar hook");
    } finally {
      setSavingBlock(null);
    }
  };

  /* ── Early Event handlers ── */

  const findHookBlock = (): ScriptBlock | null => {
    const b = assembly?.script_blocks ?? [];
    return b.find((bl) => bl.block_type.toLowerCase() === "hook") ?? null;
  };

  const isEarlyEventBlock = (block: ScriptBlock): boolean => {
    const bt = block.block_type.toLowerCase();
    if (bt === "early_event" || bt === "early event" || bt === "evento_inicial") return true;
    // Fallback: opening block right after hook
    if (block.position_role === "opening") {
      const hookBlock = findHookBlock();
      if (hookBlock && block.index > hookBlock.index) {
        const blocks = assembly?.script_blocks ?? [];
        const openingAfterHook = blocks
          .filter((b) => b.index > hookBlock.index && b.block_type.toLowerCase() !== "hook")
          .sort((a, b) => a.index - b.index);
        return openingAfterHook.length > 0 && openingAfterHook[0].index === block.index;
      }
    }
    return false;
  };

  const handleGenerateEarlyEvent = async (block: ScriptBlock) => {
    setGeneratingEarlyEvent(true);
    setEarlyEventLowQuality(false);
    try {
      const hookBlock = findHookBlock();
      const profile = await buildEarlyEventProfile(block, hookBlock as any);
      const result = await generateEarlyEventSuggestions(profile, previousEarlyEventSuggestions);
      setEarlyEventSuggestions(result.suggestions);
      setEarlyEventLowQuality(result.low_quality_warning);
      toast.success(`${result.suggestions.length} sugestões de Early Event geradas`);
    } catch (e: any) {
      toast.error(e.message || "Erro ao gerar Early Event");
    } finally {
      setGeneratingEarlyEvent(false);
    }
  };

  const handleRegenerateEarlyEvent = async (block: ScriptBlock) => {
    setPreviousEarlyEventSuggestions((prev) => [...prev, ...earlyEventSuggestions]);
    setEarlyEventSuggestions([]);
    setGeneratingEarlyEvent(true);
    setEarlyEventLowQuality(false);
    try {
      const hookBlock = findHookBlock();
      const allPrevious = [...previousEarlyEventSuggestions, ...earlyEventSuggestions];
      const profile = await buildEarlyEventProfile(block, hookBlock as any);
      const result = await generateEarlyEventSuggestions(profile, allPrevious);
      setEarlyEventSuggestions(result.suggestions);
      setEarlyEventLowQuality(result.low_quality_warning);
      toast.success("Novas sugestões de Early Event geradas");
    } catch (e: any) {
      toast.error(e.message || "Erro ao gerar Early Event");
    } finally {
      setGeneratingEarlyEvent(false);
    }
  };

  const handleUseEarlyEvent = async (block: ScriptBlock, suggestion: EarlyEventSuggestion) => {
    if (!assembly?.id) return;
    setSavingBlock(block.index);
    try {
      const updatedBlocks = await updateScriptBlockText(assembly.id, block.index, suggestion.text, "draft");
      const blocks = updatedBlocks.map((b) =>
        b.index === block.index
          ? { ...b, early_event_evidence: suggestion.evidence }
          : b
      );
      const { error } = await (await import("@/integrations/supabase/client")).supabase
        .from("script_assemblies")
        .update({ script_blocks: blocks as any })
        .eq("id", assembly.id);
      if (!error) {
        setAssembly((prev) => prev ? { ...prev, script_blocks: blocks } : prev);
      } else {
        setAssembly((prev) => prev ? { ...prev, script_blocks: updatedBlocks } : prev);
      }
      setEditTexts((prev) => ({ ...prev, [block.index]: suggestion.text }));
      setEditStatuses((prev) => ({ ...prev, [block.index]: "draft" }));
      setEarlyEventSuggestions([]);
      setEarlyEventLowQuality(false);
      toast.success("Early Event aplicado como rascunho");
    } catch (e: any) {
      toast.error(e.message || "Erro ao aplicar Early Event");
    } finally {
      setSavingBlock(null);
    }
  };

  const st = assembly ? statusConfig[assembly.status] : null;
  const blocks = assembly?.script_blocks ?? [];
  const progress = deriveTextProgress(blocks);

  if (initialLoad) {
    return <div className="p-6 text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Script Assembly V1</h1>
          <p className="text-muted-foreground text-sm">Roteiro estrutural montável baseado no Generation Context</p>
        </div>
        <Button onClick={handleBuild} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Build Script Assembly V1
        </Button>
      </div>

      {outdated && assembly && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 text-yellow-400 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Script Assembly desatualizado em relação ao Generation Context mais recente
        </div>
      )}

      {assembly && (
        <>
          {/* Header card */}
          <Card className="border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{assembly.assembly_name}</CardTitle>
                {st && (
                  <Badge variant="outline" className={st.color}>
                    <st.icon className="h-3 w-3 mr-1" />
                    {st.label}
                  </Badge>
                )}
              </div>
              {assembly.created_at && (
                <CardDescription>Gerado em: {new Date(assembly.created_at).toLocaleString("pt-BR")}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex gap-6">
                <div>
                  <span className="text-muted-foreground">Blocos esperados:</span>{" "}
                  <span className="font-mono font-semibold">{assembly.block_count_expected ?? "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Generation Source:</span>{" "}
                  <span className="font-mono text-xs">
                    {assembly.source_generation_context_id
                      ? assembly.source_generation_context_id.slice(0, 8) + "…"
                      : "—"}
                  </span>
                </div>
              </div>

              {assembly.status !== "ready" && assembly.status_reason && (
                <div className="flex items-center gap-2 mt-2 p-2 rounded bg-muted/50 text-xs">
                  <AlertTriangle className="h-3 w-3 text-yellow-400 shrink-0" />
                  <span className="text-muted-foreground">Motivo do status:</span>
                  <span className="text-foreground">{assembly.status_reason}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Progress summary */}
          {blocks.length > 0 && (
            <Card className="border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <PenLine className="h-4 w-4" />
                  Progresso do Roteiro
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-6 text-sm">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-muted-foreground/40" />
                    <span className="font-mono font-semibold">{progress.empty}</span>
                    <span className="text-muted-foreground">empty</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400" />
                    <span className="font-mono font-semibold">{progress.draft}</span>
                    <span className="text-muted-foreground">draft</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-400" />
                    <span className="font-mono font-semibold">{progress.final}</span>
                    <span className="text-muted-foreground">final</span>
                  </div>
                </div>
                <p className={`text-xs mt-2 font-medium ${progress.derivedColor}`}>
                  Status textual: {progress.derivedLabel}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Script Blocks with editing */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Script Blocks ({blocks.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {blocks.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nenhum bloco disponível</p>
              ) : (
                blocks.map((block: ScriptBlock) => {
                  const textSt = TEXT_STATUS_CONFIG[block.text_status] ?? TEXT_STATUS_CONFIG.empty;
                  const isReady = block.assembly_ready !== false;
                  const isSaving = savingBlock === block.index;
                  const blockHookEvidence = (block as any).hook_evidence as Record<string, any> | undefined;
                  const blockEarlyEventEvidence = (block as any).early_event_evidence as Record<string, any> | undefined;
                  return (
                    <div key={block.index} className="border border-border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-muted-foreground">#{block.index}</span>
                          <span className="font-semibold">{formatBlockName(block.block_type)}</span>
                          {block.is_required && (
                            <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">
                              Obrigatório
                            </Badge>
                          )}
                          {!isReady && (
                            <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-400 border-red-500/30">
                              Not Ready
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {blockHookEvidence && (
                            <Badge variant="outline" className={`text-[10px] ${blockHookEvidence.has_positive_evidence ? "text-green-400" : "text-muted-foreground"}`}>
                              Hook: {blockHookEvidence.has_positive_evidence ? "✓" : "–"}
                            </Badge>
                          )}
                          {blockEarlyEventEvidence && (
                            <Badge variant="outline" className={`text-[10px] ${blockEarlyEventEvidence.has_positive_evidence ? "text-green-400" : "text-muted-foreground"}`}>
                              EE: {blockEarlyEventEvidence.has_positive_evidence ? "✓" : "–"}
                            </Badge>
                          )}
                          <Badge variant="outline" className={textSt.color + " text-[10px]"}>
                            Texto: {textSt.label}
                          </Badge>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div>
                          <span className="opacity-70">Função:</span>{" "}
                          <span className="text-foreground">{block.narrative_function}</span>
                        </div>
                        <div>
                          <span className="opacity-70">Posição:</span>{" "}
                          <span className="text-foreground">{ROLE_LABELS[block.position_role] ?? block.position_role}</span>
                        </div>
                        {block.expected_position_pct != null && (
                          <div>
                            <span className="opacity-70">Posição esperada:</span>{" "}
                            <span className="text-foreground">{block.expected_position_pct}%</span>
                          </div>
                        )}
                      </div>

                      {/* Text editing area */}
                      <div className="space-y-2">
                        <Textarea
                          placeholder="Digite o texto deste bloco..."
                          value={editTexts[block.index] ?? ""}
                          onChange={(e) => setEditTexts((prev) => ({ ...prev, [block.index]: e.target.value }))}
                          rows={3}
                          className="resize-y text-sm"
                        />
                        <div className="flex items-center gap-3">
                          <Select
                            value={editStatuses[block.index] ?? "empty"}
                            onValueChange={(v) => setEditStatuses((prev) => ({ ...prev, [block.index]: v }))}
                          >
                            <SelectTrigger className="w-36 h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="empty">Empty</SelectItem>
                              <SelectItem value="draft">Draft</SelectItem>
                              <SelectItem value="final">Final</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button size="sm" variant="outline" onClick={() => handleSaveBlock(block)} disabled={isSaving}>
                            <Save className={`h-3 w-3 mr-1 ${isSaving ? "animate-spin" : ""}`} />
                            Salvar bloco
                          </Button>
                        </div>
                      </div>

                      {/* Hook Generation UI */}
                      {block.block_type.toLowerCase() === "hook" && (
                        <div className="space-y-3 pt-2 border-t border-border">
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => hookSuggestions.length > 0 ? handleRegenerateHook(block) : handleGenerateHook(block)}
                              disabled={generatingHook}
                            >
                              <Sparkles className={`h-3 w-3 mr-1 ${generatingHook ? "animate-spin" : ""}`} />
                              {hookSuggestions.length > 0 ? "Gerar novas sugestões" : "Gerar Sugestões de Hook"}
                            </Button>
                          </div>

                          {/* Low quality warning */}
                          {lowQualityWarning && hookSuggestions.length > 0 && (
                            <div className="flex items-center gap-2 p-2.5 rounded-md border border-yellow-500/30 bg-yellow-500/10 text-yellow-400 text-xs">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                              <span>
                                ⚠ Hooks abaixo da qualidade ideal. Os hooks gerados estão abaixo do padrão ideal. Considere regenerar.
                              </span>
                            </div>
                          )}

                          {hookSuggestions.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                                <Zap className="h-3 w-3" />
                                Sugestões geradas:
                              </p>
                              {hookSuggestions.map((suggestion) => (
                                <div
                                  key={suggestion.id}
                                  className="flex items-center justify-between gap-3 p-3 rounded-md border border-border bg-muted/30"
                                >
                                  <div className="flex-1 space-y-1">
                                    <p className="text-sm font-medium">"{suggestion.text}"</p>
                                    <EvidenceBadges evidence={suggestion.evidence} />
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleUseHook(block, suggestion)}
                                    disabled={savingBlock === block.index}
                                    className="shrink-0"
                                  >
                                    Usar este Hook
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Early Event Generation UI */}
                      {isEarlyEventBlock(block) && (
                        <div className="space-y-3 pt-2 border-t border-border">
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => earlyEventSuggestions.length > 0 ? handleRegenerateEarlyEvent(block) : handleGenerateEarlyEvent(block)}
                              disabled={generatingEarlyEvent}
                            >
                              <Sparkles className={`h-3 w-3 mr-1 ${generatingEarlyEvent ? "animate-spin" : ""}`} />
                              {earlyEventSuggestions.length > 0 ? "Gerar novas sugestões" : "Gerar Early Event"}
                            </Button>
                          </div>

                          {earlyEventLowQuality && earlyEventSuggestions.length > 0 && (
                            <div className="flex items-center gap-2 p-2.5 rounded-md border border-yellow-500/30 bg-yellow-500/10 text-yellow-400 text-xs">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                              <span>
                                ⚠ Early Events abaixo da qualidade ideal. Considere regenerar.
                              </span>
                            </div>
                          )}

                          {earlyEventSuggestions.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                                <Zap className="h-3 w-3" />
                                Sugestões de Early Event:
                              </p>
                              {earlyEventSuggestions.map((suggestion) => (
                                <div
                                  key={suggestion.id}
                                  className="flex items-center justify-between gap-3 p-3 rounded-md border border-border bg-muted/30"
                                >
                                  <div className="flex-1 space-y-1">
                                    <p className="text-sm font-medium">"{suggestion.text}"</p>
                                    <EvidenceBadges evidence={suggestion.evidence} />
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleUseEarlyEvent(block, suggestion)}
                                    disabled={savingBlock === block.index}
                                    className="shrink-0"
                                  >
                                    Usar este
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* Assembly Rules */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Info className="h-4 w-4" />
                Assembly Rules
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm text-muted-foreground list-disc list-inside">
                {(assembly.assembly_rules ?? []).map((rule: string, i: number) => (
                  <li key={i}>{rule}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}

      {!assembly && (
        <Card className="border-border border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>Nenhum Script Assembly gerado ainda.</p>
            <p className="text-xs mt-1">Clique em "Build Script Assembly V1" para criar o primeiro roteiro estrutural.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
