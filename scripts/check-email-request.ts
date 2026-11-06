/**
 * Verificação do envio de e-mail: o navegador não escolhe destinatário, link,
 * valores nem empresa.
 *   npm run check:email-request
 * Falha com exceção na primeira regra quebrada.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { DocumentData } from "firebase-admin/firestore";
import {
  resolveEmail,
  type BatchEmailReview,
  type DeniedEmail,
  type EmailCaller,
  type EmailLoaders,
  type ResolvedEmail,
} from "../src/lib/email/resolveEmail";
import {
  batchFingerprint,
  decideReply,
  emailOf,
  findReplyKey,
  readApproval,
  replyAddress,
  replyKey,
  type ReplyRecord,
} from "../src/lib/email/replyApproval";

const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const ORIGIN = "https://app.exemplo";
const date = (iso: string) => ({ toDate: () => new Date(iso) });

const docs: Record<string, DocumentData> = {
  t1: {
    companyId: "c1",
    status: "pending_approval",
    approvalToken: "tok-t1",
    amount: 100,
    description: "Aluguel",
    createdBy: "u-criador",
    type: "payable",
    costCenterAllocation: [{ costCenterId: "cc1" }],
  },
  parcela: {
    companyId: "c1",
    status: "pending_approval",
    approvalToken: "tok-p",
    amount: 100,
    description: "Obra (1/3)",
    installments: { current: 1, total: 3, groupId: "g1" },
    costCenterAllocation: [{ costCenterId: "cc1" }],
  },
  outra: {
    companyId: "c2",
    status: "pending_approval",
    approvalToken: "tok-o",
    amount: 100,
    description: "De outra empresa",
    createdBy: "u-criador",
    costCenterAllocation: [],
  },
  b1: {
    companyId: "c1",
    status: "pending_approval",
    name: "Lote real",
    totalAmount: 1234.5,
    transactionIds: ["a", "b"],
    approverEmail: "Aprovador@empresa.com",
    approvalTokenHash: hash("tok-b1"),
  },
  b2: {
    companyId: "c1",
    status: "pending_authorization",
    name: "Lote aprovado",
    totalAmount: 10,
    transactionIds: ["a"],
    authorizerEmail: "autoriza@empresa.com",
    approvalTokenHash: hash("tok-b2"),
  },
  r1: {
    companyId: "c1",
    status: "pending_approval",
    rdNumber: "RD-1",
    employeeName: "Funcionário",
    employeeEmail: "func@empresa.com",
    approverEmail: "aprovador@empresa.com",
    approvalTokenHash: hash("tok-r1"),
    totalAmount: 50,
    transactionIds: ["a"],
    periodStart: date("2026-10-01T03:00:00Z"),
    periodEnd: date("2026-11-01T02:59:59Z"),
  },
  r2: {
    companyId: "c1",
    status: "approved",
    rdNumber: "RD-2",
    employeeName: "Funcionário",
    employeeEmail: "func@empresa.com",
    totalAmount: 50,
    periodStart: date("2026-10-01T03:00:00Z"),
    periodEnd: date("2026-11-01T02:59:59Z"),
  },
};

let replyEnabled = true;
let review: BatchEmailReview | null = {
  firstDueDate: "10/11/2026",
  overdueCount: 0,
  budgetExceededCount: 0,
  topItems: [{ supplier: "Fornecedor", amount: "R$ 1,00", dueDate: "10/11" }],
  alertCount: 0,
  fingerprint: "impressao",
  total: 1234.5,
  tooLarge: false,
};

const get = async (id: string) => docs[id] ?? null;
const load: EmailLoaders = {
  transaction: get,
  batch: get,
  batchReview: async () => review,
  expiryLabel: () => "08/11 às 10:00",
  replyApprovalEnabled: () => replyEnabled,
  report: get,
  installmentAmounts: async () => [100, 100, 100.1],
  companyName: async () => "Hebron - Assessoria Ltda",
  userEmail: async (uid) => (uid === "u-criador" ? "criador@empresa.com" : null),
  isGlobalAdmin: async (email) => email === "admin@fincontrol.com",
  costCenter: async () => ({
    companyId: "c1",
    approverEmail: "aprovador@empresa.com",
  }),
  users: async () => [],
};

const member: EmailCaller = {
  email: "gestor@empresa.com",
  displayName: "Gestor",
  role: "user",
  companyRoles: { c1: "financial_manager" },
};
const stranger: EmailCaller = { ...member, companyRoles: { c2: "admin" } };

const send = (body: unknown, caller = member) =>
  resolveEmail(body, caller, ORIGIN, load);
const ok = async (body: unknown, caller = member) => {
  const result = await send(body, caller);
  assert.ok(!("error" in result), `recusou: ${JSON.stringify(result)}`);
  return result as ResolvedEmail;
};
const denied = async (body: unknown, status = 403, caller = member) => {
  const result = (await send(body, caller)) as DeniedEmail;
  assert.equal(result.status, status, JSON.stringify(result));
};

const batchRequest = (over: object = {}, to = "aprovador@empresa.com") => ({
  type: "batch_approval_request",
  to: [to],
  data: { batchId: "b1", token: "tok-b1", ...over },
});

async function main() {
  // Lote: o que o navegador manda além dos IDs é ignorado
  const batch = await ok(
    batchRequest({
      link: "https://golpe.exemplo",
      batchName: "Falso",
      totalAmount: "R$ 1,00",
      companyName: "Empresa falsa",
    }),
  );
  assert.equal(batch.sender, "aprovacao");
  assert.equal(batch.props.link, `${ORIGIN}/approve-batch/tok-b1`);
  assert.equal(batch.props.batchName, "Lote real");
  assert.equal(batch.props.transactionCount, 2);
  assert.match(String(batch.props.totalAmount), /1\.234,50/);
  assert.equal(batch.props.companyName, "Hebron - Assessoria Ltda");
  assert.equal(batch.fromName, "FinControl · Hebron");
  assert.match(batch.subject, /^Aprovar: Lote real · /);

  // Lote: destinatário, token, empresa, status e formato
  await denied(batchRequest({}, "golpista@externo.com"));
  await denied(batchRequest({ token: "chutado" }));
  await denied(batchRequest(), 403, stranger);
  await denied(batchRequest({ batchId: "b2", token: "tok-b2" }));
  await denied(batchRequest({ batchId: "nao-existe" }));
  await denied({ ...batchRequest(), to: ["a@b.com", "c@d.com"] }, 400);
  await denied({ ...batchRequest(), type: "inventado" }, 400);

  const authorization = await ok({
    type: "batch_authorization_request",
    to: ["autoriza@empresa.com"],
    data: { batchId: "b2", token: "tok-b2" },
  });
  assert.equal(authorization.sender, "autorizacao");
  assert.equal(authorization.props.link, `${ORIGIN}/authorize-batch/tok-b2`);

  const added = await ok({
    type: "batch_new_transactions",
    to: ["aprovador@empresa.com"],
    data: {
      batchId: "b1",
      token: "tok-b1",
      newTransactionCount: 1,
      additionalAmount: 7.5,
    },
  });
  assert.equal(added.sender, "aprovacao");
  assert.match(String(added.props.additionalAmount), /7,50/);

  // Lançamento: token e valor vêm do documento; só o aprovador do centro recebe
  const approval = await ok({
    type: "approval_request",
    to: ["aprovador@empresa.com"],
    data: { transactionId: "t1", link: "https://golpe.exemplo" },
  });
  assert.equal(approval.props.link, `${ORIGIN}/approve/tok-t1`);
  assert.match(String(approval.props.amount), /100,00/);
  await denied({
    type: "approval_request",
    to: ["golpista@externo.com"],
    data: { transactionId: "t1" },
  });
  await denied({
    type: "approval_request",
    to: ["aprovador@empresa.com"],
    data: { transactionId: "outra" },
  });

  // Parcelamento: total sem erro de ponto flutuante
  const installments = await ok({
    type: "approval_request",
    to: ["aprovador@empresa.com"],
    data: { transactionId: "parcela" },
  });
  assert.match(String(installments.props.amount), /300,10/);

  // Quem pediu não recebe o link que aprova sem login
  await denied(
    {
      type: "approval_request",
      to: ["aprovador@empresa.com"],
      data: { transactionId: "t1" },
    },
    403,
    { ...member, email: "aprovador@empresa.com" },
  );

  // Status: só para quem criou
  const status = await ok({
    type: "status_update",
    to: ["criador@empresa.com"],
    data: { transactionId: "t1" },
  });
  assert.equal(status.sender, "notificacoes");
  assert.equal(status.props.updatedBy, "Gestor");
  await denied({
    type: "status_update",
    to: ["outro@empresa.com"],
    data: { transactionId: "t1" },
  });

  // Reembolso: período no fuso do Brasil, mesmo com o servidor em UTC
  const reimbursement = await ok({
    type: "reimbursement_approval",
    to: ["aprovador@empresa.com"],
    data: { reportId: "r1", token: "tok-r1" },
  });
  assert.equal(reimbursement.props.period, "01/10/2026 — 31/10/2026");
  assert.equal(
    reimbursement.props.rejectLink,
    `${ORIGIN}/approve-reimbursement/tok-r1?action=reject`,
  );
  await denied({
    type: "reimbursement_approval",
    to: ["aprovador@empresa.com"],
    data: { reportId: "r1", token: "chutado" },
  });

  const reimbursed = await ok({
    type: "reimbursement_approved",
    to: ["func@empresa.com"],
    data: { reportId: "r2" },
  });
  assert.equal(reimbursed.sender, "notificacoes");
  await denied({
    type: "reimbursement_approved",
    to: ["golpista@externo.com"],
    data: { reportId: "r2" },
  });
  // Ainda não aprovado: não avisa que foi
  await denied({
    type: "reimbursement_approved",
    to: ["func@empresa.com"],
    data: { reportId: "r1" },
  });

  // Feedback: texto livre só para admin, e o autor vem da sessão
  const feedback = {
    type: "feedback_notification",
    data: {
      feedbackType: "bug",
      title: "Erro",
      description: "Clique aqui",
      userName: "Falso",
      userEmail: "falso@x.com",
    },
  };
  const toAdmin = await ok({ ...feedback, to: ["admin@fincontrol.com"] });
  assert.equal(toAdmin.props.userName, "Gestor");
  assert.equal(toAdmin.props.userEmail, "gestor@empresa.com");
  assert.equal(toAdmin.props.link, `${ORIGIN}/configuracoes/feedbacks`);
  await denied({ ...feedback, to: ["golpista@externo.com"] });

  // Aprovação por resposta só é oferecida quando poderia valer ao chegar
  const offered = await ok(batchRequest());
  assert.equal(offered.props.replyable, true);
  assert.equal(offered.replyApproval?.key, replyKey("tok-b1"));
  assert.equal(offered.replyApproval?.fingerprint, "impressao");
  assert.equal(offered.replyApproval?.senderEmail, "gestor@empresa.com");
  assert.equal(offered.props.firstDueDate, "10/11/2026");
  const notOffered = async () => {
    const email = await ok(batchRequest());
    assert.equal(email.replyApproval, undefined);
    assert.equal(email.props.replyable, false);
  };
  replyEnabled = false;
  await notOffered();
  replyEnabled = true;
  const good = review!;
  review = { ...good, alertCount: 1 };
  await notOffered();
  review = { ...good, total: 1 };
  await notOffered();
  review = null;
  await notOffered();
  assert.equal((await ok(batchRequest())).props.link, `${ORIGIN}/approve-batch/tok-b1`);
  review = good;

  // Frases
  for (const text of [
    "Aprovado",
    "aprovo",
    "De acordo.",
    "Ciente e de acordo",
    "CIENTE E DE ACORDO!",
    "  ciente e de acordo  \r\n",
    "Ciente e de acordo\n\nAtt,\nFulano de Tal\nDiretor\n\nEnviado do meu iPhone",
    "De acordo\n\nEm qui., 6 de nov. de 2026 às 10:00, FinControl\n<aprovacao@fincontrol.ia.br> escreveu:\n> não aprove sem revisar",
    "Aprovado\n\nOn Thu, Nov 6, 2026 at 10:00 AM FinControl wrote:\n> nao",
    "Aprovado\r\n\r\nDe: FinControl <aprovacao@fincontrol.ia.br>\r\nNão responda",
    "Aprovado\n> menos o item 3",
  ]) {
    assert.equal(readApproval(text).approved, true, text);
  }
  for (const text of [
    "Ciente",
    "ciente.",
    "ok",
    "Aprovado?",
    "De acordo?",
    "Não aprovado",
    "Não aprovo",
    "aprovado parcialmente",
    "Aprovado, menos o item 3",
    "Aprovado\nmenos o item 3",
    "Aprovado\nMas segure o pagamento da Fulana",
    "De acordo\nsomente o primeiro",
    "Aprovado\nNão imprima este e-mail",
    "Vou ver e aprovado depois",
    "",
    "> aprovado",
    null,
  ]) {
    assert.equal(readApproval(text).approved, false, String(text));
  }

  // Endereço
  const key = replyKey("tok");
  assert.notEqual(key, replyKey("outro"));
  assert.ok(!key.includes("tok"));
  const address = replyAddress(key, "fincontrol.ia.br");
  assert.equal(findReplyKey(["a@b.com", null, `Lote <${address.toUpperCase()}>`]), key);
  assert.equal(findReplyKey(["lote-curto@x.com", "aprovacao@x.com"]), null);
  assert.equal(emailOf('"Diretor, Fulano" <Dir@Hebron.com>'), "dir@hebron.com");
  assert.equal(
    batchFingerprint([{ id: "a", amount: 1 }, { id: "b", amount: 2 }]),
    batchFingerprint([{ id: "b", amount: 2 }, { id: "a", amount: 1 }]),
  );
  assert.notEqual(
    batchFingerprint([{ id: "a", amount: 1 }]),
    batchFingerprint([{ id: "a", amount: 2 }]),
  );

  // Decisão
  const record: ReplyRecord = {
    batchId: "b",
    companyId: "c1",
    tokenHash: "h",
    approverEmail: "dir@hebron.com",
    senderEmail: "gestor@hebron.com",
    fingerprint: "f",
  };
  const reply = {
    record,
    from: "Diretor <DIR@hebron.com>",
    dmarc: "pass",
    headers: {},
    text: "Ciente e de acordo",
    now: 1000,
    batch: {
      status: "pending_approval",
      companyId: "c1",
      approverEmail: "dir@hebron.com",
      approvalTokenHash: "h",
      expiresAtMillis: 2000,
    },
    review: { fingerprint: "f", alertCount: 0, tooLarge: false },
  };
  assert.deepEqual(decideReply(reply), {
    kind: "approve",
    phrase: "Ciente e de acordo",
  });
  const refused = (over: object, tellApprover = true) => {
    const decision = decideReply({ ...reply, ...over });
    assert.equal(decision.kind, "refuse", JSON.stringify(over));
    assert.equal(
      decision.kind === "refuse" && decision.tellApprover,
      tellApprover,
      JSON.stringify(over),
    );
  };
  // Identidade não confirmada: não responde ao endereço possivelmente forjado
  refused({ from: "golpista@externo.com" }, false);
  refused({ dmarc: "fail" }, false);
  refused({ dmarc: undefined }, false);
  refused({ dmarc: "unknown" }, false);
  // Estado do lote
  refused({ batch: null });
  refused({ batch: { ...reply.batch, status: "approved" } });
  refused({ batch: { ...reply.batch, companyId: "c2" } });
  refused({ batch: { ...reply.batch, approvalTokenHash: "reenviado" } });
  refused({ batch: { ...reply.batch, approvalTokenHash: null } });
  refused({ batch: { ...reply.batch, approverEmail: "outro@hebron.com" } });
  refused({ now: 3000 });
  // Quem enviou não aprova o próprio lote
  refused({
    record: { ...record, senderEmail: "dir@hebron.com" },
  });
  // Conteúdo e situação do lote na chegada da resposta
  refused({ text: "Ciente" });
  refused({ review: null });
  refused({ review: { ...reply.review, fingerprint: "mudou" } });
  refused({ review: { ...reply.review, alertCount: 2 } });
  refused({ review: { ...reply.review, tooLarge: true } });
  // Resposta automática não decide nem gera resposta
  const automatic: Record<string, string>[] = [
    { "Auto-Submitted": "auto-replied" },
    { Precedence: "auto_reply" },
    { "X-Autoreply": "yes" },
  ];
  for (const headers of automatic) {
    assert.equal(decideReply({ ...reply, headers }).kind, "ignore");
  }
  assert.equal(
    decideReply({ ...reply, headers: { "Auto-Submitted": "no" } }).kind,
    "approve",
  );

  console.log("check-email-request: ok");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
