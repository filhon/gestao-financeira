import { format } from "date-fns";
import { z } from "zod";

export const bankAccountSchema = z
  .object({
    kind: z.enum(["checking", "investment"]),
    name: z.string().trim().min(1, "Dê um nome para a conta").max(60),
    bankName: z.string().trim().max(60).optional(),
    bankCode: z
      .string()
      .trim()
      .regex(/^\d{0,4}$/, "Use o código numérico do banco (ex.: 341)")
      .optional(),
    agency: z.string().trim().max(10).optional(),
    accountNumber: z.string().trim().max(20),
    product: z
      .enum(["cdb", "lci_lca", "fund", "treasury", "savings", "auto", "other"])
      .optional(),
    liquidity: z.enum(["daily", "maturity"]).optional(),
    linkedAccountId: z.string().optional(),
    yieldAccountId: z.string().optional(),
    cdiPercent: z
      .number({ message: "Informe a taxa em % do CDI" })
      .positive("A taxa precisa ser maior que zero")
      .max(300, "Confira a taxa: acima de 300% do CDI")
      .optional(),
    taxExempt: z.boolean(),
    taxAccountId: z.string().optional(),
    taxCostCenterId: z.string().optional(),
    openingPrincipal: z.number().min(0).optional(),
    openingBalance: z.number().min(0),
    overdrawn: z.boolean(),
    openingBalanceDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data do saldo")
      .refine((v) => v <= format(new Date(), "yyyy-MM-dd"), {
        message: "A data do saldo não pode ser futura",
      }),
    active: z.boolean(),
  })
  // Aplicação não tem extrato OFX para reconhecer: o número é opcional.
  .refine((d) => d.kind === "investment" || d.accountNumber.length > 0, {
    path: ["accountNumber"],
    message: "Informe o número da conta",
  })
  .refine((d) => d.kind !== "investment" || !!d.linkedAccountId, {
    path: ["linkedAccountId"],
    message: "Escolha a conta corrente da aplicação",
  })
  .refine(
    (d) =>
      d.openingPrincipal === undefined ||
      d.openingPrincipal <= d.openingBalance,
    {
      path: ["openingPrincipal"],
      message: "O valor aplicado não passa do saldo bruto",
    },
  );

export type BankAccountFormData = z.infer<typeof bankAccountSchema>;
