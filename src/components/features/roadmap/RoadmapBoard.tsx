"use client";

import { useEffect, useState, useMemo } from "react";
import { 
  DndContext, 
  DragOverlay, 
  closestCorners, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  defaultDropAnimationSideEffects,
  DropAnimation
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { RoadmapItem as RoadmapItemType, RoadmapStatus, roadmapService } from "@/lib/services/roadmapService";
import { RoadmapColumn } from "./RoadmapColumn";
import { RoadmapItem } from "./RoadmapItem";
import { AddSuggestionDialog } from "./AddSuggestionDialog";
import { useAuth } from "@/components/providers/AuthProvider";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const COLUMNS: { id: RoadmapStatus; title: string }[] = [
  { id: "suggestion", title: "Sugestões" },
  { id: "planned", title: "Planejado" },
  { id: "in_progress", title: "Em Progresso" },
  { id: "done", title: "Concluído" },
];

export function RoadmapBoard() {
  const { user } = useAuth();
  const [items, setItems] = useState<RoadmapItemType[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Check strictly for 'admin' role
  const isAdmin = user?.role === "admin"; 

  const pointerSensorOptions = useMemo(() => ({
    activationConstraint: {
        distance: 5,
    },
  }), []);

  const keyboardSensorOptions = useMemo(() => ({
    coordinateGetter: sortableKeyboardCoordinates,
  }), []);

  const sensors = useSensors(
    useSensor(PointerSensor, pointerSensorOptions),
    useSensor(KeyboardSensor, keyboardSensorOptions)
  );

  const fetchItems = async () => {
    try {
      const data = await roadmapService.getAllItems();
      setItems(data);
    } catch (error) {
      toast.error("Erro ao carregar roadmap.");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const getItemsByStatus = (status: RoadmapStatus) => {
    return items.filter((item) => item.status === status);
  };

  const findContainer = (id: string): RoadmapStatus | undefined => {
    if (items.find(item => item.id === id)) {
        return items.find(item => item.id === id)?.status;
    }
    // If id is a column id
    if (COLUMNS.find(col => col.id === id)) {
        return id as RoadmapStatus;
    }
    return undefined;
  };

  const handleDragStart = (event: DragStartEvent) => {
    if (!isAdmin) return;
    const { active } = event;
    setActiveId(active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (!isAdmin) return;
    const { active, over } = event;
    const overId = over?.id;

    if (!overId || active.id === overId) return;

    const activeContainer = findContainer(active.id as string);
    // Determine the container over which the item is dropped
    const overContainer = findContainer(overId as string); 
    
    // If over item, get its status, if over column, get the column id
    const targetStatus = items.find(i => i.id === overId)?.status || (COLUMNS.find(c => c.id === overId)?.id as RoadmapStatus);

    if (!activeContainer || !targetStatus || activeContainer === targetStatus) {
      return;
    }

    // Optimistically update status for visual feedback during drag
    setItems((prev) => {
      const activeItems = prev.filter(item => item.status === activeContainer);
      const targetItems = prev.filter(item => item.status === targetStatus);
      const activeIndex = activeItems.findIndex(item => item.id === active.id);
      const overIndex = targetItems.findIndex(item => item.id === overId);

      let newIndex;
      if (overId in COLUMNS.map(c => c.id)) {
        newIndex = targetItems.length + 1;
      } else {
        const isBelowOverItem =
          over &&
          active.rect.current.translated &&
          active.rect.current.translated.top > over.rect.top + over.rect.height;

        const modifier = isBelowOverItem ? 1 : 0;
        newIndex = overIndex >= 0 ? overIndex + modifier : targetItems.length + 1;
      }

      return prev.map(item => {
        if (item.id === active.id) {
            return { ...item, status: targetStatus };
        }
        return item;
      });
    });
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!isAdmin) {
        setActiveId(null);
        return;
    }
    
    const { active, over } = event;
    const activeContainer = findContainer(active.id as string);
    const overContainer = findContainer(over?.id as string); // Could be item or column
    
    // Final status check
    const finalStatus = items.find(i => i.id === active.id)?.status; 

    if (activeId && finalStatus) {
        // Persist change to backend
        try {
           await roadmapService.updateItemStatus(activeId, finalStatus);
           toast.success("Status atualizado!");
        } catch (error) {
            toast.error("Erro ao salvar alteração.");
            fetchItems(); // Revert on error
        }
    }

    setActiveId(null);
  };

  const dropAnimation: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: {
        active: {
          opacity: '0.5',
        },
      },
    }),
  };

  if (loading) {
    return (
        <div className="flex items-center justify-center h-[50vh]">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="grid grid-cols-4 h-full gap-6 pb-4 min-w-0 overflow-x-auto">
        {COLUMNS.map((col) => (
          <RoadmapColumn
            key={col.id}
            id={col.id}
            title={col.title}
            items={getItemsByStatus(col.id)}
            isAdmin={!!isAdmin}
            extraHeader={col.id === 'suggestion' && <AddSuggestionDialog onSuccess={fetchItems} />}
          />
        ))}
      </div>
      
      <DragOverlay dropAnimation={dropAnimation}>
        {activeId ? (
            <RoadmapItem 
                item={items.find(i => i.id === activeId)!} 
                isAdmin={true} 
            />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
