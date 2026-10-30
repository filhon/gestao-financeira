import { db } from "@/lib/firebase/client";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  Timestamp,
  addDoc,
  updateDoc,
  deleteField,
  limit,
  DocumentData,
} from "firebase/firestore";
import { addDays, addMonths, addWeeks, addYears } from "date-fns";
import currency from "currency.js";
import { RecurringTransactionTemplate, Transaction } from "@/lib/types";
import { normalizeText, stripUndefined } from "@/lib/utils";

const COLLECTION_NAME = "recurring_templates";

const toTemplate = (
  id: string,
  data: DocumentData,
): RecurringTransactionTemplate =>
  ({
    id,
    ...data,
    nextDueDate: (data.nextDueDate as Timestamp)?.toDate(),
    endDate: (data.endDate as Timestamp)?.toDate(),
    endedAt: (data.endedAt as Timestamp)?.toDate(),
    lastGeneratedAt: (data.lastGeneratedAt as Timestamp)?.toDate(),
    lastError: data.lastError
      ? { ...data.lastError, at: (data.lastError.at as Timestamp)?.toDate() }
      : undefined,
    createdAt: (data.createdAt as Timestamp)?.toDate(),
    updatedAt: (data.updatedAt as Timestamp)?.toDate(),
  }) as RecurringTransactionTemplate;

/** Data da ocorrência seguinte, na mesma regra do gerador noturno. */
export function addInterval(
  date: Date,
  frequency: RecurringTransactionTemplate["frequency"],
  interval: number,
): Date {
  const n = interval || 1;
  switch (frequency) {
    case "daily":
      return addDays(date, n);
    case "weekly":
      return addWeeks(date, n);
    case "monthly":
      return addMonths(date, n);
    case "yearly":
      return addYears(date, n);
  }
}

/** Próximas `count` ocorrências a partir de `nextDueDate`, respeitando a data final. */
export function upcomingDates(
  t: Pick<
    RecurringTransactionTemplate,
    "nextDueDate" | "frequency" | "interval" | "endDate"
  >,
  count: number,
): Date[] {
  const dates: Date[] = [];
  let d = t.nextDueDate;
  while (dates.length < count && (!t.endDate || d <= t.endDate)) {
    dates.push(d);
    d = addInterval(d, t.frequency, t.interval);
  }
  return dates;
}

/** Valor mensalizado: diária = 365/12 dias, semanal = 52/12 semanas. */
export function monthlyAmount(t: RecurringTransactionTemplate): number {
  const per = t.interval || 1;
  const factor = {
    daily: 365 / 12,
    weekly: 52 / 12,
    monthly: 1,
    yearly: 1 / 12,
  }[t.frequency];
  return currency(t.amount).multiply(factor).divide(per).value;
}

/**
 * Mesma chave para o mesmo compromisso: fornecedor, descrição, valor e
 * periodicidade. A descrição entra porque o mesmo fornecedor cobra várias
 * unidades pelo mesmo valor (IPTU Sala 1503 e 1504), e isso não é duplicata.
 */
const duplicateKey = (t: RecurringTransactionTemplate) =>
  [
    t.type,
    t.baseTransactionData?.entityId ?? "",
    normalizeText(t.description ?? ""),
    currency(t.amount).intValue,
    t.frequency,
    t.interval || 1,
  ].join("|");

/** Ids de recorrências ativas que repetem outra (todas do grupo, inclusive a primeira). */
export function findDuplicateIds(
  templates: RecurringTransactionTemplate[],
): Set<string> {
  const groups = new Map<string, string[]>();
  for (const t of templates) {
    if (!t.active) continue;
    const k = duplicateKey(t);
    groups.set(k, [...(groups.get(k) ?? []), t.id]);
  }
  return new Set([...groups.values()].filter((ids) => ids.length > 1).flat());
}

/** Há outra recorrência ativa igual a esta? Usado antes de criar. */
export function findSimilar(
  templates: RecurringTransactionTemplate[],
  candidate: RecurringTransactionTemplate,
): RecurringTransactionTemplate | undefined {
  const k = duplicateKey(candidate);
  return templates.find((t) => t.active && duplicateKey(t) === k);
}

export const recurrenceService = {
  createTemplate: async (
    data: Omit<
      RecurringTransactionTemplate,
      "id" | "createdAt" | "updatedAt" | "lastGeneratedAt"
    >,
  ): Promise<string> => {
    // Campos opcionais do formulário (entidade, forma de pagamento…) chegam
    // como `undefined`, e o Firestore recusa a gravação inteira por isso.
    const docRef = await addDoc(
      collection(db, COLLECTION_NAME),
      stripUndefined({
        ...data,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        active: true,
      }),
    );
    return docRef.id;
  },

  getTemplates: async (
    companyId: string,
    filter?: { active?: boolean; limit?: number },
  ): Promise<RecurringTransactionTemplate[]> => {
    let q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", companyId),
    );

    if (filter?.active !== undefined) {
      q = query(q, where("active", "==", filter.active));
    }

    if (filter?.limit) {
      q = query(q, limit(filter.limit));
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => toTemplate(doc.id, doc.data()));
  },

  /** Lançamentos já gerados por um modelo, do mais recente ao mais antigo. */
  getGenerated: async (
    companyId: string,
    templateId: string,
  ): Promise<
    Pick<
      Transaction,
      "id" | "description" | "amount" | "finalAmount" | "dueDate" | "status"
    >[]
  > => {
    const snapshot = await getDocs(
      query(
        collection(db, "transactions"),
        where("companyId", "==", companyId),
        where("recurringTemplateId", "==", templateId),
      ),
    );
    return snapshot.docs
      .map((d) => {
        const x = d.data();
        return {
          id: d.id,
          description: x.description,
          amount: x.amount,
          finalAmount: x.finalAmount,
          status: x.status,
          dueDate: (x.dueDate as Timestamp)?.toDate(),
        };
      })
      .sort((a, b) => b.dueDate.getTime() - a.dueDate.getTime());
  },

  updateTemplate: async (
    id: string,
    companyId: string,
    data: Partial<RecurringTransactionTemplate>,
  ): Promise<void> => {
    const docRef = doc(db, COLLECTION_NAME, id);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      throw new Error("Recorrência não encontrada");
    }
    if (docSnap.data().companyId !== companyId) {
      throw new Error("Recorrência não pertence a esta empresa");
    }

    // Chave presente com `undefined` = "apague este campo" (ex.: tirar a
    // data final). O Firestore recusa `undefined`; `deleteField()` é o jeito
    // de dizer isso. Dentro de objetos aninhados só se pode omitir a chave.
    const payload = Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        value === undefined ? deleteField() : stripUndefined(value),
      ]),
    );

    await updateDoc(docRef, { ...payload, updatedAt: Timestamp.now() });
  },

  /** Encerra de vez: para de gerar e sai do compromisso mensal, mas o histórico fica. */
  end: (t: RecurringTransactionTemplate) =>
    recurrenceService.updateTemplate(t.id, t.companyId, {
      active: false,
      endedAt: new Date(),
    }),

  /** Pula a próxima ocorrência sem gerar lançamento. */
  skipNext: (t: RecurringTransactionTemplate) =>
    recurrenceService.updateTemplate(t.id, t.companyId, {
      nextDueDate: addInterval(t.nextDueDate, t.frequency, t.interval),
    }),
};
