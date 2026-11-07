/**
 * POST /api/internal/feedback
 *   { action: "create", ...CreateFeedbackInput }    abre o chamado (quem está logado)
 *   { action: "reply", id, text }                   quem abriu responde
 *   { action: "rate", id, solved }                  quem abriu diz se resolveu
 *   { action: "seen", id }                          marca como visto por quem abriu e pelo admin
 *   { action: "team", id, text?, status?, inRelease? }  admin responde e/ou muda a situação
 *   { action: "merge", id, targetId }               admin une um chamado repetido a outro
 *
 * Fica no servidor porque avisa outras pessoas (as rules só deixam cada usuário
 * criar notificação para si mesmo) e numera os protocolos. Aviso que falha
 * nunca derruba a gravação: o chamado já existe.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createElement } from "react";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  FeedbackNotificationEmail,
  FeedbackUpdateEmail,
} from "@/components/emails/EmailTemplates";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { sendEmail } from "@/lib/email/sendEmail";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  createFeedbackSchema,
  deriveTitle,
  FEEDBACK_STATUSES,
  FEEDBACK_TEXT_MAX,
  FEEDBACK_TYPE_LABEL,
  feedbackPriority,
  feedbackStatusLabel,
  feedbackText,
  isClosed,
  isOwnScreenshotUrl,
  protocolOf,
  responseDueAt,
  statusAfterUserReply,
  waitsForTeam,
} from "@/lib/feedback";
import type { FeedbackStatus, FeedbackType } from "@/lib/types";

const COLLECTION = "feedbacks";
const TEAM_NAME = "Equipe FinControl";

type Data = FirebaseFirestore.DocumentData;

const fail = (error: string, status: number) =>
  NextResponse.json({ error }, { status });

class Refusal extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function currentUser() {
  const token = (await cookies()).get("auth_token")?.value;
  if (!token) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const profile =
      (await adminDb.collection("users").doc(decoded.uid).get()).data() ?? {};
    return {
      uid: decoded.uid,
      email: (decoded.email ?? profile.email ?? "") as string,
      name: (profile.displayName ?? decoded.name ?? "Usuário") as string,
      isAdmin: profile.role === "admin" || decoded.role === "admin",
      role: profile.role as string | undefined,
      companyRoles: (profile.companyRoles ?? {}) as Record<string, string>,
    };
  } catch {
    return null;
  }
}

type Caller = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

const statusEvent = (
  status: FeedbackStatus,
  from: "user" | "team",
  authorName: string,
  text?: string,
) => ({
  id: randomUUID(),
  kind: "status" as const,
  from,
  authorName,
  status,
  ...(text && { text }),
  at: Timestamp.now(),
});

const messageEvent = (
  text: string,
  from: "user" | "team",
  authorName: string,
) => ({
  id: randomUUID(),
  kind: "message" as const,
  from,
  authorName,
  text,
  at: Timestamp.now(),
});

const nextDueAt = (data: Data) => {
  const due = responseDueAt(
    new Date(),
    data.type as FeedbackType,
    !!data.blocksPayment,
  );
  return due ? Timestamp.fromDate(due) : FieldValue.delete();
};

const ticketLabel = (data: Data) => data.protocol ?? `"${data.title}"`;

function pushNotification(
  batch: FirebaseFirestore.Transaction | FirebaseFirestore.WriteBatch,
  n: {
    userId: string;
    companyId: string;
    title: string;
    message: string;
    type: string;
    link: string;
  },
) {
  const ref = adminDb.collection("notifications").doc();
  const doc = {
    ...n,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  };
  // Mesma assinatura em Transaction e WriteBatch.
  (batch as FirebaseFirestore.WriteBatch).set(ref, doc);
}

async function globalAdmins() {
  const snap = await adminDb
    .collection("users")
    .where("role", "==", "admin")
    .select("email", "active")
    .get();
  return snap.docs
    .filter((d) => d.get("active") !== false)
    .map((d) => ({ uid: d.id, email: d.get("email") as string | undefined }));
}

/** O Resend devolve a falha em vez de lançar: sem isto, ela sumiria sem log. */
async function deliver(id: string, email: Parameters<typeof sendEmail>[0]) {
  const result = await sendEmail(email);
  if (!result.simulated && result.error) {
    logger.error("Feedback: e-mail recusado", { error: result.error, id });
  }
}

/** Avisa os admins, na tela e por e-mail. Falha fica no log, nunca para o usuário. */
async function notifyTeam(
  origin: string,
  id: string,
  data: Data,
  heading: string,
  text: string,
  skipUid?: string,
) {
  try {
    const admins = (await globalAdmins()).filter((a) => a.uid !== skipUid);
    const urgent = !!data.blocksPayment;
    const batch = adminDb.batch();
    admins.forEach((a) =>
      pushNotification(batch, {
        userId: a.uid,
        companyId: "",
        title: urgent ? `Pagamento em risco: ${heading}` : heading,
        message:
          `${data.protocol ?? ""} ${data.userName}: "${data.title}"`.trim(),
        type: urgent ? "warning" : "info",
        link: `/configuracoes/feedbacks?chamado=${id}`,
      }),
    );
    await batch.commit();

    const emails = admins.flatMap((a) => (a.email ? [a.email] : []));
    if (emails.length) {
      await deliver(id, {
        to: emails,
        subject: `${urgent ? "[URGENTE] " : ""}${data.protocol ?? "Chamado"}: ${data.title}`,
        sender: "notificacoes",
        react: createElement(FeedbackNotificationEmail, {
          heading,
          protocol: data.protocol ?? "",
          urgent,
          feedbackType: data.type,
          feedbackTypeLabel: FEEDBACK_TYPE_LABEL[data.type as FeedbackType],
          title: data.title,
          description: text,
          userName: data.userName,
          userEmail: data.userEmail,
          companyName: data.companyName ?? "",
          screen: data.context?.screen ?? "",
          link: `${origin}/configuracoes/feedbacks?chamado=${id}`,
        }),
      });
    }
  } catch (error) {
    logger.error("Feedback: aviso aos admins falhou", { error, id });
  }
}

/** E-mail a quem abriu: depois de gravar, e sem desfazer nada se falhar. */
async function emailOwner(
  origin: string,
  id: string,
  data: Data,
  message: string,
) {
  if (!data.userEmail) return;
  try {
    await deliver(id, {
      to: data.userEmail,
      subject: `${data.protocol ?? "Seu chamado"}: ${data.title}`,
      sender: "notificacoes",
      react: createElement(FeedbackUpdateEmail, {
        protocol: data.protocol ?? "",
        title: data.title,
        message,
        link: `${origin}/feedback?chamado=${id}`,
      }),
    });
  } catch (error) {
    logger.error("Feedback: e-mail ao usuário falhou", { error, id });
  }
}

async function create(body: unknown, me: Caller, origin: string) {
  const parsed = createFeedbackSchema.safeParse(body);
  if (!parsed.success) {
    throw new Refusal(
      parsed.error.issues[0]?.message ?? "Dados inválidos.",
      400,
    );
  }
  const input = parsed.data;
  if (input.screenshotUrl && !isOwnScreenshotUrl(input.screenshotUrl, me.uid)) {
    throw new Refusal("Anexo inválido.", 400);
  }

  const limit = checkRateLimit({
    maxRequests: 10,
    windowSeconds: 60,
    identifier: `feedback:${me.uid}`,
  });
  if (!limit.success) {
    throw new Refusal("Muitos envios seguidos. Aguarde um minuto.", 429);
  }

  // Empresa de quem não pertence a ela é descartada: o chamado continua valendo.
  const belongs =
    input.companyId && (me.isAdmin || !!me.companyRoles[input.companyId]);
  const companyId = belongs ? input.companyId : "";
  const companyName = companyId
    ? (((await adminDb.collection("companies").doc(companyId).get()).get(
        "name",
      ) as string | undefined) ?? "")
    : "";

  const now = new Date();
  const blocksPayment = input.type === "bug" && input.blocksPayment;
  const dueAt = responseDueAt(now, input.type, blocksPayment);
  const ref = adminDb.collection(COLLECTION).doc(input.id);
  const counter = adminDb
    .collection("feedback_counters")
    .doc(String(now.getFullYear()));

  const { protocol, data, created } = await adminDb.runTransaction(
    async (tx) => {
      // A resposta pode ter se perdido na tentativa anterior: mesmo id, mesmo chamado.
      const existing = await tx.get(ref);
      if (existing.exists) {
        if (existing.get("userId") !== me.uid) {
          throw new Refusal("Chamado inválido.", 409);
        }
        return {
          protocol: existing.get("protocol") as string,
          data: existing.data()!,
          created: false,
        };
      }
      const sequence = ((await tx.get(counter)).get("last") ?? 0) + 1;
      const protocol = protocolOf(now.getFullYear(), sequence);
      const data: Data = {
        protocol,
        userId: me.uid,
        userEmail: me.email,
        userName: me.name,
        companyId,
        companyName,
        type: input.type,
        priority: feedbackPriority({
          type: input.type,
          blocksPayment,
          hasError: input.context.errors.length > 0,
        }),
        blocksPayment,
        title: deriveTitle(input.description),
        description: input.description,
        screenshotUrl: input.screenshotUrl ?? null,
        context: {
          ...input.context,
          role: (companyId && me.companyRoles[companyId]) || me.role || "",
        },
        status: "pending",
        read: false,
        userUnread: false,
        events: [],
        ...(dueAt && { dueAt: Timestamp.fromDate(dueAt) }),
        createdAt: Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now),
      };
      tx.set(counter, { last: sequence }, { merge: true });
      tx.create(ref, data);
      return { protocol, data, created: true };
    },
  );

  if (created) {
    await notifyTeam(
      origin,
      ref.id,
      data,
      `Novo chamado: ${FEEDBACK_TYPE_LABEL[input.type]}`,
      input.description,
      me.uid,
    );
  }
  const savedDue = data.dueAt as Timestamp | undefined;
  return {
    id: ref.id,
    protocol,
    dueAt: savedDue?.toDate().toISOString() ?? null,
  };
}

async function ownerReply(
  id: string,
  text: string,
  me: Caller,
  origin: string,
) {
  const ref = adminDb.collection(COLLECTION).doc(id);
  const data = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get("userId") !== me.uid) {
      throw new Refusal("Chamado não encontrado.", 404);
    }
    const data = snap.data()!;
    const status = statusAfterUserReply(data.status);
    const reopened = isClosed(data.status);
    tx.update(ref, {
      status,
      read: false,
      events: FieldValue.arrayUnion(
        messageEvent(text, "user", me.name),
        ...(reopened
          ? [statusEvent(status, "user", me.name, "Chamado reaberto")]
          : []),
      ),
      ...(status !== data.status && { dueAt: nextDueAt(data) }),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return data;
  });
  await notifyTeam(origin, id, data, "Nova resposta em chamado", text, me.uid);
}

async function ownerRate(
  id: string,
  solved: boolean,
  me: Caller,
  origin: string,
) {
  const ref = adminDb.collection(COLLECTION).doc(id);
  const data = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get("userId") !== me.uid) {
      throw new Refusal("Chamado não encontrado.", 404);
    }
    const data = snap.data()!;
    if (data.status !== "resolved") {
      throw new Refusal("Este chamado não está resolvido.", 409);
    }
    tx.update(ref, {
      solved,
      ...(!solved && {
        status: "in_review",
        read: false,
        dueAt: nextDueAt(data),
        events: FieldValue.arrayUnion(
          statusEvent(
            "in_review",
            "user",
            me.name,
            "Não resolveu; chamado reaberto",
          ),
        ),
      }),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return data;
  });
  if (!solved) {
    await notifyTeam(
      origin,
      id,
      data,
      "Usuário disse que não resolveu",
      data.description,
      me.uid,
    );
  }
}

async function teamUpdate(
  id: string,
  input: { text: string; status?: FeedbackStatus; inRelease: boolean },
  me: Caller,
  origin: string,
) {
  const ref = adminDb.collection(COLLECTION).doc(id);
  const { data, merged, message } = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Refusal("Chamado não encontrado.", 404);
    const data = snap.data()!;
    if (data.mergedInto) {
      throw new Refusal(
        `Este chamado foi unido a ${data.mergedIntoProtocol ?? "outro"}. Responda por lá.`,
        409,
      );
    }
    const mergedSnap = await tx.get(
      adminDb.collection(COLLECTION).where("mergedInto", "==", id),
    );

    const status = input.status ?? (data.status as FeedbackStatus);
    const statusChanged = status !== data.status;
    const fixed = input.inRelease && status === "resolved";
    if (!input.text && !statusChanged && !fixed) {
      throw new Refusal("Nada para salvar.", 400);
    }
    const statusFields = {
      status,
      userUnread: true,
      updatedAt: FieldValue.serverTimestamp(),
      ...(fixed && { fixedAt: FieldValue.serverTimestamp() }),
      // Ao resolver de novo, a pergunta "Isso resolveu?" volta a valer.
      ...(statusChanged &&
        status === "resolved" && { solved: FieldValue.delete() }),
      ...(statusChanged &&
        waitsForTeam(status) &&
        !waitsForTeam(data.status) && { dueAt: nextDueAt(data) }),
    };

    const events = [
      ...(input.text ? [messageEvent(input.text, "team", TEAM_NAME)] : []),
      ...(statusChanged ? [statusEvent(status, "team", TEAM_NAME)] : []),
    ];
    tx.update(ref, {
      ...statusFields,
      // arrayUnion recusa lista vazia (só marcar "em Novidades" não gera evento).
      ...(events.length && { events: FieldValue.arrayUnion(...events) }),
    });

    const message =
      input.text ||
      (fixed
        ? "A correção já está disponível. Os detalhes estão em Novidades."
        : `Situação: ${feedbackStatusLabel(status, "user")}.`);
    if (data.userId !== me.uid) {
      pushNotification(tx, {
        userId: data.userId,
        companyId: data.companyId ?? "",
        title: `Chamado ${ticketLabel(data)}`,
        message,
        type: fixed || status === "resolved" ? "success" : "info",
        link: `/feedback?chamado=${id}`,
      });
    }

    // Repetidos acompanham a situação, nunca o texto: podem ser de outra empresa.
    const merged = mergedSnap.docs.map((d) => ({ id: d.id, data: d.data() }));
    if (statusChanged || fixed) {
      merged.forEach((m) => {
        tx.update(adminDb.collection(COLLECTION).doc(m.id), {
          ...statusFields,
          events: FieldValue.arrayUnion(statusEvent(status, "team", TEAM_NAME)),
        });
        if (m.data.userId !== me.uid) {
          pushNotification(tx, {
            userId: m.data.userId,
            companyId: m.data.companyId ?? "",
            title: `Chamado ${ticketLabel(m.data)}`,
            message: fixed
              ? "A correção já está disponível. Os detalhes estão em Novidades."
              : `Situação: ${feedbackStatusLabel(status, "user")}.`,
            type: status === "resolved" ? "success" : "info",
            link: `/feedback?chamado=${m.id}`,
          });
        }
      });
    }
    return {
      data,
      message,
      merged: statusChanged || fixed ? merged : [],
    };
  });

  await Promise.all([
    data.userId !== me.uid ? emailOwner(origin, id, data, message) : null,
    ...merged
      .filter((m) => m.data.userId !== me.uid)
      .map((m) =>
        emailOwner(
          origin,
          m.id,
          m.data,
          `Situação: ${feedbackStatusLabel(input.status ?? "resolved", "user")}.`,
        ),
      ),
  ]);
}

async function mergeTickets(
  id: string,
  targetId: string,
  me: Caller,
  origin: string,
) {
  if (id === targetId) throw new Refusal("Escolha outro chamado.", 400);
  const ref = adminDb.collection(COLLECTION).doc(id);
  const targetRef = adminDb.collection(COLLECTION).doc(targetId);
  const { source, message } = await adminDb.runTransaction(async (tx) => {
    const [sSnap, tSnap, children] = await Promise.all([
      tx.get(ref),
      tx.get(targetRef),
      tx.get(adminDb.collection(COLLECTION).where("mergedInto", "==", id)),
    ]);
    if (!sSnap.exists || !tSnap.exists) {
      throw new Refusal("Chamado não encontrado.", 404);
    }
    const source = sSnap.data()!;
    const target = tSnap.data()!;
    if (source.mergedInto || target.mergedInto) {
      throw new Refusal("Um dos chamados já foi unido a outro.", 409);
    }
    const label = target.protocol ?? `"${target.title}"`;
    const message = `Unido ao chamado ${label}, que trata do mesmo assunto. Você recebe os avisos da situação por aqui.`;
    tx.update(ref, {
      mergedInto: targetId,
      mergedIntoProtocol: target.protocol ?? null,
      status: target.status,
      read: true,
      userUnread: true,
      events: FieldValue.arrayUnion(
        statusEvent(target.status, "team", TEAM_NAME, message),
      ),
      updatedAt: FieldValue.serverTimestamp(),
    });
    children.docs.forEach((d) =>
      tx.update(d.ref, {
        mergedInto: targetId,
        mergedIntoProtocol: target.protocol ?? null,
      }),
    );
    // Quem chegou por último não pode rebaixar a urgência do grupo.
    const earlierDue =
      source.dueAt && (!target.dueAt || source.dueAt < target.dueAt)
        ? { dueAt: source.dueAt }
        : {};
    tx.update(targetRef, {
      ...(source.blocksPayment && {
        blocksPayment: true,
        priority: "critical",
      }),
      ...earlierDue,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (source.userId !== me.uid) {
      pushNotification(tx, {
        userId: source.userId,
        companyId: source.companyId ?? "",
        title: `Chamado ${ticketLabel(source)}`,
        message,
        type: "info",
        link: `/feedback?chamado=${id}`,
      });
    }
    return { source, message };
  });
  if (source.userId !== me.uid) await emailOwner(origin, id, source, message);
}

export async function POST(request: NextRequest) {
  const me = await currentUser();
  if (!me) return fail("Sua sessão expirou. Entre de novo.", 401);

  const body = await request.json().catch(() => null);
  const action = body?.action;
  const id = typeof body?.id === "string" ? body.id : "";
  const origin = new URL(request.url).origin;
  if (!id) return fail("Chamado não informado.", 400);

  try {
    if (action === "create") {
      return NextResponse.json(await create(body, me, origin));
    }

    if (action === "reply") {
      const text = feedbackText.safeParse(body.text);
      if (!text.success) return fail(text.error.issues[0].message, 400);
      await ownerReply(id, text.data, me, origin);
      return NextResponse.json({ ok: true });
    }

    if (action === "rate") {
      if (typeof body.solved !== "boolean")
        return fail("Resposta inválida.", 400);
      await ownerRate(id, body.solved, me, origin);
      return NextResponse.json({ ok: true });
    }

    if (action === "seen") {
      const ref = adminDb.collection(COLLECTION).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return fail("Chamado não encontrado.", 404);
      const isOwner = snap.get("userId") === me.uid;
      if (!isOwner && !me.isAdmin) return fail("Acesso negado.", 403);
      await ref.update({
        ...(isOwner && { userUnread: false }),
        ...(me.isAdmin && { read: true }),
      });
      return NextResponse.json({ ok: true });
    }

    if (!me.isAdmin) return fail("Acesso negado.", 403);

    if (action === "team") {
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (text.length > FEEDBACK_TEXT_MAX) {
        return fail(`Escreva no máximo ${FEEDBACK_TEXT_MAX} caracteres.`, 400);
      }
      const status = body.status as FeedbackStatus | undefined;
      if (status !== undefined && !FEEDBACK_STATUSES.includes(status)) {
        return fail("Situação inválida.", 400);
      }
      if (!text && !status) return fail("Nada para salvar.", 400);
      await teamUpdate(
        id,
        { text, status, inRelease: body.inRelease === true },
        me,
        origin,
      );
      return NextResponse.json({ ok: true });
    }

    if (action === "merge") {
      if (typeof body.targetId !== "string" || !body.targetId) {
        return fail("Escolha o chamado de destino.", 400);
      }
      await mergeTickets(id, body.targetId, me, origin);
      return NextResponse.json({ ok: true });
    }

    return fail("Ação inválida.", 400);
  } catch (error) {
    if (error instanceof Refusal) return fail(error.message, error.status);
    logger.error("POST /api/internal/feedback failed", { error, action, id });
    return fail("Falha ao salvar. Tente novamente.", 500);
  }
}
