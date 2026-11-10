/**
 * Mede, contra os comprovantes já confirmados, qual texto acerta mais o
 * casamento com o título: o OCR da IA (o que a produção usa), a camada de
 * texto do PDF ou o híbrido (camada quando ela basta para confiança alta,
 * senão OCR).
 *
 * SOMENTE LEITURA: não escreve no Firestore nem no Storage.
 *
 * Uso:
 *   npx jiti scripts/eval-comprovante-text.ts --company=<id> [--limit=300]
 *     [--ocr] [--out=<arquivo.json>]
 *
 * --ocr  relê cada PDF com o OCR atual (prompt novo): 1 chamada à IA por
 *        comprovante; GEMINI_API_KEY vem do .env.local.
 * --out  grava os casos em que as leituras divergem, para conferência.
 *
 * Credenciais: serviceAccountKey.json na raiz.
 */
import admin from "firebase-admin";
import { readFileSync, writeFileSync } from "fs";
import { pdfText } from "../src/lib/pdfText";
import { ocrComprovante } from "../src/lib/comprovanteOcr";
import { matchComprovante } from "../src/lib/matching";
import { autoConfirmReason } from "../src/lib/matching/autoConfirm";
import { extractControlNumber } from "../src/lib/matching/brazilian";
import type { MatchScore } from "../src/lib/matching/score";
import type { Entity, Transaction } from "../src/lib/types";

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const companyId = arg("company");
const limit = Number(arg("limit") ?? 300);
const outFile = arg("out");
const withOcr = process.argv.includes("--ocr");
if (!companyId) {
  console.error("Uso: --company=<id> [--limit=300] [--ocr] [--out=<arquivo>]");
  process.exit(1);
}

const geminiKey = withOcr
  ? readFileSync(".env.local", "utf8")
      .match(/^GEMINI_API_KEY=(.*)$/m)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "")
  : undefined;
if (withOcr && !geminiKey) {
  console.error("--ocr pede GEMINI_API_KEY no .env.local");
  process.exit(1);
}

const key = JSON.parse(readFileSync("serviceAccountKey.json", "utf8"));
admin.initializeApp({
  credential: admin.credential.cert(key),
  storageBucket: `${key.project_id}.firebasestorage.app`,
});
const db = admin.firestore();
const bucket = admin.storage().bucket();

/** Timestamp, Date, texto ou número: datas antigas não seguem um formato só. */
function asDate(v: unknown): Date | undefined {
  if (!v) return undefined;
  if (typeof (v as { toDate?: unknown }).toDate === "function") {
    return (v as { toDate: () => Date }).toDate();
  }
  const d = new Date(v as string | number | Date);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// Mesmos campos de fetchCandidateTransactions / fetchEntities
// (src/lib/api/comprovanteAdmin.ts), que dependem do alias "@/".
async function loadCandidates(): Promise<Transaction[]> {
  const snap = await db
    .collection("transactions")
    .where("companyId", "==", companyId)
    .where("type", "==", "payable")
    .where("status", "in", ["paid", "authorized"])
    .get();
  return snap.docs.map((d) => {
    const t = d.data();
    return {
      id: d.id,
      companyId: t.companyId,
      type: "payable",
      status: t.status,
      amount: t.amount,
      finalAmount: t.finalAmount,
      discount: t.discount,
      interest: t.interest,
      description: t.description,
      notes: t.notes,
      details: t.details,
      barcode: t.barcode,
      paymentMethod: t.paymentMethod,
      supplierOrClient: t.supplierOrClient,
      entityId: t.entityId,
      comprovanteId: t.comprovanteId,
      reconciled: t.reconciled === true,
      paymentDate: asDate(t.paymentDate),
      dueDate: asDate(t.dueDate) ?? new Date(),
      createdBy: "",
      // Real: a simulação deixa de fora o que ainda não existia no envio.
      createdAt: asDate(t.createdAt) ?? new Date(0),
      updatedAt: new Date(),
    } as Transaction;
  });
}

const brief = (t: Transaction | undefined) =>
  t && {
    id: t.id,
    supplier: t.supplierOrClient,
    description: t.description,
    amount: t.finalAmount ?? t.amount,
    paymentDate: t.paymentDate?.toISOString().slice(0, 10),
    dueDate: t.dueDate.toISOString().slice(0, 10),
    createdAt: t.createdAt.toISOString().slice(0, 10),
    method: t.paymentMethod,
  };

async function loadEntities(): Promise<Entity[]> {
  const snap = await db
    .collection("entities")
    .where("companyId", "==", companyId)
    .get();
  return snap.docs.map((d) => {
    const e = d.data();
    return {
      id: d.id,
      companyId: e.companyId,
      name: e.name ?? "",
      type: e.type ?? "company",
      document: e.document,
      category: e.category ?? "supplier",
      bankName: e.bankName,
      agency: e.agency,
      account: e.account,
      pixKey: e.pixKey,
      pixKeyType: e.pixKeyType,
      extraBankAccounts: e.extraBankAccounts,
      autoConfirmReceipts: e.autoConfirmReceipts === true,
      receiptAliases: e.receiptAliases,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Entity;
  });
}

type Variant = "ocr" | "layer" | "hybrid" | "ocrNew";
interface Verdict {
  pick: string[] | null;
  level: string | null;
  correct: boolean;
  /** A regra estrita confirmaria sozinha. */
  auto: boolean;
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

function judge(
  best: MatchScore | null,
  truth: string[],
  candidates: Transaction[],
  entities: Entity[],
): Verdict {
  if (!best) return { pick: null, level: null, correct: false, auto: false };
  const members = best.transactionIds.map((id) =>
    candidates.find((t) => t.id === id),
  );
  const free = members.every((t) => t && !t.comprovanteId);
  const entityIds = new Set(members.map((t) => t?.entityId));
  const trustedSupplier =
    entityIds.size === 1 &&
    entities.some(
      (e) => e.id === members[0]?.entityId && e.autoConfirmReceipts === true,
    );
  return {
    pick: best.transactionIds,
    level: best.confidenceLevel,
    correct: sameSet(best.transactionIds, truth),
    auto:
      free &&
      !!autoConfirmReason(best, { trustedSupplier, possibleDuplicate: false }),
  };
}

async function pool<T>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<void>,
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

async function main() {
  const [receiptSnap, candidates, entities] = await Promise.all([
    db
      .collection("comprovantes")
      .where("companyId", "==", companyId)
      .where("matchStatus", "==", "matched")
      .get(),
    loadCandidates(),
    loadEntities(),
  ]);
  const byId = new Map(candidates.map((t) => [t.id, t]));
  const receipts = receiptSnap.docs.slice(0, limit);
  // Títulos já vinculados a comprovantes que não estão na fila de confirmados
  // contam como vinculados desde sempre (conservador).
  // Há comprovantes antigos com `createdAt` gravado como o objeto literal
  // {"_methodName":"serverTimestamp"}: vale então o `uploadedAt`.
  const sentAtOf = (d: FirebaseFirestore.DocumentSnapshot) =>
    asDate(d.get("createdAt")) ?? asDate(d.get("uploadedAt"));
  const brokenCreatedAt = receiptSnap.docs.filter(
    (d) => !asDate(d.get("createdAt")),
  ).length;
  const receiptCreated = new Map<string, Date>(
    receiptSnap.docs
      .filter((d) => sentAtOf(d))
      .map((d) => [d.id, sentAtOf(d)!]),
  );

  const skipped = {
    notPdf: 0,
    noTruth: 0,
    truthGone: 0,
    truthCreatedAfter: 0,
    downloadFailed: 0,
  };
  const tally: Record<Variant, Record<string, number>> = {
    ocr: {},
    layer: {},
    hybrid: {},
    ocrNew: {},
  };
  const bump = (v: Variant, k: string) =>
    (tally[v][k] = (tally[v][k] ?? 0) + 1);
  const control = { same: 0, differ: 0, onlyOcr: 0, onlyLayer: 0, none: 0 };
  let evaluated = 0;
  let layerUsable = 0;
  let layerFailed = 0;
  let noSentAt = 0;
  const divergent: unknown[] = [];

  await pool(receipts, 4, async (doc) => {
    const c = doc.data();
    const truth: string[] =
      c.transactionIds ?? (c.transactionId ? [c.transactionId] : []);
    if (truth.length === 0) return void skipped.noTruth++;
    if (truth.some((id) => !byId.has(id))) return void skipped.truthGone++;

    let buffer: Buffer;
    try {
      [buffer] = await bucket.file(c.storagePath).download();
    } catch {
      return void skipped.downloadFailed++;
    }
    if (buffer.subarray(0, 4).toString() !== "%PDF")
      return void skipped.notPdf++;

    // Como estava no envio: só títulos já criados, e livre todo título que
    // este comprovante ou um enviado depois dele pegou.
    const sentAt = sentAtOf(doc);
    if (!sentAt) noSentAt++;
    const pool = candidates
      .filter((t) => !sentAt || t.createdAt <= sentAt)
      .map((t) => {
        const linkedAt = t.comprovanteId
          ? receiptCreated.get(t.comprovanteId)
          : undefined;
        const freeThen =
          t.comprovanteId === doc.id ||
          (!!sentAt && !!linkedAt && linkedAt > sentAt);
        return freeThen ? { ...t, comprovanteId: undefined } : t;
      });
    if (truth.some((id) => !pool.some((t) => t.id === id))) {
      return void skipped.truthCreatedAfter++;
    }
    const run = (text: string) =>
      judge(
        text ? matchComprovante(text, pool, { entities }).best : null,
        truth,
        pool,
        entities,
      );

    const ocrText: string = c.extractedText ?? "";
    let layerText = "";
    try {
      layerText = await pdfText(buffer, 1);
    } catch (err) {
      layerFailed++;
      if (layerFailed === 1) console.error("pdfText falhou:", err);
    }
    const hasLayer = layerText.length >= 20;
    if (hasLayer) layerUsable++;

    const verdicts: Partial<Record<Variant, Verdict>> = {};
    verdicts.ocr = run(ocrText);
    verdicts.layer = hasLayer ? run(layerText) : verdicts.ocr;
    verdicts.hybrid =
      hasLayer && verdicts.layer.level === "HIGH"
        ? verdicts.layer
        : verdicts.ocr;
    let ocrNewText: string | undefined;
    if (withOcr) {
      ocrNewText = await ocrComprovante(buffer, "application/pdf", geminiKey!);
      verdicts.ocrNew = run(ocrNewText);
    }

    evaluated++;
    for (const [v, r] of Object.entries(verdicts) as [Variant, Verdict][]) {
      bump(v, r.correct ? "certo" : r.pick ? "errado" : "sem sugestão");
      if (r.auto) bump(v, r.correct ? "auto certo" : "AUTO ERRADO");
    }

    const ctlOcr = extractControlNumber(ocrText);
    const ctlLayer = hasLayer ? extractControlNumber(layerText) : undefined;
    if (ctlOcr && ctlLayer) control[ctlOcr === ctlLayer ? "same" : "differ"]++;
    else if (ctlOcr) control.onlyOcr++;
    else if (ctlLayer) control.onlyLayer++;
    else control.none++;

    const outcomes = Object.values(verdicts).map(
      (r) => `${r.correct}/${r.auto}`,
    );
    const autoWrong = Object.values(verdicts).some((r) => r.auto && !r.correct);
    if (
      autoWrong ||
      new Set(outcomes).size > 1 ||
      (ctlOcr && ctlLayer && ctlOcr !== ctlLayer)
    ) {
      const picks = new Set(
        Object.values(verdicts).flatMap((r) => r.pick ?? []),
      );
      divergent.push({
        comprovanteId: doc.id,
        storagePath: c.storagePath,
        sentAt: sentAt?.toISOString().slice(0, 10),
        confirmedBy: c.autoConfirmed ? "regra automática" : "pessoa",
        autoWrong,
        truth: truth.map((id) => brief(byId.get(id))),
        picked: [...picks]
          .filter((id) => !truth.includes(id))
          .map((id) => brief(byId.get(id))),
        verdicts,
        controlNumber: { ocr: ctlOcr ?? null, layer: ctlLayer ?? null },
        ocrText,
        layerText,
        ...(ocrNewText != null && { ocrNewText }),
      });
    }
  });

  console.log(`\nComprovantes confirmados lidos: ${receipts.length}`);
  console.log(`Avaliados (PDF com título ainda candidato): ${evaluated}`);
  console.log(`Ignorados: ${JSON.stringify(skipped)}`);
  console.log(
    `createdAt inválido: ${brokenCreatedAt}; sem data de envio alguma (simulação parcial): ${noSentAt}`,
  );
  console.log(
    `Camada de texto utilizável: ${layerUsable} de ${evaluated}` +
      (layerFailed ? ` (falhou em ${layerFailed})` : ""),
  );
  console.log(
    "\nResultado por leitura (sugestão principal × título confirmado):",
  );
  const keys = ["certo", "errado", "sem sugestão", "auto certo", "AUTO ERRADO"];
  console.table(
    Object.fromEntries(
      (Object.keys(tally) as Variant[])
        .filter((v) => v !== "ocrNew" || withOcr)
        .map((v) => [
          v,
          Object.fromEntries(keys.map((k) => [k, tally[v][k] ?? 0])),
        ]),
    ),
  );
  console.log("Número de controle, OCR × camada:", control);
  console.log(`Casos divergentes: ${divergent.length}`);
  if (outFile) {
    writeFileSync(outFile, JSON.stringify(divergent, null, 2));
    console.log(`Detalhes em ${outFile}`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
