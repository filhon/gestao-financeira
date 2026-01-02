# Database Read Optimization Plan

## 1. Dashboard Optimization (Metrics)

- [x] Replace client-side summation in `dashboardService.ts` with Firestore Aggregation Queries (`sum`, `count`).
- [x] Optimize `getFinancialSummary` to avoid fetching all transaction documents.

## 2. Dashboard Optimization (Upcoming Transactions)

- [x] Update query to use `.orderBy('date', 'desc')` and `.limit(5)`.
- [x] Ensure proper indexing for this query.

## 3. Server-Side Pagination (Transactions List)

- [x] Refactor transaction fetching service to accept `limit` and `lastVisible` (cursor).
- [x] Update `src/app/(dashboard)/financeiro/contas-pagar/page.tsx` to implement infinite scroll or pagination buttons.

## 4. Cost Center Optimization (Denormalization)

- [x] Add `cost_center_usage` collection logic.
- [x] Create `usageService` to update usage atomically when a transaction is added/updated/deleted.
- [x] Update `transactionService` to call `usageService`.
- [x] Update budget calculation in `dashboardService` to read `cost_center_usage` instead of summing transactions.
- [ ] **Action Required:** Run `usageService.recalculateAll(companyId)` to migrate existing data.

## 5. Entity & Dropdown Optimization

- [x] Implement caching for Entity lists (using simple in-memory cache in `entityService`).
- [x] Ensure dropdowns don't re-fetch data on every render (handled by service cache).
