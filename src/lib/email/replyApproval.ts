import { createHash } from "node:crypto";

/**
 * Aprovação de lote por resposta ao e-mail. Só aprova o caso inequívoco: o resto
 * não aprova e vai para quem enviou o lote. Sem IA: decisão sobre pagamento não
 * depende de interpretação.
 */
export const APPROVAL_PHRASES = [
  "aprovado",
  "aprovo",
  "de acordo",
  "ciente e de acordo",
];

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

/** Derivada do token do envio: reenviar o lote gera outro endereço e invalida o antigo. */
export const replyKey = (token: string) =>
  sha256(`reply:${token}`).slice(0, 32);

export const replyAddress = (key: string, domain: string) =>
  `lote-${key}@${domain}`;

export const emailOf = (address: string) =>
  (address.match(/<([^>]+)>/)?.[1] ?? address).trim().toLowerCase();

export function findReplyKey(addresses: (string | null | undefined)[]) {
  for (const address of addresses) {
    const key = address && emailOf(address).match(/^lote-([a-f0-9]{32})@/)?.[1];
    if (key) return key;
  }
  return null;
}

/** O que foi mostrado no e-mail: troca de item ou de valor exige o link. */
export const batchFingerprint = (items: { id: string; amount: number }[]) =>
  sha256(
    items
      .map((i) => `${i.id}:${i.amount}`)
      .sort()
      .join("|"),
  );

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const QUOTE_START =
  /^\s*>|^\s*(em|on)\s.*\b20\d{2}\b|(escreveu|wrote)\s*:\s*$|^\s*-{2,}\s*(mensagem|original|forwarded|encaminhada)|^\s*_{5,}|^\s*(de|from):\s/i;

/** Só o que a pessoa escreveu, sem o e-mail citado abaixo. */
function writtenLines(text: string) {
  const lines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (QUOTE_START.test(line)) break;
    if (line.trim()) lines.push(line.trim());
  }
  return lines;
}

/** Assinatura passa; ressalva não. Se um rodapé usar essas palavras, a resposta só não aprova. */
const CAVEAT =
  /\b(exceto|menos|salvo|mas|porem|retir\w*|remov\w*|nao|aguard\w*|segur\w*|reprov\w*|rejeit\w*|recus\w*|pendent\w*|duvida\w*|cancel\w*|corrig\w*|desde que|somente|apenas|sem)\b/;

export function readApproval(
  text: string | null | undefined,
): { approved: true; phrase: string } | { approved: false; reason: string } {
  const [first, ...rest] = writtenLines(text ?? "");
  if (!first) return { approved: false, reason: "a resposta veio sem texto" };
  if (first.includes("?") || !APPROVAL_PHRASES.includes(normalize(first))) {
    return {
      approved: false,
      reason: "a primeira linha não é uma das frases aceitas",
    };
  }
  if (CAVEAT.test(normalize(rest.join(" ")))) {
    return { approved: false, reason: "a resposta traz uma possível ressalva" };
  }
  return { approved: true, phrase: first };
}

export type ReplyRecord = {
  batchId: string;
  companyId: string;
  tokenHash: string;
  approverEmail: string;
  senderEmail: string;
  fingerprint: string;
};

export type ReplyDecision =
  | { kind: "ignore" }
  | { kind: "approve"; phrase: string }
  /** `tellApprover` só com identidade confirmada: não responder a remetente forjado. */
  | { kind: "refuse"; reason: string; tellApprover: boolean };

export function decideReply(input: {
  record: ReplyRecord;
  from: string;
  dmarc: unknown;
  headers?: Record<string, string> | null;
  text: string | null | undefined;
  batch: {
    status?: unknown;
    companyId?: unknown;
    approverEmail?: unknown;
    approvalTokenHash?: unknown;
    expiresAtMillis?: number;
  } | null;
  now: number;
  review: {
    fingerprint: string;
    alertCount: number;
    tooLarge: boolean;
  } | null;
}): ReplyDecision {
  const { record, batch, review } = input;

  // Resposta automática (férias, ausência) não é decisão e não recebe resposta.
  const headers = Object.fromEntries(
    Object.entries(input.headers ?? {}).map(([k, v]) => [
      k.toLowerCase(),
      String(v).toLowerCase(),
    ]),
  );
  if (
    (headers["auto-submitted"] && headers["auto-submitted"] !== "no") ||
    ["auto_reply", "bulk", "junk"].includes(headers["precedence"]) ||
    headers["x-autoreply"] ||
    headers["x-autorespond"]
  ) {
    return { kind: "ignore" };
  }

  if (
    emailOf(input.from) !== record.approverEmail.trim().toLowerCase() ||
    input.dmarc !== "pass"
  ) {
    return {
      kind: "refuse",
      reason: "não foi possível confirmar que a resposta veio do aprovador",
      tellApprover: false,
    };
  }

  const refuse = (reason: string): ReplyDecision => ({
    kind: "refuse",
    reason,
    tellApprover: true,
  });

  if (
    !batch ||
    batch.companyId !== record.companyId ||
    batch.status !== "pending_approval" ||
    batch.approvalTokenHash !== record.tokenHash ||
    typeof batch.approverEmail !== "string" ||
    emailOf(batch.approverEmail) !== emailOf(record.approverEmail)
  ) {
    return refuse("este envio do lote não está mais aguardando aprovação");
  }
  if (
    batch.expiresAtMillis !== undefined &&
    batch.expiresAtMillis < input.now
  ) {
    return refuse("o prazo deste envio terminou");
  }
  if (emailOf(record.senderEmail) === emailOf(record.approverEmail)) {
    return refuse("quem envia o lote não pode aprová-lo");
  }

  const reading = readApproval(input.text);
  if (!reading.approved) return refuse(reading.reason);

  if (!review || review.tooLarge) {
    return refuse("este lote precisa ser aprovado pela página");
  }
  if (review.fingerprint !== record.fingerprint) {
    return refuse("o lote mudou depois do envio do e-mail");
  }
  if (review.alertCount > 0) {
    return refuse("o lote tem alertas que precisam ser vistos na página");
  }
  return { kind: "approve", phrase: reading.phrase };
}
