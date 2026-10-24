# Novidades

> Este documento reúne as atualizações do sistema na linguagem do usuário final. Ele é exibido como aviso na primeira vez que o usuário acessa o sistema após cada publicação. Cada nova atualização entra como uma seção `## Atualização de <d de mês de aaaa>` no topo. Dentro dela, cada `###` é uma novidade: o primeiro parágrafo é o resumo que aparece na janela; o restante fica escondido atrás de "Saiba mais".

---

## Atualização de 23 de outubro de 2026

### Dashboard começa pelo que precisa ser resolvido hoje

O dashboard agora abre com o que espera ação: contas a pagar vencidas, contas que vencem hoje, recebimentos em atraso e, para quem aprova ou autoriza, a sua fila. Cada bloco mostra a quantidade e o total reais, os mesmos das abas das listas, e as contas abrem direto no painel de detalhes.

As contas vencidas aparecem agrupadas por fornecedor ou cliente, com o total e há quanto tempo está a mais antiga; um clique abre as contas do grupo.

Os indicadores foram revistos para não se contradizerem. "Saldo pelas baixas" é o saldo formado pelos pagamentos e recebimentos registrados, e "Saldo previsto" é o último ponto do gráfico de fluxo de caixa. O antigo "Saldo Realizado" era, na verdade, o resultado do exercício (recebido menos pago) e agora aparece como tal, junto ao saldo. Recebido e pago mostram a variação contra o mesmo período do ano anterior, e cada indicador leva à lista correspondente.

A projeção de caixa ficou conservadora: contas a pagar em atraso saem do caixa hoje, porque são dívida certa, e contas a receber em atraso ficam fora, porque podem não entrar. Quando o caixa fica negativo, o aviso no topo diz em quais dias (por exemplo, "amanhã e a partir de 31/10"), o pior saldo, a entrada grande de que a projeção depende e quais clientes em atraso cobririam o buraco, começando pelos atrasos mais recentes. No gráfico, o trecho abaixo de zero aparece em vermelho e o menor saldo fica marcado; o cenário com os atrasados recebidos pode ser ligado pela legenda. O saldo aparece em degraus, como ele muda de fato no dia de cada vencimento, e as simulações funcionam também na visão do exercício inteiro.

A projeção respeita dias úteis: uma conta que vence no sábado, no domingo ou num feriado bancário nacional (incluindo Carnaval, Sexta-feira Santa e Corpus Christi) entra no saldo do dia útil seguinte, que é quando o dinheiro de fato se move. Assim o painel não acusa saldo negativo num fim de semana que se resolve na segunda.

Na fila, os atrasados mostram há quanto tempo está a conta mais antiga e quanto passa de 90 dias, para separar o que é cobrança de rotina do que é crédito duvidoso. No cadastro de entidades há a opção "Parte relacionada" (mantenedora, coligada, dirigente ou empresa ligada); essas contrapartes aparecem destacadas na fila e no aviso de saldo. O seletor de exercício passou a incluir o ano seguinte, para planejar os envelopes antes da virada.

No envelope por centro de custo, a barra mostra o que já foi pago (escuro) e o que está comprometido (claro). Vermelho é só quem passou do envelope. Amarelo é quem está pagando mais rápido que o ritmo do ano, marcado por um traço em cada barra, ou quem chegou a 95% com contas ainda por pagar e o ano pela frente: nesse caso a próxima despesa será recusada, e o detalhe leva direto à redistribuição. Empenhar o ano inteiro em janeiro não gera alerta, e um centro que já pagou tudo o que comprometeu aparece como "Esgotado", sem alerta. A exportação de lotes passou a usar o saldo real na linha "Saldo atual".

### Contas a pagar e a receber organizadas por situação

As listas de contas a pagar e a receber agora abrem em abas: Vencidas, Hoje, Próximos 7 dias, Futuras, Pagas (ou Recebidas) e Todas, cada uma com a quantidade e o total em reais. A aba Vencidas mostra todo o atraso em aberto, qualquer que seja o período escolhido. Antes, uma conta vencida podia ficar fora da tela por causa do filtro de datas.

O filtro de período passou a valer só para as abas Pagas e Todas. As vencidas aparecem agrupadas por faixa de atraso (1 a 30, 31 a 60, 61 a 90 e mais de 90 dias); as próximas, por dia, com o subtotal e o saldo previsto ao fim de cada dia. Cada linha mostra há quantos dias a conta venceu e o valor corrigido com multa e juros. O padrão é 2% de multa e 1% ao mês, e pode ser ajustado por fornecedor ou cliente no cadastro de entidades, em Multa por atraso e Juros de mora. Ao confirmar o pagamento de uma conta vencida, o valor sugerido já inclui os encargos da data escolhida. Contas rejeitadas deixaram de contar como vencidas e de entrar nos totais a pagar.

Quem aprova ou libera pagamentos ganhou a aba Minha fila, com o que espera a sua ação e há quantos dias está parado. Uma conta a pagar pode ser bloqueada, com o motivo registrado (por exemplo, nota divergente): enquanto estiver bloqueada, não pode ser paga nem entrar em lote. Nas contas a receber dá para registrar a data que o cliente prometeu pagar, e a lista mostra o atraso médio de cada cliente nos últimos 12 meses.

As linhas também avisam quando há possível duplicata (mesmo fornecedor, valor e vencimento), conta paga sem comprovante ou sem centro de custo. A linha digitável do boleto pode ser copiada direto da lista. Os detalhes abrem num painel ao lado, sem esconder a lista, com setas para ir à conta anterior ou à próxima. O rodapé da lista mostra o total da aba e, ao selecionar contas, o total selecionado e as ações em lote. A aba escolhida e os filtros ficam guardados para a próxima visita.

No computador, dá para usar o teclado: j e k sobem e descem na lista, x seleciona, Enter abre, p confirma o pagamento, c copia o boleto, / vai para a busca e os números de 1 a 7 trocam de aba. A busca agora procura em todas as datas e situações.

### Plano de contas e DRE gerencial

Em Cadastros › Plano de Contas você monta a estrutura de receitas e despesas da organização, e cada conta a pagar ou a receber pode ser classificada numa conta do plano. A DRE em Relatórios passa a ser montada a partir dessa classificação.

Para começar há três caminhos: aplicar um modelo pronto (Empresas, ou Entidades sem fins lucrativos, com recursos de uso restrito separados conforme a ITG 2002), importar uma planilha Excel ou CSV, ou cadastrar conta por conta. A tela de importação oferece o modelo em branco, com listas de opções e uma aba de instruções, e os planos sugeridos em planilha para você ajustar antes de importar. Se a planilha tiver algum problema, nada é gravado e a tela mostra a linha de cada erro. Importar de novo atualiza as contas pelo código e cria as novas, sem excluir nenhuma.

O código define a hierarquia: 4.2.01 fica dentro de 4.2, que fica dentro de 4. Contas sintéticas agrupam e totalizam; só as analíticas recebem lançamentos. Cada analítica indica a linha da DRE em que aparece (receita bruta, deduções, custos, despesas operacionais, resultado financeiro, investimentos etc.). Conta com lançamentos não pode ser excluída, mas pode ser arquivada: sai dos formulários e os relatórios antigos continuam fechando.

A classificação pode ser opcional ou passar a ser obrigatória a partir de um exercício, por exemplo 2027. A escolha fica no topo da tela do plano. Enquanto for opcional, nada muda para quem lança. Quando passar a ser obrigatória, contas com vencimento naquele ano ou depois só são salvas com a conta preenchida. Recorrências ativas sem conta aparecem com a etiqueta "sem conta" em Financeiro › Recorrências. Classifique cada uma pela edição antes da virada, para que as contas geradas por elas já cheguem classificadas.

A DRE Gerencial em PDF mostra cada grupo com subtotais e a análise vertical (participação sobre a receita líquida). No Excel ela vem mês a mês, com uma segunda aba listando os lançamentos que formam cada linha. Ao filtrar por centro de custo, entra só a parte do rateio daquele centro. Lançamentos sem conta aparecem numa linha própria, e contas rejeitadas deixaram de ser somadas, como acontecia antes. A planilha de importação de contas a pagar e a receber ganhou a coluna "Conta Contábil", que aceita o código ou o nome da conta.

## Atualização de 6 de outubro de 2026

### Dados bancários do fornecedor nos detalhes da transação

Ao abrir os detalhes de uma conta, aparecem a chave PIX, o banco, a agência e a conta cadastrados na entidade vinculada. Não é mais preciso sair da tela e ir até o cadastro para pagar.

Os dados aparecem no bloco Dados para Pagamento, logo abaixo de Solicitado por e Método de Pagamento. Ao lado da chave PIX há um botão para copiá-la; agência e conta podem ser selecionadas e copiadas com um clique duplo. O tipo da chave (CPF, CNPJ, E-mail, Telefone ou Aleatória) e o tipo da conta (Corrente ou Poupança) aparecem entre parênteses quando estão cadastrados.

As informações são lidas do cadastro da entidade no momento em que você abre os detalhes. Se os dados bancários do fornecedor mudarem, a transação já mostra os novos. O bloco só aparece quando a transação está vinculada a uma entidade (opção "Usar Cadastros") e essa entidade tem pelo menos um dado bancário preenchido.

### Todos os bancos do país no cadastro, com busca pelo código

O campo Banco do cadastro de entidades passou de 20 opções para todas as instituições com código de compensação no Brasil, cerca de 460, e aceita busca pelo código ou pelo nome.

Abra Dados Bancários no cadastro da entidade, clique em Banco e digite. Números buscam pelo código: "341" encontra o Itaú, "260" o Nubank, "77" o Inter. Letras buscam pelo nome, sem diferença entre maiúsculas, minúsculas e acentos: "caixa" encontra a Caixa Econômica Federal. Cada opção mostra o código ao lado do nome.

A lista segue o cadastro de participantes do Banco Central e inclui bancos, cooperativas de crédito e instituições de pagamento, como Mercado Pago, Stone, Cora, Banco Pan, Banrisul, Unicred e Ailos. Os mais usados aparecem com o nome conhecido; os demais, com o nome registrado no Banco Central (por exemplo, "BANCO INBURSA"). Entidades já cadastradas mantêm o banco que tinham.

## Atualização de 17 de setembro de 2026

### Recorrências: busca por parte do nome e edição corrigida

Em Financeiro › Recorrências, a busca passou a encontrar por parte do nome e editar uma recorrência voltou a funcionar. A lista também ganhou paginação com números.

A busca agora encontra pelo trecho. Antes, o campo só achava a recorrência se você digitasse a descrição inteira, exatamente como estava cadastrada. Agora "IPT" encontra "IPTU" e "agua" encontra "Conta de Água". Maiúsculas, minúsculas e acentos não fazem diferença, e o resultado aparece enquanto você digita.

Editar recorrência voltou a funcionar. Salvar alterações (nome, valor, frequência, intervalo, próximo vencimento ou data final) falhava com "Erro ao atualizar recorrência" sempre que a recorrência não tinha data final ou regra de reajuste, o que vale para a maioria dos cadastros. Pelo mesmo motivo, criar uma conta recorrente em Contas a Pagar ou Contas a Receber sem informar forma de pagamento, entidade ou origem da solicitação também dava erro. Os dois casos estão corrigidos e esses campos podem ficar em branco.

Aproveitamos para ajustar outras coisas na mesma tela:

- A lista ganhou paginação com números, no mesmo padrão das outras listagens: "1–25 de 60", botões de página, setas e um seletor de itens por página (25, 50 ou 100). O botão "Carregar Mais" saiu. Ao buscar ou trocar o filtro de status, a lista volta para a primeira página.
- No celular, a contagem mostra o total real de resultados. Antes aparecia "25+ resultados" quando havia mais de uma página.
- Na edição, ao lado de "Data Final" aparece um link Remover quando há uma data preenchida. Até então não tinha como tirar uma data final depois de definida.
- O campo Frequência podia abrir a janela de edição mostrando um valor diferente do cadastrado (o valor salvo estava certo, só a exibição errava). Corrigimos.
- A tela carrega mais rápido. Ela fazia duas consultas ao banco, uma para os indicadores do topo e outra para a lista, e agora faz uma só. Filtros e busca passaram a ser aplicados na hora, sobre os dados já carregados.

### Entidades no mesmo padrão das outras listagens

A tela de Cadastros › Entidades ficou igual às demais listagens: paginação com números, busca instantânea, ordenação sobre a lista inteira e totais no cabeçalho.

Alinhamos a tela de fornecedores e clientes às demais listagens do sistema, como Contas a Pagar, Lotes e Centros de Custo. Os três cartões de contagem deram lugar a uma linha logo abaixo do título: "48 entidades · 30 fornecedores · 25 clientes". Ocupa menos espaço, a lista aparece mais acima e os números atualizam na hora ao criar ou excluir uma entidade. Antes podiam ficar defasados por alguns minutos.

O botão "Carregar Mais" saiu daqui também. No rodapé da lista você vê "1–25 de 132", os botões de página (1, 2, 3 … 6) com a atual destacada, setas de anterior e próxima e o seletor de itens por página (25, 50 ou 100). No celular ficam as setas e o indicador "3 / 6". Ao buscar ou trocar de aba, a lista volta para a primeira página.

A busca por nome ou CNPJ/CPF aplica a cada letra digitada e ganhou um X para limpar o texto. No computador, o campo de busca e as abas Todos / Fornecedores / Clientes ficam lado a lado; no celular, um embaixo do outro.

Clicar em Nome, Tipo, Categoria ou Documento agora ordena todas as entidades, não só as que já estavam na tela. Cada coluna mostra o ícone de ordenação, e a coluna ativa fica destacada com a seta para cima ou para baixo. A contagem de resultados aparece no canto direito do cabeçalho da lista, em qualquer tamanho de tela.

Alguns detalhes menores:

- Os botões Editar e Excluir da linha, que apareciam só ao passar o mouse, também aparecem ao navegar com Tab.
- Ao buscar sem resultado, há um botão Limpar busca. Sem nada cadastrado na aba, a mensagem diz o que falta ("Nenhum fornecedor cadastrado", por exemplo) e oferece Criar entidade para quem tem permissão.
- Se a lista não puder ser carregada, você vê um aviso com Tentar novamente, em vez de uma lista vazia.
- A confirmação de exclusão cita a entidade ("Excluir 'Fornecedor X'?") e avisa que a ação não pode ser desfeita.
- As etiquetas de Fornecedor / Cliente / Ambos e as iniciais coloridas ganharam versão para o tema escuro.
- O título da página passou a ser Entidades. Antes repetia "Cadastros", que é o nome da seção.
- A coluna Ações só aparece para quem pode gerenciar entidades.

### Um clique na linha abre os detalhes

Nas listagens de Contas a Pagar, Contas a Receber, Lotes, Entidades e Centros de Custo, clicar em qualquer ponto da linha abre os detalhes. O item "Ver detalhes" saiu do menu de três pontos.

Não é mais preciso abrir o menu e procurar "Ver detalhes". O menu agora guarda só as ações de fato (confirmar pagamento, editar, excluir e assim por diante). Vale em Contas a Pagar e Contas a Receber (abre os detalhes da transação), em Lotes (detalhes do lote), em Entidades (página da entidade), em Centros de Custo (página do centro de custo; a seta que expande os filhos continua funcionando) e na tela de Feedback da administração.

Marcar a caixa de seleção, usar o menu de ações ou os botões rápidos da linha (Aprovar, Autorizar, Excluir…) continua igual: essas ações não abrem os detalhes. No celular, tocar no cartão já abria os detalhes; o item "Ver detalhes" também saiu do menu ali. Pelo teclado, use Tab para chegar na linha e Enter (ou Espaço) para abrir. Quando seu perfil não tem nenhuma ação disponível para o registro, o menu de três pontos nem aparece.

### Cadastro de entidades: preenchimento automático pelo CNPJ

Ao cadastrar um fornecedor ou cliente pessoa jurídica, digite o CNPJ e o sistema consulta a Receita Federal e preenche razão social, e-mail, telefone e endereço.

Ao criar uma nova entidade, digite ou cole o CNPJ no campo CPF / CNPJ. Assim que os 14 dígitos estiverem lá, o sistema consulta a base da Receita Federal e preenche Nome / Razão Social, E-mail, Telefone e Endereço (logradouro, número, bairro, cidade, estado e CEP). Confira, ajuste o que precisar e salve.

Os dados chegam formatados: nomes com iniciais maiúsculas (conectivos como "de", "da" e "e" ficam em minúsculas), e-mail em minúsculas, telefone e CEP com a pontuação padrão. Todos os campos continuam editáveis.

Mensagens que podem aparecer durante a consulta:

- "CNPJ inválido." O número digitado não passa na validação. Confira os dígitos.
- "Este CNPJ não existe na base da Receita Federal." O número é válido, mas não há empresa registrada com ele.
- "Este documento já está cadastrado." Já existe uma entidade com esse CNPJ na sua empresa.
- "Não foi possível consultar o CNPJ agora. Preencha os dados manualmente." A consulta à Receita não respondeu. Nada fica bloqueado: preencha os campos e salve normalmente.

O preenchimento automático só acontece no cadastro de novas entidades. Ao editar uma entidade existente, nada é sobrescrito. A consulta usa um serviço público com limite de algumas consultas por minuto, então, se você cadastrar várias empresas em sequência e receber o aviso de indisponibilidade, espere um instante e tente de novo, ou preencha à mão.
