import { z } from "zod";

export const costCenterSchema = z.object({
  name: z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
  code: z.string().trim().min(1, "Código é obrigatório"),
  parentId: z.string().optional(),
  description: z.string().optional(),
  // Sem `budget`, `budgetYear` nem `budgetLimit`: o orçamento de um centro é o
  // envelope anual, que vive no razão e só é definido por
  // `setCostCenterEnvelope`. O formulário trata só de identidade.
  archived: z.boolean().optional(),

  // Recurso com restrição do doador (DFC e recursos restritos)
  restricted: z.boolean().optional(),
  restrictedAccountIds: z.array(z.string()).optional(),
  restrictedText: z
    .string()
    .trim()
    .max(60, "Até 60 caracteres")
    .refine((v) => v === "" || v.length >= 3, "Pelo menos 3 letras")
    .optional(),

  // Permissions
  allowedUserIds: z.array(z.string()).optional(),
  approverEmail: z
    .string()
    .email("Email inválido")
    .optional()
    .or(z.literal("")),
  releaserEmail: z
    .string()
    .email("Email inválido")
    .optional()
    .or(z.literal("")),
});

export type CostCenterFormData = z.infer<typeof costCenterSchema>;
