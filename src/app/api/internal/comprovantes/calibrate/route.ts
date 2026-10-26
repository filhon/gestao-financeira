/**
 * POST /api/internal/comprovantes/calibrate   (header x-company-id)
 * { comprovanteId, entityId?, amount?, date?: "yyyy-MM-dd", learnOnly? }
 *
 * O usuário corrige o que a leitura automática errou (ou não achou):
 *   1. Beneficiário informado ensina a entidade: CNPJ, chave Pix e grafia do
 *      nome lidos neste comprovante viram aliases, e o próximo comprovante
 *      dela já chega identificado.
 *   2. Com os campos corrigidos, o matching roda de novo e a sugestão é
 *      refeita, restrita aos títulos do beneficiário afirmado.
 * `learnOnly` só aprende (usado ao confirmar um título quando o beneficiário
 * não tinha sido lido) e não mexe na sugestão.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { authenticateAdminRequest } from "@/lib/api/adminAuth";
import {
  hasAliases,
  learnableAliases,
  matchComprovante,
  parseReceipt,
} from "@/lib/matching";
import { normalize } from "@/lib/matching/text";
import type { Entity } from "@/lib/types";
import {
  fetchCandidateTransactions,
  fetchEntities,
  signalsForStorage,
} from "@/lib/api/comprovanteAdmin";

const toBrasiliaNoon = (ymd: string) => new Date(`${ymd}T12:00:00-03:00`);

/** Timestamp/Date → ISO, para o client reidratar o patch. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const iso = (v: any): string | null =>
  v?.toDate
    ? v.toDate().toISOString()
    : v instanceof Date
      ? v.toISOString()
      : null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const forClient = (patch: Record<string, any>) => ({
  ...patch,
  ...("matchedDate" in patch && { matchedDate: iso(patch.matchedDate) }),
  manualFields: {
    ...patch.manualFields,
    date: iso(patch.manualFields?.date),
    at: iso(patch.manualFields?.at),
  },
});

export async function POST(req: NextRequest) {
  const auth = await authenticateAdminRequest(req);
  if (!auth.success) return auth.response;
  const { companyId, uid, profile } = auth;

  let body: {
    comprovanteId?: string;
    entityId?: string;
    amount?: number;
    date?: string;
    learnOnly?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const { comprovanteId, entityId, learnOnly } = body;
  const amount =
    typeof body.amount === "number" && body.amount > 0
      ? body.amount
      : undefined;
  const date =
    body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? toBrasiliaNoon(body.date)
      : undefined;

  if (!comprovanteId || (!entityId && amount == null && !date)) {
    return NextResponse.json(
      { error: "Informe ao menos um campo corrigido." },
      { status: 400 },
    );
  }

  try {
    const ref = adminDb.collection("comprovantes").doc(comprovanteId);
    const snap = await ref.get();
    if (!snap.exists || snap.get("companyId") !== companyId) {
      return NextResponse.json(
        { error: "Comprovante não encontrado." },
        { status: 404 },
      );
    }
    if (snap.get("matchStatus") === "matched" && !learnOnly) {
      return NextResponse.json(
        { error: "Remova a associação antes de corrigir a leitura." },
        { status: 409 },
      );
    }

    const text = (snap.get("extractedText") as string | undefined) ?? "";
    const entities = await fetchEntities(companyId).catch(() => [] as Entity[]);
    const entity = entityId ? entities.find((e) => e.id === entityId) : null;
    if (entityId && !entity) {
      return NextResponse.json(
        { error: "Beneficiário não encontrado no cadastro." },
        { status: 404 },
      );
    }

    // ── 1. Aprender com o beneficiário confirmado ─────────────────────────────
    let learned = { documents: [], pixKeys: [], names: [] } as ReturnType<
      typeof learnableAliases
    >;
    if (entity) {
      learned = learnableAliases(parseReceipt(text), entity, entities);
      if (hasAliases(learned)) {
        const update: Record<string, unknown> = {
          updatedAt: FieldValue.serverTimestamp(),
        };
        for (const kind of ["documents", "pixKeys", "names"] as const) {
          if (learned[kind].length) {
            update[`receiptAliases.${kind}`] = FieldValue.arrayUnion(
              ...learned[kind],
            );
          }
        }
        await adminDb.collection("entities").doc(entity.id).update(update);
        entity.receiptAliases = {
          documents: [
            ...(entity.receiptAliases?.documents ?? []),
            ...learned.documents,
          ],
          pixKeys: [
            ...(entity.receiptAliases?.pixKeys ?? []),
            ...learned.pixKeys,
          ],
          names: [...(entity.receiptAliases?.names ?? []), ...learned.names],
        };
      }
    }

    const manualFields = {
      ...(snap.get("manualFields") ?? {}),
      ...(amount != null && { amount }),
      ...(date && { date }),
      ...(entity && { entityId: entity.id, entityName: entity.name }),
      by: uid,
      at: new Date(),
    };

    // Auditoria nunca derruba a correção, que já foi gravada. Campos não
    // corrigidos chegam undefined e o Firestore os rejeita (síncrono, por isso
    // o try em vez de .catch).
    const audit = async (details: Record<string, unknown>) => {
      try {
        await adminDb.collection("audit_logs").add({
          companyId,
          userId: uid,
          userEmail: profile.email ?? "",
          action: "update",
          entity: "comprovante",
          entityId: comprovanteId,
          details: Object.fromEntries(
            Object.entries({ calibration: true, ...details }).filter(
              ([, v]) => v !== undefined,
            ),
          ),
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (err) {
        console.error("[comprovantes/calibrate] audit falhou:", err);
      }
    };

    if (learnOnly) {
      const patch = {
        manualFields,
        ...(entity && { matchedEntity: entity.name }),
      };
      await ref.update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
      await audit({ entityId, learned });
      return NextResponse.json({ patch: forClient(patch), learned });
    }

    // ── 2. Refazer a sugestão com os campos corrigidos ────────────────────────
    let candidates = await fetchCandidateTransactions(companyId);
    if (entity) {
      const name = normalize(entity.name);
      candidates = candidates.filter(
        (t) =>
          t.entityId === entity.id ||
          (!t.entityId && normalize(t.supplierOrClient ?? "") === name),
      );
    }

    const outcome = matchComprovante(text, candidates, {
      entities,
      comprovanteId,
      confirmedEntityId: entity?.id,
      // Correções anteriores continuam valendo numa nova rodada.
      overrides: {
        amount: amount ?? manualFields.amount,
        date: date ?? manualFields.date?.toDate?.() ?? manualFields.date,
      },
    });
    const best = outcome.best;
    const who = profile.displayName || profile.email || "usuário";

    const patch: Record<string, unknown> = {
      matchStatus: best ? "pending_review" : "unmatched",
      manualFields,
      matchedAmount:
        amount ?? best?.matchedAmount ?? snap.get("matchedAmount") ?? null,
      matchedDate: date ?? best?.matchedDate ?? snap.get("matchedDate") ?? null,
      matchedEntity:
        entity?.name ??
        best?.matchedEntity ??
        snap.get("matchedEntity") ??
        null,
      suggestedTransactionId: best?.transactionId ?? null,
      suggestedTransactionIds: best?.transactionIds ?? null,
      isConsolidated: best?.isConsolidated ?? false,
      matchConfidence: best?.score ?? null,
      matchConfidenceLevel: best?.confidenceLevel ?? null,
      matchIsAmbiguous: best?.isAmbiguous ?? false,
      matchReasons: [
        `Leitura corrigida por ${who}`,
        ...(best?.reasons ?? []),
      ].slice(0, 6),
      matchAlternatives: outcome.alternatives.map((alt) => ({
        transactionId: alt.transactionId,
        transactionIds: alt.transactionIds,
        isConsolidated: alt.isConsolidated,
        score: alt.score,
        confidenceLevel: alt.confidenceLevel,
        entityName: alt.matchedEntity ?? null,
        reason: alt.reasons[0] ?? null,
      })),
      matchSignals: best ? signalsForStorage(best) : null,
      // A correção resolve a suspeita de duplicado que a leitura errada criou.
      possibleDuplicateOf: null,
    };

    await ref.update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
    await audit({
      entityId,
      amount,
      date,
      learned,
      suggested: best?.transactionIds ?? [],
    });

    return NextResponse.json({ patch: forClient(patch), learned });
  } catch (err) {
    console.error("[comprovantes/calibrate]", err);
    return NextResponse.json(
      { error: "Erro ao recalcular a sugestão." },
      { status: 500 },
    );
  }
}
