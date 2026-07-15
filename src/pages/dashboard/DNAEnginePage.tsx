import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, Dna, Info, FlaskConical, Scale, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { buildDNAObjectV1, saveDNAObject } from "@/lib/build-dna-object-v1";

export default function DNAEnginePage() {
  const [rebuilding, setRebuilding] = useState(false);
  const [formalizing, setFormalizing] = useState(false);
  const [calcWeights, setCalcWeights] = useState(false);
  const [judging, setJudging] = useState(false);

  async function handleRebuild() {
    setRebuilding(true);
    try {
      const obj = await buildDNAObjectV1();
      await saveDNAObject(obj);
      toast.success("DNA Object V1 reconstruído com sucesso");
    } catch (err: any) {
      console.error(err);
      toast.error("Erro ao reconstruir: " + (err.message ?? ""));
    } finally {
      setRebuilding(false);
    }
  }

  async function handleFormalize() {
    setFormalizing(true);
    try {
      const { data, error } = await supabase.functions.invoke("formalize-dna-v2");
      if (error) throw new Error(error.message);
      toast.success(`DNA Formal gerado: ${data?.version_name ?? "OK"}`);
    } catch (err: any) {
      console.error(err);
      toast.error("Erro ao formalizar DNA: " + (err.message ?? ""));
    } finally {
      setFormalizing(false);
    }
  }

  async function handleCalcWeights() {
    setCalcWeights(true);
    try {
      const { data, error } = await supabase.functions.invoke("calculate-pattern-weights");
      if (error) throw new Error(error.message);
      const count = data?.total_patterns_saved ?? data?.patterns_count ?? "OK";
      toast.success(`Pattern Weights calculados: ${count} padrões`);
    } catch (err: any) {
      console.error(err);
      toast.error("Erro ao calcular pesos: " + (err.message ?? ""));
    } finally {
      setCalcWeights(false);
    }
  }

  async function handleJudgeNarrative() {
    setJudging(true);
    try {
      const { data, error } = await supabase.functions.invoke("judge-narrative");
      if (error) throw new Error(error.message);
      const judged = data?.total_judged ?? data?.judged_count ?? "OK";
      toast.success(`Narrative Judge executado: ${judged} unidades avaliadas`);
    } catch (err: any) {
      console.error(err);
      toast.error("Erro ao executar Judge: " + (err.message ?? ""));
    } finally {
      setJudging(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Dna className="h-6 w-6 text-primary" />
          Build DNA Objects
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Reconstrução, formalização e análise de padrões do sistema
        </p>
      </div>

      {/* DNA Object V1 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Dna className="h-4 w-4 text-green-400" />
            DNA Object V1
          </CardTitle>
          <CardDescription>
            Consolida sequência dominante, blocos obrigatórios, métricas temporais, emoções e performance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Usa todos os vídeos completados para gerar o objeto DNA operacional.</span>
          </div>
          <Button onClick={handleRebuild} disabled={rebuilding}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${rebuilding ? "animate-spin" : ""}`} />
            Rebuild DNA Object
          </Button>
        </CardContent>
      </Card>

      {/* Formalize DNA V2 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-teal-400" />
            Formalizar DNA V2
          </CardTitle>
          <CardDescription>
            Consolida o DNA Base V2 em um objeto formal estruturado (estrutural, temporal, verbal, emocional, performance).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleFormalize} disabled={formalizing} variant="outline">
            <RefreshCw className={`h-4 w-4 mr-1.5 ${formalizing ? "animate-spin" : ""}`} />
            Executar Formalização
          </Button>
        </CardContent>
      </Card>

      {/* Calculate Pattern Weights */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Scale className="h-4 w-4 text-amber-400" />
            Calcular Pesos de Padrões
          </CardTitle>
          <CardDescription>
            Calcula correlação de performance por tipo de bloco, emoção, tom verbal e estrutura narrativa.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleCalcWeights} disabled={calcWeights} variant="outline">
            <RefreshCw className={`h-4 w-4 mr-1.5 ${calcWeights ? "animate-spin" : ""}`} />
            Calcular Pattern Weights
          </Button>
        </CardContent>
      </Card>

      {/* Judge Narrative */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-purple-400" />
            Judge Narrative
          </CardTitle>
          <CardDescription>
            Avalia unidades narrativas dos blocos e classifica se são replicáveis para DNA.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleJudgeNarrative} disabled={judging} variant="outline">
            <RefreshCw className={`h-4 w-4 mr-1.5 ${judging ? "animate-spin" : ""}`} />
            Executar Narrative Judge
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
