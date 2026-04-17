import { Badge } from "@/components/ui/badge";
import { ComprovanteMatchStatus } from "@/lib/types";

const CONFIG: Record<
  ComprovanteMatchStatus,
  { label: string; className: string }
> = {
  matched: {
    label: "Associado",
    className:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  },
  pending_review: {
    label: "Pendente",
    className:
      "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20",
  },
  unmatched: {
    label: "Sem Associação",
    className: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20",
  },
  rejected_match: {
    label: "Rejeitado",
    className: "bg-muted text-muted-foreground border-border",
  },
};

export function ComprovanteStatusBadge({
  status,
}: {
  status: ComprovanteMatchStatus;
}) {
  const cfg = CONFIG[status];
  return (
    <Badge variant="outline" className={cfg.className}>
      {cfg.label}
    </Badge>
  );
}
