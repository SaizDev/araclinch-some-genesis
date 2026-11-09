---
name: db-snapshot
description: Save the current production database schema (no data) to migrations/schema.sql after a release. Use after every database release, or when the human asks for the production schema.
---

# /db-snapshot

!`node .claude/harness/harness.mjs db status 2>&1 || true`

1. Call `mcp__supabase-prod__execute_sql` with exactly this query:
   ```
   -- devharness:schema-snapshot
   ```
   The hook swaps in a read-only catalog query. The result is the SQL that recreates the application schema (schemas, extensions, types, sequences, tables, constraints, indexes, functions, views, triggers, RLS, policies, grants, comments). No data.
2. The hook saves it to `migrations/schema.sql` and tells you the number of lines. Do not print the file or rewrite it.
3. If the hook says it could not save it, write the text between `-- DEVHARNESS_SCHEMA_BEGIN` and `-- DEVHARNESS_SCHEMA_END` to `migrations/schema.sql` yourself.
4. Tell the human in one line, and commit it (`chore(db): production schema snapshot`) when commits are part of the current task.

`migrations/schema.sql` is the reference for what production has. To recreate the database on a new project: run it on an empty Supabase project, then load data separately.
