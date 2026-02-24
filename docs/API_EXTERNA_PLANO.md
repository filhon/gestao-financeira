# Plano de Implementação — API Externa

> **Data:** 24/02/2026  
> **Status:** Fase 1 Implementada ✅  
> **Versão da API:** v1

---

## 1. Visão Geral

Implementação de uma API REST externa para expor dados financeiros do sistema a integrações de terceiros (ERPs, BI tools, dashboards externos, etc.). A API será construída como **Next.js API Routes** (`/api/v1/*`), reutilizando a infraestrutura existente (Firebase/Firestore) com uma camada de segurança dedicada.

### Endpoints Solicitados

| #   | Endpoint                   | Descrição                                 |
| --- | -------------------------- | ----------------------------------------- |
| 1   | `GET /api/v1/balance`      | Saldo atual (realizado) da empresa        |
| 2   | `GET /api/v1/transactions` | Transações da empresa (com filtros)       |
| 3   | `GET /api/v1/budgets`      | Orçamentos dos centros de custo (por ano) |

### Endpoints Adicionais Recomendados

| #   | Endpoint                        | Justificativa                                                                            |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| 4   | `GET /api/v1/cost-centers`      | Necessário para interpretar os dados de transações e orçamentos (IDs → nomes)            |
| 5   | `GET /api/v1/financial-summary` | Resumo mensal de receitas/despesas — evita que o consumidor precise calcular do zero     |
| 6   | `GET /api/v1/transactions/:id`  | Consulta individual de transação (útil para webhooks e reconciliação)                    |
| 7   | `POST /api/v1/webhooks`         | Cadastro de webhooks para notificação em tempo real (ex: nova transação paga) — _fase 2_ |

---

## 2. Arquitetura de Segurança

### 2.1 Autenticação — API Keys com HMAC

```
┌──────────────┐     HTTPS + Headers      ┌──────────────────┐
│ Sistema      │ ───────────────────────►  │  API Gateway      │
│ Externo      │  X-API-Key: <key>        │  (Next.js Route)  │
│              │  X-Timestamp: <ts>       │                    │
│              │  X-Signature: <hmac>     │  ► Valida Key      │
└──────────────┘                          │  ► Valida HMAC     │
                                          │  ► Valida IP       │
                                          │  ► Rate Limit      │
                                          │  ► Scopa Empresa   │
                                          └──────────────────┘
```

**Modelo de API Key (Firestore: `api_keys`):**

```typescript
interface ApiKey {
  id: string; // ID do documento
  hashedKey: string; // SHA-256 do API Key real
  prefix: string; // Primeiros 8 chars para lookup (ex: "gf_live_ab")
  companyId: string; // Empresa vinculada (isolamento de tenant)
  secretKey: string; // HMAC secret (armazenado criptografado, AES-256)
  name: string; // Nome descritivo (ex: "ERP Integração")

  // Permissões granulares
  permissions: {
    balance: boolean;
    transactions: boolean;
    budgets: boolean;
    costCenters: boolean;
    financialSummary: boolean;
  };

  // Restrições
  allowedIPs: string[]; // Lista branca de IPs (vazio = qualquer IP)
  rateLimitPerMinute: number; // Limite custom por key (default: 60)

  // Metadados
  active: boolean;
  expiresAt?: Date; // Expiração opcional
  lastUsedAt?: Date;
  createdBy: string; // UID do admin que criou
  createdAt: Date;
  updatedAt: Date;
}
```

### 2.2 Fluxo de Autenticação (por requisição)

```
1. Extrair headers: X-API-Key, X-Timestamp, X-Signature
2. Validar presença dos 3 headers
3. Validar que X-Timestamp está dentro de ±5 minutos (anti-replay)
4. Buscar API Key pelo prefix (primeiros 8 chars)
5. Comparar SHA-256 da key completa com hashedKey armazenado
6. Verificar se a key está ativa e não expirada
7. Validar IP do request contra allowedIPs (se configurado)
8. Verificar permissão para o endpoint específico
9. Validar HMAC-SHA256 da signature:
   - payload = method + path + timestamp + body_hash
   - signature_esperada = HMAC-SHA256(secretKey, payload)
   - Comparar com X-Signature usando timing-safe comparison
10. Aplicar rate limiting por API Key
11. Logar acesso no audit log
12. Processar request com companyId da key
```

### 2.3 Rate Limiting

| Camada        | Limite                                    | Window |
| ------------- | ----------------------------------------- | ------ |
| Global por IP | 120 req/min                               | 1 min  |
| Por API Key   | Configurável (default: 60 req/min)        | 1 min  |
| Por Endpoint  | `transactions`: 30/min, `balance`: 60/min | 1 min  |

> **Produção:** Migrar do rate limiting in-memory atual para **Redis** (Upstash) para funcionar com múltiplas instâncias.

### 2.4 Proteções Adicionais

- **HTTPS obrigatório** — rejeitar requests HTTP
- **CORS restritivo** — sem `Access-Control-Allow-Origin: *`; configurável por API Key
- **Tamanho máximo de resposta** — paginação obrigatória (max 100 itens/página)
- **Campos sensíveis filtrados** — `approvalToken`, `createdBy` (UID), `attachments.url` (assinados) não expostos
- **Idempotency** — `X-Request-ID` header para deduplicação
- **Versionamento** — prefixo `/api/v1/` para breaking changes futuros

---

## 3. Especificação dos Endpoints

### 3.1 `GET /api/v1/balance`

Retorna o saldo realizado atual da empresa.

**Fonte de dados:** Coleção `company_stats` (mantida em tempo real por Cloud Function trigger `onTransactionWrite`).

**Response 200:**

```json
{
  "data": {
    "currentBalance": 154320.5,
    "currency": "BRL",
    "updatedAt": "2026-02-24T14:30:00Z"
  },
  "meta": {
    "companyId": "abc123",
    "requestId": "req_xxx"
  }
}
```

**Query Params opcionais:**
| Param | Tipo | Descrição |
|-------|------|-----------|
| `includeProjected` | boolean | Incluir saldo projetado (pendentes) |

Se `includeProjected=true`:

```json
{
  "data": {
    "currentBalance": 154320.5,
    "projectedIncome": 45000.0,
    "projectedExpenses": 23000.0,
    "projectedBalance": 176320.5,
    "currency": "BRL",
    "updatedAt": "2026-02-24T14:30:00Z"
  }
}
```

---

### 3.2 `GET /api/v1/transactions`

Lista transações com filtros, paginação e ordenação.

**Fonte de dados:** Coleção `transactions` filtrada por `companyId`.

**Query Params:**
| Param | Tipo | Obrigatório | Default | Descrição |
|-------|------|-------------|---------|-----------|
| `page` | number | não | 1 | Página |
| `limit` | number | não | 25 | Itens por página (max: 100) |
| `type` | string | não | — | `payable` \| `receivable` |
| `status` | string | não | — | `draft`, `pending_approval`, `approved`, `paid`, `rejected` |
| `startDate` | ISO 8601 | não | — | Data de vencimento início |
| `endDate` | ISO 8601 | não | — | Data de vencimento fim |
| `costCenterId` | string | não | — | Filtrar por centro de custo |
| `entityId` | string | não | — | Filtrar por fornecedor/cliente |
| `minAmount` | number | não | — | Valor mínimo |
| `maxAmount` | number | não | — | Valor máximo |
| `sortBy` | string | não | `dueDate` | Campo para ordenação |
| `sortOrder` | string | não | `desc` | `asc` \| `desc` |

**Response 200:**

```json
{
  "data": [
    {
      "id": "txn_abc123",
      "description": "Pagamento fornecedor XYZ",
      "amount": 5000.0,
      "finalAmount": 4950.0,
      "discount": 50.0,
      "interest": 0,
      "type": "payable",
      "status": "paid",
      "dueDate": "2026-02-20T00:00:00Z",
      "paymentDate": "2026-02-19T00:00:00Z",
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
          "percentage": 70,
          "amount": 3465.0
        },
        {
          "costCenterId": "cc_002",
          "costCenterName": "Vendas",
          "percentage": 30,
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
      "createdAt": "2026-02-01T10:00:00Z",
      "updatedAt": "2026-02-19T14:30:00Z"
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
    "requestId": "req_xxx"
  }
}
```

> **Nota:** Campos internos como `approvalToken`, `batchId`, `createdBy` (UID) não são expostos. O campo `supplierOrClient` é mapeado para `supplier` no response.

---

### 3.3 `GET /api/v1/transactions/:id`

Retorna uma transação específica por ID.

**Response 200:** Mesmo schema de um item da lista.

**Response 404:**

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Transaction not found"
  }
}
```

---

### 3.4 `GET /api/v1/budgets`

Retorna orçamentos de centros de custo por ano.

**Fonte de dados:** Coleções `budgets`, `cost_centers` e `cost_center_usage`.

**Query Params:**
| Param | Tipo | Obrigatório | Default | Descrição |
|-------|------|-------------|---------|-----------|
| `year` | number | não | ano atual | Ano do orçamento |
| `costCenterId` | string | não | — | Filtrar por centro de custo específico |

**Response 200:**

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
    "requestId": "req_xxx"
  }
}
```

| `status`      | Regra                                              |
| ------------- | -------------------------------------------------- |
| `on_track`    | Consumo ≤ 75% do orçamento proporcional ao período |
| `warning`     | Consumo entre 75% e 90%                            |
| `critical`    | Consumo > 90%                                      |
| `over_budget` | Consumo > 100%                                     |
| `no_budget`   | Orçamento não definido                             |

---

### 3.5 `GET /api/v1/cost-centers`

Lista centros de custo da empresa.

**Query Params:**
| Param | Tipo | Descrição |
|-------|------|-----------|
| `parentId` | string | Filtrar filhos de um centro pai |
| `includeHierarchy` | boolean | Retornar árvore hierárquica |

**Response 200:**

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
      "availableBalance": 74400.0,
      "children": [
        {
          "id": "cc_003",
          "name": "Marketing Digital",
          "code": "MKT-DIG-001",
          "parentId": "cc_001"
        }
      ]
    }
  ],
  "meta": {
    "companyId": "abc123",
    "requestId": "req_xxx"
  }
}
```

---

### 3.6 `GET /api/v1/financial-summary`

Resumo financeiro mensal.

**Fonte de dados:** Coleção `financial_summaries` (mantida por Cloud Function trigger).

**Query Params:**
| Param | Tipo | Obrigatório | Default | Descrição |
|-------|------|-------------|---------|-----------|
| `year` | number | não | ano atual | Ano |
| `startMonth` | string | não | — | Mês início (YYYY-MM) |
| `endMonth` | string | não | — | Mês fim (YYYY-MM) |

**Response 200:**

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
      },
      {
        "month": "2026-02",
        "income": 290000.0,
        "expenses": 213679.5,
        "balance": 76320.5
      }
    ]
  },
  "meta": {
    "companyId": "abc123",
    "requestId": "req_xxx"
  }
}
```

---

## 4. Tratamento de Erros (Padrão)

Todas as respostas de erro seguem o formato:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Descrição legível",
    "details": {}
  }
}
```

| HTTP Status | Code                | Situação                          |
| ----------- | ------------------- | --------------------------------- |
| 400         | `BAD_REQUEST`       | Parâmetros inválidos              |
| 401         | `UNAUTHORIZED`      | API Key ausente ou inválida       |
| 401         | `SIGNATURE_INVALID` | HMAC signature inválida           |
| 401         | `TIMESTAMP_EXPIRED` | Timestamp fora do range de ±5min  |
| 403         | `FORBIDDEN`         | Key sem permissão para o endpoint |
| 403         | `IP_NOT_ALLOWED`    | IP não está na allow list         |
| 404         | `NOT_FOUND`         | Recurso não encontrado            |
| 429         | `RATE_LIMITED`      | Rate limit excedido               |
| 500         | `INTERNAL_ERROR`    | Erro interno                      |

**Headers de resposta incluídos:**

```
X-Request-ID: req_xxx
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 57
X-RateLimit-Reset: 1708790400
```

---

## 5. Estrutura de Arquivos (Implementação)

```
src/
  app/
    api/
      v1/
        balance/
          route.ts              # GET /api/v1/balance
        transactions/
          route.ts              # GET /api/v1/transactions
          [id]/
            route.ts            # GET /api/v1/transactions/:id
        budgets/
          route.ts              # GET /api/v1/budgets
        cost-centers/
          route.ts              # GET /api/v1/cost-centers
        financial-summary/
          route.ts              # GET /api/v1/financial-summary
  lib/
    api/
      apiAuth.ts                # Middleware de autenticação API Key + HMAC
      apiRateLimit.ts           # Rate limiting dedicado (Redis/Upstash)
      apiResponse.ts            # Helpers de response padronizado
      apiAudit.ts               # Audit logging para requests da API
      apiKeyService.ts          # CRUD de API Keys (admin)
      apiValidation.ts          # Validação de query params (zod)
      apiSanitizer.ts           # Sanitização de dados para response (remove campos sensíveis)
      types.ts                  # Tipos da API

  # Admin UI para gerenciar API Keys
  app/
    (dashboard)/
      configuracoes/
        api-keys/
          page.tsx              # Tela de gerenciamento de API Keys
```

---

## 6. Plano de Implementação (Fases)

### Fase 1 — Core ✅ Implementado

| #   | Tarefa                                                  | Status |
| --- | ------------------------------------------------------- | ------ |
| 1.1 | Criar coleção `api_keys` no Firestore + Firestore Rules | ✅     |
| 1.2 | Implementar `apiAuth.ts` (validação de key + HMAC)      | ✅     |
| 1.3 | Implementar `apiRateLimit.ts` (in-memory inicial)       | ✅     |
| 1.4 | Implementar `apiResponse.ts` + `apiSanitizer.ts`        | ✅     |
| 1.5 | Implementar `apiAudit.ts` (log de requests)             | ✅     |
| 1.6 | Endpoint `GET /api/v1/balance`                          | ✅     |
| 1.7 | Endpoint `GET /api/v1/transactions` + `/:id`            | ✅     |
| 1.8 | Endpoint `GET /api/v1/budgets`                          | ✅     |

### Fase 2 — Complemento (Estimativa: ~2 dias dev)

| #   | Tarefa                                    | Prioridade |
| --- | ----------------------------------------- | ---------- |
| 2.1 | Endpoint `GET /api/v1/cost-centers`       | Média      |
| 2.2 | Endpoint `GET /api/v1/financial-summary`  | Média      |
| 2.3 | UI Admin para gerar/revogar API Keys      | Média      |
| 2.4 | Migrar rate limiting para Redis (Upstash) | Média      |

### Fase 3 — Avançado (Futuro)

| #   | Tarefa                                              | Prioridade |
| --- | --------------------------------------------------- | ---------- |
| 3.1 | Webhooks (real-time notifications)                  | Baixa      |
| 3.2 | OAuth 2.0 Client Credentials como alternativa       | Baixa      |
| 3.3 | SDK/Client library para consumidores                | Baixa      |
| 3.4 | Portal de documentação interativo (Swagger/OpenAPI) | Baixa      |

---

## 7. Firestore Rules (api_keys)

```javascript
match /api_keys/{keyId} {
  // Apenas admins da empresa podem ler/gerenciar keys
  allow read: if request.auth != null
    && get(/databases/$(database)/documents/api_keys/$(keyId)).data.companyId in request.auth.token.companyRoles
    && request.auth.token.companyRoles[get(/databases/$(database)/documents/api_keys/$(keyId)).data.companyId] == 'admin';

  allow create, update, delete: if request.auth != null
    && request.auth.token.role == 'admin';
}
```

> **Nota:** As API Routes acessam o Firestore via **Firebase Admin SDK** (server-side), então as Firestore Rules não se aplicam diretamente à leitura de dados da API — mas são essenciais para proteger a coleção `api_keys` de acessos pelo client-side.

---

## 8. Variáveis de Ambiente Necessárias

```env
# API Externa
API_HMAC_ENCRYPTION_KEY=        # Chave AES-256 para criptografar secretKey das API Keys
API_RATE_LIMIT_REDIS_URL=       # URL do Redis (Upstash) - Fase 2

# Existentes (já utilizados)
FIREBASE_SERVICE_ACCOUNT_KEY=   # Para Firebase Admin SDK server-side
```

---

## 9. Considerações de Performance

1. **Saldo (`company_stats`)** — Leitura de 1 documento. O(1). Extremamente rápido.
2. **Transações** — Paginação com cursor Firestore (`startAfter`). Índices compostos necessários.
3. **Orçamentos** — Combina `budgets` + `cost_center_usage`. Pode ser cacheado (dados mudam pouco).
4. **Financial Summary** — Pré-calculado por Cloud Function. Leitura direta.

### Índices Firestore Adicionais Necessários

```json
{
  "collectionGroup": "transactions",
  "fields": [
    { "fieldPath": "companyId", "order": "ASCENDING" },
    { "fieldPath": "type", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "dueDate", "order": "DESCENDING" }
  ]
}
```

### Cache Strategy

- `balance`: Cache 30s (TTL curto, dados em tempo real)
- `transactions`: Sem cache (dados dinâmicos, paginados)
- `budgets`: Cache 5min (dados mudam pouco)
- `cost-centers`: Cache 10min (dados estáticos)
- `financial-summary`: Cache 5min

---

## 10. Audit Log para API

Cada request à API gera um registro em `api_audit_logs`:

```typescript
interface ApiAuditLog {
  id: string;
  apiKeyId: string;
  apiKeyName: string;
  companyId: string;
  endpoint: string; // "/api/v1/transactions"
  method: string; // "GET"
  queryParams: Record<string, string>;
  statusCode: number;
  responseTimeMs: number;
  ipAddress: string;
  userAgent: string;
  requestId: string;
  createdAt: Date;
}
```

---

## 11. Testes

| Tipo       | Ferramenta      | Cobertura                                               |
| ---------- | --------------- | ------------------------------------------------------- |
| Unitário   | Vitest          | `apiAuth.ts`, `apiSanitizer.ts`, `apiValidation.ts`     |
| Integração | Vitest + MSW    | Endpoints com Firestore mockado                         |
| Segurança  | Scripts manuais | Replay attacks, keys expiradas, IP spoofing, rate limit |
| Load       | k6 ou Artillery | Comportamento sob carga                                 |

---

## Anexo A — Exemplo de Uso (para documentação externa)

### Gerando a Signature (HMAC-SHA256)

```javascript
const crypto = require("crypto");

const API_KEY = "gf_live_abcdef1234567890...";
const SECRET_KEY = "sk_xxxxxxxxxxxxxxxxxxxxxxxx";

const method = "GET";
const path = "/api/v1/transactions";
const timestamp = Math.floor(Date.now() / 1000).toString();
const body = ""; // GET requests have empty body

// Construir payload para assinatura
const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
const signaturePayload = `${method}\n${path}\n${timestamp}\n${bodyHash}`;

// Gerar HMAC
const signature = crypto
  .createHmac("sha256", SECRET_KEY)
  .update(signaturePayload)
  .digest("hex");

// Fazer request
const response = await fetch(
  "https://app.exemplo.com/api/v1/transactions?type=payable&limit=10",
  {
    headers: {
      "X-API-Key": API_KEY,
      "X-Timestamp": timestamp,
      "X-Signature": signature,
      "Content-Type": "application/json",
    },
  },
);
```

### Exemplo Python

```python
import hmac, hashlib, time, requests

API_KEY = "gf_live_abcdef1234567890..."
SECRET_KEY = "sk_xxxxxxxxxxxxxxxxxxxxxxxx"
BASE_URL = "https://app.exemplo.com"

method = "GET"
path = "/api/v1/balance"
timestamp = str(int(time.time()))
body = ""

body_hash = hashlib.sha256(body.encode()).hexdigest()
payload = f"{method}\n{path}\n{timestamp}\n{body_hash}"
signature = hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()

response = requests.get(
    f"{BASE_URL}{path}",
    headers={
        "X-API-Key": API_KEY,
        "X-Timestamp": timestamp,
        "X-Signature": signature,
    },
)

print(response.json())
```

### Exemplo cURL

```bash
# Variáveis
API_KEY="gf_live_abcdef1234567890..."
TIMESTAMP=$(date +%s)
BODY_HASH=$(echo -n "" | sha256sum | cut -d' ' -f1)
PAYLOAD="GET\n/api/v1/balance\n${TIMESTAMP}\n${BODY_HASH}"
SIGNATURE=$(echo -ne "$PAYLOAD" | openssl dgst -sha256 -hmac "sk_xxx" | cut -d' ' -f2)

curl -X GET "https://app.exemplo.com/api/v1/balance" \
  -H "X-API-Key: ${API_KEY}" \
  -H "X-Timestamp: ${TIMESTAMP}" \
  -H "X-Signature: ${SIGNATURE}"
```

---

## Anexo B — Decisões Técnicas

| Decisão                                                  | Justificativa                                                                                      |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **API Keys + HMAC** em vez de OAuth                      | Menor complexidade para integrações M2M (machine-to-machine). OAuth pode ser adicionado na Fase 3. |
| **Next.js API Routes** em vez de Firebase Functions HTTP | Reutiliza infraestrutura existente, deploy único, acesso ao ecossistema Next.js.                   |
| **Firestore Admin SDK** no server-side                   | Bypassa Firestore Rules (acesso direto), performance superior, sem limitações de client SDK.       |
| **Versionamento via URL** (`/api/v1/`)                   | Mais explícito que header-based, fácil de rotear e depreciar.                                      |
| **HMAC-SHA256** para signing                             | Padrão da indústria (AWS Signature v4, Stripe). Previne man-in-the-middle e replay attacks.        |
| **Hash da API Key** no Firestore                         | Nunca armazenar key em plaintext. Se o banco vazar, as keys são inúteis.                           |
| **Campo `prefix`** na API Key                            | Permite lookup eficiente sem expor a key completa (similar a Stripe `sk_live_...`).                |

---

## Anexo C — Checklist de Segurança

- [ ] API Keys hasheadas (SHA-256) no banco
- [ ] Secret Keys criptografadas (AES-256-GCM) no banco
- [ ] HMAC-SHA256 em toda requisição
- [ ] Timing-safe comparison para validação de signatures
- [ ] Validação de timestamp ±5min (anti-replay)
- [ ] Rate limiting por IP + por API Key
- [ ] IP whitelisting configurável por key
- [ ] Permissões granulares por endpoint
- [ ] Campos sensíveis removidos das respostas
- [ ] Audit log de todas as requisições
- [ ] HTTPS obrigatório
- [ ] CORS restritivo
- [ ] Expiração de keys configurável
- [ ] Rotação de keys (gerar nova sem downtime)
- [ ] Sem exposição de stack traces em produção
- [ ] Validação e sanitização de todos os inputs (zod)
- [ ] Paginação obrigatória (prevenção de data dump)
- [ ] Headers de segurança: `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`
