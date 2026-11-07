/**
 * POST /api/internal/comprovantes/rebalance   (header x-company-id)
 *
 * Redistribui a fila de revisão: cada conta fica sugerida para um comprovante
 * só. Cada envio é casado sozinho, então vários comprovantes do mesmo valor e
 * favorecido apontavam para a mesma conta. O de sugestão mais forte fica com
 * ela; o que perdeu é casado de novo com o que sobrou. Contas com comprovante
 * confirmado saem da disputa. Chamado ao fim de cada envio.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { authenticateAdminRequest } from "@/lib/api/adminAuth";
import { matchComprovante } from "@/lib/matching";
import { distributeSuggestions } from "@/lib/matching/queue";
import type { Entity } from "@/lib/types";
import {
  fetchCandidateTransactions,
  fetchEntities,
  suggestionFields,
} from "@/lib/api/comprovanteAdmin";

// ponytail: mesmo teto da confirmação automática; fila maior fica para a próxima chamada
const MAX_PER_RUN = 300;

const LOST = "A conta sugerida antes ficou com outro comprovante mais forte";
const CONTESTED = "⚠ Outro comprovante disputa esta conta: escolha à mão";

export async function POST(req: NextRequest) {
  const auth = await authenticateAdminRequest(req);
  if (!auth.success) return auth.response;
  const { companyId } = auth;

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

    const docs = new Map(pendingSnap.docs.map((d) => [d.id, d]));
    const queue = pendingSnap.docs.map((d) => ({
      id: d.id,
      ids: (d.get("suggestedTransactionIds") as string[] | undefined) ?? [],
      score: (d.get("matchConfidence") as number | undefined) ?? 0,
    }));
    const taken = new Set(
      candidates.filter((t) => t.comprovanteId).map((t) => t.id),
    );

    const rematched = new Map<string, ReturnType<typeof matchComprovante>>();
    const changed = distributeSuggestions(queue, taken, (item, used) => {
      const text = (docs.get(item.id)?.get("extractedText") as string) ?? "";
      if (!text) return null;
      const outcome = matchComprovante(
        text,
        candidates.filter((t) => !used.has(t.id)),
        { entities, comprovanteId: item.id },
      );
      if (!outcome.best) return null;
      rematched.set(item.id, outcome);
      return { ids: outcome.best.transactionIds };
    });

    const updates: Array<{ comprovanteId: string } & Record<string, unknown>> =
      [];
    for (const id of changed.keys()) {
      const doc = docs.get(id)!;
      const outcome = rematched.get(id);
      let patch: Record<string, unknown>;
      if (outcome?.best) {
        // Perdeu a disputa para um título equivalente: o que sobrou não fica
        // mais certo por isso, e não pode virar confirmação automática.
        if (doc.get("matchIsAmbiguous") === true) {
          outcome.best.isAmbiguous = true;
          if (outcome.best.confidenceLevel === "HIGH") {
            outcome.best.confidenceLevel = "MEDIUM";
          }
        }
        const fields = suggestionFields(outcome.best, outcome.alternatives, [
          LOST,
          ...outcome.best.reasons,
        ]);
        patch = Object.fromEntries(
          Object.entries(fields).map(([k, v]) => [
            k,
            v == null || v === "" ? FieldValue.delete() : v,
          ]),
        );
        updates.push({ comprovanteId: id, ...fields });
      } else {
        const reasons = [
          CONTESTED,
          ...((doc.get("matchReasons") as string[] | undefined) ?? []).filter(
            (r) => r !== CONTESTED,
          ),
        ].slice(0, 6);
        patch = { matchIsAmbiguous: true, matchReasons: reasons };
        updates.push({ comprovanteId: id, ...patch });
      }
      await doc.ref.update({
        ...patch,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return NextResponse.json({
      checked: pendingSnap.size,
      changed: updates,
      hasMore: pendingSnap.size === MAX_PER_RUN,
    });
  } catch (err) {
    console.error("[comprovantes/rebalance]", err);
    return NextResponse.json(
      { error: "Erro ao redistribuir a fila." },
      { status: 500 },
    );
  }
}
