/**
 * Fechamento do mês: a fotografia do fluxo de caixa que foi para a
 * contabilidade e o que mudou no sistema depois dela.
 *
 * Sem Firebase de propósito: a tela, a rota e `npm run check:reports` usam as
 * mesmas regras.
 */
import currency from "currency.js";
import { format } from "date-fns";
import { z } from "zod";
import type { Entity, Transaction } from "@/lib/types";
// Relativo: o script de verificação roda fora do Next, sem o alias "@/".
import type { BankProof, CashSynthesis } from "./cashSynthesis";
import type { CashFlowReport } from "./reports";

/** Quanto tempo o link da contabilidade funciona. */
export const LINK_DAYS = 30;
export const MAX_RECIPIENTS = 10;
/** Fechar sem conferir com o banco exige dizer por quê. */
export const MIN_REASON = 10;
// ponytail: a fotografia mora num documento só (teto de 1 MiB do Firestore);
// acima disso, mover as linhas para uma subcoleção.
export const MAX_LINES = 3000;

// ─── A fotografia ─────────────────────────────────────────────────────────────

const text = (max: number) => z.string().max(max);
const money = z.number().finite();

const lineSchema = z.object({
  id: text(128).min(1),
  type: z.enum(["receivable", "payable"]),
  /** Data da baixa, yyyy-MM-dd. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: money.nonnegative(),
  description: text(300),
  party: text(200),
  costCenters: text(400),
  accountId: text(128),
  note: z.boolean(),
  receipt: z.boolean(),
});

export const snapshotSchema = z.object({
  opening: money,
  inflow: money.nonnegative(),
  outflow: money.nonnegative(),
  closing: money,
  lines: z.array(lineSchema).max(MAX_LINES),
  gaps: z
    .array(
      z.object({
        label: text(80),
        count: z.number().int().nonnegative(),
        value: money,
      }),
    )
    .max(10),
  /** Documentos que existem no sistema e não entraram no pacote. */
  missingDocuments: z.number().int().nonnegative(),
});

export type ClosingLine = z.infer<typeof lineSchema>;
export type ClosingSnapshot = z.infer<typeof snapshotSchema>;

export const closeSchema = z.object({
  action: z.literal("close"),
  companyId: text(128).min(1),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  snapshot: snapshotSchema,
  /** Pasta onde o navegador guardou os dois arquivos. */
  uploadKey: z.uuid(),
  reason: text(500).optional(),
});

export const sendSchema = z.object({
  action: z.literal("send"),
  companyId: text(128).min(1),
  closingId: text(200).min(1),
  emails: z.array(z.email()).min(1).max(MAX_RECIPIENTS),
  message: text(600).optional(),
});

export const revokeSchema = z.object({
  action: z.literal("revoke"),
  companyId: text(128).min(1),
  linkId: z.string().regex(/^[0-9a-f]{64}$/),
});

export const requestSchema = z.discriminatedUnion("action", [
  closeSchema,
  sendSchema,
  revokeSchema,
]);

export type ClosingFile = "package" | "summary";
export const CLOSING_FILES: Record<
  ClosingFile,
  { name: string; contentType: string }
> = {
  package: { name: "pacote.zip", contentType: "application/zip" },
  summary: { name: "sintese.pdf", contentType: "application/pdf" },
};

export interface StoredFile {
  path: string;
  size: number;
  /** SHA-256 do arquivo guardado, calculado no servidor. */
  sha256: string;
}

export interface CashClosing extends ClosingSnapshot {
  id: string;
  companyId: string;
  period: string;
  version: number;
  status: "active" | "superseded";
  /** Conferência com o banco refeita no servidor ao fechar. */
  proof: {
    status: BankProof["status"];
    total: number | null;
    difference: number | null;
    rows: { name: string; balance: number | null; date: string | null }[];
  };
  reason?: string;
  files: Record<ClosingFile, StoredFile>;
  closedBy: { uid: string; name: string; email: string };
  closedAt: Date;
}

export interface ClosingLink {
  id: string;
  closingId: string;
  version: number;
  email: string;
  createdBy: { uid: string; name: string };
  createdAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  /** O e-mail não saiu: o link existe, mas ninguém o recebeu. */
  sendError?: string;
  views: number;
  downloads: number;
  lastAccessAt?: Date;
}

export interface ClosingAccess {
  id: string;
  kind: "view" | ClosingFile;
  at: Date;
  ip: string;
  userAgent: string;
}

const clip = (s: string, max: number) => s.slice(0, max);

/** As linhas como ficaram: o que a contabilidade confere por lançamento. */
export function closingLines(
  report: CashFlowReport,
  o: { entities: Entity[]; hasReceipt: (t: Transaction) => boolean },
): ClosingLine[] {
  const nameById = new Map(o.entities.map((e) => [e.id, e.name]));
  return report.lines
    .filter((l) => l.stage === "realized")
    .map(({ tx, date, amount }) => ({
      id: tx.id,
      type: tx.type,
      date: format(date, "yyyy-MM-dd"),
      amount,
      description: clip(tx.description ?? "", 300),
      party: clip(
        nameById.get(tx.entityId ?? "") || tx.supplierOrClient || "",
        200,
      ),
      costCenters: clip(
        tx.costCenterAllocation?.length
          ? tx.costCenterAllocation
              .map((a) => `${a.costCenterId}:${a.percentage}`)
              .sort()
              .join(",")
          : (tx.costCenterId ?? ""),
        400,
      ),
      accountId: tx.accountId ?? "",
      note: (tx.attachments ?? []).some((a) => !!a.url),
      receipt: o.hasReceipt(tx),
    }));
}

export function closingSnapshot(
  report: CashFlowReport,
  synthesis: Pick<CashSynthesis, "gaps">,
  lines: ClosingLine[],
  missingDocuments: number,
): ClosingSnapshot {
  return {
    opening: report.opening,
    inflow: report.inflow,
    outflow: report.outflow,
    closing: report.closing,
    lines,
    gaps: synthesis.gaps.map((g) => ({
      label: g.label,
      count: g.lines.length,
      value: g.value,
    })),
    missingDocuments,
  };
}

const sumOf = (lines: ClosingLine[], type: ClosingLine["type"]) =>
  lines
    .filter((l) => l.type === type)
    .reduce((s, l) => s.add(l.amount), currency(0)).value;

/**
 * A fotografia precisa fechar sozinha: totais iguais à soma das linhas, linhas
 * dentro do mês e inicial + entradas − saídas = final. Devolve o que não bate.
 */
export function snapshotProblem(
  s: ClosingSnapshot,
  period: string,
): string | null {
  if (s.lines.some((l) => !l.date.startsWith(`${period}-`)))
    return "Há lançamentos de outro mês no fechamento.";
  if (new Set(s.lines.map((l) => l.id)).size !== s.lines.length)
    return "Há lançamentos repetidos no fechamento.";
  if (sumOf(s.lines, "receivable") !== s.inflow)
    return "As entradas não batem com os lançamentos.";
  if (sumOf(s.lines, "payable") !== s.outflow)
    return "As saídas não batem com os lançamentos.";
  if (currency(s.opening).add(s.inflow).subtract(s.outflow).value !== s.closing)
    return "O saldo final não bate com o inicial mais o movimento.";
  return null;
}

/** Só mês que já terminou fecha. `today` é yyyy-MM-dd em São Paulo. */
export const canClosePeriod = (period: string, today: string) =>
  period < today.slice(0, 7);

// ─── O que mudou depois ───────────────────────────────────────────────────────

export interface ClosingChange {
  kind: "added" | "removed" | "changed";
  id: string;
  type: ClosingLine["type"];
  description: string;
  party: string;
  before?: ClosingLine;
  after?: ClosingLine;
  /** Campos que mudaram, em palavras. */
  fields: string[];
  /** Muda dinheiro ou data, não só o cadastro. */
  financial: boolean;
}

export interface ClosingDiff {
  changes: ClosingChange[];
  financial: number;
  openingBefore: number;
  openingAfter: number;
  /** Saldo final de agora menos o fechado. */
  balance: number;
}

const FIELDS: {
  key: keyof ClosingLine;
  label: string;
  financial?: boolean;
}[] = [
  { key: "amount", label: "valor", financial: true },
  { key: "date", label: "data da baixa", financial: true },
  { key: "type", label: "tipo", financial: true },
  { key: "party", label: "favorecido" },
  { key: "description", label: "descrição" },
  { key: "costCenters", label: "centro de custo" },
  { key: "accountId", label: "conta contábil" },
  { key: "note", label: "nota fiscal" },
  { key: "receipt", label: "comprovante" },
];

export function closingDiff(
  closed: Pick<CashClosing, "lines" | "opening" | "closing">,
  now: { lines: ClosingLine[]; opening: number; closing: number },
): ClosingDiff {
  const before = new Map(closed.lines.map((l) => [l.id, l]));
  const after = new Map(now.lines.map((l) => [l.id, l]));
  const base = (l: ClosingLine) => ({
    id: l.id,
    type: l.type,
    description: l.description,
    party: l.party,
  });
  const changes: ClosingChange[] = [];

  for (const l of now.lines) {
    const was = before.get(l.id);
    if (!was) {
      changes.push({
        ...base(l),
        kind: "added",
        after: l,
        fields: [],
        financial: true,
      });
      continue;
    }
    const fields = FIELDS.filter((f) => was[f.key] !== l[f.key]);
    if (fields.length === 0) continue;
    changes.push({
      ...base(l),
      kind: "changed",
      before: was,
      after: l,
      fields: fields.map((f) => f.label),
      financial: fields.some((f) => f.financial),
    });
  }
  for (const l of closed.lines) {
    if (after.has(l.id)) continue;
    changes.push({
      ...base(l),
      kind: "removed",
      before: l,
      fields: [],
      financial: true,
    });
  }

  return {
    // Dinheiro antes de cadastro; dentro disso, o maior valor primeiro.
    changes: changes.sort(
      (a, b) =>
        Number(b.financial) - Number(a.financial) ||
        (b.after ?? b.before)!.amount - (a.after ?? a.before)!.amount,
    ),
    financial: changes.filter((c) => c.financial).length,
    openingBefore: closed.opening,
    openingAfter: now.opening,
    balance: currency(now.closing).subtract(closed.closing).value,
  };
}

export const hasChanges = (d: ClosingDiff) =>
  d.changes.length > 0 || d.openingBefore !== d.openingAfter;

// ─── Links ────────────────────────────────────────────────────────────────────

export type LinkState = "active" | "expired" | "revoked" | "failed";

export function linkState(
  link: Pick<ClosingLink, "expiresAt" | "revokedAt" | "sendError">,
  now: Date,
): LinkState {
  if (link.revokedAt) return "revoked";
  if (link.expiresAt <= now) return "expired";
  return link.sendError ? "failed" : "active";
}

/** Separa e-mails colados com vírgula, ponto e vírgula, espaço ou linha. */
export function parseEmails(value: string) {
  const parts = [
    ...new Set(
      value
        .split(/[\s,;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const ok = (s: string) => z.email().safeParse(s).success;
  return {
    emails: parts.filter(ok),
    invalid: parts.filter((s) => !ok(s)),
  };
}
