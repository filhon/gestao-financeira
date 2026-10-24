import { z } from "zod";

export const bankAccountSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome para a conta").max(60),
  bankName: z.string().trim().max(60).optional(),
  bankCode: z
    .string()
    .trim()
    .regex(/^\d{0,4}$/, "Use o código numérico do banco (ex.: 341)")
    .optional(),
  agency: z.string().trim().max(10).optional(),
  accountNumber: z.string().trim().min(1, "Informe o número da conta").max(20),
  openingBalance: z.number().min(0),
  overdrawn: z.boolean(),
  openingBalanceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data do saldo"),
  active: z.boolean(),
});

export type BankAccountFormData = z.infer<typeof bankAccountSchema>;
