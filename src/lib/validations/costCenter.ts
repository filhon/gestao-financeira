import { z } from "zod";

export const costCenterSchema = z.object({
    name: z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
    code: z.string().min(2, "Código deve ter pelo menos 2 caracteres"),
    parentId: z.string().optional(),
    description: z.string().optional(),
    budget: z.number().min(0, "Orçamento deve ser positivo").optional(),

    // Permissions
    allowedUserIds: z.array(z.string()).optional(),
    approverEmail: z.string().email("Email inválido").optional().or(z.literal("")),
    releaserEmail: z.string().email("Email inválido").optional().or(z.literal("")),
    budgetLimit: z.number().min(0).optional(),
});

export type CostCenterFormData = z.infer<typeof costCenterSchema>;
