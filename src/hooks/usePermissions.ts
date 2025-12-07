"use client";

import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { UserRole } from "@/lib/types";

export interface Permissions {
    // User management
    canManageUsers: boolean;
    canApproveUsers: boolean;

    // Settings
    canAccessSettings: boolean;
    canManageCompanies: boolean;
    canViewAuditLogs: boolean;

    // Transactions
    canCreateTransactions: boolean;
    canViewAllTransactions: boolean;
    canApproveTransactions: boolean;
    canPayTransactions: boolean;
    canDeleteTransactions: boolean;

    // Cost Centers
    canManageCostCenters: boolean;

    // Entities (suppliers/clients)
    canManageEntities: boolean;

    // Current role info
    currentRole: UserRole | null;
    isAdmin: boolean;
}

const ADMIN_ROLES: UserRole[] = ['admin'];
const MANAGER_ROLES: UserRole[] = ['admin', 'financial_manager'];
const APPROVER_ROLES: UserRole[] = ['admin', 'financial_manager', 'approver'];
const PAYER_ROLES: UserRole[] = ['admin', 'financial_manager', 'releaser'];
const CREATOR_ROLES: UserRole[] = ['admin', 'financial_manager', 'approver', 'releaser', 'user'];
const VIEWER_ROLES: UserRole[] = ['admin', 'financial_manager', 'approver', 'releaser', 'auditor'];

export function usePermissions(): Permissions {
    const { user } = useAuth();
    const { selectedCompany } = useCompany();

    // Get effective role for current company
    const currentRole: UserRole | null = user
        ? (selectedCompany?.id && user.companyRoles?.[selectedCompany.id]) || user.role
        : null;

    const hasRole = (allowedRoles: UserRole[]): boolean => {
        if (!currentRole) return false;
        return allowedRoles.includes(currentRole);
    };

    return {
        // User management
        canManageUsers: hasRole(ADMIN_ROLES),
        canApproveUsers: hasRole(ADMIN_ROLES),

        // Settings
        canAccessSettings: hasRole(MANAGER_ROLES),
        canManageCompanies: hasRole(ADMIN_ROLES),
        canViewAuditLogs: hasRole(['admin', 'auditor']),

        // Transactions
        canCreateTransactions: hasRole(CREATOR_ROLES),
        canViewAllTransactions: hasRole(VIEWER_ROLES),
        canApproveTransactions: hasRole(APPROVER_ROLES),
        canPayTransactions: hasRole(PAYER_ROLES),
        canDeleteTransactions: hasRole(MANAGER_ROLES),

        // Cost Centers
        canManageCostCenters: hasRole(MANAGER_ROLES),

        // Entities
        canManageEntities: hasRole(MANAGER_ROLES),

        // Role info
        currentRole,
        isAdmin: hasRole(ADMIN_ROLES),
    };
}
