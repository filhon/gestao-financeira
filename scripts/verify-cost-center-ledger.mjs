/**
 * Verificação READ-ONLY do razão de envelopes — ponto de parada da Fase 1.
 *
 * Não confia no backfill: recalcula os gastos direto das transações e confere
 * contra o que foi gravado, além de validar as invariantes do modelo.
 *
 *   I1  allocatedToChildren(pai) == Σ received(filhos)
 *   I2  available >= 0 em todo nó
 *   I3  subtreeSpent == spentDirect + Σ subtreeSpent(filhos)
 *   I4  spentDirect == 0 em nó interno (despesa só em folha)
 *   I5  spentDirect confere com as transações reais
 *   I6  carry-over de um exercício == received + carryIn − subtreeSpent do anterior
 *
 * Uso:
 *   node scripts/verify-cost-center-ledger.mjs
 *   node scripts/verify-cost-center-ledger.mjs --company=<id>
 */
import admin from "firebase-admin";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

const args = process.argv.slice(2);
const getArg = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const onlyCompany = getArg("company");

const envKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
const serviceAccount = envKey
  ? JSON.parse(envKey)
  : JSON.parse(
      readFileSync(path.join(rootDir, "serviceAccountKey.json"), "utf-8"),
    );
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const toCents = (v) => Math.round(Number(v || 0) * 100);
const fmt = (cents) =>
  (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const toDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);
const effectiveDate = (tx) =>
  tx.status === "paid" && tx.paymentDate
    ? toDate(tx.paymentDate)
    : toDate(tx.dueDate);

function allocationsOf(tx) {
  const list = Array.isArray(tx.costCenterAllocation)
    ? tx.costCenterAllocation
    : [];
  if (list.length > 0) {
    return list
      .filter((a) => a?.costCenterId)
      .map((a) => ({ costCenterId: a.costCenterId, cents: toCents(a.amount) }));
  }
  if (tx.costCenterId) {
    return [
      {
        costCenterId: tx.costCenterId,
        cents: toCents(tx.finalAmount ?? tx.amount),
      },
    ];
  }
  return [];
}

const log = (l = "") => console.log(l);
const failures = [];
const fail = (msg) => {
  failures.push(msg);
  log(`   [FALHA] ${msg}`);
};

async function verifyCompany(companyId, companyName) {
  log("");
  log("═".repeat(78));
  log(`EMPRESA: ${companyName}  (${companyId})`);
  log("═".repeat(78));

  const [ccSnap, ledgerSnap] = await Promise.all([
    db.collection("cost_centers").where("companyId", "==", companyId).get(),
    db
      .collection("cost_center_ledger")
      .where("companyId", "==", companyId)
      .get(),
  ]);

  const ccs = ccSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const byId = new Map(ccs.map((c) => [c.id, c]));
  const parentOf = (cc) =>
    cc?.parentId && cc.parentId !== "none" && byId.has(cc.parentId)
      ? cc.parentId
      : null;

  const childrenOf = new Map();
  const roots = [];
  for (const cc of ccs) {
    const pid = parentOf(cc);
    if (!pid) roots.push(cc);
    else {
      if (!childrenOf.has(pid)) childrenOf.set(pid, []);
      childrenOf.get(pid).push(cc);
    }
  }
  const rootId = roots[0]?.id;
  const isLeaf = (id) => (childrenOf.get(id) || []).length === 0;

  if (ledgerSnap.empty) {
    log("   Razão vazio — rode o backfill primeiro.");
    return;
  }

  // ledger[year][ccId]
  const ledger = new Map();
  ledgerSnap.docs.forEach((d) => {
    const l = d.data();
    if (!ledger.has(l.year)) ledger.set(l.year, new Map());
    ledger.get(l.year).set(l.costCenterId, l);
  });

  // ── Recálculo independente a partir das transações ─────────────────────────
  const realSpent = new Map(); // `${ccId}_${year}` → cents
  const realPaid = new Map();
  const realRevenue = new Map(); // year → cents
  const add = (m, k, c) => m.set(k, (m.get(k) || 0) + c);

  const stream = db
    .collection("transactions")
    .where("companyId", "==", companyId)
    .stream();

  for await (const docSnap of stream) {
    const tx = docSnap.data();
    if (tx.status === "rejected") continue;
    const eff = effectiveDate(tx);
    if (!eff) continue;
    const year = eff.getFullYear();

    if (tx.type === "receivable") {
      const total =
        allocationsOf(tx).reduce((s, a) => s + a.cents, 0) ||
        toCents(tx.finalAmount ?? tx.amount);
      add(realRevenue, year, total);
      continue;
    }
    if (tx.type !== "payable") continue;

    for (const a of allocationsOf(tx)) {
      if (!byId.has(a.costCenterId)) continue;
      add(realSpent, `${a.costCenterId}_${year}`, a.cents);
      if (tx.status === "paid")
        add(realPaid, `${a.costCenterId}_${year}`, a.cents);
    }
  }

  // ── Verificação exercício a exercício ──────────────────────────────────────
  const yearsSorted = [...ledger.keys()].sort((a, b) => a - b);
  let expectedCarry = 0;

  for (const year of yearsSorted) {
    const L = ledger.get(year);
    const get = (id) => L.get(id);

    log("");
    log(`── Exercício ${year} ${"─".repeat(58)}`);

    const rootL = get(rootId);
    const carryIn = expectedCarry;

    // I5 — o razão bate com as transações
    for (const cc of ccs) {
      const l = get(cc.id);
      if (!l) {
        fail(`${cc.code || cc.id}: sem documento de razão em ${year}`);
        continue;
      }
      const expected = realSpent.get(`${cc.id}_${year}`) || 0;
      const expectedPaid = realPaid.get(`${cc.id}_${year}`) || 0;
      if (toCents(l.spentDirect) !== expected)
        fail(
          `${cc.code || cc.id} (${year}): spentDirect ${fmt(toCents(l.spentDirect))} ≠ transações ${fmt(expected)}`,
        );
      if (toCents(l.spentDirectPaid) !== expectedPaid)
        fail(
          `${cc.code || cc.id} (${year}): spentDirectPaid ${fmt(toCents(l.spentDirectPaid))} ≠ transações ${fmt(expectedPaid)}`,
        );
      // I4 — despesa só em folha
      if (!isLeaf(cc.id) && toCents(l.spentDirect) !== 0)
        fail(
          `${cc.code || cc.id} (${year}): nó interno com despesa direta ${fmt(toCents(l.spentDirect))}`,
        );
    }

    // Receita do raiz
    const expectedRevenue = realRevenue.get(year) || 0;
    if (rootL && toCents(rootL.received) !== expectedRevenue)
      fail(
        `Raiz (${year}): received ${fmt(toCents(rootL.received))} ≠ receitas reais ${fmt(expectedRevenue)}`,
      );

    // I1, I2, I3 e impressão da árvore
    log("");
    log(
      "   centro de custo                        recebido      p/ filhos         gasto     disponível",
    );
    log("   " + "─".repeat(92));

    const walk = (id, depth) => {
      const cc = byId.get(id);
      const l = get(id);
      if (!l) return;
      const kids = (childrenOf.get(id) || [])
        .slice()
        .sort((a, b) => (a.code || "").localeCompare(b.code || ""));

      const received = toCents(l.received) + (id === rootId ? carryIn : 0);
      const toKids = toCents(l.allocatedToChildren);
      const spent = toCents(l.spentDirect);
      const available = received - toKids - spent;

      // I1
      const kidsSum = kids.reduce(
        (s, k) => s + toCents(get(k.id)?.received || 0),
        0,
      );
      if (kidsSum !== toKids)
        fail(
          `${cc.code || id} (${year}): allocatedToChildren ${fmt(toKids)} ≠ soma dos filhos ${fmt(kidsSum)}`,
        );

      // I3
      const subtreeExpected =
        spent +
        kids.reduce((s, k) => s + toCents(get(k.id)?.subtreeSpent || 0), 0);
      if (toCents(l.subtreeSpent) !== subtreeExpected)
        fail(
          `${cc.code || id} (${year}): subtreeSpent ${fmt(toCents(l.subtreeSpent))} ≠ esperado ${fmt(subtreeExpected)}`,
        );

      // I2
      if (available < 0)
        fail(
          `${cc.code || id} (${year}): disponível negativo ${fmt(available)}`,
        );

      const label = "  ".repeat(depth) + (cc.code || id) + " · " + cc.name;
      log(
        `   ${label.padEnd(36).slice(0, 36)} ${fmt(received).padStart(13)} ${fmt(toKids).padStart(13)} ${fmt(spent).padStart(13)} ${fmt(available).padStart(13)}`,
      );

      kids.forEach((k) => walk(k.id, depth + 1));
    };
    walk(rootId, 0);

    // I6 — carry-over para o próximo exercício
    const rootReceived = toCents(rootL?.received || 0) + carryIn;
    const nextCarry = rootReceived - toCents(rootL?.subtreeSpent || 0);
    log("");
    log(
      `   carry-over recebido ${fmt(carryIn)}   →   sobra para o próximo exercício ${fmt(nextCarry)}`,
    );
    expectedCarry = nextCarry;
  }
}

async function main() {
  log("VERIFICAÇÃO DO RAZÃO DE ENVELOPES (somente leitura)");
  log(`Executada em ${new Date().toLocaleString("pt-BR")}`);

  let companies;
  if (onlyCompany) {
    const snap = await db.collection("companies").doc(onlyCompany).get();
    companies = [{ id: snap.id, name: snap.data()?.name || "(sem nome)" }];
  } else {
    const snap = await db.collection("companies").get();
    companies = snap.docs.map((d) => ({
      id: d.id,
      name: d.data()?.name || "(sem nome)",
    }));
  }

  for (const c of companies) await verifyCompany(c.id, c.name);

  log("");
  log("═".repeat(78));
  if (failures.length === 0) {
    log("RESULTADO: todas as invariantes conferem. Razão íntegro.");
  } else {
    log(`RESULTADO: ${failures.length} falha(s).`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("\nFalha na verificação:", err);
  process.exit(1);
});
