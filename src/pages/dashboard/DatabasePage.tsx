import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { ArrowRight, Database, MessageSquare, Target, Clock, Shuffle, Trophy, Dna } from "lucide-react";

const groups = [
  {
    title: "Video Data",
    icon: Database,
    color: "text-blue-400",
    links: [
      { label: "Videos", url: "/library" },
      { label: "Video Blocks", url: "/library" },
      { label: "Upload & Queue", url: "/queue" },
    ],
  },
  {
    title: "Verbal Analysis",
    icon: MessageSquare,
    color: "text-green-400",
    links: [
      { label: "Block Verbal Analysis", url: "/verbal-intelligence" },
      { label: "Phrase & Word Patterns", url: "/patterns" },
    ],
  },
  {
    title: "CTA Systems",
    icon: Target,
    color: "text-amber-400",
    links: [
      { label: "CTA Events", url: "/cta-deep" },
      { label: "CTA Audit", url: "/cta-audit" },
    ],
  },
  {
    title: "Temporal Systems",
    icon: Clock,
    color: "text-purple-400",
    links: [
      { label: "Temporal Profiles", url: "/temporal" },
      { label: "Micro Events", url: "/micro-events" },
    ],
  },
  {
    title: "Alignment Systems",
    icon: Shuffle,
    color: "text-cyan-400",
    links: [
      { label: "Text-Visual Alignment", url: "/report" },
    ],
  },
  {
    title: "Scores",
    icon: Trophy,
    color: "text-orange-400",
    links: [
      { label: "Viral Scores", url: "/report" },
      { label: "Validation", url: "/validation" },
    ],
  },
  {
    title: "DNA Tables",
    icon: Dna,
    color: "text-pink-400",
    links: [
      { label: "DNA Base V2", url: "/dna-v2" },
      { label: "DNA Viral", url: "/dna-viral" },
      { label: "Backup & Import", url: "/backup" },
    ],
  },
];

export default function DatabasePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Database</h1>
        <p className="text-muted-foreground mt-1">Organização visual de todas as tabelas do sistema</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <Card key={g.title} className="bg-card border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <g.icon className={`h-5 w-5 ${g.color}`} />
                {g.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {g.links.map((l) => (
                <Link
                  key={l.label}
                  to={l.url}
                  className="flex items-center justify-between py-2 px-2 rounded hover:bg-muted/50 transition-colors group"
                >
                  <span className="text-sm text-foreground/80">{l.label}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </Link>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
