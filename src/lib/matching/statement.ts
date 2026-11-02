/**
 * Motor de conciliação: casa linhas do extrato com títulos do sistema.
 *
 * - Título pago casa pela data da baixa e pelo valor efetivamente pago.
 * - Título aprovado e ainda em aberto também casa; confirmar a sugestão dá a
 *   baixa com a data do banco.
 * - Uma linha pode casar com várias contas do mesmo favorecido: a
 *   transferência única para os vários projetos de uma instituição.
 * - Cada título vai para a linha em que ele é a melhor resposta do extrato
 *   inteiro, não para a primeira linha que o encontrou.
 *
 * Nada concilia sozinho: o resultado são sugestões, e ≥ 90 vem pré-marcada.
 * Puro e sem I/O. Verificação: `npm run check:statement-matching`.
 */
import currency from "currency.js";
import type {
  BankTransaction,
  Entity,
  ReconciliationMatchCandidate,
  Transaction,
} from "@/lib/types";
import { cnpjRoot, dayDiff, isValidCNPJ, isValidCPF } from "./brazilian";
import { statementPayee } from "./learn";
import {
  buildTokenIndex,
  createTokenWeights,
  diceCoefficient,
  digitsOnly,
  normalize,
  significantTokens,
  weightedCoverage,
  type TokenIndex,
  type TokenWeights,
} from "./text";

export const isOpenTitle = (t: Pick<Transaction, "status">) =>
  t.status !== "paid" && t.status !== "received";

/** Sugestão a partir daqui; abaixo, só candidato para escolher à mão. */
const SUGGEST = 70;
/** Diferença máxima de valor, em centavos, para casar um título sozinho. */
const MAX_GAP = 100;
/** Título pago numa baixa avulsa só entra no somatório se a data bater. */
const BUNDLE_PAID_DAYS = 3;
// ponytail: tetos do somatório; acima deles o painel de baixa resolve à mão.
const BUNDLE_MAX_ITEMS = 40;
const BUNDLE_MAX_STATES = 50_000;

/** Palavras que o banco põe em toda linha: não dizem quem recebeu. */
const BANK_NOISE = new Set([
  "pix",
  "transf",
  "transferencia",
  "ted",
  "doc",
  "tev",
  "sispag",
  "enviado",
  "enviada",
  "env",
  "recebido",
  "recebida",
  "receb",
  "pagto",
  "pgto",
  "pag",
  "pagamento",
  "pagamentos",
  "fornec",
  "fornecedor",
  "fornecedores",
  "deb",
  "debito",
  "cred",
  "credito",
  "conta",
  "bco",
  "banco",
  "boleto",
  "tit",
  "titulo",
  "int",
  "internet",
  "agendado",
  "agend",
  "qrcode",
  "cobranca",
  "liq",
  "liquidacao",
]);

const cents = (value: number) => currency(Math.abs(value)).intValue;
const brl = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;

/** CPF/CNPJ citados no texto, só os de dígito verificador válido. */
export function documentsIn(text: string): string[] {
  const found = new Set<string>();
  for (const run of text.match(/\d[\d./-]{9,18}\d/g) ?? []) {
    const d = digitsOnly(run);
    if (
      (d.length === 14 && isValidCNPJ(d)) ||
      (d.length === 11 && isValidCPF(d))
    )
      found.add(d);
  }
  return [...found];
}

/** "PIX TRANSF MISSAO A02/11": a data colada no nome não é nome. */
const stripDates = (text: string) =>
  text.replace(/\d{2}\/\d{2}(\/\d{2,4})?/g, " ");

type Party = {
  docs: string[];
  /** Nomes normalizados: cadastro e os que o banco já imprimiu (aprendidos). */
  names: string[];
  tokens: string[];
  index: TokenIndex;
  text: string;
  name: string;
};

type Title = {
  tx: Transaction;
  open: boolean;
  cents: number;
  date: Date;
  sign: number;
  group: string;
  party: Party;
};

type Line = {
  cents: number;
  sign: number;
  date: Date;
  bankAccountId?: string;
  docs: string[];
  index: TokenIndex;
  nameTokens: string[];
  payee: string;
  text: string;
  /** Identidade já calculada por favorecido: as rodadas repetem a conta. */
  who: Map<Party, Identity>;
};

type Identity = { score: number; reason?: string; mismatch?: boolean };

type Proposal = {
  ids: string[];
  titles: Title[];
  score: number;
  bundle: boolean;
};

type Context = {
  /** Por sentido (−1 despesa, 1 receita), ordenados por valor. */
  byAmount: Map<number, Title[]>;
  groups: Map<number, Title[][]>;
  weights: TokenWeights;
};

function partyOf(tx: Transaction, entity?: Entity): Party {
  const names = [
    entity?.name ?? "",
    ...(entity?.receiptAliases?.names ?? []),
    tx.supplierOrClient ?? "",
  ];
  const tokens = [...new Set(names.flatMap(significantTokens))];
  return {
    names: names.map(normalize).filter(Boolean),
    docs: [
      ...new Set([
        ...(entity?.document ? [digitsOnly(entity.document)] : []),
        ...(entity?.receiptAliases?.documents ?? []).map(digitsOnly),
        ...documentsIn(`${tx.description ?? ""} ${tx.supplierOrClient ?? ""}`),
      ]),
    ].filter(Boolean),
    tokens,
    index: buildTokenIndex(tokens),
    text: normalize(`${tx.description ?? ""} ${tx.supplierOrClient ?? ""}`),
    name: entity?.name || tx.supplierOrClient || "Sem favorecido",
  };
}

function buildContext(titles: Transaction[], entities: Entity[]): Context {
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const byAmount = new Map<number, Title[]>([
    [-1, []],
    [1, []],
  ]);
  const grouped = new Map<string, Title[]>();

  for (const tx of titles) {
    if (tx.reconciled) continue;
    const open = isOpenTitle(tx);
    if (open && tx.paymentHold) continue;
    const entity = tx.entityId ? entityById.get(tx.entityId) : undefined;
    const party = partyOf(tx, entity);
    const sign = tx.type === "payable" ? -1 : 1;
    const key =
      entity?.id ??
      party.docs[0] ??
      (normalize(tx.supplierOrClient ?? "") || tx.id);
    const title: Title = {
      tx,
      open,
      // Pago: o que saiu do banco. Aberto: o que será pago.
      cents: cents(
        !open && tx.finalAmount != null ? tx.finalAmount : tx.amount,
      ),
      date: new Date(!open && tx.paymentDate ? tx.paymentDate : tx.dueDate),
      sign,
      group: `${sign}:${key}`,
      party,
    };
    byAmount.get(sign)!.push(title);
    grouped.set(title.group, [...(grouped.get(title.group) ?? []), title]);
  }

  byAmount.forEach((list) => list.sort((a, b) => a.cents - b.cents));
  const groups = new Map<number, Title[][]>([
    [-1, []],
    [1, []],
  ]);
  for (const list of grouped.values()) {
    list.sort((a, b) => a.date.getTime() - b.date.getTime());
    groups.get(list[0].sign)!.push(list);
  }
  const weights = createTokenWeights(
    [...grouped.values()].map((g) => g[0].party.tokens),
  );
  return { byAmount, groups, weights };
}

function lineOf(bankTx: BankTransaction): Line {
  const clean = stripDates(bankTx.description ?? "");
  const tokens = normalize(clean)
    .split(" ")
    .filter((t) => t.length >= 2);
  return {
    cents: cents(bankTx.amount),
    sign: bankTx.amount < 0 ? -1 : 1,
    date: new Date(bankTx.date),
    bankAccountId: bankTx.bankAccountId,
    docs: documentsIn(bankTx.description ?? ""),
    index: buildTokenIndex(tokens),
    nameTokens: significantTokens(clean).filter(
      (t) => t.length >= 3 && !/\d/.test(t) && !BANK_NOISE.has(t),
    ),
    payee: statementPayee(bankTx.description ?? ""),
    text: normalize(clean),
    who: new Map(),
  };
}

function identity(line: Line, party: Party, weights: TokenWeights): Identity {
  let hit = line.who.get(party);
  if (!hit) line.who.set(party, (hit = computeIdentity(line, party, weights)));
  return hit;
}

/** Quem recebeu: documento decide; sem ele, o nome (truncado pelo banco). */
function computeIdentity(
  line: Line,
  party: Party,
  weights: TokenWeights,
): Identity {
  if (line.docs.length && party.docs.length) {
    if (party.docs.some((d) => line.docs.includes(d)))
      return { score: 30, reason: "CPF/CNPJ confere" };
    // Matriz e filial: mesma raiz, outro documento. Não é prova, não é recusa.
    const roots = line.docs.map(cnpjRoot).filter(Boolean);
    return party.docs.some((d) => roots.includes(cnpjRoot(d)))
      ? { score: 15, reason: "CNPJ da mesma raiz (filial)" }
      : { score: 0, mismatch: true };
  }
  if (line.payee && party.names.includes(line.payee))
    return { score: 25, reason: "Favorecido confere" };
  const name = Math.max(
    party.tokens.length
      ? weightedCoverage(party.tokens, line.index, weights).score
      : 0,
    line.nameTokens.length && party.tokens.length
      ? weightedCoverage(line.nameTokens, party.index, weights).score
      : 0,
  );
  if (name >= 0.8) return { score: 25, reason: "Favorecido confere" };
  if (name >= 0.5) return { score: 15, reason: "Favorecido parecido" };
  const dice = diceCoefficient(line.text, party.text);
  return dice >= 0.3
    ? {
        score: Math.round(dice * 10),
        reason: `Descrição ${Math.round(dice * 100)}% parecida`,
      }
    : { score: 0 };
}

/**
 * Título pago: a data da baixa tem de ser a do banco. Título aberto: o
 * vencimento só sugere, quem paga escolhe o dia.
 */
function dateScore(days: number, open: boolean) {
  if (open) return days <= 3 ? 15 : days <= 15 ? 10 : days <= 45 ? 5 : 0;
  return days === 0
    ? 20
    : days <= 1
      ? 18
      : days <= 2
        ? 15
        : days <= 3
          ? 12
          : days <= 5
            ? 8
            : days <= 10
              ? 4
              : 0;
}

/**
 * Comprovante confirmado é uma segunda prova, independente do extrato, de que
 * o título foi pago a quem diz: valor, data e favorecido já foram conferidos.
 */
const proof = (titles: Title[]) =>
  titles.every((t) => t.tx.comprovanteId) ? 5 : 0;

const accountOk = (t: Title, line: Line) =>
  !t.tx.bankAccountId ||
  !line.bankAccountId ||
  t.tx.bankAccountId === line.bankAccountId;

function scoreTitle(
  line: Line,
  t: Title,
  weights: TokenWeights,
): ReconciliationMatchCandidate | null {
  const gap = Math.abs(t.cents - line.cents);
  if (gap > MAX_GAP) return null;
  const who = identity(line, t.party, weights);
  if (who.mismatch) return null;
  const days = dayDiff(t.date, line.date);
  const reasons = [
    gap === 0 ? "Valor exato" : `Valor próximo (Δ ${brl(gap)})`,
    t.open ? `Vence a ${days}d` : `Data próxima (${days}d)`,
    ...(who.reason ? [who.reason] : []),
    ...(t.tx.comprovanteId ? ["Comprovante confirmado"] : []),
    ...(t.open ? ["Em aberto: confirmar dá a baixa"] : []),
  ];
  const amount = gap === 0 ? 50 : gap <= 5 ? 45 : gap <= 50 ? 30 : 20;
  return {
    id: t.tx.id,
    score: Math.min(
      100,
      amount + dateScore(days, t.open) + who.score + proof([t]),
    ),
    reasons,
    transaction: t.tx,
    entityName: t.party.name,
  };
}

/**
 * Subconjunto que soma exatamente `target`, em centavos, e se há mais de um
 * (`ways` > 1: dez projetos iguais e nove pagos — quais nove?).
 */
export function subsetSum<T extends { cents: number }>(
  items: T[],
  target: number,
): { items: T[]; ways: number } | null {
  type Node = { from: number; item: number; ways: number };
  const reach = new Map<number, Node>([[0, { from: -1, item: -1, ways: 1 }]]);
  for (let i = 0; i < items.length; i++) {
    const snapshot = [...reach].map(([sum, node]) => [sum, node.ways]);
    for (const [sum, ways] of snapshot) {
      const next = sum + items[i].cents;
      if (next > target) continue;
      const hit = reach.get(next);
      if (hit) hit.ways = Math.min(2, hit.ways + ways);
      else reach.set(next, { from: sum, item: i, ways });
    }
    if (reach.size > BUNDLE_MAX_STATES) return null;
  }
  const end = reach.get(target);
  if (!end || target === 0) return null;
  const picked: T[] = [];
  for (let node = end; node.item >= 0; node = reach.get(node.from)!) {
    picked.push(items[node.item]);
  }
  return { items: picked.reverse(), ways: end.ways };
}

function bestBundle(
  line: Line,
  ctx: Context,
  used: Set<string>,
): Proposal | null {
  let best: Proposal | null = null;
  for (const group of ctx.groups.get(line.sign)!) {
    const avail = group.filter(
      (t) =>
        !used.has(t.tx.id) &&
        accountOk(t, line) &&
        (t.open || dayDiff(t.date, line.date) <= BUNDLE_PAID_DAYS),
    );
    if (avail.length < 2) continue;
    const total = avail.reduce((s, t) => s + t.cents, 0);
    if (total < line.cents) continue;
    const who = identity(line, group[0].party, ctx.weights);
    if (who.mismatch) continue;

    let picked: Title[] | null = null;
    let ambiguous = false;
    const whole = total === line.cents;
    if (whole) picked = avail;
    // Sem saber quem recebeu, uma combinação de valores é coincidência: só o
    // grupo inteiro vale.
    else if (who.score >= 15) {
      const hit = subsetSum(avail.slice(0, BUNDLE_MAX_ITEMS), line.cents);
      if (hit && hit.items.length > 1) {
        picked = hit.items;
        ambiguous = hit.ways > 1;
      }
    }
    if (!picked) continue;

    const anyOpen = picked.some((t) => t.open);
    const days = Math.max(...picked.map((t) => dayDiff(t.date, line.date)));
    const score = Math.min(
      ambiguous ? 80 : 100,
      50 +
        who.score +
        (anyOpen ? (whole ? 15 : 10) : dateScore(days, false)) +
        (whole ? 10 : 0) +
        proof(picked),
    );
    if (!best || score > best.score)
      best = {
        ids: picked.map((t) => t.tx.id),
        titles: picked,
        score,
        bundle: true,
      };
  }
  return best;
}

function propose(
  line: Line,
  ctx: Context,
  used: Set<string>,
): { best: Proposal | null; candidates: ReconciliationMatchCandidate[] } {
  const list = ctx.byAmount.get(line.sign)!;
  // Busca binária: só os títulos a até R$ 1,00 do valor da linha.
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].cents < line.cents - MAX_GAP) lo = mid + 1;
    else hi = mid;
  }
  const scored: { c: ReconciliationMatchCandidate; t: Title }[] = [];
  for (
    let i = lo;
    i < list.length && list[i].cents <= line.cents + MAX_GAP;
    i++
  ) {
    const t = list[i];
    if (used.has(t.tx.id) || !accountOk(t, line)) continue;
    const c = scoreTitle(line, t, ctx.weights);
    if (c && c.score > 0) scored.push({ c, t });
  }
  scored.sort((a, b) => b.c.score - a.c.score);

  let best: Proposal | null = null;
  const [top, second] = scored;
  if (top && top.c.score >= SUGGEST) {
    // Dois favorecidos diferentes quase empatados: sugere, mas não pré-marca.
    const tie =
      second &&
      second.t.group !== top.t.group &&
      second.c.score >= top.c.score - 5;
    best = {
      ids: [top.t.tx.id],
      titles: [top.t],
      score: tie ? Math.min(top.c.score, 85) : top.c.score,
      bundle: false,
    };
  }
  const bundle = bestBundle(line, ctx, used);
  if (bundle && bundle.score >= SUGGEST && (!best || bundle.score > best.score))
    best = bundle;

  return { best, candidates: scored.slice(0, 3).map((s) => s.c) };
}

const CLEARED = {
  matchedTransactionId: undefined,
  matchedDetails: undefined,
  matchedTransactionIds: undefined,
  matchedBundleDetails: undefined,
} as const;

/**
 * Sugere par para as linhas pendentes. Devolve o mesmo objeto para a linha que
 * não mudou, então quem chama grava só o que difere.
 */
export function matchStatement(
  lines: BankTransaction[],
  titles: Transaction[],
  entities: Entity[] = [],
): BankTransaction[] {
  const ctx = buildContext(titles, entities);
  const lineCtx = lines.map(lineOf);
  const used = new Set<string>();
  const won = new Map<number, Proposal>();
  const last = new Map<number, ReturnType<typeof propose>>();

  let pending = lines
    .map((_, i) => i)
    .filter(
      (i) =>
        lines[i].status === "unmatched" ||
        lines[i].status === "potential_match",
    );

  // A melhor sugestão do extrato inteiro leva o título; quem perdeu tenta de
  // novo com o que sobrou.
  for (let round = 0; round < 3 && pending.length > 0; round++) {
    const proposals = pending
      .map((i) => {
        const p = propose(lineCtx[i], ctx, used);
        last.set(i, p);
        return { i, best: p.best };
      })
      .filter((p): p is { i: number; best: Proposal } => !!p.best)
      .sort((a, b) => b.best.score - a.best.score);
    if (proposals.length === 0) break;
    const lost: number[] = [];
    for (const { i, best } of proposals) {
      if (best.ids.some((id) => used.has(id))) {
        lost.push(i);
        continue;
      }
      best.ids.forEach((id) => used.add(id));
      won.set(i, best);
    }
    pending = lost;
  }

  return lines.map((line, i) => {
    const best = won.get(i);
    const candidates = (last.get(i)?.candidates ?? []).filter(
      (c) => !used.has(c.id) || best?.ids.includes(c.id),
    );
    if (best) {
      const txs = best.titles.map((t) => t.tx);
      return {
        ...line,
        ...CLEARED,
        ...(best.bundle
          ? { matchedTransactionIds: best.ids, matchedBundleDetails: txs }
          : { matchedTransactionId: best.ids[0], matchedDetails: txs[0] }),
        matchCandidates: candidates.length ? candidates : undefined,
        confidence: best.score,
        status: "potential_match" as const,
        ruleId: undefined,
      };
    }
    if (!last.has(i) || line.ruleId) return line;
    // Sugestão antiga que perdeu o título (ou ficou fraca) volta a pendente.
    if (
      line.status === "unmatched" &&
      !line.matchCandidates?.length &&
      !candidates.length
    )
      return line;
    return {
      ...line,
      ...CLEARED,
      matchCandidates: candidates.length ? candidates : undefined,
      confidence: 0,
      status: "unmatched" as const,
    };
  });
}
