import {
  ENTITY_BANK_FIELDS,
  Entity,
  EntityBankAccount,
  EntityBankDetails,
} from "./types";

/** Id da conta principal (os campos bancários soltos no cadastro). */
export const MAIN_BANK_ACCOUNT = "main";

const detailsOf = (e: Partial<EntityBankDetails>): EntityBankDetails =>
  Object.fromEntries(ENTITY_BANK_FIELDS.map((f) => [f, e[f]]));

/** Principal primeiro, depois as outras, todas com id. */
export const bankAccountsOf = (e: Partial<Entity>): EntityBankAccount[] => [
  { id: MAIN_BANK_ACCOUNT, ...detailsOf(e) },
  ...(e.extraBankAccounts ?? []),
];

export const bankAccountLabel = (a: EntityBankAccount, index: number) =>
  a.bankAccountName?.trim() ||
  (index === 0 ? "Conta principal" : `Conta ${index + 1}`);

/** "PIX x · 341 - Itaú · ag. 1 · c/c 2": para listas e seletores. */
export const bankAccountSummary = (a: EntityBankDetails) =>
  [
    a.pixKey && `PIX ${a.pixKey}`,
    a.bankName,
    a.agency && `ag. ${a.agency}`,
    a.account && `c/c ${a.account}`,
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * Cadastro com os dados bancários da conta escolhida no lançamento no lugar
 * dos da principal, para quem lê `entity.pixKey` etc. Conta que saiu do
 * cadastro volta sem dados: melhor o lote acusar falta do que pagar em outra.
 */
export function withPayeeAccount<T extends Partial<Entity>>(
  entity: T,
  accountId?: string,
): T {
  if (!accountId || accountId === MAIN_BANK_ACCOUNT) return entity;
  const found = entity.extraBankAccounts?.find((a) => a.id === accountId);
  return {
    ...entity,
    ...detailsOf(found ?? {}),
  };
}
