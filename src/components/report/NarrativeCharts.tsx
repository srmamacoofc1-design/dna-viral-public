import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import type { Video, VideoBlock, VideoTranscript } from '@/types/video';
import { TIPO_BLOCOS, EMOCOES_EXTENDED, getEmotionIntensity } from '@/types/video';

interface Props {
  video: Video;
  blocks: VideoBlock[];
  transcripts: VideoTranscript[];
}

export function NarrativeCharts({ video, blocks, transcripts }: Props) {
  if (!blocks.length || !video.duracao) return null;

  // 1. Rhythm bar chart - duration per block
  const rhythmData = blocks.map((b, i) => ({
    name: `B${i + 1}`,
    duracao: +(b.tempo_fim - b.tempo_inicio).toFixed(1),
    tipo: TIPO_BLOCOS.find(t => t.value === b.tipo_bloco)?.label || b.tipo_bloco,
    color: TIPO_BLOCOS.find(t => t.value === b.tipo_bloco)?.color || '#64748B',
  }));

  // 2. Density line chart - words per second over video
  const densityData: { time: number; wps: number }[] = [];
  const totalDur = video.duracao;
  const bucketSize = Math.max(1, Math.floor(totalDur / 20));
  for (let t = 0; t < totalDur; t += bucketSize) {
    const end = Math.min(t + bucketSize, totalDur);
    const segs = transcripts.filter(tr => tr.tempo_inicio >= t && tr.tempo_inicio < end);
    const words = segs.reduce((sum, s) => sum + s.texto.split(/\s+/).filter(Boolean).length, 0);
    const dur = end - t;
    densityData.push({ time: t, wps: dur > 0 ? +(words / dur).toFixed(2) : 0 });
  }

  // 3. Distribution pie chart
  const typeCount = new Map<string, number>();
  blocks.forEach(b => {
    const dur = b.tempo_fim - b.tempo_inicio;
    typeCount.set(b.tipo_bloco, (typeCount.get(b.tipo_bloco) || 0) + dur);
  });
  const pieData = Array.from(typeCount.entries()).map(([tipo, dur]) => ({
    name: TIPO_BLOCOS.find(t => t.value === tipo)?.label || tipo,
    value: +((dur / totalDur) * 100).toFixed(1),
    color: TIPO_BLOCOS.find(t => t.value === tipo)?.color || '#64748B',
  }));

  // 4. Timeline color bar
  const timelineData = blocks.map((b, i) => ({
    name: `B${i + 1}`,
    start: b.tempo_inicio,
    duration: b.tempo_fim - b.tempo_inicio,
    color: TIPO_BLOCOS.find(t => t.value === b.tipo_bloco)?.color || '#64748B',
    tipo: TIPO_BLOCOS.find(t => t.value === b.tipo_bloco)?.label || b.tipo_bloco,
  }));

  return (
    <div className="space-y-6">
      {/* Timeline visual */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">📊 Timeline Visual</h4>
        <div className="flex rounded-lg overflow-hidden h-8">
          {timelineData.map((b, i) => (
            <div
              key={i}
              className="relative group"
              style={{ width: `${(b.duration / totalDur) * 100}%`, backgroundColor: b.color }}
              title={`${b.tipo}: ${b.start}s–${(b.start + b.duration).toFixed(1)}s`}
            >
              <div className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-white/80 opacity-0 group-hover:opacity-100 transition-opacity">
                {b.tipo}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mt-2">
          {TIPO_BLOCOS.filter(t => blocks.some(b => b.tipo_bloco === t.value)).map(t => (
            <div key={t.value} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: t.color }} />
              {t.label}
            </div>
          ))}
        </div>
      </div>

      {/* Rhythm bar chart */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">📊 Ritmo — Duração por Bloco</h4>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={rhythmData}>
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94A3B8' }} />
            <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} unit="s" />
            <Tooltip
              contentStyle={{ backgroundColor: '#1E293B', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
              formatter={(v: number, _: string, p: any) => [`${v}s`, p.payload.tipo]}
            />
            <Bar dataKey="duracao" radius={[4, 4, 0, 0]}>
              {rhythmData.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Density line chart */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">📈 Densidade — Palavras/segundo</h4>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={densityData}>
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#94A3B8' }} unit="s" />
            <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1E293B', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
              formatter={(v: number) => [`${v} p/s`, 'Palavras/s']}
            />
            <Line type="monotone" dataKey="wps" stroke="#2563EB" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Distribution pie */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">🥧 Distribuição Narrativa — % por Tipo</h4>
        <div className="flex items-center gap-4">
          <ResponsiveContainer width="50%" height={180}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, value }) => `${name} ${value}%`}>
                {pieData.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: '#1E293B', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => [`${v}%`, '% do vídeo']}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1">
            {pieData.map(d => (
              <div key={d.name} className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: d.color }} />
                <span className="text-foreground">{d.name}</span>
                <span className="text-muted-foreground">{d.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Emotional Distribution pie */}
      {(() => {
        const emoCount = new Map<string, number>();
        blocks.forEach(b => {
          if (b.emocao) {
            const dur = b.tempo_fim - b.tempo_inicio;
            emoCount.set(b.emocao, (emoCount.get(b.emocao) || 0) + dur);
          }
        });
        const emoColors: Record<string, string> = {
          curiosidade: '#3B82F6', surpresa: '#F59E0B', medo: '#7C3AED',
          tensao: '#EF4444', alivio: '#22C55E', expectativa: '#EC4899',
          impacto: '#F97316', humor: '#10B981', suspense: '#6366F1', choque: '#DC2626',
        };
        const emoPieData = Array.from(emoCount.entries())
          .map(([emo, dur]) => ({
            name: EMOCOES_EXTENDED.find(e => e.value === emo)?.label || emo,
            icon: EMOCOES_EXTENDED.find(e => e.value === emo)?.icon || '',
            value: +((dur / totalDur) * 100).toFixed(1),
            color: emoColors[emo] || '#94A3B8',
          }))
          .sort((a, b) => b.value - a.value);
        if (emoPieData.length === 0) return null;
        return (
          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">🎭 Distribuição Emocional — % por Emoção</h4>
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={180}>
                <PieChart>
                  <Pie data={emoPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, value }) => `${name} ${value}%`}>
                    {emoPieData.map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1E293B', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => [`${v}%`, '% do vídeo']}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1">
                {emoPieData.map(d => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: d.color }} />
                    <span className="text-foreground">{d.icon} {d.name}</span>
                    <span className="text-muted-foreground">{d.value}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
