import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCpfCnpj } from "@/lib/validations/cnpj";
import { ENTITY_BANK_FIELDS, Entity, TaxRegime } from "@/lib/types";

/** Rótulos e marcas de entidade, iguais na lista, no detalhe e no formulário. */

export const CATEGORY_LABELS: Record<Entity["category"], string> = {
  supplier: "Fornecedor",
  client: "Cliente",
  both: "Fornecedor e cliente",
};

export const TAX_REGIME_LABELS: Record<TaxRegime, string> = {
  mei: "MEI",
  simples: "Simples Nacional",
  presumido: "Lucro Presumido",
  real: "Lucro Real",
  imune: "Imune / isento",
};

export const PAYMENT_METHOD_LABELS: Record<
  NonNullable<Entity["defaultPaymentMethod"]>,
  string
> = {
  pix: "PIX",
  boleto: "Boleto",
  transfer: "Transferência",
  credit_card: "Cartão de crédito",
  cash: "Dinheiro",
};

export const PIX_KEY_TYPE_LABELS: Record<
  NonNullable<Entity["pixKeyType"]>,
  string
> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  phone: "Telefone",
  random: "Aleatória",
};

export const isActive = (e: Pick<Entity, "active">) => e.active !== false;

export const hasBankDetails = (e: Entity) =>
  !!(e.pixKey || e.account) ||
  !!e.extraBankAccounts?.some((a) => a.pixKey || a.account);

/** Documento com máscara; sem documento, traço. */
export const displayDocument = (doc?: string) =>
  doc ? formatCpfCnpj(doc) : "—";

export const documentKind = (e: Pick<Entity, "type">) =>
  e.type === "company" ? "CNPJ" : "CPF";

export const bankFieldsOf = (e: Partial<Entity>) =>
  ENTITY_BANK_FIELDS.filter((f) => e[f]);

/** Categoria não é estado: marca neutra, sem cor. */
export function CategoryBadge({
  category,
  className,
}: {
  category: Entity["category"];
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("font-normal text-muted-foreground", className)}
    >
      {CATEGORY_LABELS[category] ?? category}
    </Badge>
  );
}

/** Marcas que pedem atenção: inativa, troca bancária, parte relacionada. */
export function EntityFlags({ entity }: { entity: Entity }) {
  return (
    <>
      {!isActive(entity) && (
        <Badge variant="secondary" className="font-normal">
          Inativa
        </Badge>
      )}
      {entity.pendingBankChange && (
        <Badge className="border-0 bg-amber-100 font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
          Troca bancária pendente
        </Badge>
      )}
      {entity.relatedParty && (
        <Badge variant="outline" className="font-normal">
          Parte relacionada
        </Badge>
      )}
    </>
  );
}
