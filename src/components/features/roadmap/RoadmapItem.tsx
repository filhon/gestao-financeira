import { RoadmapItem as RoadmapItemType } from "@/lib/services/roadmapService";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { GripVertical, CheckCircle2 } from "lucide-react";
import { RoadmapItemDialog } from "./RoadmapItemDialog";

interface RoadmapItemProps {
  item: RoadmapItemType;
  isAdmin: boolean;
  onRefresh: () => void;
}

function getInitials(email?: string | null): string {
  if (!email) return "?";
  const name = email.split("@")[0];
  const parts = name.split(/[._-]/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function RoadmapItem({ item, isAdmin, onRefresh }: RoadmapItemProps) {
  const [open, setOpen] = useState(false);
  const data = useMemo(
    () => ({
      type: "Item",
      item,
    }),
    [item],
  );

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    disabled: !isAdmin,
    data,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="opacity-30 bg-primary/10 border-2 border-primary border-dashed rounded-lg h-[130px]"
      />
    );
  }

  const isDone = item.status === "done";

  return (
    <>
      <Card
        ref={setNodeRef}
        style={style}
        onClick={() => setOpen(true)}
        className={cn(
          "cursor-pointer group relative hover:border-primary/50 hover:shadow-sm transition-all gap-0 py-0",
          isDone && "bg-muted/30 border-muted-foreground/15",
          isAdmin && "active:cursor-grabbing",
        )}
      >
        {/* Drag handle */}
        {isAdmin && !isDone && (
          <div
            {...attributes}
            {...listeners}
            className="absolute top-2.5 right-2.5 p-0.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing z-10 hover:text-muted-foreground rounded"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </div>
        )}

        {/* Done check */}
        {isDone && (
          <div className="absolute top-2.5 right-2.5 z-10">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          </div>
        )}

        <CardHeader className="p-3 pb-1 pr-8">
          <CardTitle
            className={cn(
              "text-sm font-medium leading-snug line-clamp-2",
              isDone &&
                "text-muted-foreground line-through decoration-muted-foreground/30",
            )}
          >
            {item.title}
          </CardTitle>
        </CardHeader>

        <CardContent className="px-3 pt-0 pb-2">
          <p
            className={cn(
              "text-xs text-muted-foreground line-clamp-2 leading-relaxed",
              isDone && "opacity-60",
            )}
          >
            {item.description}
          </p>
        </CardContent>

        <CardFooter className="px-3 py-2 border-t border-border/50 flex justify-between items-center gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground">
              {getInitials(item.userEmail)}
            </div>
            <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">
              {item.userEmail?.split("@")[0] || "Anônimo"}
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground/60 shrink-0">
            {item.createdAt?.toDate().toLocaleDateString("pt-BR") || "N/A"}
          </span>
        </CardFooter>
      </Card>

      <RoadmapItemDialog
        item={item}
        open={open}
        onOpenChange={setOpen}
        onSuccess={onRefresh}
      />
    </>
  );
}
