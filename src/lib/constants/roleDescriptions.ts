import { UserRole } from "@/lib/types";

export const ROLE_DESCRIPTIONS: Record<UserRole, { label: string; description: string }> = {
    admin: {
        label: "Administrador",
        description: "Acesso total à empresa. Gerencia usuários, configurações e todas as operações financeiras."
    },
    financial_manager: {
        label: "Gerente Financeiro",
        description: "Gerencia transações financeiras, aprova pagamentos e visualiza relatórios completos."
    },
    approver: {
        label: "Aprovador",
        description: "Aprova solicitações de despesas e transações dentro dos centros de custo autorizados."
    },
    releaser: {
        label: "Pagador/Baixador",
        description: "Libera pagamentos aprovados para execução e registra baixas de títulos."
    },
    auditor: {
        label: "Auditor",
        description: "Visualiza todas as transações e relatórios para fins de auditoria (somente leitura)."
    },
    user: {
        label: "Usuário",
        description: "Usuário básico. Pode criar solicitações de despesas vinculadas a centros de custo autorizados."
    }
};
