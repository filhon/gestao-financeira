# Novidades

> Este documento reúne as atualizações do sistema na linguagem do usuário final. Ele é exibido como aviso na primeira vez que o usuário acessa o sistema após cada publicação. Cada nova atualização entra como uma seção no topo, com data.

---

## Atualização de 17 de setembro de 2026

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
