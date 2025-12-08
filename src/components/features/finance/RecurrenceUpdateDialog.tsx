import {
    AlertDialog,
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
    installmentInfo?: {
        current: number;
        total: number;
    };
}

export function RecurrenceUpdateDialog({
    isOpen,
    onClose,
    onConfirm,
    installmentInfo,
}: RecurrenceUpdateDialogProps) {
    const isInstallment = installmentInfo && installmentInfo.total > 1;
    const remainingCount = isInstallment ? installmentInfo.total - installmentInfo.current + 1 : 0;

    return (
        <AlertDialog open={isOpen} onOpenChange={onClose}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {isInstallment ? "Editar Transação Parcelada" : "Editar Transação Recorrente"}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {isInstallment ? (
                            <>
                                Esta transação é a <strong>parcela {installmentInfo.current} de {installmentInfo.total}</strong>.
                                Como você deseja aplicar as alterações?
                            </>
                        ) : (
                            "Esta transação faz parte de uma recorrência. Como você deseja aplicar as alterações?"
                        )}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                    <AlertDialogCancel onClick={onClose}>Cancelar</AlertDialogCancel>
                    <Button variant="secondary" onClick={() => onConfirm("single")}>
                        Apenas esta parcela
                    </Button>
                    <Button onClick={() => onConfirm("series")}>
                        Esta e as próximas {isInstallment && remainingCount > 1 ? `(${remainingCount})` : ""}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
