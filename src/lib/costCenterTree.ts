/**
 * Índice da hierarquia de centros de custo.
 *
 * Vive fora dos serviços de propósito: o leitor do razão no cliente usa o SDK
 * do navegador e as rotas da API v1 usam o Admin SDK, mas a invariante de raiz
 * única é a mesma para os dois. Duplicá-la deixaria uma das pontas aceitar uma
 * árvore que a outra recusa.
 */
import { CostCenter } from "@/lib/types";

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

export const parentOf = (cc: CostCenter | undefined) =>
  cc?.parentId && cc.parentId !== "none" ? cc.parentId : null;

/** O centro e todos os descendentes: filtrar por um pai inclui os filhos. */
export function descendantIds(rootId: string, all: CostCenter[]): string[] {
  return [
    rootId,
    ...all
      .filter((c) => parentOf(c) === rootId)
      .flatMap((c) => descendantIds(c.id, all)),
  ];
}

/**
 * Lista em ordem de árvore com a profundidade, para selects indentados.
 * Tolera lista parcial (usuário que só vê os próprios centros): quem não tem
 * o pai na lista vira raiz.
 */
export function flattenTree(all: CostCenter[]) {
  const ids = new Set(all.map((c) => c.id));
  const out: { cc: CostCenter; depth: number }[] = [];
  const walk = (cc: CostCenter, depth: number) => {
    out.push({ cc, depth });
    all
      .filter((c) => parentOf(c) === cc.id)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .forEach((c) => walk(c, depth + 1));
  };
  all
    .filter((c) => !ids.has(parentOf(c) ?? ""))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .forEach((c) => walk(c, 0));
  return out;
}

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
