import type { UserRole } from "@/lib/types";
import { normalizeText } from "@/lib/utils";

/**
 * Manual de operação ("as regras do jogo"), lido pela página /manual.
 *
 * Escrito para quem nunca trabalhou com financeiro. Cada regra aqui descreve o
 * que o sistema faz hoje; quando o sistema ainda não impõe algo que um
 * controle profissional exige, a regra manual está em "Limites conhecidos" e o
 * ajuste técnico em docs/PLAYBOOK_CONFORMIDADE.md. Mudou o comportamento?
 * Atualize os dois.
 *
 * Texto aceita **negrito**, [[tecla]], `código` e [rótulo](/rota ou #âncora).
 * Sem travessão: use dois-pontos, vírgula ou ponto.
 */

/** Item de lista sem ordem; `roles` esconde o item de quem não o executa. */
export type PlaybookItem =
  | string
  | {
      text: string;
      roles?: UserRole[];
      /** Mostra a contagem que a barra lateral já calcula. */
      badge?: "queue" | "overdue" | "comprovantes";
    };

export interface PlaybookTopic {
  id: string;
  title: string;
  intro?: string;
  rules?: string[];
  /** Rótulo da caixa de regras; padrão "Regras". */
  rulesLabel?: string;
  /** "warning": regra que o sistema não impõe; caixa âmbar, sem ✓. */
  tone?: "warning";
  /** Sequência com ordem. */
  steps?: string[];
  /** Lista sem ordem (rotina, atalhos, operadores de busca). */
  items?: PlaybookItem[];
  faq?: { q: string; a: string }[];
  links?: { label: string; href: string }[];
  /** Papéis que executam isto; vazio = todos. */
  roles?: UserRole[];
}

export const itemOf = (it: PlaybookItem) =>
  typeof it === "string" ? { text: it } : it;

/** Âncora estável de uma pergunta do FAQ: /manual#faq-nao-consigo-... */
export const faqId = (q: string) =>
  "faq-" +
  normalizeText(q)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

export interface PlaybookChapter {
  id: string;
  title: string;
  summary: string;
  topics: PlaybookTopic[];
}

export const GOLDEN_RULES = [
  "**Todo dinheiro passa pelo sistema.** Se saiu ou entrou no banco, tem um lançamento. Se não tem lançamento, não deveria ter saído.",
  "**Quem pede não aprova, quem aprova não paga.** Três pessoas diferentes sempre que a equipe permitir.",
  "**Sem documento, sem pagamento.** Nota, boleto, recibo ou contrato anexado antes de aprovar; comprovante anexado depois de pagar.",
  "**Data de pagamento é a data do banco.** Nunca a data em que você lembrou de dar baixa, nunca uma data futura.",
  "**Errou? Corrija pelo caminho oficial.** Desfazer baixa, rejeitar com motivo, devolver o lote. Não exclua o que já foi pago.",
  "**O mês só termina quando o extrato bate.** Conciliação fechada com diferença zero em todas as contas.",
];

export const GLOSSARY: { term: string; meaning: string }[] = [
  {
    term: "Lançamento (ou título)",
    meaning:
      "Um registro de dinheiro a pagar ou a receber: quem, quanto, quando e por quê.",
  },
  {
    term: "Conta a pagar (despesa)",
    meaning:
      "Dinheiro que vai sair: fornecedor, conta de luz, imposto, salário.",
  },
  {
    term: "Conta a receber (receita)",
    meaning: "Dinheiro que vai entrar: doação, mensalidade, venda, rendimento.",
  },
  {
    term: "Vencimento",
    meaning:
      "Último dia para pagar sem multa. Define em que aba a conta aparece.",
  },
  {
    term: "Baixa",
    meaning:
      "Registrar que a conta foi paga (ou recebida), com a data e o valor que o banco mostra.",
  },
  {
    term: "Competência",
    meaning:
      "O mês a que a despesa ou receita pertence, mesmo que paga em outro. A conta de luz de setembro paga em outubro tem competência setembro.",
  },
  {
    term: "Regime de caixa × competência",
    meaning:
      "Caixa olha a data em que o dinheiro mexeu; competência olha o mês a que pertence. O fluxo de caixa é caixa; a DRE pode ser vista dos dois jeitos.",
  },
  {
    term: "Centro de custo",
    meaning:
      'A "gaveta" de quem gasta: departamento, projeto, ministério. Responde "quem gastou?".',
  },
  {
    term: "Envelope",
    meaning:
      "O valor que um centro de custo recebeu para gastar no ano. Gastou o envelope, acabou, até alguém redistribuir.",
  },
  {
    term: "Plano de contas",
    meaning:
      'A lista de naturezas de gasto e receita (água, salários, doações…). Responde "gastou com o quê?". Alimenta a DRE.',
  },
  {
    term: "DRE",
    meaning:
      "Demonstração do Resultado: receitas menos despesas do período, agrupadas pelo plano de contas. Mostra se houve superávit ou déficit.",
  },
  {
    term: "Fluxo de caixa",
    meaning:
      "Entradas e saídas dia a dia, realizadas e previstas, com o saldo resultante.",
  },
  {
    term: "Lote de pagamento",
    meaning:
      "Um pacote de contas a pagar que é aprovado e pago de uma vez, com aprovador e autorizador designados.",
  },
  {
    term: "Conciliação bancária",
    meaning:
      "Conferir, linha a linha, o extrato do banco contra os lançamentos do sistema até não sobrar diferença.",
  },
  {
    term: "Extrato OFX",
    meaning:
      "Arquivo de extrato que todo banco exporta (internet banking → extrato → exportar → OFX/Money). É o que a conciliação lê.",
  },
  {
    term: "Comprovante",
    meaning:
      "O recibo do banco de que o pagamento saiu (Pix, TED, boleto pago). Diferente da nota fiscal, que é o documento da compra.",
  },
  {
    term: "RD (Relatório de Despesas)",
    meaning:
      "Documento que agrupa os reembolsos de uma pessoa num período, para aprovação e pagamento.",
  },
  {
    term: "Recorrência",
    meaning:
      "Modelo de conta que se repete (aluguel, internet). O sistema cria o lançamento sozinho antes de cada vencimento.",
  },
  {
    term: "Entidade",
    meaning:
      "Fornecedor ou cliente cadastrado (pessoa ou empresa), com documento e dados bancários.",
  },
  {
    term: "Alçada",
    meaning:
      "Limite de decisão. Aqui: com o centro de custo 85% comprometido, só gestor ou administrador aprova despesa nova nele.",
  },
  {
    term: "Rascunho",
    meaning:
      "Lançamento salvo, mas ainda não enviado a ninguém. Já reserva o orçamento do centro de custo.",
  },
  {
    term: "Magic link",
    meaning:
      "Link enviado por e-mail que deixa o aprovador decidir sem entrar no sistema. Vale por tempo limitado e só uma vez.",
  },
];

export interface RoleGuide {
  does: string[];
  cannot: string[];
  /** Aviso sem ícone de ✓ ou ✗. */
  note?: string;
}

export const ROLE_GUIDE: Record<UserRole, RoleGuide> = {
  admin: {
    does: [
      "Tudo o que o gestor financeiro faz, em todas as empresas.",
      "Cria e edita empresas, chaves de API e as ferramentas de Sistema.",
      "Lê e responde os feedbacks dos usuários.",
    ],
    cannot: [],
    note: "Nenhuma ação é bloqueada por papel. Por isso a regra de ouro vale em dobro: não aprove nem pague o que você mesmo lançou.",
  },
  financial_manager: {
    does: [
      "Lança contas a pagar e a receber, aprova e dá baixa.",
      "Monta lotes, escolhe aprovador e autorizador, confirma pagamentos.",
      "Distribui o orçamento entre centros de custo e decide pedidos de suplementação.",
      "Cuida do plano de contas, das contas bancárias e das regras da conciliação; reabre período fechado.",
      "Aprova, rejeita e troca o papel dos usuários da empresa.",
    ],
    cannot: [
      "Criar empresas, gerar chaves de API ou usar as ferramentas de Sistema (só administrador).",
      "Aprovar ou autorizar um lote que ele mesmo enviou.",
    ],
  },
  approver: {
    does: [
      "Vê todas as contas da empresa e aprova ou rejeita despesas (rejeição exige motivo).",
      "Aprova, reduz itens ou devolve os lotes em que foi designado.",
      "Aplica a troca de dados bancários de um fornecedor pedida por outra pessoa.",
      "Consulta receitas, recorrências, conciliação, relatórios e auditoria.",
    ],
    cannot: [
      "Lançar contas, dar baixa, montar lote ou editar cadastros.",
      "Aprovar despesa num centro de custo acima de 85% comprometido (vai para o gestor).",
    ],
  },
  releaser: {
    does: [
      "Dá baixa (registra o pagamento) em despesas aprovadas e desfaz baixas erradas.",
      "Autoriza os lotes em que foi designado e paga no banco.",
      "Importa extratos e concilia; anexa e confere comprovantes.",
      "Consulta receitas, cadastros, relatórios e auditoria.",
    ],
    cannot: [
      "Lançar contas, aprovar despesas ou montar lote.",
      "Criar regras automáticas da conciliação (só gestor).",
    ],
  },
  auditor: {
    does: [
      "Consulta contas a pagar e a receber, conciliação, contas bancárias, plano de contas, relatórios e o log de auditoria.",
      "Exporta relatórios e o próprio log (a exportação também fica registrada).",
    ],
    cannot: [
      "Alterar qualquer coisa: o papel é somente leitura.",
      "Ver o painel inicial, lotes, recorrências e o cadastro de fornecedores.",
    ],
  },
  user: {
    does: [
      "Lança as próprias despesas, com documento anexado, nos centros de custo liberados para você.",
      "Envia para aprovação e acompanha o andamento do que lançou.",
      "Marca despesas como reembolso e monta o seu RD.",
    ],
    cannot: [
      "Ver o que outras pessoas lançaram, receitas, painel ou relatórios.",
      "Aprovar, pagar ou mudar o status de uma conta depois de enviada.",
    ],
  },
};

const LIMITES_CONTROLE = [
  "**Não exclua conta paga, conciliada ou em lote.** O sistema ainda deixa algumas pessoas excluírem. O certo é desfazer a baixa e rejeitar com motivo.",
  "**Não aprove o que você lançou, nem pague o que você aprovou.** Nos lotes o sistema já impede; no lançamento avulso ainda não.",
  "**Não pule etapas.** Toda despesa passa por aprovação antes da baixa, mesmo que o sistema permita a quem paga baixar um rascunho.",
  "**Não mexa em mês fechado.** O fechamento da conciliação ainda não trava a edição de lançamentos daquele período. Se precisar, reabra o fechamento, corrija e feche de novo.",
];

/** As três que mais custam caro; aparecem logo após as regras de ouro. */
export const CRITICAL_LIMITS = LIMITES_CONTROLE.slice(0, 3);

const GESTAO: UserRole[] = ["admin", "financial_manager"];
const PAGADORES: UserRole[] = ["admin", "financial_manager", "releaser"];

export const CHAPTERS: PlaybookChapter[] = [
  {
    id: "rotina",
    title: "A rotina",
    summary:
      "O que fazer todo dia, semana, mês e ano. Só aparece o que é do seu papel.",
    topics: [
      {
        id: "diaria",
        title: "Todo dia",
        items: [
          {
            text: "Esvaziar a [Minha fila](/financeiro/contas-pagar?tab=queue).",
            roles: ["admin", "financial_manager", "approver", "releaser"],
            badge: "queue",
          },
          {
            text: "Conferir as [Vencidas](/financeiro/contas-pagar?tab=overdue): a aba deve estar vazia. Se não estiver, pagar, renegociar ou rejeitar com motivo.",
            roles: PAGADORES,
            badge: "overdue",
          },
          {
            text: "Pagar o que [vence hoje](/financeiro/contas-pagar?tab=today) e dar baixa com a data do banco.",
            roles: PAGADORES,
          },
          {
            text: "Subir os [comprovantes](/financeiro/comprovantes) do dia.",
            roles: PAGADORES,
          },
        ],
      },
      {
        id: "semanal",
        title: "Toda semana",
        items: [
          {
            text: "Montar o [lote](/financeiro/lotes) da semana seguinte (ou aceitar a sugestão) e enviar para aprovação até quarta.",
            roles: GESTAO,
          },
          {
            text: "Importar o extrato de cada conta e [conciliar](/financeiro/conciliacao).",
            roles: PAGADORES,
          },
          {
            text: "Zerar os [comprovantes pendentes](/financeiro/comprovantes).",
            roles: PAGADORES,
            badge: "comprovantes",
          },
          {
            text: "Conferir, nas [recorrências](/financeiro/recorrencias), as contas **confirmar valor** e **sem saldo**.",
            roles: GESTAO,
          },
        ],
      },
      {
        id: "mensal",
        title: "Todo mês (até o dia 10)",
        items: [
          {
            text: "[Conciliar](/financeiro/conciliacao) e **fechar** todas as contas bancárias e aplicações do mês anterior, com diferença zero.",
            roles: PAGADORES,
          },
          {
            text: "Zerar os **pagos sem comprovante**, em [Comprovantes](/financeiro/comprovantes).",
            roles: PAGADORES,
          },
          {
            text: "Buscar [sem:conta](/busca?q=sem%3Aconta) e classificar o que faltou no plano de contas.",
            roles: GESTAO,
          },
          {
            text: "Gerar [Fluxo de caixa e DRE](/relatorios) do mês e enviar à diretoria ou conselho e ao contador.",
            roles: GESTAO,
          },
          {
            text: "Revisar no [log de auditoria](/configuracoes/auditoria) as trocas de dados bancários e alterações de valores.",
            roles: [...GESTAO, "auditor"],
          },
        ],
      },
      {
        id: "anual",
        title: "Todo ano",
        items: [
          {
            text: "Dezembro: revisar as [recorrências](/financeiro/recorrencias) (reajustes, contratos encerrados) e o [plano de contas](/cadastros/plano-de-contas) do ano seguinte.",
            roles: GESTAO,
          },
          {
            text: "Janeiro: [redistribuir os envelopes](/centros-custo/distribuicao) dos centros de custo a partir da raiz.",
            roles: GESTAO,
          },
          {
            text: "Revisar [usuários e papéis](/configuracoes/usuarios).",
            roles: GESTAO,
          },
          {
            text: "Entregar ao contador o fechamento do ano (DRE, fluxo, extratos conciliados).",
            roles: GESTAO,
          },
          {
            text: "Guardar documentos fiscais por **no mínimo 5 anos** contados de 1º de janeiro do ano seguinte; livros e base dos lançamentos, de preferência sem prazo.",
            roles: GESTAO,
          },
        ],
      },
    ],
  },
  {
    id: "comece",
    title: "Comece aqui",
    summary:
      "Acesso e navegação. Termo desconhecido? Veja o [Glossário](#glossario).",
    topics: [
      {
        id: "primeiro-acesso",
        title: "Primeiro acesso",
        intro:
          "O acesso é por empresa: você entra com sua conta e pede acesso à empresa; um administrador ou gestor aprova e define seu papel.",
        steps: [
          "Entre com a conta Google ou com e-mail e senha.",
          "Informe o nome e o **CNPJ** da empresa. Se ela já existe no sistema, seu pedido vai para quem a administra; se não existe, ela é criada.",
          'Escolha o papel que você vai exercer e envie. Você verá a tela "Aguardando aprovação".',
          "Quando aprovarem, entre de novo. Se você tem acesso a mais de uma empresa, troque pelo seletor no alto da barra lateral.",
        ],
        rules: [
          "Cada empresa (CNPJ) tem dados totalmente separados. O que você lança numa não aparece na outra.",
          "Seu papel vale por empresa: você pode ser gestor numa e aprovador noutra.",
        ],
        faq: [
          {
            q: "Pedi acesso e nada aconteceu.",
            a: "O administrador ou gestor da empresa recebe uma notificação em Configurações › Usuários › Solicitações pendentes. Avise-o.",
          },
          {
            q: "Entrei e não vejo um menu que meu colega vê.",
            a: "O menu mostra só o que o seu papel permite. Confira o que o seu papel faz em [Papéis](#papeis) e peça a troca ao gestor, se for o caso.",
          },
        ],
        links: [{ label: "Usuários", href: "/configuracoes/usuarios" }],
      },
      {
        id: "navegacao",
        title: "Navegação e atalhos",
        intro:
          "A barra lateral segue a ordem do trabalho: Início, Minha fila, Contas a Pagar, Contas a Receber, Rotinas, Cadastros e Relatórios. Configurações e este manual ficam no rodapé.",
        rules: [
          "**Minha fila** é o seu trabalho do dia: o que espera a sua decisão (aprovação, autorização). O número ao lado é quanto falta.",
          "O número vermelho em Contas a Pagar é quantas contas estão **vencidas**.",
        ],
        items: [
          "[[Ctrl+K]] (ou [[⌘K]]): busca em tudo, de qualquer tela, inclusive neste manual.",
          "[[g]] e depois uma letra vai direto à tela: [[g i]] Início, [[g f]] Minha fila, [[g p]] Pagar, [[g r]] Receber, [[g l]] Lotes, [[g c]] Comprovantes, [[g b]] Conciliação, [[g e]] Fornecedores, [[g m]] este manual.",
          "[[\\]] recolhe ou abre a barra lateral. Fixe as telas que você mais usa pelo ícone de alfinete.",
          "Nas listas: [[j]] e [[k]] sobem e descem, [[Enter]] abre, [[x]] seleciona, [[p]] paga, [[c]] copia a linha digitável, [[/]] busca, [[1]] a [[9]] trocam de aba.",
        ],
      },
    ],
  },
  {
    id: "despesa",
    title: "O caminho de uma despesa",
    summary:
      "Do pedido ao extrato: lançar, aprovar, pagar, comprovar e conciliar.",
    topics: [
      {
        id: "ciclo",
        title: "As etapas, em ordem",
        intro:
          "Toda conta a pagar percorre o mesmo caminho. Cada etapa tem um dono diferente, para que ninguém controle o dinheiro sozinho.",
        steps: [
          "**Rascunho:** alguém lança a conta com o documento. Ainda pode editar à vontade.",
          "**Em aprovação:** enviada ao aprovador. Ele aprova ou rejeita com motivo.",
          "**Aprovada:** pode ser paga. Ou entra num lote (o lote tem a própria aprovação e autorização).",
          "**Paga:** o pagador pagou no banco e deu baixa com a data real.",
          "**Comprovada:** o comprovante do banco foi anexado e associado.",
          "**Conciliada:** a linha do extrato bancário foi casada com a conta paga.",
        ],
        rules: [
          "**Rejeitada** é o fim do caminho: não conta como vencida nem entra nos totais a pagar, e o motivo fica registrado. Corrigido o problema, lance de novo.",
          "Existem dois jeitos de aprovar: **um a um** (Enviar para aprovação) ou **em lote**. Use o lote quando houver várias contas para a mesma semana.",
        ],
      },
      {
        id: "lancar",
        title: "Lançar uma conta a pagar",
        roles: ["admin", "financial_manager", "user"],
        intro:
          "Em Contas a Pagar › Nova conta. O painel lateral começa pelo documento: cole a linha digitável do boleto ou anexe a nota e o sistema preenche o que conseguir.",
        steps: [
          "Cole a **linha digitável** (o valor e o vencimento saem dela) ou anexe a nota/boleto.",
          "Escolha o **fornecedor**. Se ele já foi usado, o sistema sugere conta, centro de custo e forma de pagamento do último lançamento.",
          "Confira **valor**, **vencimento** e o **nº do documento** (nota, fatura ou contrato).",
          "Preencha a **competência** quando o mês da despesa for diferente do vencimento.",
          "Escolha o **centro de custo** (pode ratear em % ou R$ entre vários) e a **conta do plano de contas**.",
          'Escreva uma **descrição** que outra pessoa entenda daqui a um ano: "Energia da sede, set/2026", não "luz".',
          "Salve como **rascunho** ou **envie para aprovação** direto. Ctrl+Enter salva.",
        ],
        rules: [
          "Só centros de custo do **último nível** recebem despesa. Os de cima só distribuem.",
          'Se o centro de custo não tem saldo no envelope, o sistema **recusa** a despesa. Peça suplementação ou redistribuição ao gestor. Não troque de centro para "caber".',
          "O sistema avisa quando já existe conta parecida (mesmo fornecedor, valor e data). Confira antes de seguir: pagamento em dobro é o erro mais caro.",
          "Parcelado: informe o número de parcelas e o sistema cria uma conta por mês (até 120). O orçamento é conferido pela soma de cada ano.",
          "Despesa paga com dinheiro próprio para ser devolvido? Marque **Despesa de reembolso**: ela vai para o seu RD.",
        ],
        faq: [
          {
            q: "Não sei qual conta do plano de contas usar.",
            a: "Escolha pela natureza do gasto (o que foi comprado), não por quem comprou (quem comprou é o centro de custo). Na dúvida, pergunte ao gestor antes de enviar; corrigir depois de aprovado exige novo ciclo.",
          },
          {
            q: "O botão de salvar diz que não há saldo no centro de custo.",
            a: "O envelope do ano acabou. Peça ao gestor uma suplementação (Centros de Custo › pedido de suplementação) ou que ele redistribua. A trava existe para que ninguém gaste o que não foi planejado.",
          },
          {
            q: "Lancei errado e já enviei para aprovação.",
            a: 'Peça ao aprovador que rejeite com o motivo "lançado errado", ou ao gestor que edite. Não lance outra igual por cima.',
          },
        ],
        links: [{ label: "Contas a Pagar", href: "/financeiro/contas-pagar" }],
      },
      {
        id: "aprovar",
        title: "Aprovar ou rejeitar",
        roles: ["admin", "financial_manager", "approver"],
        intro:
          "Em Minha fila. Abra a conta: o documento anexado aparece ao lado dos dados, para conferir os dois juntos.",
        steps: [
          "Confira se o **documento** existe e bate com valor, fornecedor e vencimento.",
          "Confira se o **centro de custo** e a **conta** fazem sentido para aquele gasto.",
          "Confira se não é **duplicada** (mesmo fornecedor e valor em datas próximas).",
          "**Aprovar** ou **Rejeitar**: a rejeição pede o motivo, que vai para quem lançou por e-mail e fica no histórico.",
        ],
        rules: [
          'Não aprove conta sem documento. "Depois eu mando a nota" é assim que o dinheiro some.',
          "Não aprove conta que você mesmo lançou. O sistema ainda permite para gestor e administrador; a regra é sua.",
          "Com o centro de custo 85% comprometido, a aprovação passa a ser do gestor ou administrador.",
          "Conta marcada **confirmar valor** (gerada por recorrência com valor estimado): só aprove depois de conferir o valor real da fatura.",
          "Conta marcada **sem saldo** (recorrência gerada sem orçamento): o gestor precisa redistribuir antes.",
        ],
        links: [
          { label: "Minha fila", href: "/financeiro/contas-pagar?tab=queue" },
        ],
      },
      {
        id: "pagar",
        title: "Pagar e dar baixa",
        roles: ["admin", "financial_manager", "releaser"],
        intro:
          "Pague no banco primeiro; depois registre a baixa no sistema com os dados do banco. A baixa avulsa vale para conta **aprovada** fora de lote.",
        steps: [
          "Abra a conta aprovada e clique **Baixar** (ou tecla **p** na lista).",
          "Informe a **data de pagamento** que aparece no banco.",
          "Informe o **valor pago**. Se for diferente do original, o sistema calcula sozinho o desconto ou os juros/multa.",
          "Escolha a **conta de saída** (a conta bancária por onde o dinheiro saiu).",
          "Anexe o comprovante (ou suba em Comprovantes, que associa sozinho).",
        ],
        rules: [
          "**Data futura é recusada**: baixa é registro do que já aconteceu. Pagamento agendado continua aprovado até o dia em que sai.",
          "Boleto em atraso: o usual é multa de 2% + juros de 1% ao mês. Confira o valor no próprio boleto atualizado.",
          "Conta **bloqueada** (em disputa) não pode ser paga nem entrar em lote até alguém liberar.",
          "A baixa nunca é recusada por falta de orçamento, porque a dívida existe. Se o pagamento cair noutro ano sem saldo, o gestor é avisado para regularizar.",
          "Baixou errado? **Desfazer baixa** (quem paga ou o gestor) volta a conta ao status anterior. Não exclua.",
        ],
        links: [{ label: "Contas a Pagar", href: "/financeiro/contas-pagar" }],
      },
      {
        id: "bloqueio",
        title: "Bloquear um pagamento",
        roles: ["admin", "financial_manager", "approver", "releaser"],
        intro:
          "Quando há disputa com o fornecedor (serviço mal feito, cobrança errada), bloqueie a conta em vez de rejeitar: ela continua existindo, mas ninguém paga.",
        rules: [
          "O bloqueio exige motivo e mostra quem bloqueou.",
          "Só quem aprova ou paga coloca ou tira o bloqueio; quem lançou não destrava.",
        ],
      },
      {
        id: "listas",
        title: "Entendendo as listas",
        intro:
          "Contas a Pagar e a Receber são organizadas por situação, não por período.",
        rules: [
          "**Vencidas** mostra todo atraso em aberto, de qualquer data. Ela deve estar sempre vazia.",
          "**Hoje**, **Esta semana** (próximos 7 dias) e **Futuras** mostram o que vem pela frente.",
          "O filtro de período vale só para **Pagas** e **Todas**.",
          "O rodapé mostra quantidade e total da aba. Os totais são calculados no servidor sobre tudo, não só sobre a página visível.",
          "O papel **Usuário** vê só o que lançou.",
        ],
      },
    ],
  },
  {
    id: "receitas",
    title: "Receitas",
    summary: "Contas a receber, recebimento e cobrança.",
    topics: [
      {
        id: "receber",
        title: "Lançar e receber",
        roles: ["admin", "financial_manager"],
        intro:
          "Em Contas a Receber › Nova conta. Receita não passa por aprovação: nasce aprovada.",
        steps: [
          "Escolha o cliente/doador, valor, vencimento e conta do plano de contas.",
          "Quando o dinheiro cair no banco, abra a conta e **Receber**, com a data e o valor do extrato e a conta de entrada.",
          "Se o cliente prometeu pagar numa data, registre a **promessa de pagamento** para acompanhar.",
        ],
        rules: [
          "Toda receita entra automaticamente no **centro de custo raiz** (o de cima de todos). Ninguém escolhe; depois o gestor distribui pelos envelopes.",
          "Receita entra no orçamento pelo regime de competência, no ano da data efetiva.",
          "Doação ou convênio com destino específico: anote o projeto na descrição e use a conta do plano de contas própria, para a prestação de contas (veja [Limites conhecidos](#cap-limites)).",
        ],
        links: [
          { label: "Contas a Receber", href: "/financeiro/contas-receber" },
        ],
      },
    ],
  },
  {
    id: "lotes",
    title: "Lotes de pagamento",
    summary: "Aprovar e pagar várias contas de uma vez, com dupla checagem.",
    topics: [
      {
        id: "lote-fluxo",
        title: "Como funciona um lote",
        intro:
          "O lote junta contas a pagar da semana para uma única decisão. Cada lote tem três pessoas: quem monta, quem aprova e quem autoriza.",
        steps: [
          "**Aberto:** o gestor cria o lote (pode pedir que ele puxe os rascunhos de um período) ou aceita uma **sugestão** do sistema, gerada toda madrugada por fornecedor, data ou impostos.",
          "**Em aprovação:** o gestor envia a um aprovador, que recebe e-mail com link e código de confirmação. O link vale 48 horas e uma vez só.",
          "O aprovador **aprova**, **reduz** o valor de um item (com motivo), **tira** itens (eles voltam a rascunho) ou **devolve** o lote inteiro ao gestor com motivo.",
          "**Aprovado:** o gestor envia ao autorizador.",
          "**Autorizado:** o autorizador confirma que liberou o pagamento no banco.",
          "**Pago:** o gestor confirma os pagamentos; o sistema dá baixa em todas as contas, com a data do vencimento limitada entre a autorização e hoje.",
        ],
        rules: [
          "Quem monta o lote **não pode** ser o aprovador nem o autorizador. O sistema recusa.",
          "Aprovar o lote **aprova todas as contas dele**: o lote substitui a aprovação uma a uma.",
          "O aprovador só pode **reduzir** valores, nunca aumentar.",
          "Incluir conta num lote já aprovado faz ele voltar para aprovação.",
          "O gestor pode **recolher** um envio (o link deixa de valer). Lote pago enviado por engano pode ser **revertido**, com motivo: as contas voltam a rascunho.",
          "Fornecedor que trocou de conta bancária nos últimos 30 dias aparece com alerta no lote. Confira antes de autorizar.",
        ],
        faq: [
          {
            q: "O aprovador diz que o link expirou.",
            a: "Abra o lote e reenvie para aprovação: um link novo é gerado.",
          },
          {
            q: "Paguei uma conta do lote separadamente.",
            a: "Ao confirmar o lote, contas já pagas ficam com a própria data; nada é baixado duas vezes.",
          },
        ],
        links: [{ label: "Lotes de Pagamento", href: "/financeiro/lotes" }],
        roles: ["admin", "financial_manager", "approver", "releaser"],
      },
    ],
  },
  {
    id: "comprovantes",
    title: "Comprovantes",
    summary: "Provar que cada pagamento saiu.",
    topics: [
      {
        id: "comprovantes-fila",
        title: "Subir e associar comprovantes",
        roles: ["admin", "financial_manager", "releaser"],
        intro:
          "Em Rotinas › Comprovantes. Suba vários PDFs ou imagens de uma vez; o sistema lê valor, data e beneficiário e procura a conta paga correspondente.",
        steps: [
          "Clique em enviar e escolha os arquivos (Pix, TED, boleto pago).",
          "Os que casaram com certeza são associados sozinhos (só para fornecedores marcados como de confiança).",
          "Os demais caem em **Pendentes**: abra, confira a sugestão lado a lado e **Confirme** (Enter) ou **Rejeite** (R). J/K navega.",
          "**Sem associação**: não achou conta. Verifique se a conta foi lançada e baixada.",
          "**Ilegíveis**: arquivo sem texto (foto ruim). Associe à mão.",
          "**Pagos sem comprovante**: contas pagas que ainda não têm comprovante. Meta: zero.",
        ],
        rules: [
          "Todo pagamento precisa de comprovante. É ele que prova à auditoria e ao conselho que o dinheiro foi para quem devia.",
          "O sistema avisa comprovante possivelmente duplicado (mesmo valor, data e beneficiário).",
          "Leitura errada? Use **Corrigir leitura**: o sistema aprende o nome, CNPJ ou chave Pix daquele fornecedor para as próximas.",
          "Em **Regras**, o gestor define o **início do controle** (pagamentos anteriores não são cobrados) e quais fornecedores são de confiança.",
        ],
        links: [
          { label: "Comprovantes", href: "/financeiro/comprovantes" },
          {
            label: "Regras de comprovantes",
            href: "/financeiro/comprovantes/regras",
          },
        ],
      },
    ],
  },
  {
    id: "conciliacao",
    title: "Conciliação bancária",
    summary: "Fazer o sistema bater com o banco, conta por conta.",
    topics: [
      {
        id: "contas-bancarias",
        title: "Cadastrar as contas bancárias",
        roles: ["admin", "financial_manager"],
        intro:
          "Em Cadastros › Contas Bancárias. Cada conta corrente e cada aplicação (CDB, fundo, poupança) é uma conta separada, com saldo inicial e data de abertura.",
        rules: [
          "Cadastre **todas** as contas onde a organização tem dinheiro, inclusive aplicações. Dinheiro fora do sistema é dinheiro sem controle.",
          'Aplicação automática do banco ("aplic. aut.") que você queira acompanhar vira uma conta separada do tipo aplicação.',
          "Para aplicações, informe o **% do CDI** e se a entidade é isenta de IR. O sistema calcula a curva esperada e o rendimento.",
        ],
        links: [
          { label: "Contas Bancárias", href: "/cadastros/contas-bancarias" },
        ],
      },
      {
        id: "conciliar",
        title: "Conciliar o extrato",
        roles: ["admin", "financial_manager", "releaser"],
        intro:
          "Em Rotinas › Conciliação Bancária. A faixa no topo mostra as contas, a mais atrasada primeiro.",
        steps: [
          "Baixe o extrato **OFX** no internet banking e importe na conta certa. Pode importar o mesmo período de novo: linhas repetidas não duplicam.",
          "**Buscar correspondências** casa cada linha com contas pagas (pela data da baixa e valor pago) e com contas **aprovadas em aberto**; nestas, confirmar dá a baixa com a data do banco. Uma linha pode casar com várias contas do mesmo favorecido que somam o valor. CPF/CNPJ e nome do favorecido no histórico do banco reforçam a sugestão. Sugestões fortes vêm pré-selecionadas, mas confira.",
          "Linha sem par? Três saídas: **Baixar pelo extrato** (a conta existe, aprovada, mas não foi baixada; uma linha pode baixar várias contas do mesmo favorecido), **Lançar** (tarifa, IOF, rendimento; cria a conta já paga) ou **Ignorar** com motivo (transferência entre contas próprias já registrada, por exemplo).",
          "Linhas que se repetem todo mês (tarifa do pacote) podem virar **regra**: o sistema passa a sugerir a mesma ação. Só o gestor cria regras.",
          "Quando a **diferença** chegar a zero e não houver pendentes, **Feche** o período.",
        ],
        rules: [
          "O extrato manda. Se o sistema diz uma coisa e o banco outra, quem está errado é o lançamento.",
          "Fechar exige diferença zero e nenhuma linha pendente. Reabrir é só do gestor ou administrador e fica registrado.",
          'As linhas de saldo do banco ("SALDO ANTERIOR", "SDO") não são movimento: viram conferência diária do saldo.',
          "Aplicação: o rendimento do mês é reconhecido ao fechar, pela conferência do saldo bruto informado no extrato da aplicação, com IR/IOF lançado à parte.",
          "O sistema aprende com o gestor: ao confirmar, o CPF/CNPJ e o nome que o banco imprimiu ficam guardados no cadastro do favorecido, e a próxima linha igual já vem sugerida. Confirmou errado? Remova o apelido em [Comprovantes › Regras](/financeiro/comprovantes/regras).",
          "Conta com comprovante confirmado pesa mais na sugestão, e comprovante de conta já conciliada no extrato também: são duas provas independentes. O menu **…** mostra o **Acerto das sugestões** por faixa; a mesma medida dos comprovantes fica em Comprovantes › Regras.",
          "Teclas: **j/k** navega, **x** seleciona, **i** ignora, **Enter** confirma, **[ ]** troca de conta.",
        ],
        faq: [
          {
            q: "A diferença não zera.",
            a: "Procure, nesta ordem: (1) linha do extrato sem par; (2) conta baixada com data errada (a data tem de ser a do banco); (3) conta baixada na conta bancária errada; (4) valor com centavos diferentes (juros/desconto não informados); (5) pagamento lançado em duplicidade.",
          },
          {
            q: "Baixar pelo extrato não mostra a despesa que eu sei que existe.",
            a: "A lista mostra só despesas **aprovadas** (avulsas ou no lote), sem bloqueio de pagamento e sem conta de saída diferente da linha. Rascunho ou aguardando aprovação não aparece: aprove primeiro. Se a conta já foi baixada em Contas a Pagar, ela não está aqui; ela casa sozinha na busca de sugestões.",
          },
          {
            q: "Fiz uma transferência só para vários projetos da mesma instituição.",
            a: "Em **Baixar pelo extrato**, as contas do mesmo favorecido aparecem juntas, com a soma; o grupo cuja soma bate com o extrato vem primeiro, marcado **soma exata**. Marque o grupo inteiro (ou só as contas daquela transferência) e confirme: todas são baixadas com a data do banco e a linha fica conciliada com elas. Com mais de uma conta a soma precisa bater ao centavo. Desfazer estorna todas.",
          },
          {
            q: "O saldo do painel não bate com o banco.",
            a: 'O painel mostra "Saldo pelas baixas" (soma do que foi baixado) e, para quem vê a conciliação, o saldo informado no banco e a diferença. A diferença sempre é lançamento faltando, baixa com data errada ou conta bancária não cadastrada.',
          },
        ],
        links: [
          { label: "Conciliação Bancária", href: "/financeiro/conciliacao" },
        ],
      },
    ],
  },
  {
    id: "recorrencias",
    title: "Recorrências",
    summary: "Contas que se repetem, criadas sozinhas.",
    topics: [
      {
        id: "recorrencia",
        title: "Criar e manter recorrências",
        roles: ["admin", "financial_manager"],
        intro:
          "Aluguel, internet, salários, mensalidades. Você descreve o modelo uma vez; toda madrugada o sistema cria o lançamento com antecedência.",
        rules: [
          "Despesa é criada **7 dias antes** do vencimento por padrão; receita, no dia. Dá para mudar por modelo.",
          'Conta de valor variável (energia, água, DARF): marque **valor estimado**. O lançamento nasce marcado "confirmar valor" e não deve ser aprovado antes de conferir a fatura.',
          "Reajuste anual: escolha IPCA, IGP-M (acumulado de 12 meses do Banco Central) ou % fixo e o mês. Se o índice não puder ser consultado, o valor segue igual e o gestor é avisado.",
          "Use **{mes}** e **{ano}** na descrição para cada lançamento sair com o mês certo.",
          'Recorrência sem saldo no centro de custo é criada assim mesmo, como rascunho marcado "sem saldo", e o gestor é avisado.',
          "**Pausar** suspende; **Encerrar** termina de vez (contrato acabou).",
          "Alterou o valor ou o centro de custo? Edite o modelo e os próximos lançamentos saem certos. Os já gerados você corrige um a um.",
        ],
        links: [{ label: "Recorrências", href: "/financeiro/recorrencias" }],
      },
    ],
  },
  {
    id: "reembolsos",
    title: "Reembolsos (RD)",
    summary: "Devolver a quem pagou do próprio bolso.",
    topics: [
      {
        id: "rd",
        title: "Montar e aprovar um RD",
        intro:
          "Cada despesa paga por um colaborador é lançada como conta a pagar marcada **Despesa de reembolso**, com a nota anexada. O RD agrupa essas despesas de uma pessoa num período.",
        steps: [
          "Mande ao funcionário o link pessoal (Reembolsos › A reembolsar › **Links de envio**). Ele fotografa cada nota pelo celular, sem login, e acompanha o reembolso pelo mesmo link.",
          "A nota cai em **Enviadas pelos funcionários**, já lida e checada (duplicata, nota antiga, leitura duvidosa). Confira e clique em Lançar conta a pagar, ou recuse com motivo. Sem link, lance a despesa à mão com a nota e marque Despesa de reembolso.",
          "Em Rotinas › Reembolsos, aba **A reembolsar**, clique em Gerar relatório na pessoa. Desmarque o que não entra. Período e total saem das despesas; o número (RD-0001…) é automático.",
          "Envie para aprovação: o aprovador recebe link por e-mail com cada despesa e a nota, ou aprova dentro do sistema.",
          "Pague as **despesas** do RD pelo fluxo normal (avulso ou lote). O RD mostra sozinho quanto já foi pago.",
          "Gere o PDF (capa, resumo e as notas) para arquivo.",
        ],
        rules: [
          "O RD é o documento; o dinheiro sai pelas contas a pagar. O RD fica **Pago** quando todas as despesas dele estiverem pagas.",
          "Uma despesa só entra em um RD. Rejeitar ou excluir o RD devolve as despesas para a fila.",
          "Quem montou ou enviou o RD não aprova; só a pessoa designada no envio.",
        ],
        links: [{ label: "Reembolsos", href: "/financeiro/reembolsos" }],
      },
    ],
  },
  {
    id: "orcamento",
    title: "Centros de custo e orçamento",
    summary: "Quem pode gastar quanto: o modelo de envelopes.",
    topics: [
      {
        id: "envelope",
        title: "O modelo de envelopes",
        intro:
          "Os centros de custo formam uma árvore com **uma única raiz** (ex.: Global › Ofertas › Construção). O dinheiro desce da raiz para os filhos em envelopes anuais.",
        rules: [
          "Toda receita credita a **raiz**. O gestor distribui da raiz para os filhos, e dos filhos para os netos.",
          "**Disponível = recebido − distribuído aos filhos − gasto direto.** Cada centro só gasta o que recebeu.",
          "Despesa só nos centros do **último nível**. Os de cima apenas distribuem.",
          "A despesa **reserva** o envelope desde o rascunho; só a rejeição libera.",
          "Sem saldo, a despesa é **recusada**, no formulário e no servidor.",
          "Na virada do ano, os envelopes zeram e toda a sobra volta à raiz. Em janeiro o gestor redistribui do zero.",
          "Se a receita prevista não vier e um centro de cima ficar negativo, os de baixo travam até o gestor realocar.",
          "Para reorganizar a árvore, **crie centros novos e arquive os antigos**. Centro com histórico não muda de pai nem é excluído.",
        ],
        steps: [
          "Gestor: Centros de Custo › **Distribuir**. Edite os valores, confira a projeção do pai e salve: tudo é gravado de uma vez ou nada.",
          "Quem precisa de mais: peça **suplementação** no centro; o gestor recebe e aprova ou recusa.",
        ],
        links: [
          { label: "Centros de Custo", href: "/centros-custo" },
          {
            label: "Distribuir orçamento",
            href: "/centros-custo/distribuicao",
          },
        ],
      },
    ],
  },
  {
    id: "plano",
    title: "Plano de contas e DRE",
    summary: "Classificar cada real para saber com o quê se gasta.",
    topics: [
      {
        id: "plano-contas",
        title: "Usar o plano de contas",
        intro:
          "O plano é gerencial: cada conta tem código (que é a hierarquia, ex.: 3.3.01.001), natureza (receita, despesa ou patrimonial) e a linha da DRE onde soma.",
        rules: [
          "Só contas **analíticas** (último nível) recebem lançamento.",
          "Uma conta por lançamento. O rateio é por centro de custo, não por conta.",
          'O gestor define **a partir de que ano** a conta é obrigatória. Antes disso é opcional, mas tudo sem conta cai em "sem conta" na DRE.',
          "Arquive contas que não serão mais usadas; não exclua conta com histórico.",
          "Para associações: doações, subvenções e convênios com destino específico devem ter contas próprias, separadas das receitas livres (ITG 2002).",
        ],
        links: [
          { label: "Plano de Contas", href: "/cadastros/plano-de-contas" },
        ],
      },
    ],
  },
  {
    id: "cadastros",
    title: "Fornecedores e clientes",
    summary: "Cadastro confiável é a primeira defesa contra fraude.",
    topics: [
      {
        id: "entidades",
        title: "Cadastrar e manter entidades",
        roles: ["admin", "financial_manager"],
        intro:
          "Em Cadastros › Fornecedores e Clientes. Comece pelo CPF/CNPJ: o tipo é deduzido e, para CNPJ, nome e regime vêm da Receita.",
        rules: [
          "Um cadastro por CPF/CNPJ. O sistema avisa se já existe.",
          "**Troca de dados bancários** de quem já tem cadastro não vale na hora: fica pendente até **outra pessoa** (gestor ou aprovador) aplicar. Confirme a troca por telefone com o fornecedor, num número que você já tinha. Golpe de troca de conta é o mais comum que existe.",
          "Uma entidade pode ter várias contas bancárias; cada lançamento escolhe qual recebe.",
          "Entidade com lançamentos não se exclui: **inative**. Ela some dos formulários e o histórico fica.",
          "Preencha os padrões (conta, centro de custo, forma de pagamento, prazo): eles entram sozinhos nos próximos lançamentos.",
        ],
        links: [
          { label: "Fornecedores e Clientes", href: "/cadastros/entidades" },
        ],
      },
    ],
  },
  {
    id: "relatorios",
    title: "Painel, relatórios e busca",
    summary: "Ler os números e achar qualquer lançamento.",
    topics: [
      {
        id: "relatorios",
        title: "Relatórios",
        intro:
          "Em Relatórios, três abas. O que aparece na tela é exatamente o que será exportado (PDF, Excel ou CSV).",
        rules: [
          "**Fluxo de caixa**: realizado (pelas baixas), previsto (pelos vencimentos) ou ambos, por estágio (autorizado, aprovado, em aprovação, recorrências, rascunho).",
          "**DRE gerencial**: por caixa (data do pagamento) ou por competência. A faixa de cobertura mostra quanto do valor está classificado no plano de contas; abaixo de 95%, o resultado não representa a realidade.",
          "**Pagamentos**: extrato por parceiro (entidade e conta), pela data da baixa, com opção de PDF com os comprovantes anexados.",
          "O filtro de centro de custo inclui os filhos. Clique numa linha para ver os lançamentos que a compõem.",
        ],
        links: [{ label: "Relatórios", href: "/relatorios" }],
        roles: [
          "admin",
          "financial_manager",
          "approver",
          "releaser",
          "auditor",
        ],
      },
      {
        id: "busca",
        title: "Busca",
        intro:
          'Ctrl+K em qualquer tela, ou a página Busca. Procura em descrição, fornecedor, documento, CNPJ, linha digitável, centro de custo, conta, lote e RD. Na página Busca você também pode escrever em português ("contas de luz pagas em setembro") e o sistema traduz para os filtros abaixo.',
        items: [
          "`tipo:pagar` ou `tipo:receber`",
          "`status:atrasado`, `status:rascunho`, `status:aprovacao`, `status:aprovado`, `status:pago`, `status:rejeitado`",
          "`valor:>500` ou `valor:100-500`",
          "`venc:2026-07` ou `venc:01/07/2026..31/07/2026`; `pago:` no mesmo formato",
          "`sem:comprovante` (pagas sem comprovante) e `sem:conta` (sem plano de contas)",
          '`-termo` exclui; `"frase exata"` casa junto',
        ],
        links: [{ label: "Busca", href: "/busca" }],
      },
    ],
  },
  {
    id: "admin",
    title: "Administração",
    summary: "Usuários, auditoria, integrações e manutenção.",
    topics: [
      {
        id: "usuarios",
        title: "Usuários e papéis",
        roles: ["admin", "financial_manager"],
        rules: [
          "Antes de aprovar um pedido de acesso, confira **o papel pedido**: é a própria pessoa que escolhe. Aprovador e pagador mexem com dinheiro.",
          "Dê o **menor papel** que resolve. Quem só lança despesa é Usuário.",
          "Saiu da organização? **Revogue o acesso no mesmo dia.**",
          "Revise a lista de usuários a cada trimestre.",
        ],
        links: [{ label: "Usuários", href: "/configuracoes/usuarios" }],
      },
      {
        id: "auditoria",
        title: "Log de auditoria",
        roles: [
          "admin",
          "financial_manager",
          "approver",
          "releaser",
          "auditor",
        ],
        intro:
          "Em Configurações › Auditoria: quem fez o quê, quando e o que mudou (antes → depois). O mesmo histórico aparece dentro de cada lançamento.",
        rules: [
          "O log não pode ser editado nem apagado por ninguém.",
          "Visões prontas: alterações de dados bancários, de valores e de perfis. Revise-as todo mês.",
        ],
        links: [{ label: "Auditoria", href: "/configuracoes/auditoria" }],
      },
      {
        id: "sistema",
        title: "Empresas, API e Sistema",
        roles: ["admin"],
        rules: [
          "**Chaves de API**: só para integrações conhecidas; a API é somente leitura para lançamentos. Revogue chaves sem uso.",
          "**Sistema › Recalcular saldo**: use quando o saldo do painel parecer errado depois de correções em massa. Não altera lançamentos.",
        ],
        links: [
          { label: "Empresas", href: "/configuracoes/empresas" },
          { label: "Chaves de API", href: "/configuracoes/api-keys" },
          { label: "Sistema", href: "/configuracoes/sistema" },
        ],
      },
    ],
  },
  {
    id: "faq",
    title: "Problemas comuns",
    summary: "Mensagens de erro e o que fazer.",
    topics: [
      {
        id: "erros",
        title: "Quando algo não deixa",
        faq: [
          {
            q: '"Você não tem permissão para esta operação nesta empresa."',
            a: "Seu papel não permite a ação, ou você está na empresa errada (confira o seletor no alto da barra lateral). Se o papel mudou há pouco, saia e entre de novo.",
          },
          {
            q: '"Você só pode alterar lançamentos criados por você."',
            a: "O papel Usuário mexe só no que lançou. Peça ao gestor.",
          },
          {
            q: '"Informe o motivo da rejeição."',
            a: "Toda rejeição precisa de motivo: é o que diz a quem lançou o que corrigir.",
          },
          {
            q: "Não consigo pagar com data de amanhã.",
            a: "Baixa futura é recusada. Agende no banco e dê a baixa no dia em que o dinheiro sair.",
          },
          {
            q: "Não consigo excluir um centro de custo ou uma conta.",
            a: "Têm histórico. Arquive em vez de excluir; para reorganizar, crie novos.",
          },
          {
            q: "Não consigo excluir um fornecedor.",
            a: "Ele tem lançamentos. Inative.",
          },
          {
            q: "A conta sumiu da lista.",
            a: "Confira a aba: rejeitadas só aparecem em Todas; pagas, em Pagas, filtradas pelo período. Ou use Ctrl+K.",
          },
          {
            q: "Encontrei um erro no sistema.",
            a: "Use Enviar feedback no rodapé da barra lateral. Diga a tela, o que fez e o que esperava.",
          },
        ],
        links: [{ label: "Enviar feedback", href: "/feedback" }],
      },
    ],
  },
  {
    id: "limites",
    title: "Limites conhecidos",
    summary:
      "O que o sistema ainda não impõe sozinho, e a regra manual até lá.",
    topics: [
      {
        id: "regras-manuais",
        title: "Controles que dependem de você",
        intro:
          "Sistemas profissionais impõem as regras abaixo automaticamente. Aqui o sistema ainda deixa quebrá-las; os ajustes estão planejados.",
        tone: "warning",
        rulesLabel: "Sem trava no sistema",
        rules: LIMITES_CONTROLE,
      },
      {
        id: "ainda-nao-faz",
        title: "O que o sistema ainda não faz",
        tone: "warning",
        rulesLabel: "Ainda não existe",
        rules: [
          "**RD pago não paga despesas.** Baixe as despesas antes de marcar o RD.",
          "**Retenções de impostos** (IRRF, PIS/COFINS/CSLL, ISS, INSS) não são calculadas. Lance o valor líquido ao fornecedor e uma conta separada para cada guia, conforme orientação do contador.",
          "**Recursos vinculados** (convênios, doações com destino): sem marcação própria. Use conta do plano e centro de custo exclusivos do projeto.",
          "**Contabilidade oficial** (livro diário, balanço, ECD) é feita pelo contador. Envie a ele, todo mês, os relatórios e extratos conciliados.",
          "**Não há verificação em duas etapas no login.** Use senha forte e exclusiva, ou entre com Google com verificação em duas etapas ativada na sua conta Google.",
        ],
      },
    ],
  },
];
