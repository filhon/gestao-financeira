/**
 * Backfill do razão de envelopes (`cost_center_ledger`) — Fase 1.
 *
 * DRY-RUN POR PADRÃO. Nada é escrito sem `--apply`.
 *
 * Converte o estado atual (coleção `budgets` + transações) no razão do modelo
 * de envelope, aplicando as decisões tomadas na Fase 0:
 *
 *   • Toda receita credita o CC raiz, qualquer que seja a alocação original.
 *   • Envelope deficitário é inflado até cobrir o gasto real, debitando da
 *     folga do pai — resolvido de baixo para cima, então cada pai cobre seus
 *     filhos com o próprio saldo livre e só escala se não bastar.
 *   • Exercícios sem orçamento cadastrado recebem envelopes mínimos iguais ao
 *     que já foi lançado, para que nada nasça travado.
 *
 * Uso:
 *   node scripts/backfill-cost-center-ledger.mjs                  # dry-run
 *   node scripts/backfill-cost-center-ledger.mjs --company=<id>
 *   node scripts/backfill-cost-center-ledger.mjs --apply          # escreve
 *   node scripts/backfill-cost-center-ledger.mjs --apply --normalize-revenue
 *
 * `--normalize-revenue` reaponta as receitas cujo centro de custo não é o raiz,
 * deixando as transações coerentes com a regra. Sem a flag, o razão já fica
 * correto e as transações permanecem como estão.
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
const APPLY = args.includes("--apply");
const NORMALIZE_REVENUE = args.includes("--normalize-revenue");
const onlyCompany = getArg("company");

const envKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
const serviceAccount = envKey
  ? JSON.parse(envKey)
  : JSON.parse(
      readFileSync(path.join(rootDir, "serviceAccountKey.json"), "utf-8"),
    );
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const LEDGER = "cost_center_ledger";

// Tudo é somado em centavos (inteiros); só a gravação volta para reais.
const toCents = (v) => Math.round(Number(v || 0) * 100);
const toReais = (cents) => Math.round(cents) / 100;
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

const log = (line = "") => console.log(line);

async function backfillCompany(companyId, companyName) {
  log("");
  log("═".repeat(78));
  log(`EMPRESA: ${companyName}  (${companyId})`);
  log("═".repeat(78));

  // ── Hierarquia ─────────────────────────────────────────────────────────────
  const ccSnap = await db
    .collection("cost_centers")
    .where("companyId", "==", companyId)
    .get();
  const ccs = ccSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (ccs.length === 0) {
    log("Sem centros de custo. Nada a fazer.");
    return;
  }

  const byId = new Map(ccs.map((c) => [c.id, c]));
  const parentOf = (cc) =>
    cc?.parentId && cc.parentId !== "none" && byId.has(cc.parentId)
      ? cc.parentId
      : null;

  const childrenOf = new Map();
  const roots = [];
  for (const cc of ccs) {
    const pid = parentOf(cc);
    if (!pid) {
      roots.push(cc);
      continue;
    }
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid).push(cc);
  }
  if (roots.length !== 1) {
    throw new Error(
      `Esperado exatamente 1 raiz, encontrado ${roots.length}: ${roots
        .map((r) => r.code || r.id)
        .join(", ")}`,
    );
  }
  const rootId = roots[0].id;
  const isLeaf = (id) => (childrenOf.get(id) || []).length === 0;

  // ── Orçamentos existentes ──────────────────────────────────────────────────
  const budgetSnap = await db
    .collection("budgets")
    .where("companyId", "==", companyId)
    .get();
  const budgetOf = new Map(); // `${ccId}_${year}` → cents
  budgetSnap.docs.forEach((d) => {
    const b = d.data();
    budgetOf.set(`${b.costCenterId}_${b.year}`, toCents(b.amount));
  });

  // ── Varredura das transações ───────────────────────────────────────────────
  const spent = new Map(); // `${ccId}_${year}` → cents
  const spentPaid = new Map();
  const revenueByYear = new Map(); // year → cents
  const misplacedRevenue = []; // docs a normalizar
  const years = new Set();
  let skippedNoCc = 0;
  let skippedNoCcCents = 0;

  const add = (map, key, cents) => map.set(key, (map.get(key) || 0) + cents);

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
    years.add(year);

    if (tx.type === "receivable") {
      // Regra: toda receita credita o raiz, ignorando a alocação original.
      const total =
        allocationsOf(tx).reduce((s, a) => s + a.cents, 0) ||
        toCents(tx.finalAmount ?? tx.amount);
      add(revenueByYear, year, total);

      const allocs = allocationsOf(tx);
      const outsideRoot = allocs.some((a) => a.costCenterId !== rootId);
      if (outsideRoot || allocs.length === 0) {
        misplacedRevenue.push({ ref: docSnap.ref, cents: total });
      }
      continue;
    }

    if (tx.type !== "payable") continue;

    const allocs = allocationsOf(tx);
    if (allocs.length === 0) {
      skippedNoCc += 1;
      skippedNoCcCents += toCents(tx.finalAmount ?? tx.amount);
      continue;
    }
    for (const a of allocs) {
      if (!byId.has(a.costCenterId)) continue;
      add(spent, `${a.costCenterId}_${year}`, a.cents);
      if (tx.status === "paid")
        add(spentPaid, `${a.costCenterId}_${year}`, a.cents);
    }
  }

  if (skippedNoCc > 0) {
    log("");
    log(
      `   [ATENÇÃO] ${skippedNoCc} despesa(s) sem centro de custo, ${fmt(skippedNoCcCents)} — fora do razão.`,
    );
  }

  // ── Monta o razão exercício a exercício ────────────────────────────────────
  const sortedYears = [...years].sort((a, b) => a - b);
  const writes = [];
  let carryIn = 0;

  for (const year of sortedYears) {
    const spentOf = (id) => spent.get(`${id}_${year}`) || 0;
    const spentPaidOf = (id) => spentPaid.get(`${id}_${year}`) || 0;

    // Envelope inicial: o orçamento cadastrado, ou zero se o exercício nunca
    // foi planejado.
    const envelope = new Map();
    for (const cc of ccs)
      envelope.set(cc.id, budgetOf.get(`${cc.id}_${year}`) || 0);

    // Resolve de baixo para cima: cada nó precisa cobrir o que alocou aos
    // filhos mais o que gastou. Se o envelope não cobre, ele sobe — e o pai
    // paga com a própria folga na iteração seguinte.
    const inflated = [];
    const resolve = (id) => {
      const kids = childrenOf.get(id) || [];
      kids.forEach((k) => resolve(k.id));
      const toKids = kids.reduce((s, k) => s + envelope.get(k.id), 0);
      const need = toKids + spentOf(id);
      if (id === rootId) return;
      if (need > envelope.get(id)) {
        inflated.push({
          cc: byId.get(id),
          from: envelope.get(id),
          to: need,
        });
        envelope.set(id, need);
      }
    };
    resolve(rootId);

    const revenue = revenueByYear.get(year) || 0;
    const rootToKids = (childrenOf.get(rootId) || []).reduce(
      (s, k) => s + envelope.get(k.id),
      0,
    );
    const rootReceived = revenue + carryIn;
    const rootAvailable = rootReceived - rootToKids - spentOf(rootId);

    // subtreeSpent: gasto próprio somado ao de todos os descendentes.
    const subtree = new Map();
    const subtreePaid = new Map();
    const computeSubtree = (id) => {
      const kids = childrenOf.get(id) || [];
      kids.forEach((k) => computeSubtree(k.id));
      subtree.set(
        id,
        spentOf(id) + kids.reduce((s, k) => s + subtree.get(k.id), 0),
      );
      subtreePaid.set(
        id,
        spentPaidOf(id) + kids.reduce((s, k) => s + subtreePaid.get(k.id), 0),
      );
    };
    computeSubtree(rootId);

    log("");
    log(`── Exercício ${year} ${"─".repeat(58)}`);
    log(
      `   receitas ${fmt(revenue)}  +  carry-over ${fmt(carryIn)}  =  caixa do raiz ${fmt(rootReceived)}`,
    );
    log(
      `   alocado aos filhos ${fmt(rootToKids)}   livre no raiz ${fmt(rootAvailable)}`,
    );
    if (inflated.length > 0) {
      log("");
      log(`   Envelopes inflados para cobrir gasto real (${inflated.length}):`);
      inflated
        .sort((a, b) => b.to - b.from - (a.to - a.from))
        .forEach((i) =>
          log(
            `      • ${i.cc.code || i.cc.id} — ${i.cc.name}: ${fmt(i.from)} → ${fmt(i.to)}  (+${fmt(i.to - i.from)})`,
          ),
        );
    }
    if (rootAvailable < 0) {
      log("");
      log(
        `   [BLOQUEIO] O caixa do raiz não cobre o exercício: falta ${fmt(-rootAvailable)}.`,
      );
      log(
        "   Backfill abortado — não há como fechar o razão sem criar dinheiro.",
      );
      throw new Error(`Exercício ${year} não fecha no raiz.`);
    }

    for (const cc of ccs) {
      const kids = childrenOf.get(cc.id) || [];
      const isRoot = cc.id === rootId;
      writes.push({
        id: `${companyId}_${cc.id}_${year}`,
        data: {
          companyId,
          costCenterId: cc.id,
          year,
          parentId: parentOf(cc),
          isRoot,
          // O carry-over é derivado na leitura, então só a receita do próprio
          // exercício é gravada no raiz.
          received: toReais(isRoot ? revenue : envelope.get(cc.id)),
          allocatedToChildren: toReais(
            kids.reduce((s, k) => s + envelope.get(k.id), 0),
          ),
          spentDirect: toReais(spentOf(cc.id)),
          spentDirectPaid: toReais(spentPaidOf(cc.id)),
          subtreeSpent: toReais(subtree.get(cc.id) || 0),
          subtreeSpentPaid: toReais(subtreePaid.get(cc.id) || 0),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      });
    }

    // Sobra da árvore inteira: alocações internas são transferência, só o
    // gasto consome.
    carryIn = rootReceived - subtree.get(rootId);
  }

  // Folhas com despesa mas sem orçamento não podem existir depois do resolve;
  // esta checagem existe para falhar alto caso a lógica mude.
  const broken = writes.filter(
    (w) =>
      w.data.received - w.data.allocatedToChildren - w.data.spentDirect <
      -0.005,
  );
  if (broken.length > 0 && !broken.every((b) => b.data.isRoot)) {
    log("");
    log("   [ERRO] Nós ainda negativos após o ajuste:");
    broken.forEach((b) => log(`      • ${b.id}`));
    throw new Error("Razão inconsistente — backfill abortado.");
  }

  log("");
  log("─".repeat(78));
  log(`Documentos de razão a gravar: ${writes.length}`);
  if (misplacedRevenue.length > 0) {
    log(
      `Receitas fora do raiz: ${misplacedRevenue.length}` +
        (NORMALIZE_REVENUE
          ? " — serão reapontadas para o raiz"
          : " — mantidas como estão (use --normalize-revenue para reapontar)"),
    );
  }

  if (!APPLY) {
    log("");
    log("DRY-RUN — nada foi gravado. Repita com --apply para efetivar.");
    return;
  }

  // ── Gravação ───────────────────────────────────────────────────────────────
  const BATCH_SIZE = 400;
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const batch = db.batch();
    writes.slice(i, i + BATCH_SIZE).forEach((w) => {
      batch.set(db.collection(LEDGER).doc(w.id), w.data, { merge: true });
    });
    await batch.commit();
  }
  log(`Razão gravado: ${writes.length} documentos.`);

  if (NORMALIZE_REVENUE && misplacedRevenue.length > 0) {
    for (let i = 0; i < misplacedRevenue.length; i += BATCH_SIZE) {
      const batch = db.batch();
      misplacedRevenue.slice(i, i + BATCH_SIZE).forEach((m) => {
        batch.update(m.ref, {
          costCenterId: rootId,
          costCenterIds: [rootId],
          costCenterAllocation: [
            {
              costCenterId: rootId,
              percentage: 100,
              amount: toReais(m.cents),
            },
          ],
        });
      });
      await batch.commit();
    }
    log(`Receitas reapontadas para o raiz: ${misplacedRevenue.length}.`);
  }
}

async function main() {
  log("BACKFILL DO RAZÃO DE ENVELOPES — Fase 1");
  log(APPLY ? "MODO: GRAVAÇÃO (--apply)" : "MODO: DRY-RUN (nada será gravado)");
  log(`Executado em ${new Date().toLocaleString("pt-BR")}`);

  let companies;
  if (onlyCompany) {
    const snap = await db.collection("companies").doc(onlyCompany).get();
    if (!snap.exists) {
      console.error(`Empresa ${onlyCompany} não encontrada.`);
      process.exit(1);
    }
    companies = [{ id: snap.id, name: snap.data()?.name || "(sem nome)" }];
  } else {
    const snap = await db.collection("companies").get();
    companies = snap.docs.map((d) => ({
      id: d.id,
      name: d.data()?.name || "(sem nome)",
    }));
  }

  for (const c of companies) {
    await backfillCompany(c.id, c.name);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nFalha no backfill:", err.message || err);
    process.exit(1);
  });
