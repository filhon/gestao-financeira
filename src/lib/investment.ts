import currency from "currency.js";
import { differenceInCalendarDays, format } from "date-fns";
import type { BankAccount, BankTransaction, InvestmentProduct } from "./types";
// Relativo: o script de verificação roda fora do Next, sem o alias "@/".
import { isBalanceLine, isInvestment } from "./bankReconciliation";

/** CDI de cada dia útil (SGS 12, % ao dia), pela data "yyyy-MM-dd". */
export type CdiSeries = Record<string, number>;

const day = (d: Date) => format(new Date(d), "yyyy-MM-dd");

/** Produtos que acompanham o CDI: os outros não têm curva, só a conferência. */
export const tracksCdi = (a: Pick<BankAccount, "kind" | "product">) =>
  isInvestment(a) &&
  a.product !== "fund" &&
  a.product !== "treasury" &&
  a.product !== "savings";

export const PRODUCT_LABEL: Record<InvestmentProduct, string> = {
  cdb: "CDB",
  lci_lca: "LCI / LCA",
  fund: "Fundo de investimento",
  treasury: "Tesouro Direto",
  savings: "Poupança",
  auto: "Aplicação automática",
  other: "Outro",
};

/** "CDB · 100% CDI · liquidez diária", para as listas e a conciliação. */
export const investmentLabel = (a: BankAccount) =>
  [
    a.product && PRODUCT_LABEL[a.product],
    tracksCdi(a) && a.cdiPercent
      ? `${a.cdiPercent.toLocaleString("pt-BR")}% CDI`
      : null,
    a.liquidity === "daily"
      ? "liquidez diária"
      : a.liquidity === "maturity"
        ? "no vencimento"
        : null,
  ]
    .filter(Boolean)
    .join(" · ") || "Aplicação";

/**
 * A isenção de LCI/LCA e poupança é de pessoa física: na empresa o banco
 * retém IR de todo produto. Sem retenção só para entidade imune ou isenta.
 */
export const isTaxExempt = (a: Pick<BankAccount, "taxExempt">) => !!a.taxExempt;

/** IR regressivo da renda fixa (Lei 11.033/2004), pelos dias corridos. */
export const irRate = (days: number) =>
  days <= 180 ? 0.225 : days <= 360 ? 0.2 : days <= 720 ? 0.175 : 0.15;

// IOF regressivo sobre o rendimento, do 1º ao 29º dia (Decreto 6.306/2007).
const IOF = [
  96, 93, 90, 86, 83, 80, 76, 73, 70, 66, 63, 60, 56, 53, 50, 46, 43, 40, 36,
  33, 30, 26, 23, 20, 16, 13, 10, 6, 3,
];
export const iofRate = (days: number) =>
  days >= 30 ? 0 : IOF[Math.max(days, 1) - 1] / 100;

/** Uma aplicação ainda (em parte) investida. */
export interface Lot {
  /** Linha da aplicação; "opening" é o saldo de abertura da conta. */
  id: string;
  date: Date;
  /** Custo: quanto foi aplicado e continua no lote. */
  principal: number;
  /** Bruto pela curva, acertado ao saldo do banco a cada fechamento. */
  value: number;
  /** % do CDI; sem ela o lote não rende pela curva. */
  cdiPercent?: number;
}

export interface Redemption {
  id: string;
  date: Date;
  /** O que caiu na conta corrente. */
  net: number;
  /** O que saiu da aplicação: líquido + IR + IOF estimados. */
  gross: number;
  ir: number;
  iof: number;
}

export interface PositionLot extends Lot {
  days: number;
  ir: number;
  iof: number;
}

export interface Position {
  at: Date;
  lots: PositionLot[];
  /** Bruto pela curva no dia; null quando nenhum lote tem taxa. */
  curve: number | null;
  gross: number;
  ir: number;
  iof: number;
  /** Quanto cairia na conta resgatando tudo no dia. */
  net: number;
  redemptions: Redemption[];
  /** Último dia com CDI publicado que entrou na curva. */
  cdiThrough: string | null;
}

function taxOn(lot: Lot, take: number, at: Date, exempt: boolean) {
  if (exempt || lot.value <= 0) return { ir: 0, iof: 0 };
  const gain = Math.max(0, ((lot.value - lot.principal) * take) / lot.value);
  const days = differenceInCalendarDays(at, lot.date);
  const iof = gain * iofRate(days);
  return { ir: (gain - iof) * irRate(days), iof };
}

/** Tira `gross` dos lotes mais antigos primeiro (PEPS). Sem `apply`, só calcula. */
function redeem(
  lots: Lot[],
  gross: number,
  at: Date,
  exempt: boolean,
  apply: boolean,
) {
  let left = gross;
  let ir = 0;
  let iof = 0;
  for (const lot of lots) {
    if (left <= 0) break;
    const take = Math.min(lot.value, left);
    const t = taxOn(lot, take, at, exempt);
    ir += t.ir;
    iof += t.iof;
    left -= take;
    if (apply) {
      lot.principal -= (lot.principal * take) / lot.value;
      lot.value -= take;
    }
  }
  return { ir, iof };
}

const total = (lots: Lot[]) => lots.reduce((s, l) => s + l.value, 0);

const scaleTo = (lots: Lot[], balance: number) => {
  const sum = total(lots);
  if (sum <= 0) return;
  for (const lot of lots) lot.value *= balance / sum;
};

const money = (v: number) => currency(v).value;

/**
 * Posição da aplicação no fim do dia `at`, refazendo a história desde a
 * abertura: cada aplicação vira um lote, cada resgate consome os lotes mais
 * antigos (PEPS), e todo dia útil o lote rende `cdiPercent` do CDI daquele dia.
 * O rendimento do dia d entra no saldo do dia seguinte, então a aplicação do
 * dia já rende naquela noite e o resgate do dia não.
 *
 * O resgate chega pela conta corrente líquido; o bruto que saiu da aplicação é
 * o líquido mais o IR e o IOF dos lotes que ele consumiu. A cada fechamento os
 * lotes são acertados ao saldo bruto do banco, então a curva só acumula erro
 * desde o último fechamento. `bankGross` acerta também o dia `at`: o IR e o
 * líquido estimados partem do saldo do banco, não da curva.
 */
// ponytail: o saldo de abertura é um lote só, datado na abertura; aplicações mais velhas que ela ficam com IR de lote novo (a mais, nunca a menos).
export function investmentPosition(
  account: BankAccount,
  items: BankTransaction[],
  cdi: CdiSeries,
  at: Date,
  bankGross?: number,
): Position {
  const exempt = isTaxExempt(account);
  const openKey = day(account.openingBalanceDate);
  const atKey = day(at);
  const rate = tracksCdi(account) ? account.cdiPercent : undefined;

  const lots: Lot[] = [];
  if (account.openingBalance > 0) {
    lots.push({
      id: "opening",
      date: new Date(account.openingBalanceDate),
      principal: account.openingPrincipal ?? account.openingBalance,
      value: account.openingBalance,
      cdiPercent: rate,
    });
  }

  // Rendimento e IR lançados pelo sistema não são movimento: a curva já os tem.
  const events = items
    .filter(
      (tx) =>
        tx.bankAccountId === account.id &&
        !isBalanceLine(tx) &&
        tx.origin !== "yield" &&
        tx.origin !== "tax" &&
        day(tx.date) > openKey &&
        day(tx.date) <= atKey,
    )
    // Aplicação antes de resgate no mesmo dia.
    .sort(
      (a, b) => day(a.date).localeCompare(day(b.date)) || b.amount - a.amount,
    );
  const closings = new Map(
    (account.closings ?? []).map((c) => [day(c.through), c.balance]),
  );
  const keys = [
    ...new Set([
      ...Object.keys(cdi).filter((k) => k >= openKey && k < atKey),
      ...events.map((tx) => day(tx.date)),
      ...[...closings.keys()].filter((k) => k <= atKey),
      atKey,
    ]),
  ].sort();

  const redemptions: Redemption[] = [];
  let cdiThrough: string | null = null;
  let next = 0;
  for (const key of keys) {
    for (; next < events.length && day(events[next].date) === key; next++) {
      const tx = events[next];
      if (tx.amount > 0) {
        lots.push({
          id: tx.id,
          date: new Date(tx.date),
          principal: tx.amount,
          value: tx.amount,
          cdiPercent: rate === undefined ? undefined : (tx.cdiPercent ?? rate),
        });
        continue;
      }
      const net = -tx.amount;
      const when = new Date(tx.date);
      // Bruto = líquido + imposto do próprio bruto: converge em poucas voltas.
      let gross = net;
      for (let i = 0; i < 6; i++) {
        const t = redeem(lots, gross, when, exempt, false);
        gross = net + t.ir + t.iof;
      }
      const t = redeem(lots, gross, when, exempt, true);
      const ir = money(t.ir);
      const iof = money(t.iof);
      redemptions.push({
        id: tx.id,
        date: when,
        net,
        gross: currency(net).add(ir).add(iof).value,
        ir,
        iof,
      });
      for (let i = lots.length - 1; i >= 0; i--) {
        if (lots[i].value < 0.005) lots.splice(i, 1);
      }
    }
    const closed = closings.get(key);
    if (closed !== undefined) scaleTo(lots, closed);
    if (key === atKey) break;
    const r = cdi[key];
    if (r === undefined) continue;
    cdiThrough = key;
    for (const lot of lots) {
      if (lot.cdiPercent) lot.value *= 1 + (r / 100) * (lot.cdiPercent / 100);
    }
  }

  const curve = lots.some((l) => l.cdiPercent) ? money(total(lots)) : null;
  if (bankGross !== undefined) scaleTo(lots, bankGross);

  const out = lots.map((lot) => {
    const t = taxOn(lot, lot.value, at, exempt);
    return {
      ...lot,
      principal: money(lot.principal),
      value: money(lot.value),
      days: differenceInCalendarDays(at, lot.date),
      ir: money(t.ir),
      iof: money(t.iof),
    };
  });
  const gross = out.reduce((s, l) => s.add(l.value), currency(0)).value;
  const ir = out.reduce((s, l) => s.add(l.ir), currency(0)).value;
  const iof = out.reduce((s, l) => s.add(l.iof), currency(0)).value;
  return {
    at,
    lots: out,
    curve,
    gross,
    ir,
    iof,
    net: currency(gross).subtract(ir).subtract(iof).value,
    redemptions,
    cdiThrough,
  };
}

/** IR + IOF estimados dos resgates entre a base (exclusive) e `until`. */
export const taxWithheld = (p: Position, from: Date, until: Date) =>
  p.redemptions
    .filter((r) => day(r.date) > day(from) && day(r.date) <= day(until))
    .reduce((s, r) => s.add(r.ir).add(r.iof), currency(0)).value;

/**
 * O banco longe da curva: taxa cadastrada errada, movimento faltando ou o
 * banco rendendo menos. Fora da tolerância, vale conferir antes de fechar.
 */
// ponytail: tolerância fixa de 0,05% (mín. R$ 1); vira campo se algum produto oscilar mais.
export function curveGap(p: Position, bankGross: number | null) {
  if (p.curve === null || bankGross === null) return null;
  const gap = currency(bankGross).subtract(p.curve).value;
  const tolerance = Math.max(1, Math.abs(p.curve) * 0.0005);
  return { gap, off: Math.abs(gap) > tolerance };
}

/** Lê a resposta da SGS (`[{ data: "dd/MM/yyyy", valor: "0.055131" }]`). */
export const parseSgs = (rows: { data: string; valor: string }[]): CdiSeries =>
  Object.fromEntries(
    rows.map(({ data, valor }) => {
      const [d, m, y] = data.split("/");
      return [`${y}-${m}-${d}`, Number(valor)];
    }),
  );
