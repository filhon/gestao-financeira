import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

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

      // Consideramos apenas despesas (payable) que estao PAGAS
      if (data.type !== "payable" || data.status !== "paid") return [];

      const allocations = data.costCenterAllocation || [];
      // Se nao tiver alocacao mas tiver costCenterId (legado ou simples)
      if (allocations.length === 0 && data.costCenterId) {
        // Criar alocacao ficticia de 100%
        // Mas o ideal seria sempre normalizar no write da transacao.
        // Vamos assumir que se nao tem array, nao contabiliza ou fallback.
        // Fallback:
        // return [{ companyId: data.companyId, costCenterId: data.costCenterId, amount: data.finalAmount || data.amount || 0 }];
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
