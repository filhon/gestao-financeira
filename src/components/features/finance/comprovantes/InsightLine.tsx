import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Insight } from "./receiptInsight";

const ICON = { ok: CheckCircle2, warn: AlertTriangle, muted: CircleDashed };
const TONE = {
  ok: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  muted: "text-muted-foreground",
};

/** Ícone + texto: o estado nunca depende só da cor. */
export function InsightLine({
  insight,
  className,
}: {
  insight: Insight;
  className?: string;
}) {
  const Icon = ICON[insight.tone];
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-xs",
        TONE[insight.tone],
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate" title={insight.text}>
        {insight.text}
      </span>
    </span>
  );
}
