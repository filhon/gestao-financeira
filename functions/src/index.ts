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
        data.finalAmount !== undefined ? data.finalAmount : data.amount || 0
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
      `Updating balance for company ${companyId}. Change: ${balanceChange}`
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
