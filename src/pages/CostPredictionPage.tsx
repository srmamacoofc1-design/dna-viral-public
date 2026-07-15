import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  DollarSign, Cpu, Zap, BarChart3, TrendingUp, AlertTriangle,
  CheckCircle, Info, Video, Layers
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend
} from "recharts";

// Cost constants (Gemini 2.5 Flash via Lovable AI gateway)
const TOKEN_COST_INPUT = 0.15 / 1_000_000;   // $0.15 per 1M input tokens
const TOKEN_COST_OUTPUT = 0.60 / 1_000_000;  // $0.60 per 1M output tokens
const FREE_MONTHLY_BALANCE = 1.0; // $1 free AI balance

// Estimated tokens per pipeline step (input + output)
const PIPELINE_STEPS = [
  { key: "analyze-narrative", label: "Análise Narrativa (v2)", avgInputTokens: 2800, avgOutputTokens: 1200, description: "Segmentação de blocos narrativos com IA" },
  { key: "extract-visual-blocks", label: "Extração Visual", avgInputTokens: 3500, avgOutputTokens: 1500, description: "Análise de frames e blocos visuais" },
  { key: "extract-block-semantics", label: "Semântica de Blocos", avgInputTokens: 2200, avgOutputTokens: 900, description: "Padrões semânticos por bloco" },
  { key: "extract-verbal-dna", label: "DNA Verbal", avgInputTokens: 2000, avgOutputTokens: 800, description: "Extração de padrões verbais" },
  { key: "extract-cta-deep", label: "CTA Deep", avgInputTokens: 1800, avgOutputTokens: 700, description: "Análise profunda de CTAs" },
  { key: "calculate-text-image", label: "Compatibilidade Texto-Imagem", avgInputTokens: 1500, avgOutputTokens: 600, description: "Alinhamento texto vs visual" },
  { key: "extract-viral-combinations", label: "Combinações Virais", avgInputTokens: 2500, avgOutputTokens: 1000, description: "Extração de combinações narrativas" },
  { key: "judge-narrative", label: "Juiz Narrativo", avgInputTokens: 3000, avgOutputTokens: 1200, description: "Validação de frases candidatas com LLM" },
];

function calculateStepCost(step: typeof PIPELINE_STEPS[0]) {
  return step.avgInputTokens * TOKEN_COST_INPUT + step.avgOutputTokens * TOKEN_COST_OUTPUT;
}

const COST_PER_VIDEO = PIPELINE_STEPS.reduce((sum, s) => sum + calculateStepCost(s), 0);

const COLORS = [
  "hsl(var(--primary))",
  "hsl(210, 70%, 55%)",
  "hsl(160, 60%, 45%)",
  "hsl(45, 80%, 55%)",
  "hsl(340, 65%, 55%)",
  "hsl(270, 55%, 60%)",
  "hsl(20, 70%, 55%)",
  "hsl(190, 60%, 50%)",
];

export default function CostPredictionPage() {
  const { data: stats } = useQuery({
    queryKey: ["cost-prediction-stats"],
    queryFn: async () => {
      const [videosRes, blocksRes, judgeRes] = await Promise.all([
        supabase.from("videos").select("id, titulo, numero_blocos, duracao, status, created_at", { count: "exact" }),
        supabase.from("video_blocks").select("id", { count: "exact", head: true }),
        supabase.from("narrative_judge_results").select("id, processing_time_ms, model, created_at", { count: "exact" }),
      ]);

      const videos = videosRes.data || [];
      const totalVideos = videosRes.count || 0;
      const completedVideos = videos.filter(v => v.status === "completed").length;
      const pendingVideos = videos.filter(v => v.status === "pending" || v.status === "processing").length;
      const totalBlocks = blocksRes.count || 0;
      const totalJudgeResults = judgeRes.count || 0;
      const avgBlocks = completedVideos > 0 ? totalBlocks / completedVideos : 7.5;

      return {
        totalVideos,
        completedVideos,
        pendingVideos,
        totalBlocks,
        totalJudgeResults,
        avgBlocks,
        videos,
      };
    },
  });

  const totalVideos = stats?.totalVideos || 0;
  const completedVideos = stats?.completedVideos || 0;
  const pendingVideos = stats?.pendingVideos || 0;
  const totalBlocks = stats?.totalBlocks || 0;
  const avgBlocks = stats?.avgBlocks || 7.5;

  const totalSpent = completedVideos * COST_PER_VIDEO;
  const pendingCost = pendingVideos * COST_PER_VIDEO;
  const remainingBalance = Math.max(0, FREE_MONTHLY_BALANCE - totalSpent);
  const videosRemaining = remainingBalance > 0 ? Math.floor(remainingBalance / COST_PER_VIDEO) : 0;
  const balanceUsedPct = Math.min(100, (totalSpent / FREE_MONTHLY_BALANCE) * 100);

  // Per-step cost breakdown for chart
  const stepCostData = PIPELINE_STEPS.map((s, i) => ({
    name: s.label,
    cost: +(calculateStepCost(s) * 1000).toFixed(3), // in millidollars for readability
    tokens: s.avgInputTokens + s.avgOutputTokens,
    color: COLORS[i % COLORS.length],
  }));

  // Pie data for token distribution
  const pieData = PIPELINE_STEPS.map((s, i) => ({
    name: s.label.length > 18 ? s.label.slice(0, 16) + "…" : s.label,
    value: s.avgInputTokens + s.avgOutputTokens,
    fill: COLORS[i % COLORS.length],
  }));

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-primary" />
            Previsão de Custos AI
          </h1>
          <p className="text-muted-foreground mt-1">
            Estimativa de consumo do saldo Cloud & AI por vídeo processado
          </p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <DollarSign className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Custo por vídeo</p>
                  <p className="text-2xl font-bold text-foreground">
                    ${COST_PER_VIDEO.toFixed(4)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Gasto estimado total</p>
                  <p className="text-2xl font-bold text-foreground">
                    ${totalSpent.toFixed(4)}
                  </p>
                  <p className="text-xs text-muted-foreground">{completedVideos} vídeos processados</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-yellow-500/10">
                  <TrendingUp className="w-5 h-5 text-yellow-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Saldo restante estimado</p>
                  <p className="text-2xl font-bold text-foreground">
                    ${remainingBalance.toFixed(4)}
                  </p>
                  <p className="text-xs text-muted-foreground">≈ {videosRemaining} vídeos restantes</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/10">
                  <AlertTriangle className="w-5 h-5 text-orange-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Custo pendente</p>
                  <p className="text-2xl font-bold text-foreground">
                    ${pendingCost.toFixed(4)}
                  </p>
                  <p className="text-xs text-muted-foreground">{pendingVideos} na fila</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Balance Progress */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              Uso do Saldo Mensal Gratuito ($1.00)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={balanceUsedPct} className="h-3" />
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>${totalSpent.toFixed(4)} usado</span>
              <span>{balanceUsedPct.toFixed(1)}%</span>
              <span>${FREE_MONTHLY_BALANCE.toFixed(2)} total</span>
            </div>
            {balanceUsedPct > 80 && (
              <div className="flex items-center gap-2 text-sm text-orange-500 bg-orange-500/10 p-2 rounded-lg">
                <AlertTriangle className="w-4 h-4" />
                Saldo mensal próximo do limite. Considere fazer top-up em Settings → Cloud & AI balance.
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Cost per Step Bar Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-primary" />
                Custo por Etapa (mili-dólares)
              </CardTitle>
              <CardDescription>Custo estimado de cada chamada AI por vídeo</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={stepCostData} layout="vertical" margin={{ left: 10 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" width={130} tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(value: number) => [`$${(value / 1000).toFixed(5)}`, "Custo"]}
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                    labelStyle={{ color: "hsl(var(--foreground))" }}
                  />
                  <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                    {stepCostData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Token Distribution Pie */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Cpu className="w-5 h-5 text-primary" />
                Distribuição de Tokens por Etapa
              </CardTitle>
              <CardDescription>
                Total estimado: {PIPELINE_STEPS.reduce((s, p) => s + p.avgInputTokens + p.avgOutputTokens, 0).toLocaleString()} tokens/vídeo
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {pieData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Pipeline Steps Detail */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Layers className="w-5 h-5 text-primary" />
              Detalhamento do Pipeline
            </CardTitle>
            <CardDescription>Cada vídeo passa por {PIPELINE_STEPS.length} etapas de IA</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {PIPELINE_STEPS.map((step, i) => {
                const cost = calculateStepCost(step);
                const totalTokens = step.avgInputTokens + step.avgOutputTokens;
                return (
                  <div key={step.key} className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-lg bg-secondary/30">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{step.label}</p>
                        <p className="text-xs text-muted-foreground">{step.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <Badge variant="outline" className="whitespace-nowrap">
                        {totalTokens.toLocaleString()} tokens
                      </Badge>
                      <Badge variant="secondary" className="whitespace-nowrap">
                        ${cost.toFixed(5)}
                      </Badge>
                    </div>
                  </div>
                );
              })}
              <Separator />
              <div className="flex items-center justify-between p-3 bg-primary/5 rounded-lg">
                <span className="font-semibold text-foreground">Total por vídeo</span>
                <div className="flex items-center gap-3">
                  <Badge variant="outline">
                    {PIPELINE_STEPS.reduce((s, p) => s + p.avgInputTokens + p.avgOutputTokens, 0).toLocaleString()} tokens
                  </Badge>
                  <Badge className="bg-primary text-primary-foreground">
                    ${COST_PER_VIDEO.toFixed(4)}
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Projection Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Video className="w-5 h-5 text-primary" />
              Projeção de Custos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Cenário</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-medium">Vídeos</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-medium">Tokens</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-medium">Custo</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[10, 25, 50, 100, 200, 500].map(n => {
                    const cost = n * COST_PER_VIDEO;
                    const tokens = n * PIPELINE_STEPS.reduce((s, p) => s + p.avgInputTokens + p.avgOutputTokens, 0);
                    const withinFree = cost <= FREE_MONTHLY_BALANCE;
                    return (
                      <tr key={n} className="border-b border-border/50 hover:bg-secondary/20">
                        <td className="py-2 px-3 text-foreground">{n} vídeos</td>
                        <td className="py-2 px-3 text-right text-foreground">{n}</td>
                        <td className="py-2 px-3 text-right text-muted-foreground">{tokens.toLocaleString()}</td>
                        <td className="py-2 px-3 text-right font-medium text-foreground">${cost.toFixed(2)}</td>
                        <td className="py-2 px-3 text-right">
                          {withinFree ? (
                            <Badge variant="outline" className="text-green-500 border-green-500/30">
                              <CheckCircle className="w-3 h-3 mr-1" /> Grátis
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-orange-500 border-orange-500/30">
                              <AlertTriangle className="w-3 h-3 mr-1" /> Top-up
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Info */}
        <Card className="border-blue-500/20 bg-blue-500/5">
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-muted-foreground space-y-1">
                <p><strong className="text-foreground">Nota:</strong> Os valores são estimativas baseadas no consumo médio de tokens por etapa do pipeline.</p>
                <p>O custo real pode variar ±20% dependendo do tamanho do vídeo, número de blocos e complexidade da transcrição.</p>
                <p>Gerencie seu saldo em <strong className="text-foreground">Settings → Cloud & AI balance</strong>.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
