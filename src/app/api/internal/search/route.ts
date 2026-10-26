/**
 * GET /api/internal/search?q=...&companyId=...[&limit=5][&fresh=1]
 *
 * Busca global: transações (com a linguagem de src/lib/search/query.ts) e,
 * quando há termos livres, também entidades, lotes e RDs.
 *
 * O Firestore não tem busca textual, então o índice da empresa (transações e
 * os cadastros que dão nome a elas) é carregado no servidor e mantido em
 * memória por 60 s. O navegador recebe só o que casou, não a base inteira.
 *
 * Permissões espelham usePermissions: "user" vê só as contas a pagar e RDs
 * que lançou; entidades e lotes só para quem pode abrir essas telas.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Timestamp, type QuerySnapshot } from "firebase-admin/firestore";
import currency from "currency.js";
import { adminDb } from "@/lib/firebase/admin";
import { authorizeCompany } from "@/lib/api/companyAccess";
import { logger } from "@/lib/logger";
import { suggestedReceiptsStart } from "@/components/features/finance/comprovantes/receiptInsight";
import {
  buildHaystack,
  hasFilters,
  isSettled,
  matchTransaction,
  normalizeText,
  parseQuery,
  type Haystack,
} from "@/lib/search/query";
import type {
  PaymentBatchStatus,
  ReimbursementReportStatus,
  Transaction,
  UserRole,
} from "@/lib/types";

const MAX_SCAN_DOCS = 10_000;
const MAX_RESULTS = 3_000;
const CACHE_TTL_MS = 60_000;

const CAN_VIEW_REGISTRIES: UserRole[] = [
  "admin",
  "financial_manager",
  "approver",
  "releaser",
];

/** Nomes que o cadastro dá a uma transação; exibidos e pesquisáveis. */
export interface SearchRowInfo {
  costCenter?: string;
  account?: string;
  bankAccount?: string;
  batch?: string;
  rd?: string;
}

export interface SearchEntity {
  id: string;
  name: string;
  document?: string;
  category: "supplier" | "client" | "both";
  /** Só na entidade que responde à busca (resultado principal). */
  stats?: {
    count: number;
    openAmount: number;
    openCount: number;
    lateCount: number;
    paidThisYear: number;
    receivedThisYear: number;
    lastPayment?: {
      date: string;
      amount: number;
      type: "payable" | "receivable";
    };
  };
}

export interface SearchResponse {
  /** Transação serializada (datas em ISO); reviva no cliente. */
  rows: { tx: Record<string, unknown>; info: SearchRowInfo }[];
  total: number;
  truncated: boolean;
  scanCapped: boolean;
  /** Início do controle de comprovantes (ISO): antes disso não se cobra. */
  receiptsStart: string | null;
  entities: SearchEntity[];
  batches: {
    id: string;
    name: string;
    status: PaymentBatchStatus;
    totalAmount: number;
  }[];
  reimbursements: {
    id: string;
    rdNumber: string;
    employeeName: string;
    status: ReimbursementReportStatus;
    totalAmount: number;
  }[];
}

// ── Índice da empresa ────────────────────────────────────────────────────────

interface IndexedTx {
  plain: Record<string, unknown>;
  tx: Transaction;
  info: SearchRowInfo;
  hay: Haystack;
}

interface Indexed<T> {
  item: T;
  hay: Haystack;
}

interface CompanyIndex {
  txs: IndexedTx[];
  scanCapped: boolean;
  receiptsStart: Date | null;
  entities: Indexed<SearchEntity>[];
  batches: Indexed<SearchResponse["batches"][number]>[];
  rds: (Indexed<SearchResponse["reimbursements"][number]> & {
    createdBy: string;
  })[];
}

/** Timestamps → ISO, em qualquer profundidade (JSON-safe). */
function toPlain(v: unknown): unknown {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(toPlain);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, toPlain(x)]),
    );
  return v;
}

const toDate = (v: unknown) =>
  v instanceof Timestamp ? v.toDate() : undefined;

async function loadIndex(companyId: string): Promise<CompanyIndex> {
  const byCompany = (name: string) =>
    adminDb.collection(name).where("companyId", "==", companyId);

  const [
    txSnap,
    entSnap,
    batchSnap,
    rdSnap,
    ccSnap,
    accSnap,
    bankSnap,
    companySnap,
  ] = await Promise.all([
    byCompany("transactions")
      .orderBy("dueDate", "desc")
      .limit(MAX_SCAN_DOCS)
      .get(),
    byCompany("entities").get(),
    byCompany("payment_batches").get(),
    byCompany("reimbursement_reports").get(),
    byCompany("cost_centers").get(),
    byCompany("chart_of_accounts").get(),
    byCompany("bank_accounts").get(),
    adminDb.collection("companies").doc(companyId).get(),
  ]);

  const nameOf = (snap: QuerySnapshot) =>
    new Map(snap.docs.map((d) => [d.id, d.data().name as string]));
  const costCenters = nameOf(ccSnap);
  const banks = nameOf(bankSnap);
  const batchNames = nameOf(batchSnap);
  const accounts = new Map(
    accSnap.docs.map((d) => [d.id, `${d.data().code} ${d.data().name}`]),
  );
  const entityDocs = new Map(
    entSnap.docs.map((d) => [d.id, d.data().document as string | undefined]),
  );
  const rdNumbers = new Map(
    rdSnap.docs.map((d) => [d.id, d.data().rdNumber as string]),
  );

  const txs = txSnap.docs.map((d): IndexedTx => {
    const data = d.data();
    const tx = {
      ...data,
      id: d.id,
      dueDate: toDate(data.dueDate) ?? new Date(0),
      paymentDate: toDate(data.paymentDate),
    } as Transaction;
    const ccId = tx.costCenterId ?? tx.costCenterAllocation?.[0]?.costCenterId;
    const info: SearchRowInfo = {
      costCenter: ccId ? costCenters.get(ccId) : undefined,
      account: tx.accountId ? accounts.get(tx.accountId) : undefined,
      bankAccount: tx.bankAccountId ? banks.get(tx.bankAccountId) : undefined,
      batch: tx.batchId ? batchNames.get(tx.batchId) : undefined,
      rd: tx.reimbursementReportId
        ? rdNumbers.get(tx.reimbursementReportId)
        : undefined,
    };
    return {
      plain: { ...(toPlain(data) as object), id: d.id },
      tx,
      info,
      hay: buildHaystack(
        [
          tx.description,
          tx.supplierOrClient,
          tx.requestOrigin?.name,
          tx.details,
          tx.notes,
          ...Object.values(info),
        ],
        [
          tx.documentNumber,
          tx.barcode,
          tx.entityId ? entityDocs.get(tx.entityId) : undefined,
        ],
      ),
    };
  });

  return {
    txs,
    scanCapped: txSnap.size >= MAX_SCAN_DOCS,
    // Mesmo corte da tela de Comprovantes: a data definida ou a sugerida.
    receiptsStart:
      toDate(companySnap.data()?.receiptsStartDate) ??
      suggestedReceiptsStart(txs.map((r) => r.tx)),
    entities: entSnap.docs.map((d) => {
      const e = d.data();
      return {
        item: {
          id: d.id,
          name: e.name,
          document: e.document,
          category: e.category,
        },
        hay: buildHaystack([e.name, e.email], [e.document]),
      };
    }),
    batches: batchSnap.docs.map((d) => {
      const b = d.data();
      return {
        item: {
          id: d.id,
          name: b.name,
          status: b.status,
          totalAmount: b.totalAmount ?? 0,
        },
        hay: buildHaystack([b.name, d.id]),
      };
    }),
    rds: rdSnap.docs.map((d) => {
      const r = d.data();
      return {
        item: {
          id: d.id,
          rdNumber: r.rdNumber,
          employeeName: r.employeeName,
          status: r.status,
          totalAmount: r.totalAmount ?? 0,
        },
        createdBy: r.createdBy,
        hay: buildHaystack([r.rdNumber, r.employeeName], [r.employeeDocument]),
      };
    }),
  };
}

// ponytail: cache por instância do servidor; índice externo (Typesense/Algolia)
// quando o volume passar de MAX_SCAN_DOCS ou o custo de leitura pesar.
const cache = new Map<string, { at: number; index: Promise<CompanyIndex> }>();

function getIndex(companyId: string, fresh: boolean) {
  const hit = cache.get(companyId);
  if (!fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.index;
  const index = loadIndex(companyId);
  cache.set(companyId, { at: Date.now(), index });
  index.catch(() => cache.delete(companyId));
  return index;
}

// ── Rota ─────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const companyId = params.get("companyId")?.trim() ?? "";
  const raw = params.get("q")?.trim() ?? "";
  const limit = Math.min(
    Math.max(parseInt(params.get("limit") ?? "", 10) || MAX_RESULTS, 1),
    MAX_RESULTS,
  );

  const access = await authorizeCompany(companyId);
  if (!access.ok) return access.response;

  if (raw.length > 300) {
    return NextResponse.json(
      { error: "A busca aceita no máximo 300 caracteres." },
      { status: 400 },
    );
  }
  const q = parseQuery(raw);
  if (!hasFilters(q)) {
    return NextResponse.json(
      { error: "Informe um termo ou filtro de busca." },
      { status: 400 },
    );
  }

  try {
    const index = await getIndex(companyId, params.get("fresh") === "1");
    const isUser = access.role === "user";
    const visible = isUser
      ? index.txs.filter(
          (r) => r.tx.createdBy === access.uid && r.tx.type === "payable",
        )
      : index.txs;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const matched = visible.filter((r) =>
      matchTransaction(r.tx, q, r.hay, today, index.receiptsStart),
    );
    const termsMatch = (hay: Haystack) =>
      q.terms.length > 0 &&
      q.terms.every(
        (t) =>
          hay.text.includes(t.text) ||
          (!!t.digits && hay.digits.includes(t.digits)),
      );

    const found = <T>(list: Indexed<T>[]) =>
      list
        .filter((x) => termsMatch(x.hay))
        .slice(0, 5)
        .map((x) => x.item);

    const canViewRegistries = CAN_VIEW_REGISTRIES.includes(access.role);
    const entities = canViewRegistries ? found(index.entities) : [];
    const batches = canViewRegistries ? found(index.batches) : [];
    const reimbursements = found(
      isUser ? index.rds.filter((r) => r.createdBy === access.uid) : index.rds,
    );

    // Resultado principal: a entidade que é claramente "a" resposta.
    const phrase = q.terms.map((t) => t.text).join(" ");
    const top =
      entities.length === 1
        ? entities[0]
        : entities.find((e) => normalizeText(e.name) === phrase);

    const body: SearchResponse = {
      rows: matched.slice(0, limit).map((r) => ({ tx: r.plain, info: r.info })),
      total: matched.length,
      truncated: matched.length > limit,
      scanCapped: index.scanCapped,
      receiptsStart: index.receiptsStart?.toISOString() ?? null,
      entities: entities.map((e) =>
        e.id === top?.id ? { ...e, stats: entityStats(e, visible) } : e,
      ),
      batches,
      reimbursements,
    };
    return NextResponse.json(body);
  } catch (error) {
    logger.error("GET /api/internal/search failed", { error, companyId });
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}

function entityStats(
  e: { id: string; name: string },
  txs: IndexedTx[],
): SearchEntity["stats"] {
  const name = normalizeText(e.name.trim());
  const own = txs
    .map((r) => r.tx)
    .filter(
      (t) =>
        t.entityId === e.id ||
        normalizeText((t.supplierOrClient ?? "").trim()) === name,
    );
  const year = new Date().getFullYear();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let open = currency(0);
  let paid = currency(0);
  let received = currency(0);
  let openCount = 0;
  let lateCount = 0;
  let last: Transaction | undefined;

  for (const t of own) {
    if (isSettled(t)) {
      if (t.paymentDate?.getFullYear() === year) {
        if (t.type === "payable") paid = paid.add(t.amount);
        else received = received.add(t.amount);
      }
      if (t.paymentDate && (!last || t.paymentDate > last.paymentDate!))
        last = t;
    } else if (t.status !== "rejected") {
      open = open.add(t.amount);
      openCount++;
      if (t.dueDate < today) lateCount++;
    }
  }

  return {
    count: own.length,
    openAmount: open.value,
    openCount,
    lateCount,
    paidThisYear: paid.value,
    receivedThisYear: received.value,
    ...(last && {
      lastPayment: {
        date: last.paymentDate!.toISOString(),
        amount: last.amount,
        type: last.type,
      },
    }),
  };
}
