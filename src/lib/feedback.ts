import { addBusinessDays } from "date-fns";
import { z } from "zod";
import type {
  Feedback,
  FeedbackEvent,
  FeedbackPriority,
  FeedbackStatus,
  FeedbackType,
  SystemFeature,
} from "@/lib/types";

/**
 * Regras dos chamados, sem Firebase: a tela e a rota usam as mesmas.
 *   npm run check:feedback
 */

export const FEEDBACK_TYPE_LABEL: Record<FeedbackType, string> = {
  bug: "Problema",
  improvement: "Sugestão",
  question: "Dúvida",
  praise: "Elogio",
};

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  pending: "Na fila",
  in_review: "Em análise",
  waiting_user: "Aguardando usuário",
  resolved: "Resolvido",
  wont_fix: "Não será feito",
};

export const FEEDBACK_STATUSES = Object.keys(STATUS_LABEL) as FeedbackStatus[];

/** Para quem abriu o chamado, "aguardando usuário" é um pedido direto. */
export const feedbackStatusLabel = (
  status: FeedbackStatus,
  viewer: "user" | "team",
) =>
  viewer === "user" && status === "waiting_user"
    ? "Aguardando você"
    : STATUS_LABEL[status];

export const FEEDBACK_STATUS_CLASS: Record<FeedbackStatus, string> = {
  pending: "bg-muted text-foreground",
  in_review: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  waiting_user:
    "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  resolved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  wont_fix: "bg-muted text-muted-foreground",
};

/** Só para chamados antigos, que perguntavam a função relacionada. */
export const LEGACY_FEATURE_LABEL: Record<SystemFeature, string> = {
  dashboard: "Início",
  contas_pagar: "Contas a Pagar",
  contas_receber: "Contas a Receber",
  centros_custo: "Centros de Custo",
  recorrencias: "Recorrências",
  lotes: "Lotes de Pagamento",
  relatorios: "Relatórios",
  configuracoes: "Configurações",
  cadastros: "Cadastros",
  outro: "Outro",
};

/** Meta de primeira resposta, em dias úteis. É a promessa mostrada ao usuário. */
export const RESPONSE_BUSINESS_DAYS = { urgent: 1, normal: 2 };

// ponytail: conta só fim de semana; feriado entra quando houver calendário no servidor.
export function responseDueAt(
  now: Date,
  type: FeedbackType,
  blocksPayment: boolean,
): Date | null {
  if (type === "praise") return null;
  return addBusinessDays(
    now,
    blocksPayment
      ? RESPONSE_BUSINESS_DAYS.urgent
      : RESPONSE_BUSINESS_DAYS.normal,
  );
}

export function feedbackPriority(input: {
  type: FeedbackType;
  blocksPayment: boolean;
  hasError: boolean;
}): FeedbackPriority {
  if (input.type === "praise") return "low";
  if (input.blocksPayment) return "critical";
  return input.hasError ? "high" : "medium";
}

export const protocolOf = (year: number, sequence: number) =>
  `CH-${year}-${String(sequence).padStart(4, "0")}`;

/** O assunto é a primeira linha do relato: ninguém precisa escrever duas vezes. */
export function deriveTitle(description: string, max = 80): string {
  const line =
    description
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > 20 ? cut.slice(0, lastSpace) : cut}…`;
}

/** Espera a equipe: é o que conta para fila e prazo. */
export const waitsForTeam = (status: FeedbackStatus) =>
  status === "pending" || status === "in_review";

export const isClosed = (status: FeedbackStatus) =>
  status === "resolved" || status === "wont_fix";

/** Resposta de quem abriu: tira da espera e reabre o que estava encerrado. */
export const statusAfterUserReply = (status: FeedbackStatus): FeedbackStatus =>
  status === "pending" ? "pending" : "in_review";

export const isOverdue = (f: Pick<Feedback, "status" | "dueAt">, now: Date) =>
  waitsForTeam(f.status) && !!f.dueAt && f.dueAt.getTime() < now.getTime();

/** Só anexo enviado pela própria pessoa, para o bucket do sistema. */
export function isOwnScreenshotUrl(url: string, uid: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "firebasestorage.googleapis.com" &&
      parsed.pathname.includes(`/o/feedbacks%2F${encodeURIComponent(uid)}%2F`)
    );
  } catch {
    return false;
  }
}

/**
 * Chamados antigos guardam uma única resposta em `adminResponse`. Ela entra na
 * conversa como a primeira mensagem da equipe.
 */
export function timelineOf(f: Feedback): FeedbackEvent[] {
  const legacy: FeedbackEvent[] = f.adminResponse
    ? [
        {
          id: "legacy-response",
          kind: "message",
          from: "team",
          authorName: "Equipe FinControl",
          text: f.adminResponse,
          at: f.respondedAt ?? f.updatedAt,
        },
      ]
    : [];
  return [...legacy, ...(f.events ?? [])].sort(
    (a, b) => a.at.getTime() - b.at.getTime(),
  );
}

export type QueueTab = "open" | "waiting" | "closed" | "all";

/** Repetido unido a outro sai da fila, e volta se a pessoa escrever de novo. */
const hiddenByMerge = (f: Feedback) => !!f.mergedInto && f.read;

export function inQueueTab(f: Feedback, tab: QueueTab): boolean {
  if (tab === "all") return true;
  if (tab === "closed") return hiddenByMerge(f) || isClosed(f.status);
  if (hiddenByMerge(f)) return false;
  return tab === "open" ? waitsForTeam(f.status) : f.status === "waiting_user";
}

/** Pagamento em risco primeiro; depois quem está mais perto de estourar o prazo. */
export function compareQueue(a: Feedback, b: Feedback): number {
  const urgent = Number(!!b.blocksPayment) - Number(!!a.blocksPayment);
  if (urgent) return urgent;
  const due =
    (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity);
  if (due) return due;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/** "Chrome 130 no Windows": o suficiente para reproduzir, sem identificar ninguém. */
export function browserLabel(userAgent: string): string {
  const match =
    /Edg\/(\d+)/.exec(userAgent) ??
    /Firefox\/(\d+)/.exec(userAgent) ??
    /Chrome\/(\d+)/.exec(userAgent) ??
    /Version\/(\d+).*Safari/.exec(userAgent);
  const name = !match
    ? "Navegador desconhecido"
    : match[0].startsWith("Edg")
      ? "Edge"
      : match[0].startsWith("Firefox")
        ? "Firefox"
        : match[0].startsWith("Chrome")
          ? "Chrome"
          : "Safari";
  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone|iPad/.test(userAgent)
        ? "iOS"
        : /Mac OS/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;
  return `${name}${match ? ` ${match[1]}` : ""}${os ? ` no ${os}` : ""}`;
}

export const FEEDBACK_TEXT_MIN = 10;
export const FEEDBACK_TEXT_MAX = 5000;

export const feedbackText = z
  .string()
  .trim()
  .min(FEEDBACK_TEXT_MIN, `Escreva pelo menos ${FEEDBACK_TEXT_MIN} caracteres.`)
  .max(FEEDBACK_TEXT_MAX, `Escreva no máximo ${FEEDBACK_TEXT_MAX} caracteres.`);

const shortText = (max: number) => z.string().trim().max(max);

export const feedbackContextSchema = z.object({
  screen: shortText(100),
  url: shortText(500).regex(/^\//),
  browser: shortText(100),
  viewport: shortText(20),
  errors: z
    .array(z.object({ message: shortText(300), at: shortText(40) }))
    .max(5),
});

/** Ideia não entra aqui: ela vai para o Roadmap, onde outras empresas votam. */
export const createFeedbackSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{20,40}$/),
  type: z.enum(["bug", "question", "praise"]),
  description: feedbackText,
  blocksPayment: z.boolean(),
  companyId: shortText(128),
  context: feedbackContextSchema,
  screenshotUrl: shortText(2000).optional(),
});

export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;
