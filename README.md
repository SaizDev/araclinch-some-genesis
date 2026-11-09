# araclinch-some-genesis

Instagram content system for one brand: a Next.js web app on Supabase plus six workers on Fly.io (media, agent, render, discovery, publish, analytics) that talk only through pg-boss jobs. Built spec-first by a Claude Code agent team (budget profile). The source specification is `docs/architecture/system-spec.md`.

**New here? Start with `GETTING-STARTED.md`**: one-time setup, first session, daily loop, your decisions and troubleshooting.

## Quick start

```bash
nvm use                       # Node 22 LTS (.nvmrc)
pnpm install
cp .env.example .env.local    # then fill the DEVELOPMENT Supabase values and the development API keys
pnpm harness preview          # checks .env.local points to development
pnpm dev                      # web app on http://localhost:3000
pnpm workers:dev              # the six workers as containers on the development VM
```

First time: `bash scripts/harness/bootstrap.sh` installs the recommended Claude Code plugins, skills and MCP servers and scaffolds the workspace.

## Working on the product

| Step | You type in the chat | Then |
|---|---|---|
| 1. Ask | "New feature: ..." or "Bug: ... Expected: ..." | answer the questions |
| 2. Approve | `approve spec <id>` (a message on its own) | the team builds it on the development project and the `-dev` Fly apps |
| 3. Test | what is wrong, if anything | http://localhost:3000 and the workers, with the checklist Claude gives you |
| 4. Ship | `send to production` (a message on its own) | database release, merge into `main`, push, production worker deploys, schema snapshot |

The team: product-manager and solution-architect (Opus), backend, frontend, media, ai-agent, integrations and platform engineers (Sonnet), and a security-auditor quick check.

## Layout

| Folder | What |
|---|---|
| `src/` | Next.js web app (hosting not decided yet) |
| `workers/<name>/` | One Fly.io app per worker, built on `workers/base` |
| `packages/contracts`, `queue`, `providers` | Shared job payloads and types, the pg-boss client, external service adapters |
| `supabase/changes/`, `migrations/schema.sql` | Database change scripts and the production schema snapshot |
| `specs/` | Spec-first work items; `specs/roadmap.md` lists specs 000 to 008 |

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev`, `pnpm build`, `pnpm start` | Web app |
| `pnpm workers:dev`, `workers:logs`, `workers:ps`, `workers:down` | The workers as containers on the development VM (Docker context `araclinch-vm`) |
| `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` | Quality gates |
| `pnpm verify` | Everything before production |
| `pnpm harness db status`, `pnpm harness db test` | Change scripts and rolled-back database tests |
| `pnpm harness status`, `pnpm harness doctor`, `pnpm harness preview` | Harness state, health, local environment check |

Conventions: `AGENTS.md`. Third-party code: `THIRD_PARTY_NOTICES.md`.
