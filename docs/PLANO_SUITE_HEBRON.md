# Suíte Hebron ASEEC — plano de migração e app Tarefas

> 11/11/2026. Base: leitura de `filhon/hebron-aseec@fix/P-2.20-projetos-anexos-obrigatorios` (commit 0b99d21) e do FinControl (`main`, e2beeeb).
> Objetivo: backends separados por app no Firebase, comunicação por API e webhooks, visual do FinControl como referência, um app por vez já em produção. Primeiro app novo: **Tarefas**.

---

## 1. O que existe hoje

### hebron-aseec (Supabase)

- 9 apps Next.js 15, cerca de 142 mil linhas TS, 92 migrations, 102 tabelas, 314 policies RLS, um único Supabase com 10 schemas. Nenhum app em produção.
- **Acoplamento pelo banco.** Apps se falam por FK entre schemas e por `packages/integrations`, que grava direto na tabela do outro app usando o handle superuser. Exemplo: `createAutoTask` (`packages/integrations/src/tarefas.ts`) faz `insert` em `tarefas.tasks` com `db` superuser e "ator sistema". Flats, Intranet e Projetos chamam isso. É exatamente o acoplamento que a separação elimina.
- **A auditoria interna** (`AUDIT/05-RESUMO-EXECUTIVO.md`) deu NO-GO: 1 P0 (pedido de exclusão LGPD sem caminho de execução) e 15 P1. Os achados que importam para o novo desenho:
  - middleware de sessão em 1 de 9 apps;
  - mensagens de erro substituídas por "Something went wrong";
  - nenhum header de segurança (sem `frame-ancestors`);
  - nenhuma observabilidade;
  - integração crítica em "fogo e esquece";
  - `ON DELETE CASCADE` de `auth.users` apagando 17 tabelas;
  - impersonação que não impersona;
  - signed URL gerada sem checar sessão.
- **Lição central da auditoria:** regra imposta pelo banco não derivou, regra só no código derivou. No Firebase o equivalente é: rules + transação no servidor + teste no emulador. As três juntas, nunca uma só.

**O que aproveitar:**

- `BRAIN.md` §6 (regras de negócio) e os Q&As de `.docs/Respostas*.md`.
- Os testes de `apps/tarefas/src/__tests__` como **critérios de aceite**: recorrência 31/01 → 28 ou 29/02, anual no mês da regra, um único pedido de aprovação pendente por tarefa, tarefa automática nasce sem responsável, soft delete.
- `computeNextRun` (já corrigido) e os schemas Zod de `packages/validators/src/tarefas`.
- Os templates de e-mail `task-assigned` e `approval-request`.

**O que não levar:** Drizzle, RLS, migrations, Inngest, Upstash, os stubs de `packages/integrations` e `packages/jobs` (catálogo de jobs "planejados") e o formato de `PROMPTS.md`, com 900 KB e "arquivos permitidos". Foi esse formato que gerou o padrão "primitiva entregue sem chamador".

### FinControl (referência de segurança)

Já funciona e deve ser mantido:

- Firebase Auth + Firestore (SDK do cliente) + `firestore.rules` com 749 linhas, papéis por custom claims e fallback no banco;
- rotas de servidor com `verifyIdToken`;
- API v1 com HMAC-SHA256 (método, path, timestamp e hash do corpo, janela de ±5 min, `timingSafeEqual`), `apiRateLimit`, `limitAi` e `apiAudit`;
- webhook do Resend assinado;
- headers no `next.config.ts`;
- Cloud Functions com agendamento às 02:00 BRT.

Não copiar estes pontos:

- `auth_token` é o ID token num cookie legível por JS, e o `src/proxy.ts` só checa se o cookie existe. A verificação real fica nas rotas.
- O preview da Vercel usa o banco de produção.
- Nenhum teste de rules, e o CI só roda lint e build.

---

## 2. Arquitetura alvo

```
                    ┌──────────────────────────────┐
  navegador ───────►│ contas.fincontrol.ia.br      │  Firebase "hebron-contas"
   (login 1x)       │ login · MFA · usuários/papéis│  Auth + users + audit
                    └──────────┬───────────────────┘
          cookie de sessão     │ webhooks assinados (user.updated / user.disabled)
          Domain=.fincontrol…  ▼
  ┌──────────────────────────────┐        ┌──────────────────────────────┐
  │ tarefas.fincontrol.ia.br     │  API   │ financeiro.fincontrol.ia.br  │
  │ Firebase "hebron-tarefas"    │◄──────►│ Firebase atual (FinControl)  │
  │ Auth própria (custom token)  │ HMAC + │                              │
  │ Firestore/Storage/Functions  │webhook │                              │
  └──────────────────────────────┘        └──────────────────────────────┘
```

### 2.1 Um projeto Firebase por app, mais dev e prod

- Projetos `hebron-contas` e `hebron-tarefas` (mais `-dev` de cada). O FinControl continua no projeto atual.
- Isolamento real: a service account de um app não lê o banco de outro, cada app tem rules próprias e o custo de cada um aparece separado.
- A alternativa mais barata (um projeto com _named databases_) compartilha IAM e service accounts. Vazou uma chave, vazou tudo. Por isso não é a recomendada.

### 2.2 Contas: identidade mínima e nova

Contas é o pedaço do antigo Admin que a identidade exige, e nada além disso:

- Firebase Auth com e-mail+senha e link mágico. TOTP obrigatório para `super_admin` e `diretor` (exige ativar o Identity Platform; até 50 mil MAU é gratuito).
- `users/{uid}`: nome, e-mail, `roles[]` (os 8 papéis do BRAIN §3), designações (Gestor, Autorizador, Avaliador) e `status`.
- Os papéis vão para os custom claims (`setCustomUserClaims`), escritos só pelo servidor.
- Telas: login, primeiro acesso e MFA, usuários e papéis, convite.
- `audit_logs` gravado no servidor.

### 2.3 SSO por troca de token

1. O Contas cria um cookie de sessão Firebase (`createSessionCookie`) com as seguintes propriedades:
   - httpOnly, Secure, SameSite=Lax;
   - `Domain=.fincontrol.ia.br`;
   - duração de 5 dias;
   - nome `__hb` em prod e `__hb_dev` em dev.
2. Rota `/api/auth/session` do app:
   1. verifica o cookie localmente com o `projectId` do Contas (`verifySessionCookie`). Não precisa de credencial do Contas, só das chaves públicas do Google.
   2. lê `uid` e `roles` do cookie e rejeita se `auth_time` for anterior a `revocations/{uid}.revokedAt`.
   3. cria um custom token **no projeto do app** com `{ roles }` (`createCustomToken`).
3. O cliente faz `signInWithCustomToken` no Firebase do app. As rules do app leem `request.auth.token.roles`.
4. Mudou papel ou desativou usuário no Contas:
   - o Contas manda o webhook `user.updated` ou `user.disabled`;
   - o app grava `revocations/{uid}` e chama `revokeRefreshTokens(uid)`.

   A escrita fica bloqueada na hora, porque o servidor usa `verifyIdToken(..., true)`. A leitura cai em até 1 h, quando o ID token expira. O FinControl tem o mesmo limite hoje.

5. **Spike obrigatório no início da F2:** confirmar `verifySessionCookie` sem credencial e a persistência dos claims do custom token no refresh, antes de construir em cima.

### 2.4 Comunicação entre apps

- **Comando síncrono:** `POST https://<app>/api/v1/...` com o mesmo HMAC do FinControl (`src/lib/api/apiAuth.ts`) mais um header `Idempotency-Key`. Cada par origem→destino tem sua própria chave, guardada em env.
- **Evento assíncrono (webhook):**
  1. A mutação grava `outbox/{eventId}` no **mesmo batch** da escrita de negócio.
  2. Uma Cloud Function `onDocumentCreated` com `retry: true` entrega o evento assinado.
  3. O receptor grava `inbox/{eventId}` antes de agir. Com isso, entrega repetida não gera efeito em dobro (regra de CLAUDE.md: "worker tolera nova tentativa").
- Nenhum app lê ou escreve no banco de outro. O equivalente de `createAutoTask` vira `POST tarefas/api/v1/tasks` com ID determinístico (`auto_<origem>_<id>`): repetir a chamada devolve a mesma tarefa.

### 2.5 Hospedagem e ambientes

- Vercel, um projeto por app, como o FinControl. Firebase só para backend.
- Prod: `<app>.fincontrol.ia.br`, apontando para os projetos Firebase de prod.
- Dev/preview: domínio fixo `<app>-dev.fincontrol.ia.br`, apontando para os projetos `-dev`.
- URLs de PR (`*.vercel.app`) não fazem SSO. Só servem para revisão visual.
- **Ressalva:** enquanto prod e dev dividirem `fincontrol.ia.br`, o cookie de prod chega ao host de dev. Ele não é aceito lá (o `projectId` é outro), mas código de branch poderia lê-lo. Na migração para `hebronaseec.com.br`, prod sai do domínio e a ressalva acaba.

---

## 3. Visual: FinControl como referência

Pacote `@hebron/ui` no novo repo, **extraído do FinControl**:

- `src/app/globals.css`: tokens do rebrand de 08/11 (azul #202C85, laranja #EA5A06; verde e azul claro só como destaque), Parkinsans nos títulos, Titillium no corpo e IBM Plex em `.font-financial`.
- Os 40 componentes de `src/components/ui`.
- `src/components/layout`: `DashboardShell`, `Sidebar` + `navItems`, `Header`, `Breadcrumbs`, `MobileNav`, `NotificationBell`, `GlobalSearch` (Cmd+K), `QueryActivityBar`, `BatchRunTray`.
- Padrões de tela já decididos no FinControl:
  - formulário em painel lateral;
  - abas por situação;
  - largura total em telas densas;
  - progresso real (N de M, sem invenção);
  - `sonner` para avisos;
  - `date-fns` com `ptBR`;
  - atalhos `g`+tecla.

**Pré-requisito:** fechar o débito do rebrand no FinControl antes de extrair. São 17 arquivos com cores fixas `blue/indigo/violet/sky`. Extrair antes disso replica o débito em todos os apps.

**Componente novo:** o seletor de apps da suíte no `Header`. A lista vem do Contas, filtrada pelos papéis do usuário. O FinControl recebe o mesmo seletor.

O FinControl **não** importa `@hebron/ui` por enquanto: é outro repo, usa npm e está em produção. Regra até a eventual entrada dele no monorepo: toda mudança visual nasce num dos dois lados e é portada no mesmo dia.

O `packages/ui` antigo (`--hb-*`) e `design-refs/` ficam só como referência de marca.

---

## 4. Repositório

**Recomendação:** repo novo `hebron-suite`.

- pnpm + Turborepo, com as mesmas versões do FinControl: Next 16, React 19, Tailwind 4, firebase 12, firebase-admin 13, React Query 5, Zustand 5.
- Estrutura:

```
apps/contas/      apps/tarefas/        ← cada um com firebase/ próprio (firebase.json, rules, indexes, functions)
packages/ui/      ← extraído do FinControl
packages/suite/   ← contratos: Zod dos payloads de API/webhook, assinar/verificar HMAC, troca de sessão, entrega de outbox
```

- Pacote novo só quando houver o 2º consumidor. Copiar o `check:cross-app-imports` do repo antigo para o CI.
- O `hebron-aseec` vira arquivo somente leitura de especificação.

---

## 5. Tarefas no Firebase

### Regras de negócio (BRAIN §6.9)

- 6 workspaces fixos. Ficam no código, sem coleção.
- Colaborador cria e edita.
- Tarefa automática nasce sem responsável e o `super_admin` atribui.
- Diretor nunca recebe tarefa operacional (o servidor recusa). Ele recebe **pedidos de aprovação** para avançar o status.
- Recorrências: contas de consumo (mensal), IPTU (anual), limpeza do flat (semanal) e convite Capelowski (mensal).

### Modelo de acesso: leitura no cliente, escrita no servidor

- **Leitura** pelo SDK do cliente, em tempo real (`onSnapshot` no quadro), liberada pelas rules por papel.
- **Toda escrita** em Server Action ou Route Handler com Admin SDK, seguindo sempre a mesma sequência:
  1. `verifyIdToken(token, true)`;
  2. Zod;
  3. checagem de papel;
  4. transação ou batch;
  5. evento no histórico e `audit_logs` no mesmo batch.
- As rules ficam `allow write: if false` em tudo, menos o upload no Storage. Fica simples de testar.
- O ganho de segurança sobre o modelo misto do FinControl compensa a ida ao servidor. A interface responde na hora com atualização otimista no React Query.

### Coleções

| Coleção                                                                                          | Conteúdo                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasks/{id}`                                                                                     | título, descrição, `workspace`, `status` (a_fazer/em_progresso/em_revisao/concluido), `priority`, `dueDate`, `assigneeIds[]`, `assignees[{uid,name}]`, `tagIds[]`, `subtasks[{id,title,done,assigneeId}]` (array no próprio doc: atômico, progresso calculado), `source{module,id}`, `needsManualAssignment`, `createdBy`, `createdAt/updatedAt/completedAt/deletedAt` |
| `tasks/{id}/comments`                                                                            | texto, `mentions[]`, autor                                                                                                                                                                                                                                                                                                                                             |
| `tasks/{id}/events`                                                                              | histórico (só servidor)                                                                                                                                                                                                                                                                                                                                                |
| `tasks/{id}/timeEntries`                                                                         | T3                                                                                                                                                                                                                                                                                                                                                                     |
| `approvalRequests/{id}`                                                                          | um pendente por tarefa, garantido por transação; fila do diretor por `approverId` + `status`                                                                                                                                                                                                                                                                           |
| `templates/{id}`                                                                                 | itens em array; recorrência embutida (`rule`, `nextRunAt`)                                                                                                                                                                                                                                                                                                             |
| `tags`, `notifications/{id}` (por usuário), `audit_logs`, `revocations/{uid}`, `outbox`, `inbox` |                                                                                                                                                                                                                                                                                                                                                                        |

- **Storage:** `tasks/{taskId}/{fileId}`, com tamanho e MIME limitados nas `storage.rules` e upload só por staff.
- **Functions:**
  - recorrência diária às 02:00 BRT com ID determinístico `<templateId>_<aaaammdd>`, para que rodar de novo não duplique;
  - entrega do outbox;
  - e-mail via Resend (atribuição, @menção, pedido de aprovação).

### Entregas (cada uma vai para produção)

|        | Escopo                                                                                                                                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1** | CRUD, workspaces, lista e kanban (com teclado), subtarefas, responsáveis, etiquetas, prioridade, prazo, comentários com @menção, histórico, notificações (in-app + e-mail), pedido de aprovação ao diretor            |
| **T2** | anexos, templates, recorrência                                                                                                                                                                                        |
| **T3** | modo foco + pomodoro, time tracking, visão em árvore, Cmd+K                                                                                                                                                           |
| **T4** | `POST /api/v1/tasks` (tarefas automáticas) e webhook `task.completed`, construídos **quando existir o primeiro app produtor** (Flats, Projetos ou Intranet). O contrato fica definido em `packages/suite` desde a T1. |

---

## 6. Linha de base de segurança (vale para todo app; o CI barra se faltar)

1. Projetos Firebase dev e prod separados. Preview nunca toca o banco de prod.
2. Rules com _deny by default_ e **testadas no emulador** (`@firebase/rules-unit-testing`) no CI, com um teste por papel × operação.
3. Toda escrita no servidor segue a sequência verificar token → Zod → papel → transação → auditoria.
4. Sessão em cookie httpOnly. O proxy **verifica** o token, não só a presença do cookie.
5. Headers: CSP com `frame-ancestors 'none'`, HSTS, `X-Content-Type-Options`, `Referrer-Policy`.
6. HMAC + idempotência + rate limit em toda API entre apps. `limitAi` em toda rota de IA.
7. Erros em pt-BR que chegam ao usuário e a um log estruturado. Sentry desde o primeiro deploy.
8. Nada de hard delete de usuário: o Contas desativa e anonimiza, e os apps recebem o webhook `user.disabled`. O pedido de exclusão LGPD tem tela e dono desde a F2, o que fecha o P0 da auditoria antiga.
9. Credenciais só em env da Vercel e Secret Manager. Nada de `serviceAccountKey.json` em disco.
10. Backup: PITR do Firestore ligado em prod e alerta de orçamento por projeto.

---

## 7. FinControl → financeiro.fincontrol.ia.br

1. Na Vercel: adicionar `financeiro.fincontrol.ia.br` e criar um redirect 308 de `www.fincontrol.ia.br/*`. O 308 preserva o método, então os clientes da API v1 continuam funcionando, e o HMAC assina só o path.
2. Atualizar:
   - `NEXT_PUBLIC_APP_URL`;
   - os domínios autorizados no Firebase Auth;
   - a URL do webhook no Resend;
   - os links da documentação da API.
3. O cookie `auth_token` está preso ao host, então cada usuário entra uma vez de novo. Avisar antes.
4. Links já enviados por e-mail continuam valendo pelo redirect.
5. **Depois do Tarefas**, em fase própria: o FinControl passa a aceitar o login do Contas pela mesma troca de token da §2.3. Os usuários migram com `firebase auth:export/import` (preservando o hash da senha), e os `companyRoles` são mapeados para os papéis da suíte.

---

## 8. Ordem de execução

| Fase                     | Entrega                                                                                                                                   | Pronto quando                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **F0** FinControl        | domínio novo (§7), cores fixas tokenizadas, preview apontando para projeto Firebase de dev                                                | o usuário acessa por `financeiro.`, o preview não altera dado real                           |
| **F1** Fundação          | repo `hebron-suite`, `@hebron/ui` extraído, projetos Firebase dev/prod, CI (lint, typecheck, build, testes de rules), Vercel com domínios | uma página "olá" com o visual do FinControl em `tarefas-dev.`                                |
| **F2** Contas            | login, MFA, usuários e papéis, convite, sessão SSO, webhook `user.*`, pedido LGPD                                                         | um diretor entra uma vez e é obrigado a cadastrar o TOTP                                     |
| **F3** Tarefas T1        | §5 T1                                                                                                                                     | colaborador cria e move tarefas, diretor aprova pelo e-mail ou pela fila, tudo em `tarefas.` |
| **F4** Tarefas T2/T3     | §5                                                                                                                                        | a recorrência do IPTU cai no mês certo, e rodar a function duas vezes não duplica            |
| **F5** FinControl no SSO | §7.5                                                                                                                                      | o mesmo login abre Financeiro e Tarefas, e desativar no Contas derruba os dois               |

---

## 9. Como usar o ponytail aqui

- Uma sessão por passo pequeno, com `/ponytail:ponytail`. Cada sessão entrega **código + teste + quem chama**. Primitiva sem chamador não conta como feito (padrão A da auditoria).
- O critério de aceite é escrito do ponto de vista de quem usa ("o diretor consegue aprovar"), nunca do artefato ("o teste passa").
- **Onde o ponytail não corta:** rules, verificação de token e HMAC, transações de invariantes, testes de rules, auditoria. "Menos código" nunca remove uma das três camadas.
- Atalho deliberado leva um comentário `ponytail:`. Ao fim de cada fase, rodar `/ponytail:ponytail-debt` e transformar o que sobrar em item de fase, com dono.
- Nada de stubs, catálogo de "planejados" ou pacote com um único consumidor.

---

## 10. Decisões para confirmar

1. Um projeto Firebase por app, com o Contas como identidade e troca de token (§2.1–2.3).
2. Tarefas com leitura no cliente e escrita só no servidor (§5).
3. Repo novo `hebron-suite`, com `hebron-aseec` só como especificação (§4).
4. Tarefas single-tenant: só a Hebron, sem `companyId`.
5. Hospedagem na Vercel; o Firebase fica só como backend.
6. Domínios de dev `<app>-dev.fincontrol.ia.br`.
