import { z } from "zod";

export const chartAccountSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)*$/, "Use números separados por ponto, como 3.1.02"),
  name: z
    .string()
    .trim()
    .min(2, "Informe o nome da conta")
    .max(120, "Até 120 caracteres"),
  type: z.enum(["synthetic", "analytic"]),
  nature: z.enum(["revenue", "expense"]),
  /** Um `DreGroup` ou "inherit" (vem da conta superior). */
  dreGroup: z.string(),
  description: z.string().max(500, "Até 500 caracteres").optional(),
});

export type ChartAccountFormData = z.infer<typeof chartAccountSchema>;
