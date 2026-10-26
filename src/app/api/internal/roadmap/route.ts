/**
 * POST /api/internal/roadmap   (só admin global)
 *   { action: "status", id, status, response? }  muda a situação e/ou a resposta
 *   { action: "merge", id, targetId }            une `id` em `targetId`, somando os votos
 *
 * Fica no servidor porque avisa autor e votantes: as rules só deixam cada
 * usuário criar notificação para si mesmo.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import { ROADMAP_STATUSES, type RoadmapStatus } from "@/lib/roadmap";

const NOTICE: Record<
  RoadmapStatus,
  { title: string; text: (t: string) => string; type: string }
> = {
  suggestion: {
    title: "Sugestão de volta à votação",
    text: (t) => `"${t}" voltou para a votação.`,
    type: "info",
  },
  planned: {
    title: "Sugestão planejada",
    text: (t) => `"${t}" entrou no planejamento.`,
    type: "info",
  },
  in_progress: {
    title: "Em execução",
    text: (t) => `"${t}" começou a ser desenvolvida.`,
    type: "info",
  },
  done: {
    title: "Entregue",
    text: (t) => `"${t}" já está disponível. Os detalhes estão em Novidades.`,
    type: "success",
  },
  declined: {
    title: "Sugestão encerrada",
    text: (t) => `"${t}" não será feita por enquanto.`,
    type: "warning",
  },
};

const fail = (error: string, status: number) =>
  NextResponse.json({ error }, { status });

async function adminUid(): Promise<string | null> {
  const token = (await cookies()).get("auth_token")?.value;
  if (!token) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    if (decoded.role === "admin") return decoded.uid;
    const user = await adminDb.collection("users").doc(decoded.uid).get();
    return user.data()?.role === "admin" ? decoded.uid : null;
  } catch {
    return null;
  }
}

// Autor e votantes, uma notificação por pessoa, na empresa de onde ela votou
function recipients(data: FirebaseFirestore.DocumentData, skipUid: string) {
  const byUid = new Map<string, string>();
  for (const v of (data.voters ?? []) as string[]) {
    const [companyId, uid] = v.split(":");
    if (companyId && uid && !byUid.has(uid)) byUid.set(uid, companyId);
  }
  if (data.userId && data.companyId && !byUid.has(data.userId)) {
    byUid.set(data.userId, data.companyId);
  }
  byUid.delete(skipUid);
  return byUid;
}

function notify(
  batch: FirebaseFirestore.WriteBatch,
  to: Map<string, string>,
  notice: { title: string; message: string; type: string; link: string },
) {
  to.forEach((companyId, userId) => {
    batch.set(adminDb.collection("notifications").doc(), {
      userId,
      companyId,
      ...notice,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
}

const withResponse = (message: string, response?: string) =>
  response ? `${message} Resposta da equipe: ${response}` : message;

export async function POST(request: NextRequest) {
  const uid = await adminUid();
  if (!uid) return fail("Acesso negado.", 403);

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return fail("Item não informado.", 400);
  const ref = adminDb.collection("roadmap_items").doc(id);

  try {
    if (body.action === "status") {
      const status = body.status as RoadmapStatus;
      if (!ROADMAP_STATUSES.includes(status))
        return fail("Situação inválida.", 400);
      const response =
        typeof body.response === "string" ? body.response.trim() : "";
      if (response.length > 1000) {
        return fail("A resposta deve ter até 1000 caracteres.", 400);
      }

      const snap = await ref.get();
      if (!snap.exists) return fail("Item não encontrado.", 404);
      const data = snap.data()!;
      const statusChanged = data.status !== status;
      const responseChanged = (data.response ?? "") !== response;
      if (!statusChanged && !responseChanged) {
        return NextResponse.json({ notified: 0 });
      }

      const batch = adminDb.batch();
      batch.update(ref, {
        status,
        response: response || FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
        ...(statusChanged && {
          doneAt:
            status === "done"
              ? FieldValue.serverTimestamp()
              : FieldValue.delete(),
        }),
      });
      const to = recipients(data, uid);
      const notice = statusChanged
        ? NOTICE[status]
        : {
            title: "Resposta da equipe",
            text: (t: string) => `"${t}" recebeu uma resposta.`,
            type: "info",
          };
      notify(batch, to, {
        title: notice.title,
        message: withResponse(notice.text(data.title), response),
        type: notice.type,
        link: `/roadmap?item=${id}`,
      });
      await batch.commit();
      return NextResponse.json({ notified: to.size });
    }

    if (body.action === "merge") {
      const targetId = typeof body.targetId === "string" ? body.targetId : "";
      if (!targetId || targetId === id) return fail("Destino inválido.", 400);
      const targetRef = adminDb.collection("roadmap_items").doc(targetId);

      const notified = await adminDb.runTransaction(async (tx) => {
        const [source, target] = await Promise.all([
          tx.get(ref),
          tx.get(targetRef),
        ]);
        if (!source.exists || !target.exists) {
          throw new Error("not-found");
        }
        const s = source.data()!;
        const t = target.data()!;
        if (s.mergedInto || t.mergedInto) throw new Error("already-merged");

        const response = `Unida a "${t.title}", que reúne o mesmo pedido. Os votos foram somados lá.`;
        const voters = (s.voters ?? []) as string[];
        tx.update(targetRef, {
          ...(voters.length && { voters: FieldValue.arrayUnion(...voters) }),
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.update(ref, {
          status: "declined",
          mergedInto: targetId,
          response,
          updatedAt: FieldValue.serverTimestamp(),
        });
        const to = recipients(s, uid);
        to.forEach((companyId, userId) =>
          tx.set(adminDb.collection("notifications").doc(), {
            userId,
            companyId,
            title: "Sugestão unida a outra",
            message: `"${s.title}" foi unida a "${t.title}". Seu voto foi transferido.`,
            type: "info",
            link: `/roadmap?item=${id}`,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          }),
        );
        return to.size;
      });
      return NextResponse.json({ notified });
    }

    return fail("Ação inválida.", 400);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "not-found") return fail("Item não encontrado.", 404);
    if (code === "already-merged") {
      return fail("Um dos itens já foi unido a outro.", 409);
    }
    logger.error("POST /api/internal/roadmap failed", { error });
    return fail("Falha ao salvar.", 500);
  }
}
