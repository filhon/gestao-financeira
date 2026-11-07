/**
 * Grava `controlNumber` nos comprovantes já importados e remove os pendentes
 * cujo número de controle já está num comprovante associado.
 *
 * Com `--associados`, remove também as cópias associadas repetidas: só quando
 * todas apontam para os mesmos títulos e os títulos apontam de volta para uma
 * delas, que é a que fica. O resto sai em `bloqueados`, para decisão manual.
 *
 * SIMULAÇÃO POR PADRÃO. Nada é escrito sem `--apply`. Pode rodar de novo.
 *
 * Uso:
 *   npx jiti scripts/dedupe-comprovantes.ts --company=<id> [--associados]
 *   npx jiti scripts/dedupe-comprovantes.ts --company=<id> [--associados] \
 *     --by=<e-mail> --backup=<pasta> --apply
 *
 * Com `--apply`, salva o documento e o arquivo de cada removido em `--backup`
 * antes de apagar. Credenciais: serviceAccountKey.json na raiz.
 */
import admin from "firebase-admin";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { extractControlNumber } from "../src/lib/matching/brazilian";

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const companyId = arg("company");
const by = arg("by");
const backupDir = arg("backup");
const apply = process.argv.includes("--apply");
if (!companyId || (apply && (!by || !backupDir))) {
  console.error("Uso: --company=<id> [--by=<e-mail> --backup=<pasta> --apply]");
  process.exit(1);
}

const key = JSON.parse(readFileSync("serviceAccountKey.json", "utf8"));
admin.initializeApp({
  credential: admin.credential.cert(key),
  storageBucket: `${key.project_id}.firebasestorage.app`,
});
const db = admin.firestore();

const linksOf = (d: FirebaseFirestore.DocumentData): string[] =>
  d.transactionIds ?? (d.transactionId ? [d.transactionId] : []);

async function main() {
  const [receiptSnap, txSnap] = await Promise.all([
    db.collection("comprovantes").where("companyId", "==", companyId).get(),
    db.collection("transactions").where("companyId", "==", companyId).get(),
  ]);
  const tx = new Map(txSnap.docs.map((d) => [d.id, d.data()]));
  // Qualquer campo do título conta, inclusive a URL legada `comprovanteUrl`.
  const txJson = txSnap.docs.map((d) => JSON.stringify(d.data()));
  const receipts = receiptSnap.docs.map((ref) => ({
    ref,
    data: ref.data(),
    control: extractControlNumber(ref.get("extractedText") ?? ""),
  }));

  const byControl = new Map<string, typeof receipts>();
  for (const r of receipts) {
    if (!r.control) continue;
    byControl.set(r.control, [...(byControl.get(r.control) ?? []), r]);
  }

  const toBackfill = receipts.filter(
    (r) => r.control && r.data.controlNumber !== r.control,
  );

  const inUse = (r: (typeof receipts)[number]) => {
    const file = path.parse(r.data.storagePath).name;
    return (
      txJson.some((j) => j.includes(r.ref.id) || j.includes(file)) ||
      receipts.some((o) => o !== r && o.data.storagePath === r.data.storagePath)
    );
  };

  const toRemove: Array<(typeof receipts)[number] & { keep: string }> = [];
  const blocked: Array<[string, string]> = [];
  for (const r of receipts) {
    if (r.data.matchStatus !== "pending_review" || !r.control) continue;
    const group = byControl.get(r.control)!;
    const groupIds = new Set(group.map((g) => g.ref.id));
    // Fica o associado cujo título aponta de volta para o grupo.
    const keeper = group.find(
      (g) =>
        g.data.matchStatus === "matched" &&
        linksOf(g.data).some((id) => groupIds.has(tx.get(id)?.comprovanteId)),
    );
    if (!group.some((g) => g.data.matchStatus === "matched")) continue;
    if (!keeper) blocked.push([r.ref.id, "associado sem título de volta"]);
    else if (inUse(r)) blocked.push([r.ref.id, "em uso por outro registro"]);
    else toRemove.push({ ...r, keep: keeper.ref.id });
  }

  if (process.argv.includes("--associados")) {
    for (const [control, group] of byControl) {
      const matched = group.filter((r) => r.data.matchStatus === "matched");
      if (matched.length < 2) continue;
      const titles = new Set(
        matched.map((r) => [...linksOf(r.data)].sort().join()),
      );
      if (titles.size > 1) {
        blocked.push([control, "cópias ligadas a títulos diferentes"]);
        continue;
      }
      const pointers = new Set(
        linksOf(matched[0].data).map((id) => tx.get(id)?.comprovanteId),
      );
      const keeper =
        pointers.size === 1
          ? matched.find((r) => pointers.has(r.ref.id))
          : undefined;
      if (!keeper) {
        blocked.push([control, "título aponta para outro comprovante"]);
        continue;
      }
      for (const copy of matched) {
        if (copy === keeper) continue;
        if (inUse(copy)) blocked.push([copy.ref.id, "cópia em uso"]);
        else toRemove.push({ ...copy, keep: keeper.ref.id });
      }
    }
  }

  const removedIds = new Set(toRemove.map((r) => r.ref.id));
  const staleRefs = receipts.filter(
    (r) =>
      !removedIds.has(r.ref.id) && removedIds.has(r.data.possibleDuplicateOf),
  );
  const repeatedMatched = [...byControl.values()].filter(
    (g) => g.filter((r) => r.data.matchStatus === "matched").length > 1,
  );

  console.log({
    comprovantes: receipts.length,
    semNumero: receipts.filter((r) => !r.control).map((r) => r.ref.id),
    gravarNumero: toBackfill.length,
    remover: toRemove.length,
    bloqueados: blocked,
    limparReferencia: staleRefs.length,
    associadosRepetidos: repeatedMatched.length,
  });
  if (!apply) return console.log("Simulação: nada foi escrito.");

  const bulk = db.bulkWriter();
  for (const r of toBackfill) {
    if (!removedIds.has(r.ref.id)) {
      bulk.update(r.ref.ref, { controlNumber: r.control });
    }
  }
  for (const r of staleRefs) {
    bulk.update(r.ref.ref, {
      possibleDuplicateOf: admin.firestore.FieldValue.delete(),
    });
  }
  await bulk.close();
  console.log("Números gravados.");

  mkdirSync(backupDir!, { recursive: true });
  const bucket = admin.storage().bucket();
  for (const r of toRemove) {
    const file = bucket.file(r.data.storagePath);
    await file.download({
      destination: path.join(backupDir!, path.basename(r.data.storagePath)),
    });
    writeFileSync(
      path.join(backupDir!, `${r.ref.id}.json`),
      JSON.stringify(r.data, null, 2),
    );
  }
  console.log(`Backup de ${toRemove.length} em ${backupDir}.`);

  for (const r of toRemove) {
    const batch = db.batch();
    batch.delete(r.ref.ref);
    batch.set(db.collection("audit_logs").doc(), {
      companyId,
      userId: "script:dedupe-comprovantes",
      userEmail: by,
      action: "delete_comprovante",
      entity: "comprovante",
      entityId: r.ref.id,
      details: {
        reason: "número de controle já associado em outro comprovante",
        controlNumber: r.control,
        keptComprovanteId: r.keep,
        storagePath: r.data.storagePath,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await batch.commit();
    await bucket.file(r.data.storagePath).delete();
  }
  console.log(`Removidos: ${toRemove.length}.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
