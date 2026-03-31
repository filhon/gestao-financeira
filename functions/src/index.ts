import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import {
  addDays,
  addWeeks,
  addMonths,
  addYears,
  isBefore,
  isSameDay,
} from "date-fns";

admin.initializeApp();
const db = admin.firestore();

/**
 * Trigger que atualiza o saldo da empresa (company_stats)
 * sempre que uma transação é criada, atualizada ou deletada.
 */
export const onTransactionWrite = functions.firestore
  .document("transactions/{transactionId}")
  .onWrite(async (change, context) => {
    const newData = change.after.exists ? change.after.data() : null;
    const oldData = change.before.exists ? change.before.data() : null;

    const companyId = newData?.companyId || oldData?.companyId;
    if (!companyId) {
      console.log("No companyId found");
      return null;
    }

    const statsRef = db.collection("company_stats").doc(companyId);

    // Helper para calcular o valor efetivo de uma transação no saldo
    // Retorna positivo para entrada, negativo para saída.
    // Retorna 0 se não estiver paga.
    const getTransactionValue = (data: any) => {
      if (!data || data.status !== "paid") return 0;

      // Prioriza finalAmount, fallback para amount
      const amount = Number(
        data.finalAmount !== undefined ? data.finalAmount : data.amount || 0,
      );

      if (data.type === "receivable") {
        return amount;
      } else {
        return -amount;
      }
    };

    const oldValue = getTransactionValue(oldData);
    const newValue = getTransactionValue(newData);

    const balanceChange = newValue - oldValue;

    if (balanceChange === 0) {
      return null;
    }

    console.log(
      `Updating balance for company ${companyId}. Change: ${balanceChange}`,
    );

    try {
      await db.runTransaction(async (t) => {
        const doc = await t.get(statsRef);

        if (!doc.exists) {
          // Se o documento não existe, criamos.
          // ATENÇÃO: Se o documento não existe, assumimos que o saldo inicial é 0 + a mudança.
          // Isso pode ser impreciso se já existirem outras transações antigas não contabilizadas.
          // O ideal é rodar o script de recálculo total uma vez.
          t.set(statsRef, {
            currentBalance: balanceChange,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: "trigger",
          });
        } else {
          t.update(statsRef, {
            currentBalance: admin.firestore.FieldValue.increment(balanceChange),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: "trigger",
          });
        }
      });
      console.log("Balance updated successfully");
    } catch (error) {
      console.error("Error updating balance:", error);
    }

    return null;
  });

/**
 * Trigger que atualiza as Custom Claims do usuário no Firebase Auth
 * sempre que o documento do usuário for criado ou atualizado.
 * Isso permite verificar permissões no Firestore Rules sem leituras extras (get()).
 */
export const onUserRoleUpdate = functions.firestore
  .document("users/{userId}")
  .onWrite(async (change, context) => {
    const userId = context.params.userId;
    const newData = change.after.exists ? change.after.data() : null;

    // Se o usuário foi deletado, não fazemos nada (ou poderíamos limpar as claims)
    if (!newData) {
      return null;
    }

    const { role, companyRoles } = newData;

    try {
      // Define as custom claims
      // role: 'admin' | 'user' | ...
      // companyRoles: { 'companyId': 'role' }
      await admin.auth().setCustomUserClaims(userId, {
        role: role || null,
        companyRoles: companyRoles || {},
      });
      console.log(`Custom claims updated for user ${userId}`);
    } catch (error) {
      console.error(`Error updating custom claims for user ${userId}`, error);
    }
    return null;
  });

/**
 * Trigger que atualiza o resumo financeiro (financial_summaries)
 * sempre que uma transação é criada, atualizada ou deletada.
 * Agrupa por Mês/Ano e Empresa.
 */
export const updateFinancialSummary = functions.firestore
  .document("transactions/{transactionId}")
  .onWrite(async (change, context) => {
    const beforeDoc = change.before;
    const afterDoc = change.after;

    // Helper para extrair dados relevantes da transação
    const getTransactionData = (doc: any) => {
      if (!doc || !doc.exists) return null;
      const data = doc.data();

      // Só contabilizamos transações pagas
      if (data.status !== "paid") return null;

      const amount = Number(data.finalAmount ?? data.amount ?? 0);

      // Determina a data para agrupamento (PaymentDate > DueDate > Now)
      const date = data.paymentDate
        ? data.paymentDate.toDate()
        : data.dueDate
          ? data.dueDate.toDate()
          : new Date();

      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const monthKey = `${year}-${month}`;

      return {
        companyId: data.companyId,
        monthKey,
        type: data.type, // 'payable' | 'receivable'
        amount,
      };
    };

    const beforeData = getTransactionData(beforeDoc);
    const afterData = getTransactionData(afterDoc);

    if (!beforeData && !afterData) return;

    // Mapa para consolidar atualizações (evita escrita duplicada no mesmo doc)
    const updates = new Map<
      string,
      { income: number; expense: number; companyId: string; month: string }
    >();

    const addUpdate = (data: any, multiplier: number) => {
      const docId = `${data.companyId}_${data.monthKey}`;
      if (!updates.has(docId)) {
        updates.set(docId, {
          income: 0,
          expense: 0,
          companyId: data.companyId,
          month: data.monthKey,
        });
      }
      const entry = updates.get(docId)!;
      if (data.type === "receivable") {
        entry.income += data.amount * multiplier;
      } else {
        entry.expense += data.amount * multiplier;
      }
    };

    // Se existia antes (e era paga), subtrai
    if (beforeData) addUpdate(beforeData, -1);

    // Se existe agora (e é paga), adiciona
    if (afterData) addUpdate(afterData, 1);

    const batch = db.batch();
    let hasUpdates = false;

    for (const [docId, update] of updates) {
      // Se o saldo líquido da mudança for 0, não precisa escrever (opcional, mas economiza escrita)
      if (update.income === 0 && update.expense === 0) continue;

      const ref = db.collection("financial_summaries").doc(docId);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: any = {
        companyId: update.companyId,
        month: update.month,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (update.income !== 0) {
        updateData.income = admin.firestore.FieldValue.increment(update.income);
      }
      if (update.expense !== 0) {
        updateData.expense = admin.firestore.FieldValue.increment(
          update.expense,
        );
      }

      batch.set(ref, updateData, { merge: true });
      hasUpdates = true;
    }

    if (hasUpdates) {
      await batch.commit();
      console.log("Financial summary updated successfully.");
    }

    return null;
  });

/**
 * Função chamável (Callable) para recalcular o saldo da empresa.
 * Útil para corrigir inconsistências causadas por falhas em triggers anteriores
 * ou dados legados.
 */
export const recalculateCompanyBalance = functions.https.onCall(
  async (data, context) => {
    // Verificação de autenticação
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "O usuário precisa estar autenticado.",
      );
    }

    const companyId = data.companyId;
    if (!companyId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Company ID é obrigatório.",
      );
    }

    try {
      const snapshot = await db
        .collection("transactions")
        .where("companyId", "==", companyId)
        .where("status", "==", "paid")
        .get();

      let calculatedBalance = 0;

      snapshot.docs.forEach((doc) => {
        const t = doc.data();
        let amount = Number(t.amount || 0);
        if (t.finalAmount !== undefined && t.finalAmount !== null) {
          amount = Number(t.finalAmount);
        }

        if (t.type === "receivable") {
          calculatedBalance += amount;
        } else {
          calculatedBalance -= amount;
        }
      });

      const statsRef = db.collection("company_stats").doc(companyId);

      await statsRef.set(
        {
          currentBalance: calculatedBalance,
          lastRecalculation: admin.firestore.FieldValue.serverTimestamp(),
          recalculatedBy: context.auth.uid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return {
        success: true,
        newBalance: calculatedBalance,
        transactionCount: snapshot.size,
      };
    } catch (error) {
      console.error("Error recalculating balance:", error);
      throw new functions.https.HttpsError(
        "internal",
        "Erro ao recalcular saldo.",
      );
    }
  },
);

/**
 * Trigger que atualiza a colecao 'cost_center_usage'
 * sempre que uma transacao do tipo 'payable' (despesa) paga e criada/atualizada.
 */
export const updateCostCenterUsage = functions.firestore
  .document("transactions/{transactionId}")
  .onWrite(async (change, context) => {
    const beforeDoc = change.before;
    const afterDoc = change.after;

    const getUsageData = (docSnap: any) => {
      if (!docSnap || !docSnap.exists) return [];
      const data = docSnap.data();

      // Consideramos transações ativas (não rejeitadas)
      if (data.type !== "payable" || data.status === "rejected") return [];

      const allocations = data.costCenterAllocation || [];
      // Fallback para transações sem o array detalhado de rateio
      if (allocations.length === 0 && data.costCenterId) {
        allocations.push({
          costCenterId: data.costCenterId,
          amount: Number(data.finalAmount || data.amount || 0),
        });
      }
      if (allocations.length === 0) return [];

      const date = data.paymentDate
        ? data.paymentDate.toDate()
        : data.dueDate
          ? data.dueDate.toDate()
          : new Date();

      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const monthKey = `${year}-${month}`;

      return allocations.map((alloc: any) => ({
        companyId: data.companyId,
        costCenterId: alloc.costCenterId,
        monthKey,
        amount: Number(alloc.amount || 0),
      }));
    };

    const beforeUsage = getUsageData(beforeDoc);
    const afterUsage = getUsageData(afterDoc);

    if (beforeUsage.length === 0 && afterUsage.length === 0) return null;

    const batch = db.batch();
    const updates = new Map<
      string,
      {
        delta: number;
        companyId: string;
        costCenterId: string;
        monthKey: string;
      }
    >();

    const registerUpdate = (u: any, multiplier: number) => {
      // Usamos uma key deterministica para o Map, mas guardamos os dados decompostos
      const key = `${u.companyId}_${u.costCenterId}_${u.monthKey}`;
      const current = updates.get(key) || {
        delta: 0,
        companyId: u.companyId,
        costCenterId: u.costCenterId,
        monthKey: u.monthKey,
      };
      current.delta += u.amount * multiplier;
      updates.set(key, current);
    };

    beforeUsage.forEach((u: any) => registerUpdate(u, -1));
    afterUsage.forEach((u: any) => registerUpdate(u, 1));

    let hasUpdates = false;
    for (const [key, data] of updates) {
      if (data.delta === 0) continue;

      const ref = db.collection("cost_center_usage").doc(key);

      // Set inicial com merge
      const updatePayload: any = {
        companyId: data.companyId,
        costCenterId: data.costCenterId,
        monthKey: data.monthKey,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        amount: admin.firestore.FieldValue.increment(data.delta),
      };

      batch.set(ref, updatePayload, { merge: true });
      hasUpdates = true;
    }

    if (hasUpdates) {
      await batch.commit();
      console.log("Cost center usage updated.");
    }

    return null;
  });

// ─────────────────────────────────────────────────────────────────────────────
// suggestPaymentBatches
//
// Roda toda noite às 02:00 horário de Brasília via Cloud Scheduler.
//
// Algoritmo heurístico:
//   1. Busca todas as transações em status "draft" do tipo "payable".
//   2. Agrupa por (companyId, supplierOrClient normalizado, dueDate truncada ao dia).
//   3. Aplica regra extra de "impostos": agrupa também contas cujas descrições
//      contenham palavras-chave fiscais (DARF, INSS, FGTS, GPS, COFINS, PIS,
//      IRPJ, CSLL, ISS, ICMS) — independentemente do fornecedor.
//   4. Descarta grupos com apenas 1 transação (sem ganho de agrupamento).
//   5. Grava/sobrescreve as sugestões na subcoleção
//      `companies/{companyId}/suggested_batches`.
//
// Estrutura do documento gravado:
//   {
//     reason: "same_supplier" | "same_due_date" | "tax_group",
//     label: string,          // descrição legível do grupo
//     transactionIds: string[],
//     totalAmount: number,
//     dueDate: Timestamp | null,
//     supplierOrClient: string | null,
//     generatedAt: Timestamp,
//   }
// ─────────────────────────────────────────────────────────────────────────────

/** Palavras-chave que indicam obrigações tributárias/societárias. */
const TAX_KEYWORDS = [
  "darf",
  "inss",
  "fgts",
  "gps",
  "cofins",
  "pis/pasep",
  "pis",
  "irpj",
  "csll",
  "iss",
  "icms",
  "simples",
  "das",
  "contribuição",
];

/** Normaliza um string para comparação (minúsculas + sem acentos). */
function normalizeStr(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Verifica se a descrição ou fornecedor contém palavra-chave tributária. */
function isTaxRelated(description: string, supplier: string): boolean {
  const hay = normalizeStr(description) + " " + normalizeStr(supplier);
  return TAX_KEYWORDS.some((kw) => hay.includes(kw));
}

/** Formata uma Date para chave no formato YYYY-MM-DD. */
function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const suggestPaymentBatches = functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .pubsub.schedule("0 5 * * *") // 02:00 BRT = 05:00 UTC
  .timeZone("America/Sao_Paulo")
  .onRun(async () => {
    console.log("suggestPaymentBatches: iniciando...");

    // 1. Busca contas a pagar em rascunho (sem limite — é servidor, não cliente)
    const snapshot = await db
      .collection("transactions")
      .where("type", "==", "payable")
      .where("status", "==", "draft")
      .get();

    if (snapshot.empty) {
      console.log("suggestPaymentBatches: nenhuma transação draft encontrada.");
      return null;
    }

    // 2. Organiza os documentos por empresa
    const byCompany = new Map<
      string,
      admin.firestore.QueryDocumentSnapshot[]
    >();
    for (const doc of snapshot.docs) {
      const companyId: string = doc.data().companyId;
      if (!companyId) continue;
      if (!byCompany.has(companyId)) byCompany.set(companyId, []);
      byCompany.get(companyId)!.push(doc);
    }

    console.log(
      `suggestPaymentBatches: ${snapshot.size} transações em ${byCompany.size} empresa(s).`,
    );

    // 3. Processa empresa por empresa
    for (const [companyId, docs] of byCompany) {
      // Mapas de grupos heurísticos
      // Chave → lista de IDs + metadados acumulados
      type GroupAcc = {
        ids: string[];
        totalAmount: number;
        dueDate: Date | null;
        supplierOrClient: string | null;
        reason: "same_supplier" | "same_due_date" | "tax_group";
        label: string;
      };

      const supplierGroups = new Map<string, GroupAcc>();
      const dueDateGroups = new Map<string, GroupAcc>();
      const taxGroup: GroupAcc = {
        ids: [],
        totalAmount: 0,
        dueDate: null,
        supplierOrClient: null,
        reason: "tax_group",
        label: "Obrigações tributárias/societárias",
      };

      for (const doc of docs) {
        const d = doc.data();
        const amount: number = Number(d.amount || 0);
        const supplier: string = d.supplierOrClient || "";
        const description: string = d.description || "";
        const dueDate: Date | null = d.dueDate ? d.dueDate.toDate() : null;

        // ── Grupo: mesmo fornecedor + mesma data ──────────────────────────
        if (supplier && dueDate) {
          const key = `${normalizeStr(supplier)}__${toDateKey(dueDate)}`;
          if (!supplierGroups.has(key)) {
            supplierGroups.set(key, {
              ids: [],
              totalAmount: 0,
              dueDate,
              supplierOrClient: supplier,
              reason: "same_supplier",
              label: `${supplier} — ${toDateKey(dueDate)}`,
            });
          }
          const g = supplierGroups.get(key)!;
          g.ids.push(doc.id);
          g.totalAmount += amount;
        }

        // ── Grupo: mesma data de vencimento (qualquer fornecedor) ─────────
        if (dueDate) {
          const key = toDateKey(dueDate);
          if (!dueDateGroups.has(key)) {
            dueDateGroups.set(key, {
              ids: [],
              totalAmount: 0,
              dueDate,
              supplierOrClient: null,
              reason: "same_due_date",
              label: `Vencimento ${toDateKey(dueDate)}`,
            });
          }
          const g = dueDateGroups.get(key)!;
          g.ids.push(doc.id);
          g.totalAmount += amount;
        }

        // ── Grupo: impostos ───────────────────────────────────────────────
        if (isTaxRelated(description, supplier)) {
          taxGroup.ids.push(doc.id);
          taxGroup.totalAmount += amount;
        }
      }

      // 4. Consolida todas as sugestões, descartando grupos unitários
      const suggestions: GroupAcc[] = [];

      for (const g of supplierGroups.values()) {
        if (g.ids.length >= 2) suggestions.push(g);
      }
      for (const g of dueDateGroups.values()) {
        if (g.ids.length >= 2) suggestions.push(g);
      }
      if (taxGroup.ids.length >= 2) suggestions.push(taxGroup);

      // 5. Grava na subcoleção `companies/{companyId}/suggested_batches`
      //    Estratégia: apaga as sugestões antigas e recria — garante idempotência.
      const colRef = db
        .collection("companies")
        .doc(companyId)
        .collection("suggested_batches");

      // Apaga sugestões anteriores (até 500 por vez — Firestore limit)
      const oldSnap = await colRef.get();
      const deleteBatch = db.batch();
      oldSnap.docs.forEach((d) => deleteBatch.delete(d.ref));
      if (!oldSnap.empty) await deleteBatch.commit();

      // Grava as novas sugestões
      if (suggestions.length === 0) {
        console.log(`suggestPaymentBatches [${companyId}]: sem sugestões.`);
        continue;
      }

      const writeBatchFS = db.batch();
      const now = admin.firestore.FieldValue.serverTimestamp();

      for (const s of suggestions) {
        const ref = colRef.doc(); // auto-ID
        writeBatchFS.set(ref, {
          reason: s.reason,
          label: s.label,
          transactionIds: s.ids,
          totalAmount: s.totalAmount,
          dueDate: s.dueDate
            ? admin.firestore.Timestamp.fromDate(s.dueDate)
            : null,
          supplierOrClient: s.supplierOrClient,
          generatedAt: now,
        });
      }

      await writeBatchFS.commit();
      console.log(
        `suggestPaymentBatches [${companyId}]: ${suggestions.length} sugestão(ões) gravada(s).`,
      );
    }

    console.log("suggestPaymentBatches: concluído.");
    return null;
  });

// ─────────────────────────────────────────────────────────────────────────────
// processRecurringTemplates
//
// Roda todos os dias às 02:00 horário de Brasília via Cloud Scheduler.
//
// ─────────────────────────────────────────────────────────────────────────────

export const processRecurringTemplates = functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .pubsub.schedule("0 2 * * *")
  .timeZone("America/Sao_Paulo")
  .onRun(async () => {
    console.log("processRecurringTemplates: iniciando...");

    const q = db.collection("recurring_templates").where("active", "==", true);
    const snapshot = await q.get();

    if (snapshot.empty) {
      console.log("processRecurringTemplates: nenhuma recorrência ativa.");
      return null;
    }

    let generatedCount = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const docSnap of snapshot.docs) {
      const templateRef = docSnap.ref;

      try {
        const objGenerated = await db.runTransaction(async (t) => {
          // 1) Leia o template e garanta dados atualizados
          const templateSnap = await t.get(templateRef);
          if (!templateSnap.exists) return false;

          const data = templateSnap.data() as any;
          if (!data.active) return false;

          const nextDueDate = data.nextDueDate
            ? data.nextDueDate.toDate()
            : null;
          const endDate = data.endDate ? data.endDate.toDate() : null;

          if (!nextDueDate) return false;

          const thresholdDate =
            data.type === "payable" ? addDays(today, 7) : today;

          // 2) Verifique se a data ainda está dentro da janela
          if (
            isBefore(nextDueDate, thresholdDate) ||
            isSameDay(nextDueDate, thresholdDate)
          ) {
            if (endDate && isBefore(endDate, today)) {
              t.update(templateRef, { active: false });
              return false;
            }

            const costCenterIds =
              data.baseTransactionData?.costCenterAllocation?.map(
                (a: any) => a.costCenterId,
              ) || [];
            const costCenterId = costCenterIds[0] || null;

            const newTransactionData = {
              ...data.baseTransactionData,
              description: `${data.description} (Recorrência)`,
              amount: data.amount,
              type: data.type,
              dueDate: admin.firestore.Timestamp.fromDate(nextDueDate),
              status: "draft",
              recurrence: {
                isRecurring: true,
                frequency: data.frequency,
                currentInstallment: 0,
              },
              companyId: data.companyId,
              createdBy: "system",
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              costCenterIds,
              costCenterId,
            };

            // 3) Cria o documento na coleção `transactions` em lote transacional
            const newTransactionRef = db.collection("transactions").doc();
            t.set(newTransactionRef, newTransactionData);

            let nextDate = nextDueDate;
            const interval = data.interval || 1;

            switch (data.frequency) {
              case "daily":
                nextDate = addDays(nextDate, interval);
                break;
              case "weekly":
                nextDate = addWeeks(nextDate, interval);
                break;
              case "monthly":
                nextDate = addMonths(nextDate, interval);
                break;
              case "yearly":
                nextDate = addYears(nextDate, interval);
                break;
            }

            // 4) Atualiza o nextDueDate do template
            t.update(templateRef, {
              nextDueDate: admin.firestore.Timestamp.fromDate(nextDate),
              lastGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            return true;
          }

          return false;
        });

        if (objGenerated) {
          generatedCount++;
        }
      } catch (error) {
        console.error(`Erro processando template ${templateRef.id}:`, error);
      }
    }

    console.log(
      `processRecurringTemplates: concluído. ${generatedCount} transação(ões) gerada(s).`,
    );
    return null;
  });
