"use client";

import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  RoadmapItem,
  roadmapService,
  RoadmapStatus,
} from "@/lib/services/roadmapService";
import { Loader2, Trash2 } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface RoadmapItemDialogProps {
  item: RoadmapItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

const statusLabels: Record<RoadmapStatus, string> = {
  suggestion: "Sugestão",
  planned: "Planejado",
  in_progress: "Em Progresso",
  done: "Concluído",
};

export function RoadmapItemDialog({
  item,
  open,
  onOpenChange,
  onSuccess,
}: RoadmapItemDialogProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (item && open) {
      setTitle(item.title);
      setDescription(item.description);
      setIsEditing(false); // Reset edit mode on open
    }
  }, [item, open]);

  const handleUpdate = async () => {
    if (!item) return;
    if (!title.trim() || !description.trim()) {
      toast.error("Preencha todos os campos.");
      return;
    }

    setLoading(true);
    try {
      await roadmapService.updateItem(item.id, { title, description });
      toast.success("Item atualizado!");
      onSuccess();
      setIsEditing(false); // Exit edit mode
    } catch {
      toast.error("Erro ao atualizar item.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!item) return;

    setLoading(true);
    try {
      await roadmapService.deleteItem(item.id);
      toast.success("Item removido!");
      onSuccess();
      onOpenChange(false);
    } catch {
      toast.error("Erro ao remover item.");
    } finally {
      setLoading(false);
    }
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            {isEditing ? "Editar Item" : item.title}
          </DialogTitle>
          <DialogDescription>
            Status:{" "}
            <span className="font-medium text-primary">
              {statusLabels[item.status]}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {isEditing ? (
            <>
              <div className="space-y-2">
                <Input
                  placeholder="Título"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Textarea
                  placeholder="Descrição"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  disabled={loading}
                />
              </div>
            </>
          ) : (
            <div className="text-sm text-foreground whitespace-pre-wrap">
              {item.description}
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-between sm:justify-between w-full">
          {/* Left side actions (Delete) */}
          <div>
            {isAdmin && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta ação não pode ser desfeita.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDelete}
                      className="bg-destructive hover:bg-destructive/90"
                    >
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Excluir"
                      )}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>

          {/* Right side actions (Edit/Save/Close) */}
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setIsEditing(false)}
                  disabled={loading}
                >
                  Cancelar
                </Button>
                <Button onClick={handleUpdate} disabled={loading}>
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    "Salvar"
                  )}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Fechar
                </Button>
                {isAdmin && (
                  <Button onClick={() => setIsEditing(true)}>Editar</Button>
                )}
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
