# Centros de custo — reorganização para o exercício 2027

> Levantamento feito em 23/10/2026 com dados de produção (empresa Hebron Aseec).
> Os valores de 2026 continuam mudando até o fechamento do exercício; confira de
> novo antes de executar.

## Por que não dá para simplesmente editar a árvore

A hierarquia (`parentId` em `cost_centers`) é **uma só para todos os exercícios**.
O razão (`cost_center_ledger`) é **por exercício** e grava valores agregados
calculados com a árvore que existia em cada lançamento:

- `allocatedToChildren` no pai;
- `subtreeSpent` em cada ancestral.

Por isso o sistema recusa:

| Operação                                                | Motivo da recusa                                                                                            |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Mudar o pai de um centro com histórico                  | Os valores de 2026 ficariam presos nos ancestrais antigos, e as próximas edições cairiam nos novos          |
| Dar filho a uma folha com despesas ou recorrências      | Despesa só existe em folha: as contas que já estão nela não poderiam mais ser aprovadas, pagas nem editadas |
| Excluir um centro com transações, razão ou recorrências | A conta ficaria órfã e travada, e o envelope ficaria preso no pai                                           |

**A estratégia é renomear** o que continua no mesmo lugar, **criar** o que muda de
lugar e **arquivar** o que sai. O arquivado some dos formulários de despesa nova,
mas as contas antigas continuam podendo ser aprovadas, pagas e editadas, e ele
ainda pode receber envelope.

Em 23/10/2026, **todos os 22 centros atuais tinham histórico**. Só os nós internos
(GLOBAL, ADMIN, FLATS, OFERTAS) aceitam filho novo.

---

## Estrutura atual (2026)

| Centro                                  | Tipo    | Envelope 2026 | Gasto 2026 | Recorrências ativas |
| --------------------------------------- | ------- | ------------: | ---------: | ------------------: |
| **CC-GLOBAL** · Global (raiz)           | interno |    18.839.569 |          — |                   — |
| ↳ **CC-ADMIN** · Administrativo         | interno |     2.100.000 |          — |                   — |
| ↳↳ **CC-FLATS** · Flats                 | interno |       300.000 |          — |                   — |
| ↳↳↳ CC-AJCUSTO · Ajuda de Custo         | folha   |        73.000 |     63.727 |                   0 |
| ↳↳↳ CC-FIMP · Impostos                  | folha   |         2.000 |      1.728 |                   0 |
| ↳↳↳ CC-FINVEST · Flats Investimentos    | folha   |        70.000 |     56.519 |                   0 |
| ↳↳↳ CC-MANUT · Manutenção               | folha   |        58.420 |     45.839 |                   3 |
| ↳↳↳ CC-PASS · Passagens Aéreas          | folha   |        50.000 |     26.787 |                   0 |
| ↳↳ CC-OPS · Operacional                 | folha   |       995.000 |    603.619 |                  18 |
| ↳↳ CC-PESSOAL · Pessoal                 | folha   |       600.000 |    491.690 |                  10 |
| ↳↳ CC-TRIBIMP · Tributos e Impostos     | folha   |       205.000 |    187.550 |                  25 |
| ↳ CC-INVEST · Investimentos             | folha   |     2.600.000 |  2.367.477 |                   0 |
| ↳ **CC-OFERTAS** · Ofertas              | interno |    14.055.300 |          — |                   — |
| ↳↳ CC-CAPELOWSKI · Capelowski           | folha   |       155.300 |    155.300 |                   0 |
| ↳↳ CC-CONST · Construção e Reforma      | folha   |     3.500.000 |  3.392.100 |                   0 |
| ↳↳ CC-CUIDADO · Cuidado de Missionários | folha   |       300.000 |    228.214 |                   0 |
| ↳↳ CC-EDUC · Educação                   | folha   |     1.100.000 |  1.099.507 |                   0 |
| ↳↳ CC-MISER · Misericórdia              | folha   |        50.000 |     24.900 |                   0 |
| ↳↳ CC-MISNAC · Missões Nacionais        | folha   |     2.500.000 |  2.185.341 |                   0 |
| ↳↳ CC-MISTRANS · Missões Transculturais | folha   |     4.100.000 |  4.041.442 |                   0 |
| ↳↳ CC-PROJSOC · Projetos Sociais        | folha   |     2.000.000 |  1.788.709 |                   0 |
| ↳↳ CC-SAUDE · Saúde                     | folha   |       350.000 |    270.451 |                   1 |

### O que já existe lançado em 2027

| Centro                  | Envelope 2027 | Gasto 2027 |
| ----------------------- | ------------: | ---------: |
| CC-ADMIN → CC-OPS       |         3.533 |      3.533 |
| CC-OFERTAS → CC-CUIDADO |        20.000 |     20.000 |
| CC-INVEST               |     1.000.000 |          0 |

---

## Estrutura planejada (2027) e a origem de cada centro

A raiz continua sendo o **CC-GLOBAL**; os grupos 1 a 5 ficam pendurados nela.

| Código  | Centro de custo                          | Tipo     | Origem               | Ação               |
| ------- | ---------------------------------------- | -------- | -------------------- | ------------------ |
| **1**   | **GESTÃO E SEDE**                        | Envelope | CC-ADMIN             | ✏️ Renomear        |
| 1.1     | Equipe                                   | Folha    | CC-PESSOAL           | ✏️ Renomear        |
| 1.2     | Sede Recife (salas 1501 a 1510)          | Folha    | —                    | ➕ Criar em 1      |
| 1.3     | Serviços profissionais e governança      | Folha    | —                    | ➕ Criar em 1      |
| 1.4     | Comunicação institucional                | Folha    | —                    | ➕ Criar em 1      |
| 1.5     | Despesas gerais                          | Folha    | CC-OPS               | ✏️ Renomear        |
| **2**   | **CUIDADO PASTORAL**                     | Envelope | —                    | ➕ Criar no GLOBAL |
| 2.1     | Capelania                                | Folha    | —                    | ➕ Criar em 2      |
| 2.2     | Saúde de obreiros                        | Folha    | —                    | ➕ Criar em 2      |
| **2.3** | **Projeto Refúgio – Muro Alto**          | Envelope | —                    | ➕ Criar em 2      |
| 2.3.1   | Flat 205F                                | Folha    | —                    | ➕ Criar em 2.3    |
| 2.3.2   | Flat 206F                                | Folha    | —                    | ➕ Criar em 2.3    |
| 2.3.3   | Ofertas a hóspedes                       | Folha    | —                    | ➕ Criar em 2.3    |
| 2.4     | Encontros e reuniões                     | Folha    | —                    | ➕ Criar em 2      |
| **3**   | **MISSÕES E PROJETOS (OFERTAS)**         | Envelope | CC-OFERTAS           | ✏️ Renomear        |
| 3.1     | Missões transculturais                   | Eixo     | CC-MISTRANS          | ✏️ Renomear ⚠️     |
| 3.2     | Missões nacionais e urbanas              | Eixo     | CC-MISNAC            | ✏️ Renomear ⚠️     |
| 3.3     | Sustento de obreiros                     | Eixo     | — (ou CC-CAPELOWSKI) | ➕ Criar em 3 ⚠️   |
| 3.4     | Construção, reforma e aquisição          | Eixo     | CC-CONST             | ✏️ Renomear ⚠️     |
| 3.5     | Educação e formação                      | Eixo     | CC-EDUC              | ✏️ Renomear ⚠️     |
| 3.6     | Saúde                                    | Eixo     | CC-SAUDE             | ✏️ Renomear ⚠️     |
| 3.7     | Projetos sociais                         | Eixo     | CC-PROJSOC           | ✏️ Renomear ⚠️     |
| 3.8     | Ofertas de misericórdia                  | Eixo     | CC-MISER             | ✏️ Renomear ⚠️     |
| **4**   | **PROGRAMAS PRÓPRIOS**                   | Envelope | —                    | ➕ Criar no GLOBAL |
| 4.1     | Viagens missionárias e de acompanhamento | Folha    | —                    | ➕ Criar em 4      |
| 4.2     | Materiais de evangelismo                 | Folha    | —                    | ➕ Criar em 4      |
| **5**   | **INVESTIMENTOS**                        | Envelope | —                    | ➕ Criar no GLOBAL |
| 5.1     | Imóveis e reformas                       | Folha    | —                    | ➕ Criar em 5      |
| 5.2     | Móveis e equipamentos                    | Folha    | —                    | ➕ Criar em 5      |
| 5.3     | Tecnologia                               | Folha    | —                    | ➕ Criar em 5      |

**Total:** 11 renomeações, 19 criações e 10 arquivamentos. Os 22 atuais fecham
assim: o CC-GLOBAL fica como está, 11 são renomeados e 10 são arquivados.

Três destes não podem aproveitar o centro atual, apesar de o nome sugerir:

- **5 Investimentos:** o CC-INVEST é folha com despesas e não pode ganhar filhos.
- **2.3 Projeto Refúgio:** o CC-FLATS tem histórico e não pode sair de baixo do
  Administrativo.
- **2 Cuidado Pastoral:** o CC-CUIDADO é folha com despesas e está dentro de Ofertas.

> ⚠️ **Decisão pendente sobre "Eixo".** Renomear só funciona se os eixos
> continuarem sendo **folhas** em 2027. Se algum eixo vai ganhar subprojetos ao
> longo do ano, ele **precisa nascer como centro novo**, porque os atuais já têm
> despesas e não podem virar pais. Nesse caso, o eixo também nunca pode receber
> despesa direta; use um filho "Geral" para isso. O centro antigo correspondente
> é arquivado.

> ✏️ **Renomear também muda o nome nos relatórios de 2026.** Se isso incomodar em
> algum caso (por exemplo, "Operacional" virando "Despesas gerais"), crie um
> centro novo em vez de renomear.

### Arquivar (10)

| Centro                                   | Pendências antes de arquivar                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| CC-AJCUSTO, CC-FIMP, CC-FINVEST, CC-PASS | nenhuma                                                                                        |
| CC-MANUT                                 | 3 recorrências                                                                                 |
| CC-FLATS                                 | arquivar depois dos 5 filhos; fica visível abaixo de "1 Gestão e Sede", marcado como arquivado |
| CC-TRIBIMP                               | 25 recorrências                                                                                |
| CC-INVEST                                | zerar ou reduzir o envelope de 2027 (R$ 1.000.000)                                             |
| CC-CUIDADO                               | mover a despesa de 2027 (R$ 20.000) e zerar o envelope de 2027                                 |
| CC-CAPELOWSKI                            | nenhuma, se não for aproveitado como 3.3                                                       |

O sistema só aceita arquivar quando todos os filhos já estão arquivados e não há
recorrência ativa apontando para o centro.

---

## Recorrências: de-para sugerido (57 ativas)

### Obrigatórias (o centro de origem será arquivado)

| Origem     | Recorrência                                       | Destino                    |
| ---------- | ------------------------------------------------- | -------------------------- |
| CC-TRIBIMP | IPTU salas 1501 a 1510 (10)                       | 1.2 Sede Recife            |
| CC-TRIBIMP | Taxa de bombeiros salas 1501 a 1510 (10)          | 1.2 Sede Recife            |
| CC-TRIBIMP | DARF Unificado (GPS, IR e PIS), FGTS              | 1.1 Equipe                 |
| CC-TRIBIMP | Simples Nacional DBM; Simples Nacional MEI Lutero | 1.3 Serviços profissionais |
| CC-TRIBIMP | Cartão de Inscrição Municipal                     | 1.5 Despesas gerais        |
| CC-MANUT   | Condomínio Flat 205F                              | 2.3.1 Flat 205F            |
| CC-MANUT   | Condomínio Flat 206F; Energia Flat 206F           | 2.3.2 Flat 206F            |

### Opcionais (o centro de origem continua, mas o assunto muda de lugar)

| Origem             | Recorrência                                          | Destino                                       |
| ------------------ | ---------------------------------------------------- | --------------------------------------------- |
| CC-OPS (→ 1.5)     | Condomínios salas 1501 a 1510 (10)                   | 1.2 Sede Recife                               |
| CC-OPS (→ 1.5)     | Energia salas 1504 e 1505                            | 1.2 Sede Recife                               |
| CC-OPS (→ 1.5)     | Honorários Contábeis; SLU DBM; MEI Pr. Lutero        | 1.3 Serviços profissionais                    |
| CC-OPS (→ 1.5)     | Energia Flat 205F                                    | 2.3.1 Flat 205F                               |
| CC-OPS (→ 1.5)     | Oferta Pastor Capelowski                             | 2.1 Capelania **ou** 3.3 Sustento de obreiros |
| CC-OPS (→ 1.5)     | Tarifas bancárias                                    | fica (1.5)                                    |
| CC-PESSOAL (→ 1.1) | Consultorias (Marcos Robson, Lutero, Dr. David)      | 1.3 Serviços profissionais                    |
| CC-PESSOAL (→ 1.1) | Captação e edição de vídeo                           | 1.4 Comunicação institucional                 |
| CC-PESSOAL (→ 1.1) | Salários (3), planos de saúde e odontológico, ticket | fica (1.1)                                    |
| CC-SAUDE (→ 3.6)   | Acompanhamento Nutricional                           | fica (3.6) **ou** 2.2 Saúde de obreiros       |

A troca é feita em **Financeiro → Recorrências → Editar → Centro de Custo**.
Salvar também regrava a alocação com o valor atual do modelo.

---

## Roteiro de execução (no início de 2027)

### Antes da virada

- [ ] Implantar **functions** e depois o **front** com as mudanças pendentes:
  - guardas e arquivamento;
  - código do centro com 1 caractere;
  - seletor de centro na recorrência;
  - `scaleAllocation` no gerador.
- [ ] Decidir as pendências da seção "Decisões em aberto".
- [ ] De preferência, pagar até 31/12 as contas de 2026 dos centros que serão
      arquivados (veja "Atenção" abaixo).

### Primeiros dias de janeiro

1. [ ] **Criar os 19 centros**, sempre o pai antes dos filhos (2 antes de 2.1;
       2.3 antes de 2.3.1). Preencha **Usuários Permitidos** em cada um; sem isso,
       quem tem o papel `user` não enxerga o centro.
2. [ ] **Renomear os 11** (nome e código).
3. [ ] **Distribuição 2027** (`/centros-custo/distribuicao`, exercício 2027):
   - zerar o CC-INVEST, ou deixar o valor das contas de 2026 ainda abertas;
   - distribuir para a estrutura nova.
4. [ ] **Reapontar as recorrências**, conforme o de-para acima.
5. [ ] **Corrigir as contas de janeiro já geradas.** O job gera cada conta 7 dias
       antes do vencimento, com o centro que o modelo tinha naquele dia. As contas
       com vencimento em janeiro geradas a partir de 25/12 vão estar nos centros
       antigos, com a marca "sem saldo" e notificação aos gestores. Troque o centro
       delas em Contas a pagar.
6. [ ] **Mover as despesas de 2027 já lançadas:**
   - CC-CUIDADO, R$ 20.000 → 2.x ou 3.3;
   - CC-OPS, R$ 3.533 → 1.3, se for honorário.
     Depois zere o envelope de 2027 do CC-CUIDADO.

### Depois de fechar 2026 (meados de janeiro)

7. [ ] **Arquivar os 10.** Antes disso, uma nota de dezembro lançada em janeiro
       ainda precisa do centro antigo.
8. [ ] Rodar `npm run verify:ledger` e confirmar que todas as invariantes passam.

### Atenção: contas de 2026 pagas em 2027

A baixa entra no exercício da **data de pagamento**. Uma conta de dezembro paga em
janeiro consome o envelope de **2027** do centro dela. Saldo em aberto em
23/10/2026 nos centros que serão arquivados:

| Centro     | Em aberto |
| ---------- | --------: |
| CC-INVEST  |   258.617 |
| CC-CUIDADO |    38.000 |
| CC-AJCUSTO |     2.000 |
| CC-FINVEST |     1.303 |

Sem envelope de 2027 nesses centros, a baixa acontece, mas fica marcada como
"sem saldo".

---

## Decisões em aberto

1. **"Eixo":** os eixos 3.1 a 3.8 vão ter subprojetos em 2027? Se sim, não dá
   para renomear; são 8 centros novos, e os 7 atuais são arquivados.
2. **CC-CAPELOWSKI:** arquivar, ou aproveitar renomeado como 3.3 Sustento de
   obreiros?
3. **Despesa de R$ 20.000 do CC-CUIDADO em 2027:** vai para 2.1, 2.2 ou 3.3?
4. **Oferta Pastor Capelowski** (recorrência): 2.1 Capelania ou 3.3 Sustento de
   obreiros?
5. **Acompanhamento Nutricional:** fica em 3.6 Saúde ou vai para 2.2 Saúde de
   obreiros?

## Pendência técnica relacionada

Até a implantação do `scaleAllocation`, 17 das 57 recorrências geravam contas com
a alocação por centro diferente do valor real (exemplo: energia da sala 1504
consumia R$ 771,74 com valor de R$ 135,06). As contas **já geradas** com essa
divergência não foram corrigidas. O levantamento e a correção ficam para um
script próprio (dry-run e `--apply`), a fazer antes de distribuir os envelopes de 2027.
