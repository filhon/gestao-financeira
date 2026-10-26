/**
 * POST /api/internal/comprovantes/auto-confirm   (header x-company-id)
 *
 * Aplica a regra estrita de confirmação automática ao acumulado da fila
 * (comprovantes `pending_review`). Reprocessa o texto já extraído contra os
 * títulos atuais em vez de confiar no que estava gravado: a sugestão pode ter
 * envelhecido desde o upload. Tudo server-side, para o client não conseguir
 * forjar a elegibilidade.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { authenticateAdminRequest } from "@/lib/api/adminAuth";
import { matchComprovante } from "@/lib/matching";
import type { Entity } from "@/lib/types";
import {
  commitAutoConfirm,
  evaluateAutoConfirm,
  fetchCandidateTransactions,
  fetchEntities,
  signalsForStorage,
} from "@/lib/api/comprovanteAdmin";

// ponytail: teto por chamada para caber no tempo de um request; a UI chama de novo se sobrar
const MAX_PER_RUN = 300;

export async function POST(req: NextRequest) {
  const auth = await authenticateAdminRequest(req);
  if (!auth.success) return auth.response;
  const { companyId, uid, profile } = auth;

  try {
    const [pendingSnap, candidates, entities] = await Promise.all([
      adminDb
        .collection("comprovantes")
        .where("companyId", "==", companyId)
        .where("matchStatus", "==", "pending_review")
        .limit(MAX_PER_RUN)
        .get(),
      fetchCandidateTransactions(companyId),
      fetchEntities(companyId).catch(() => [] as Entity[]),
    ]);

    const used = new Set<string>();
    let confirmed = 0;

    for (const doc of pendingSnap.docs) {
      const data = doc.data();
      const text = (data.extractedText as string | undefined) ?? "";
      if (!text) continue;

      const best = matchComprovante(text, candidates, {
        entities,
        comprovanteId: doc.id,
      }).best;
      if (!best) continue;

      const reason = evaluateAutoConfirm(best, candidates, entities, {
        possibleDuplicate: !!data.possibleDuplicateOf,
        usedTransactionIds: used,
      });

      if (!reason) {
        // Guarda a evidência estruturada para a lista explicar o porquê.
        if (!data.matchSignals) {
          await doc.ref
            .update({ matchSignals: signalsForStorage(best) })
            .catch(() => {});
        }
        continue;
      }

      await commitAutoConfirm({
        companyId,
        comprovanteRef: doc.ref,
        best,
        storagePath: data.storagePath,
        reason,
        actorUid: uid,
        actorEmail: profile.email ?? "",
        extra: {
          suggestedTransactionId: best.transactionId,
          suggestedTransactionIds: best.transactionIds,
          matchConfidence: best.score,
          matchConfidenceLevel: best.confidenceLevel,
          matchSignals: signalsForStorage(best),
        },
      });
      best.transactionIds.forEach((id) => used.add(id));
      confirmed++;
    }

    return NextResponse.json({
      checked: pendingSnap.size,
      confirmed,
      hasMore: pendingSnap.size === MAX_PER_RUN,
    });
  } catch (err) {
    console.error("[comprovantes/auto-confirm]", err);
    return NextResponse.json(
      { error: "Erro ao aplicar a confirmação automática." },
      { status: 500 },
    );
  }
}
