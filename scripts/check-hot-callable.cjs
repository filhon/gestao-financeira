/**
 * Verifica por HTTP real o embrulho `hotCallable`: o preflight sai com cache e
 * a function continua sendo callable, sem tocar no banco.
 *   npm run check:hot-callable
 * Falha com exceção na primeira regra quebrada.
 */
const assert = require("node:assert/strict");
const path = require("node:path");

const functionsDir = path.join(__dirname, "..", "functions");
const express = require(path.join(functionsDir, "node_modules", "express"));
const ledger = require(path.join(functionsDir, "lib", "transactionLedger.js"));
const fn = ledger.setTransactionStatus;

// O deploy recusa trocar um callable por uma function HTTP.
assert.ok(fn.__endpoint?.callableTrigger, "__endpoint.callableTrigger");
assert.equal(typeof fn.run, "function");

const app = express();
app.use(express.json());
app.all("/fn", (req, res) => fn(req, res));

const server = app.listen(0, async () => {
  const url = `http://127.0.0.1:${server.address().port}/fn`;
  const origin = "https://exemplo.test";
  try {
    const preflight = await fetch(url, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-max-age"), "7200");
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
    assert.match(
      preflight.headers.get("access-control-allow-headers"),
      /authorization/i,
    );

    const post = (data) =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ data }),
      });

    const warm = await post({ warmup: true });
    assert.equal(warm.status, 200);
    assert.deepEqual(await warm.json(), { result: { warm: true } });
    assert.equal(warm.headers.get("access-control-allow-origin"), origin);

    // Sem login, a validação do handler continua valendo.
    const anon = await post({ transactionId: "x", status: "paid" });
    assert.equal(anon.status, 401);

    console.log("ok: preflight com cache e callable preservado");
  } finally {
    server.close();
  }
});
