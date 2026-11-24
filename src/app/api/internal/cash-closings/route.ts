/**
 * POST /api/internal/cash-closings
 *   { action: "close", companyId, period, snapshot, uploadKey, reason? }
 *   { action: "send", companyId, closingId, emails, message? }
 *   { action: "revoke", companyId, linkId }
 * GET  ?companyId=&closingId=&file=package|summary   endereço temporário do arquivo
 *
 * Só admin e gestor fecham, enviam e revogam. Tudo é gravado pelo Admin SDK
 * (as rules negam escrita): o fechamento é imutável e o link é uma credencial.
 * A conferência com o banco é refeita aqui, não confiada à tela.
 */
import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createElement } from "react";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { endOfMonth, format } from "date-fns";
import { CashClosingEmail } from "@/components/emails/EmailTemplates";
import { adminDb } from "@/lib/firebase/admin";
import { wallClock } from "@/lib/analyticsServer";
import { signedClosingUrl, storedFile } from "@/lib/api/closingFiles";
import { authorizeCompany } from "@/lib/api/companyAccess";
import { sendEmail } from "@/lib/email/sendEmail";
import { checkRateLimit } from "@/lib/rateLimit";
import { proveBalance, synthesisTitle } from "@/lib/cashSynthesis";
import {
  canClosePeriod,
  CLOSING_FILES,
  closeSchema,
  LINK_DAYS,
  MIN_REASON,
  requestSchema,
  revokeSchema,
  sendSchema,
  snapshotProblem,
  type ClosingFile,
} from "@/lib/cashClosing";
import type { BankAccount, BankTransaction } from "@/lib/types";
import type { z } from "zod";

// O pacote tem dezenas de MB e o servidor lê tudo para calcular o hash.
export const maxDuration = 60;

const CLOSINGS = "cash_closings";
const LINKS = "cash_closing_links";
const MANAGERS = ["admin", "financial_manager"];
const READERS = [...MANAGERS, "approver", "releaser", "auditor"];

const fail = (error: string, status: number) =>
  NextResponse.json({ error }, { status });

type Caller = { uid: string; name: string; email: string };

async function callerOf(uid: string): Promise<Caller> {
  const d = (await adminDb.collection("users").doc(uid).get()).data() ?? {};
  return {
    uid,
    name: d.displayName || d.email || "Usuário",
    email: d.email ?? "",
  };
}

const audit = (
  companyId: string,
  caller: Caller,
  action: "close_month" | "send_closing" | "revoke_link",
  entityId: string,
  subject: string,
  details: Record<string, unknown>,
) =>
  adminDb
    .collection("audit_logs")
    .add({
      companyId,
      userId: caller.uid,
      userEmail: caller.email,
      userName: caller.name,
      action,
      entity: "cash_closing",
      entityId,
      subject,
      changedFields: [],
      details,
      createdAt: FieldValue.serverTimestamp(),
    })
    // O log que falha não desfaz o que já foi gravado.
    .catch((error) => console.error("[cash-closings] auditoria:", error));

const wall = (v: unknown) =>
  v instanceof Timestamp
    ? wallClock(v.toDate())
    : v
      ? wallClock(new Date(v as string))
      : undefined;

async function serverProof(companyId: string, period: string, closing: number) {
  const [accounts, items] = await Promise.all([
    adminDb
      .collection("bank_accounts")
      .where("companyId", "==", companyId)
      .get(),
    adminDb
      .collection("reconciliation_sessions")
      .doc(companyId)
      .collection("items")
      .get(),
  ]);
  const [y, m] = period.split("-").map(Number);
  return proveBalance(
    closing,
    accounts.docs.map((d) => {
      const x = d.data();
      return {
        ...x,
        id: d.id,
        openingBalanceDate: wall(x.openingBalanceDate),
        statementBalanceDate: wall(x.statementBalanceDate),
        closings: (x.closings ?? []).map((c: Record<string, unknown>) => ({
          ...c,
          through: wall(c.through),
        })),
      } as BankAccount;
    }),
    items.docs.map(
      (d) =>
        ({
          ...d.data(),
          id: d.id,
          date: wall(d.get("date")),
        }) as BankTransaction,
    ),
    endOfMonth(new Date(y, m - 1, 1)),
  );
}

async function close(req: z.infer<typeof closeSchema>, caller: Caller) {
  const { companyId, period, snapshot, uploadKey } = req;
  const today = format(wallClock(new Date()), "yyyy-MM-dd");
  if (!canClosePeriod(period, today))
    return fail("Só dá para fechar um mês que já terminou.", 400);
  const problem = snapshotProblem(snapshot, period);
  if (problem)
    return fail(`${problem} Recarregue a página e tente de novo.`, 400);

  const proof = await serverProof(companyId, period, snapshot.closing);
  const reason = req.reason?.trim() ?? "";
  if (proof.status !== "match" && reason.length < MIN_REASON)
    return fail(
      "O saldo não confere com o banco. Explique por que fechar assim mesmo.",
      400,
    );

  const folder = `closings/${companyId}/${uploadKey}`;
  const [pack, summary] = await Promise.all([
    storedFile(`${folder}/${CLOSING_FILES.package.name}`),
    storedFile(`${folder}/${CLOSING_FILES.summary.name}`),
  ]);
  if (!pack || !summary)
    return fail("Os arquivos do fechamento não chegaram. Tente de novo.", 400);

  const closings = adminDb.collection(CLOSINGS);
  const result = await adminDb.runTransaction(async (t) => {
    const same = await t.get(
      closings
        .where("companyId", "==", companyId)
        .where("period", "==", period),
    );
    // Repetição do mesmo envio (a resposta se perdeu): devolve o que já existe.
    const repeated = same.docs.find(
      (d) => d.get("files.package.path") === pack.path,
    );
    if (repeated)
      return { id: repeated.id, version: repeated.get("version") as number };

    const version =
      Math.max(0, ...same.docs.map((d) => d.get("version") as number)) + 1;
    const ref = closings.doc(`${companyId}_${period}_v${version}`);
    t.create(ref, {
      companyId,
      period,
      version,
      status: "active",
      ...snapshot,
      proof: {
        status: proof.status,
        total: proof.total,
        difference: proof.difference,
        rows: proof.rows.map((r) => ({
          name: r.name,
          balance: r.balance,
          date: r.date ? format(r.date, "yyyy-MM-dd") : null,
        })),
      },
      ...(reason && { reason }),
      files: { package: pack, summary },
      closedBy: caller,
      closedAt: FieldValue.serverTimestamp(),
    });
    for (const d of same.docs) {
      if (d.get("status") === "active")
        t.update(d.ref, { status: "superseded" });
    }
    return { id: ref.id, version };
  });

  await audit(companyId, caller, "close_month", result.id, period, {
    period,
    version: result.version,
    closing: snapshot.closing,
    proof: proof.status,
    ...(reason && { reason }),
  });
  return NextResponse.json({ ...result, proof: proof.status });
}

const hashToken = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");

async function send(
  req: z.infer<typeof sendSchema>,
  caller: Caller,
  origin: string,
) {
  const { companyId, closingId } = req;
  const closing = await adminDb.collection(CLOSINGS).doc(closingId).get();
  if (closing.get("companyId") !== companyId)
    return fail("Fechamento não encontrado.", 404);
  if (closing.get("status") !== "active")
    return fail("Há uma versão mais nova deste fechamento. Envie a nova.", 409);

  const company = await adminDb.collection("companies").doc(companyId).get();
  const companyName = (company.get("name") as string) ?? "";
  const c = closing.data()!;
  const [y, m] = (c.period as string).split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const headline = synthesisTitle(
    { closing: c.closing, inflow: c.inflow, outflow: c.outflow, lines: [] },
    c.proof,
    start,
    endOfMonth(start),
    true,
  );
  const expiresAt = new Date(Date.now() + LINK_DAYS * 24 * 60 * 60 * 1000);
  const links = adminDb.collection(LINKS);

  const results: { email: string; ok: boolean; error?: string }[] = [];
  for (const email of [...new Set(req.emails.map((e) => e.toLowerCase()))]) {
    try {
      const token = randomBytes(32).toString("base64url");
      const ref = links.doc(hashToken(token));
      // Um link por pessoa e por fechamento: reenviar troca o anterior.
      const previous = await links
        .where("companyId", "==", companyId)
        .where("closingId", "==", closingId)
        .where("email", "==", email)
        .get();
      const batch = adminDb.batch();
      for (const d of previous.docs) {
        if (!d.get("revokedAt"))
          batch.update(d.ref, { revokedAt: FieldValue.serverTimestamp() });
      }
      batch.create(ref, {
        companyId,
        closingId,
        period: c.period,
        version: c.version,
        email,
        createdBy: { uid: caller.uid, name: caller.name },
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromDate(expiresAt),
        views: 0,
        downloads: 0,
      });
      await batch.commit();

      const sent = await sendEmail({
        to: email,
        subject: `Fechamento de ${headlinePeriod(start)} - ${companyName}`,
        sender: "notificacoes",
        replyTo: caller.email || undefined,
        react: createElement(CashClosingEmail, {
          companyName,
          headline,
          senderName: caller.name,
          message: req.message?.trim() || undefined,
          version: c.version,
          expires: format(wallClock(expiresAt), "dd/MM/yyyy"),
          link: `${origin}/fechamento/${token}`,
        }),
      });
      const error = sent.simulated
        ? sent.message
        : sent.error
          ? ((sent.error as { message?: string }).message ?? "Falha no envio")
          : null;
      if (error) await ref.update({ sendError: error.slice(0, 300) });
      results.push({ email, ok: !error, ...(error && { error }) });
    } catch (error) {
      console.error("[cash-closings] envio:", error);
      results.push({ email, ok: false, error: "Falha ao criar o link." });
    }
  }

  await audit(companyId, caller, "send_closing", closingId, c.period, {
    period: c.period,
    version: c.version,
    sent: results.filter((r) => r.ok).map((r) => r.email),
    failed: results.filter((r) => !r.ok).map((r) => r.email),
    expiresAt: expiresAt.toISOString(),
  });
  return NextResponse.json({ results });
}

const headlinePeriod = (d: Date) =>
  d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

async function revoke(req: z.infer<typeof revokeSchema>, caller: Caller) {
  const ref = adminDb.collection(LINKS).doc(req.linkId);
  const link = await ref.get();
  if (link.get("companyId") !== req.companyId)
    return fail("Link não encontrado.", 404);
  if (!link.get("revokedAt")) {
    await ref.update({ revokedAt: FieldValue.serverTimestamp() });
    await audit(
      req.companyId,
      caller,
      "revoke_link",
      link.get("closingId"),
      link.get("email"),
      { email: link.get("email"), period: link.get("period") },
    );
  }
  return NextResponse.json({ success: true });
}

export async function POST(req: NextRequest) {
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Dados inválidos.", 400);
  const body = parsed.data;

  const access = await authorizeCompany(body.companyId);
  if (!access.ok) return access.response;
  if (!MANAGERS.includes(access.role)) return fail("Acesso negado.", 403);
  const limit = checkRateLimit({
    identifier: `cash-closing:${access.uid}`,
    maxRequests: 30,
    windowSeconds: 60,
  });
  if (!limit.success) return fail("Muitas tentativas. Aguarde um minuto.", 429);

  try {
    const caller = await callerOf(access.uid);
    if (body.action === "close") return await close(body, caller);
    if (body.action === "send")
      return await send(
        body,
        caller,
        process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin,
      );
    return await revoke(body, caller);
  } catch (error) {
    console.error("[cash-closings]", error);
    return fail("Não foi possível concluir. Tente de novo.", 500);
  }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const companyId = q.get("companyId") ?? "";
  const file = q.get("file") as ClosingFile;
  if (!CLOSING_FILES[file]) return fail("Arquivo inválido.", 400);

  const access = await authorizeCompany(companyId);
  if (!access.ok) return access.response;
  if (!READERS.includes(access.role)) return fail("Acesso negado.", 403);

  const closing = await adminDb
    .collection(CLOSINGS)
    .doc(q.get("closingId") || "-")
    .get();
  if (closing.get("companyId") !== companyId)
    return fail("Fechamento não encontrado.", 404);
  const url = await signedClosingUrl(
    closing.get(`files.${file}.path`),
    closing.get("period"),
    closing.get("version"),
    file,
  );
  return NextResponse.json({ url });
}
