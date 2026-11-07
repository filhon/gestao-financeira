import { createHash } from "node:crypto";
import currency from "currency.js";
import type { DocumentData } from "firebase-admin/firestore";
import { z } from "zod";
import { replyKey, type ReplyRecord } from "./replyApproval";
import { approvalRecipients } from "../transactionAction";
import type { CostCenter, UserProfile } from "../types";

/**
 * O navegador só diz o que enviar e sobre qual registro. Destinatário, link,
 * valores e nome da empresa são conferidos ou lidos no Firestore: um e-mail do
 * domínio com botão de aprovação não pode ter conteúdo escolhido por quem chama.
 */
export type EmailSender = "aprovacao" | "autorizacao" | "notificacoes";

const id = z.string().min(1).max(128);
const token = z.string().min(1).max(128);

const request = <T extends string, D extends z.ZodRawShape>(type: T, data: D) =>
  z.object({
    type: z.literal(type),
    to: z.tuple([z.email()]),
    data: z.object(data),
  });

const emailRequest = z.discriminatedUnion("type", [
  request("approval_request", { transactionId: id }),
  request("status_update", { transactionId: id }),
  request("batch_approval_request", { batchId: id, token }),
  request("batch_authorization_request", { batchId: id, token }),
  request("batch_new_transactions", {
    batchId: id,
    token,
    newTransactionCount: z.number().int().positive(),
    additionalAmount: z.number().nonnegative(),
  }),
  request("reimbursement_approval", { reportId: id, token }),
  request("reimbursement_approved", { reportId: id }),
]);

export type EmailType = z.infer<typeof emailRequest>["type"];

export type EmailCaller = {
  email?: string | null;
  displayName?: string | null;
  role?: string | null;
  companyRoles?: Record<string, unknown> | null;
};

export type BatchEmailReview = {
  firstDueDate?: string;
  overdueCount: number;
  budgetExceededCount: number;
  topItems: { supplier: string; amount: string; dueDate: string }[];
  alertCount: number;
  fingerprint: string;
  total: number;
  tooLarge: boolean;
};

export type EmailLoaders = {
  transaction: (id: string) => Promise<DocumentData | null>;
  installmentAmounts: (companyId: string, groupId: string) => Promise<number[]>;
  batch: (id: string) => Promise<DocumentData | null>;
  /** null se a leitura falhar: o link ainda sai, sem resumo e sem aprovar por resposta. */
  batchReview: (
    id: string,
    companyId: string,
  ) => Promise<BatchEmailReview | null>;
  expiryLabel: (expiresAt: Date) => string;
  replyApprovalEnabled: () => boolean;
  report: (id: string) => Promise<DocumentData | null>;
  companyName: (id: string) => Promise<string | null>;
  userEmail: (uid: string) => Promise<string | null>;
  costCenter: (
    id: string,
  ) => Promise<Pick<CostCenter, "companyId" | "approverEmail"> | null>;
  users: () => Promise<
    Pick<UserProfile, "email" | "companyRoles" | "status" | "active">[]
  >;
};

export type ResolvedEmail = {
  type: EmailType;
  to: string;
  subject: string;
  sender: EmailSender;
  fromName?: string;
  props: Record<string, unknown>;
  /** Presente quando a resposta a este e-mail pode aprovar o lote. */
  replyApproval?: ReplyRecord & { key: string };
};
export type DeniedEmail = { error: string; status: number };

const DENIED: DeniedEmail = {
  error:
    "Envio recusado: o destinatário ou o link não conferem com o registro.",
  status: 403,
};

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

const sameEmail = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

const brl = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    value,
  );

// O servidor roda em UTC: sem o fuso, o fim do mês vira o dia seguinte.
const brDate = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
});
const period = (report: DocumentData) =>
  `${brDate.format(report.periodStart.toDate())} — ${brDate.format(report.periodEnd.toDate())}`;

/** "Hebron - Assessoria Ltda" → "FinControl · Hebron": a razão social esconde o lote no celular. */
const companyFrom = (name: string | null) => {
  const short = name?.split(/\s+[-–]\s+/)[0].trim();
  return short ? `FinControl · ${short}` : undefined;
};

export async function resolveEmail(
  body: unknown,
  caller: EmailCaller,
  origin: string,
  load: EmailLoaders,
): Promise<ResolvedEmail | DeniedEmail> {
  const parsed = emailRequest.safeParse(body);
  if (!parsed.success) {
    return { error: "Pedido de e-mail inválido.", status: 400 };
  }
  const req = parsed.data;
  const to = req.to[0];
  const senderName = caller.displayName || caller.email || "FinControl";

  const isMember = (companyId: unknown) =>
    typeof companyId === "string" &&
    (caller.role === "admin" || companyId in (caller.companyRoles ?? {}));

  /** Só quem acabou de gerar o token o conhece: o banco guarda apenas o hash. */
  const sentBatch = async (
    batchId: string,
    batchToken: string,
    status: string,
    recipient: "approverEmail" | "authorizerEmail",
  ) => {
    const batch = await load.batch(batchId);
    return batch &&
      isMember(batch.companyId) &&
      batch.status === status &&
      sameEmail(batch[recipient], to) &&
      batch.approvalTokenHash === sha256(batchToken)
      ? batch
      : null;
  };

  switch (req.type) {
    case "approval_request": {
      const tx = await load.transaction(req.data.transactionId);
      if (
        !tx ||
        !isMember(tx.companyId) ||
        tx.status !== "pending_approval" ||
        !tx.approvalToken
      ) {
        return DENIED;
      }
      const recipients = await approvalRecipients(
        {
          companyId: tx.companyId,
          costCenterAllocation: tx.costCenterAllocation,
        },
        caller.email ?? "",
        load,
      );
      if (!recipients.some((email) => sameEmail(email, to))) return DENIED;

      // A primeira parcela leva o link e mostra o total do parcelamento.
      const groupId = tx.installments?.current === 1 && tx.installments.groupId;
      const amount = groupId
        ? (await load.installmentAmounts(tx.companyId, groupId)).reduce(
            (sum, v) => sum.add(v),
            currency(0),
          ).value
        : tx.amount;

      return {
        type: req.type,
        to,
        subject: `Aprovação Necessária: ${tx.description}`,
        sender: "aprovacao",
        props: {
          transactionId: req.data.transactionId,
          description: tx.description,
          amount: brl(amount),
          requesterName: tx.requestOrigin?.name || "Solicitante",
          link: `${origin}/approve/${tx.approvalToken}`,
        },
      };
    }

    case "status_update": {
      const tx = await load.transaction(req.data.transactionId);
      if (!tx || !isMember(tx.companyId)) return DENIED;
      if (!sameEmail(await load.userEmail(tx.createdBy), to)) return DENIED;
      const list = tx.type === "payable" ? "contas-pagar" : "contas-receber";
      return {
        type: req.type,
        to,
        subject: `Atualização de Status: ${tx.description}`,
        sender: "notificacoes",
        props: {
          transactionId: req.data.transactionId,
          description: tx.description,
          status: tx.status,
          reason: tx.rejectionReason ?? undefined,
          updatedBy: senderName,
          link: `${origin}/financeiro/${list}`,
        },
      };
    }

    case "batch_approval_request": {
      const { batchId, token: batchToken } = req.data;
      const batch = await sentBatch(
        batchId,
        batchToken,
        "pending_approval",
        "approverEmail",
      );
      if (!batch) return DENIED;
      const [companyName, review] = await Promise.all([
        load.companyName(batch.companyId),
        load.batchReview(batchId, batch.companyId),
      ]);
      const totalAmount = brl(batch.totalAmount ?? 0);
      // Só oferece o que a resposta conseguiria aprovar ao chegar.
      const replyable =
        load.replyApprovalEnabled() &&
        !!caller.email &&
        !sameEmail(caller.email, to) &&
        !!review &&
        review.alertCount === 0 &&
        !review.tooLarge &&
        review.total === batch.totalAmount;
      return {
        type: req.type,
        to,
        subject: `Aprovar: ${batch.name} · ${totalAmount}`,
        sender: "aprovacao",
        fromName: companyFrom(companyName),
        replyApproval: replyable
          ? {
              key: replyKey(batchToken),
              batchId,
              companyId: batch.companyId,
              tokenHash: batch.approvalTokenHash,
              approverEmail: to,
              senderEmail: caller.email!,
              fingerprint: review.fingerprint,
            }
          : undefined,
        props: {
          firstDueDate: review?.firstDueDate,
          overdueCount: review?.overdueCount,
          budgetExceededCount: review?.budgetExceededCount,
          topItems: review?.topItems,
          expiresAt: batch.approvalTokenExpiresAt
            ? load.expiryLabel(batch.approvalTokenExpiresAt.toDate())
            : undefined,
          replyable,
          batchId,
          batchName: batch.name,
          transactionCount: batch.transactionIds?.length ?? 0,
          totalAmount,
          senderName,
          companyName: companyName ?? undefined,
          link: `${origin}/approve-batch/${batchToken}`,
        },
      };
    }

    case "batch_authorization_request": {
      const { batchId, token: batchToken } = req.data;
      const batch = await sentBatch(
        batchId,
        batchToken,
        "pending_authorization",
        "authorizerEmail",
      );
      if (!batch) return DENIED;
      return {
        type: req.type,
        to,
        subject: `Autorizar: ${batch.name}`,
        sender: "autorizacao",
        fromName: companyFrom(await load.companyName(batch.companyId)),
        props: {
          batchId,
          batchName: batch.name,
          transactionCount: batch.transactionIds?.length ?? 0,
          totalAmount: brl(batch.totalAmount ?? 0),
          senderName,
          link: `${origin}/authorize-batch/${batchToken}`,
        },
      };
    }

    case "batch_new_transactions": {
      const { batchId, token: batchToken } = req.data;
      const batch = await sentBatch(
        batchId,
        batchToken,
        "pending_approval",
        "approverEmail",
      );
      if (!batch) return DENIED;
      return {
        type: req.type,
        to,
        subject: `Novas transações adicionadas ao lote: ${batch.name}`,
        sender: "aprovacao",
        props: {
          batchName: batch.name,
          newTransactionCount: req.data.newTransactionCount,
          additionalAmount: brl(req.data.additionalAmount),
          senderName,
          link: `${origin}/approve-batch/${batchToken}`,
        },
      };
    }

    case "reimbursement_approval": {
      const report = await load.report(req.data.reportId);
      if (
        !report ||
        !isMember(report.companyId) ||
        report.status !== "pending_approval" ||
        !sameEmail(report.approverEmail, to) ||
        report.approvalTokenHash !== sha256(req.data.token)
      ) {
        return DENIED;
      }
      const link = `${origin}/approve-reimbursement/${req.data.token}`;
      return {
        type: req.type,
        to,
        subject: `Aprovação Necessária: ${report.rdNumber} — ${report.employeeName}`,
        sender: "aprovacao",
        props: {
          rdNumber: report.rdNumber,
          employeeName: report.employeeName,
          period: period(report),
          totalAmount: brl(report.totalAmount ?? 0),
          transactionCount: report.transactionIds?.length ?? 0,
          senderName,
          approveLink: `${link}?action=approve`,
          rejectLink: `${link}?action=reject`,
        },
      };
    }

    case "reimbursement_approved": {
      const report = await load.report(req.data.reportId);
      if (
        !report ||
        !isMember(report.companyId) ||
        !["approved", "paid"].includes(report.status) ||
        !sameEmail(report.employeeEmail, to)
      ) {
        return DENIED;
      }
      return {
        type: req.type,
        to,
        subject: `Reembolso Aprovado: ${report.rdNumber}`,
        sender: "notificacoes",
        props: {
          rdNumber: report.rdNumber,
          employeeName: report.employeeName,
          period: period(report),
          totalAmount: brl(report.totalAmount ?? 0),
          approvedBy: senderName,
          systemLink: `${origin}/financeiro/reembolsos`,
        },
      };
    }
  }
}
