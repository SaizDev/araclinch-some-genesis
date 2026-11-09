# Getting started: your first days with the harness

This project was created by `devharness`. It comes with a Claude Code product team (a main session that orchestrates, plus specialist agents), one simple workflow, guards that keep everyone in their lane, two Supabase projects instead of a local database, and development and production apps on Fly.io for the workers. This file takes you from a freshly created folder to your first feature in production. Keep it; it is also the reference for later.

Companion guides: `docs/guides/prompting-the-team.md` (how to phrase requests) and `docs/guides/working-with-the-harness.md` (the daily loop on one page).

## 1. The workflow

You only type three kinds of messages: requests, answers, and the two approvals.

| Step | You | The team |
|---|---|---|
| 1 | Ask for a feature or a fix | The main session (orchestrator) starts the intake |
| 2 | Answer the questions it relays | The product-manager decides what it still needs to know |
| 3 | Read the spec, type `approve spec <id>` | The product-manager writes the spec and waits |
| 4 | Nothing (ask "where are we?" any time) | The orchestrator dispatches the work; agents build it on the development database; the security-auditor does a quick check |
| 5 | Test on http://localhost:3000, say what is wrong | The orchestrator starts `pnpm dev` (and `pnpm workers:dev` when workers changed) against the development project and gives you a checklist |
| 6 | Type `send to production` | The database change goes to production, the branch is merged into `main` and pushed, the changed workers are deployed to their production Fly.io apps, the production schema is saved to `migrations/schema.sql` |

The two approvals are messages on their own (`approve spec 007`, `send to production`). A hook records them before Claude reads them; Claude and its agents cannot produce them. "Do not send to production yet" is never an approval.

## 2. What you have

| Where | What |
|---|---|
| `CLAUDE.md`, `AGENTS.md` | Instructions for the orchestrator and every agent |
| `.claude/` | Agents, commands (`/spec-new` ...), hooks, harness settings |
| `specs/` | One folder per feature, bugfix or chore |
| `src/` | The Next.js web app |
| `workers/`, `packages/` | The six Fly.io workers and their shared code |
| `supabase/changes/` | One SQL change script per spec, applied to development, later released to production |
| `migrations/schema.sql` | The production schema (no data), refreshed after every release |
| `docs/` | Architecture decisions, runbooks, security, guides |

## 3. One-time setup (about 40 minutes)

### 3.1 Two Supabase projects
1. Create two projects in the Supabase dashboard (an EU region if your users are in Europe): **production** and **development** (for example `acme` and `acme-dev`).
2. Tell the harness, unless you gave them to `devharness new`. In your terminal:
   `pnpm harness supabase prod <prod-ref>` and `pnpm harness supabase dev <dev-ref>` (the ref is the id in `https://<ref>.supabase.co`).
   This adds three MCP connections: `supabase` (development: agents apply changes and run tests), `supabase-prod` (production, read-only) and `supabase-release` (production, used only after you type `send to production`).
3. Fill `.env.local` (never committed) with the **development** project values from Supabase > Project Settings > API: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Add the development API keys from `.env.example` (Anthropic, Veo or Kling, ElevenLabs, Apify, YouTube, Meta app). Production values go only into the production hosts.
4. In both projects, Authentication > URL Configuration: development Site URL `http://localhost:3000`; production Site URL the web app domain once hosting is chosen.

### 3.2 GitHub
1. Create an empty private repository on GitHub, then: `git remote add origin <url> && git push -u origin main`.
2. No GitHub Actions are needed.

### 3.3 Fly.io (workers)
1. Install `flyctl` and run `fly auth login` yourself (agents never handle Fly tokens).
2. Create two apps per worker in region `fra`: `<worker>-dev` (agents deploy these freely) and `<worker>` (production, deployed only after `send to production`). Record them with `pnpm harness config set stack.fly.org <org>` and `pnpm harness config set stack.fly.apps.worker-media <app>` and so on.
3. Set the secrets of each app yourself with `fly secrets set` (development keys on `-dev` apps, production keys on the others).

### 3.4 Web hosting
Not decided yet. When you choose, run `pnpm harness config set stack.web.host <host>` and tell Claude; until then `/spec-ship` reports that the web app was not deployed.

### 3.5 Claude Code
1. Start `claude` in the project folder. Approve the project MCP servers when asked.
2. Run `/mcp` and sign in to `supabase`, `supabase-prod` and `supabase-release`.
3. Run `/harness status`. If something is missing, `/harness doctor` explains it.

## 4. Your first feature: the foundation spec

Every project starts with spec `000-foundation` (authentication, layout, data access, tests).

1. Type: **"Set up the foundation (spec 000)."** Answer the questions (or say "use your recommendations").
2. Read `specs/000-foundation/spec.md`, then type **`approve spec 000`**.
3. Wait for "ready to test". Open http://localhost:3000 and follow the checklist.
4. Something wrong? Say what. All good? Type **`send to production`**.

## 5. How the database works

- No local database, no Docker, no migration history.
- Each spec that changes the schema has one change script, `supabase/changes/<id>-<slug>.sql`. Agents apply it to the **development** project as one transaction (all or nothing) and test it there. Database tests run in transactions that are always rolled back.
- Production is read-only for agents. When you type `send to production`, the hook records the exact script you tested (a hash). The same script is then applied to production as one transaction. If it changed after your approval, the release is refused.
- After the release, the harness reads the production catalog and saves the SQL that recreates the whole schema to `migrations/schema.sql`. To rebuild the database elsewhere: run that file on an empty project, then load data.

## 6. Your decisions

| Decision | How |
|---|---|
| Start building a spec | Type `approve spec <id>` |
| Put a tested change live | Type `send to production` |
| Secrets and environment variables | Fly.io secrets, Supabase settings, the web host once chosen |
| Accept a security risk or an architecture decision | The file Claude points to |

## 7. The team

This project uses one profile, budget. The product-manager and solution-architect run on Opus (requirements and a concrete plan before you approve). The builders run on Sonnet and follow the plan: backend-engineer (database and server), frontend-engineer (screens), media-engineer (media and render workers), ai-agent-engineer (agent worker and Claude skills), integrations-engineer (discovery, publish, analytics), platform-engineer (base image, Fly config, queue, scripts). A security-auditor does a quick check before you test. A task that turns out harder than planned is retried once on Opus.

## 8. When something gets in the way

| Symptom | What to do |
|---|---|
| "[harness:spec-gate] ..." | Finish the intake and type `approve spec <id>` |
| "[harness:ownership] ..." | Nothing; the orchestrator routes the work to the right owner |
| "... deploys to production. It runs only after ..." | Test, then type `send to production` |
| "Release refused: ... changed after the human approved" | Test the new version, then type `send to production` again |
| `pnpm harness preview` says STOP | `.env.local` points to production: switch it to the development project |
| A Supabase server is missing | `pnpm harness supabase dev|prod <ref>`, restart Claude, `/mcp` |
| Claude wants Docker or a local database | Nothing: hooks block it; workers build remotely on Fly |
| "fly ... targets a production app" | Test, then type `send to production` |
| Anything else | "Run the harness doctor and explain" |

## 9. Reference

**In the chat:** `/spec-new` (steps 1 to 3), `/spec-build <id>` (steps 4 and 5), `/spec-ship <id>` (step 6), `/db-change`, `/db-snapshot`, `/progress`, `/harness`. Plain requests work too.

**In a terminal:** `claude`, `pnpm dev`, `pnpm workers:dev`, `pnpm verify`, `pnpm harness status|doctor|preview`, `pnpm harness db status`, `pnpm spec:approve <id>` (approval without Claude Code).
