/**
 * Verificação da conferência da leitura de NF, boleto e XML da NF-e.
 *   npm run check:document-reading
 * Falha com exceção na primeira regra quebrada.
 */
import assert from "node:assert/strict";
import {
  findInText,
  parseNfeXml,
  readingSnapshot,
  reconcile,
  type RawReading,
} from "../src/lib/documentReading";
import { isValidCNPJ } from "../src/lib/matching/brazilian";

const today = new Date(2026, 10, 10, 12);
const SUPPLIER = "11222333000181";
const COMPANY = "11444777000161";
assert.ok(isValidCNPJ(SUPPLIER) && isValidCNPJ(COMPANY));

const mod11Sum = (s: string) => {
  let sum = 0;
  let w = 2;
  for (let i = s.length - 1; i >= 0; i--) {
    sum += Number(s[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  return sum;
};

// Boleto bancário: banco 001, fator 1626 (10/11/2026), R$ 1.234,56.
const body = "0019" + "1626" + "0000123456" + "1234567890123456789012345";
const bankDv = 11 - (mod11Sum(body) % 11);
const BARCODE =
  body.slice(0, 4) +
  (bankDv >= 10 || bankDv === 0 ? 1 : bankDv) +
  body.slice(4);

// Chave de acesso: SP, 11/2026, CNPJ do fornecedor, modelo 55, nº 12345.
const key43 =
  "35" + "2611" + SUPPLIER + "55" + "001" + "000012345" + "1" + "12345678";
const rest = mod11Sum(key43) % 11;
const KEY = key43 + (rest < 2 ? 0 : 11 - rest);

const blank: RawReading = {
  documentType: null,
  summary: null,
  issuer: null,
  payer: null,
  documentNumber: null,
  accessKey: null,
  issueDate: null,
  dueDate: null,
  referenceMonth: null,
  totalAmount: null,
  amountDue: null,
  withholdings: null,
  barcode: null,
  pixCode: null,
  installments: [],
};
const payable = { type: "payable" as const, companyDocument: COMPANY, today };

// 1. Boleto lido certo: tudo confere.
{
  const r = reconcile(
    {
      ...blank,
      documentType: "boleto",
      issuer: { name: "Fornecedor X", document: "11.222.333/0001-81" },
      payer: { name: "Nossa Empresa", document: COMPANY },
      barcode: BARCODE,
      amountDue: 1234.56,
      dueDate: "2026-11-10",
    },
    "ai",
    payable,
  );
  assert.equal(r.counterpartyName, "Fornecedor X");
  assert.equal(r.counterpartyDocument, SUPPLIER);
  assert.equal(r.amount, 1234.56);
  assert.equal(r.dueDate, "2026-11-10");
  assert.equal(r.paymentMethod, "boleto");
  assert.equal(r.barcode, BARCODE);
  assert.ok(
    r.checks.every((c) => c.ok),
    JSON.stringify(r.checks),
  );
  assert.equal(r.confidence, 100);
}

// 2. IA errou valor e vencimento: vale a linha digitável, com aviso.
{
  const r = reconcile(
    {
      ...blank,
      issuer: { name: "Fornecedor X", document: SUPPLIER },
      barcode: BARCODE,
      amountDue: 1234.0,
      dueDate: "2026-11-09",
    },
    "ai",
    payable,
  );
  assert.equal(r.amount, 1234.56);
  assert.equal(r.dueDate, "2026-11-10");
  assert.equal(r.checks.filter((c) => !c.ok).length, 2);
  assert.ok(r.confidence < 100);
}

// 3. Linha com um dígito trocado: descartada, sem forma de pagamento chutada.
{
  const bad =
    BARCODE.slice(0, 10) + ((Number(BARCODE[10]) + 1) % 10) + BARCODE.slice(11);
  const r = reconcile(
    {
      ...blank,
      issuer: { name: "F", document: SUPPLIER },
      barcode: bad,
      amountDue: 10,
    },
    "ai",
    payable,
  );
  assert.equal(r.barcode, null);
  assert.equal(r.paymentMethod, null);
  assert.ok(r.checks.some((c) => !c.ok && c.label.includes("Linha digitável")));
}

// 4. IA trocou as partes: o CNPJ da empresa nunca vira fornecedor.
{
  const r = reconcile(
    {
      ...blank,
      issuer: { name: "Nossa Empresa", document: COMPANY },
      payer: { name: "Fornecedor X", document: SUPPLIER },
    },
    "ai",
    payable,
  );
  assert.equal(r.counterpartyDocument, SUPPLIER);
}

// 5. CNPJ com DV errado é descartado.
{
  const r = reconcile(
    { ...blank, issuer: { name: "F", document: "11222333000182" } },
    "ai",
    payable,
  );
  assert.equal(r.counterpartyName, "F");
  assert.equal(r.counterpartyDocument, null);
}

// 6. Chave de acesso dá nº, competência e CNPJ, acima do que a IA leu.
{
  const r = reconcile(
    {
      ...blank,
      documentType: "nfe",
      issuer: { name: "Fornecedor X", document: null },
      documentNumber: "12346",
      accessKey: KEY.replace(/(\d{4})/g, "$1 "),
      issueDate: "2026-11-03",
    },
    "ai",
    payable,
  );
  assert.equal(r.accessKey, KEY);
  assert.equal(r.documentNumber, "12345");
  assert.equal(r.competence, "2026-11");
  assert.equal(r.counterpartyDocument, SUPPLIER);
  assert.ok(r.notes?.includes("NF-e nº 12345 · emitida em 03/11/2026"));
}

// 7. Texto do PDF: linha e chave exatas; a chave não passa por boleto.
{
  const text = `DANFE Chave de acesso ${KEY.replace(/(\d{4})/g, "$1 ")} Recibo ${BARCODE}`;
  const found = findInText(text, today);
  assert.equal(found.accessKey, KEY);
  assert.equal(found.barcode, BARCODE);
  const onlyKey = findInText(`Chave ${KEY}`, today);
  assert.equal(onlyKey.barcode, null);
  const r = reconcile(
    { ...blank, issuer: { name: "F", document: SUPPLIER } },
    "ai",
    {
      ...payable,
      text,
    },
  );
  assert.equal(r.barcode, BARCODE);
  assert.equal(r.amount, 1234.56);
}

// 8. Retenções: valor = líquido; detalhe nas observações.
{
  const r = reconcile(
    {
      ...blank,
      documentType: "nfse",
      issuer: { name: "Prestador", document: SUPPLIER },
      totalAmount: 1000,
      withholdings: {
        iss: 50,
        irrf: 15,
        pis: null,
        cofins: null,
        csll: null,
        inss: 0,
      },
      dueDate: "2026-12-01",
    },
    "ai",
    payable,
  );
  assert.equal(r.amount, 935);
  assert.equal(r.grossAmount, 1000);
  assert.deepEqual(r.withholdings, { iss: 50, irrf: 15 });
  assert.ok(r.notes?.includes("Retenções: ISS"));
}

// 9. Duplicatas: total e 1º vencimento; soma conferida.
{
  const r = reconcile(
    {
      ...blank,
      issuer: { name: "F", document: SUPPLIER },
      totalAmount: 300,
      installments: [
        { number: 2, dueDate: "2026-12-10", amount: 100 },
        { number: 1, dueDate: "2026-11-10", amount: 100 },
        { number: 3, dueDate: "2027-01-10", amount: 100 },
      ],
    },
    "ai",
    payable,
  );
  assert.equal(r.amount, 300);
  assert.equal(r.dueDate, "2026-11-10");
  assert.equal(r.installments.length, 3);
  assert.ok(r.checks.find((c) => c.label.startsWith("Soma das parcelas"))?.ok);
}

// 10. Conta a receber: a contraparte é quem paga.
{
  const r = reconcile(
    {
      ...blank,
      issuer: { name: "Nossa Empresa", document: COMPANY },
      payer: { name: "Cliente Y", document: SUPPLIER },
    },
    "ai",
    { ...payable, type: "receivable" },
  );
  assert.equal(r.counterpartyName, "Cliente Y");
}

// 11. XML da NF-e: leitura exata, sem IA.
{
  const xml = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${KEY}" versao="4.00">
<ide><nNF>12345</nNF><dhEmi>2026-11-03T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>${SUPPLIER}</CNPJ><xNome>Fornecedor &amp; Cia</xNome><enderEmit><xMun>SP</xMun></enderEmit></emit>
<dest><CNPJ>${COMPANY}</CNPJ><xNome>Nossa Empresa</xNome></dest>
<det nItem="1"><prod><xProd>Parafuso</xProd></prod></det><det nItem="2"><prod><xProd>Porca</xProd></prod></det>
<total><ICMSTot><vNF>300.00</vNF></ICMSTot></total>
<cobr><fat><nFat>1</nFat><vLiq>300.00</vLiq></fat>
<dup><nDup>001</nDup><dVenc>2026-12-03</dVenc><vDup>150.00</vDup></dup>
<dup><nDup>002</nDup><dVenc>2027-01-03</dVenc><vDup>150.00</vDup></dup></cobr>
<pag><detPag><tPag>15</tPag><vPag>300.00</vPag></detPag></pag>
</infNFe></NFe></nfeProc>`;
  const raw = parseNfeXml(xml);
  assert.ok(raw);
  const r = reconcile(raw, "xml", { ...payable, text: xml });
  assert.equal(r.source, "xml");
  assert.equal(r.counterpartyName, "Fornecedor & Cia");
  assert.equal(r.counterpartyDocument, SUPPLIER);
  assert.equal(r.documentNumber, "12345");
  assert.equal(r.amount, 300);
  assert.equal(r.dueDate, "2026-12-03");
  assert.equal(r.installments.length, 2);
  assert.equal(r.paymentMethod, "boleto");
  assert.equal(r.competence, "2026-11");
  assert.ok(r.notes?.startsWith("Parafuso e mais 1 item"));
  assert.equal(r.confidence, 100, JSON.stringify(r.checks));
  assert.equal(parseNfeXml("<CompNfse></CompNfse>"), null);

  const snap = readingSnapshot(r);
  assert.equal(snap.fields.installments, 2);
  assert.deepEqual(snap.failedChecks, []);
}

console.log("check-document-reading: ok");

// Chave Pix e-mail como o Itaú imprime no PDF: espaço no lugar do ponto.
{
  const { extractPixKeys } = await import("../src/lib/matching/brazilian");
  assert.deepEqual(extractPixKeys("chave: fulano@gmail com cpf"), [
    "fulano@gmail.com",
  ]);
  assert.deepEqual(extractPixKeys("chave: nf@empresa com br"), [
    "nf@empresa.com.br",
  ]);
  assert.deepEqual(extractPixKeys("chave: fulano@gmail.com"), [
    "fulano@gmail.com",
  ]);
  console.log("check-document-reading (pix): ok");
}
