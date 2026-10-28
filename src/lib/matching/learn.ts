import type { Entity } from "@/lib/types";
import { bankAccountsOf } from "../entityBankAccounts";
import { normalizePixKey } from "./brazilian";
import type { ReceiptFacts } from "./receipt";
import { digitsOnly, normalize } from "./text";

export interface ReceiptAliases {
  documents: string[];
  pixKeys: string[];
  names: string[];
}

// ponytail: teto fixo por fornecedor; se encher, os mais antigos ficam (sem rotação)
const MAX_PER_KIND = 20;

/** Tudo que já identifica uma entidade: cadastro + aliases aprendidos. */
export function entityIdentifiers(entity: Entity) {
  return {
    documents: [
      ...(entity.document ? [digitsOnly(entity.document)] : []),
      ...(entity.receiptAliases?.documents ?? []).map(digitsOnly),
    ],
    pixKeys: [
      ...bankAccountsOf(entity).flatMap((a) =>
        a.pixKey ? [normalizePixKey(a.pixKey)] : [],
      ),
      ...(entity.receiptAliases?.pixKeys ?? []).map(normalizePixKey),
    ],
    names: [
      normalize(entity.name),
      ...(entity.receiptAliases?.names ?? []).map(normalize),
    ],
  };
}

/**
 * O que um comprovante confirmado pelo usuário ensina sobre o beneficiário.
 *
 * Só aprende o que o parser leu como do *beneficiário*: CNPJ/CPF rotulado,
 * nome do bloco "Favorecido/Recebedor" e a chave Pix quando há uma só (com
 * duas, uma pode ser do pagador). Nunca aprende algo que já identifica outra
 * entidade: um alias ambíguo faria o motor sugerir com confiança o fornecedor
 * errado.
 */
export function learnableAliases(
  facts: ReceiptFacts,
  entity: Entity,
  allEntities: Entity[],
): ReceiptAliases {
  const own = entityIdentifiers(entity);
  const taken = allEntities
    .filter((e) => e.id !== entity.id)
    .map(entityIdentifiers);
  const takenBy = (kind: keyof ReceiptAliases, value: string) =>
    taken.some((t) => t[kind].includes(value));

  const fresh = (kind: keyof ReceiptAliases, values: string[]) => {
    const room = MAX_PER_KIND - (entity.receiptAliases?.[kind]?.length ?? 0);
    return [...new Set(values)]
      .filter((v) => v && !own[kind].includes(v) && !takenBy(kind, v))
      .slice(0, Math.max(0, room));
  };

  return {
    documents: fresh(
      "documents",
      facts.documents
        .filter((d) => d.role === "beneficiary" && !d.masked)
        .map((d) => d.digits),
    ),
    pixKeys: fresh(
      "pixKeys",
      facts.pixKeys.length === 1 ? facts.pixKeys.map(normalizePixKey) : [],
    ),
    names: fresh(
      "names",
      facts.beneficiaryNames.map(normalize).filter((n) => n.length >= 3),
    ),
  };
}

export const hasAliases = (a: ReceiptAliases) =>
  a.documents.length + a.pixKeys.length + a.names.length > 0;
