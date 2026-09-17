# Novidades

> Este documento reúne as atualizações do sistema na linguagem do usuário final. Ele é exibido como aviso na primeira vez que o usuário acessa o sistema após cada publicação. Cada nova atualização entra como uma seção `## Atualização de <d de mês de aaaa>` no topo. Dentro dela, cada `###` é uma novidade: o primeiro parágrafo é o resumo que aparece na janela; o restante fica escondido atrás de "Saiba mais".

---

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
