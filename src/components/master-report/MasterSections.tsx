import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import type { MasterData } from "@/lib/master-system-data";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";

// ── helpers ──
const fmt = (v: any) => (v == null ? "—" : typeof v === "number" ? v.toLocaleString("pt-BR") : String(v));
const fmtPct = (v: any) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);
const fmtDec = (v: any, d = 2) => (v == null ? "—" : Number(v).toFixed(d));
const fmtDate = (d: string) => new Date(d).toLocaleString("pt-BR");
const PIE_COLORS = ["hsl(var(--primary))", "hsl(45 93% 47%)", "hsl(0 84% 60%)", "hsl(200 80% 50%)", "hsl(280 60% 55%)", "hsl(160 70% 40%)"];

// ── Executive Summary Box ──
function ExecSummary({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Card className="border-l-4 border-l-primary/60 bg-primary/5">
      <CardContent className="pt-4 pb-3">
        <p className="text-xs font-bold uppercase tracking-wider text-primary mb-2">Resumo Executivo</p>
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="text-sm text-foreground flex items-start gap-2">
              <span className="text-primary mt-0.5 shrink-0">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ── KPI Card ──
function KPI({ value, label, accent }: { value: React.ReactNode; label: string; accent?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4 text-center">
        <div className={`text-2xl font-bold ${accent ? "text-primary" : ""}`}>{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </CardContent>
    </Card>
  );
}

// ── JSON to key-value table ──
function JsonTable({ data, maxRows }: { data: Record<string, any> | null | undefined; maxRows?: number }) {
  if (!data || typeof data !== "object") return <p className="text-xs text-muted-foreground">Sem dados.</p>;
  
  const entries = Object.entries(data);
  const visible = maxRows ? entries.slice(0, maxRows) : entries;
  
  return (
    <Table>
      <TableHeader>
        <TableRow><TableHead className="w-1/3">Campo</TableHead><TableHead>Valor</TableHead></TableRow>
      </TableHeader>
      <TableBody>
        {visible.map(([key, val]) => (
          <TableRow key={key}>
            <TableCell className="font-medium text-xs capitalize">{key.replace(/_/g, " ")}</TableCell>
            <TableCell className="text-xs">
              {val === null || val === undefined ? "—" :
                typeof val === "object" ? (
                  Array.isArray(val)
                    ? val.length === 0 ? "—" : val.slice(0, 5).map(String).join(", ") + (val.length > 5 ? ` (+${val.length - 5})` : "")
                    : Object.keys(val).length === 0 ? "—" : Object.entries(val).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(", ") + (Object.keys(val).length > 3 ? " ..." : "")
                ) : String(val)}
            </TableCell>
          </TableRow>
        ))}
        {maxRows && entries.length > maxRows && (
          <TableRow><TableCell colSpan={2} className="text-xs text-muted-foreground text-center">
            +{entries.length - maxRows} campos adicionais
          </TableCell></TableRow>
        )}
      </TableBody>
    </Table>
  );
}

// ── Section wrapper with divider ──
function Section({ id, title, icon, children }: { id: string; title: string; icon: string; children: React.ReactNode }) {
  return (
    <div id={id} className="print:break-before-page space-y-5">
      <Separator className="my-2" />
      <h2 className="text-xl font-bold flex items-center gap-2 border-b border-border pb-3">
        <span className="text-2xl">{icon}</span> {title}
      </h2>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════
// 3 — DNA BASE V2
// ═══════════════════════════════════════════
export function SectionDNABase({ data }: { data: MasterData }) {
  const d = data.dnaBase;

  const segBreakdown = useMemo(() => {
    if (!d?.segment_breakdown || typeof d.segment_breakdown !== "object") return [];
    return Object.entries(d.segment_breakdown).map(([k, v]: any) => ({ name: k, count: v?.count ?? v ?? 0 }));
  }, [d]);

  const ctaDist = useMemo(() => {
    if (!d?.cta_distribution || typeof d.cta_distribution !== "object") return [];
    return Object.entries(d.cta_distribution).map(([k, v]: any) => ({ name: k, count: v ?? 0 }));
  }, [d]);

  if (!d) return <Section id="sec-dna-base" title="3 — DNA BASE V2" icon="🧬"><p className="text-muted-foreground">Nenhum DNA Base encontrado.</p></Section>;

  const summaryItems = [
    `Estrutura dominante: ${d.dominant_structure_sequence || "não identificada"}`,
    `CTA dominante: ${d.dominant_cta_pattern || "não identificado"}`,
    `Densidade verbal média: ${d.verbal_density != null ? Number(d.verbal_density).toFixed(2) : "—"}`,
    `Arco emocional recorrente: ${d.dominant_emotional_arc || "não identificado"}`,
    `Base construída com ${fmt(d.total_videos_used)} vídeos e ${fmt(d.total_blocks_used)} blocos`,
    d.dominant_verbal_pattern ? `Padrão verbal dominante: ${d.dominant_verbal_pattern}` : null,
  ].filter(Boolean) as string[];

  return (
    <Section id="sec-dna-base" title="3 — DNA BASE V2" icon="🧬">
      <ExecSummary items={summaryItems} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI value={fmt(d.total_videos_used)} label="Vídeos Usados" />
        <KPI value={fmt(d.total_blocks_used)} label="Blocos Usados" />
        <KPI value={fmtDec(d.avg_density)} label="Densidade Média" />
        <KPI value={fmtDec(d.verbal_density)} label="Densidade Verbal" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Parâmetros do DNA</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div className="flex justify-between py-1 border-b border-border/50"><span className="text-muted-foreground">Versão</span><span className="font-medium">{d.version_name}</span></div>
            <div className="flex justify-between py-1 border-b border-border/50"><span className="text-muted-foreground">Dataset</span><span className="font-medium">{d.dataset_type}</span></div>
            <div className="flex justify-between py-1 border-b border-border/50"><span className="text-muted-foreground">Sequência Estrutural</span><span className="font-medium">{d.dominant_structure_sequence || "—"}</span></div>
            <div className="flex justify-between py-1 border-b border-border/50"><span className="text-muted-foreground">Arco Emocional</span><span className="font-medium">{d.dominant_emotional_arc || "—"}</span></div>
            <div className="flex justify-between py-1 border-b border-border/50"><span className="text-muted-foreground">Padrão Verbal</span><span className="font-medium">{d.dominant_verbal_pattern || "—"}</span></div>
            <div className="flex justify-between py-1 border-b border-border/50"><span className="text-muted-foreground">Padrão CTA</span><span className="font-medium">{d.dominant_cta_pattern || "—"}</span></div>
            <div className="flex justify-between py-1"><span className="text-muted-foreground">Gerado em</span><span className="font-medium">{fmtDate(d.generated_at)}</span></div>
          </div>
        </CardContent>
      </Card>

      {segBreakdown.length > 0 && (
        <Card><CardHeader><CardTitle className="text-sm">Distribuição por Segmento</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={segBreakdown}><XAxis dataKey="name" fontSize={10} /><YAxis /><Tooltip /><Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} /></BarChart>
            </ResponsiveContainer>
          </CardContent></Card>
      )}

      {ctaDist.length > 0 && (
        <Card><CardHeader><CardTitle className="text-sm">Distribuição CTA</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart><Pie data={ctaDist} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                {ctaDist.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie><Legend /><Tooltip /></PieChart>
            </ResponsiveContainer>
          </CardContent></Card>
      )}

      {d.formula_registry_snapshot && typeof d.formula_registry_snapshot === "object" && Object.keys(d.formula_registry_snapshot).length > 0 && (
        <Card><CardHeader><CardTitle className="text-sm">Formula Registry</CardTitle></CardHeader>
          <CardContent><JsonTable data={d.formula_registry_snapshot as Record<string, any>} /></CardContent>
        </Card>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════
// 4 — DNA FORMAL V1
// ═══════════════════════════════════════════
export function SectionDNAFormal({ data }: { data: MasterData }) {
  const d = data.dnaFormal;
  if (!d) return <Section id="sec-dna-formal" title="4 — DNA FORMAL V1" icon="🔬"><p className="text-muted-foreground">Nenhum DNA Formal encontrado.</p></Section>;

  const summaryItems = [
    `Formalização baseada em ${fmt(d.total_videos_used)} vídeos e ${fmt(d.total_blocks_used)} blocos`,
    `Versão: ${d.version_name}`,
    d.structural && typeof d.structural === "object" ? `Dimensão estrutural: ${Object.keys(d.structural).length} parâmetros mapeados` : null,
    d.emotional && typeof d.emotional === "object" ? `Dimensão emocional: ${Object.keys(d.emotional).length} parâmetros mapeados` : null,
    d.verbal && typeof d.verbal === "object" ? `Dimensão verbal: ${Object.keys(d.verbal).length} parâmetros mapeados` : null,
    `Gerado em: ${fmtDate(d.generated_at)}`,
  ].filter(Boolean) as string[];

  const renderDimension = (label: string, icon: string, obj: any) => {
    if (!obj || typeof obj !== "object" || Object.keys(obj).length === 0) return null;
    return (
      <Card key={label}>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><span>{icon}</span> {label}</CardTitle></CardHeader>
        <CardContent><JsonTable data={obj as Record<string, any>} maxRows={15} /></CardContent>
      </Card>
    );
  };

  return (
    <Section id="sec-dna-formal" title="4 — DNA FORMAL V1" icon="🔬">
      <ExecSummary items={summaryItems} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI value={fmt(d.total_videos_used)} label="Vídeos" />
        <KPI value={fmt(d.total_blocks_used)} label="Blocos" />
        <KPI value={d.version_name} label="Versão" />
        <KPI value={fmtDate(d.generated_at).split(",")[0]} label="Gerado em" />
      </div>

      <div className="space-y-4">
        {renderDimension("Estrutural", "🏗️", d.structural)}
        {renderDimension("Emocional", "💡", d.emotional)}
        {renderDimension("Verbal", "💬", d.verbal)}
        {renderDimension("Temporal", "⏱️", d.temporal)}
        {renderDimension("Performance", "📈", d.performance)}
        {renderDimension("Consistency Check", "✅", d.consistency_check)}
        {renderDimension("Fontes de Dados", "📂", Array.isArray(d.data_sources_used) ? Object.fromEntries(d.data_sources_used.map((s: any, i: number) => [i + 1, s])) : d.data_sources_used)}
      </div>
    </Section>
  );
}

// ═══════════════════════════════════════════
// 5 — DATA READINESS
// ═══════════════════════════════════════════
export function SectionDataReadiness({ data }: { data: MasterData }) {
  const r = data.readinessReport;
  if (!r) return <Section id="sec-readiness" title="5 — DATA READINESS REPORT" icon="✅"><p className="text-muted-foreground">Nenhum relatório de readiness encontrado.</p></Section>;

  const report = r.report_json as any;
  const dims = report?.dimension_summary;

  const summaryItems = [
    `Score de prontidão: ${r.readiness_score}%`,
    `Status: ${r.validation_status}`,
    `Total de vídeos analisados: ${r.total_videos}`,
    `Total de blocos validados: ${r.total_blocks}`,
    dims ? `Dimensões auditadas: ${Object.keys(dims).length}` : null,
  ].filter(Boolean) as string[];

  return (
    <Section id="sec-readiness" title="5 — DATA READINESS REPORT" icon="✅">
      <ExecSummary items={summaryItems} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI value={`${r.readiness_score}%`} label="Score" accent />
        <KPI value={r.total_videos} label="Vídeos" />
        <KPI value={r.total_blocks} label="Blocos" />
        <KPI value={<Badge variant={r.validation_status === "READY_FOR_PHASE_2" ? "default" : "secondary"}>{r.validation_status}</Badge>} label="Status" />
      </div>

      {dims && (
        <Card><CardHeader><CardTitle className="text-sm">Validação por Dimensão</CardTitle></CardHeader>
          <CardContent>
            <Table><TableHeader><TableRow>
              <TableHead>Dimensão</TableHead><TableHead className="text-center">Status</TableHead><TableHead className="text-center">Pass Rate</TableHead><TableHead className="text-center">Issues</TableHead>
            </TableRow></TableHeader>
              <TableBody>
                {Object.entries(dims).map(([dim, d]: any) => (
                  <TableRow key={dim}>
                    <TableCell className="font-medium capitalize">{dim.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-center"><Badge variant={d.status === "PASS" ? "default" : "secondary"}>{d.status}</Badge></TableCell>
                    <TableCell className="text-center">{fmtPct(d.pass_rate)}</TableCell>
                    <TableCell className="text-center">{d.total_issues}</TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
          </CardContent></Card>
      )}

      {report && !dims && (
        <Card><CardHeader><CardTitle className="text-sm">Detalhes do Relatório</CardTitle></CardHeader>
          <CardContent><JsonTable data={report} maxRows={20} /></CardContent>
        </Card>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════
// 6 — MASTER READINESS
// ═══════════════════════════════════════════
export function SectionMasterReadiness({ data }: { data: MasterData }) {
  const r = data.readinessReport;
  if (!r) return <Section id="sec-master-readiness" title="6 — MASTER READINESS REPORT" icon="📋"><p className="text-muted-foreground">Sem dados.</p></Section>;
  const report = r.report_json as any;
  const dims = report?.dimension_summary;
  const videoReports = report?.video_reports as any[] ?? [];

  const readyCount = videoReports.filter((v: any) => v.status === "READY").length;
  const summaryItems = [
    `${videoReports.length} vídeos auditados individualmente`,
    `${readyCount} vídeos prontos (${videoReports.length > 0 ? ((readyCount / videoReports.length) * 100).toFixed(0) : 0}%)`,
    dims ? `${Object.keys(dims).length} dimensões de integridade validadas` : null,
    `Score geral do sistema: ${r.readiness_score}%`,
  ].filter(Boolean) as string[];

  return (
    <Section id="sec-master-readiness" title="6 — MASTER READINESS REPORT" icon="📋">
      <ExecSummary items={summaryItems} />

      {dims && (
        <Card><CardHeader><CardTitle className="text-sm">Validação por Dimensão</CardTitle></CardHeader>
          <CardContent>
            <Table><TableHeader><TableRow>
              <TableHead>Dimensão</TableHead><TableHead className="text-center">Status</TableHead><TableHead className="text-center">Pass Rate</TableHead><TableHead className="text-center">Issues</TableHead>
            </TableRow></TableHeader>
              <TableBody>
                {Object.entries(dims).map(([dim, d]: any) => (
                  <TableRow key={dim}>
                    <TableCell className="font-medium capitalize">{dim.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-center"><Badge variant={d.status === "PASS" ? "default" : "secondary"}>{d.status}</Badge></TableCell>
                    <TableCell className="text-center">{fmtPct(d.pass_rate)}</TableCell>
                    <TableCell className="text-center">{d.total_issues}</TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
          </CardContent></Card>
      )}

      {videoReports.length > 0 && (
        <Card><CardHeader><CardTitle className="text-sm">Relatório por Vídeo ({videoReports.length})</CardTitle></CardHeader>
          <CardContent>
            <Table><TableHeader><TableRow>
              <TableHead>Título</TableHead><TableHead className="text-center">Blocos</TableHead><TableHead className="text-center">c/ Texto</TableHead><TableHead className="text-center">c/ Verbal</TableHead><TableHead className="text-center">Issues</TableHead><TableHead className="text-center">Status</TableHead>
            </TableRow></TableHeader>
              <TableBody>
                {videoReports.map((v: any) => (
                  <TableRow key={v.video_id}>
                    <TableCell className="text-xs max-w-[200px] truncate">{v.video_title}</TableCell>
                    <TableCell className="text-center">{v.total_blocks}</TableCell>
                    <TableCell className="text-center">{v.blocks_with_text}</TableCell>
                    <TableCell className="text-center">{v.blocks_with_verbal}</TableCell>
                    <TableCell className="text-center">{v.issues_count}</TableCell>
                    <TableCell className="text-center"><Badge variant={v.status === "READY" ? "default" : "secondary"}>{v.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
          </CardContent></Card>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════
// 7 — VERBAL INTELLIGENCE
// ═══════════════════════════════════════════
export function SectionVerbalIntelligence({ data }: { data: MasterData }) {
  const totalUnits = data.verbalSummary.reduce((s, v) => s + (v.total_canonical_units || 0), 0);
  const avgStrength = data.verbalSummary.length > 0
    ? (data.verbalSummary.reduce((s, v) => s + Number(v.avg_replicability_score || 0), 0) / data.verbalSummary.length).toFixed(2)
    : "—";
  const topFunction = data.verbalSummary.sort((a, b) => (b.total_canonical_units || 0) - (a.total_canonical_units || 0))[0];

  const summaryItems = [
    `${data.verbalSummary.length} funções narrativas mapeadas`,
    `${totalUnits} unidades canônicas no total`,
    `Intensidade verbal média: ${avgStrength}`,
    topFunction ? `Função mais frequente: ${topFunction.narrative_function} (${topFunction.total_canonical_units} unidades)` : null,
    data.verbalLayerPatterns.length > 0 ? `${data.verbalLayerPatterns.length} camadas de padrão verbal analisadas` : null,
    data.canonicalUnits.length > 0 ? `Top ${Math.min(data.canonicalUnits.length, 100)} unidades canônicas exibidas` : null,
  ].filter(Boolean) as string[];

  return (
    <Section id="sec-verbal" title="7 — VERBAL INTELLIGENCE REPORT" icon="🧠">
      {data.verbalSummary.length === 0 ? <p className="text-muted-foreground">Sem dados de inteligência verbal.</p> : (
        <>
          <ExecSummary items={summaryItems} />

          <Card><CardHeader><CardTitle className="text-sm">Sumário por Função Narrativa ({data.verbalSummary.length})</CardTitle></CardHeader>
            <CardContent>
              <Table><TableHeader><TableRow>
                <TableHead>Função</TableHead><TableHead className="text-center">Units</TableHead><TableHead className="text-center">Intensidade</TableHead><TableHead className="text-center">Intensidade Verbal</TableHead><TableHead className="text-center">Replicabilidade</TableHead><TableHead>Emoção 1ª</TableHead><TableHead>Emoção 2ª</TableHead>
              </TableRow></TableHeader>
                <TableBody>{data.verbalSummary.map((s) => (
                  <TableRow key={s.id}><TableCell className="font-medium">{s.narrative_function}</TableCell><TableCell className="text-center">{s.total_canonical_units}</TableCell><TableCell className="text-center">{fmtDec(s.avg_emotional_intensity, 1)}</TableCell><TableCell className="text-center">{fmtDec(s.avg_replicability_score)}</TableCell><TableCell className="text-center">{fmtDec(s.avg_replicability)}</TableCell><TableCell>{s.primary_emotion || "—"}</TableCell><TableCell>{s.secondary_emotion || "—"}</TableCell></TableRow>
                ))}</TableBody></Table>
            </CardContent></Card>

          {data.verbalLayerPatterns.length > 0 && (
            <Card><CardHeader><CardTitle className="text-sm">Padrões por Camada ({data.verbalLayerPatterns.length})</CardTitle></CardHeader>
              <CardContent>
                <Table><TableHeader><TableRow><TableHead>Layer</TableHead><TableHead className="text-center">Vídeos</TableHead><TableHead className="text-center">Blocos</TableHead><TableHead className="text-center">Engagement Rate</TableHead><TableHead className="text-center">Intensidade</TableHead></TableRow></TableHeader>
                  <TableBody>{data.verbalLayerPatterns.map((p) => (
                    <TableRow key={p.id}><TableCell className="font-medium">{p.layer_type}</TableCell><TableCell className="text-center">{p.total_videos_analyzed}</TableCell><TableCell className="text-center">{p.total_blocks_analyzed}</TableCell><TableCell className="text-center">{fmtDec(p.avg_engagement_rate, 4)}</TableCell><TableCell className="text-center">{fmtDec(p.avg_emotion_intensity, 1)}</TableCell></TableRow>
                  ))}</TableBody></Table>
              </CardContent></Card>
          )}

          {data.canonicalUnits.length > 0 && (
            <Card><CardHeader><CardTitle className="text-sm">Top Unidades Canônicas ({Math.min(data.canonicalUnits.length, 100)} de {data.canonicalUnits.length})</CardTitle></CardHeader>
              <CardContent>
                <Table><TableHeader><TableRow><TableHead>Texto</TableHead><TableHead>Função</TableHead><TableHead className="text-center">Intensidade Verbal</TableHead><TableHead className="text-center">Intensidade</TableHead><TableHead className="text-center">Replicável</TableHead><TableHead>Emoção</TableHead></TableRow></TableHeader>
                  <TableBody>{data.canonicalUnits.slice(0, 100).map((u) => (
                    <TableRow key={u.id}><TableCell className="text-xs max-w-[300px]">{u.candidate_text}</TableCell><TableCell className="text-xs">{u.narrative_function}</TableCell><TableCell className="text-center">{fmtDec(u.narrative_replicability_score)}</TableCell><TableCell className="text-center">{u.emotional_intensity}</TableCell><TableCell className="text-center">{u.replicable_for_dna ? "✅" : "❌"}</TableCell><TableCell className="text-xs">{u.emotional_intent || "—"}</TableCell></TableRow>
                  ))}</TableBody></Table>
              </CardContent></Card>
          )}
        </>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════
// 8 — NARRATIVE SEQUENCES
// ═══════════════════════════════════════════
export function SectionNarrativeSequences({ data }: { data: MasterData }) {
  const topSeq = data.verbalSequences[0];

  const summaryItems = data.verbalSequences.length > 0 ? [
    `${data.verbalSequences.length} sequências narrativas identificadas`,
    topSeq ? `Sequência mais frequente: ${topSeq.sequence_pattern} (freq: ${topSeq.frequency})` : null,
    topSeq ? `Emoção dominante na top sequência: ${topSeq.dominant_emotion || "indefinida"}` : null,
    `Comprimentos variam de ${Math.min(...data.verbalSequences.map(s => s.sequence_length))} a ${Math.max(...data.verbalSequences.map(s => s.sequence_length))} passos`,
  ].filter(Boolean) as string[] : [];

  return (
    <Section id="sec-sequences" title="8 — NARRATIVE SEQUENCES" icon="🔗">
      {data.verbalSequences.length === 0 ? <p className="text-muted-foreground">Sem sequências narrativas.</p> : (
        <>
          <ExecSummary items={summaryItems} />
          <Card><CardContent className="pt-4">
            <Table><TableHeader><TableRow><TableHead>Padrão</TableHead><TableHead className="text-center">Freq.</TableHead><TableHead className="text-center">Comprimento</TableHead><TableHead className="text-center">Engagement Rate</TableHead><TableHead className="text-center">Intensidade Verbal</TableHead><TableHead>Emoção Dom.</TableHead></TableRow></TableHeader>
              <TableBody>{data.verbalSequences.map((s) => (
                <TableRow key={s.id}><TableCell className="font-mono text-xs">{s.sequence_pattern}</TableCell><TableCell className="text-center">{s.frequency}</TableCell><TableCell className="text-center">{s.sequence_length}</TableCell><TableCell className="text-center">{fmtDec(s.avg_engagement_rate, 4)}</TableCell><TableCell className="text-center">{fmtDec(s.avg_replicability_score)}</TableCell><TableCell>{s.dominant_emotion || "—"}</TableCell></TableRow>
              ))}</TableBody></Table>
          </CardContent></Card>
        </>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════
// 9 — CTA ANALYSIS
// ═══════════════════════════════════════════
export function SectionCTA({ data }: { data: MasterData }) {
  const typeDist = useMemo(() => {
    const map: Record<string, number> = {};
    data.ctaDeep.forEach(c => { map[c.cta_type || "unknown"] = (map[c.cta_type || "unknown"] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [data.ctaDeep]);

  const topType = typeDist.sort((a, b) => b.value - a.value)[0];
  const avgIntensity = data.ctaDeep.length > 0
    ? (data.ctaDeep.reduce((s, c) => s + (c.cta_intensity || 0), 0) / data.ctaDeep.length).toFixed(1)
    : "—";

  const summaryItems = [
    `${data.ctaDeep.length} CTAs analisados em profundidade`,
    `${data.ctaProfiles.length} perfis de CTA criados`,
    `${typeDist.length} tipos distintos de CTA`,
    topType ? `Tipo mais comum: ${topType.name} (${topType.value} ocorrências)` : null,
    `Intensidade média: ${avgIntensity}`,
  ].filter(Boolean) as string[];

  return (
    <Section id="sec-cta" title="9 — CTA ANALYSIS" icon="⚡">
      <ExecSummary items={summaryItems} />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KPI value={data.ctaDeep.length} label="CTA Deep Análises" />
        <KPI value={data.ctaProfiles.length} label="CTA Profiles" />
        <KPI value={typeDist.length} label="Tipos Distintos" />
      </div>

      {typeDist.length > 0 && (
        <Card><CardHeader><CardTitle className="text-sm">Distribuição por Tipo</CardTitle></CardHeader>
          <CardContent><ResponsiveContainer width="100%" height={250}>
            <PieChart><Pie data={typeDist} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>{typeDist.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}</Pie><Legend /><Tooltip /></PieChart>
          </ResponsiveContainer></CardContent></Card>
      )}

      {data.ctaDeep.length > 0 && (
        <Card><CardHeader><CardTitle className="text-sm">CTA Deep Completo ({data.ctaDeep.length})</CardTitle></CardHeader>
          <CardContent><Table><TableHeader><TableRow><TableHead>Texto</TableHead><TableHead>Tipo</TableHead><TableHead>Posição</TableHead><TableHead>Tom</TableHead><TableHead className="text-center">Intensidade</TableHead><TableHead className="text-center">Confiança</TableHead></TableRow></TableHeader>
            <TableBody>{data.ctaDeep.map(c => (
              <TableRow key={c.id}><TableCell className="text-xs max-w-[200px]">{c.cta_text || "—"}</TableCell><TableCell>{c.cta_type || "—"}</TableCell><TableCell>{c.cta_position || "—"}</TableCell><TableCell>{c.cta_tone || "—"}</TableCell><TableCell className="text-center">{c.cta_intensity}</TableCell><TableCell className="text-center">{c.confidence_score}</TableCell></TableRow>
            ))}</TableBody></Table></CardContent></Card>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════
// 10 — PERFORMANCE CORRELATIONS
// ═══════════════════════════════════════════
export function SectionPerformance({ data }: { data: MasterData }) {
  const topCorr = data.performanceCorrelations[0];

  const summaryItems = [
    `${data.performanceCorrelations.length} correlações padrão-performance mapeadas`,
    `${data.patternWeights.length} pesos de padrão calculados`,
    topCorr ? `Correlação mais confiável: ${topCorr.pattern_name} (confiança: ${topCorr.confidence_score})` : null,
    data.patternWeights.length > 0 ? `Padrão mais forte: ${data.patternWeights[0].pattern_value} (strength: ${fmtDec(data.patternWeights[0].strength_score)})` : null,
  ].filter(Boolean) as string[];

  return (
    <Section id="sec-performance" title="10 — PERFORMANCE CORRELATIONS" icon="📊">
      {data.performanceCorrelations.length === 0 && data.patternWeights.length === 0 ? <p className="text-muted-foreground">Sem dados de performance.</p> : (
        <>
          <ExecSummary items={summaryItems} />

          {data.performanceCorrelations.length > 0 && (
            <Card><CardHeader><CardTitle className="text-sm">Correlações ({data.performanceCorrelations.length})</CardTitle></CardHeader>
              <CardContent><Table><TableHeader><TableRow><TableHead>Padrão</TableHead><TableHead>Tipo</TableHead><TableHead className="text-center">Views</TableHead><TableHead className="text-center">Engagement</TableHead><TableHead className="text-center">Retention</TableHead><TableHead className="text-center">Confiança</TableHead></TableRow></TableHeader>
                <TableBody>{data.performanceCorrelations.map(p => (
                  <TableRow key={p.id}><TableCell className="text-xs">{p.pattern_name}</TableCell><TableCell>{p.pattern_type}</TableCell><TableCell className="text-center">{fmtDec(p.correlation_with_views)}</TableCell><TableCell className="text-center">{fmtDec(p.correlation_with_engagement)}</TableCell><TableCell className="text-center">{fmtDec(p.correlation_with_retention)}</TableCell><TableCell className="text-center">{p.confidence_score}</TableCell></TableRow>
                ))}</TableBody></Table></CardContent></Card>
          )}

          {data.patternWeights.length > 0 && (
            <Card><CardHeader><CardTitle className="text-sm">Pesos de Padrão (Top 50 de {data.patternWeights.length})</CardTitle></CardHeader>
              <CardContent><Table><TableHeader><TableRow><TableHead>Valor</TableHead><TableHead>Tipo</TableHead><TableHead className="text-center">Freq.</TableHead><TableHead className="text-center">Strength</TableHead><TableHead className="text-center">Avg Views</TableHead><TableHead className="text-center">Engagement</TableHead></TableRow></TableHeader>
                <TableBody>{data.patternWeights.slice(0, 50).map(p => (
                  <TableRow key={p.id}><TableCell className="text-xs">{p.pattern_value}</TableCell><TableCell>{p.pattern_type}</TableCell><TableCell className="text-center">{p.frequency}</TableCell><TableCell className="text-center">{fmtDec(p.strength_score)}</TableCell><TableCell className="text-center">{fmt(p.avg_views)}</TableCell><TableCell className="text-center">{fmtDec(p.avg_engagement_score, 4)}</TableCell></TableRow>
                ))}</TableBody></Table></CardContent></Card>
          )}
        </>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════
// 11 — COHORTS
// ═══════════════════════════════════════════
export function SectionCohorts({ data }: { data: MasterData }) {
  const activeCount = data.cohorts.filter(c => c.active).length;

  const summaryItems = data.cohorts.length > 0 ? [
    `${data.cohorts.length} coortes definidas, ${activeCount} ativas`,
    `${data.cohortSummaries.length} resumos analíticos gerados`,
    data.cohortSummaries.length > 0 ? `Maior coorte: ${data.cohortSummaries.sort((a, b) => (b.video_count || 0) - (a.video_count || 0))[0]?.cohort_name} (${data.cohortSummaries[0]?.video_count} vídeos)` : null,
  ].filter(Boolean) as string[] : [];

  return (
    <Section id="sec-cohorts" title="11 — COHORTS" icon="👥">
      {data.cohorts.length === 0 ? <p className="text-muted-foreground">Sem coortes.</p> : (
        <>
          <ExecSummary items={summaryItems} />

          <Card><CardHeader><CardTitle className="text-sm">Coortes ({data.cohorts.length})</CardTitle></CardHeader>
            <CardContent><Table><TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Tipo</TableHead><TableHead className="text-center">Vídeos</TableHead><TableHead className="text-center">Ativo</TableHead></TableRow></TableHeader>
              <TableBody>{data.cohorts.map(c => (
                <TableRow key={c.id}><TableCell className="font-medium">{c.cohort_name}</TableCell><TableCell>{c.cohort_type || "—"}</TableCell><TableCell className="text-center">{c.video_count}</TableCell><TableCell className="text-center">{c.active ? "✅" : "❌"}</TableCell></TableRow>
              ))}</TableBody></Table></CardContent></Card>

          {data.cohortSummaries.length > 0 && (
            <Card><CardHeader><CardTitle className="text-sm">Resumos de Coorte ({data.cohortSummaries.length})</CardTitle></CardHeader>
              <CardContent><Table><TableHeader><TableRow><TableHead>Nome</TableHead><TableHead className="text-center">Vídeos</TableHead><TableHead className="text-center">Avg Engagement Rate</TableHead><TableHead>Estrutura Dom.</TableHead><TableHead>Emoção Dom.</TableHead></TableRow></TableHeader>
                <TableBody>{data.cohortSummaries.map(s => (
                  <TableRow key={s.id}><TableCell className="font-medium">{s.cohort_name}</TableCell><TableCell className="text-center">{s.video_count}</TableCell><TableCell className="text-center">{fmtDec(s.avg_engagement_rate, 4)}</TableCell><TableCell className="text-xs">{s.dominant_structure || "—"}</TableCell><TableCell>{s.dominant_emotion || "—"}</TableCell></TableRow>
                ))}</TableBody></Table></CardContent></Card>
          )}
        </>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════
// 12 — MICRO EVENTS
// ═══════════════════════════════════════════
export function SectionMicroEvents({ data }: { data: MasterData }) {
  const typeDist = useMemo(() => {
    const map: Record<string, number> = {};
    data.microEvents.forEach(e => { map[e.event_type] = (map[e.event_type] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [data.microEvents]);

  const topType = typeDist[0];

  const summaryItems = [
    `${data.microEvents.length} micro-eventos detectados`,
    `${typeDist.length} tipos distintos de evento`,
    topType ? `Tipo mais frequente: ${topType.name} (${topType.value} ocorrências)` : null,
  ].filter(Boolean) as string[];

  return (
    <Section id="sec-micro-events" title="12 — MICRO EVENTS" icon="⚡">
      <ExecSummary items={summaryItems} />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KPI value={data.microEvents.length} label="Total Eventos" />
        <KPI value={typeDist.length} label="Tipos Distintos" />
        {topType && <KPI value={topType.name} label="Tipo Mais Frequente" />}
      </div>

      {typeDist.length > 0 && (
        <Card><CardHeader><CardTitle className="text-sm">Distribuição por Tipo</CardTitle></CardHeader>
          <CardContent><ResponsiveContainer width="100%" height={220}>
            <BarChart data={typeDist}><XAxis dataKey="name" fontSize={10} /><YAxis /><Tooltip /><Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} /></BarChart>
          </ResponsiveContainer></CardContent></Card>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════
// 13 — ALIGNMENT
// ═══════════════════════════════════════════
export function SectionAlignment({ data }: { data: MasterData }) {
  const avgAlign = data.textVisualAlignment.length > 0
    ? (data.textVisualAlignment.reduce((s, a) => s + (Number(a.alignment_score) || 0), 0) / data.textVisualAlignment.length).toFixed(1)
    : "—";
  const avgCompat = data.textImageCompatibility.length > 0
    ? (data.textImageCompatibility.reduce((s, c) => s + (Number(c.compatibility_score) || 0), 0) / data.textImageCompatibility.length).toFixed(1)
    : "—";
  const contradictions = data.textImageCompatibility.filter(c => c.contradiction_detected).length;

  const summaryItems = [
    `${data.textVisualAlignment.length} registros de alinhamento texto-visual`,
    `${data.textImageCompatibility.length} registros de compatibilidade texto-imagem`,
    `Score médio de alinhamento: ${avgAlign}`,
    `Score médio de compatibilidade: ${avgCompat}`,
    contradictions > 0 ? `⚠️ ${contradictions} contradições detectadas entre texto e visual` : "Nenhuma contradição texto-visual detectada",
  ];

  return (
    <Section id="sec-alignment" title="13 — TEXT-VISUAL ALIGNMENT" icon="🎯">
      <ExecSummary items={summaryItems} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI value={data.textVisualAlignment.length} label="Alignment Records" />
        <KPI value={data.textImageCompatibility.length} label="Compatibility Records" />
        <KPI value={avgAlign} label="Avg Alignment" accent />
        <KPI value={avgCompat} label="Avg Compatibility" accent />
      </div>

      {data.textVisualAlignment.length > 0 && (
        <Card><CardHeader><CardTitle className="text-sm">Alinhamento Texto-Visual (primeiros 50)</CardTitle></CardHeader>
          <CardContent><Table><TableHeader><TableRow><TableHead>Block</TableHead><TableHead className="text-center">Score</TableHead><TableHead className="text-center">Emotion</TableHead><TableHead className="text-center">Action</TableHead><TableHead className="text-center">Intensity</TableHead></TableRow></TableHeader>
            <TableBody>{data.textVisualAlignment.slice(0, 50).map(a => (
              <TableRow key={a.id}><TableCell className="font-mono text-xs">{a.block_id?.substring(0, 8)}</TableCell><TableCell className="text-center">{a.alignment_score}</TableCell><TableCell className="text-center">{a.emotion_alignment_score}</TableCell><TableCell className="text-center">{a.action_alignment_score}</TableCell><TableCell className="text-center">{a.intensity_alignment_score}</TableCell></TableRow>
            ))}</TableBody></Table></CardContent></Card>
      )}

      {data.textImageCompatibility.length > 0 && (
        <Card><CardHeader><CardTitle className="text-sm">Compatibilidade Texto-Imagem (primeiros 50)</CardTitle></CardHeader>
          <CardContent><Table><TableHeader><TableRow><TableHead>Block</TableHead><TableHead className="text-center">Score</TableHead><TableHead>Label</TableHead><TableHead className="text-center">Contradição</TableHead><TableHead className="text-center">Overload</TableHead></TableRow></TableHeader>
            <TableBody>{data.textImageCompatibility.slice(0, 50).map(c => (
              <TableRow key={c.id}><TableCell className="font-mono text-xs">{c.block_id?.substring(0, 8)}</TableCell><TableCell className="text-center">{c.compatibility_score}</TableCell><TableCell className="text-xs">{c.compatibility_label || "—"}</TableCell><TableCell className="text-center">{c.contradiction_detected ? "⚠️" : "✅"}</TableCell><TableCell className="text-center">{c.visual_overload_detected ? "⚠️" : "✅"}</TableCell></TableRow>
            ))}</TableBody></Table></CardContent></Card>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════
// 14 — OUTLIERS
// ═══════════════════════════════════════════
export function SectionOutliers({ data }: { data: MasterData }) {
  const flagged = data.outliers.filter(o => o.outlier_flag).length;

  const summaryItems = data.outliers.length > 0 ? [
    `${data.outliers.length} análises de outlier realizadas`,
    `${flagged} outliers confirmados (flag ativo)`,
    flagged === 0 ? "Nenhum desvio significativo detectado no dataset" : `${flagged} vídeos com desvio estatístico significativo`,
  ] : ["Nenhum outlier analisado até o momento"];

  return (
    <Section id="sec-outliers" title="14 — OUTLIERS" icon="📌">
      <ExecSummary items={summaryItems} />

      {data.outliers.length === 0 ? <p className="text-muted-foreground">Sem outliers detectados.</p> : (
        <Card><CardContent className="pt-4">
          <Table><TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Razão</TableHead><TableHead className="text-center">Z-Score</TableHead><TableHead className="text-center">Flag</TableHead><TableHead className="text-center">Confiança</TableHead></TableRow></TableHeader>
            <TableBody>{data.outliers.map(o => (
              <TableRow key={o.id}><TableCell>{o.outlier_type || "—"}</TableCell><TableCell className="text-xs max-w-[300px]">{o.outlier_reason || "—"}</TableCell><TableCell className="text-center">{fmtDec(o.z_score)}</TableCell><TableCell className="text-center">{o.outlier_flag ? "🔴" : "✅"}</TableCell><TableCell className="text-center">{o.confidence_score}</TableCell></TableRow>
            ))}</TableBody></Table>
        </CardContent></Card>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════
// 15 — SEMANTIC PATTERNS
// ═══════════════════════════════════════════
export function SectionSemanticPatterns({ data }: { data: MasterData }) {
  const withCta = data.semanticPatterns.filter(s => s.cta_exists).length;
  const avgHookIntensity = data.semanticPatterns.length > 0
    ? (data.semanticPatterns.reduce((s, p) => s + (p.hook_emotional_intensity || 0), 0) / data.semanticPatterns.length).toFixed(1)
    : "—";

  const summaryItems = [
    `${data.semanticPatterns.length} padrões semânticos por vídeo`,
    `${data.blockSemantics.length} padrões semânticos por bloco`,
    `${withCta} vídeos com CTA detectado`,
    `Intensidade emocional média no hook: ${avgHookIntensity}`,
  ];

  return (
    <Section id="sec-semantic" title="15 — SEMANTIC PATTERNS" icon="🔍">
      <ExecSummary items={summaryItems} />

      <div className="grid grid-cols-2 gap-3">
        <KPI value={data.semanticPatterns.length} label="Padrões por Vídeo" />
        <KPI value={data.blockSemantics.length} label="Padrões por Bloco" />
      </div>

      {data.semanticPatterns.length > 0 && (
        <Card><CardHeader><CardTitle className="text-sm">Padrões Semânticos por Vídeo</CardTitle></CardHeader>
          <CardContent><Table><TableHeader><TableRow><TableHead>Hook</TableHead><TableHead>Tom</TableHead><TableHead>CTA</TableHead><TableHead className="text-center">Hook Intens.</TableHead><TableHead>Payoff</TableHead></TableRow></TableHeader>
            <TableBody>{data.semanticPatterns.map(s => (
              <TableRow key={s.id}><TableCell className="text-xs max-w-[200px]">{s.hook_text || "—"}</TableCell><TableCell>{s.dominant_verbal_tone || "—"}</TableCell><TableCell>{s.cta_type || "—"}</TableCell><TableCell className="text-center">{s.hook_emotional_intensity}</TableCell><TableCell className="text-xs max-w-[150px]">{s.payoff_text || "—"}</TableCell></TableRow>
            ))}</TableBody></Table></CardContent></Card>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════
// 16 — WORD PATTERNS
// ═══════════════════════════════════════════
export function SectionWordPatterns({ data }: { data: MasterData }) {
  const dominantWords = data.wordPatterns.filter(w => w.is_dominant).length;
  const emotionalWords = data.wordPatterns.filter(w => w.is_emotional).length;
  const strongPhrases = data.phrasePatterns.filter(p => p.is_strong).length;

  const summaryItems = [
    `${data.wordPatterns.length} padrões de palavra analisados`,
    `${data.phrasePatterns.length} padrões de frase analisados`,
    `${dominantWords} palavras dominantes identificadas`,
    `${emotionalWords} palavras emocionais detectadas`,
    `${strongPhrases} frases fortes catalogadas`,
  ];

  return (
    <Section id="sec-words" title="16 — WORD & PHRASE PATTERNS" icon="💬">
      <ExecSummary items={summaryItems} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI value={data.wordPatterns.length} label="Word Patterns" />
        <KPI value={data.phrasePatterns.length} label="Phrase Patterns" />
        <KPI value={dominantWords} label="Dominantes" />
        <KPI value={emotionalWords} label="Emocionais" />
      </div>

      {data.wordPatterns.length > 0 && (
        <Card><CardHeader><CardTitle className="text-sm">Top Palavras (primeiros 50 de {data.wordPatterns.length})</CardTitle></CardHeader>
          <CardContent><Table><TableHeader><TableRow><TableHead>Palavra</TableHead><TableHead>Bloco</TableHead><TableHead className="text-center">Freq.</TableHead><TableHead className="text-center">Dominant</TableHead><TableHead className="text-center">Emotional</TableHead><TableHead className="text-center">Score</TableHead></TableRow></TableHeader>
            <TableBody>{data.wordPatterns.slice(0, 50).map(w => (
              <TableRow key={w.id}><TableCell className="font-mono">{w.word}</TableCell><TableCell className="text-xs">{w.block_type}</TableCell><TableCell className="text-center">{w.word_frequency}</TableCell><TableCell className="text-center">{w.is_dominant ? "✅" : ""}</TableCell><TableCell className="text-center">{w.is_emotional ? "✅" : ""}</TableCell><TableCell className="text-center">{fmtDec(w.weighted_score)}</TableCell></TableRow>
            ))}</TableBody></Table></CardContent></Card>
      )}

      {data.phrasePatterns.length > 0 && (
        <Card><CardHeader><CardTitle className="text-sm">Top Frases (primeiros 50 de {data.phrasePatterns.length})</CardTitle></CardHeader>
          <CardContent><Table><TableHeader><TableRow><TableHead>Frase</TableHead><TableHead>Tipo</TableHead><TableHead className="text-center">Strong</TableHead><TableHead className="text-center">Emotional</TableHead><TableHead className="text-center">Score</TableHead></TableRow></TableHeader>
            <TableBody>{data.phrasePatterns.slice(0, 50).map(p => (
              <TableRow key={p.id}><TableCell className="text-xs max-w-[300px]">{p.phrase}</TableCell><TableCell>{p.phrase_type || "—"}</TableCell><TableCell className="text-center">{p.is_strong ? "✅" : ""}</TableCell><TableCell className="text-center">{p.is_emotional ? "✅" : ""}</TableCell><TableCell className="text-center">{fmtDec(p.weighted_score)}</TableCell></TableRow>
            ))}</TableBody></Table></CardContent></Card>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════
// 17 — VIDEO-BY-VIDEO
// ═══════════════════════════════════════════
export function SectionVideoByVideo({ data, isPrintMode }: { data: MasterData; isPrintMode: boolean }) {
  const videoIndex = useMemo(() => {
    const map = new Map<string, { blocks: any[]; verbal: any[]; semantic: any | null; cta: any[]; alignment: any[]; compatibility: any[]; outlier: any[] }>();
    data.videos.forEach(v => map.set(v.id, { blocks: [], verbal: [], semantic: null, cta: [], alignment: [], compatibility: [], outlier: [] }));
    data.blocks.forEach(b => map.get(b.video_id)?.blocks.push(b));
    data.blockVerbalAnalysis.forEach(bv => map.get(bv.video_id)?.verbal.push(bv));
    data.semanticPatterns.forEach(sp => { const e = map.get(sp.video_id); if (e) e.semantic = sp; });
    data.ctaDeep.forEach(c => map.get(c.video_id)?.cta.push(c));
    data.textVisualAlignment.forEach(a => map.get(a.video_id)?.alignment.push(a));
    data.textImageCompatibility.forEach(c => map.get(c.video_id)?.compatibility.push(c));
    data.outliers.forEach(o => map.get(o.video_id)?.outlier.push(o));
    return map;
  }, [data]);

  const totalBlocks = data.blocks.length;
  const avgBlocksPerVideo = data.videos.length > 0 ? (totalBlocks / data.videos.length).toFixed(1) : "—";

  const summaryItems = [
    `${data.videos.length} vídeos com relatório individual completo`,
    `${totalBlocks} blocos narrativos no total (média: ${avgBlocksPerVideo} por vídeo)`,
    `Cada vídeo inclui: blocos, análise verbal, CTAs e semântica`,
  ];

  const PAGE_SIZE = 10;
  const visibleVideos = isPrintMode ? data.videos : data.videos.slice(0, PAGE_SIZE);

  return (
    <Section id="sec-videos" title={`17 — VIDEO-BY-VIDEO FULL REPORTS (${data.videos.length})`} icon="🎬">
      <ExecSummary items={summaryItems} />

      {visibleVideos.map((video, idx) => {
        const vd = videoIndex.get(video.id);
        return (
          <div key={video.id} className={idx > 0 ? "print:break-before-page" : ""}>
            <Card className="border-l-4 border-l-primary">
              <CardHeader>
                <CardTitle className="text-sm">
                  Vídeo {idx + 1}/{data.videos.length}: {video.titulo || (video as any).title || (video as any).original_url || video.id}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                  <div className="flex justify-between border-b border-border/30 py-1"><span className="text-muted-foreground">Views</span><span className="font-medium">{fmt((video as any).views)}</span></div>
                  <div className="flex justify-between border-b border-border/30 py-1"><span className="text-muted-foreground">Likes</span><span className="font-medium">{fmt((video as any).likes)}</span></div>
                  <div className="flex justify-between border-b border-border/30 py-1"><span className="text-muted-foreground">Comments</span><span className="font-medium">{fmt((video as any).comments)}</span></div>
                  <div className="flex justify-between border-b border-border/30 py-1"><span className="text-muted-foreground">Duração</span><span className="font-medium">{fmt((video as any).duracao || (video as any).duration_seconds)}s</span></div>
                  <div className="flex justify-between border-b border-border/30 py-1"><span className="text-muted-foreground">Segmento</span><span className="font-medium">{(video as any).segmento || (video as any).segment || "—"}</span></div>
                  <div className="flex justify-between border-b border-border/30 py-1"><span className="text-muted-foreground">Status</span><span className="font-medium">{video.status}</span></div>
                  <div className="flex justify-between border-b border-border/30 py-1"><span className="text-muted-foreground">Engagement Rate Relative</span><span className="font-medium">{fmtDec((video as any).engagement_rate_relative, 4)}</span></div>
                  <div className="flex justify-between py-1"><span className="text-muted-foreground">Engagement Percentile</span><span className="font-medium">{(video as any).engagement_percentile_display != null ? `P${fmtDec((video as any).engagement_percentile_display, 0)}` : '—'}</span></div>
                </div>

                {vd && vd.blocks.length > 0 && (
                  <div>
                    <p className="text-xs font-bold mb-2 text-muted-foreground uppercase tracking-wider">Blocos Narrativos ({vd.blocks.length})</p>
                    <Table><TableHeader><TableRow><TableHead>#</TableHead><TableHead>Tipo</TableHead><TableHead>Emoção</TableHead><TableHead>Início</TableHead><TableHead>Fim</TableHead><TableHead>Texto</TableHead></TableRow></TableHeader>
                      <TableBody>{vd.blocks.map(b => (
                        <TableRow key={b.id}><TableCell>{b.bloco_id}</TableCell><TableCell>{b.tipo_bloco}</TableCell><TableCell>{b.emocao || "—"}</TableCell><TableCell>{b.tempo_inicio}s</TableCell><TableCell>{b.tempo_fim}s</TableCell><TableCell className="text-xs max-w-[300px] truncate">{b.texto || "—"}</TableCell></TableRow>
                      ))}</TableBody></Table>
                  </div>
                )}

                {vd && vd.verbal.length > 0 && (
                  <div>
                    <p className="text-xs font-bold mb-2 text-muted-foreground uppercase tracking-wider">Análise Verbal ({vd.verbal.length})</p>
                    <Table><TableHeader><TableRow><TableHead>Tom</TableHead><TableHead className="text-center">Words</TableHead><TableHead className="text-center">Phrases</TableHead><TableHead className="text-center">Intensidade</TableHead><TableHead className="text-center">Density</TableHead></TableRow></TableHeader>
                      <TableBody>{vd.verbal.map(v => (
                        <TableRow key={v.id}><TableCell>{v.tone || "—"}</TableCell><TableCell className="text-center">{v.word_count}</TableCell><TableCell className="text-center">{v.phrase_count}</TableCell><TableCell className="text-center">{v.emotional_intensity}</TableCell><TableCell className="text-center">{fmtDec(v.linguistic_density)}</TableCell></TableRow>
                      ))}</TableBody></Table>
                  </div>
                )}

                {vd && vd.cta.length > 0 && (
                  <div>
                    <p className="text-xs font-bold mb-2 text-muted-foreground uppercase tracking-wider">CTAs ({vd.cta.length})</p>
                    <div className="space-y-1">
                      {vd.cta.map(c => (
                        <div key={c.id} className="text-xs flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">{c.cta_type}</Badge>
                          <span>{c.cta_text || "—"}</span>
                          <span className="text-muted-foreground">(intens: {c.cta_intensity}, pos: {c.cta_position})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {vd?.semantic && (
                  <div>
                    <p className="text-xs font-bold mb-2 text-muted-foreground uppercase tracking-wider">Semântica</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                      <div><span className="text-muted-foreground">Hook:</span> <span className="font-medium">{vd.semantic.hook_text || "—"}</span></div>
                      <div><span className="text-muted-foreground">Tom:</span> <span className="font-medium">{vd.semantic.dominant_verbal_tone || "—"}</span></div>
                      <div><span className="text-muted-foreground">CTA:</span> <span className="font-medium">{vd.semantic.cta_type || "—"}</span></div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        );
      })}
      {!isPrintMode && data.videos.length > PAGE_SIZE && (
        <p className="text-sm text-muted-foreground text-center py-4">
          Mostrando {PAGE_SIZE} de {data.videos.length} vídeos na tela. Use a impressão (Ctrl+P) para ver todos os {data.videos.length} vídeos completos.
        </p>
      )}
    </Section>
  );
}
