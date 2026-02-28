# API Financeira — Atualização v1.1

> **Data:** 27 de fevereiro de 2026  
> **Endpoint afetado:** `GET /api/v1/transactions`  
> **Tipo:** Nova funcionalidade (retrocompatível)

---

## Resumo

Adicionado suporte para filtrar transações por **múltiplos centros de custo** em uma única requisição, através dos novos parâmetros `costCenterIds` e `costCenterCodes`.

---

## O que mudou

### Novos parâmetros

| Parâmetro         | Tipo   | Descrição                                                                       |
| ----------------- | ------ | ------------------------------------------------------------------------------- |
| `costCenterIds`   | string | Lista de **IDs** de centros de custo separados por vírgula. Máximo: **10**.     |
| `costCenterCodes` | string | Lista de **códigos** de centros de custo separados por vírgula. Máximo: **10**. |

### Ordem de prioridade

`costCenterCodes` > `costCenterIds` > `costCenterId`

Se `costCenterCodes` for informado, os demais parâmetros de centro de custo são ignorados.

### Quando usar cada parâmetro

| Parâmetro         | Use quando…                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `costCenterId`    | Você já tem o ID interno e quer filtrar por **um** centro de custo                                                  |
| `costCenterIds`   | Você já tem os IDs internos e quer filtrar por **vários** centros de custo                                          |
| `costCenterCodes` | Você tem os **códigos** dos centros de custo (ex: `CC-OFERTAS`, `MKT-001`) — o mais comum para integrações externas |

---

## Exemplos de uso

### Filtrar por um único centro de custo via ID (comportamento existente)

```
GET /api/v1/transactions?costCenterId=abc123
```

### Filtrar por múltiplos centros de custo via ID

```
GET /api/v1/transactions?costCenterIds=abc123,def456,ghi789
```

### Filtrar por código do centro de custo (recomendado para integrações)

```
GET /api/v1/transactions?costCenterCodes=CC-OFERTAS,CC-EDUC,CC-SAUDE
```

### Combinar com outros filtros

```
GET /api/v1/transactions?costCenterCodes=CC-OFERTAS,CC-EDUC&type=payable&status=approved&allDates=true
```

---

## Como obter os códigos dos centros de custo

Use o endpoint `GET /api/v1/cost-centers` para listar todos os centros de custo da sua empresa. Cada item retorna `id`, `name` e `code`:

```json
{
  "data": [
    { "id": "abc123", "name": "Ofertas", "code": "CC-OFERTAS" },
    { "id": "def456", "name": "Educação", "code": "CC-EDUC" },
    { "id": "ghi789", "name": "Saúde", "code": "CC-SAUDE" }
  ]
}
```

Use os valores do campo `code` no parâmetro `costCenterCodes`.

---

## Exemplos de integração

### JavaScript / TypeScript

```javascript
// Filtrar por códigos de centros de custo (recomendado)
const response = await client.getTransactions({
  costCenterCodes: "CC-OFERTAS,CC-EDUC,CC-SAUDE",
  type: "payable",
  allDates: true,
});
```

Ou montando a URL manualmente:

```javascript
const codes = ["CC-OFERTAS", "CC-EDUC", "CC-SAUDE"];
const params = new URLSearchParams({
  costCenterCodes: codes.join(","),
  type: "payable",
});

const response = await fetch(`${BASE_URL}/api/v1/transactions?${params}`, {
  headers: {
    "X-API-Key": API_KEY,
    "X-Timestamp": timestamp,
    "X-Signature": signature,
    "Content-Type": "application/json",
  },
});
```

### Python

```python
# Filtrar por códigos de centros de custo (recomendado)
codes = ["CC-OFERTAS", "CC-EDUC", "CC-SAUDE"]
transactions = client.get_transactions(
    costCenterCodes=",".join(codes),
    type="payable",
    allDates="true",
)
```

---

## Validações e limites

| Regra                       | Detalhe                                                           |
| --------------------------- | ----------------------------------------------------------------- |
| Máximo de IDs / códigos     | **10** por requisição                                             |
| Códigos inexistentes        | Retorna lista vazia com campo `costCenterCodesNotFound` no `meta` |
| IDs inválidos/inexistentes  | São aceitos, mas não retornam resultados correspondentes          |
| Prioridade entre parâmetros | `costCenterCodes` > `costCenterIds` > `costCenterId`              |

### Resposta de erro (mais de 10 itens)

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Too many cost center codes. Maximum allowed: 10."
  }
}
```

### Resposta quando nenhum código é encontrado

```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 25,
    "totalItems": 0,
    "totalPages": 0,
    "hasNext": false,
    "hasPrev": false
  },
  "meta": {
    "costCenterCodesNotFound": ["CC-INEXISTENTE"]
  }
}
```

---

## Retrocompatibilidade

Esta alteração é **100% retrocompatível**. Integrações existentes que utilizam `costCenterId` (singular) continuam funcionando sem nenhuma alteração.
