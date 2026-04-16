# gestao-financeira — CLAUDE.md

Multi-tenant Brazilian financial management SaaS (FinControl). Always consider multi-tenancy (`companyId` isolation), Brazilian financial conventions, and the 6-role RBAC system when making changes.

## Commands

```bash
npm run dev      # Start dev server (Next.js)
npm run build    # Production build
npm run lint     # ESLint
```

No test suite configured.

## Architecture

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript 5 (strict mode)
- **Styling**: Tailwind CSS 4 + shadcn/ui (New York style, Radix UI primitives)
- **Backend**: Firebase (Firestore, Auth, Storage, Cloud Functions via Admin SDK)
- **State**: Zustand (UI/session state) + React Query (server state)
- **Forms**: React Hook Form + Zod validation
- **Export**: jsPDF + jspdf-autotable, ExcelJS, PapaParse
- **Email**: Resend + React Email templates
- **AI**: Google GenAI (intent parser, document extraction)

## Multi-Tenancy & RBAC

Every Firestore document includes `companyId` for tenant isolation. Users have a global `role` + a `companyRoles: { [companyId]: role }` map.

**6 roles**: `admin`, `financial_manager`, `approver`, `releaser`, `auditor`, `user`

Firebase Custom Claims mirror roles for fast Firestore rule evaluation (DB fallback when claims are stale).

**Transaction workflow**: `draft → pending_approval → approved → pending_authorization → authorized → paid | rejected`

## Key Conventions

### File naming

- Services: `src/lib/services/*Service.ts`
- Stores: `src/lib/store/use*Store.ts`
- Validations: `src/lib/validations/*.ts` (Zod schemas)
- Types: `src/lib/types/index.ts`
- Pages: `src/app/(dashboard)/<section>/page.tsx`
- Feature components: `src/components/features/<domain>/`

### Services

Export a plain object with async methods. Never use classes.

```ts
export const myService = {
  async getAll(companyId: string) { ... },
  async create(data: CreateInput) { ... },
};
```

- Filter every Firestore query by `companyId`
- Convert `Timestamp → Date` on read: `(doc.createdAt as Timestamp)?.toDate()`
- Use `serverTimestamp()` for new timestamps on write
- Strip `undefined` fields before writing to Firestore (helper: `stripUndefined()`)
- Use `writeBatch()` for atomic multi-document updates

### Zustand stores

Plain `create<State>()` — no middleware unless persistence is needed.

```ts
interface MyState {
  items: Item[];
  setItems: (items: Item[]) => void;
}
export const useMyStore = create<MyState>((set) => ({ ... }));
```

### Components

- Functional components only
- Radix UI + shadcn/ui for all base UI (`src/components/ui/`)
- `sonner` for toasts
- `date-fns` with `ptBR` locale for all date formatting
- Always use `currency.js` for monetary values — never raw floats

### Firestore collections

`transactions`, `users`, `companies`, `payment_batches`, `cost_centers`, `entities`, `recurring_templates`, `audit_logs`, `notifications`, `budgets`, `api_keys`, `reconciliation_sessions`, `company_stats`

## Environment Variables

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_DEV_FALLBACK_EMAIL=   # redirects all emails in dev
RESEND_API_KEY=
EMAIL_FROM_DOMAIN=
EMAIL_ENABLED=true
```

## Project Structure

```
src/
├── app/
│   ├── (auth)/                   # Login, company setup
│   ├── (dashboard)/
│   │   ├── financeiro/           # Payables, receivables, batches, reconciliation, recurring
│   │   ├── cadastros/            # Entities, companies
│   │   ├── centros-custo/        # Cost center hierarchy
│   │   ├── configuracoes/        # Users, audit, API keys
│   │   ├── dashboard/            # KPIs & charts
│   │   └── relatorios/           # Report export
│   └── api/
│       ├── v1/                   # Public API (HMAC-SHA256 auth + rate limiting)
│       └── internal/             # Internal endpoints
├── components/
│   ├── features/                 # Business-logic components by domain
│   ├── layout/                   # Sidebar, header, breadcrumbs
│   ├── ui/                       # shadcn/ui base components
│   ├── providers/                # Auth, Theme, Company, Query providers
│   └── emails/                   # Email templates (React Email)
├── lib/
│   ├── firebase/                 # client.ts (browser SDK), admin.ts (server SDK)
│   ├── services/                 # ~22 business logic services
│   ├── api/                      # HMAC auth, rate limiting, sanitization
│   ├── validations/              # Zod schemas
│   ├── types/                    # TypeScript interfaces & enums
│   ├── store/                    # Zustand stores
│   └── utils.ts
├── hooks/                        # Custom React hooks
└── ofx-js.d.ts                   # Type declarations for OFX parsing

functions/src/index.ts            # Cloud Functions + scheduled jobs (2 AM BRT daily)
firestore.rules                   # Row-level security (RBAC enforced here)
```
