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
  const fresh = freshFor(entity, allEntities);
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

/** Filtra o que é novo para a entidade e não identifica outra; respeita o teto. */
function freshFor(entity: Entity, allEntities: Entity[]) {
  const own = entityIdentifiers(entity);
  const taken = allEntities
    .filter((e) => e.id !== entity.id)
    .map(entityIdentifiers);
  return (kind: keyof ReceiptAliases, values: string[]) => {
    const room = MAX_PER_KIND - (entity.receiptAliases?.[kind]?.length ?? 0);
    return [...new Set(values)]
      .filter(
        (v) =>
          v &&
          !own[kind].includes(v) &&
          !taken.some((t) => t[kind].includes(v)),
      )
      .slice(0, Math.max(0, room));
  };
}

/** Palavras do banco antes do nome: "PAGAMENTOS A FORNECEDORES", "TED RECEBIDA". */
const STATEMENT_PREFIX =
  /^(?:(?:pagamentos?|pagto|pgto|pag|a|ao|de|fornecedores?|fornec|pix|ted|doc|tev|transf|transferencia|enviad[oa]|recebid[oa]|sispag|boleto|\d+)\s+)+/;

/** Favorecido como o banco escreveu: histórico sem prefixo, documento e data. */
export function statementPayee(description: string): string {
  const name = normalize(
    description
      .replace(/\d[\d./-]{9,18}\d/g, " ")
      .replace(/\d{2}\/\d{2}(\/\d{2,4})?/g, " "),
  ).replace(STATEMENT_PREFIX, "");
  return /[a-z]{3}/.test(name) ? name : "";
}

/**
 * O que uma linha do extrato confirmada ensina sobre o favorecido: o CPF/CNPJ
 * e o nome que o banco imprimiu. Na próxima vez, a linha casa mesmo que o
 * cadastro não tenha documento ou use outro nome. Mesmas travas do
 * comprovante: nada que já identifique outra entidade.
 */
export function statementAliases(
  description: string,
  documents: string[],
  entity: Entity,
  allEntities: Entity[],
): ReceiptAliases {
  const fresh = freshFor(entity, allEntities);
  const payee = statementPayee(description);
  return {
    documents: fresh("documents", documents),
    pixKeys: [],
    names: fresh("names", payee ? [payee] : []),
  };
}

export const hasAliases = (a: ReceiptAliases) =>
  a.documents.length + a.pixKeys.length + a.names.length > 0;
