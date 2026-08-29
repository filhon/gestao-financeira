import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import currency from "currency.js";
import { db, functions as fbFunctions } from "@/lib/firebase/client";
import { CostCenter, CostCenterBalance, CostCenterLedger } from "@/lib/types";
import {
  buildCostCenterTree,
  parentOf,
  type CostCenterTree,
} from "@/lib/costCenterTree";

const COLLECTION_NAME = "cost_center_ledger";

/** Quantos exercícios anteriores o carry-over percorre antes de desistir. */
const MAX_CARRY_LOOKBACK = 10;

export const ledgerId = (
  companyId: string,
  costCenterId: string,
  year: number,
) => `${companyId}_${costCenterId}_${year}`;

const sum = (...values: number[]) =>
  values.reduce((acc, v) => acc.add(v), currency(0)).value;

const sub = (a: number, ...values: number[]) =>
  values.reduce((acc, v) => acc.subtract(v), currency(a)).value;

// ─── Índice da árvore ────────────────────────────────────────────────────────
//
// A montagem vive em `@/lib/costCenterTree`, sem dependência de Firebase, para
// que as rotas da API v1 (Admin SDK) apliquem exatamente a mesma invariante.
// Reexportado aqui porque as telas já importam por este caminho.
export { buildCostCenterTree, parentOf, type CostCenterTree };

// ─── Leitura ─────────────────────────────────────────────────────────────────

const emptyLedger = (
  companyId: string,
  costCenterId: string,
  year: number,
  tree: CostCenterTree,
): CostCenterLedger => ({
  id: ledgerId(companyId, costCenterId, year),
  companyId,
  costCenterId,
  year,
  parentId: parentOf(tree.byId.get(costCenterId)),
  isRoot: costCenterId === tree.rootId,
  received: 0,
  allocatedToChildren: 0,
  spentDirect: 0,
  spentDirectPaid: 0,
  subtreeSpent: 0,
  subtreeSpentPaid: 0,
  updatedAt: new Date(),
});

const fromDoc = (id: string, data: Record<string, unknown>): CostCenterLedger =>
  ({
    id,
    ...data,
    updatedAt: (data.updatedAt as Timestamp)?.toDate(),
  }) as CostCenterLedger;

export const costCenterLedgerService = {
  /**
   * Sobra consolidada dos exercícios anteriores, que vira caixa do raiz.
   *
   * Alocações internas são transferência, não consumo — por isso a sobra da
   * árvore inteira sai de `received − subtreeSpent` no raiz, sem varrer filhos.
   * Derivado a cada leitura em vez de persistido: o exercício anterior continua
   * mudando enquanto está aberto, e um valor gravado dessincronizaria.
   */
  getCarryIn: async (
    companyId: string,
    rootId: string,
    year: number,
  ): Promise<number> => {
    let carry = 0;
    const firstYear = year - MAX_CARRY_LOOKBACK;

    // Do exercício mais antigo para o mais recente, acumulando a sobra.
    const snapshots = await Promise.all(
      Array.from({ length: MAX_CARRY_LOOKBACK }, (_, i) =>
        getDoc(
          doc(db, COLLECTION_NAME, ledgerId(companyId, rootId, firstYear + i)),
        ),
      ),
    );

    for (const snap of snapshots) {
      if (!snap.exists()) continue;
      const l = fromDoc(snap.id, snap.data());
      carry = sub(sum(l.received, carry), l.subtreeSpent);
    }

    return carry;
  },

  /**
   * Saldo de todos os centros de custo num exercício — a fonte única que toda
   * tela deve consumir. Uma query de razão mais o carry-over do raiz.
   */
  getBalances: async (
    companyId: string,
    costCenters: CostCenter[],
    year: number,
  ): Promise<Record<string, CostCenterBalance>> => {
    const tree = buildCostCenterTree(costCenters);

    const [snapshot, carryIn] = await Promise.all([
      getDocs(
        query(
          collection(db, COLLECTION_NAME),
          where("companyId", "==", companyId),
          where("year", "==", year),
        ),
      ),
      costCenterLedgerService.getCarryIn(companyId, tree.rootId, year),
    ]);

    const ledgers = new Map<string, CostCenterLedger>();
    snapshot.docs.forEach((d) => {
      const l = fromDoc(d.id, d.data());
      ledgers.set(l.costCenterId, l);
    });

    const balances: Record<string, CostCenterBalance> = {};
    for (const cc of costCenters) {
      const l = ledgers.get(cc.id) || emptyLedger(companyId, cc.id, year, tree);
      const isRoot = cc.id === tree.rootId;
      const ccCarryIn = isRoot ? carryIn : 0;

      balances[cc.id] = {
        costCenterId: cc.id,
        year,
        isRoot,
        isLeaf: tree.isLeaf(cc.id),
        carryIn: ccCarryIn,
        received: l.received,
        allocatedToChildren: l.allocatedToChildren,
        spentDirect: l.spentDirect,
        spentDirectPaid: l.spentDirectPaid,
        subtreeSpent: l.subtreeSpent,
        subtreeSpentPaid: l.subtreeSpentPaid,
        // Nunca truncar em zero: um saldo negativo é exatamente o que o gestor
        // precisa enxergar para realocar.
        available: sub(
          sum(l.received, ccCarryIn),
          l.allocatedToChildren,
          l.spentDirect,
        ),
      };
    }

    return balances;
  },

  getBalance: async (
    companyId: string,
    costCenterId: string,
    costCenters: CostCenter[],
    year: number,
  ): Promise<CostCenterBalance> => {
    const all = await costCenterLedgerService.getBalances(
      companyId,
      costCenters,
      year,
    );
    return all[costCenterId];
  },

  // ─── Mutação ──────────────────────────────────────────────────────────────
  //
  // Não há escrita direta aqui de propósito. A invariante do envelope — a soma
  // dos filhos nunca ultrapassar o disponível do pai — não é expressável nas
  // rules do Firestore, então `cost_center_ledger` é somente-leitura para
  // qualquer cliente e toda mutação passa pela Cloud Function.

  /**
   * Define o envelope anual de um centro de custo, movendo recurso do pai.
   *
   * A validação vive no servidor: o erro devolvido já vem com a mensagem
   * pronta para o usuário (saldo insuficiente no pai, ou envelope abaixo do
   * que o filho já comprometeu).
   */
  setEnvelope: async (
    companyId: string,
    costCenterId: string,
    year: number,
    amount: number,
  ): Promise<{ previous: number; parentAvailableAfter?: number }> => {
    const call = httpsCallable<
      {
        companyId: string;
        costCenterId: string;
        year: number;
        amount: number;
      },
      { success: boolean; previous: number; parentAvailableAfter?: number }
    >(fbFunctions, "setCostCenterEnvelope");

    const { data } = await call({ companyId, costCenterId, year, amount });
    return {
      previous: data.previous,
      parentAvailableAfter: data.parentAvailableAfter,
    };
  },
};
