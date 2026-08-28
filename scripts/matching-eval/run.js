/**
 * Executa a suíte de avaliação do motor de matching.
 *
 * O projeto não tem test runner; esta é a alternativa sem dependências:
 * `tsc` emite CommonJS em ./out e este runner resolve o alias "@/" em runtime.
 * Use `npm run eval:matching`.
 */
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "out", "src");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(ROOT, request.slice(2));
  return resolve.call(this, request, ...rest);
};

require("./out/scripts/matching-eval/eval.js");
