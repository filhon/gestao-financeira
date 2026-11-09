/**
 * Backfill do valor previsto (`plannedAmount`) dos lançamentos antigos.
 *
 * DRY-RUN POR PADRÃO. Nada é escrito sem `--apply`.
 *
 * Daqui em diante o trigger `onTransactionWrite` carimba a previsão na criação.
 * Para o passado, a previsão sai da auditoria, nesta ordem:
 *   1. log de criação com `details.amount`;
 *   2. primeira edição que mudou `amount` (o valor antigo dela);
 *   3. aprovação por link com `details.originalAmount`;
 *   4. sem nada disso, o valor atual (`plannedSource: "current"`): a Análise
 *      conta esses à parte, como "sem histórico".
 * Não previsto: criado depois do vencimento, ou no dia do pagamento ou depois.
 * (O trigger usa o status da criação; aqui ele não existe mais.)
 *
 * Só toca lançamentos sem `plannedAmount`; rodar de novo não muda nada.
 *
 * Uso:
 *   node scripts/backfill-planned-amount.mjs                  # dry-run
 *   node scripts/backfill-planned-amount.mjs --company=<id>
 *   node scripts/backfill-planned-amount.mjs --apply
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
const fmt = (v) =>
  Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dayKey = (d) =>
  d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const toDate = (v) => (v && typeof v.toDate === "function" ? v.toDate() : null);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Previsão a partir dos logs do lançamento, do mais antigo ao mais novo. */
function plannedFromAudit(logs) {
  const create = logs.find(
    (l) => l.action === "create" && isNum(l.details?.amount),
  );
  if (create) return create.details.amount;
  for (const l of logs) {
    const change = (l.details?.changes ?? []).find(
      (c) => c?.field === "amount" && isNum(c.oldValue),
    );
    if (change) return change.oldValue;
    if (isNum(l.details?.originalAmount)) return l.details.originalAmount;
  }
  return null;
}

function unplannedOf(t) {
  const created = toDate(t.createdAt);
  if (!created) return false;
  const due = toDate(t.dueDate);
  const paid = toDate(t.paymentDate);
  return (
    (!!due && dayKey(created) > dayKey(due)) ||
    (!!paid && dayKey(created) >= dayKey(paid))
  );
}

async function runCompany(companyId, name) {
  const [txSnap, logSnap] = await Promise.all([
    db.collection("transactions").where("companyId", "==", companyId).get(),
    db.collection("audit_logs").where("companyId", "==", companyId).get(),
  ]);

  const logsByTx = new Map();
  for (const d of logSnap.docs) {
    const l = d.data();
    if (l.entity !== "transaction" || !l.entityId) continue;
    const list = logsByTx.get(l.entityId) ?? [];
    list.push({ ...l, at: toDate(l.createdAt)?.getTime() ?? 0 });
    logsByTx.set(l.entityId, list);
  }
  for (const list of logsByTx.values()) list.sort((a, b) => a.at - b.at);

  const writes = [];
  const bySource = { audit: 0, current: 0 };
  let unplanned = 0;
  const revised = [];
  for (const d of txSnap.docs) {
    const t = d.data();
    if (t.plannedAmount !== undefined) continue;
    const fromAudit = plannedFromAudit(logsByTx.get(d.id) ?? []);
    const source = fromAudit === null ? "current" : "audit";
    const plannedAmount = fromAudit ?? (Number(t.amount) || 0);
    const stamp = {
      plannedAmount,
      plannedSource: source,
      unplanned: unplannedOf(t),
    };
    bySource[source]++;
    if (stamp.unplanned) unplanned++;
    if (toCents(plannedAmount) !== toCents(t.amount)) {
      revised.push({
        id: d.id,
        description: t.description,
        planned: plannedAmount,
        amount: Number(t.amount) || 0,
      });
    }
    writes.push([d.ref, stamp]);
  }

  console.log(`\n${name} (${companyId})`);
  console.log(`  lançamentos: ${txSnap.size}, sem previsão: ${writes.length}`);
  console.log(
    `  pela auditoria: ${bySource.audit}, pelo valor atual: ${bySource.current}, não previstos: ${unplanned}`,
  );
  console.log(`  com valor revisado depois de criado: ${revised.length}`);
  revised
    .sort(
      (a, b) => Math.abs(b.amount - b.planned) - Math.abs(a.amount - a.planned),
    )
    .slice(0, 10)
    .forEach((r) =>
      console.log(
        `    ${r.id}  ${fmt(r.planned)} → ${fmt(r.amount)}  ${r.description ?? ""}`,
      ),
    );

  if (!APPLY || writes.length === 0) return;
  for (let i = 0; i < writes.length; i += 450) {
    const batch = db.batch();
    for (const [ref, stamp] of writes.slice(i, i + 450))
      batch.update(ref, stamp);
    await batch.commit();
  }
  console.log(`  gravados: ${writes.length}`);
}

const companies = onlyCompany
  ? [await db.collection("companies").doc(onlyCompany).get()]
  : (await db.collection("companies").get()).docs;
for (const c of companies) {
  if (!c.exists) {
    console.error(`Empresa ${c.id} não encontrada.`);
    continue;
  }
  await runCompany(c.id, c.data().name ?? c.id);
}
console.log(
  APPLY ? "\nConcluído." : "\nDry-run: nada foi gravado. Use --apply.",
);
