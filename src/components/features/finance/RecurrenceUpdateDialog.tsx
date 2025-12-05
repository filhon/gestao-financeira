import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface RecurrenceUpdateDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (scope: "single" | "series") => void;
}

export function RecurrenceUpdateDialog({
    isOpen,
    onClose,
    onConfirm,
}: RecurrenceUpdateDialogProps) {
    return (
        <AlertDialog open={isOpen} onOpenChange={onClose}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Editar Transação Recorrente</AlertDialogTitle>
                    <AlertDialogDescription>
                        Esta transação faz parte de uma recorrência. Como você deseja aplicar as alterações?
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                    <AlertDialogCancel onClick={onClose}>Cancelar</AlertDialogCancel>
                    <Button variant="secondary" onClick={() => onConfirm("single")}>
                        Apenas esta transação
                    </Button>
                    <Button onClick={() => onConfirm("series")}>
                        Esta e as próximas
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
