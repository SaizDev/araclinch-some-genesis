# AGENTS.md: project guide

Tool-agnostic guide for any coding agent and for humans. Claude Code reads it through `CLAUDE.md`.
When `next dev` runs (Next.js 16.3+), it appends a managed block at the end of this file that points agents to the version-matched docs in `node_modules/next/dist/docs/`. Keep that block and commit it.

## What this is

The Instagram content system for one brand: generate content from its library, discover competitor content, schedule and publish (optionally as an ad). Full specification: `docs/architecture/system-spec.md`.

## Stack

| Layer | Choice |
|---|---|
| Web app (`web`, the only public app) | Next.js 16 (App Router, React 19, TypeScript strict), Tailwind CSS v4, shadcn/ui. Hosting not decided yet |
| Workers | Six Node 22 packages on Fly.io (`fra`), shared base image with Chromium and FFmpeg; `worker-media` adds Python and WhisperX |
| Queue | pg-boss in the Supabase Postgres database; `pg_cron` for due posts |
| Database and files | Supabase Postgres with RLS, Storage (one private bucket per library), Vault for Meta tokens; a development project and a production project |
| Auth | Supabase Auth, email with MFA, roles owner and editor |
| AI | Claude through the Claude Agent SDK with the vendored Instagram skills; video generation (Veo or Kling) and voiceover (ElevenLabs) behind adapters |
| Media | FFmpeg, WhisperX, Playwright (HTML templates to images), HyperFrames (Reels) |
| Platforms | Instagram Graph API (publishing, insights), Meta Marketing API (ads), Apify (Instagram and TikTok data), YouTube Data API, yt-dlp |
| Validation | Zod at every boundary, shared schemas in `packages/contracts` |
| Tests | Vitest, Playwright, pgTAP (rolled back on the development project) |
| Package manager | pnpm workspace (Node 22 LTS, see `.nvmrc`) |

## Commands

| Task | Command |
|---|---|
| Web app (against the development project in `.env.local`) | `pnpm harness preview`, then `pnpm dev` |
| All workers locally (development project) | `pnpm workers:dev` |
| One worker's tests | `pnpm --filter @app/worker-<name> test` |
| Database status and tests | `pnpm harness db status`, `pnpm harness db test` |
| Typecheck, lint, tests | `pnpm typecheck`, `pnpm lint`, `pnpm test` |
| Everything before production | `pnpm verify` |
| Development worker deploy | `fly deploy --remote-only --app <worker>-dev --config workers/<worker>/fly.toml` |

## Repository layout

```
specs/                 Spec-first work items (see specs/README.md); product/ has vision, personas, glossary, NFRs
docs/architecture/     system-spec.md (the source specification), ADRs
src/                   Next.js web app
  app/                 Screens: library, generate and review, discover, calendar, settings
  server/              Server-only code: dal/, actions/, services/, auth/
  lib/                 Supabase SSR clients, shared validation
  components/          UI (ui/ holds the shadcn/ui primitives)
workers/
  base/                Shared base image and runtime helpers (job loop, logging, temp dirs)
  media/               Export ZIP import, FFmpeg, WhisperX, analysis, embeddings
  agent/               Claude Agent SDK, vendored Instagram skills (skills/), ContentSpec planning
  render/              Playwright templates (templates/), HyperFrames Reels, captions, audio, checks
  discovery/           Apify, YouTube Data API, yt-dlp, ranking, downloads
  publish/             Instagram publishing, Meta ads, token refresh
  analytics/           Post and ad insights
packages/
  contracts/           Job payloads, ContentSpec, database types (Zod + TypeScript)
  queue/               pg-boss client, queue names, retry and dead-letter settings
  providers/           Adapter interfaces and implementations per external service
supabase/
  changes/             One SQL change script per spec, applied to development, released to production
  tests/database/      pgTAP tests
migrations/schema.sql  Production schema snapshot (no data), saved after every release
```

## Architecture rules

0. Workers never call or import each other; they share code through `packages/` and work through pg-boss jobs. The web app never runs media, AI or platform calls itself.
1. Server Components by default. `'use client'` only at interactive leaves. Client files never import `@/server/*`.
2. Reads go through `src/server/dal`. Mutations go through Server Actions in `src/server/actions`. Route Handlers are for webhooks and external APIs.
3. Authorization is enforced twice: in the DAL or action (TypeScript) and by Postgres RLS. Never rely on the proxy for authorization.
4. On the server, authenticate with `supabase.auth.getClaims()` or `getUser()`, never `getSession()`.
5. Validate every external input with Zod; return typed results `{ ok: true, data } | { ok: false, error }` from actions.
6. Secrets only in server environment variables; `NEXT_PUBLIC_` values are public. The service-role key never leaves `src/server/supabase/admin.ts`.
7. Business logic lives in `src/server/services`, independent of Next.js and Supabase where practical, to stay testable and portable.
8. Caching decisions are explicit per route (static, dynamic, `"use cache"` with tags). No per-user data in shared caches.

## Database

- Two Supabase projects: **development** (agents apply changes and run tests there) and **production** (read-only for agents; changed only by a release after the human types `send to production`).
- No migration history. Each spec that changes the schema has one change script, `supabase/changes/<id>-<slug>.sql`, applied to development as one transaction and later released to production as the same transaction.
- After each release, `migrations/schema.sql` is refreshed from production: the SQL that recreates the whole schema on an empty project. No data.
- Every table in `public` has RLS and explicit policies. pgTAP tests cover RLS per role, on rows the tests create, in runs that are always rolled back.
- Docker, `supabase start`, `supabase test db` and local Postgres are not used (hooks block them).

## Testing

- Unit and component tests colocated as `*.test.ts(x)`; e2e in `tests/e2e`; database tests in `supabase/tests/database`.
- Every acceptance criterion (AC-ID) in a spec has at least one test that names it.

## Conventions

- TypeScript strict, no `any`, no non-null assertions without a comment. Named exports. `kebab-case` files, `PascalCase` components, `camelCase` functions.
- Branches: `feat/NNN-slug`, `fix/NNN-slug`, `chore/NNN-slug` where NNN is the spec id. Commits: Conventional Commits with the spec id, for example `feat(003): add invoice export`.
- `main` is production. Agents merge and push it, and deploy production Fly.io apps, only after the human types `send to production`.
- Documentation and code comments in English, plain language, no em dashes.

## Specs

Work starts from a spec in `specs/` and follows: draft, in-review, approved (the human types `approve spec <id>`), in-progress, implemented (ready for the human's test), released (the human typed `send to production`). Read `specs/README.md` before creating or implementing anything.
