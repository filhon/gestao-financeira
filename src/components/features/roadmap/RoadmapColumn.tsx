import { useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { RoadmapItem as RoadmapItemType, RoadmapStatus } from "@/lib/services/roadmapService";
import { RoadmapItem } from "./RoadmapItem";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface RoadmapColumnProps {
  id: RoadmapStatus;
  title: string;
  items: RoadmapItemType[];
  isAdmin: boolean;
  extraHeader?: React.ReactNode;
}

export function RoadmapColumn({ id, title, items, isAdmin, extraHeader }: RoadmapColumnProps) {
  const data = useMemo(() => ({
      type: "Column",
      status: id,
  }), [id]);

  const { setNodeRef, isOver } = useDroppable({
    id,
    data
  });

  const itemIds = useMemo(() => items.map(item => item.id), [items]);

  return (
    <div className="flex flex-col h-full rounded-lg bg-muted/50 w-full flex-shrink-0">
      <div className="p-4 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <h3 className="font-semibold">{title}</h3>
            <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-xs">
                {items.length}
            </Badge>
        </div>
        {extraHeader}
      </div>
      
      <div 
        ref={setNodeRef} 
        className={cn(
            "flex-1 p-2 space-y-2 overflow-y-auto min-h-[150px]",
            isOver && "bg-primary/5 rounded-b-lg"
        )}
      >
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <RoadmapItem key={item.id} item={item} isAdmin={isAdmin} />
          ))}
        </SortableContext>
        
        {items.length === 0 && (
            <div className="h-24 flex items-center justify-center border-2 border-dashed border-muted-foreground/20 rounded-lg text-muted-foreground text-sm text-center px-4">
                {id === 'suggestion' ? "Nenhuma sugestão ainda." : "Arraste itens para cá."}
            </div>
        )}
      </div>
    </div>
  );
}
