/**
 * Migra `roadmap_items` para o modelo com empresa e votos.
 *
 * DRY-RUN POR PADRÃO. Nada é escrito sem `--apply`.
 *
 *   • Duplicatas (mesmo título e situação) viram um item só: fica o mais
 *     antigo, os votos são somados e os demais são apagados.
 *   • `companyId` vem do perfil do autor (única empresa, ou a primeira, com
 *     aviso). Itens da equipe ficam sem empresa: só o admin vê até entrarem
 *     em execução.
 *   • `authorName` substitui `userEmail`, que deixa de ser gravado (era lido
 *     por qualquer pessoa). `votes` (sempre 0) sai; o autor vira o primeiro voto.
 *   • Entregues ganham `doneAt` (a última atualização).
 *
 * Uso:
 *   node scripts/migrate-roadmap.mjs           # dry-run
 *   node scripts/migrate-roadmap.mjs --apply   # escreve
 */
import admin from "firebase-admin";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const APPLY = process.argv.includes("--apply");

const envKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
const serviceAccount = envKey
  ? JSON.parse(envKey)
  : JSON.parse(
      readFileSync(path.join(rootDir, "serviceAccountKey.json"), "utf-8"),
    );
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
const ms = (t) => (t?.toMillis ? t.toMillis() : 0);

const snap = await db.collection("roadmap_items").get();
const users = new Map();
async function userOf(uid) {
  if (!uid) return null;
  if (!users.has(uid)) {
    const u = await db.collection("users").doc(uid).get();
    users.set(uid, u.exists ? u.data() : null);
  }
  return users.get(uid);
}

const groups = new Map();
for (const d of snap.docs) {
  const key = `${d.data().status}|${norm(d.data().title)}`;
  groups.set(key, [...(groups.get(key) ?? []), d]);
}

const batch = db.batch();
let updates = 0;
let deletes = 0;

for (const docs of groups.values()) {
  docs.sort((a, b) => ms(a.data().createdAt) - ms(b.data().createdAt));
  const [keep, ...dupes] = docs;
  const data = keep.data();

  const user = await userOf(data.userId);
  let companyId = data.companyId;
  if (!companyId && user) {
    const companies = Object.keys(user.companyRoles ?? {});
    companyId = companies[0] ?? user.pendingCompanyId;
    if (companies.length > 1) {
      console.warn(
        `  ! "${data.title}": autor em ${companies.length} empresas, usando ${companyId}`,
      );
    }
  }
  const authorName =
    data.authorName ??
    (user
      ? user.displayName || String(user.email ?? "").split("@")[0]
      : "Equipe");

  const voters = new Set(data.voters ?? []);
  if (companyId && data.userId && voters.size === 0) {
    voters.add(`${companyId}:${data.userId}`);
  }
  for (const dup of dupes) {
    for (const v of dup.data().voters ?? []) voters.add(v);
  }

  const patch = {
    authorName,
    voters: [...voters],
    userEmail: FieldValue.delete(),
    votes: FieldValue.delete(),
    ...(companyId && { companyId }),
    ...(data.status === "done" &&
      !data.doneAt && { doneAt: data.updatedAt ?? data.createdAt }),
  };
  console.log(
    `~ ${keep.id} "${data.title}" [${data.status}] empresa=${companyId ?? "—"} autor=${authorName} votos=${voters.size}`,
  );
  batch.update(keep.ref, patch);
  updates++;

  for (const dup of dupes) {
    console.log(`- ${dup.id} "${dup.data().title}" (duplicata de ${keep.id})`);
    batch.delete(dup.ref);
    deletes++;
  }
}

console.log(
  `\n${snap.size} itens: ${updates} atualizados, ${deletes} duplicatas apagadas.`,
);
if (APPLY) {
  await batch.commit();
  console.log("Gravado.");
} else {
  console.log("Dry-run: rode com --apply para gravar.");
}
