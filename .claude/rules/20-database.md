---
paths:
  - "supabase/**"
  - "migrations/**"
  - "src/types/database.types.ts"
  - "src/server/dal/**"
---

# Database rules

Two Supabase projects, no local database, no Docker, no migration history:

| Project | MCP server | Agents may |
|---|---|---|
| Development | `supabase` | read and write data, apply change scripts, run tests |
| Production | `supabase-prod` (read-only) | read, advisors, schema snapshot |
| Production | `supabase-release` | only `-- devharness:release <id>` after the human typed `send to production` |

## Change scripts

- One script per spec that changes the schema: `supabase/changes/<spec-id>-<slug>.sql`. It holds everything that spec changes (tables, RLS, policies, functions, grants), written to run once on top of what is already in production. Use `if not exists` / `or replace` where it helps, so applying it again to development after an edit is harmless.
- Apply it to development: `mcp__supabase__execute_sql` with the query `-- devharness:apply <id>`. The hook sends the script as one transaction: all or nothing. Ad-hoc DDL and `apply_migration` are denied.
- Then regenerate types: `mcp__supabase__generate_typescript_types`, saved to `src/types/database.types.ts`.
- No `BEGIN`/`COMMIT`, no `CONCURRENTLY`, no `VACUUM` (the script runs inside one transaction).
- Every table in `public`: `enable row level security` in the same script, explicit policies per operation with `to authenticated|anon` and ownership predicates using `(select auth.uid())`. UPDATE policies need `using` and `with check`.
- Views: `with (security_invoker = true)`. `security definer` functions: `set search_path = ''`, fully qualified names, in the `private` schema.
- Destructive statements need `-- harness:allow-destructive <reason>` and a note in the spec.
- Index foreign keys and RLS predicate columns. `timestamptz`, `uuid` or `bigint identity` keys, `text` with check constraints, `numeric` for money.
- Once a spec is released, its script is frozen: later changes need a new spec.
- Seeds are fake and idempotent. Never copy production data into development, seeds or tests.

## Release and snapshot

1. The human tests on development and types `send to production`. The hook records the hash of the script; any later edit invalidates the approval.
2. `mcp__supabase-release__execute_sql` with `-- devharness:release <id>`: the same script, one transaction, on production.
3. `/spec-ship` sets the spec to `released`, merges the branch into `main`, pushes and deploys the changed workers.
4. `/db-snapshot`: `mcp__supabase-prod__execute_sql` with `-- devharness:schema-snapshot`. The hook saves the production schema (no data) to `migrations/schema.sql`. That file recreates the whole schema on an empty project; git keeps its history.

## Database tests (development project, always rolled back)

- pgTAP files in `supabase/tests/database/*.test.sql` (`begin; select plan(n); ... select * from finish(); rollback;`).
- `pnpm harness db test [filter]` builds the run (`--with <spec-id>` also applies that spec's change script inside the run, to test it before applying). Send the printed reference (`-- devharness:db-test <id>`) with `mcp__supabase__execute_sql`.
- The call always ends in an error starting with `DEVHARNESS_DB_TEST_RESULT passed=.. failed=.. file_errors=..`: that rolls everything back. Success means `failed=0` and `file_errors=0`.
- Tests create their own rows with fixed UUIDs and assert only on them.
