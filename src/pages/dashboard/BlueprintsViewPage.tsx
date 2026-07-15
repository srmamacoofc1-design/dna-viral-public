import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { RefreshCw, Layout, Clock, Heart, Megaphone, CheckCircle, AlertTriangle, XCircle, Info, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { buildBlueprintContextV1, saveBlueprintContext, loadLatestBlueprintContext, type BlueprintContextV1, type BlueprintBlock } from "@/lib/build-blueprint-context-v1";
import { formatBlockName } from "@/lib/format-blocks";

const VALID_RAW_TYPES = new Set(["hook", "setup", "tensao", "desenvolvimento", "revelacao", "payoff", "transicao", "loop"]);

const statusConfig = {
  ready: { label: "READY", icon: CheckCircle, color: "bg-green-500/20 text-green-400 border-green-500/30" },
  incomplete: { label: "INCOMPLETE", icon: AlertTriangle, color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  no_data: { label: "NO DATA", icon: XCircle, color: "bg-red-500/20 text-red-400 border-red-500/30" },
};

interface ValidationError {
  field: string;
  message: string;
  suggestion: string;
}

function validateBlueprint(bp: BlueprintContextV1, templateRequiredBlocks?: string[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const seq = bp.block_sequence;

  // 1. Required blocks present
  if (templateRequiredBlocks && templateRequiredBlocks.length > 0) {
    const seqTypes = new Set(seq.map(b => b.block_type));
    for (const rb of templateRequiredBlocks) {
      if (!seqTypes.has(rb)) {
        errors.push({ field: `block_sequence (${rb})`, message: `Bloco obrigatório ausente no Blueprint: ${rb}`, suggestion: "Executar Rebuild para reconstruir a sequência" });
      }
    }
  }

  // 2. Continuous indices
  for (let i = 0; i < seq.length; i++) {
    if (seq[i].index !== i + 1) {
      errors.push({ field: `block_sequence[${i}].index`, message: `Índice inconsistente: esperado ${i + 1}, encontrado ${seq[i].index}`, suggestion: "Executar Rebuild para reindexar" });
      break;
    }
  }

  // 3. block_count_expected
  if (seq.length > 0 && bp.block_count_expected !== seq.length) {
    errors.push({ field: "block_count_expected", message: `Contagem inconsistente: block_count_expected=${bp.block_count_expected}, sequência tem ${seq.length}`, suggestion: "Executar Rebuild para sincronizar" });
  }

  // 4. Tolerances
  if (bp.hook_position_tolerance_pct == null) errors.push({ field: "hook_position_tolerance_pct", message: "Tolerância do Hook não definida", suggestion: "Executar Rebuild" });
  if (bp.payoff_position_tolerance_pct == null) errors.push({ field: "payoff_position_tolerance_pct", message: "Tolerância do Payoff não definida", suggestion: "Executar Rebuild" });
  if (bp.cta_position_tolerance_seconds == null) errors.push({ field: "cta_position_tolerance_seconds", message: "Tolerância do CTA não definida", suggestion: "Executar Rebuild" });

  // 5. RAW block_type
  for (const block of seq) {
    if (!VALID_RAW_TYPES.has(block.block_type)) {
      errors.push({ field: `block_sequence[${block.index}].block_type`, message: `block_type não está em formato RAW: "${block.block_type}"`, suggestion: "Executar Rebuild para normalizar" });
    }
  }

  // 6. Status coherence
  const shouldBeReady = seq.length > 0 &&
    seq.some(b => b.is_required) &&
    bp.dominant_emotion != null &&
    bp.hook_expected_position_pct != null &&
    bp.payoff_expected_position_pct != null;

  if (bp.status === "ready" && !shouldBeReady) {
    errors.push({ field: "status", message: "Status READY mas condições não atendidas", suggestion: "Executar Rebuild para recalcular status" });
  }
  if (bp.status !== "ready" && shouldBeReady && bp.status !== "no_data") {
    errors.push({ field: "status", message: "Status INCOMPLETE mas todas condições atendidas (deveria ser READY)", suggestion: "Executar Rebuild para recalcular status" });
  }

  return errors;
}

function FieldValue({ value, suffix }: { value: unknown; suffix?: string }) {
  if (value == null) return <span className="text-muted-foreground italic">Sem dados ainda</span>;
  return <span className="font-semibold text-foreground">{String(value)}{suffix ?? ""}</span>;
}

function StatusReason({ blueprint }: { blueprint: BlueprintContextV1 }) {
  if (blueprint.status === "ready") return null;
  if (blueprint.status === "no_data" || blueprint.block_sequence.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span><strong>Motivo do status:</strong> Sem Template Context disponível</span>
      </div>
    );
  }
  const missing: string[] = [];
  if (blueprint.block_sequence.length === 0) missing.push("Sequência de blocos");
  if (!blueprint.dominant_emotion) missing.push("Emoção dominante");
  if (blueprint.hook_expected_position_pct == null) missing.push("Posição do Hook");
  if (blueprint.payoff_expected_position_pct == null) missing.push("Posição do Payoff");
  if (missing.length === 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span><strong>Motivo do status:</strong> faltam: {missing.join(", ")}</span>
    </div>
  );
}

function ValidationReport({ errors }: { errors: ValidationError[] }) {
  const passed = errors.length === 0;
  return (
    <Card className={`md:col-span-2 ${passed ? "border-green-500/30" : "border-red-500/30"}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className={`h-4 w-4 ${passed ? "text-green-400" : "text-red-400"}`} />
          Blueprint Validation Result
        </CardTitle>
        <CardDescription>Verificação estrutural das 6 correções</CardDescription>
      </CardHeader>
      <CardContent>
        {passed ? (
          <div className="flex items-center gap-2 rounded-md bg-green-500/10 border border-green-500/30 px-4 py-3">
            <CheckCircle className="h-5 w-5 text-green-400 shrink-0" />
            <span className="text-sm font-semibold text-green-400">Blueprint V1 validado com sucesso — todas as verificações passaram</span>
          </div>
        ) : (
          <div className="space-y-2">
            {errors.map((err, i) => (
              <div key={i} className="rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm space-y-0.5">
                <div className="flex items-start gap-2">
                  <XCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                  <span className="text-red-300">{err.message}</span>
                </div>
                <div className="pl-6 text-xs text-muted-foreground">
                  <span className="font-mono">{err.field}</span> — {err.suggestion}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function BlueprintsViewPage() {
  const [blueprint, setBlueprint] = useState<BlueprintContextV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [templateRequiredBlocks, setTemplateRequiredBlocks] = useState<string[]>([]);

  useEffect(() => { loadExisting(); }, []);

  async function loadTemplateRequired(templateId: string | null) {
    if (!templateId) return [];
    try {
      const { loadTemplateContextById } = await import("@/lib/build-template-context-v1");
      const tpl = await loadTemplateContextById(templateId);
      if (tpl?.required_blocks) return tpl.required_blocks as string[];
    } catch {}
    return [];
  }

  async function loadExisting() {
    setLoading(true);
    try {
      const existing = await loadLatestBlueprintContext();
      if (existing) {
        const bp: BlueprintContextV1 = {
          id: existing.id,
          created_at: existing.created_at,
          source_template_context_id: existing.source_template_context_id,
          blueprint_name: existing.blueprint_name,
          block_sequence: (existing.block_sequence as unknown as BlueprintBlock[]) ?? [],
          block_count_expected: existing.block_count_expected,
          hook_expected_position_pct: existing.hook_expected_position_pct,
          payoff_expected_position_pct: existing.payoff_expected_position_pct,
          cta_expected_position_seconds: existing.cta_expected_position_seconds,
          hook_position_tolerance_pct: (existing as any).hook_position_tolerance_pct ?? 5,
          payoff_position_tolerance_pct: (existing as any).payoff_position_tolerance_pct ?? 5,
          cta_position_tolerance_seconds: (existing as any).cta_position_tolerance_seconds ?? 1,
          dominant_emotion: existing.dominant_emotion,
          dominant_cta_type: existing.dominant_cta_type,
          blueprint_rules: (existing.blueprint_rules as unknown as string[]) ?? [],
          status: existing.status as BlueprintContextV1["status"],
        };
        setBlueprint(bp);
        setSavedAt(existing.created_at);
        const reqBlocks = await loadTemplateRequired(existing.source_template_context_id);
        setTemplateRequiredBlocks(reqBlocks);
        setValidationErrors(validateBlueprint(bp, reqBlocks));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleRebuild() {
    setRebuilding(true);
    try {
      const obj = await buildBlueprintContextV1();
      const saved = await saveBlueprintContext(obj);
      const bp = { ...obj, id: saved.id, created_at: saved.created_at };
      setBlueprint(bp);
      setSavedAt(saved.created_at);

      // Load template required blocks for validation
      const reqBlocks = await loadTemplateRequired(obj.source_template_context_id);
      setTemplateRequiredBlocks(reqBlocks);
      const errs = validateBlueprint(bp, reqBlocks);
      setValidationErrors(errs);

      if (errs.length === 0) {
        toast.success("Blueprint V1 reconstruído e validado com sucesso");
      } else {
        toast.warning(`Blueprint reconstruído com ${errs.length} alerta(s) estrutural(is)`);
      }
    } catch (err: any) {
      console.error(err);
      toast.error("Erro ao reconstruir Blueprint: " + (err.message ?? ""));
    } finally {
      setRebuilding(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!blueprint) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layout className="h-6 w-6 text-primary" />
            Blueprint Context V1
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Nenhum blueprint gerado ainda.</p>
        </div>
        <Button onClick={handleRebuild} disabled={rebuilding}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${rebuilding ? "animate-spin" : ""}`} />
          Gerar Blueprint Context V1
        </Button>
      </div>
    );
  }

  const sc = statusConfig[blueprint.status];
  const StatusIcon = sc.icon;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layout className="h-6 w-6 text-primary" />
            {blueprint.blueprint_name}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Plano estrutural derivado do Template Context V1
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={`${sc.color} border px-3 py-1 text-xs font-bold`}>
            <StatusIcon className="h-3.5 w-3.5 mr-1" />
            {sc.label}
          </Badge>
          <Button onClick={handleRebuild} disabled={rebuilding} size="sm">
            <RefreshCw className={`h-4 w-4 mr-1.5 ${rebuilding ? "animate-spin" : ""}`} />
            Rebuild Blueprint
          </Button>
        </div>
      </div>

      <StatusReason blueprint={blueprint} />

      {savedAt && (
        <p className="text-xs text-muted-foreground">
          Última geração: {new Date(savedAt).toLocaleString("pt-BR")}
          {blueprint.id && <span className="ml-2 opacity-60">ID: {blueprint.id.slice(0, 8)}…</span>}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Validation Report */}
        <ValidationReport errors={validationErrors} />

        {/* Block Sequence */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Layout className="h-4 w-4 text-primary" />
              Estrutura do Blueprint
            </CardTitle>
            <CardDescription>Sequência de blocos narrativos esperada</CardDescription>
          </CardHeader>
          <CardContent>
            {blueprint.block_sequence.length === 0 ? (
              <span className="text-muted-foreground italic text-sm">Nenhuma sequência definida</span>
            ) : (
              <div className="space-y-2">
                {blueprint.block_sequence.map((block) => (
                  <div key={block.index} className="flex items-center gap-3 py-1.5 px-3 rounded-md bg-muted/30 border border-border">
                    <span className="text-xs font-mono text-muted-foreground w-14">Bloco {block.index}</span>
                    <span className="font-semibold text-foreground">{formatBlockName(block.block_type)}</span>
                    <Badge variant="outline" className={`ml-auto text-xs ${block.is_required ? "border-green-500/40 text-green-400" : "border-muted-foreground/30 text-muted-foreground"}`}>
                      {block.is_required ? "Obrigatório" : "Opcional"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
            {blueprint.block_count_expected != null && (
              <p className="text-xs text-muted-foreground mt-3">
                Quantidade esperada de blocos: <strong>{blueprint.block_count_expected}</strong>
              </p>
            )}
          </CardContent>
        </Card>

        {/* Positions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Tempo Esperado
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Hook Position (%)</span>
              <FieldValue value={blueprint.hook_expected_position_pct} suffix={`% (±${blueprint.hook_position_tolerance_pct}%)`} />
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Payoff Position (%)</span>
              <FieldValue value={blueprint.payoff_expected_position_pct} suffix={`% (±${blueprint.payoff_position_tolerance_pct}%)`} />
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">CTA Position</span>
              <FieldValue value={blueprint.cta_expected_position_seconds} suffix={`s (±${blueprint.cta_position_tolerance_seconds}s)`} />
            </div>
          </CardContent>
        </Card>

        {/* Emotion & CTA */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Heart className="h-4 w-4 text-primary" />
              Emoção & CTA
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Dominant Emotion</span>
              <FieldValue value={blueprint.dominant_emotion} />
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Dominant CTA Type</span>
              <FieldValue value={blueprint.dominant_cta_type} />
            </div>
          </CardContent>
        </Card>

        {/* Rules */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-primary" />
              Blueprint Rules
            </CardTitle>
            <CardDescription>Regras estruturais derivadas do Template</CardDescription>
          </CardHeader>
          <CardContent>
            {blueprint.blueprint_rules.length === 0 ? (
              <span className="text-muted-foreground italic text-sm">Nenhuma regra gerada</span>
            ) : (
              <ul className="space-y-1.5">
                {blueprint.blueprint_rules.map((rule, i) => (
                  <li key={i} className="text-sm text-foreground flex items-start gap-2">
                    <span className="text-primary mt-0.5">•</span>
                    {rule}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
