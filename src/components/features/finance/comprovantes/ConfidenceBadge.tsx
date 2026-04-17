import { Badge } from "@/components/ui/badge";
import { ComprovanteConfidenceLevel } from "@/lib/types";

const CONFIG: Record<
  ComprovanteConfidenceLevel,
  { label: string; className: string }
> = {
  HIGH: {
    label: "Alta",
    className:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  },
  MEDIUM: {
    label: "Média",
    className:
      "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20",
  },
  LOW: {
    label: "Baixa",
    className: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20",
  },
};

export function ConfidenceBadge({
  level,
  score,
}: {
  level: ComprovanteConfidenceLevel;
  score?: number;
}) {
  const cfg = CONFIG[level];
  return (
    <Badge variant="outline" className={cfg.className}>
      {cfg.label}
      {score !== undefined && ` (${score}%)`}
    </Badge>
  );
}
