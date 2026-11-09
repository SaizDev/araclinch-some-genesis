# Database changes

Owner: database-architect (backend-engineer in profiles without it). Rules: `.claude/rules/20-database.md`. Decision: ADR 0007.

## Build (development project)
1. Write `supabase/changes/<spec-id>-<slug>.sql` (one script per spec, re-applicable on development).
2. Apply it: `mcp__supabase__execute_sql` with `-- devharness:apply <id>` (one transaction; on error nothing is applied).
3. Types: `mcp__supabase__generate_typescript_types` into `src/types/database.types.ts`.
4. Tests: `pnpm harness db test` (add `--with <id>` to test the script before applying it), then send the printed reference with `mcp__supabase__execute_sql`. The run always rolls back.

## Release (production project)
1. The human tests the feature locally against development, then types `send to production`.
2. `mcp__supabase-release__execute_sql` with `-- devharness:release <id>`: the same script, one transaction, only if it has not changed since the approval.
3. Merge into `main` and push (then the changed workers are deployed to production Fly apps; the web app per its host, not decided yet).
4. `/db-snapshot` saves the production schema to `migrations/schema.sql`; commit it.

Order: the database goes live a minute before the code, so scripts must work with the code already in production (expand first; drop or rename in a later spec).

## Rollback
- A failed release changes nothing (one transaction).
- A released change is undone by a new spec with a script that reverses it, through the same flow.
- Data loss: Supabase backups or point-in-time recovery (dashboard > Database > Backups), by the human.

## Recreate the schema elsewhere
Run `migrations/schema.sql` on an empty Supabase project (SQL editor or `psql`), then load data separately. It contains schemas, extensions, types, tables, constraints, indexes, functions, views, triggers, RLS, policies, grants and comments of the application (not the Supabase platform schemas).
