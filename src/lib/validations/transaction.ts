import { z } from "zod";
import { parseBoleto } from "@/lib/boleto";

// Mensagens padrão do Zod em português para toda regra sem texto próprio.
z.config(z.locales.pt());

export const transactionSchema = z.object({
  type: z.enum(["payable", "receivable"]),
  description: z.string().min(3, "Descrição deve ter pelo menos 3 caracteres"),
  amount: z.coerce.number().min(0.01, "Valor deve ser maior que zero"),
  dueDate: z.date({ error: "Informe o vencimento" }),
  paymentDate: z.date().optional(),
  finalAmount: z.number().optional(),
  // Todos os status: a edição de uma conta já autorizada também passa por aqui.
  status: z
    .enum([
      "draft",
      "pending_approval",
      "approved",
      "pending_authorization",
      "authorized",
      "paid",
      "received",
      "rejected",
    ])
    .default("draft"),

  supplierOrClient: z.string().trim().min(2, "Informe o fornecedor ou cliente"),
  entityId: z.string().optional(),

  /** Número da nota fiscal, fatura ou contrato. */
  documentNumber: z.string().trim().max(60).optional(),
  /** Mês de competência (yyyy-MM): o mês a que a despesa ou receita pertence. */
  competence: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "Competência inválida")
    .optional(),

  // Opcional de verdade: os dois campos vazios contam como "não informado".
  requestOrigin: z.preprocess(
    (v) => {
      const o = v as { type?: string; name?: string } | undefined;
      return o?.type || o?.name?.trim() ? o : undefined;
    },
    z
      .object({
        type: z.enum(["director", "department", "sector"], {
          error: "Escolha o tipo da área",
        }),
        name: z.string().trim().min(2, "Informe o nome da área"),
      })
      .optional(),
  ),

  recurrence: z
    .object({
      isRecurring: z.boolean(),
      frequency: z
        .enum(["daily", "weekly", "monthly", "yearly", "custom"])
        .optional(),
      interval: z.number().min(1).optional(),
      intervalUnit: z.enum(["days", "weeks", "months", "years"]).optional(),
      endDate: z.date().optional(),
    })
    .optional(),

  // Form-only field to capture installment intent
  installmentsCount: z.coerce
    .number()
    .min(2, "Mínimo de 2 parcelas")
    .max(120, "Máximo de 120 parcelas")
    .optional(),
  useInstallments: z.boolean().optional(),

  costCenterAllocation: z
    .array(
      z.object({
        costCenterId: z.string().min(1, "Escolha o centro de custo"),
        percentage: z.number().min(0).max(100),
        amount: z.number(),
      }),
    )
    .min(1, "Pelo menos um centro de custo deve ser selecionado")
    .refine((items) => {
      const total = items.reduce((acc, item) => acc + item.percentage, 0);
      return Math.abs(total - 100) < 0.1; // Allow small float error
    }, "A soma das porcentagens deve ser 100%"),

  // Obrigatória só a partir do exercício configurado no plano de contas; o
  // formulário confere isso no envio, porque depende da empresa e da data.
  accountId: z.string().optional(),

  attachments: z
    .array(
      z.object({
        id: z.string(),
        url: z.string(),
        name: z.string(),
        type: z.string(),
        category: z.enum(["invoice", "demand_proof", "other"]),
      }),
    )
    .optional(),

  paymentMethod: z
    .enum(["pix", "boleto", "transfer", "credit_card", "cash"])
    .optional(),
  /** Conta bancária por onde o dinheiro sai (despesa) ou entra (receita). */
  bankAccountId: z.string().optional(),
  details: z
    .string()
    .max(2000, "Detalhes devem ter no máximo 2000 caracteres")
    .optional(),
  notes: z.string().optional(),
  barcode: z
    .string()
    .optional()
    .refine(
      (v) => !v || parseBoleto(v).valid,
      "Linha digitável inválida: confira os dígitos",
    ),
  dunningStatus: z
    .object({
      emailSent: z.boolean(),
      whatsappSent: z.boolean(),
    })
    .optional(),

  isReimbursement: z.boolean().optional(),
});

export type TransactionFormData = z.infer<typeof transactionSchema>;
