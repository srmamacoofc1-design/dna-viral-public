import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";

interface Props {
  title: string;
  message: string;
}

export default function PlaceholderModule({ title, message }: Props) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">{title}</h1>
      <Card className="bg-card border-border/50">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Construction className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-lg text-muted-foreground">{message}</p>
          <p className="text-sm text-muted-foreground/60 mt-2">
            Funcionalidade de expansão — não bloqueia operação principal.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
