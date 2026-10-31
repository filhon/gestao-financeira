/**
 * Auditoria READ-ONLY: extratos do banco (OFX + PDF de investimentos) × lançamentos pagos.
 *
 * Não escreve nada no Firestore. Lê os arquivos, cruza movimento a movimento
 * com os lançamentos pagos e grava uma planilha com o que não bate.
 *
 * Patrimônio no banco = conta corrente + aplicação automática (saldo total do
 * OFX) + CDBs (saldo bruto dos PDFs). Aplicação/resgate automático é
 * movimento interno; aplicação/resgate de CDB é transferência; rendimentos e
 * IR/IOF são receita/despesa que o sistema deveria ter.
 *
 * Uso:
 *   node scripts/audit-bank-statements.mjs --company=<id> --ofx=<pasta> --pdf=<pasta> --out=<arquivo.xlsx>
 *
 * Credenciais: FIREBASE_SERVICE_ACCOUNT_KEY, ou serviceAccountKey.json na raiz.
 */
import admin from "firebase-admin";
import ExcelJS from "exceljs";
import currency from "currency.js";
import { execFileSync } from "child_process";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const companyId = arg("company");
const ofxDir = arg("ofx");
const pdfDir = arg("pdf");
const outFile = arg("out") ?? "auditoria-extratos.xlsx";
if (!companyId || !ofxDir) {
  console.error(
    "Uso: --company=<id> --ofx=<pasta> [--pdf=<pasta>] [--out=x.xlsx]",
  );
  process.exit(1);
}

const cents = (v) => currency(v).intValue;
const brl = (c) => c / 100;
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const spDay = (d) =>
  d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const dayDiff = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

// ─── OFX ─────────────────────────────────────────────────────────────────────
function kindOf(memo) {
  const m = norm(memo);
  if (/^(SALDO|SDO)\b/.test(m)) return "saldo";
  if (/^(APL|RES) APLIC AUT/.test(m)) return "interno"; // conta ↔ aplicação automática
  if (/REND PAGO APLIC AUT|^RENDIMENTOS/.test(m)) return "rendimento";
  if (/CDB/.test(m)) return "cdb";
  return "movimento";
}

const bankLines = [];
// Arquivos mensais: um dia pertence ao primeiro arquivo que o traz; outro
// arquivo repetindo o dia (recorte sobreposto) não conta de novo.
const dayOwner = new Map();
for (const file of readdirSync(ofxDir)
  .filter((f) => /\.ofx$/i.test(f))
  .sort()) {
  const text = readFileSync(path.join(ofxDir, file), "utf-8");
  for (const block of text.split("<STMTTRN>").slice(1)) {
    const tag = (t) =>
      block.match(new RegExp(`<${t}>([^\\r\\n<]*)`))?.[1]?.trim();
    const date = tag("DTPOSTED")
      .slice(0, 8)
      .replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
    if ((dayOwner.get(date) ?? file) !== file) continue;
    dayOwner.set(date, file);
    const memo = tag("MEMO") ?? "";
    bankLines.push({
      file,
      date,
      memo,
      amount: cents(tag("TRNAMT").replace(",", ".")),
      kind: kindOf(memo),
    });
  }
}
bankLines.sort((a, b) => a.date.localeCompare(b.date));
const firstDay = bankLines.find(
  (l) => l.kind !== "saldo" || !/ANTERIOR/.test(norm(l.memo)),
)?.date;
const lastDay = bankLines.at(-1).date;

// Saldo total (conta + aplicação automática): abertura e conferência diária.
const opening = bankLines.find((l) => /^SALDO ANTERIOR/.test(norm(l.memo)));
const totalLines = bankLines.filter((l) =>
  /^SALDO TOTAL DISPONIVEL/.test(norm(l.memo)),
);
const flows = bankLines.filter(
  (l) => l.kind !== "saldo" && l.kind !== "interno",
);
const dailyCheck = totalLines.map((t) => {
  const computed = flows
    .filter((l) => l.date > opening.date && l.date <= t.date)
    .reduce((s, l) => s + l.amount, opening.amount);
  return { date: t.date, bank: t.amount, computed, diff: t.amount - computed };
});

// ─── PDF de investimentos ────────────────────────────────────────────────────
const toCents = (s) => cents(s.replace(/\./g, "").replace(",", "."));
const brDate = (s) => s.split("/").reverse().join("-");
const investments = []; // { product, month, start, end, prevBalance, finalBalance, applied, redeemedGross, credited }
if (pdfDir) {
  for (const file of readdirSync(pdfDir)
    .filter((f) => /\.pdf$/i.test(f))
    .sort()) {
    const text = execFileSync(
      "pdftotext",
      ["-layout", "-enc", "UTF-8", path.join(pdfDir, file), "-"],
      {
        encoding: "utf-8",
      },
    );
    for (const block of text
      .split(/Extrato de movimenta\S+ mensal - /)
      .slice(1)) {
      const product = block.split(/\r?\n/)[0].trim();
      const period = block.match(
        /(\d{2}\/\d{2}\/\d{4}) \S (\d{2}\/\d{2}\/\d{4})/,
      );
      const prev = block.match(
        /(\d{2}\/\d{2}\/\d{4}) SALDO ANTERIOR\s+([\d.,]+)/,
      );
      const fin = block.match(/(\d{2}\/\d{2}\/\d{4}) SALDO FINAL\s+([\d.,]+)/);
      if (!period || !prev || !fin) continue;
      let applied = 0,
        redeemedGross = 0,
        credited = 0;
      for (const m of block.matchAll(
        /^\d{2}\/\d{2}\/\d{4} (APLICACAO|RESGATE|VENCIMENTO)\s+([\d.,]+)(.*)$/gm,
      )) {
        if (m[1] === "APLICACAO") applied += toCents(m[2]);
        else {
          redeemedGross += toCents(m[2]);
          // Colunas depois do valor bruto: [IOF] [IR] creditado principal ... — o creditado é o 1º valor > 1000 depois dos impostos? Não: pegamos o penúltimo valor monetário antes das %.
          const nums = [...m[3].matchAll(/[\d.]+,\d{2}/g)].map((x) =>
            toCents(x[0]),
          );
          // nums: [IOF?, IR?, creditado, principal, rem%, rentab%] → creditado = nums[len-4]
          credited += nums.length >= 4 ? nums[nums.length - 4] : 0;
        }
      }
      // O mesmo produto/mês em dois PDFs (extrato geral + recorte) conta uma vez.
      if (
        investments.some(
          (i) => i.product === product && i.end === brDate(fin[1]),
        )
      )
        continue;
      investments.push({
        file,
        product,
        start: brDate(period[1]),
        end: brDate(fin[1]),
        prevDate: brDate(prev[1]),
        prevBalance: toCents(prev[2]),
        finalBalance: toCents(fin[2]),
        applied,
        redeemedGross,
        credited,
      });
    }
  }
}

// ─── Firestore ───────────────────────────────────────────────────────────────
const envKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
admin.initializeApp({
  credential: admin.credential.cert(
    envKey
      ? JSON.parse(envKey)
      : JSON.parse(
          readFileSync(path.join(rootDir, "serviceAccountKey.json"), "utf-8"),
        ),
  ),
});
const db = admin.firestore();
db.settings({ preferRest: true });
const snap = await db
  .collection("transactions")
  .where("companyId", "==", companyId)
  .where("status", "==", "paid")
  .get();
const digits = (s) => (s ?? "").replace(/\D/g, "");
const entities = await db
  .collection("entities")
  .where("companyId", "==", companyId)
  .get();
const entityDoc = new Map(
  entities.docs.map((d) => [d.id, digits(d.data().document)]),
);
const sys = snap.docs.map((d) => {
  const t = d.data();
  const value = cents(Number(t.finalAmount ?? t.amount) || 0);
  return {
    id: d.id,
    type: t.type,
    signed: t.type === "receivable" ? value : -value,
    // Baixa sem data (lotes de janeiro): vale o vencimento, marcado em `noPaymentDate`.
    paymentDate: t.paymentDate
      ? spDay(t.paymentDate.toDate())
      : t.dueDate
        ? spDay(t.dueDate.toDate())
        : null,
    noPaymentDate: !t.paymentDate,
    dueDate: t.dueDate ? spDay(t.dueDate.toDate()) : null,
    description: t.description ?? "",
    who: t.supplierOrClient ?? "",
    doc: entityDoc.get(t.entityId) ?? "",
    batchId: t.batchId ?? "",
    matched: null,
  };
});
const inRange = (d) => d && d >= firstDay && d <= lastDay;

// ─── Cruzamento ──────────────────────────────────────────────────────────────
// Passes do mais certo ao mais frouxo: mesmo valor e data de pagamento perto,
// depois lançamentos sem data de pagamento pelo vencimento.
const toMatch = bankLines.filter(
  (l) => l.kind !== "saldo" && l.kind !== "interno",
);
const passes = [
  { name: "valor + pagamento ±3d", field: "paymentDate", days: 3 },
  { name: "valor + pagamento ±10d", field: "paymentDate", days: 10 },
];
for (const pass of passes) {
  for (const line of toMatch) {
    if (line.match) continue;
    let best = null;
    for (const t of sys) {
      if (t.matched || t.signed !== line.amount) continue;
      const d = t[pass.field];
      if (!d) continue;
      const diff = dayDiff(d, line.date);
      if (diff <= pass.days && (!best || diff < best.diff)) best = { t, diff };
    }
    if (best) {
      best.t.matched = line;
      line.match = { t: best.t, diff: best.diff, pass: pass.name };
    }
  }
}

// Um movimento do banco = vários lançamentos (o banco junta as parcelas do
// mesmo favorecido numa transferência só). Favorecido pelo CPF/CNPJ do
// histórico; sem documento, pelo nome do lançamento dentro do histórico.
const memoDoc = (memo) =>
  digits(
    memo.match(
      /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}/,
    )?.[0],
  );
const samePayee = (line, t) => {
  const doc = memoDoc(line.memo);
  if (doc && t.doc) return doc === t.doc;
  const who = norm(t.who)
    .replace(/[^A-Z ]/g, "")
    .slice(0, 18)
    .trim();
  return who.length >= 6 && norm(line.memo).includes(who);
};
for (const line of toMatch.filter((l) => !l.match && l.kind === "movimento")) {
  const near = sys.filter(
    (t) =>
      !t.matched &&
      t.paymentDate &&
      dayDiff(t.paymentDate, line.date) <= 5 &&
      Math.sign(t.signed) === Math.sign(line.amount),
  );
  const payee = near.filter((t) => samePayee(line, t));
  const pool = payee.length >= 2 ? payee : near;
  if (pool.length < 2) continue;
  const total = pool.reduce((s, t) => s + t.signed, 0);
  if (total === line.amount) {
    pool.forEach((t) => (t.matched = line));
    line.match = {
      group: pool,
      diff: 0,
      pass: `soma de ${pool.length} lançamentos (favorecido)`,
    };
    continue;
  }
  if (pool.length > 20) continue;
  // ponytail: subset-sum por força bruta, limitado a 20 candidatos (2^20); acima disso fica sem par.
  const n = pool.length;
  for (let mask = 3; mask < 1 << n; mask++) {
    if ((mask & (mask - 1)) === 0) continue;
    let s = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) s += pool[i].signed;
    if (s !== line.amount) continue;
    const group = pool.filter((_, i) => mask & (1 << i));
    group.forEach((t) => (t.matched = line));
    line.match = {
      group,
      diff: 0,
      pass: `soma de ${group.length} lançamentos`,
    };
    break;
  }
}

// O que sobrou com o mesmo favorecido nos mesmos dias: a soma não fecha, mas o
// par é esse. Vira divergência (banco × sistema), não duas listas soltas.
for (const line of toMatch.filter((l) => !l.match && l.kind === "movimento")) {
  const group = sys.filter(
    (t) =>
      !t.matched &&
      !t.partial &&
      t.paymentDate &&
      dayDiff(t.paymentDate, line.date) <= 5 &&
      Math.sign(t.signed) === Math.sign(line.amount) &&
      samePayee(line, t),
  );
  if (!group.length) continue;
  group.forEach((t) => (t.partial = line));
  line.partial = { group, sysTotal: group.reduce((s, t) => s + t.signed, 0) };
}

// ─── Resumo mensal ───────────────────────────────────────────────────────────
const months = [...new Set(bankLines.map((l) => l.date.slice(0, 7)))]
  .filter((m) => m >= firstDay.slice(0, 7))
  .sort();
// Conta + aplicação automática no fim do mês: abertura + movimentos (a
// conferência diária prova que essa soma bate com o saldo do banco).
const lastTotalOfMonth = (m) =>
  flows
    .filter((l) => l.date.slice(0, 7) <= m)
    .reduce((s, l) => s + l.amount, opening.amount);
const cdbOfMonth = (m) => {
  const rows = investments.filter((i) => i.end.startsWith(m));
  return rows.length ? rows.reduce((s, i) => s + i.finalBalance, 0) : null;
};
const cdbOpening = investments
  .filter((i) => i.prevDate === opening.date)
  .reduce((s, i) => s + i.prevBalance, 0);
const sysOpening = sys
  .filter((t) => t.paymentDate && t.paymentDate <= opening.date)
  .reduce((s, t) => s + t.signed, 0);

const summary = months.map((m) => {
  const lines = toMatch.filter((l) => l.date.startsWith(m));
  const sum = (arr, f = (x) => x.amount) => arr.reduce((s, x) => s + f(x), 0);
  const bankOnly = lines.filter((l) => !l.match && !l.partial);
  const partial = lines.filter((l) => l.partial);
  const sysMonth = sys.filter((t) => t.paymentDate?.startsWith(m));
  const sysOnly = sysMonth.filter((t) => !t.matched && !t.partial);
  const cash = lastTotalOfMonth(m);
  const cdb = cdbOfMonth(m);
  const inv = investments.filter((i) => i.end.startsWith(m));
  const cdbYield = sum(
    inv,
    (i) => i.finalBalance - i.prevBalance - i.applied + i.redeemedGross,
  );
  const cdbTax = sum(inv, (i) => i.redeemedGross - i.credited);
  return {
    month: m,
    cash,
    cdb,
    total: cash !== null && cdb !== null ? cash + cdb : null,
    bankNet: sum(lines),
    sysNet: sum(sysMonth, (t) => t.signed),
    lines: lines.length,
    matched: lines.filter((l) => l.match).length,
    partialN: partial.length,
    partialDiff: sum(partial, (l) => l.amount - l.partial.sysTotal),
    bankOnlyN: bankOnly.filter((l) => l.kind === "movimento").length,
    bankOnly: sum(bankOnly.filter((l) => l.kind === "movimento")),
    cdbFlows: sum(lines.filter((l) => l.kind === "cdb" && !l.match)),
    autYield: sum(lines.filter((l) => l.kind === "rendimento" && !l.match)),
    cdbYield,
    cdbTax,
    sysOnlyN: sysOnly.length,
    sysOnly: sum(sysOnly, (t) => t.signed),
  };
});

// Total por dia: o que importa para o saldo é o dinheiro do dia bater, mesmo
// que o favorecido do banco (quem recebe) não seja a entidade do sistema.
const byDay = new Map();
const dayRow = (d) => {
  if (!byDay.has(d))
    byDay.set(d, { date: d, bank: 0, cdb: 0, sys: 0, sysN: 0 });
  return byDay.get(d);
};
for (const l of toMatch)
  l.kind === "cdb"
    ? (dayRow(l.date).cdb += l.amount)
    : (dayRow(l.date).bank += l.amount);
for (const t of sys.filter((t) => inRange(t.paymentDate))) {
  const r = dayRow(t.paymentDate);
  r.sys += t.signed;
  r.sysN++;
}
const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
// Diferença acumulada: o desvio de um dia que outro dia compensa (data de baixa trocada) some no acumulado.
let running = 0;
for (const r of days) {
  r.diff = r.bank - r.sys;
  // Sistema lançou aplicação/resgate de CDB como despesa/receita: a diferença some quando o CDB entra.
  r.diffWithCdb = r.bank + r.cdb - r.sys;
  running += r.diff;
  r.running = running;
}

// ─── Planilha ────────────────────────────────────────────────────────────────
const wb = new ExcelJS.Workbook();
const money = "#,##0.00;[Red]-#,##0.00";
const sheet = (name, cols, rows) => {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map(([header, key, width, fmt]) => ({
    header,
    key,
    width,
    style: fmt ? { numFmt: fmt } : {},
  }));
  ws.getRow(1).font = { bold: true };
  ws.addRows(rows);
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: cols.length },
  };
  return ws;
};

sheet(
  "Resumo",
  [
    ["Mês", "month", 9],
    ["Conta+aplic. aut. (banco)", "cash", 18, money],
    ["CDBs (PDF, bruto)", "cdb", 16, money],
    ["Patrimônio no banco", "total", 18, money],
    ["Movim. líquido banco", "bankNet", 18, money],
    ["Movim. líquido sistema", "sysNet", 18, money],
    ["Linhas banco", "lines", 10],
    ["Pareadas", "matched", 10],
    ["Divergências (qtd)", "partialN", 12],
    ["Divergências banco−sistema", "partialDiff", 16, money],
    ["Só banco (qtd)", "bankOnlyN", 11],
    ["Só banco (R$)", "bankOnly", 15, money],
    ["CDB aplic/resgate sem par", "cdbFlows", 16, money],
    ["Rend. aplic. aut. sem par", "autYield", 16, money],
    ["Rend. CDB bruto (PDF)", "cdbYield", 16, money],
    ["IR/IOF CDB (PDF)", "cdbTax", 14, money],
    ["Só sistema (qtd)", "sysOnlyN", 12],
    ["Só sistema (R$)", "sysOnly", 15, money],
  ],
  summary.map((s) =>
    Object.fromEntries(
      Object.entries(s).map(([k, v]) => [
        k,
        typeof v === "number" && !/N$|lines|matched/.test(k) ? brl(v) : v,
      ]),
    ),
  ),
);

sheet(
  "Por dia",
  [
    ["Dia", "date", 11],
    ["Banco (sem CDB)", "bank", 16, money],
    ["CDB aplic/resgate", "cdb", 16, money],
    ["Sistema", "sys", 16, money],
    ["Lanç. sistema", "sysN", 8],
    ["Diferença", "diff", 14, money],
    ["Dif. se CDB contasse", "diffWithCdb", 16, money],
    ["Diferença acumulada", "running", 16, money],
  ],
  days.map((r) => ({
    ...r,
    bank: brl(r.bank),
    cdb: brl(r.cdb),
    sys: brl(r.sys),
    diff: brl(r.diff),
    diffWithCdb: brl(r.diffWithCdb),
    running: brl(r.running),
  })),
);

sheet(
  "Divergências",
  [
    ["Data banco", "date", 11],
    ["Histórico", "memo", 60],
    ["Banco", "amount", 14, money],
    ["Sistema", "sysTotal", 14, money],
    ["Diferença", "diff", 14, money],
    ["Lançamentos", "n", 6],
    ["Ids", "ids", 40],
    ["Descrições", "desc", 80],
  ],
  toMatch
    .filter((l) => l.partial)
    .map((l) => ({
      date: l.date,
      memo: l.memo,
      amount: brl(l.amount),
      sysTotal: brl(l.partial.sysTotal),
      diff: brl(l.amount - l.partial.sysTotal),
      n: l.partial.group.length,
      ids: l.partial.group.map((t) => t.id).join(", "),
      desc: l.partial.group
        .map((t) => `${t.description} (${brl(t.signed)}, pg ${t.paymentDate})`)
        .join(" | "),
    })),
);

sheet(
  "Só no banco",
  [
    ["Data", "date", 11],
    ["Tipo", "kind", 11],
    ["Histórico", "memo", 70],
    ["Valor", "amount", 14, money],
    ["Arquivo", "file", 36],
  ],
  toMatch
    .filter((l) => !l.match && !l.partial)
    .map((l) => ({ ...l, amount: brl(l.amount) })),
);

const sysRow = (t) => ({
  id: t.id,
  type: t.type === "receivable" ? "receita" : "despesa",
  paymentDate: t.paymentDate ?? "",
  dueDate: t.dueDate ?? "",
  value: brl(t.signed),
  description: t.description,
  who: t.who,
  batchId: t.batchId,
  note: t.noPaymentDate
    ? "sem data de pagamento (usado o vencimento)"
    : !inRange(t.paymentDate)
      ? "fora do período dos extratos"
      : "",
});
const sysCols = [
  ["Id", "id", 22],
  ["Tipo", "type", 9],
  ["Pagamento", "paymentDate", 11],
  ["Vencimento", "dueDate", 11],
  ["Valor", "value", 14, money],
  ["Descrição", "description", 50],
  ["Fornecedor/cliente", "who", 36],
  ["Lote", "batchId", 22],
  ["Obs.", "note", 26],
];
sheet(
  "Só no sistema",
  sysCols,
  sys
    .filter((t) => !t.matched && !t.partial)
    .sort((a, b) => (a.paymentDate ?? "z").localeCompare(b.paymentDate ?? "z"))
    .map(sysRow),
);

// Data do banco para cada lançamento pareado: o que corrigir em `paymentDate`.
sheet(
  "Datas de pagamento",
  [
    ["Id", "id", 22],
    ["Pagamento no sistema", "paymentDate", 12],
    ["Vencimento", "dueDate", 11],
    ["Data no banco", "bankDate", 12],
    ["Valor", "value", 14, money],
    ["Descrição", "description", 50],
    ["Obs.", "note", 26],
  ],
  sys
    .map((t) => ({ t, bankDate: (t.matched ?? t.partial)?.date ?? null }))
    .filter(
      ({ t, bankDate }) =>
        t.noPaymentDate || (bankDate && bankDate !== t.paymentDate),
    )
    .map(({ t, bankDate }) => ({
      id: t.id,
      paymentDate: t.noPaymentDate ? "" : t.paymentDate,
      dueDate: t.dueDate ?? "",
      bankDate: bankDate ?? "",
      value: brl(t.signed),
      description: t.description,
      note: t.noPaymentDate ? "sem data de pagamento" : "",
    })),
);

sheet(
  "Pareados",
  [
    ["Data banco", "date", 11],
    ["Histórico", "memo", 60],
    ["Valor", "amount", 14, money],
    ["Critério", "pass", 30],
    ["Dias", "diff", 6],
    ["Id(s) sistema", "ids", 40],
    ["Descrição sistema", "desc", 50],
  ],
  toMatch
    .filter((l) => l.match)
    .map((l) => {
      const ts = l.match.group ?? [l.match.t];
      return {
        date: l.date,
        memo: l.memo,
        amount: brl(l.amount),
        pass: l.match.pass,
        diff: l.match.diff,
        ids: ts.map((t) => t.id).join(", "),
        desc: ts.map((t) => t.description).join(" | "),
      };
    }),
);

sheet(
  "Conferência diária",
  [
    ["Dia", "date", 11],
    ["Saldo total banco", "bank", 16, money],
    ["Calculado", "computed", 16, money],
    ["Diferença", "diff", 14, money],
  ],
  dailyCheck.map((d) => ({
    date: d.date,
    bank: brl(d.bank),
    computed: brl(d.computed),
    diff: brl(d.diff),
  })),
);

sheet(
  "Investimentos",
  [
    ["Arquivo", "file", 40],
    ["Produto", "product", 14],
    ["Saldo anterior", "prevBalance", 15, money],
    ["Aplicações", "applied", 15, money],
    ["Resgates bruto", "redeemedGross", 15, money],
    ["Creditado", "credited", 15, money],
    ["Saldo final", "finalBalance", 15, money],
    ["Data final", "end", 11],
  ],
  investments.map((i) => ({
    ...i,
    prevBalance: brl(i.prevBalance),
    applied: brl(i.applied),
    redeemedGross: brl(i.redeemedGross),
    credited: brl(i.credited),
    finalBalance: brl(i.finalBalance),
  })),
);

await wb.xlsx.writeFile(outFile);

// ─── Console ─────────────────────────────────────────────────────────────────
const f = (c) =>
  c === null
    ? "—"
    : brl(c).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
console.log(
  `Extratos ${firstDay} → ${lastDay}: ${bankLines.length} linhas, ${toMatch.length} a parear`,
);
console.log(
  `Abertura ${opening.date}: conta+aut ${f(opening.amount)} + CDBs ${f(cdbOpening)} = ${f(opening.amount + cdbOpening)} | sistema até essa data: ${f(sysOpening)}`,
);
const badDays = dailyCheck.filter((d) => d.diff !== 0);
console.log(
  `Conferência diária do banco: ${dailyCheck.length} dias, ${badDays.length} com diferença`,
  badDays
    .slice(0, 5)
    .map((d) => `${d.date}:${f(d.diff)}`)
    .join(" "),
);
console.table(
  summary.map((s) => ({
    mês: s.month,
    patrimônio: f(s.total),
    banco: f(s.bankNet),
    sistema: f(s.sysNet),
    pareadas: `${s.matched}/${s.lines}`,
    divergências: `${s.partialN} ${f(s.partialDiff)}`,
    "só banco": `${s.bankOnlyN} ${f(s.bankOnly)}`,
    "só sistema": `${s.sysOnlyN} ${f(s.sysOnly)}`,
  })),
);
const badDaysTotal = days.filter((r) => r.diff !== 0);
console.log(
  `Por dia: ${days.length} dias, ${badDaysTotal.length} com diferença; acumulada no fim ${f(running)}`,
);
console.table(
  months.map((m) => {
    const ds = days.filter((r) => r.date.startsWith(m));
    return {
      mês: m,
      "dias c/ dif": ds.filter((r) => r.diff !== 0).length,
      "dif mês": f(ds.reduce((s, r) => s + r.diff, 0)),
      "dias que fecham c/ CDB": ds.filter(
        (r) => r.diff !== 0 && r.diffWithCdb === 0,
      ).length,
      acumulada: f(ds.at(-1)?.running ?? 0),
    };
  }),
);
const noDate = sys.filter((t) => t.noPaymentDate);
const later = sys.filter((t) => t.paymentDate > lastDay);
console.log(
  `Sistema: ${sys.length} pagos | sem data de pagamento ${noDate.length} (${f(noDate.reduce((s, t) => s + t.signed, 0))}) sem par ${noDate.filter((t) => !t.matched && !t.partial).length} | depois de ${lastDay}: ${later.length}`,
);
// Saldo do sistema no fim do mês × patrimônio no banco: tem que dar zero. O
// rendimento líquido dos CDBs do mês ajuda a explicar a diferença enquanto ele
// não estiver lançado.
console.table(
  summary.map((s) => {
    const end = `${s.month}-31`;
    const sysCum = sys
      .filter((t) => t.paymentDate && t.paymentDate <= end)
      .reduce((a, t) => a + t.signed, 0);
    return {
      mês: s.month,
      patrimônio: f(s.total),
      sistema: f(sysCum),
      diferença: f(s.total - sysCum),
      "rend. líq. CDB do mês": f(s.cdbYield - s.cdbTax),
    };
  }),
);
console.log(`Planilha: ${outFile}`);
process.exit(0);
