import { LucideIcon, FileX, Search, FolderOpen, Users, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
    icon?: LucideIcon;
    title: string;
    description: string;
    action?: {
        label: string;
        onClick: () => void;
    };
}

export function EmptyState({
    icon: Icon = FileX,
    title,
    description,
    action
}: EmptyStateProps) {
    return (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="rounded-full bg-muted p-4 mb-4">
                <Icon className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">{title}</h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-4">
                {description}
            </p>
            {action && (
                <Button onClick={action.onClick}>
                    {action.label}
                </Button>
            )}
        </div>
    );
}

// Pre-configured empty states for common use cases
export function EmptySearchState({ query }: { query?: string }) {
    return (
        <EmptyState
            icon={Search}
            title="Nenhum resultado encontrado"
            description={query ? `Não encontramos resultados para "${query}". Tente buscar por outros termos.` : "Tente buscar por outros termos."}
        />
    );
}

export function EmptyTransactionsState({ onAdd }: { onAdd?: () => void }) {
    return (
        <EmptyState
            icon={Receipt}
            title="Nenhuma transação encontrada"
            description="Você ainda não possui transações cadastradas. Comece adicionando sua primeira transação."
            action={onAdd ? { label: "Adicionar Transação", onClick: onAdd } : undefined}
        />
    );
}

export function EmptyEntitiesState({ onAdd }: { onAdd?: () => void }) {
    return (
        <EmptyState
            icon={Users}
            title="Nenhuma entidade cadastrada"
            description="Cadastre fornecedores e clientes para facilitar o lançamento de transações."
            action={onAdd ? { label: "Cadastrar Entidade", onClick: onAdd } : undefined}
        />
    );
}

export function EmptyFolderState() {
    return (
        <EmptyState
            icon={FolderOpen}
            title="Pasta vazia"
            description="Esta pasta não contém itens no momento."
        />
    );
}
