// node scripts/check-documents.mjs  (Node 22.18+ importa .ts direto)
import assert from "node:assert/strict";
import {
  maskCpfCnpj,
  validateCnpj,
  validateCpf,
} from "../src/lib/validations/cnpj.ts";

// CPF: dígitos verificadores, repetidos e tamanho errado
assert.equal(validateCpf("529.982.247-25"), true);
assert.equal(validateCpf("52998224725"), true);
assert.equal(validateCpf("52998224726"), false);
assert.equal(validateCpf("111.111.111-11"), false);
assert.equal(validateCpf("5299822472"), false);
assert.equal(validateCnpj("11.222.333/0001-81"), true);

// Máscara enquanto digita: CPF até 11 dígitos, CNPJ depois
assert.equal(maskCpfCnpj("529"), "529");
assert.equal(maskCpfCnpj("5299"), "529.9");
assert.equal(maskCpfCnpj("5299822"), "529.982.2");
assert.equal(maskCpfCnpj("5299822472"), "529.982.247-2");
assert.equal(maskCpfCnpj("52998224725"), "529.982.247-25");
assert.equal(maskCpfCnpj("112223330001"), "11.222.333/0001");
assert.equal(maskCpfCnpj("11222333000181"), "11.222.333/0001-81");
assert.equal(maskCpfCnpj("11.222.333/0001-8199"), "11.222.333/0001-81");

console.log("check-documents: ok");
