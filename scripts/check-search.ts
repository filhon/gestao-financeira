/**
 * Verificação da linguagem de busca (parser, matching e destaque).
 *   npm run check:search
 * Falha com exceção na primeira regra quebrada.
 */
import assert from "node:assert/strict";
import {
  buildHaystack,
  highlightRanges,
  looksLikePhrase,
  matchTransaction,
  needsReceipt,
  parseBRL,
  parseQuery,
  removeToken,
  sanitizeQuery,
  statusKey,
} from "../src/lib/search/query";
import type { Transaction } from "../src/lib/types";

const today = new Date(2026, 9, 26); // 26/10/2026

const tx = (over: Partial<Transaction> = {}) =>
  ({
    type: "payable",
    status: "draft",
    amount: 1234.56,
    dueDate: new Date(2026, 6, 15),
    ...over,
  }) as Transaction;

const hay = buildHaystack(
  ["Reembolso - Abastecimento", "Filipe Honório da Silva Santos"],
  ["12.345.678/0001-90"],
);
const match = (q: string, t = tx()) =>
  matchTransaction(t, parseQuery(q), hay, today);

// Valores em formato brasileiro e americano.
assert.equal(parseBRL("1.234,56"), 1234.56);
assert.equal(parseBRL("1234,56"), 1234.56);
assert.equal(parseBRL("1234.56"), 1234.56);
assert.equal(parseBRL("1.234"), 1234);
assert.equal(parseBRL("R$ 500"), 500);
assert.equal(parseBRL("abc"), undefined);

// Termos: todos precisam casar, sem acento, em qualquer campo.
assert.ok(match("filipe honorio"));
assert.ok(match("reembolso filipe"));
assert.ok(!match("reembolso maria"));
assert.ok(match('"da silva"'));
assert.ok(!match("-abastecimento"));

// Número solto casa com o valor; CNPJ casa sem pontuação.
assert.ok(match("1.234,56"));
assert.ok(match("R$ 1.234,56"));
assert.ok(match("12345678000190"));
assert.ok(!match("999,99"));

// Filtros de valor.
assert.ok(match(">1000"));
assert.ok(!match("valor:<1000"));
assert.ok(match("valor:1000-2000"));
assert.ok(!match("100-500"));

// Tipo, status e datas.
assert.ok(match("tipo:pagar"));
assert.ok(!match("tipo:receber"));
assert.equal(statusKey(tx(), today), "late"); // rascunho vencido em julho
assert.ok(match("status:atrasado"));
assert.ok(!match("status:atrasado", tx({ status: "paid" })));
assert.equal(statusKey(tx({ status: "received" }), today), "paid");
assert.ok(match("venc:2026-07"));
assert.ok(match("venc:07/2026"));
assert.ok(match("venc:01/07/2026..31/07/2026"));
assert.ok(!match("venc:2026-08"));
assert.ok(match("venc:2026"));
assert.ok(!match("pago:2026")); // sem data de pagamento
assert.ok(
  match(
    "pago:2026-10",
    tx({ status: "paid", paymentDate: new Date(2026, 9, 2) }),
  ),
);

// Pagas sem comprovante.
const paid = tx({ status: "paid", paymentDate: new Date(2026, 9, 2) });
assert.ok(match("sem:comprovante", paid));
assert.ok(!match("sem:comprovante", { ...paid, comprovanteId: "c1" }));
assert.ok(!match("sem:comprovante")); // não paga
// Antes do início do controle de comprovantes não é cobrada (tela Comprovantes).
const cutoff = new Date(2026, 9, 1);
assert.ok(
  matchTransaction(paid, parseQuery("sem:comprovante"), hay, today, cutoff),
);
assert.ok(
  !matchTransaction(
    { ...paid, paymentDate: new Date(2026, 8, 30) },
    parseQuery("sem:comprovante"),
    hay,
    today,
    cutoff,
  ),
);
assert.ok(!needsReceipt({ ...paid, paymentDate: undefined }, cutoff));

// Sem conta contábil: o que a DRE mostra como "sem conta"; rejeitada não entra.
assert.ok(match("sem:conta", paid));
assert.ok(!match("sem:conta", { ...paid, accountId: "a1" }));
assert.ok(!match("sem:conta", { ...paid, status: "rejected" }));

// Tokens viram chips; inválidos ficam marcados e saem na sanitização.
const q = parseQuery("tipo:pagar status:atrasado valor:>100 Filipe obs:x");
assert.deepEqual(
  q.tokens.map((t) => t.label),
  ["A pagar", "Atrasado", "Valor acima de R$ 100,00", "“Filipe”", "obs:x"],
);
assert.equal(q.tokens[4].invalid, true);
// Só a palavra livre fica fora dos chips.
assert.deepEqual(
  q.tokens.map((t) => !!t.text),
  [false, false, false, true, false],
);
assert.equal(parseQuery("-combustivel").tokens[0].text, undefined);
assert.equal(sanitizeQuery("tipo:pagar obs:x Filipe"), "tipo:pagar Filipe");
assert.equal(removeToken("tipo:pagar Filipe", "tipo:pagar"), "Filipe");
assert.deepEqual(parseQuery("Reforma 15 - Orçamento").terms.length, 3);

// Só frases com cara de filtro vão para a IA.
assert.ok(looksLikePhrase("reembolsos do Filipe sem comprovante em julho"));
assert.ok(looksLikePhrase("contas atrasadas acima de 500"));
assert.ok(!looksLikePhrase("Filipe Honório da Silva Santos"));
assert.ok(!looksLikePhrase("tipo:pagar Filipe julho"));

// Destaque ignora acento e une trechos sobrepostos.
assert.deepEqual(highlightRanges("Filipe Honório", ["honorio"]), [[7, 14]]);
assert.deepEqual(highlightRanges("abcabc", ["ab", "bc"]), [[0, 6]]);
assert.deepEqual(highlightRanges("Reembolso", ["xyz"]), []);

console.log("check:search ok");
