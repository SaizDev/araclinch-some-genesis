# Architecture overview

Owner: solution-architect. Living document: update it when an ADR changes the baseline.

## System context

```mermaid
flowchart LR
  user[Brand team browser] -->|HTTPS| web[Next.js 16 web app, host to be decided]
  web -->|DAL, Server Actions, RLS| supa[(Supabase: Postgres, Auth, Storage, Vault)]
  web -->|enqueue jobs| boss[[pg-boss in Postgres]]
  cron[pg_cron] -->|due posts| boss
  boss --> media[worker-media] & agent[worker-agent] & render[worker-render] & disc[worker-discovery] & pub[worker-publish] & ana[worker-analytics]
  media & agent & render & disc & pub & ana --> supa
  agent -->|Claude Agent SDK, Veo or Kling, ElevenLabs| ext1((AI providers))
  disc -->|Apify, YouTube Data API, yt-dlp| ext2((Sources))
  pub & ana -->|Graph API, Marketing API| meta((Meta))
```

Workers run on Fly.io (`fra`) in production and in Docker on the development VM during development (ADR 0009); they never call each other. Full specification: `system-spec.md`.

## Layers

| Layer | Location | Responsibility | May import |
|---|---|---|---|
| Routes and UI | `src/app`, `src/components` | Rendering, interaction, composition | `src/components`, `src/lib` (client-safe), Server Actions, DAL (Server Components only) |
| Server Actions | `src/server/actions` | Validate, authorize, execute, revalidate | services, DAL, validation |
| Data access layer | `src/server/dal` | Authorized reads and writes returning DTOs | Supabase server client, auth helpers |
| Services | `src/server/services` | Business rules, integrations; framework-free where practical | DAL, external SDKs |
| Auth helpers | `src/server/auth` | Current user from verified claims, permission checks | Supabase server client |
| Supabase clients | `src/lib/supabase` | SSR clients for server, browser and proxy | `@supabase/ssr` |
| Proxy | `src/proxy.ts` | Session refresh, optimistic redirects, security headers and CSP nonce | Supabase proxy helper |
| Workers | `workers/<name>` | Long jobs, one Fly.io app each | `packages/*`, `workers/base` |
| Shared packages | `packages/contracts`, `queue`, `providers` | Payloads, queue client, provider adapters | other packages |
| Database | `supabase/changes`, `migrations/schema.sql` | Schema, RLS, constraints, indexes | |

## Key decisions

| ADR | Decision |
|---|---|
| [0001](adr/0001-record-architecture-decisions.md) | Record architecture decisions as ADRs |
| [0002](adr/0002-stack-nextjs-supabase-fly-workers.md) | Next.js 16 + Supabase for the web app, workers on Fly.io, web host to be decided |
| [0003](adr/0003-sql-migrations-as-source-of-truth.md) | Superseded by 0007 |
| [0004](adr/0004-authorization-defense-in-depth.md) | Authorization in the DAL and in Postgres RLS |
| [0005](adr/0005-spec-first-agent-team.md) | Spec-first delivery by a Claude Code agent team with enforced delegation |
| [0006](adr/0006-database-tests-on-hosted-project-rolled-back.md) | Database tests on the hosted (development) project, always rolled back |
| [0007](adr/0007-dev-and-prod-projects-change-scripts.md) | Development and production projects, one change script per spec, production schema snapshot |
| [0008](adr/0008-workers-on-fly-with-pg-boss.md) | Workers on Fly.io, communicating only through pg-boss |
| [0009](adr/0009-docker-vm-for-development.md) | Workers run in Docker on a development VM, reached through a Docker context |

## Cross-cutting concerns

- **Security:** `docs/security/security-baseline.md`.
- **Performance budgets and other NFRs:** `specs/product/nfr.md`.
- **Portability:** `migrations/schema.sql` recreates the production schema on any empty Supabase project; data is moved separately.
- **Operations:** `docs/runbooks/`.
