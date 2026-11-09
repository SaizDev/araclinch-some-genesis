# Database change scripts

One SQL script per spec that changes the schema: `<spec-id>-<slug>.sql` (for example `004-invoice-export.sql`). There is no migration history.

1. The database owner writes the script and applies it to the **development** project through the MCP (`-- devharness:apply <id>`). It runs as one transaction: all or nothing. Editing and applying again is fine while the spec is being built, so write it to be re-applicable (`if not exists`, `create or replace`, `drop policy if exists`).
2. The human tests on development and types `send to production`.
3. The same script is released to the **production** project (`-- devharness:release <id>`), again as one transaction, and only if it has not changed since the human's approval.
4. `migrations/schema.sql` is refreshed from production.

Rules: RLS on every table in `public`, no `BEGIN`/`COMMIT`, no `CONCURRENTLY`, backward compatible with the code already in production. Once its spec is released, a script is frozen: later changes belong to a new spec. Details: `.claude/rules/20-database.md`.

`000-foundation.sql` holds the baseline (private schema, helper functions) shared by every project.
