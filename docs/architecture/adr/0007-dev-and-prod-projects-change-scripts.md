---
status: accepted
date: 2026-10-09
deciders: harness baseline
---

# 0007: Development and production projects, one change script per spec, production schema snapshot

## Context
The previous model (ADR 0003) kept a migration history in `supabase/migrations`, regenerated `db/` artifacts after every change with an in-memory Postgres, and deployed migrations to production through a GitHub Actions workflow. In practice it produced many files, extra tooling (PGlite), a CI dependency, and agents that asked for more environments to test against. The human wants: a development project for building and testing, a production project, one approval to put a tested change live, and the final production schema as a plain SQL file.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| Keep migration history + CI deploys (ADR 0003) | Full history in the database | Many files, CI and secrets needed, local tooling |
| Supabase branching | Isolated preview databases | Paid feature, another environment per branch |
| Two projects, one change script per spec, released by the harness after the human's approval, schema snapshot after each release | Few files, no CI, no local database, the human tests exactly what goes live | No per-migration history in the database (git keeps the scripts and the snapshots) |

## Decision
1. Two Supabase projects. Development: agents apply change scripts and run rolled-back tests through the `supabase` MCP server. Production: read-only for agents (`supabase-prod`), written only through `supabase-release`.
2. Each spec that changes the schema has one script, `supabase/changes/<id>-<slug>.sql`, applied as one `DO` block (one transaction). The `mcp-guard` hook swaps the reference `-- devharness:apply <id>` for the script; ad-hoc DDL and `apply_migration` are denied.
3. The human tests on development (`pnpm dev`), then types `send to production`. The `chat-approval` hook records the approval with the hash of the script. `-- devharness:release <id>` on `supabase-release` applies the same script to production only while the hash matches (24 hours). The bash guard lets the merge into `main` and the push through only while an approval is valid.
4. After the release, `-- devharness:schema-snapshot` on `supabase-prod` runs a catalog query (`.claude/harness/sql/schema-snapshot.sql`) and a PostToolUse hook writes `migrations/schema.sql`: the SQL that recreates the application schema on an empty project. No data dump. It lives outside `supabase/migrations` so the Supabase CLI never treats it as a migration.
5. GitHub Actions are not part of the delivery path. The full profile keeps one CI quality job (lint, typecheck, tests, build) as a second check.

## Consequences
- Positive: one script per change, no CI secrets, no local database, the snapshot is always the real production schema, the human approves exactly what was tested.
- Negative: scripts must be written to apply on top of the current production schema and stay backward compatible with the code in production (add first, remove later). There is no migration table in the database.
- Neutral: `supabase/changes/` and the snapshots in git are the audit trail.
