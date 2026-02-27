# API Financeira — Atualização v1.1

> **Data:** 27 de fevereiro de 2026  
> **Endpoint afetado:** `GET /api/v1/transactions`  
> **Tipo:** Nova funcionalidade (retrocompatível)

---

## Resumo

Adicionado suporte para filtrar transações por **múltiplos centros de custo** em uma única requisição, através do novo parâmetro `costCenterIds`.

---

## O que mudou

### Novo parâmetro: `costCenterIds`

| Parâmetro       | Tipo   | Descrição                                                                   |
| --------------- | ------ | --------------------------------------------------------------------------- |
| `costCenterIds` | string | Lista de IDs de centros de custo separados por vírgula. Máximo: **10 IDs**. |

- Quando informado, tem **prioridade** sobre o parâmetro `costCenterId` (singular).
- O parâmetro `costCenterId` (singular) continua funcionando normalmente para filtrar por um único centro de custo.

---

## Exemplos de uso

### Filtrar por um único centro de custo (comportamento existente)

```
GET /api/v1/transactions?costCenterId=cc_001
```

### Filtrar por múltiplos centros de custo (novo)

```
GET /api/v1/transactions?costCenterIds=cc_001,cc_002,cc_003
```

### Combinar com outros filtros

```
GET /api/v1/transactions?costCenterIds=cc_001,cc_002&type=payable&status=approved&allDates=true
```

---

## Exemplos de integração

### JavaScript / TypeScript

```javascript
// Filtrar por múltiplos centros de custo
const response = await client.getTransactions({
  costCenterIds: "cc_001,cc_002,cc_003",
  type: "payable",
  allDates: true,
});
```

Ou montando a URL manualmente:

```javascript
const costCenters = ["cc_001", "cc_002", "cc_003"];
const params = new URLSearchParams({
  costCenterIds: costCenters.join(","),
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
# Filtrar por múltiplos centros de custo
cost_centers = ["cc_001", "cc_002", "cc_003"]
transactions = client.get_transactions(
    costCenterIds=",".join(cost_centers),
    type="payable",
    allDates="true",
)
```

---

## Validações e limites

| Regra                            | Detalhe                                                       |
| -------------------------------- | ------------------------------------------------------------- |
| Máximo de IDs                    | **10** por requisição                                         |
| IDs inválidos/inexistentes       | São aceitos, mas não retornam resultados correspondentes      |
| `costCenterIds` + `costCenterId` | `costCenterIds` tem **prioridade**; `costCenterId` é ignorado |

### Resposta de erro (mais de 10 IDs)

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Too many cost center IDs. Maximum allowed: 10."
  }
}
```

---

## Retrocompatibilidade

Esta alteração é **100% retrocompatível**. Integrações existentes que utilizam `costCenterId` (singular) continuam funcionando sem nenhuma alteração.
