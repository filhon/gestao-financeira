/**
 * Gera o PDF da Análise com os dados reais de uma empresa. SÓ LEITURA.
 *
 *   npm run pdf:analytics -- --company=<id> [--from=2026-01 --to=2026-12]
 *       [--out=arquivo.pdf] [--ai]
 *
 * Sem --company, usa a empresa com "Hebron" no nome. Lê lançamentos, plano de
 * contas, centros, recorrências, contas bancárias, extratos e envelopes com o
 * Admin SDK e monta o mesmo AnalyticsReport da rota. --ai chama a IA (resumo
 * e destaques) e mostra o que a conferência aprovou e descartou; sem --ai, o
 * PDF sai com o resumo por regra.
 *
 * O caixa de hoje e os envelopes repetem, em versão de servidor, o que a tela
 * lê pelo SDK do cliente (readBankCash e getBudgetProgressByCostCenter).
 */
import admin from "firebase-admin";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import currency from "currency.js";
import { format } from "date-fns";
import { renderToBuffer } from "@react-pdf/renderer";
import { GoogleGenAI } from "@google/genai";
import {
  aiPrompt,
  analysisBrief,
  buildAnalytics,
  factsText,
  ruleSummary,
  verifyAiText,
  verifyAttention,
  type EnvelopeLeaf,
} from "../src/lib/analytics";
import {
  informedBalance,
  investmentBalance,
  isDuplicate,
  isInvestment,
  isSweep,
} from "../src/lib/bankReconciliation";
import { isLiquidReserve } from "../src/lib/investment";
import { envelopePace, envelopeStatus } from "../src/lib/dashboardRules";
import React from "react";
import type {
  BankAccount,
  BankTransaction,
  ChartAccount,
  CostCenter,
  RecurringTransactionTemplate,
  Transaction,
} from "../src/lib/types";

const root = path.join(__dirname, "..");
const arg = (name: string) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? null;

const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
  : JSON.parse(
      readFileSync(path.join(root, "serviceAccountKey.json"), "utf-8"),
    );
admin.initializeApp({ credential: admin.credential.cert(key) });
const db = admin.firestore();

const BRT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const wall = (d: Date) => {
  const p = Object.fromEntries(
    BRT.formatToParts(d).map((x) => [x.type, Number(x.value)]),
  );
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
};
const ts = (v: unknown) =>
  v instanceof admin.firestore.Timestamp ? wall(v.toDate()) : undefined;
const dayKey = (d: Date) => format(d, "yyyy-MM-dd");

async function main() {
  let companyId = arg("company");
  if (!companyId) {
    const all = await db.collection("companies").get();
    companyId =
      all.docs.find((d) => /hebron/i.test(d.get("name") ?? ""))?.id ?? null;
  }
  if (!companyId) throw new Error("Empresa não encontrada; use --company=");
  const company = await db.collection("companies").doc(companyId).get();
  const companyName: string = company.get("name");
  const today = wall(new Date());
  const year = today.getFullYear();
  const range = {
    from: arg("from") ?? `${year}-01`,
    to: arg("to") ?? `${year}-12`,
  };
  const by = (name: string) =>
    db.collection(name).where("companyId", "==", companyId);

  const [txSnap, accSnap, ccSnap, entSnap, tplSnap, bankSnap] =
    await Promise.all([
      by("transactions").get(),
      by("chart_of_accounts").get(),
      by("cost_centers").get(),
      by("entities").select("name").get(),
      by("recurring_templates").where("active", "==", true).get(),
      by("bank_accounts").get(),
    ]);

  const transactions = txSnap.docs.flatMap((d) => {
    const data = d.data();
    const dueDate = ts(data.dueDate);
    if (!dueDate) return [];
    return [
      {
        ...data,
        id: d.id,
        dueDate,
        paymentDate: ts(data.paymentDate),
        createdAt: ts(data.createdAt),
        updatedAt: ts(data.updatedAt),
      } as Transaction,
    ];
  });
  const costCenters = ccSnap.docs.map(
    (d) => ({ ...d.data(), id: d.id }) as CostCenter,
  );
  const report = buildAnalytics(
    {
      transactions,
      accounts: accSnap.docs.map(
        (d) => ({ ...d.data(), id: d.id }) as ChartAccount,
      ),
      costCenters,
      entities: entSnap.docs.map((d) => ({ id: d.id, name: d.get("name") })),
      templates: tplSnap.docs.map(
        (d) =>
          ({
            ...d.data(),
            id: d.id,
            nextDueDate: ts(d.get("nextDueDate")),
            endDate: ts(d.get("endDate")),
            createdAt: ts(d.get("createdAt")),
            updatedAt: ts(d.get("updatedAt")),
          }) as RecurringTransactionTemplate,
      ),
    },
    {
      range,
      compare: "year",
      regime: "cash",
      today,
      anchorEntityId: company.get("analyticsAnchorEntityId") ?? null,
    },
  );

  // Contas bancárias, como bankAccountService.fromDoc.
  const accounts: BankAccount[] = bankSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        ...data,
        id: d.id,
        openingBalanceDate: ts(data.openingBalanceDate),
        statementBalanceDate: ts(data.statementBalanceDate),
        closings: (data.closings ?? []).map((c: Record<string, unknown>) => ({
          ...c,
          through: ts(c.through),
          closedAt: ts(c.closedAt),
        })),
      } as BankAccount;
    })
    .filter((a) => a.active);
  const itemsOf = async (accountId: string) =>
    (
      await db
        .collection("reconciliation_sessions")
        .doc(companyId!)
        .collection("items")
        .where("bankAccountId", "==", accountId)
        .get()
    ).docs.map((d) => ({ id: d.id, ...d.data() }) as BankTransaction);

  // Caixa de hoje, como readBankCash (contas correntes + aplicação automática).
  const checking = accounts.filter((a) => !isInvestment(a));
  let cash: number | null = null;
  let bankBalance: number | null = null;
  const yields = new Map<string, number>();
  const positions = await Promise.all(
    accounts.map(async (a) => {
      const base = { id: a.id, name: a.name, investment: isInvestment(a) };
      if (!isInvestment(a)) return { ...base, ...informedBalance(a) };
      const items = await itemsOf(a.id);
      for (const it of items) {
        if (it.origin !== "yield" || isDuplicate(it)) continue;
        const k = format(new Date(it.date), "yyyy-MM");
        yields.set(k, currency(yields.get(k) ?? 0).add(it.amount).value);
      }
      return { ...base, ...investmentBalance(a, items) };
    }),
  );
  if (checking.length) {
    const bases = new Map(checking.map((a) => [a.id, informedBalance(a)]));
    const newest = dayKey(
      new Date(Math.max(...[...bases.values()].map((b) => b.date.getTime()))),
    );
    const oldest = new Date(
      Math.min(...[...bases.values()].map((b) => b.date.getTime())),
    );
    const investmentIds = new Set(
      accounts.filter(isInvestment).map((a) => a.id),
    );
    const paid = transactions.filter(
      (t) => t.status === "paid" && t.paymentDate && t.paymentDate > oldest,
    );
    const after = (withInvestments: boolean) => {
      let total = currency(0);
      for (const t of paid) {
        const k = dayKey(t.paymentDate!);
        if (k > dayKey(today) || investmentIds.has(t.bankAccountId ?? ""))
          continue;
        const b = bases.get(t.bankAccountId ?? "");
        if (k <= (b ? dayKey(b.date) : newest)) continue;
        const v = Number(t.finalAmount ?? t.amount) || 0;
        total = t.type === "receivable" ? total.add(v) : total.subtract(v);
      }
      const invested = positions.filter(
        (p) =>
          p.investment &&
          (withInvestments || isSweep(accounts.find((a) => a.id === p.id))),
      );
      return [...bases.values(), ...invested].reduce(
        (s, b) => s.add(b.balance),
        total,
      ).value;
    };
    cash = after(false);
    bankBalance = after(true);
  }
  // ponytail: reserva pelo saldo bruto; a tela usa o líquido de IR (CDI).
  const liquidReserve = positions
    .filter((p) => accounts.find((a) => a.id === p.id && isLiquidReserve(a)))
    .reduce((s, p) => s.add(p.balance), currency(0)).value;

  // Envelopes, como getBudgetProgressByCostCenter (só folhas importam aqui).
  const exercise = Number(range.to.slice(0, 4));
  const ledgerSnap = await by("cost_center_ledger")
    .where("year", "==", exercise)
    .get();
  const ledger = new Map(
    ledgerSnap.docs.map((d) => [d.get("costCenterId"), d.data()]),
  );
  const pace = envelopePace(exercise, today);
  const budget = costCenters.map((cc) => {
    const l = ledger.get(cc.id) ?? {};
    const isLeaf = !costCenters.some((c) => c.parentId === cc.id);
    const envelope = Number(l.received ?? 0);
    const committed = currency(l.allocatedToChildren ?? 0).add(
      l.spentDirect ?? 0,
    ).value;
    const paidV = Number(l.spentDirectPaid ?? 0);
    const st = envelopeStatus(envelope, committed, paidV, isLeaf, pace);
    return {
      id: cc.id,
      name: cc.name,
      spent: committed,
      paid: paidV,
      spentDirect: Number(l.spentDirect ?? 0),
      allocated: Number(l.allocatedToChildren ?? 0),
      budget: envelope,
      available: currency(envelope).subtract(committed).value,
      isLeaf,
      ...st,
    };
  });
  const envelopes: EnvelopeLeaf[] = budget.map(
    ({ name, status, isLeaf, tight }) => ({ name, status, isLeaf, tight }),
  );

  const brief = analysisBrief(report, { cash, envelopes });
  const facts = factsText(report, brief, companyName);
  // O que volta quando a IA falha tem de passar na própria conferência.
  const fallback = verifyAiText(
    [
      ...ruleSummary(brief),
      ...brief.attention.map((i) => i.text),
      ...Object.values(brief.headlines).flatMap((h) => (h ? [`${h}.`] : [])),
    ].join(String.fromCharCode(10)),
    facts,
  );
  console.log(
    fallback.dropped.length
      ? `Textos de modelo reprovados: ${JSON.stringify(fallback.dropped, null, 1)}`
      : `Textos de modelo: ${fallback.kept.length} frases, todas conferem com os fatos.`,
  );
  let summary = {
    sentences: ruleSummary(brief),
    source: "rules" as "ai" | "rules",
  };
  let attention: ((typeof brief.attention)[number] & { ai?: boolean })[] =
    brief.attention;

  if (process.argv.includes("--ai")) {
    if (!process.env.GEMINI_API_KEY) {
      const env = readFileSync(path.join(root, ".env.local"), "utf-8");
      const m = env.match(/^GEMINI_API_KEY=(.*)$/m);
      if (m) process.env.GEMINI_API_KEY = m[1].trim();
    }
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const ask = async (prompt: string, json = false) =>
      (
        await client.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            temperature: 0.2,
            ...(json ? { responseMimeType: "application/json" } : {}),
          },
        })
      ).text ?? "";
    const sumText = await ask(aiPrompt.summary(facts));
    const sv = verifyAiText(sumText, facts);
    console.log("\n── Resumo da IA ──");
    sv.kept.forEach((k) => console.log("  ✓", k));
    sv.dropped.forEach((d) => console.log("  ✗", d.sentence, "→", d.reason));
    if (sv.kept.length >= 2) summary = { sentences: sv.kept, source: "ai" };

    if (brief.attention.length) {
      const attText = await ask(aiPrompt.attention(brief.attention), true);
      attention = verifyAttention(brief.attention, JSON.parse(attText));
      console.log("\n── Destaques ──");
      attention.forEach((a) =>
        console.log(a.ai ? "  IA " : "  modelo", a.text),
      );
    }

    for (const q of [
      "Quanto da receita veio da mantenedora?",
      "Qual conta contábil mais pesou nas despesas?",
      "Quanto vamos gastar com folha em 2028?",
    ]) {
      const ans = await ask(aiPrompt.question(facts, q));
      const v = verifyAiText(ans, facts);
      console.log(`\n── ${q}`);
      v.kept.forEach((k) => console.log("  ✓", k));
      v.dropped.forEach((d) => console.log("  ✗", d.sentence, "→", d.reason));
    }
  }

  // jiti compila JSX no modo clássico (React.createElement solto).
  Object.assign(globalThis, { React });
  const { registerPdfFonts, renderAnalyticsPdf } = await import(
    "../src/components/features/analytics/AnalyticsPdf"
  );
  registerPdfFonts(path.join(root, "public/fonts/pdf"));

  // Conferência independente do que as tabelas do anexo mostram.
  const sum = (xs: number[]) =>
    xs.reduce((t, x) => t.add(x), currency(0)).value;
  const inRange = report.trend.filter(
    (m) => m.key >= range.from && m.key <= range.to,
  );
  const checks: [string, number, number][] = [
    [
      "receitas do período (A3)",
      sum(inRange.map((m) => m.inflow)),
      report.totals.inflow,
    ],
    [
      "despesas do período (A3)",
      sum(inRange.map((m) => m.outflow)),
      report.totals.outflow,
    ],
    [
      "recebido mês a mês (A6) = ponte",
      sum(report.plan.receivable.months.map((m) => m.realized)),
      report.plan.receivable.bridge.realized,
    ],
    [
      "previsto mês a mês (A8) = ponte",
      sum(report.plan.payable.months.map((m) => m.planned)),
      report.plan.payable.bridge.planned,
    ],
    [
      "receitas por contraparte (A13) = período",
      sum([
        ...report.concentration.receivable.top.map((c) => c.value),
        report.concentration.receivable.rest,
      ]),
      report.totals.inflow,
    ],
  ];
  if (brief.projection) {
    const p = brief.projection;
    const used = p.byStage.filter((b) =>
      ["confirmed", "approved", "in_approval", "recurring"].includes(b.stage),
    );
    checks.push([
      "saldo final da projeção (A2) = caixa + entradas − saídas",
      p.closing,
      currency(p.opening)
        .add(sum(used.map((b) => b.inflow)))
        .subtract(sum(used.map((b) => b.outflow))).value,
    ]);
  }
  for (const [label, got, want] of checks)
    console.log(`${got === want ? "ok " : "ERRO"} ${label}: ${got} / ${want}`);
  const started = Date.now();
  const buffer = await renderAnalyticsPdf(
    {
      report,
      brief,
      companyName,
      generatedAt: new Date(),
      transactionCount: transactions.length,
      summary,
      attention,
      budget,
      accounts: {
        positions: positions.map((p) => ({ ...p, date: new Date(p.date) })),
        yields: Object.fromEntries(yields),
      },
      liquidReserve,
      bankBalance,
    },
    (doc) => renderToBuffer(doc),
  );
  const out = arg("out") ?? path.join(root, "analise.pdf");
  writeFileSync(out, buffer);
  console.log(
    `\n${companyName}: ${transactions.length} lançamentos; caixa ${cash}; PDF ${(buffer.length / 1024).toFixed(0)} KB em ${Date.now() - started} ms → ${out}`,
  );
  if (process.argv.includes("--facts")) console.log(`\n${facts}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
