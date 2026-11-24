/**
 * Previsão de cada lançamento: o valor com que nasceu. A Análise e o previsto
 * × realizado do fluxo de caixa usam as mesmas regras.
 */
import { format } from "date-fns";
import type { Transaction } from "./types";

const monthKey = (d: Date) => format(d, "yyyy-MM");
const dayKey = (d: Date) => format(d, "yyyy-MM-dd");

/** "Doação da Mantenedora - abril de 2026 (2/3)" → base e posição. */
export const PART_RE = /\s*\((\d+)\s*\/\s*(\d+)\)\s*$/;

export const groupKey = (t: Transaction) => {
  if (!PART_RE.test(t.description ?? "")) return null;
  const base = (t.description ?? "")
    .replace(PART_RE, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return [t.type, t.entityId ?? t.supplierOrClient ?? "", base].join("|");
};

export interface PlanRole {
  /** Parte criada depois da previsão: desdobra um valor já previsto. */
  split: boolean;
  /** Mês em que o lançamento conta para a previsão. */
  month: string;
}

/**
 * Papel de cada lançamento na previsão.
 *
 * Quem divide um recebimento cria as partes à mão: edita a original para
 * "(1/3)" com o primeiro valor e lança "(2/3)" e "(3/3)" depois. Contar essas
 * partes como previsão nova dobraria o mês. Num grupo de partes (mesma
 * descrição sem o "(n/m)", tipo e entidade), só o que nasceu no primeiro dia
 * do grupo é previsão; o que nasceu depois é desdobramento: entra como revisão,
 * no mês da parte prevista que ele divide. Parcelamento lançado de uma vez
 * nasce todo no mesmo dia e segue parcela a parcela.
 */
export function planRoles(transactions: Transaction[]) {
  const roles = new Map<string, PlanRole>();
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    roles.set(t.id, { split: false, month: monthKey(t.dueDate) });
    const key = groupKey(t);
    if (!key || !t.createdAt) continue;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  for (const members of groups.values()) {
    const firstDay = members.map((m) => dayKey(m.createdAt)).sort()[0];
    const planned = members
      .filter((m) => dayKey(m.createdAt) === firstDay)
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    for (const m of members) {
      if (dayKey(m.createdAt) === firstDay) continue;
      // A parte prevista que ela divide: a última que vence até ela.
      const origin =
        [...planned].reverse().find((p) => p.dueDate <= m.dueDate) ??
        planned[0];
      roles.set(m.id, { split: true, month: monthKey(origin.dueDate) });
    }
  }
  return roles;
}

/** Previsão do lançamento: o valor com que nasceu, salvo as exceções. */
export function plannedOf(t: Transaction, role?: PlanRole) {
  if (role?.split || t.unplanned) return 0;
  return t.plannedAmount ?? t.amount;
}
