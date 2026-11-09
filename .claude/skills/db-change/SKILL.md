---
name: db-change
description: Make a database schema change inside an approved spec - the spec change script in supabase/changes, RLS, pgTAP tests, applied to the development project, types regenerated. Use for any schema, policy, function or seed change.
argument-hint: <spec-id> <description of the database change>
---

# /db-change

Arguments: $ARGUMENTS

!`node .claude/harness/harness.mjs db status 2>&1 || true`

Rules: `.claude/rules/20-database.md`. No local database, no Docker, no migration history.

## Steps
1. The spec gate must be open (`node .claude/harness/harness.mjs spec status <id>`). No spec, no schema change.
2. Delegate to the database owner of this profile (`.claude/rules/00-delegation.md`: `database-architect`, or `backend-engineer` when it is off), with the steps below in the brief. Inputs: `migrations/schema.sql` (production schema), the change script if it exists, related DAL code.
3. The owner writes or extends `supabase/changes/<id>-<slug>.sql`: the whole change for this spec, with RLS and policies for every new table. To know what exists, read `migrations/schema.sql` (production) or query the development project with `execute_sql` (read queries).
4. Apply it to development: `mcp__supabase__execute_sql` with `-- devharness:apply <id>`. On error nothing was applied: fix and apply again.
5. Regenerate types: `mcp__supabase__generate_typescript_types`, write the result to `src/types/database.types.ts`.
6. Tests: pgTAP in `supabase/tests/database/`, then `pnpm harness db test` and send the printed reference with `mcp__supabase__execute_sql`. Success: `failed=0` and `file_errors=0`.
7. Security advisors on development: `get_advisors` (supabase server). Fix what they report for the new objects.
8. Report: the script path, what changed, follow-ups for server or UI code.

Production gets this script only through `/spec-ship`, after the human tested and typed `send to production`.
