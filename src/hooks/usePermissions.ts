"use client";

import { useMemo } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { UserRole } from "@/lib/types";

export interface Permissions {
    // Dashboard
    canViewDashboard: boolean;

    // Transactions - Payables
    canViewPayables: boolean;
    canCreatePayables: boolean;
    canEditPayables: boolean; // Full edit (description, amount, etc.) + Delete
    canDeletePayables: boolean; // Explicit delete permission
    canApprovePayables: boolean; // Change status to approved
    canPayPayables: boolean; // Change status to paid
    onlyOwnPayables: boolean; // Restriction: can only see/edit own transactions

    // Transactions - Receivables
    canViewReceivables: boolean;
    canCreateReceivables: boolean;
    canEditReceivables: boolean;
    canDeleteReceivables: boolean;

    // Modules
    canViewRecurrences: boolean;
    canManageRecurrences: boolean; // Create/Edit/Delete

    canViewBatches: boolean;
    canManageBatches: boolean; // Create/Edit/Delete
    canApproveBatches: boolean;
    canPayBatches: boolean;

    canViewCostCenters: boolean;
    canManageCostCenters: boolean; // Create/Edit/Delete

    canViewEntities: boolean; // Suppliers/Clients
    canManageEntities: boolean; // Create/Edit/Delete

    canViewReports: boolean;

    // Admin & Settings
    canManageUsers: boolean;
    canManageCompanies: boolean;
    canViewAuditLogs: boolean;
    canAccessSettings: boolean; // General settings access

    // Role Info
    currentRole: UserRole | null;
    isAdmin: boolean;
    isFinancialManager: boolean;
}

export function usePermissions(): Permissions {
    const { user } = useAuth();
    const { selectedCompany } = useCompany();

    // Get effective role for current company
    // If global admin, role is 'admin'.
    // If not global admin, check companyRoles[companyId].
    const globalRole = user?.role;
    const companyRole = (user && selectedCompany?.id && user.companyRoles?.[selectedCompany.id]) as UserRole | undefined;

    const isGlobalAdmin = globalRole === 'admin';
    const effectiveRole: UserRole | null = isGlobalAdmin ? 'admin' : (companyRole || null);

    // Helpers
    const isRole = (role: UserRole) => effectiveRole === role;
    const isOneOf = (roles: UserRole[]) => effectiveRole ? roles.includes(effectiveRole) : false;

    // Role definitions
    const isAdmin = isGlobalAdmin;
    const isManager = isRole('financial_manager') || isRole('admin');
    const isUser = isRole('user');

    // Combined Helpers
    const isAdminOrManager = isAdmin || isManager;

    // Memoize the return object to prevent unnecessary re-renders in consumers
    return useMemo(() => ({
        // Dashboard
        // Admin, Manager, Approver, Releaser can view.
        // Auditor, User cannot (Spec: "Não poderá visualizar o dashboard")
        canViewDashboard: isOneOf(['admin', 'financial_manager', 'approver', 'releaser']),

        // Payables
        // View: Everyone except maybe User who has specific restriction? 
        // Spec User: "Pode visualizar somente as contas a pagar incluídas por ele". So canView is true, but requires filter.
        canViewPayables: true,
        canCreatePayables: isOneOf(['admin', 'financial_manager', 'user']),
        canEditPayables: isOneOf(['admin', 'financial_manager', 'user']), // User can edit own
        canDeletePayables: isOneOf(['admin', 'financial_manager', 'user']), // User can delete own
        canApprovePayables: isOneOf(['admin', 'financial_manager', 'approver']),
        canPayPayables: isOneOf(['admin', 'financial_manager', 'releaser']),
        onlyOwnPayables: isUser,

        // Receivables
        // User cannot view.
        // Approver/Releaser/Auditor: View only.
        // Admin/Manager: Full.
        canViewReceivables: isOneOf(['admin', 'financial_manager', 'approver', 'releaser', 'auditor']),
        canCreateReceivables: isAdminOrManager,
        canEditReceivables: isAdminOrManager,
        canDeleteReceivables: isAdminOrManager,

        // Recurrences
        // User/Auditor cannot view (Spec Auditor: "Não poderá visualizar recorrências"? 
        // Wait, Spec Auditor item 5: "Não poderá visualizar recorrências...". Correct).
        // Approver/Releaser: View only.
        // Admin/Manager: Full.
        canViewRecurrences: isOneOf(['admin', 'financial_manager', 'approver', 'releaser']),
        canManageRecurrences: isAdminOrManager,

        // Batches
        // User/Auditor cannot view.
        // Approver: View + Approve.
        // Releaser: View + Pay.
        // Admin/Manager: Full.
        canViewBatches: isOneOf(['admin', 'financial_manager', 'approver', 'releaser']),
        canManageBatches: isAdminOrManager,
        canApproveBatches: isOneOf(['admin', 'financial_manager', 'approver']),
        canPayBatches: isOneOf(['admin', 'financial_manager', 'releaser']),

        // Cost Centers
        // User: View assigned (canView = true).
        // Auditor: View.
        // Allocators (everyone who creates tx needs to view).
        // Spec: Approver/Releaser/Auditor/User can view details.
        // Admin/Manager: Full.
        canViewCostCenters: true, // Everyone active can view (restricted logic might apply for 'user' to only see allowed, but page access is allowed)
        canManageCostCenters: isAdminOrManager,

        // Entities
        // Spec:
        // Approver: Hide.
        // Auditor: Hide.
        // User: Hide.
        // Releaser: Same as Approver (Hide).
        // Admin/Manager: Full.
        canViewEntities: isAdminOrManager,
        canManageEntities: isAdminOrManager,

        // Reports
        // User: No.
        // Others: Yes.
        canViewReports: isOneOf(['admin', 'financial_manager', 'approver', 'releaser', 'auditor']),

        // Admin & Settings
        canManageUsers: isAdminOrManager, // Manager manages company users
        canManageCompanies: isAdmin, // Only global admin
        canViewAuditLogs: isOneOf(['admin', 'auditor', 'approver', 'releaser']), // Spec: Admin, Approver(11), Auditor(7). Releaser (same as approver?). Releaser spec didn't explicitly say yes/no on logs but said "same as approver", so I assume Yes? 
        // Re-reading Spec: "Usuários releaser... Terá o mesmo acesso do approver...".
        // Approver item 11: "Poderá visualizar os logs de auditoria".
        // Manager item 12: "Não poderá visualizar os logs de auditoria". STRANGE but spec says so.
        // Admin: Yes.
        // User: No.

        canAccessSettings: isAdminOrManager, // General 'Settings' menu access

        // Role Info
        currentRole: effectiveRole,
        isAdmin,
        isFinancialManager: isManager,
    }), [effectiveRole, isAdmin, isManager, isUser, isAdminOrManager]);
}
