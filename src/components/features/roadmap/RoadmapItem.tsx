import { RoadmapItem as RoadmapItemType } from "@/lib/services/roadmapService";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { GripVertical } from "lucide-react";
import { RoadmapItemDialog } from "./RoadmapItemDialog";

interface RoadmapItemProps {
  item: RoadmapItemType;
  isAdmin: boolean;
}

export function RoadmapItem({ item, isAdmin }: RoadmapItemProps) {
  const [open, setOpen] = useState(false);
  const data = useMemo(
    () => ({
      type: "Item",
      item,
    }),
    [item]
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
    disabled: !isAdmin, // Only drag if admin
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
        className="opacity-30 bg-primary/10 border-2 border-primary border-dashed rounded-lg h-[150px]"
      />
    );
  }

  return (
    <>
      <Card
        ref={setNodeRef}
        style={style}
        onClick={() => setOpen(true)}
        className={cn(
          "cursor-pointer group relative hover:border-primary/50 transition-colors gap-0 py-0",
          item.status === "done" && "bg-muted/50 border-muted-foreground/20",
          isAdmin && "active:cursor-grabbing"
        )}
      >
        {/* Drag Handle for Admin */}
        {isAdmin && (
          <div
            {...attributes}
            {...listeners}
            className="absolute top-2 right-2 p-1 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing z-10 hover:bg-muted rounded"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-4 w-4" />
          </div>
        )}

        {/* Done Checkmark Badge - Absolute positioned */}
        {item.status === "done" && (
          <div className="absolute top-2 right-2 p-1 text-green-600 bg-green-100 dark:bg-green-900/30 rounded-full z-0">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-3 h-3"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        )}

        <CardHeader className="p-2 pb-1 pr-8">
          <CardTitle
            className={cn(
              "text-sm font-medium leading-normal line-clamp-2",
              item.status === "done" &&
                "text-muted-foreground line-through decoration-muted-foreground/30"
            )}
          >
            {item.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-2 pt-0 pb-1">
          <p
            className={cn(
              "text-xs text-muted-foreground line-clamp-3",
              item.status === "done" && "opacity-70"
            )}
          >
            {item.description}
          </p>
        </CardContent>
        <CardFooter className="p-2 pt-2 text-[10px] text-muted-foreground flex justify-between items-center">
          <span className="truncate max-w-[120px]">
            {item.userEmail || "Anônimo"}
          </span>
          <Badge
            variant="secondary"
            className="text-[9px] h-4 px-1.5 font-normal"
          >
            {item.createdAt?.toDate().toLocaleDateString("pt-BR") || "N/A"}
          </Badge>
        </CardFooter>
      </Card>

      <RoadmapItemDialog
        item={item}
        open={open}
        onOpenChange={setOpen}
        onSuccess={() => {
          window.location.reload();
        }}
      />
    </>
  );
}
