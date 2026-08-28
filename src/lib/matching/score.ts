/**
 * Motor de pontuação comprovante ↔ transação.
 *
 * Modelo: quatro famílias de evidência (valor, data, contraparte, descrição)
 * combinadas por peso, com três mecanismos que o scorer antigo não tinha e que
 * são a razão de ele errar:
 *
 *   1. **Evidência de identidade** — CNPJ/CPF do beneficiário, chave Pix e
 *      linha digitável do boleto. São determinísticas: quando batem, o match é
 *      praticamente certo; quando divergem, é praticamente certo que está errado.
 *   2. **Penalidade por conflito** — divergência de documento ou transação já
 *      conciliada derrubam o score em vez de serem simplesmente ignoradas.
 *   3. **Consciência de ambiguidade** — se o segundo colocado tem evidência
 *      equivalente, a sugestão é rebaixada em vez de escolher no desempate
 *      arbitrário da ordenação. É o que faz "Alta confiança" significar algo.
 */

import currency from "currency.js";
import type {
  ComprovanteConfidenceLevel,
  Entity,
  Transaction,
} from "@/lib/types";
import {
  civilDay,
  cnpjRoot,
  cpfMatchesMask,
  dayDiff,
  normalizePixKey,
  toBarcode,
} from "./brazilian";
import type { ReceiptFacts } from "./receipt";
import {
  buildTokenIndex,
  createTokenWeights,
  diceCoefficient,
  digitsOnly,
  initialsOf,
  jaroWinkler,
  normalize,
  significantTokens,
  tokenPresence,
  weightedCoverage,
  type TokenWeights,
} from "./text";

// ── Tipos públicos ────────────────────────────────────────────────────────────

export type EntityEvidence =
  | "barcode"
  | "document"
  | "document_root"
  | "masked_document"
  | "pix_key"
  | "bank_account"
  | "name"
  | "initials"
  | "none";

export interface MatchSignals {
  /** 0..1 por família de evidência. */
  amount: number;
  date: number;
  entity: number;
  description: number;
  /** Diferença absoluta em reais entre o valor do comprovante e o da transação. */
  amountDelta?: number;
  /** Diferença em dias civis (fuso de Brasília). */
  dayDiff?: number;
  entityEvidence: EntityEvidence;
  /** Multiplicadores de conflito aplicados (documento divergente, etc.). */
  penalties: string[];
}

export interface MatchScore {
  transactionId: string;
  transactionIds: string[];
  isConsolidated: boolean;
  /** 0-100. */
  score: number;
  confidenceLevel: ComprovanteConfidenceLevel;
  matchedAmount?: number;
  matchedDate?: Date;
  matchedEntity?: string;
  reasons: string[];
  signals: MatchSignals;
  /** Verdadeiro quando outro candidato tem evidência praticamente equivalente. */
  isAmbiguous?: boolean;
  /** Distância em pontos para o melhor candidato concorrente. */
  margin?: number;
}

export interface MatchOptions {
  /** Cadastro de entidades — habilita match por CNPJ/CPF, chave Pix e conta. */
  entities?: Entity[];
  /** Comprovante em processamento; a transação já ligada a ele não é penalizada. */
  comprovanteId?: string;
  /** Penaliza transações que já possuem outro comprovante. Padrão: true. */
  penalizeAlreadyMatched?: boolean;
  /** Score mínimo para constar no resultado. Padrão: 25. */
  minScore?: number;
  /** Janela de dias para agrupar transações consolidadas. Padrão: 7. */
  consolidationWindowDays?: number;
  /** Tamanho máximo de uma associação consolidada. Padrão: 8. */
  maxConsolidationSize?: number;
}

const WEIGHTS = {
  amount: 40,
  date: 20,
  entity: 28,
  description: 12,
} as const;

const HIGH_THRESHOLD = 82;
const MEDIUM_THRESHOLD = 55;
const AMBIGUITY_MARGIN = 6;

// ── Candidatos preparados ─────────────────────────────────────────────────────

interface AmountOption {
  value: number;
  kind: "final" | "original" | "ajustado";
}

interface PreparedTransaction {
  tx: Transaction;
  entity?: Entity;
  entityName: string;
  entityKey: string;
  nameTokens: string[];
  nameNormalized: string;
  initials: string;
  documentDigits?: string;
  pixKey?: string;
  agency?: string;
  account?: string;
  barcode?: string;
  descriptionTokens: string[];
  documentNumbers: string[];
  amounts: AmountOption[];
  primaryAmount: number;
  dates: Date[];
  cents: number;
  hasOtherComprovante: boolean;
}

const NUMBER_IN_TEXT_RE = /\b\d{2,12}\b/g;

function collectNumbers(text: string): string[] {
  return [...new Set(text.match(NUMBER_IN_TEXT_RE) ?? [])];
}

function prepare(
  transactions: Transaction[],
  options: MatchOptions,
): { candidates: PreparedTransaction[]; weights: TokenWeights } {
  const entityById = new Map<string, Entity>();
  for (const entity of options.entities ?? [])
    entityById.set(entity.id, entity);

  const candidates: PreparedTransaction[] = transactions.map((tx) => {
    const entity = tx.entityId ? entityById.get(tx.entityId) : undefined;
    const entityName = entity?.name ?? tx.supplierOrClient ?? "";

    const primaryAmount = tx.finalAmount ?? tx.amount;
    const adjusted = currency(tx.amount)
      .add(tx.interest ?? 0)
      .subtract(tx.discount ?? 0).value;

    const amounts: AmountOption[] = [];
    const pushAmount = (value: number, kind: AmountOption["kind"]): void => {
      if (!Number.isFinite(value) || value <= 0) return;
      if (amounts.some((a) => Math.abs(a.value - value) < 0.005)) return;
      amounts.push({ value, kind });
    };
    pushAmount(primaryAmount, "final");
    pushAmount(tx.amount, "original");
    pushAmount(adjusted, "ajustado");

    const dates: Date[] = [];
    if (tx.paymentDate) dates.push(tx.paymentDate);
    if (tx.dueDate) dates.push(tx.dueDate);

    const freeText = [tx.description, tx.notes, tx.details]
      .filter(Boolean)
      .join(" ");

    return {
      tx,
      entity,
      entityName,
      entityKey: tx.entityId
        ? `eid:${tx.entityId}`
        : `name:${normalize(entityName).slice(0, 40)}`,
      nameTokens: significantTokens(entityName),
      nameNormalized: normalize(entityName),
      initials: initialsOf(entityName),
      documentDigits: entity?.document
        ? digitsOnly(entity.document)
        : undefined,
      pixKey: entity?.pixKey ? normalizePixKey(entity.pixKey) : undefined,
      agency: entity?.agency ? digitsOnly(entity.agency) : undefined,
      account: entity?.account ? digitsOnly(entity.account) : undefined,
      barcode: tx.barcode ? (toBarcode(tx.barcode) ?? undefined) : undefined,
      descriptionTokens: significantTokens(freeText),
      documentNumbers: collectNumbers(freeText),
      amounts,
      primaryAmount,
      dates,
      cents: Math.round(primaryAmount * 100),
      hasOtherComprovante:
        !!tx.comprovanteId && tx.comprovanteId !== options.comprovanteId,
    };
  });

  // IDF sobre o próprio conjunto de candidatos: um sobrenome raro na carteira
  // de fornecedores vale muito mais que "transportes".
  const weights = createTokenWeights(
    candidates.map((c) => [...c.nameTokens, ...c.descriptionTokens]),
  );

  return { candidates, weights };
}

// ── Funções de evidência ──────────────────────────────────────────────────────

/**
 * Converte o peso do rótulo em saliência. Um valor rotulado "Tarifa" que casa
 * na vírgula ainda é evidência fraca; um valor sem rótulo que casa exato é
 * evidência forte.
 */
function salience(weight: number): number {
  if (weight >= 0.8) return 1;
  if (weight >= 0.55) return 0.92;
  if (weight >= 0.4) return 0.85;
  return 0.35;
}

function dateSalience(weight: number): number {
  if (weight >= 0.8) return 1;
  if (weight >= 0.55) return 0.93;
  return 0.55;
}

/** Tolerância graduada: diferenças de arredondamento e tarifa não zeram o sinal. */
function amountCloseness(receipt: number, expected: number): number {
  const diff = Math.abs(currency(receipt).subtract(expected).value);
  if (diff <= 0.011) return 1;
  const relative = diff / Math.max(expected, 1);
  if (diff <= 1 || relative <= 0.005) return 0.88;
  if (diff <= 5 || relative <= 0.02) return 0.66;
  if (relative <= 0.05) return 0.4;
  return 0;
}

function dateCloseness(days: number): number {
  if (days === 0) return 1;
  if (days === 1) return 0.9;
  if (days === 2) return 0.78;
  if (days === 3) return 0.68;
  if (days <= 5) return 0.5;
  if (days <= 10) return 0.28;
  if (days <= 30) return 0.08;
  return 0;
}

interface AmountEvaluation {
  score: number;
  matchedValue?: number;
  delta?: number;
  kind?: AmountOption["kind"];
}

function evaluateAmount(
  facts: ReceiptFacts,
  amounts: AmountOption[],
): AmountEvaluation {
  let best: AmountEvaluation = { score: 0 };

  for (const receipt of facts.amounts) {
    const factor = salience(receipt.weight);
    for (const option of amounts) {
      const closeness = amountCloseness(receipt.value, option.value);
      if (closeness === 0) continue;
      // O valor efetivamente pago (finalAmount) é a hipótese preferida.
      const kindFactor = option.kind === "final" ? 1 : 0.97;
      const score = closeness * factor * kindFactor;
      if (score > best.score) {
        best = {
          score,
          matchedValue: receipt.value,
          delta: Math.abs(currency(receipt.value).subtract(option.value).value),
          kind: option.kind,
        };
      }
    }
  }

  return best;
}

interface DateEvaluation {
  score: number;
  matchedDate?: Date;
  days?: number;
}

function evaluateDate(facts: ReceiptFacts, dates: Date[]): DateEvaluation {
  let best: DateEvaluation = { score: 0 };

  for (const receipt of facts.dates) {
    const factor = dateSalience(receipt.weight);
    for (const txDate of dates) {
      const days = dayDiff(receipt.date, txDate);
      const score = dateCloseness(days) * factor;
      if (score > best.score) {
        best = { score, matchedDate: receipt.date, days };
      }
    }
  }

  return best;
}

interface EntityEvaluation {
  score: number;
  evidence: EntityEvidence;
  /** Documento do beneficiário lido no comprovante que conflita com a entidade. */
  documentConflict: boolean;
  matchedName?: string;
}

function evaluateEntity(
  facts: ReceiptFacts,
  candidate: PreparedTransaction,
  weights: TokenWeights,
): EntityEvaluation {
  let score = 0;
  let evidence: EntityEvidence = "none";

  const promote = (value: number, kind: EntityEvidence): void => {
    if (value > score) {
      score = value;
      evidence = kind;
    }
  };

  // ── Documento (CNPJ/CPF) ────────────────────────────────────────────────────
  const relevantDocs = facts.documents.filter((d) => d.role !== "payer");
  let documentConflict = false;

  if (candidate.documentDigits) {
    const expected = candidate.documentDigits;
    const expectedRoot = cnpjRoot(expected);
    let sawComparable = false;

    for (const doc of relevantDocs) {
      if (doc.masked) {
        if (doc.visible && cpfMatchesMask(expected, doc.visible)) {
          promote(0.86, "masked_document");
        }
        continue;
      }
      if (doc.digits.length !== expected.length) continue;
      sawComparable = true;
      if (doc.digits === expected) {
        promote(doc.role === "beneficiary" ? 1 : 0.95, "document");
      } else if (
        expectedRoot &&
        doc.kind === "cnpj" &&
        cnpjRoot(doc.digits) === expectedRoot
      ) {
        promote(0.9, "document_root");
      }
    }

    // Comprovante nomeia um beneficiário identificado e não é este fornecedor.
    if (
      sawComparable &&
      evidence === "none" &&
      relevantDocs.some((d) => !d.masked && d.role === "beneficiary")
    ) {
      documentConflict = true;
    }
  }

  // ── Chave Pix ───────────────────────────────────────────────────────────────
  if (candidate.pixKey && facts.pixKeys.includes(candidate.pixKey)) {
    promote(1, "pix_key");
  }

  // ── Agência + conta ─────────────────────────────────────────────────────────
  if (candidate.agency && candidate.account) {
    const agencyHit = facts.agencies.some(
      (a) => digitsOnly(a) === candidate.agency,
    );
    const accountHit = facts.accounts.some(
      (a) => digitsOnly(a) === candidate.account,
    );
    if (agencyHit && accountHit) promote(0.88, "bank_account");
  }

  // ── Nome ────────────────────────────────────────────────────────────────────
  if (candidate.nameTokens.length > 0) {
    const coverage = weightedCoverage(
      candidate.nameTokens,
      facts.tokens,
      weights,
    );

    // Bloco "Beneficiário: <nome>" é evidência bem mais forte que o nome
    // aparecer solto em qualquer lugar da página — desde que sejam os tokens
    // *distintivos* que coincidam. Comparar as strings inteiras faria
    // "Beta Distribuidora de Alimentos" casar com "ACME Distribuidora de
    // Alimentos" com 85% de similaridade, que é exatamente o erro a evitar.
    for (const name of facts.beneficiaryNames) {
      const blockTokens = significantTokens(name);
      if (blockTokens.length === 0) continue;

      const blockCoverage = weightedCoverage(
        candidate.nameTokens,
        buildTokenIndex(blockTokens),
        weights,
      ).score;

      if (blockCoverage >= 0.5) {
        promote(Math.min(1, 0.35 + 0.65 * blockCoverage), "name");
      }

      // Nome de token único ("Petrobras") não tem cobertura a medir; aí a
      // similaridade de string é o único sinal disponível.
      if (candidate.nameTokens.length <= 1 || blockTokens.length <= 1) {
        const normalized = normalize(name);
        const similarity = Math.max(
          diceCoefficient(normalized, candidate.nameNormalized),
          jaroWinkler(normalized, candidate.nameNormalized),
        );
        if (similarity >= 0.9) promote(0.95, "name");
      }
    }

    if (coverage.score > 0) {
      promote(Math.min(1, coverage.score), "name");
    }
  }

  // ── Sigla ("CBD" para "Companhia Brasileira de Distribuição") ───────────────
  if (candidate.initials.length >= 3 && score < 0.45) {
    if (tokenPresence(candidate.initials, facts.tokens) >= 0.99) {
      promote(0.45, "initials");
    }
  }

  return {
    score,
    evidence,
    documentConflict,
    matchedName: score > 0 ? candidate.entityName : undefined,
  };
}

function evaluateDescription(
  facts: ReceiptFacts,
  candidate: PreparedTransaction,
  weights: TokenWeights,
): { score: number; hits: string[]; documentNumber?: string } {
  // Número de documento (NF, duplicata, pedido) citado nos dois lados.
  // Anos e sequências curtas são excluídos — casariam por acaso o tempo todo.
  let documentNumber: string | undefined;
  for (const number of candidate.documentNumbers) {
    if (number.length < 4 || /^(19|20)\d{2}$/.test(number)) continue;
    const labelled = facts.documentNumbers.includes(number);
    if (labelled || (number.length >= 5 && facts.tokens.set.has(number))) {
      documentNumber = number;
      break;
    }
  }

  const coverage = weightedCoverage(
    candidate.descriptionTokens,
    facts.tokens,
    weights,
  );

  return {
    score: documentNumber ? 1 : coverage.score,
    hits: coverage.hits,
    documentNumber,
  };
}

// ── Montagem de um candidato pontuado ─────────────────────────────────────────

const CURRENCY_FORMAT = { minimumFractionDigits: 2 } as const;

function formatBRL(value: number): string {
  return `R$ ${value.toLocaleString("pt-BR", CURRENCY_FORMAT)}`;
}

function formatDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

interface ScoredInput {
  members: PreparedTransaction[];
  isConsolidated: boolean;
  amount: AmountEvaluation;
  date: DateEvaluation;
  entity: EntityEvaluation;
  description: { score: number; hits: string[]; documentNumber?: string };
  barcodeMatch: boolean;
  extraPenalty?: { factor: number; label: string };
}

function assemble(
  facts: ReceiptFacts,
  input: ScoredInput,
  options: MatchOptions,
): MatchScore {
  const { members, amount, date, entity, description } = input;
  const primary = members[0];

  let score =
    WEIGHTS.amount * amount.score +
    WEIGHTS.date * date.score +
    WEIGHTS.entity * entity.score +
    WEIGHTS.description * description.score;

  const reasons: string[] = [];
  const penalties: string[] = [];
  /** Penalidades duras: bloqueiam os pisos por evidência determinística. */
  const conflicts: string[] = [];

  if (input.isConsolidated) {
    const total = members.reduce(
      (sum, m) => currency(sum).add(m.primaryAmount).value,
      0,
    );
    reasons.push(
      `Soma de ${members.length} transações do mesmo fornecedor: ${formatBRL(total)}`,
    );
    // Prefere a explicação mais simples: cada transação extra custa pontos.
    score -= (members.length - 2) * 1.5;
  }

  if (amount.score > 0 && amount.matchedValue !== undefined) {
    const exact = (amount.delta ?? 0) <= 0.011;
    reasons.push(
      exact
        ? `Valor ${formatBRL(amount.matchedValue)} confere exatamente`
        : `Valor ${formatBRL(amount.matchedValue)} próximo (diferença de ${formatBRL(amount.delta ?? 0)})`,
    );
    if (amount.kind === "ajustado") {
      reasons.push("Valor bate considerando juros/desconto");
    }
  }

  if (date.score > 0 && date.matchedDate) {
    reasons.push(
      date.days === 0
        ? `Data ${formatDate(date.matchedDate)} confere`
        : `Data ${formatDate(date.matchedDate)} a ${date.days} dia(s) da transação`,
    );
  }

  if (entity.score > 0) {
    const label: Record<EntityEvidence, string> = {
      barcode: "Código de barras do boleto confere",
      document: `CNPJ/CPF do beneficiário confere com ${entity.matchedName}`,
      document_root: `CNPJ da mesma raiz (matriz/filial) de ${entity.matchedName}`,
      masked_document: `CPF mascarado compatível com ${entity.matchedName}`,
      pix_key: `Chave Pix cadastrada de ${entity.matchedName}`,
      bank_account: `Agência e conta de ${entity.matchedName}`,
      name: `Beneficiário "${entity.matchedName}" identificado no comprovante`,
      initials: `Sigla de "${entity.matchedName}" identificada`,
      none: "",
    };
    if (label[entity.evidence]) reasons.push(label[entity.evidence]);
  }

  if (description.documentNumber) {
    reasons.push(`Documento nº ${description.documentNumber} citado`);
  } else if (description.hits.length > 0) {
    reasons.push(
      `Termos "${description.hits.slice(0, 3).join(", ")}" da descrição presentes`,
    );
  }

  // ── Conflitos ───────────────────────────────────────────────────────────────

  if (entity.documentConflict) {
    score *= 0.3;
    conflicts.push("documento_divergente");
    reasons.push(
      "⚠ CNPJ/CPF do beneficiário diverge do cadastro deste fornecedor",
    );
  }

  if (options.penalizeAlreadyMatched !== false) {
    const alreadyMatched = members.filter((m) => m.hasOtherComprovante);
    if (alreadyMatched.length > 0) {
      score *= 0.35;
      conflicts.push("ja_conciliada");
      reasons.push("⚠ Transação já possui outro comprovante associado");
    }
  }

  if (input.extraPenalty) {
    score *= input.extraPenalty.factor;
    conflicts.push(input.extraPenalty.label);
  }

  penalties.push(...conflicts);

  // Método de pagamento divergente é sinal fraco, mas real.
  const method = primary.tx.paymentMethod;
  if (method && facts.paymentMethods.length > 0) {
    const compatible = facts.paymentMethods.some(
      (hint) =>
        hint === method ||
        (method === "transfer" && (hint === "ted" || hint === "doc")) ||
        (method === "credit_card" && hint === "card"),
    );
    if (!compatible) {
      score *= 0.96;
      penalties.push("metodo_divergente");
    }
  }

  // ── Tetos e pisos ───────────────────────────────────────────────────────────

  const strongIdentity =
    input.barcodeMatch ||
    entity.evidence === "document" ||
    entity.evidence === "pix_key";

  // Sem valor não existe match confiável: é o eixo central de um comprovante.
  if (amount.score === 0 && !strongIdentity) {
    score = Math.min(score, 45);
  }

  // Os pisos por evidência determinística só valem quando nada conflita. Sem
  // esta guarda um piso reinstalaria o score que a penalidade acabou de tirar
  // — o CNPJ divergente viraria letra morta.
  if (conflicts.length === 0) {
    if (input.barcodeMatch) {
      score = Math.max(score, 97);
      reasons.unshift("Código de barras do boleto confere");
    } else if (strongIdentity && amount.score >= 0.95) {
      score = Math.max(score, 94);
    } else if (
      amount.score >= 0.95 &&
      date.days === 0 &&
      entity.score >= 0.55
    ) {
      score = Math.max(score, 90);
    }
  } else {
    // Teto proporcional à gravidade do conflito.
    if (conflicts.includes("documento_divergente")) score = Math.min(score, 45);
    if (conflicts.includes("ja_conciliada")) score = Math.min(score, 60);
    if (input.barcodeMatch) {
      reasons.unshift("Código de barras do boleto confere");
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Consolidação sem qualquer evidência de contraparte não chega a Alta.
  const consolidationUnverified =
    input.isConsolidated && entity.score < 0.3 && !input.barcodeMatch;

  let confidenceLevel: ComprovanteConfidenceLevel =
    score >= HIGH_THRESHOLD
      ? "HIGH"
      : score >= MEDIUM_THRESHOLD
        ? "MEDIUM"
        : "LOW";

  if (
    confidenceLevel === "HIGH" &&
    (consolidationUnverified || (amount.score === 0 && !input.barcodeMatch))
  ) {
    confidenceLevel = "MEDIUM";
  }

  return {
    transactionId: primary.tx.id,
    transactionIds: members.map((m) => m.tx.id),
    isConsolidated: input.isConsolidated,
    score,
    confidenceLevel,
    matchedAmount: amount.matchedValue,
    matchedDate: date.matchedDate,
    // Só o beneficiário efetivamente reconhecido no comprovante. Cair para o
    // nome da transação faria a UI afirmar que leu algo que não leu.
    matchedEntity: entity.matchedName || undefined,
    reasons,
    signals: {
      amount: Number(amount.score.toFixed(3)),
      date: Number(date.score.toFixed(3)),
      entity: Number(entity.score.toFixed(3)),
      description: Number(description.score.toFixed(3)),
      amountDelta: amount.delta,
      dayDiff: date.days,
      entityEvidence: input.barcodeMatch ? "barcode" : entity.evidence,
      penalties,
    },
  };
}

// ── Consolidação (subset-sum) ─────────────────────────────────────────────────

/**
 * Enumera subconjuntos cuja soma bate com o valor do comprovante.
 *
 * O algoritmo antigo só testava o grupo inteiro de mesmo fornecedor no mesmo
 * dia — se o operador juntou 3 dos 5 títulos do dia, não achava nada. Aqui é
 * busca em profundidade com poda por soma restante, trabalhando em centavos
 * para não acumular erro de ponto flutuante.
 */
function findSubsets(
  items: Array<{ index: number; cents: number }>,
  targetCents: number,
  toleranceCents: number,
  maxSize: number,
  maxSolutions: number,
  budgetRef: { remaining: number },
): number[][] {
  const sorted = [...items].sort((a, b) => b.cents - a.cents);
  const suffix = new Array<number>(sorted.length + 1).fill(0);
  for (let i = sorted.length - 1; i >= 0; i--) {
    suffix[i] = suffix[i + 1] + sorted[i].cents;
  }

  const solutions: number[][] = [];
  const current: number[] = [];

  const dfs = (start: number, remaining: number): void => {
    if (solutions.length >= maxSolutions || budgetRef.remaining-- <= 0) return;
    if (Math.abs(remaining) <= toleranceCents && current.length >= 2) {
      solutions.push(current.map((i) => sorted[i].index));
      return;
    }
    if (current.length >= maxSize) return;
    if (remaining < -toleranceCents) return;
    if (remaining > suffix[start] + toleranceCents) return;

    for (let i = start; i < sorted.length; i++) {
      // Valores iguais no mesmo nível gerariam soluções idênticas.
      if (i > start && sorted[i].cents === sorted[i - 1].cents) continue;
      current.push(i);
      dfs(i + 1, remaining - sorted[i].cents);
      current.pop();
      if (solutions.length >= maxSolutions) return;
    }
  };

  dfs(0, targetCents);
  return solutions;
}

// ── API principal ─────────────────────────────────────────────────────────────

export interface MatchOutcome {
  best: MatchScore | null;
  /** Candidatos ordenados por score (o primeiro é `best`). */
  candidates: MatchScore[];
  /** Alternativas plausíveis além da vencedora — alimentam a revisão manual. */
  alternatives: MatchScore[];
  /** Verdadeiro quando o topo não se destaca o suficiente do segundo colocado. */
  isAmbiguous: boolean;
}

/**
 * Pontua todas as transações (e grupos consolidados) contra os fatos lidos
 * de um comprovante.
 */
export function scoreCandidates(
  facts: ReceiptFacts,
  transactions: Transaction[],
  options: MatchOptions = {},
): MatchOutcome {
  const minScore = options.minScore ?? 25;
  const empty: MatchOutcome = {
    best: null,
    candidates: [],
    alternatives: [],
    isAmbiguous: false,
  };

  if (facts.isEmpty || transactions.length === 0) return empty;

  const { candidates, weights } = prepare(transactions, options);
  const scored: MatchScore[] = [];

  // ── 1. Transações individuais ───────────────────────────────────────────────

  const entityEvaluations = new Map<string, EntityEvaluation>();

  for (const candidate of candidates) {
    const entity = evaluateEntity(facts, candidate, weights);
    entityEvaluations.set(candidate.tx.id, entity);

    const barcodeMatch =
      !!candidate.barcode && facts.boletos.includes(candidate.barcode);

    const result = assemble(
      facts,
      {
        members: [candidate],
        isConsolidated: false,
        amount: evaluateAmount(facts, candidate.amounts),
        date: evaluateDate(facts, candidate.dates),
        entity,
        description: evaluateDescription(facts, candidate, weights),
        barcodeMatch,
      },
      options,
    );

    if (result.score >= minScore) scored.push(result);
  }

  // ── 2. Grupos consolidados ──────────────────────────────────────────────────

  const windowDays = options.consolidationWindowDays ?? 7;
  const maxSize = options.maxConsolidationSize ?? 8;

  const groups = new Map<string, PreparedTransaction[]>();
  for (const candidate of candidates) {
    if (!candidate.entityName) continue;
    const group = groups.get(candidate.entityKey);
    if (group) group.push(candidate);
    else groups.set(candidate.entityKey, [candidate]);
  }

  const receiptAmounts = facts.amounts
    .filter((a) => a.weight >= 0.4)
    .slice(0, 6);

  // Orçamento global da busca por subconjuntos — a enumeração é exponencial no
  // pior caso e roda dentro de um request HTTP.
  const subsetBudget = { remaining: 300_000 };

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    // Só entram no grupo transações próximas no tempo — pagamentos agrupados
    // acontecem numa mesma remessa, não ao longo de meses.
    const anchors = group
      .map((c) => c.dates[0])
      .filter((date): date is Date => date != null);
    const clusters = buildDateClusters(group, anchors, windowDays);

    for (const cluster of clusters) {
      if (cluster.length < 2) continue;
      const items = cluster.map((candidate, index) => ({
        index,
        cents: candidate.cents,
      }));
      const clusterTotal = items.reduce((sum, item) => sum + item.cents, 0);
      const smallestPair = items
        .map((i) => i.cents)
        .sort((a, b) => a - b)
        .slice(0, 2)
        .reduce((sum, cents) => sum + cents, 0);

      for (const receiptAmount of receiptAmounts) {
        if (subsetBudget.remaining <= 0) break;
        const targetCents = Math.round(receiptAmount.value * 100);
        // Rejeições baratas antes de entrar na busca exponencial.
        if (targetCents > clusterTotal || targetCents < smallestPair) continue;

        const solutions = findSubsets(
          items,
          targetCents,
          1,
          Math.min(maxSize, cluster.length),
          3,
          subsetBudget,
        );
        if (solutions.length === 0) continue;

        // Muitos subconjuntos com a mesma soma ⇒ a escolha é chute.
        const ambiguityPenalty =
          solutions.length > 1
            ? { factor: 0.72, label: "soma_ambigua" }
            : undefined;

        const members = solutions[0]
          .map((i) => cluster[i])
          .sort(
            (a, b) =>
              (a.dates[0]?.getTime() ?? 0) - (b.dates[0]?.getTime() ?? 0),
          );

        const entity =
          entityEvaluations.get(members[0].tx.id) ??
          evaluateEntity(facts, members[0], weights);

        const description = members
          .map((m) => evaluateDescription(facts, m, weights))
          .reduce((best, current) =>
            current.score > best.score ? current : best,
          );

        const result = assemble(
          facts,
          {
            members,
            isConsolidated: true,
            amount: {
              score: salience(receiptAmount.weight),
              matchedValue: receiptAmount.value,
              delta: 0,
              kind: "final",
            },
            date: evaluateDate(
              facts,
              members.flatMap((m) => m.dates),
            ),
            entity,
            description,
            barcodeMatch: false,
            extraPenalty: ambiguityPenalty,
          },
          options,
        );

        if (result.score >= minScore) scored.push(result);
      }
    }
  }

  if (scored.length === 0) return empty;

  // ── 3. Ordenação, ambiguidade e alternativas ────────────────────────────────

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.signals.entity - a.signals.entity ||
      a.transactionIds.length - b.transactionIds.length,
  );

  // Deduplica conjuntos de transações idênticos (individual vs consolidado).
  const seen = new Set<string>();
  const unique = scored.filter((candidate) => {
    const key = [...candidate.transactionIds].sort().join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const best = unique[0];
  const bestIds = new Set(best.transactionIds);
  const rival = unique.find(
    (candidate) => !candidate.transactionIds.some((id) => bestIds.has(id)),
  );

  const margin = rival ? best.score - rival.score : best.score;
  const isAmbiguous = !!rival && margin < AMBIGUITY_MARGIN;

  if (isAmbiguous) {
    best.isAmbiguous = true;
    best.reasons.push(
      "⚠ Outra transação apresenta evidências equivalentes — confirme manualmente",
    );
    if (best.confidenceLevel === "HIGH") best.confidenceLevel = "MEDIUM";
  }
  best.margin = Math.round(margin);

  return {
    best,
    candidates: unique,
    alternatives: unique.slice(1, 4),
    isAmbiguous,
  };
}

/**
 * Agrupa transações do mesmo fornecedor em janelas temporais.
 * Cada âncora vira um cluster com tudo que estiver a ±`windowDays` dela.
 */
function buildDateClusters(
  group: PreparedTransaction[],
  anchors: Date[],
  windowDays: number,
): PreparedTransaction[][] {
  if (anchors.length === 0) return [group];

  const clusters: PreparedTransaction[][] = [];
  const seen = new Set<string>();

  const uniqueAnchorDays = [...new Set(anchors.map(civilDay))].sort(
    (a, b) => a - b,
  );

  /** Teto de itens por cluster — mantém a busca por subconjuntos tratável. */
  const MAX_CLUSTER_SIZE = 20;

  for (const anchorDay of uniqueAnchorDays) {
    let cluster = group.filter((candidate) => {
      const date = candidate.dates[0];
      return date != null && Math.abs(civilDay(date) - anchorDay) <= windowDays;
    });
    if (cluster.length < 2) continue;
    if (cluster.length > MAX_CLUSTER_SIZE) {
      cluster = [...cluster]
        .sort(
          (a, b) =>
            Math.abs(civilDay(a.dates[0]!) - anchorDay) -
            Math.abs(civilDay(b.dates[0]!) - anchorDay),
        )
        .slice(0, MAX_CLUSTER_SIZE);
    }

    const key = cluster
      .map((c) => c.tx.id)
      .sort()
      .join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    clusters.push(cluster);
  }

  return clusters;
}
