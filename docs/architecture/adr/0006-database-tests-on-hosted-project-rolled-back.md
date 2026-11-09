---
status: accepted
date: 2026-10-06
deciders: harness baseline
---

# 0006: Database tests run on the hosted project, always rolled back

> Amended by [0007](0007-dev-and-prod-projects-change-scripts.md): the tests now run on the development project through its own `supabase` MCP server; there is no `supabase-test` server and no CI database job.

## Context
The harness has no local database and no Docker (ADR 0003). Database tests still need a real Supabase Postgres: platform roles, `auth` functions, extensions and RLS behave there as they do in production. A local Supabase stack would bring Docker back onto every machine.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| Local Supabase stack (`supabase start`, Docker) | Real platform, isolated | Docker on every machine; heavy; drifts from hosted settings |
| In-memory Postgres (PGlite) with a platform shim | No setup | Not the real platform; Postgres version differs; a second test environment to maintain |
| Hosted project through the MCP, in a transaction that is always rolled back | Real platform and real settings; no local setup; nothing stays | Runs where real data lives; needs a read-write MCP connection and strict guards |

## Decision
Database tests (pgTAP files in `supabase/tests/database/`) run on the hosted project:
1. `pnpm harness db test --after <latest applied migration>` builds one PL/pgSQL `DO` block containing the migrations the project does not have yet and every test file. Each statement runs through `EXECUTE`, which cannot commit; each test file runs in its own savepoint; the block ends by raising an exception that carries the TAP results. Postgres therefore rolls back everything: pending migrations, test rows, pgTAP itself, on success and on failure.
2. The run is stored under `.claude/harness/state/db-tests/`. A second, read-write MCP server (`supabase-test`) accepts only a reference to a stored run: the `mcp-guard` hook swaps in the stored text and denies every other call. The everyday `supabase` server stays read-only.
3. The builder refuses constructs that could act outside the transaction (`dblink`, `pg_background`, `COPY ... PROGRAM`, `ALTER SYSTEM`, `pg_net`, `http`). Runs set `lock_timeout` 5 s and `statement_timeout` 120 s.
4. Docker, `supabase start`, `supabase test db` and local Postgres are blocked by the bash guard. CI keeps its own Supabase stack on GitHub's machines as an extra safety net.

## Consequences
- Positive: tests exercise the real platform; no local setup; no residue in the project.
- Negative: tests run where real data lives. They must create their own rows, assert only on them and never print personal data. A run takes short locks on the tables its migrations change.
- Neutral: schema changes still reach the project only through migration files and the approved `db-deploy` workflow.
- Security: the read-write MCP is limited by the hook to harness-built runs; it is not added to `.mcp.json` while the `mcp-guard` check is off.
