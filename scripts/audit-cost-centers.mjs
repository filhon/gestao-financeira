/**
 * Auditoria READ-ONLY dos centros de custo — Fase 0 do redesenho por envelope.
 *
 * Este script NÃO escreve nada. Ele só lê e reporta, para que as decisões de
 * migração sejam tomadas sobre dados reais em vez de suposições.
 *
 * Verifica as premissas do novo modelo:
 *   1. Estrutura da árvore — raiz única, sem órfãos, sem ciclos
 *   2. Despesas fora de folhas — viola "despesa só em CC de último grau"
 *   3. Receitas fora do raiz — viola "toda receita credita o CC raiz"
 *   4. Orçamento legado (cost_centers.budget) vs coleção budgets
 *   5. Prévia do caixa consolidado por ano, com carry-over
 *
 * Uso:
 *   node scripts/audit-cost-centers.mjs
 *   node scripts/audit-cost-centers.mjs --company=<companyId>
 *   node scripts/audit-cost-centers.mjs --out=auditoria.md
 *
 * Credenciais: FIREBASE_SERVICE_ACCOUNT_KEY, ou serviceAccountKey.json na raiz.
 */
import admin from "firebase-admin";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

// ─── Args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const onlyCompany = getArg("company");
const outFile = getArg("out");

// ─── Firebase Admin ──────────────────────────────────────────────────────────
const envKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
const serviceAccount = envKey
  ? JSON.parse(envKey)
  : JSON.parse(
      readFileSync(path.join(rootDir, "serviceAccountKey.json"), "utf-8"),
    );

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ─── Helpers ─────────────────────────────────────────────────────────────────
// Valores monetários são somados em centavos (inteiros) para evitar erro de float.
const toCents = (v) => Math.round(Number(v || 0) * 100);
const fmt = (cents) =>
  (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const toDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);

/** Data que define a qual ano a transação pertence (mesma regra do app). */
const effectiveDate = (tx) =>
  tx.status === "paid" && tx.paymentDate
    ? toDate(tx.paymentDate)
    : toDate(tx.dueDate);

/** Normaliza alocação multi-CC e o campo legado costCenterId. */
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

const bump = (map, key, cents) => {
  const cur = map.get(key) || { cents: 0, count: 0 };
  cur.cents += cents;
  cur.count += 1;
  map.set(key, cur);
};

const out = [];
const say = (line = "") => {
  out.push(line);
  console.log(line);
};

// ─── Auditoria de uma empresa ────────────────────────────────────────────────
async function auditCompany(companyId, companyName) {
  say("");
  say("═".repeat(78));
  say(`EMPRESA: ${companyName}  (${companyId})`);
  say("═".repeat(78));

  // Centros de custo
  const ccSnap = await db
    .collection("cost_centers")
    .where("companyId", "==", companyId)
    .get();
  const ccs = ccSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const ccById = new Map(ccs.map((c) => [c.id, c]));

  if (ccs.length === 0) {
    say("\nNenhum centro de custo cadastrado. Nada a auditar.");
    return;
  }

  const childrenOf = new Map();
  for (const cc of ccs) {
    const pid = cc.parentId && cc.parentId !== "none" ? cc.parentId : null;
    if (pid) {
      if (!childrenOf.has(pid)) childrenOf.set(pid, []);
      childrenOf.get(pid).push(cc);
    }
  }
  const isLeaf = (id) => (childrenOf.get(id) || []).length === 0;

  // ── 1. Estrutura ───────────────────────────────────────────────────────────
  const roots = [];
  const orphans = [];
  for (const cc of ccs) {
    const pid = cc.parentId && cc.parentId !== "none" ? cc.parentId : null;
    if (!pid) roots.push(cc);
    else if (!ccById.has(pid)) orphans.push(cc);
  }

  // Ciclos: sobe pelos pais até a raiz, detectando repetição
  const inCycle = new Set();
  for (const cc of ccs) {
    const seen = new Set();
    let cur = cc;
    while (cur) {
      if (seen.has(cur.id)) {
        seen.forEach((id) => inCycle.add(id));
        break;
      }
      seen.add(cur.id);
      const pid = cur.parentId && cur.parentId !== "none" ? cur.parentId : null;
      cur = pid ? ccById.get(pid) : null;
    }
  }

  const depthOf = (id, guard = new Set()) => {
    if (guard.has(id)) return 0;
    guard.add(id);
    const cc = ccById.get(id);
    const pid = cc?.parentId && cc.parentId !== "none" ? cc.parentId : null;
    return pid && ccById.has(pid) ? depthOf(pid, guard) + 1 : 0;
  };
  const maxDepth = Math.max(...ccs.map((c) => depthOf(c.id)));
  const leaves = ccs.filter((c) => isLeaf(c.id));

  say("");
  say("── 1. Estrutura da árvore " + "─".repeat(52));
  say(`   Centros de custo ......... ${ccs.length}`);
  say(
    `   Raízes (sem pai) ......... ${roots.length}  ${
      roots.length === 1 ? "[ok]" : "[PROBLEMA — o modelo exige exatamente 1]"
    }`,
  );
  roots.forEach((r) => say(`      • ${r.code || "(sem código)"} — ${r.name}`));
  say(`   Folhas ................... ${leaves.length}`);
  say(`   Nós internos ............. ${ccs.length - leaves.length}`);
  say(`   Profundidade máxima ...... ${maxDepth}`);
  if (orphans.length > 0) {
    say(`   Órfãos (pai inexistente) . ${orphans.length}  [PROBLEMA]`);
    orphans.forEach((o) =>
      say(`      • ${o.code || o.id} — ${o.name}  → parentId=${o.parentId}`),
    );
  }
  if (inCycle.size > 0) {
    say(`   Em ciclo ................. ${inCycle.size}  [PROBLEMA]`);
    [...inCycle].forEach((id) =>
      say(`      • ${ccById.get(id)?.code || id} — ${ccById.get(id)?.name}`),
    );
  }

  // ── Varredura das transações ───────────────────────────────────────────────
  // spend/revenue: Map<ccId, Map<year, {cents,count}>>
  const spend = new Map();
  const revenue = new Map();
  const revenueNoCc = new Map(); // Map<year,{cents,count}>
  const spendNoCc = new Map();
  const unknownCc = new Map(); // Map<ccId, {cents,count}> — CC referenciado mas inexistente
  let txTotal = 0;
  let txRejected = 0;
  let txNoDate = 0;

  const perYear = (map, ccId) => {
    if (!map.has(ccId)) map.set(ccId, new Map());
    return map.get(ccId);
  };

  const stream = db
    .collection("transactions")
    .where("companyId", "==", companyId)
    .stream();

  for await (const doc of stream) {
    const tx = doc.data();
    txTotal += 1;
    if (tx.status === "rejected") {
      txRejected += 1;
      continue;
    }
    const eff = effectiveDate(tx);
    if (!eff) {
      txNoDate += 1;
      continue;
    }
    const year = eff.getFullYear();
    const allocs = allocationsOf(tx);
    const isPayable = tx.type === "payable";

    if (allocs.length === 0) {
      bump(
        isPayable ? spendNoCc : revenueNoCc,
        year,
        toCents(tx.finalAmount ?? tx.amount),
      );
      continue;
    }

    for (const a of allocs) {
      if (!ccById.has(a.costCenterId)) {
        bump(unknownCc, a.costCenterId, a.cents);
        continue;
      }
      bump(perYear(isPayable ? spend : revenue, a.costCenterId), year, a.cents);
    }
  }

  say("");
  say("── 2. Despesas fora de folhas " + "─".repeat(48));
  const violators = ccs
    .filter((cc) => !isLeaf(cc.id) && spend.has(cc.id))
    .map((cc) => {
      const years = spend.get(cc.id);
      const total = [...years.values()].reduce((s, v) => s + v.cents, 0);
      const count = [...years.values()].reduce((s, v) => s + v.count, 0);
      return { cc, years, total, count };
    })
    .sort((a, b) => b.total - a.total);

  if (violators.length === 0) {
    say("   [ok] Nenhuma despesa lançada em nó interno. Migração livre aqui.");
  } else {
    say(
      `   [DECISÃO NECESSÁRIA] ${violators.length} nó(s) interno(s) com despesa própria.`,
    );
    say("   Cada um precisa que você diga para onde a despesa vai.");
    say("");
    for (const v of violators) {
      const kids = (childrenOf.get(v.cc.id) || []).length;
      say(
        `   • ${v.cc.code || v.cc.id} — ${v.cc.name}  (${kids} filho(s), ${v.count} transação(ões), ${fmt(v.total)})`,
      );
      [...v.years.entries()]
        .sort((a, b) => a[0] - b[0])
        .forEach(([y, d]) =>
          say(
            `        ${y}: ${String(d.count).padStart(4)} tx   ${fmt(d.cents)}`,
          ),
        );
      say(
        `        filhos: ${(childrenOf.get(v.cc.id) || []).map((c) => c.name).join(", ")}`,
      );
    }
  }

  say("");
  say("── 3. Receitas fora do raiz " + "─".repeat(50));
  const rootIds = new Set(roots.map((r) => r.id));
  const misplacedRevenue = ccs
    .filter((cc) => !rootIds.has(cc.id) && revenue.has(cc.id))
    .map((cc) => {
      const years = revenue.get(cc.id);
      const total = [...years.values()].reduce((s, v) => s + v.cents, 0);
      const count = [...years.values()].reduce((s, v) => s + v.count, 0);
      return { cc, total, count };
    })
    .sort((a, b) => b.total - a.total);

  if (misplacedRevenue.length === 0) {
    say("   [ok] Nenhuma receita creditada fora do CC raiz.");
  } else {
    say(
      `   [MIGRAÇÃO] ${misplacedRevenue.length} CC(s) não-raiz com receita — serão remanejados para o raiz.`,
    );
    misplacedRevenue.forEach((m) =>
      say(
        `   • ${m.cc.code || m.cc.id} — ${m.cc.name}: ${m.count} tx, ${fmt(m.total)}`,
      ),
    );
  }
  const noCcRevTotal = [...revenueNoCc.values()].reduce(
    (s, v) => s + v.cents,
    0,
  );
  const noCcRevCount = [...revenueNoCc.values()].reduce(
    (s, v) => s + v.count,
    0,
  );
  if (noCcRevCount > 0) {
    say(
      `   Receitas sem centro de custo: ${noCcRevCount} tx, ${fmt(noCcRevTotal)}  → irão para o raiz`,
    );
  }
  const noCcSpendTotal = [...spendNoCc.values()].reduce(
    (s, v) => s + v.cents,
    0,
  );
  const noCcSpendCount = [...spendNoCc.values()].reduce(
    (s, v) => s + v.count,
    0,
  );
  if (noCcSpendCount > 0) {
    say(
      `   [DECISÃO NECESSÁRIA] Despesas sem centro de custo: ${noCcSpendCount} tx, ${fmt(noCcSpendTotal)}`,
    );
  }
  if (unknownCc.size > 0) {
    say(
      `   [PROBLEMA] ${unknownCc.size} CC(s) referenciados em transações mas inexistentes:`,
    );
    [...unknownCc.entries()].forEach(([id, d]) =>
      say(`      • ${id}: ${d.count} tx, ${fmt(d.cents)}`),
    );
  }

  // ── 4. Orçamento legado vs coleção budgets ─────────────────────────────────
  say("");
  say("── 4. Orçamento: campo legado vs coleção budgets " + "─".repeat(29));
  const budgetSnap = await db
    .collection("budgets")
    .where("companyId", "==", companyId)
    .get();
  const budgetsByCc = new Map(); // ccId → Map<year, cents>
  budgetSnap.docs.forEach((d) => {
    const b = d.data();
    if (!budgetsByCc.has(b.costCenterId))
      budgetsByCc.set(b.costCenterId, new Map());
    budgetsByCc.get(b.costCenterId).set(b.year, toCents(b.amount));
  });

  say(`   Documentos em 'budgets' .. ${budgetSnap.size}`);
  const legacyOnly = [];
  const divergent = [];
  for (const cc of ccs) {
    const legacy = toCents(cc.budget);
    if (!legacy) continue;
    const year = cc.budgetYear || null;
    const fromColl = year ? budgetsByCc.get(cc.id)?.get(year) : undefined;
    if (fromColl === undefined) legacyOnly.push({ cc, legacy, year });
    else if (fromColl !== legacy)
      divergent.push({ cc, legacy, fromColl, year });
  }
  if (legacyOnly.length === 0 && divergent.length === 0) {
    say("   [ok] Sem divergência entre o campo legado e a coleção.");
  }
  if (legacyOnly.length > 0) {
    say(
      `   ${legacyOnly.length} CC(s) só têm orçamento no campo legado (invisível na tela de detalhe):`,
    );
    legacyOnly.forEach((l) =>
      say(
        `      • ${l.cc.code || l.cc.id} — ${l.cc.name}: ${fmt(l.legacy)} (${l.year ?? "sem ano"})`,
      ),
    );
  }
  if (divergent.length > 0) {
    say(`   [PROBLEMA] ${divergent.length} CC(s) com valores conflitantes:`);
    divergent.forEach((d) =>
      say(
        `      • ${d.cc.code || d.cc.id} — ${d.cc.name} (${d.year}): legado ${fmt(d.legacy)} vs coleção ${fmt(d.fromColl)}`,
      ),
    );
  }

  // ── 5. Prévia do caixa consolidado, com carry-over ─────────────────────────
  say("");
  say("── 5. Prévia do caixa consolidado (com carry-over) " + "─".repeat(27));
  const years = new Set();
  for (const m of [...spend.values(), ...revenue.values()])
    for (const y of m.keys()) years.add(y);
  for (const y of revenueNoCc.keys()) years.add(y);
  for (const y of spendNoCc.keys()) years.add(y);

  if (years.size === 0) {
    say("   Sem transações para projetar.");
  } else {
    const sumYear = (map, y) =>
      [...map.values()].reduce((s, m) => s + (m.get(y)?.cents || 0), 0);
    say("");
    say(
      "      ano      receitas         despesas          saldo      acumulado",
    );
    say("      " + "─".repeat(64));
    let carry = 0;
    for (const y of [...years].sort((a, b) => a - b)) {
      const rev = sumYear(revenue, y) + (revenueNoCc.get(y)?.cents || 0);
      const exp = sumYear(spend, y) + (spendNoCc.get(y)?.cents || 0);
      const net = rev - exp;
      carry += net;
      const flag = carry < 0 ? "  ← NEGATIVO" : "";
      say(
        `      ${y}  ${fmt(rev).padStart(14)}  ${fmt(exp).padStart(14)}  ${fmt(net).padStart(14)}  ${fmt(carry).padStart(14)}${flag}`,
      );
    }
    say("");
    say(
      "   O acumulado é o que viraria 'received' do raiz sob a regra de carry-over.",
    );
    say(
      "   Ano com acumulado negativo indica período que a trava de saldo teria barrado.",
    );
  }

  // ── 6. Conversão dos orçamentos atuais em envelopes ────────────────────────
  // A pergunta decisiva da Fase 1: dá para virar a chave usando os orçamentos
  // que já existem, ou eles violam a invariante do envelope?
  say("");
  say("── 6. Os orçamentos atuais viram envelopes válidos? " + "─".repeat(26));

  const budgetYears = new Set();
  budgetsByCc.forEach((m) => m.forEach((_, y) => budgetYears.add(y)));

  if (budgetYears.size === 0) {
    say("   Nenhum orçamento cadastrado — nada a converter.");
  } else {
    let carryIn = 0;
    const allYears = [...years].sort((a, b) => a - b);

    for (const y of [...budgetYears].sort((a, b) => a - b)) {
      // Carry-over consolidado: sobra dos anos anteriores vira received do raiz
      carryIn = 0;
      for (const py of allYears.filter((a) => a < y)) {
        const rev =
          [...revenue.values()].reduce(
            (s, m) => s + (m.get(py)?.cents || 0),
            0,
          ) + (revenueNoCc.get(py)?.cents || 0);
        const exp =
          [...spend.values()].reduce((s, m) => s + (m.get(py)?.cents || 0), 0) +
          (spendNoCc.get(py)?.cents || 0);
        carryIn += rev - exp;
      }

      const revenueThisYear =
        [...revenue.values()].reduce((s, m) => s + (m.get(y)?.cents || 0), 0) +
        (revenueNoCc.get(y)?.cents || 0);

      const envelopeOf = (id) => budgetsByCc.get(id)?.get(y) || 0;
      const spentOf = (id) => spend.get(id)?.get(y)?.cents || 0;
      const receivedOf = (id) =>
        rootIds.has(id) ? revenueThisYear + carryIn : envelopeOf(id);

      say("");
      say(`   ── Exercício ${y} ──`);
      say(
        `   Receita do ano ${fmt(revenueThisYear)}  +  carry-over ${fmt(carryIn)}  =  caixa do raiz ${fmt(revenueThisYear + carryIn)}`,
      );
      say("");
      say(
        "   centro de custo                        recebido      p/ filhos         gasto     disponível",
      );
      say("   " + "─".repeat(92));

      const problems = [];
      const walk = (cc, depth) => {
        const kids = childrenOf.get(cc.id) || [];
        const received = receivedOf(cc.id);
        const toKids = kids.reduce((s, k) => s + envelopeOf(k.id), 0);
        const spent = spentOf(cc.id);
        const available = received - toKids - spent;

        const label = "  ".repeat(depth) + (cc.code || cc.id) + " · " + cc.name;
        const flag = available < 0 ? "  ← ESTOURO" : "";
        say(
          `   ${label.padEnd(36).slice(0, 36)} ${fmt(received).padStart(13)} ${fmt(toKids).padStart(13)} ${fmt(spent).padStart(13)} ${fmt(available).padStart(13)}${flag}`,
        );

        if (available < 0)
          problems.push({ cc, received, toKids, spent, available });
        if (kids.length > 0 && spent > 0)
          problems.push({ cc, internalSpend: spent });

        kids
          .slice()
          .sort((a, b) => (a.code || "").localeCompare(b.code || ""))
          .forEach((k) => walk(k, depth + 1));
      };
      roots.forEach((r) => walk(r, 0));

      say("");
      if (problems.length === 0) {
        say(
          `   [ok] Todos os nós fecham em ${y}. Os orçamentos convertem em envelopes sem ajuste.`,
        );
      } else {
        say(
          `   [DECISÃO NECESSÁRIA] ${problems.length} nó(s) não fecham em ${y}:`,
        );
        problems.forEach((p) => {
          if (p.internalSpend !== undefined) {
            say(
              `      • ${p.cc.code || p.cc.id} — ${p.cc.name}: nó interno com despesa própria de ${fmt(p.internalSpend)}`,
            );
          } else {
            say(
              `      • ${p.cc.code || p.cc.id} — ${p.cc.name}: falta ${fmt(-p.available)} (recebeu ${fmt(p.received)}, comprometeu ${fmt(p.toKids + p.spent)})`,
            );
          }
        });
      }
    }
  }

  say("");
  say(
    `   Transações lidas: ${txTotal}  (rejeitadas ignoradas: ${txRejected}; sem data: ${txNoDate})`,
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  say("AUDITORIA DE CENTROS DE CUSTO — Fase 0 (somente leitura)");
  say(`Executada em ${new Date().toLocaleString("pt-BR")}`);

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

  say(`Empresas a auditar: ${companies.length}`);

  for (const c of companies) {
    await auditCompany(c.id, c.name);
  }

  if (outFile) {
    const target = path.isAbsolute(outFile)
      ? outFile
      : path.join(rootDir, outFile);
    writeFileSync(target, out.join("\n"), "utf-8");
    console.log(`\nRelatório salvo em ${target}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nFalha na auditoria:", err);
    process.exit(1);
  });
