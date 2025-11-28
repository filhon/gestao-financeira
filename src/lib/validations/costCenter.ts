import { z } from "zod";

export const costCenterSchema = z.object({
    name: z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
    code: z.string().min(2, "Código deve ter pelo menos 2 caracteres"),
    parentId: z.string().optional(),
    description: z.string().optional(),
    budget: z.coerce.number().min(0, "Orçamento deve ser positivo").default(0),

    // Permissions
    allowedUserIds: z.array(z.string()).optional(),
    approverId: z.string().optional(),
    releaserId: z.string().optional(),
    budgetLimit: z.coerce.number().min(0).default(0),
});

export type CostCenterFormData = z.infer<typeof costCenterSchema>;
