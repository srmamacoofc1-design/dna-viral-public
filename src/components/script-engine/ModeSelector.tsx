import { Video, Lightbulb, FileEdit } from "lucide-react";
import { cn } from "@/lib/utils";

export type EngineMode = "video" | "theme" | "transform";

const modes = [
  { key: "video" as const, label: "Gerar de Novo Vídeo", icon: Video, desc: "Upload de vídeo operacional — transcrição + frames visuais. Não entra na base viral." },
  { key: "theme" as const, label: "Gerar de Tema", icon: Lightbulb, desc: "Criar roteiro a partir de tema/nicho usando a inteligência da base viral" },
  { key: "transform" as const, label: "Transformar Roteiro", icon: FileEdit, desc: "Fortalecer um roteiro existente aplicando DNA viral" },
];

interface Props {
  mode: EngineMode;
  onModeChange: (m: EngineMode) => void;
}

export function ModeSelector({ mode, onModeChange }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {modes.map((m) => (
        <button
          key={m.key}
          onClick={() => onModeChange(m.key)}
          className={cn(
            "flex items-start gap-3 rounded-lg border p-4 text-left transition-all",
            mode === m.key
              ? "border-primary bg-primary/10 ring-1 ring-primary/30"
              : "border-border bg-card hover:border-primary/40"
          )}
        >
          <m.icon className={cn("h-5 w-5 mt-0.5 shrink-0", mode === m.key ? "text-primary" : "text-muted-foreground")} />
          <div>
            <p className={cn("font-semibold text-sm", mode === m.key ? "text-primary" : "text-foreground")}>{m.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{m.desc}</p>
          </div>
        </button>
      ))}
    </div>
  );
}
