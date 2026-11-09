---
status: superseded by 0007
date: 2026-01-01
deciders: harness baseline
---

# 0003: SQL migrations as the schema source of truth, with generated portability artifacts

> Superseded by [0007](0007-dev-and-prod-projects-change-scripts.md): the harness no longer keeps a migration history or generated `db/` artifacts.

## Context
The database must be transportable to another SQL service if needed. Schema changes are written by agents and reviewed by humans. Options were imperative migrations, Supabase declarative schemas (diff-generated migrations, pg-delta engine still experimental) and an ORM schema (Drizzle).

## Options considered
| Option | Pros | Cons |
|---|---|---|
| Hand-written SQL migrations + generated master schema and export artifacts | Plain SQL replays on any Postgres; explicit review of every change; deterministic artifacts for other engines | Current state must be generated (solved by `pnpm db:sync`) |
| Declarative schema files, generated migrations | Current state readable in one place | Diff tool gaps (DML, grants, policies alterations, comments...) need manual migrations anyway; experimental engine |
| Drizzle ORM schema | Typed schema in TypeScript | Extra layer; friction with RLS and supabase-js; schemas are dialect-specific anyway |

## Decision
`supabase/migrations/*.sql` (forward-only, immutable once committed) is the source of truth. `pnpm db:sync` regenerates, from an in-memory Postgres (PGlite) built from those migrations with a Supabase shim, with no Docker and no remote database:
- `db/schema/master-schema.sql` (the master schema), `db/schema/schema.dbml` and `db/schema/portable/{mysql,sqlserver,sqlite}.sql`;
- `db/export/queries/*.sql` plus `db/export/manifest.json` (portable per-table export queries in foreign-key load order);
- `db/portability/supabase-dependencies.md` (inventory of Supabase-specific constructs);
- `src/types/database.types.ts` and a fingerprint (`db/schema/.migrations-hash`).
CI (`pnpm db:check`) fails when the committed artifacts differ from the migrations. Hooks enforce naming, immutability, RLS and other rules on migration files.

## Consequences
- Positive: portable schema history, always-current master schema, ready export path, measurable lock-in.
- Negative: the offline build runs Postgres 18 with a shim of the Supabase platform, not Supabase itself; CI therefore also validates migrations, seed and pgTAP tests on a real Supabase stack on the GitHub runner.
- Neutral: no local Supabase stack and no Docker on developer machines. Running the app locally uses a hosted Supabase project, and database tests run on it in rolled-back transactions (ADR 0006).
- Security: RLS is mandatory for exposed tables and tested with pgTAP.
