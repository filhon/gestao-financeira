# Sistema de Gestão Financeira (Multi-Empresa)

Uma plataforma completa de gestão financeira desenvolvida com **Next.js 16**, **TypeScript** e **Firebase**, projetada para controlar múltiplos CNPJs (Holding), gerenciar centros de custo hierárquicos, aprovações de pagamentos e relatórios gerenciais em tempo real.

## 🚀 Funcionalidades Principais

### 🏢 Gestão Multi-Empresa & Segurança
- **Multi-CNPJ**: Gerencie múltiplas empresas (Holding) em uma única interface.
- **Controle de Acesso (RBAC)**:
    - **Admin**: Acesso total.
    - **Gerente Financeiro**: Gestão operacional completa.
    - **Aprovador**: Aprova despesas de seus centros de custo.
    - **Pagador (Releaser)**: Realiza a baixa (pagamento) de transações aprovadas.
    - **Auditor**: Apenas visualização.
- **Log de Auditoria**: Rastreabilidade completa de ações (quem fez, quando e o que mudou).

### 💰 Gestão Financeira
- **Contas a Pagar e Receber**: Controle total de fluxo de caixa.
- **Parcelamento e Recorrência**: Criação automática de parcelas e gestão de assinaturas/mensalidades.
- **Lotes de Pagamento (Batches)**: Agrupamento de transações para aprovação e pagamento em massa.
- **Rateio de Custos**: Distribuição de uma despesa entre múltiplos centros de custo.
- **Anexos**: Upload de comprovantes e documentos fiscais.

### 📊 Painéis e Relatórios (BI)
- **Dashboard Executivo**: KPIs em tempo real (Receita, Despesa, Saldo, Pendências).
- **Gráficos Interativos**: Fluxo de Caixa (6 meses) e Distribuição por Centro de Custo.
- **Relatórios Exportáveis**:
    - **Fluxo de Caixa (PDF)**: Extrato detalhado.
    - **DRE Gerencial (PDF)**: Visão de resultado operacional.
    - **Exportação CSV/Excel**: Dados brutos para análise externa.

### ⚙️ Cadastros e Configurações
- **Centros de Custo Hierárquicos**: Estrutura em árvore (Pai/Filho) com orçamentos anuais.
- **Entidades (CRM)**: Cadastro unificado de Clientes e Fornecedores com dados bancários.
- **Usuários**: Convite e gestão de permissões por empresa.
- **Perfil do Usuário**: Visão centralizada de tarefas e responsabilidades.

### 🛠️ Recursos Avançados
- **Busca Global**: Pesquise transações, entidades ou páginas de qualquer lugar.
- **Notificações**: Alertas em tempo real para aprovações e vencimentos.
- **Modo Escuro (Dark Mode)**: Suporte nativo a temas (Claro/Escuro).
- **Layout Responsivo**: Interface otimizada para desktops e tablets.

---

## 💻 Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router)
- **Linguagem**: [TypeScript](https://www.typescriptlang.org/)
- **Estilização**: [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
- **Backend / Database**: [Firebase](https://firebase.google.com/) (Firestore, Auth, Storage)
- **Gerenciamento de Estado**: [Zustand](https://github.com/pmndrs/zustand)
- **Formulários**: [React Hook Form](https://react-hook-form.com/) + [Zod](https://zod.dev/)
- **Gráficos**: [Recharts](https://recharts.org/)
- **Relatórios**: [jsPDF](https://github.com/parallax/jsPDF) + [jspdf-autotable](https://github.com/simonbengtsson/jsPDF-AutoTable)
- **Ícones**: [Lucide React](https://lucide.dev/)

---

## 🏁 Como Iniciar

### Pré-requisitos
- Node.js 18+ instalado.
- Conta no Firebase configurada.

### Instalação

1. **Clone o repositório:**
   ```bash
   git clone https://github.com/seu-usuario/gestao-financeira.git
   cd gestao-financeira
   ```

2. **Instale as dependências:**
   ```bash
   npm install
   # ou
   yarn install
   ```

3. **Configure as Variáveis de Ambiente:**
   Crie um arquivo `.env.local` na raiz do projeto com suas credenciais do Firebase:
   ```env
   NEXT_PUBLIC_FIREBASE_API_KEY=seu_api_key
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=seu_auth_domain
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=seu_project_id
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=seu_storage_bucket
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=seu_messaging_sender_id
   NEXT_PUBLIC_FIREBASE_APP_ID=seu_app_id
   ```

4. **Execute o servidor de desenvolvimento:**
   ```bash
   npm run dev
   ```

5. **Acesse:** Abra [http://localhost:3000](http://localhost:3000) no seu navegador.

---

## 📂 Estrutura do Projeto

```
src/
├── app/                  # Rotas e Páginas (App Router)
│   ├── (auth)/          # Rotas de Autenticação (Login, Registro)
│   ├── (dashboard)/     # Rotas Protegidas (Painel Principal)
│   └── api/             # API Routes (se necessário)
├── components/           # Componentes Reutilizáveis
│   ├── features/        # Componentes específicos de negócio (Financeiro, CRM, etc)
│   ├── layout/          # Layouts (Sidebar, Header)
│   ├── providers/       # Context Providers (Auth, Theme, Company)
│   └── ui/              # Componentes Base (Botões, Inputs, Cards)
├── lib/                  # Lógica de Negócio e Utilitários
│   ├── firebase/        # Configuração do Firebase
│   ├── services/        # Camada de Serviço (Chamadas ao Banco de Dados)
│   ├── validations/     # Schemas de Validação (Zod)
│   └── utils.ts         # Funções auxiliares
└── styles/               # Estilos Globais
```

---

## 🔐 Níveis de Acesso (Detalhado)

| Perfil | Descrição |
| :--- | :--- |
| **Admin** | Acesso total a todas as configurações e dados de todas as empresas. |
| **Gerente Financeiro** | Pode criar, editar e excluir transações, gerenciar entidades e visualizar relatórios. |
| **Aprovador** | Responsável por validar despesas lançadas em seus Centros de Custo. Não pode pagar. |
| **Pagador (Releaser)** | Responsável por efetivar o pagamento (baixa) de despesas já aprovadas. |
| **Auditor** | Acesso somente leitura a todos os dados para conferência. |

---

## 📄 Licença

Este projeto é privado e proprietário. Todos os direitos reservados.
