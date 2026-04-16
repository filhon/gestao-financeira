# API Financeira — Atualização v1.2

> **Data:** 28 de fevereiro de 2026  
> **Endpoints afetados:** `GET /api/v1/transactions`, `GET /api/v1/transactions/search` (novo)  
> **Tipo:** Nova funcionalidade (retrocompatível)

---

## Resumo

Adicionado suporte para **busca textual** de transações de duas formas complementares:

1. **Parâmetro `search`** no endpoint existente `GET /api/v1/transactions` — para buscas com payload completo e paginação
2. **Novo endpoint `GET /api/v1/transactions/search`** — otimizado para **Typeahead/Combobox**, com payload mínimo, limite fixo de 20 resultados, e rate limit maior (60 req/min)

---

## O que mudou

### Novo endpoint: `GET /api/v1/transactions/search`

Endpoint dedicado e leve para busca textual, projetado para uso em Typeahead/Combobox.

| Característica        | `/api/v1/transactions?search=...`              | `/api/v1/transactions/search?q=...`                                                          |
| --------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Payload**           | Transação completa (alocações, parcelas, etc.) | Mínimo: `id`, `description`, `amount`, `type`, `status`, `dueDate`, `supplier`, `costCenter` |
| **Paginação**         | Completa (page, totalItems, totalPages, etc.)  | Sem paginação — retorna até 20 resultados                                                    |
| **Rate limit**        | 30 req/min                                     | 60 req/min                                                                                   |
| **Cap de documentos** | 5.000 documentos escaneados                    | 5.000 documentos escaneados                                                                  |
| **Caso de uso**       | Listagens, relatórios, exportação              | Typeahead, Combobox, vinculação rápida                                                       |

### Novo parâmetro `search` no endpoint existente

| Parâmetro | Tipo   | Descrição                                                                                                              |
| --------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| `search`  | string | Termo de busca textual (mín. 2, máx. 100 caracteres). Pesquisa case-insensitive em `description`, `notes` e `supplier` |

### Detalhes da implementação

- A busca é do tipo **contains** (substring), não exata. O termo `"projeto"` encontrará `"Pagamento Projeto Alpha"`.
- A comparação é **case-insensitive**: `"PROJETO"`, `"projeto"` e `"Projeto"` retornam os mesmos resultados.
- Quando `search` é utilizado, a **paginação e contagem** são precisas — o filtro é aplicado antes da paginação, não depois.
- O parâmetro pode ser combinado livremente com todos os filtros existentes (`type`, `status`, `costCenterCodes`, `entityId`, `minAmount`, `maxAmount`, etc).

### Campos pesquisados

| Campo         | Descrição                                           |
| ------------- | --------------------------------------------------- |
| `description` | Descrição principal da transação                    |
| `notes`       | Notas/observações (ex: referência de NF)            |
| `supplier`    | Nome do fornecedor ou cliente vinculado à transação |

---

## Exemplos de uso

### Buscar pelo nome do projeto

```
GET /api/v1/transactions?search=Projeto Alpha&allDates=true
```

### Buscar por número de nota fiscal nas notas

```
GET /api/v1/transactions?search=NF 12345&allDates=true
```

### Buscar pelo nome do fornecedor

```
GET /api/v1/transactions?search=Fornecedor XYZ
```

### Combinar busca com outros filtros

```
GET /api/v1/transactions?search=consultoria&type=payable&status=paid&startDate=2026-01-01&endDate=2026-12-31
```

### Buscar em centros de custo específicos

```
GET /api/v1/transactions?search=treinamento&costCenterCodes=MKT-001,RH-001&allDates=true
```

---

## Caso de uso: Typeahead / Combobox

**Recomendado: usar o endpoint dedicado** `GET /api/v1/transactions/search` para typeahead:

```javascript
// Frontend — Combobox com busca no financeiro (RECOMENDADO)
const searchTransactions = async (query) => {
  const response = await apiClient.request(
    "GET",
    "/api/v1/transactions/search",
    {
      q: query,
      allDates: true,
      limit: 10,
    },
  );
  return response.data; // Array leve para popular o combobox
};
```

O endpoint `/api/v1/transactions?search=...` continua disponível para buscas com payload completo quando necessário (relatórios, exportações, etc.).

---

## Validações

| Endpoint                      | Parâmetro | Regra                  | Erro retornado                                                    |
| ----------------------------- | --------- | ---------------------- | ----------------------------------------------------------------- |
| `/api/v1/transactions`        | `search`  | Menos de 2 caracteres  | `400` — "Parameter 'search' must be at least 2 characters long."  |
| `/api/v1/transactions`        | `search`  | Mais de 100 caracteres | `400` — "Parameter 'search' must be at most 100 characters long." |
| `/api/v1/transactions/search` | `q`       | Ausente ou vazio       | `400` — "Parameter 'q' is required for search."                   |
| `/api/v1/transactions/search` | `q`       | Menos de 2 caracteres  | `400` — "Parameter 'q' must be at least 2 characters long."       |
| `/api/v1/transactions/search` | `q`       | Mais de 100 caracteres | `400` — "Parameter 'q' must be at most 100 characters long."      |

---

## Notas de performance

- Ambos os endpoints utilizam um **cap de segurança de 5.000 documentos** escaneados em memória, evitando sobrecarga com datasets muito grandes.
- Quando o cap é atingido, o campo `scanCapped: true` é retornado no meta (endpoint de search). Recomenda-se refinar com filtros de data ou centros de custo.
- O endpoint de search retorna **no máximo 20 resultados** e possui rate limit de **60 req/min** (vs. 30 req/min do endpoint principal).

---

## Retrocompatibilidade

- Totalmente retrocompatível — novos parâmetros e endpoint são opcionais
- Sem alterações em responses existentes
- Sem necessidade de atualizar clientes que não usam o recurso
- O endpoint existente `GET /api/v1/transactions` continua funcionando exatamente como antes
