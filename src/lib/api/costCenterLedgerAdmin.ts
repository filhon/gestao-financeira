/**
 * Leitura do razão de envelope pelo Admin SDK, para as rotas da API v1.
 *
 * Espelha `costCenterLedgerService`, que é a versão do navegador. As duas
 * calculam `disponível = recebido + carryIn − alocadoAosFilhos − gastoDireto`
 * e compartilham a montagem da árvore, para que a API nunca responda um número
 * diferente do que a tela mostra.
 */
import { adminDb } from "@/lib/firebase/admin";
import { CostCenter } from "@/lib/types";
import { buildCostCenterTree, parentOf } from "@/lib/costCenterTree";

const LEDGER_COLLECTION = "cost_center_ledger";
const TRANSACTIONS_COLLECTION = "transactions";

/** Quantos exercícios anteriores o carry-over percorre antes de desistir. */
const MAX_CARRY_LOOKBACK = 10;

export const ledgerId = (
  companyId: string,
  costCenterId: string,
  year: number,
) => `${companyId}_${costCenterId}_${year}`;

export interface LedgerBalance {
  costCenterId: string;
  year: number;
  isRoot: boolean;
  isLeaf: boolean;
  carryIn: number;
  received: number;
  allocatedToChildren: number;
  spentDirect: number;
  spentDirectPaid: number;
  subtreeSpent: number;
  subtreeSpentPaid: number;
  /** received + carryIn − allocatedToChildren − spentDirect. Pode ser negativo. */
  available: number;
}

const num = (v: unknown) => Number(v ?? 0) || 0;

/**
 * Sobra consolidada dos exercícios anteriores, que vira caixa do raiz.
 *
 * Alocações internas são transferência, não consumo — por isso a sobra da
 * árvore inteira sai de `received − subtreeSpent` no raiz, sem varrer filhos.
 */
async function readCarryIn(companyId: string, rootId: string, year: number) {
  const firstYear = year - MAX_CARRY_LOOKBACK;
  const refs = Array.from({ length: MAX_CARRY_LOOKBACK }, (_, i) =>
    adminDb
      .collection(LEDGER_COLLECTION)
      .doc(ledgerId(companyId, rootId, firstYear + i)),
  );
  const snaps = await adminDb.getAll(...refs);

  let carry = 0;
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const d = snap.data()!;
    carry = num(d.received) + carry - num(d.subtreeSpent);
  }
  return carry;
}

/**
 * Saldo de todos os centros de custo num exercício. Uma query no razão mais o
 * carry-over do raiz.
 *
 * Lança quando a hierarquia não tem raiz única — quem chama decide se responde
 * vazio ou propaga o erro.
 */
export async function readLedgerBalances(
  companyId: string,
  costCenters: CostCenter[],
  year: number,
): Promise<Record<string, LedgerBalance>> {
  const tree = buildCostCenterTree(costCenters);

  const [snapshot, carryIn] = await Promise.all([
    adminDb
      .collection(LEDGER_COLLECTION)
      .where("companyId", "==", companyId)
      .where("year", "==", year)
      .get(),
    readCarryIn(companyId, tree.rootId, year),
  ]);

  const ledgers = new Map<string, FirebaseFirestore.DocumentData>();
  snapshot.docs.forEach((d) => {
    const data = d.data();
    ledgers.set(data.costCenterId as string, data);
  });

  const balances: Record<string, LedgerBalance> = {};
  for (const cc of costCenters) {
    const l = ledgers.get(cc.id) ?? {};
    const isRoot = cc.id === tree.rootId;
    const ccCarryIn = isRoot ? carryIn : 0;
    const received = num(l.received);
    const allocatedToChildren = num(l.allocatedToChildren);
    const spentDirect = num(l.spentDirect);

    balances[cc.id] = {
      costCenterId: cc.id,
      year,
      isRoot,
      isLeaf: tree.isLeaf(cc.id),
      carryIn: ccCarryIn,
      received,
      allocatedToChildren,
      spentDirect,
      spentDirectPaid: num(l.spentDirectPaid),
      subtreeSpent: num(l.subtreeSpent),
      subtreeSpentPaid: num(l.subtreeSpentPaid),
      // Nunca truncar em zero: um saldo negativo é o que o gestor precisa ver.
      available: received + ccCarryIn - allocatedToChildren - spentDirect,
    };
  }

  return balances;
}

/**
 * Gasto direto por centro de custo e mês do exercício.
 *
 * Sai das próprias transações porque o razão só guarda o ano, e o agregado
 * `cost_center_usage` data o lançamento por `paymentDate` mesmo quando ele não
 * está pago — a soma dos meses não fecharia com o total anual do razão.
 *
 * Duas consultas: uma despesa paga pertence ao exercício do pagamento, que
 * pode cair fora da faixa de vencimento.
 */
export async function readMonthlySpend(
  companyId: string,
  year: number,
): Promise<Map<string, Map<string, number>>> {
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31, 23, 59, 59);

  const [byDue, byPayment] = await Promise.all([
    adminDb
      .collection(TRANSACTIONS_COLLECTION)
      .where("companyId", "==", companyId)
      .where("type", "==", "payable")
      .where("dueDate", ">=", start)
      .where("dueDate", "<=", end)
      .get(),
    adminDb
      .collection(TRANSACTIONS_COLLECTION)
      .where("companyId", "==", companyId)
      .where("status", "==", "paid")
      .where("paymentDate", ">=", start)
      .where("paymentDate", "<=", end)
      .get(),
  ]);

  const seen = new Set<string>();
  const result = new Map<string, Map<string, number>>();

  const add = (ccId: string, monthKey: string, amount: number) => {
    if (!result.has(ccId)) result.set(ccId, new Map());
    const months = result.get(ccId)!;
    months.set(monthKey, (months.get(monthKey) ?? 0) + amount);
  };

  for (const doc of [...byDue.docs, ...byPayment.docs]) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);

    const tx = doc.data();
    if (tx.type !== "payable" || tx.status === "rejected") continue;

    // Mesma regra de exercício do razão: pagamento se paga, senão vencimento.
    const raw =
      tx.status === "paid" && tx.paymentDate ? tx.paymentDate : tx.dueDate;
    const date: Date | null = raw?.toDate ? raw.toDate() : null;
    if (!date || date.getFullYear() !== year) continue;

    const monthKey = `${year}-${String(date.getMonth() + 1).padStart(2, "0")}`;

    const allocations = Array.isArray(tx.costCenterAllocation)
      ? tx.costCenterAllocation
      : [];
    if (allocations.length > 0) {
      for (const a of allocations) {
        if (a?.costCenterId) add(a.costCenterId, monthKey, num(a.amount));
      }
    } else if (tx.costCenterId) {
      add(tx.costCenterId, monthKey, num(tx.finalAmount ?? tx.amount));
    }
  }

  return result;
}

/** Lista de centros de custo da empresa, no formato que a árvore espera. */
export async function readCostCenters(
  companyId: string,
): Promise<CostCenter[]> {
  const snap = await adminDb
    .collection("cost_centers")
    .where("companyId", "==", companyId)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CostCenter);
}

export { parentOf };
