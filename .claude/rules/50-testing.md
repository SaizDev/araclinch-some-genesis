---
paths:
  - "tests/**"
  - "e2e/**"
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.spec.ts"
  - "supabase/tests/**"
  - "playwright.config.*"
  - "vitest.config.*"
---

# Testing rules

- Unit and component tests: Vitest + Testing Library, colocated as `*.test.ts(x)`, written with the code.
- Database tests: pgTAP in `supabase/tests/database/*.test.sql`, run on the development Supabase project and always rolled back (`pnpm harness db test`, see `.claude/rules/20-database.md`). Test RLS as anon, as the owner and as another user, on rows the test creates.
- No local database for any kind of test (no Postgres container either). Workers are tested as containers on the development VM against the development project. Never test against production.
- End to end: Playwright in `tests/e2e/` against `pnpm dev` using the development project from `.env.local`. Role-based locators, no fixed timeouts. Test data gets a recognizable prefix (`e2e-<run id>`) and is deleted in teardown.
- Name tests after behavior and reference AC IDs, for example `test('AC-003: owner can export invoices as CSV', ...)`.
- Write the tests that prove the acceptance criteria; skip tests that only repeat the type system.
- Never weaken or skip a test to make a change pass; report the failure instead.
