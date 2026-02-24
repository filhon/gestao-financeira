# API Financeira — Documentação para Integração Externa

> **Versão:** 1.0  
> **Base URL:** `https://{seu-dominio}/api/v1`  
> **Protocolo:** HTTPS obrigatório

---

## Sumário

1. [Autenticação](#1-autenticação)
2. [Assinatura de Requisições (HMAC)](#2-assinatura-de-requisições-hmac)
3. [Rate Limiting](#3-rate-limiting)
4. [Endpoints](#4-endpoints)
5. [Tratamento de Erros](#5-tratamento-de-erros)
6. [Exemplos de Integração](#6-exemplos-de-integração)
7. [Boas Práticas](#7-boas-práticas)

---

## 1. Autenticação

A API utiliza **API Keys** com **assinatura HMAC-SHA256** para autenticação. Ao receber suas credenciais, você terá:

| Credencial     | Formato                       | Descrição                                                |
| -------------- | ----------------------------- | -------------------------------------------------------- |
| **API Key**    | `gf_live_xxxxxxxxxxxxxxxx`    | Identifica sua aplicação                                 |
| **Secret Key** | `sk_xxxxxxxxxxxxxxxxxxxxxxxx` | Usada para assinar requisições (nunca envie no request!) |

### Headers Obrigatórios

Toda requisição deve conter os seguintes headers:

| Header         | Tipo   | Descrição                               |
| -------------- | ------ | --------------------------------------- |
| `X-API-Key`    | string | Sua API Key                             |
| `X-Timestamp`  | string | Unix timestamp (segundos) da requisição |
| `X-Signature`  | string | Assinatura HMAC-SHA256 (veja seção 2)   |
| `Content-Type` | string | `application/json`                      |

---

## 2. Assinatura de Requisições (HMAC)

Toda requisição deve ser assinada para garantir integridade e autenticidade.

### Algoritmo

1. Definir o **timestamp** (Unix, em segundos) — deve estar dentro de ±5 minutos do horário do servidor
2. Calcular o **hash SHA-256** do body (string vazia para GET)
3. Montar o **payload** de assinatura:
   ```
   {METHOD}\n{PATH}\n{TIMESTAMP}\n{BODY_HASH}
   ```
4. Gerar o **HMAC-SHA256** do payload usando sua **Secret Key**

### Exemplo passo a passo

Para uma requisição `GET /api/v1/balance`:

```
METHOD    = "GET"
PATH      = "/api/v1/balance"
TIMESTAMP = "1708790400"
BODY      = ""
BODY_HASH = sha256("") = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

PAYLOAD = "GET\n/api/v1/balance\n1708790400\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

SIGNATURE = HMAC-SHA256(SECRET_KEY, PAYLOAD)
```

> **Importante:** O `PATH` deve ser exatamente o path sem query params e sem trailing slash.

---

## 3. Rate Limiting

| Limite                        | Valor                     |
| ----------------------------- | ------------------------- |
| Requisições por minuto        | 60 (configurável por key) |
| Requisições por minuto por IP | 120                       |

Headers de resposta relacionados:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 57
X-RateLimit-Reset: 1708790460
```

Quando exceder o limite, receberá `429 Too Many Requests` com header `Retry-After`.

---

## 4. Endpoints

### 4.1 Consultar Saldo

```
GET /api/v1/balance
```

Retorna o saldo realizado (efetivo) atual da empresa vinculada à API Key.

**Parâmetros de query:**

| Param              | Tipo    | Default | Descrição                             |
| ------------------ | ------- | ------- | ------------------------------------- |
| `includeProjected` | boolean | `false` | Inclui valores pendentes (projetados) |

**Resposta:**

```json
{
  "data": {
    "currentBalance": 154320.5,
    "currency": "BRL",
    "updatedAt": "2026-02-24T14:30:00.000Z"
  },
  "meta": {
    "companyId": "abc123",
    "requestId": "req_a1b2c3d4"
  }
}
```

Com `includeProjected=true`:

```json
{
  "data": {
    "currentBalance": 154320.5,
    "projectedIncome": 45000.0,
    "projectedExpenses": 23000.0,
    "projectedBalance": 176320.5,
    "currency": "BRL",
    "updatedAt": "2026-02-24T14:30:00.000Z"
  }
}
```

---

### 4.2 Listar Transações

```
GET /api/v1/transactions
```

Retorna as transações da empresa com paginação e filtros.

**Parâmetros de query:**

| Param          | Tipo     | Default   | Descrição                                                                                                              |
| -------------- | -------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `page`         | integer  | `1`       | Número da página                                                                                                       |
| `limit`        | integer  | `25`      | Itens por página (máximo: 100)                                                                                         |
| `type`         | string   | —         | Filtrar por tipo: `payable` (a pagar) ou `receivable` (a receber)                                                      |
| `status`       | string   | —         | Filtrar por status: `draft`, `pending_approval`, `approved`, `pending_authorization`, `authorized`, `paid`, `rejected` |
| `startDate`    | ISO 8601 | —         | Data de vencimento mínima (ex: `2026-01-01`)                                                                           |
| `endDate`      | ISO 8601 | —         | Data de vencimento máxima (ex: `2026-12-31`)                                                                           |
| `costCenterId` | string   | —         | Filtrar por centro de custo                                                                                            |
| `entityId`     | string   | —         | Filtrar por fornecedor/cliente                                                                                         |
| `minAmount`    | number   | —         | Valor mínimo                                                                                                           |
| `maxAmount`    | number   | —         | Valor máximo                                                                                                           |
| `sortBy`       | string   | `dueDate` | Ordenar por: `dueDate`, `amount`, `createdAt`                                                                          |
| `sortOrder`    | string   | `desc`    | Direção: `asc` ou `desc`                                                                                               |

**Resposta:**

```json
{
  "data": [
    {
      "id": "txn_abc123",
      "description": "Pagamento fornecedor XYZ",
      "amount": 5000.0,
      "finalAmount": 4950.0,
      "discount": 50.0,
      "interest": 0.0,
      "type": "payable",
      "status": "paid",
      "dueDate": "2026-02-20T00:00:00.000Z",
      "paymentDate": "2026-02-19T00:00:00.000Z",
      "paymentMethod": "pix",
      "supplier": "Fornecedor XYZ Ltda",
      "entityId": "ent_xyz",
      "costCenter": {
        "id": "cc_001",
        "name": "Marketing",
        "code": "MKT-001"
      },
      "costCenterAllocations": [
        {
          "costCenterId": "cc_001",
          "costCenterName": "Marketing",
          "percentage": 70.0,
          "amount": 3465.0
        },
        {
          "costCenterId": "cc_002",
          "costCenterName": "Vendas",
          "percentage": 30.0,
          "amount": 1485.0
        }
      ],
      "installments": {
        "current": 1,
        "total": 3,
        "groupId": "inst_group_1"
      },
      "recurrence": {
        "isRecurring": true,
        "frequency": "monthly"
      },
      "requestOrigin": {
        "type": "department",
        "name": "Marketing"
      },
      "notes": "Ref: NF 12345",
      "reconciled": true,
      "createdAt": "2026-02-01T10:00:00.000Z",
      "updatedAt": "2026-02-19T14:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 25,
    "totalItems": 342,
    "totalPages": 14,
    "hasNext": true,
    "hasPrev": false
  },
  "meta": {
    "companyId": "abc123",
    "requestId": "req_a1b2c3d4"
  }
}
```

---

### 4.3 Consultar Transação Individual

```
GET /api/v1/transactions/{id}
```

Retorna os detalhes de uma transação específica.

**Resposta:** Mesmo schema de um item da listagem (seção 4.2).

---

### 4.4 Consultar Orçamentos

```
GET /api/v1/budgets
```

Retorna os orçamentos dos centros de custo com saldo projetado vs. consumido.

**Parâmetros de query:**

| Param          | Tipo    | Default   | Descrição                              |
| -------------- | ------- | --------- | -------------------------------------- |
| `year`         | integer | ano atual | Ano do orçamento                       |
| `costCenterId` | string  | —         | Filtrar por centro de custo específico |

**Resposta:**

```json
{
  "data": [
    {
      "costCenter": {
        "id": "cc_001",
        "name": "Marketing",
        "code": "MKT-001"
      },
      "year": 2026,
      "budgetAmount": 120000.0,
      "consumed": 45600.0,
      "remaining": 74400.0,
      "consumedPercentage": 38.0,
      "monthlyBreakdown": [
        { "month": "2026-01", "consumed": 12300.0 },
        { "month": "2026-02", "consumed": 33300.0 }
      ],
      "status": "on_track"
    }
  ],
  "meta": {
    "companyId": "abc123",
    "year": 2026,
    "requestId": "req_a1b2c3d4"
  }
}
```

**Status do orçamento:**

| Status        | Significado                              |
| ------------- | ---------------------------------------- |
| `on_track`    | Consumo ≤ 75% do proporcional ao período |
| `warning`     | Consumo entre 75% e 90%                  |
| `critical`    | Consumo entre 90% e 100%                 |
| `over_budget` | Consumo acima de 100%                    |
| `no_budget`   | Sem orçamento definido                   |

---

### 4.5 Listar Centros de Custo

```
GET /api/v1/cost-centers
```

Retorna os centros de custo da empresa.

**Parâmetros de query:**

| Param              | Tipo    | Default | Descrição                               |
| ------------------ | ------- | ------- | --------------------------------------- |
| `parentId`         | string  | —       | Retornar apenas filhos deste centro     |
| `includeHierarchy` | boolean | `false` | Retornar estrutura hierárquica (árvore) |

**Resposta:**

```json
{
  "data": [
    {
      "id": "cc_001",
      "name": "Marketing",
      "code": "MKT-001",
      "description": "Centro de custo de Marketing",
      "parentId": null,
      "budget": 120000.0,
      "budgetYear": 2026,
      "children": []
    }
  ],
  "meta": {
    "companyId": "abc123",
    "requestId": "req_a1b2c3d4"
  }
}
```

---

### 4.6 Resumo Financeiro Mensal

```
GET /api/v1/financial-summary
```

Retorna o resumo financeiro agregado por mês.

**Parâmetros de query:**

| Param        | Tipo    | Default   | Descrição                       |
| ------------ | ------- | --------- | ------------------------------- |
| `year`       | integer | ano atual | Ano de referência               |
| `startMonth` | string  | —         | Mês início (formato: `YYYY-MM`) |
| `endMonth`   | string  | —         | Mês fim (formato: `YYYY-MM`)    |

**Resposta:**

```json
{
  "data": {
    "year": 2026,
    "totals": {
      "income": 580000.0,
      "expenses": 425679.5,
      "balance": 154320.5
    },
    "monthly": [
      {
        "month": "2026-01",
        "income": 290000.0,
        "expenses": 212000.0,
        "balance": 78000.0
      }
    ]
  },
  "meta": {
    "companyId": "abc123",
    "requestId": "req_a1b2c3d4"
  }
}
```

---

## 5. Tratamento de Erros

Todas as respostas de erro seguem o formato padrão:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Descrição legível do erro"
  }
}
```

### Códigos de Erro

| HTTP Status | Código              | Descrição                                                  |
| ----------- | ------------------- | ---------------------------------------------------------- |
| `400`       | `BAD_REQUEST`       | Parâmetros inválidos ou ausentes                           |
| `401`       | `UNAUTHORIZED`      | API Key ausente, inválida ou expirada                      |
| `401`       | `SIGNATURE_INVALID` | Assinatura HMAC incorreta                                  |
| `401`       | `TIMESTAMP_EXPIRED` | Timestamp fora da janela de ±5 minutos                     |
| `403`       | `FORBIDDEN`         | API Key sem permissão para este endpoint                   |
| `403`       | `IP_NOT_ALLOWED`    | Seu IP não está na lista de IPs permitidos                 |
| `404`       | `NOT_FOUND`         | Recurso não encontrado                                     |
| `429`       | `RATE_LIMITED`      | Limite de requisições excedido (veja header `Retry-After`) |
| `500`       | `INTERNAL_ERROR`    | Erro interno do servidor                                   |

---

## 6. Exemplos de Integração

### JavaScript / Node.js

```javascript
const crypto = require("crypto");

class FinanceAPIClient {
  constructor(apiKey, secretKey, baseUrl) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = baseUrl;
  }

  _sign(method, path) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const bodyHash = crypto.createHash("sha256").update("").digest("hex");
    const payload = `${method}\n${path}\n${timestamp}\n${bodyHash}`;
    const signature = crypto
      .createHmac("sha256", this.secretKey)
      .update(payload)
      .digest("hex");
    return { timestamp, signature };
  }

  async request(method, path, queryParams = {}) {
    const { timestamp, signature } = this._sign(method, path);

    const url = new URL(`${this.baseUrl}${path}`);
    Object.entries(queryParams).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });

    const response = await fetch(url.toString(), {
      method,
      headers: {
        "X-API-Key": this.apiKey,
        "X-Timestamp": timestamp,
        "X-Signature": signature,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`API Error ${response.status}: ${error.error?.message}`);
    }

    return response.json();
  }

  // ── Métodos de conveniência ──

  async getBalance(includeProjected = false) {
    return this.request("GET", "/api/v1/balance", { includeProjected });
  }

  async getTransactions(filters = {}) {
    return this.request("GET", "/api/v1/transactions", filters);
  }

  async getTransaction(id) {
    return this.request("GET", `/api/v1/transactions/${id}`);
  }

  async getBudgets(year) {
    return this.request("GET", "/api/v1/budgets", { year });
  }

  async getCostCenters(includeHierarchy = false) {
    return this.request("GET", "/api/v1/cost-centers", { includeHierarchy });
  }

  async getFinancialSummary(year) {
    return this.request("GET", "/api/v1/financial-summary", { year });
  }
}

// ── Uso ──

const client = new FinanceAPIClient(
  "gf_live_abcdef1234567890",
  "sk_xxxxxxxxxxxxxxxxxxxxxxxx",
  "https://app.exemplo.com",
);

// Saldo atual
const balance = await client.getBalance();
console.log(`Saldo: R$ ${balance.data.currentBalance}`);

// Transações pagas do mês
const transactions = await client.getTransactions({
  type: "payable",
  status: "paid",
  startDate: "2026-02-01",
  endDate: "2026-02-28",
  limit: 50,
});

// Orçamentos do ano
const budgets = await client.getBudgets(2026);
```

### Python

```python
import hmac
import hashlib
import time
import requests

class FinanceAPIClient:
    def __init__(self, api_key: str, secret_key: str, base_url: str):
        self.api_key = api_key
        self.secret_key = secret_key
        self.base_url = base_url.rstrip('/')

    def _sign(self, method: str, path: str) -> tuple[str, str]:
        timestamp = str(int(time.time()))
        body_hash = hashlib.sha256(b'').hexdigest()
        payload = f"{method}\n{path}\n{timestamp}\n{body_hash}"
        signature = hmac.new(
            self.secret_key.encode(),
            payload.encode(),
            hashlib.sha256
        ).hexdigest()
        return timestamp, signature

    def _request(self, method: str, path: str, params: dict = None) -> dict:
        timestamp, signature = self._sign(method, path)

        response = requests.request(
            method,
            f"{self.base_url}{path}",
            params=params,
            headers={
                'X-API-Key': self.api_key,
                'X-Timestamp': timestamp,
                'X-Signature': signature,
                'Content-Type': 'application/json',
            },
        )
        response.raise_for_status()
        return response.json()

    def get_balance(self, include_projected: bool = False) -> dict:
        params = {'includeProjected': 'true'} if include_projected else {}
        return self._request('GET', '/api/v1/balance', params)

    def get_transactions(self, **filters) -> dict:
        return self._request('GET', '/api/v1/transactions', filters)

    def get_transaction(self, transaction_id: str) -> dict:
        return self._request('GET', f'/api/v1/transactions/{transaction_id}')

    def get_budgets(self, year: int = None, cost_center_id: str = None) -> dict:
        params = {}
        if year: params['year'] = year
        if cost_center_id: params['costCenterId'] = cost_center_id
        return self._request('GET', '/api/v1/budgets', params)

    def get_cost_centers(self, include_hierarchy: bool = False) -> dict:
        params = {'includeHierarchy': 'true'} if include_hierarchy else {}
        return self._request('GET', '/api/v1/cost-centers', params)

    def get_financial_summary(self, year: int = None) -> dict:
        params = {'year': year} if year else {}
        return self._request('GET', '/api/v1/financial-summary', params)


# ── Uso ──

client = FinanceAPIClient(
    api_key="gf_live_abcdef1234567890",
    secret_key="sk_xxxxxxxxxxxxxxxxxxxxxxxx",
    base_url="https://app.exemplo.com",
)

# Saldo
balance = client.get_balance()
print(f"Saldo: R$ {balance['data']['currentBalance']:,.2f}")

# Transações
txns = client.get_transactions(
    type="payable",
    status="paid",
    startDate="2026-01-01",
    endDate="2026-12-31",
    limit=100,
)
for txn in txns['data']:
    print(f"  {txn['description']}: R$ {txn['amount']:,.2f}")

# Orçamentos
budgets = client.get_budgets(year=2026)
for b in budgets['data']:
    print(f"  {b['costCenter']['name']}: {b['consumedPercentage']}% consumido ({b['status']})")
```

### C# / .NET

```csharp
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

public class FinanceAPIClient
{
    private readonly string _apiKey;
    private readonly string _secretKey;
    private readonly HttpClient _http;

    public FinanceAPIClient(string apiKey, string secretKey, string baseUrl)
    {
        _apiKey = apiKey;
        _secretKey = secretKey;
        _http = new HttpClient { BaseAddress = new Uri(baseUrl) };
    }

    private (string timestamp, string signature) Sign(string method, string path)
    {
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
        var bodyHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(""))).ToLower();
        var payload = $"{method}\n{path}\n{timestamp}\n{bodyHash}";

        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(_secretKey));
        var signature = Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(payload))).ToLower();

        return (timestamp, signature);
    }

    public async Task<JsonDocument> GetBalanceAsync()
    {
        var (ts, sig) = Sign("GET", "/api/v1/balance");
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/balance");
        request.Headers.Add("X-API-Key", _apiKey);
        request.Headers.Add("X-Timestamp", ts);
        request.Headers.Add("X-Signature", sig);

        var response = await _http.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        return JsonDocument.Parse(json);
    }
}
```

---

## 7. Boas Práticas

### Segurança

- **Nunca** exponha sua Secret Key no frontend ou em repositórios públicos
- Use variáveis de ambiente para armazenar as credenciais
- Mantenha seu relógio sincronizado (NTP) — a janela de timestamp é ±5 minutos
- Configure a lista de IPs permitidos se possível (entre em contato com o admin)

### Performance

- Use paginação — evite requisições com `limit` muito alto
- Cache respostas localmente quando apropriado (saldo: 30s, centros de custo: 10min)
- Use filtros para reduzir volume de dados transferidos

### Resiliência

- Implemente retry com backoff exponencial para erros `429` e `5xx`
- Respeite o header `Retry-After` em respostas `429`
- Trate timeouts (recomendado: 30s)

### Monitoramento

- Armazene os `requestId` retornados para referência em suporte
- Monitore os headers `X-RateLimit-Remaining` para evitar throttling

---

## Changelog

| Versão | Data       | Descrição                                                                                        |
| ------ | ---------- | ------------------------------------------------------------------------------------------------ |
| 1.0    | 24/02/2026 | Versão inicial — endpoints de saldo, transações, orçamentos, centros de custo, resumo financeiro |
