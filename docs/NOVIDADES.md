# Novidades

> Este documento reúne as atualizações do sistema na linguagem do usuário final. Ele é exibido como aviso na primeira vez que o usuário acessa o sistema após cada publicação. Cada nova atualização entra como uma seção no topo, com data.

---

## Atualização de 17 de setembro de 2026

### Financeiro › Recorrências: busca por parte do nome e edição corrigida

Dois problemas na tela de recorrências foram resolvidos:

- **Busca por parte do nome.** Antes, o campo de busca só encontrava a recorrência se você digitasse a descrição exatamente como estava cadastrada. Agora basta um trecho: "IPT" encontra "IPTU", "agua" encontra "Conta de Água". Maiúsculas, minúsculas e acentos não fazem diferença, e o resultado aparece a cada letra digitada, sem espera.
- **Editar recorrência voltou a funcionar.** Salvar alterações em uma recorrência (nome, valor, frequência, intervalo, próximo vencimento ou data final) falhava com "Erro ao atualizar recorrência" sempre que a recorrência não tinha data final ou regra de reajuste, ou seja, na maioria dos casos. Corrigido: a edição salva normalmente.
- **Criar recorrência sem preencher campos opcionais.** Pelo mesmo motivo, criar uma conta recorrente em Contas a Pagar ou Contas a Receber sem informar forma de pagamento, entidade ou origem da solicitação também falhava. Agora esses campos podem ficar em branco.

**Outras melhorias na tela**

- **Paginação com números** no lugar do botão "Carregar Mais", no mesmo padrão das demais listagens: "1–25 de 60", botões de página, setas e seletor de itens por página (25, 50 ou 100). Ao buscar ou trocar o filtro de status, a lista volta para a primeira página.
- **Contagem exata de resultados** no celular: antes mostrava "25+ resultados" quando havia mais de uma página; agora mostra o total real.
- **Data final pode ser removida.** Na edição, ao lado de "Data Final" aparece um link **Remover** quando há uma data preenchida; antes não havia como tirar uma data final depois de definida.
- **Frequência correta ao abrir a edição.** O campo Frequência podia mostrar um valor diferente do cadastrado ao abrir a janela de edição (o valor salvo estava certo, só a exibição errava). Corrigido.
- **Carregamento mais rápido.** A tela fazia duas consultas ao banco, uma para os indicadores do topo e outra para a lista; agora faz uma só, e os filtros e a busca são aplicados na hora, sem nova consulta.

### Cadastros › Entidades no mesmo padrão das outras listagens

A tela de fornecedores e clientes foi alinhada às demais listagens do sistema (Contas a Pagar, Lotes, Centros de Custo). O que muda para você:

- **Totais no cabeçalho.** Os três cartões de contagem deram lugar a uma linha logo abaixo do título: "48 entidades · 30 fornecedores · 25 clientes". Ocupa menos espaço e a lista aparece mais acima na tela. Os números agora atualizam na hora ao criar ou excluir uma entidade (antes podiam ficar defasados por alguns minutos).
- **Paginação com números.** O botão "Carregar Mais" saiu. No rodapé da lista você vê "1–25 de 132", os botões de página (1, 2, 3 … 6) com a atual destacada, setas de anterior e próxima, e um seletor de **itens por página** (25, 50 ou 100). No celular, as setas e o indicador "3 / 6". Ao buscar ou trocar de aba, a lista volta para a primeira página.
- **Busca instantânea.** O filtro por nome ou CNPJ/CPF aplica a cada letra digitada, sem espera. A busca ganhou um **X** para limpar o texto.
- **Busca e abas na mesma linha.** No computador, o campo de busca e as abas Todos / Fornecedores / Clientes ficam lado a lado; no celular, empilhados.
- **Ordenação sobre a lista inteira.** Clicar em Nome, Tipo, Categoria ou Documento ordena todas as entidades, não só as já carregadas. Cada coluna mostra o ícone de ordenação; a ativa fica destacada com a seta para cima ou para baixo.
- **Contagem de resultados** no canto direito do cabeçalho da lista, em qualquer tamanho de tela.
- **Editar e Excluir pelo teclado.** Os botões da linha, que apareciam só ao passar o mouse, agora também aparecem ao navegar com Tab.
- **Nada encontrado ficou mais útil.** Ao buscar sem resultado, há um botão **Limpar busca**. Sem nada cadastrado na aba, a mensagem indica o que falta (por exemplo, "Nenhum fornecedor cadastrado") e oferece **Criar entidade** para quem tem permissão.
- **Falha ao carregar aparece como falha.** Se a lista não puder ser carregada, você vê um aviso com **Tentar novamente**, em vez de uma lista vazia.
- **Excluir mostra o nome.** A confirmação de exclusão agora cita a entidade ("Excluir "Fornecedor X"?") e avisa que a ação não pode ser desfeita.
- **Tema escuro.** Etiquetas de Fornecedor / Cliente / Ambos e as iniciais coloridas passaram a ter versão para o tema escuro.

**Bom saber**

- O título da página passou a ser **Entidades** (antes repetia "Cadastros", que é o nome da seção).
- A coluna **Ações** só aparece para quem pode gerenciar entidades.

### Um clique na linha abre os detalhes

Abrir o registro que você está vendo em uma lista ficou mais direto: basta clicar em qualquer ponto da linha. Não é mais preciso abrir o menu de três pontos e procurar "Ver detalhes" — esse item saiu do menu, que agora guarda só as ações de fato (confirmar pagamento, editar, excluir etc.).

**Onde vale**

- **Financeiro › Contas a Pagar** e **Contas a Receber** — abre os detalhes da transação.
- **Financeiro › Lotes** — abre os detalhes do lote.
- **Cadastros › Entidades** — abre a página da entidade.
- **Centros de Custo** — abre a página do centro de custo (a seta que expande os filhos continua funcionando normalmente).
- **Feedback** (administração) — abre os detalhes do feedback.

**Bom saber**

- Marcar a caixa de seleção, usar o menu de ações ou os botões rápidos da linha (Aprovar, Autorizar, Excluir…) continua igual: essas ações não abrem os detalhes.
- No celular, tocar no cartão já abria os detalhes; o item "Ver detalhes" também saiu do menu ali.
- Pelo teclado, use Tab para chegar na linha e Enter (ou Espaço) para abrir.
- Quando seu perfil não tem nenhuma ação disponível para o registro, o menu de três pontos não aparece.

### Cadastro de entidades: preenchimento automático pelo CNPJ

Cadastrar um fornecedor ou cliente pessoa jurídica ficou mais rápido. Agora, ao criar uma nova entidade, basta digitar ou colar o CNPJ no campo **CPF / CNPJ** e o sistema consulta a base da Receita Federal e preenche automaticamente:

- **Nome / Razão Social**
- **E-mail**
- **Telefone**
- **Endereço** (logradouro, número, bairro, cidade, estado e CEP)

Os dados chegam já formatados: nomes com iniciais maiúsculas (mantendo conectivos como "de", "da", "e" em minúsculas), e-mail em minúsculas, telefone e CEP com a pontuação padrão.

**Como funciona**

1. Abra **Cadastros › Entidades** e clique em **Nova Entidade**.
2. Digite ou cole o CNPJ. A consulta começa sozinha assim que os 14 dígitos são informados.
3. Confira os campos preenchidos, ajuste o que precisar e salve.

**O que você pode ver durante a consulta**

- **"CNPJ inválido."** — o número digitado não é um CNPJ válido. Verifique os dígitos.
- **"Este CNPJ não existe na base da Receita Federal."** — o número é válido, mas não há empresa registrada com ele.
- **"Este documento já está cadastrado."** — já existe uma entidade com esse CNPJ na sua empresa.
- **"Não foi possível consultar o CNPJ agora. Preencha os dados manualmente."** — a consulta à Receita não respondeu. Nada foi bloqueado: preencha os campos normalmente e salve.

**Bom saber**

- O preenchimento automático acontece apenas no cadastro de **novas** entidades. Ao editar uma entidade existente, seus dados não são sobrescritos.
- Todos os campos preenchidos continuam editáveis: você pode corrigir ou complementar qualquer informação antes de salvar.
- A consulta usa um serviço público com limite de algumas consultas por minuto. Se você cadastrar várias empresas em sequência e receber o aviso de indisponibilidade, aguarde um instante e tente novamente, ou preencha manualmente.
