/**
 * Aviso único da troca de endereço (F0 da suíte): www → financeiro.
 *
 * DRY-RUN POR PADRÃO: lista os destinatários. Só envia com `--apply`.
 * Idempotency-Key por usuário: rodar de novo em 24 h não duplica o e-mail.
 *
 *   node --env-file=.env.local scripts/notify-domain-change.mjs
 *   node --env-file=.env.local scripts/notify-domain-change.mjs --apply
 */
import admin from "firebase-admin";

const APPLY = process.argv.includes("--apply");
const URL = "https://financeiro.fincontrol.ia.br";
const FROM = `"Financeiro · Hebron" <notificacoes@${process.env.EMAIL_FROM_DOMAIN || "fincontrol.ia.br"}>`;
const SUBJECT = "Financeiro: novo endereço, entre de novo uma vez";

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY),
  ),
});

const snap = await admin.firestore().collection("users").get();
const users = snap.docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .filter((u) => u.status === "active" && u.email);

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const html = (name) => `
<p>Olá${name ? `, ${esc(name.split(" ")[0])}` : ""}.</p>
<p>O sistema financeiro mudou de endereço. Agora é <a href="${URL}">${URL.replace("https://", "")}</a>.</p>
<p>O endereço antigo (www.fincontrol.ia.br) continua funcionando e leva você ao novo, inclusive pelos links de e-mails antigos. Por causa da troca, você vai precisar <strong>entrar de novo uma vez</strong>, com o mesmo e-mail e a mesma senha.</p>
<p>Se usar o endereço salvo nos favoritos, atualize para o novo.</p>
<p>Equipe Hebron</p>`;

console.log(`${users.length} usuários ativos:`);
for (const u of users) console.log(`  ${u.email}`);
if (!APPLY) {
  console.log("\nDry-run. Use --apply para enviar.");
  process.exit(0);
}

let ok = 0;
for (const u of users) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `domain-change-financeiro/${u.id}`,
    },
    body: JSON.stringify({ from: FROM, to: [u.email], subject: SUBJECT, html: html(u.name ?? u.displayName) }),
  });
  if (res.ok) ok++;
  else console.error(`FALHOU ${u.email}: ${res.status} ${await res.text()}`);
  await new Promise((r) => setTimeout(r, 600)); // Resend: 2 req/s
}
console.log(`\nEnviados ${ok} de ${users.length}.`);
