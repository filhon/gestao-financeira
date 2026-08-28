import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import currency from "currency.js";
import { db } from "@/lib/firebase/client";
import { CostCenter, CostCenterBalance, CostCenterLedger } from "@/lib/types";

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

export interface CostCenterTree {
  byId: Map<string, CostCenter>;
  childrenOf: Map<string, CostCenter[]>;
  rootId: string;
  isLeaf: (id: string) => boolean;
  /** Ancestrais de um CC, do pai imediato até a raiz. */
  ancestorsOf: (id: string) => string[];
  /** O CC e todos os seus ancestrais — a cadeia que uma despesa afeta. */
  chainOf: (id: string) => string[];
}

const parentOf = (cc: CostCenter | undefined) =>
  cc?.parentId && cc.parentId !== "none" ? cc.parentId : null;

/**
 * Monta o índice da hierarquia. Exige raiz única — é regra de negócio, não
 * convenção, e um segundo raiz significaria receita entrando em dois caixas.
 */
export function buildCostCenterTree(costCenters: CostCenter[]): CostCenterTree {
  const byId = new Map(costCenters.map((cc) => [cc.id, cc]));
  const childrenOf = new Map<string, CostCenter[]>();
  const roots: CostCenter[] = [];

  for (const cc of costCenters) {
    const pid = parentOf(cc);
    if (!pid || !byId.has(pid)) {
      roots.push(cc);
      continue;
    }
    const siblings = childrenOf.get(pid) || [];
    siblings.push(cc);
    childrenOf.set(pid, siblings);
  }

  if (roots.length !== 1) {
    throw new Error(
      `Hierarquia inválida: esperado exatamente 1 centro de custo raiz, encontrado ${roots.length}.` +
        (roots.length > 1
          ? ` (${roots.map((r) => r.code || r.id).join(", ")})`
          : ""),
    );
  }

  const ancestorCache = new Map<string, string[]>();
  const ancestorsOf = (id: string): string[] => {
    const cached = ancestorCache.get(id);
    if (cached) return cached;

    const chain: string[] = [];
    const seen = new Set<string>([id]);
    let pid = parentOf(byId.get(id));
    while (pid && byId.has(pid) && !seen.has(pid)) {
      chain.push(pid);
      seen.add(pid);
      pid = parentOf(byId.get(pid));
    }
    ancestorCache.set(id, chain);
    return chain;
  };

  return {
    byId,
    childrenOf,
    rootId: roots[0].id,
    isLeaf: (id) => (childrenOf.get(id) || []).length === 0,
    ancestorsOf,
    chainOf: (id) => [id, ...ancestorsOf(id)],
  };
}

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
  // Não há escrita aqui de propósito. A invariante do envelope — a soma dos
  // filhos nunca ultrapassar o disponível do pai — não é expressável nas rules
  // do Firestore, então `cost_center_ledger` é somente-leitura para qualquer
  // cliente (ver firestore.rules) e toda mutação passa por Cloud Function.
  //
  // Alocação pai→filho e débito de despesa chegam nas Fases 2 e 3, como
  // callables. Um método de escrita client-side aqui seria contornável pelo
  // SDK e repetiria o defeito do antigo `costCenterService.allocateToChild`.
};
