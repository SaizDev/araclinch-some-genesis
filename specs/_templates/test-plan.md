---
spec: "{{id}}"
title: "Test plan: {{title}}"
owner: qa-engineer
updated: {{date}}
---
<!-- harness:template -->
<!-- Author: qa-engineer. Remove the marker when complete. Every in-scope AC needs at least one automated test. -->

# Test plan: {{title}}

## 1. Scope
- In scope:
- Out of scope:

## 2. Levels
| Level | Tool | Location | Owner |
|---|---|---|---|
| Unit / component | Vitest + Testing Library | colocated `*.test.ts(x)` | code owners |
| Database / RLS | pgTAP on the hosted project through the MCP, always rolled back (`pnpm harness db test`) | `supabase/tests/database/` | database-architect, qa-engineer |
| End to end | Playwright | `tests/e2e/` | qa-engineer |
| Accessibility | axe + keyboard | `tests/e2e/` | qa-engineer |

## 3. Traceability matrix
| AC | Test ID | Level | File | Status |
|---|---|---|---|---|
| AC-001 | T-AC001-1 | e2e | `tests/e2e/example.spec.ts` | planned |

## 4. Test data and fixtures
<!-- Seeded users per role, factories, cleanup strategy. No production data. -->

## 5. Environments
- Database: rolled-back test runs on the hosted project (no local database). Tests create their own rows and assert only on them.
- App and e2e: `pnpm dev` with `.env.local` pointing at the hosted project (or `pnpm build && pnpm start`); e2e data uses a recognizable prefix and is deleted in teardown.
- CI: `.github/workflows/ci.yml`

## 6. Entry and exit criteria
- Entry: tasks implemented, local stack running.
- Exit: all in-scope ACs pass, no open high-severity defects, flaky tests addressed.

## 7. Risks and special cases
<!-- Concurrency, time zones, large data, permissions, offline, browser differences. -->
