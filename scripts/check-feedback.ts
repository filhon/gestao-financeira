/**
 * Verificação das regras dos chamados.
 *   npm run check:feedback
 * Falha com exceção na primeira regra quebrada.
 */
import assert from "node:assert/strict";
import {
  browserLabel,
  compareQueue,
  createFeedbackSchema,
  deriveTitle,
  feedbackPriority,
  feedbackStatusLabel,
  inQueueTab,
  isOverdue,
  isOwnScreenshotUrl,
  protocolOf,
  responseDueAt,
  statusAfterUserReply,
  timelineOf,
} from "../src/lib/feedback";
import { suggestFromManual } from "../src/lib/playbook";
import type { Feedback } from "../src/lib/types";

const base = {
  id: "a",
  userId: "u",
  userEmail: "u@x.com",
  userName: "U",
  type: "bug",
  priority: "medium",
  title: "t",
  description: "d",
  status: "pending",
  read: true,
  createdAt: new Date("2026-11-02T10:00:00Z"),
  updatedAt: new Date("2026-11-02T10:00:00Z"),
} as Feedback;
const ticket = (over: Partial<Feedback>): Feedback => ({ ...base, ...over });

// Protocolo e assunto
assert.equal(protocolOf(2026, 12), "CH-2026-0012");
assert.equal(deriveTitle("\n  Erro ao pagar  \nsegunda"), "Erro ao pagar");
const long = deriveTitle("palavra ".repeat(30));
assert.ok(long.length <= 80 && long.endsWith("…"));

// Prazo: sexta + 1 dia útil cai na segunda; elogio não tem prazo
const friday = new Date(2026, 10, 6, 12);
assert.equal(responseDueAt(friday, "bug", true)?.getDate(), 9);
assert.equal(responseDueAt(friday, "bug", false)?.getDate(), 10);
assert.equal(responseDueAt(friday, "praise", false), null);

// Prioridade
assert.equal(
  feedbackPriority({ type: "bug", blocksPayment: true, hasError: false }),
  "critical",
);
assert.equal(
  feedbackPriority({ type: "bug", blocksPayment: false, hasError: true }),
  "high",
);
assert.equal(
  feedbackPriority({ type: "praise", blocksPayment: true, hasError: true }),
  "low",
);

// Resposta de quem abriu reabre e nunca rebaixa a fila
assert.equal(statusAfterUserReply("pending"), "pending");
assert.equal(statusAfterUserReply("waiting_user"), "in_review");
assert.equal(statusAfterUserReply("resolved"), "in_review");
assert.equal(statusAfterUserReply("wont_fix"), "in_review");

// Prazo só conta enquanto a equipe é quem deve
const now = new Date("2026-11-10T00:00:00Z");
const late = new Date("2026-11-09T00:00:00Z");
assert.equal(isOverdue({ status: "pending", dueAt: late }, now), true);
assert.equal(isOverdue({ status: "waiting_user", dueAt: late }, now), false);
assert.equal(isOverdue({ status: "resolved", dueAt: late }, now), false);

// Anexo: só o caminho da própria pessoa, no Storage do sistema
const bucket =
  "https://firebasestorage.googleapis.com/v0/b/app.firebasestorage.app/o/feedbacks%2Fuid1%2Fa.png?alt=media";
assert.equal(isOwnScreenshotUrl(bucket, "uid1"), true);
assert.equal(isOwnScreenshotUrl(bucket, "uid2"), false);
assert.equal(
  isOwnScreenshotUrl("https://evil.com/o/feedbacks%2Fuid1%2Fa", "uid1"),
  false,
);
assert.equal(isOwnScreenshotUrl("javascript:alert(1)", "uid1"), false);

// Fila: repetido sai, volta se a pessoa escreve; urgente vem antes do prazo
const merged = ticket({ mergedInto: "b", read: true, status: "in_review" });
assert.equal(inQueueTab(merged, "open"), false);
assert.equal(inQueueTab(merged, "closed"), true);
assert.equal(inQueueTab({ ...merged, read: false }, "open"), true);
assert.equal(inQueueTab(ticket({ status: "waiting_user" }), "waiting"), true);
const urgent = ticket({ id: "u", blocksPayment: true, dueAt: now });
const soon = ticket({ id: "s", dueAt: late });
assert.deepEqual(
  [soon, urgent].sort(compareQueue).map((t) => t.id),
  ["u", "s"],
);

// Rótulo muda para quem precisa agir; resposta antiga entra na conversa
assert.equal(feedbackStatusLabel("waiting_user", "user"), "Aguardando você");
assert.equal(feedbackStatusLabel("waiting_user", "team"), "Aguardando usuário");
const legacy = timelineOf(ticket({ adminResponse: "Oi", respondedAt: now }));
assert.equal(legacy[0].text, "Oi");
assert.equal(legacy[0].from, "team");

// Navegador sem identificar a pessoa
assert.equal(
  browserLabel(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
  ),
  "Chrome 130 no Windows",
);

// Entrada: ideia não vira chamado; URL de contexto não pode ser javascript:
const valid = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  type: "bug",
  description: "Não consigo pagar o boleto",
  blocksPayment: false,
  companyId: "c1",
  context: {
    screen: "Comprovantes",
    url: "/financeiro/comprovantes",
    browser: "Chrome",
    viewport: "1x1",
    errors: [],
  },
};
assert.equal(createFeedbackSchema.safeParse(valid).success, true);
assert.equal(
  createFeedbackSchema.safeParse({ ...valid, type: "improvement" }).success,
  false,
);
assert.equal(
  createFeedbackSchema.safeParse({ ...valid, description: "curto" }).success,
  false,
);
assert.equal(
  createFeedbackSchema.safeParse({
    ...valid,
    context: { ...valid.context, url: "javascript:alert(1)" },
  }).success,
  false,
);

// Manual: sugere pelo assunto, sem mandar abrir chamado a quem já está abrindo
const hits = suggestFromManual("não consigo excluir um fornecedor da lista");
assert.ok(hits.some((h) => h.q === "Não consigo excluir um fornecedor."));
assert.ok(hits.every((h) => h.href.startsWith("/manual#")));
assert.deepEqual(suggestFromManual("erro"), []);
assert.equal(
  suggestFromManual("encontrei um erro no sistema").some((h) =>
    h.a.includes("Falar com a equipe"),
  ),
  false,
);

console.log("check:feedback ok");
