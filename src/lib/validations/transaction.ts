import { z } from "zod";

export const transactionSchema = z.object({
    type: z.enum(["payable", "receivable"]),
    description: z.string().min(3, "Descrição deve ter pelo menos 3 caracteres"),
    amount: z.coerce.number().min(0.01, "Valor deve ser maior que zero"),
    dueDate: z.date({ required_error: "Data de vencimento é obrigatória" }),
    paymentDate: z.date().optional(),
    status: z.enum(["draft", "pending_approval", "approved", "paid", "rejected"]).default("draft"),

    supplierOrClient: z.string().min(2, "Fornecedor/Cliente é obrigatório"),

    requestOrigin: z.object({
        type: z.enum(["director", "department", "sector"]),
        name: z.string().min(2, "Nome da origem é obrigatório"),
    }),

    recurrence: z.object({
        isRecurring: z.boolean(),
        frequency: z.enum(["monthly", "weekly", "yearly"]).optional(),
        currentInstallment: z.number().min(1).default(1),
        totalInstallments: z.number().optional(),
    }).optional(),

    costCenterAllocation: z.array(z.object({
        costCenterId: z.string().min(1, "Centro de custo é obrigatório"),
        percentage: z.number().min(0).max(100),
        amount: z.number(),
    })).min(1, "Pelo menos um centro de custo deve ser selecionado")
        .refine((items) => {
            const total = items.reduce((acc, item) => acc + item.percentage, 0);
            return Math.abs(total - 100) < 0.1; // Allow small float error
        }, "A soma das porcentagens deve ser 100%"),

    attachments: z.array(z.object({
        id: z.string(),
        url: z.string(),
        name: z.string(),
        type: z.string(),
        category: z.enum(["invoice", "demand_proof", "other"]),
    })).optional(),

    paymentMethod: z.enum(["pix", "boleto", "transfer", "credit_card", "cash"]).optional(),
    notes: z.string().optional(),
});

export type TransactionFormData = z.infer<typeof transactionSchema>;
