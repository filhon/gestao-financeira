import { useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  RoadmapItem as RoadmapItemType,
  RoadmapStatus,
} from "@/lib/services/roadmapService";
import { RoadmapItem } from "./RoadmapItem";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Lightbulb,
  CalendarClock,
  Zap,
  CheckCircle2,
  MoveRight,
} from "lucide-react";

interface RoadmapColumnProps {
  id: RoadmapStatus;
  title: string;
  items: RoadmapItemType[];
  isAdmin: boolean;
  onRefresh: () => void;
  extraHeader?: React.ReactNode;
}

const COLUMN_CONFIG: Record<
  RoadmapStatus,
  {
    icon: React.ElementType;
    iconColor: string;
    iconBg: string;
    borderTop: string;
    emptyText: string;
  }
> = {
  suggestion: {
    icon: Lightbulb,
    iconColor: "text-amber-500",
    iconBg: "bg-amber-500/10",
    borderTop: "border-t-amber-400",
    emptyText: "Nenhuma sugestão ainda.\nEnvie a sua!",
  },
  planned: {
    icon: CalendarClock,
    iconColor: "text-blue-500",
    iconBg: "bg-blue-500/10",
    borderTop: "border-t-blue-400",
    emptyText: "Nada planejado\npor enquanto.",
  },
  in_progress: {
    icon: Zap,
    iconColor: "text-violet-500",
    iconBg: "bg-violet-500/10",
    borderTop: "border-t-violet-400",
    emptyText: "Nenhum item\nem progresso.",
  },
  done: {
    icon: CheckCircle2,
    iconColor: "text-emerald-500",
    iconBg: "bg-emerald-500/10",
    borderTop: "border-t-emerald-400",
    emptyText: "Nenhum item\nconcluído ainda.",
  },
};

export function RoadmapColumn({
  id,
  title,
  items,
  isAdmin,
  onRefresh,
  extraHeader,
}: RoadmapColumnProps) {
  const data = useMemo(
    () => ({
      type: "Column",
      status: id,
    }),
    [id],
  );

  const { setNodeRef, isOver } = useDroppable({
    id,
    data,
  });

  const itemIds = useMemo(() => items.map((item) => item.id), [items]);
  const config = COLUMN_CONFIG[id];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "flex flex-col h-full rounded-lg bg-muted/50 w-full shrink-0 border-t-2",
        config.borderTop,
      )}
    >
      <div className="p-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md",
              config.iconBg,
            )}
          >
            <Icon className={cn("h-3.5 w-3.5", config.iconColor)} />
          </div>
          <h3 className="font-semibold text-sm">{title}</h3>
          <Badge
            variant="secondary"
            className="rounded-full px-2 py-0.5 text-xs font-medium"
          >
            {items.length}
          </Badge>
        </div>
        {extraHeader}
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 p-2 space-y-2 overflow-y-auto min-h-[150px] transition-colors",
          isOver && "bg-primary/5 rounded-b-lg",
        )}
      >
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <RoadmapItem
              key={item.id}
              item={item}
              isAdmin={isAdmin}
              onRefresh={onRefresh}
            />
          ))}
        </SortableContext>

        {items.length === 0 && (
          <div className="h-24 flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-muted-foreground/20 rounded-lg px-4">
            {isAdmin && id !== "suggestion" ? (
              <>
                <MoveRight className="h-4 w-4 text-muted-foreground/40" />
                <span className="text-xs text-muted-foreground/60 text-center">
                  Arraste itens para cá.
                </span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground/60 text-center whitespace-pre-line">
                {config.emptyText}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
