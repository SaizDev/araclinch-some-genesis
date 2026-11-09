# Harness manual

The harness turns Claude Code into a spec-first product team for this project: a Next.js web app on Supabase and six workers on Fly.io. This folder holds its configuration and engine. Everything is plain files: read them, version them, change them deliberately.

## The workflow

1. The human asks for a feature or a fix (`/spec-new`).
2. The product-manager assesses it; the orchestrator relays its questions (AskUserQuestion) until it is ready.
3. The product-manager writes the spec; the human types `approve spec <id>` (hook: `chat-approval`).
4. `/spec-build` dispatches the work to the team. Schema changes go to the DEVELOPMENT Supabase project as the spec's change script; workers run locally or on the `-dev` Fly apps. The security-auditor does a quick check.
5. The orchestrator checks `.env.local` (`pnpm harness preview`), starts `pnpm dev` and gives the human a test checklist.
6. The human types `send to production` (hook: `chat-approval`). `/spec-ship` releases the change script to PRODUCTION, merges the branch into `main`, pushes, deploys the changed workers to their production Fly apps and saves the production schema to `migrations/schema.sql`.

```
.claude/
  CLAUDE.md (root)          Orchestrator instructions (imports AGENTS.md)
  settings.json             Permissions, hooks, status line, enabled plugins
  agents/                   The team (one file per subagent)
  skills/                   Workflow commands (/spec-new ...) and vendored expert skills
  rules/                    Always-on and path-scoped rules; 00-delegation.md is generated
  hooks/
    harness-hook.mjs        Single dispatcher for every hook event
    checks/*.mjs            One file per guard or helper
    statusline.mjs          Status line (profile, spec, branch, database state)
  harness/
    config.json             Control panel: profile, overrides, model preset, stack values, policies
    catalog.json            Every module, the profiles that include it, MCP definitions, model presets
    ownership.json          Path zones and their owners (delegation enforcement)
    harness.mjs             CLI (pnpm harness ...)
    lib/                    Shared code for the CLI and the hooks
    tests/                  node --test suite for the guards and the CLI
    disabled/               Parked agents, skills and workflows of disabled modules
    state/                  Runtime state (gitignored): session events, activity log, active spec pin
.mcp.json                   MCP servers (generated from the catalog; your own servers are preserved)
```

## Profile

This project has one profile, `budget`, and no profile switching (`config.mjs` lists only it). The team: product-manager and solution-architect on Opus; backend, frontend, media, ai-agent, integrations and platform engineers and the security-auditor on Sonnet (`budget` model preset). Builders are pinned to Sonnet; a brief with an `Escalation:` line retries a task on Opus. Lite specs (`specs/_templates/spec-lite.md`) with the architect's `tasks.md` before approval. Strict spec gate, ownership and both human approvals.

Fine-tune single modules: `pnpm harness enable <module>`, `pnpm harness disable <module>`, `pnpm harness modules`, then restart Claude Code.

## Model presets

`pnpm harness models budget` is the only preset: Opus for product-manager and solution-architect, Sonnet for the rest.

## Guards (hook checks)

| Check | Event | What it enforces |
|---|---|---|
| `bash-guard` | PreToolUse Bash | Blocks destructive commands, force pushes, merges into and pushes to main until the human typed `send to production`, `supabase migration`/`db diff`/`db pull`, `--no-verify`, production and remote Supabase/Vercel changes, secret reading and environment dumps, remote scripts piped to shells, `sudo`, spec approval by agents, Docker and local Supabase stacks (`supabase start`, `supabase test db`, local `db reset`); asks before risky local operations; enforces path ownership on shell writes (redirections, `cp`, `mv`, `rm`, `sed -i`, `tee`, inline scripts) |
| `content-guard` | PreToolUse edits | Blocks `.env*` edits, hardcoded credentials (keys, JWTs, private keys, DB URLs with passwords), secrets in `NEXT_PUBLIC_` names, server secrets or server imports in client components, admin key outside `src/server`, `src/server` files without `import 'server-only'`; warns on `dangerouslySetInnerHTML`, `eval`, `getSession()` on the server |
| `ownership` | PreToolUse edits | The orchestrator cannot write owned paths; each agent writes only its zones (`ownership.json`, fallbacks for disabled roles) |
| `migration-guard` | PreToolUse edits | Change scripts: `supabase/changes/<spec-id>-<slug>.sql` only (no `supabase/migrations`), frozen once the spec is released, no BEGIN/COMMIT, CONCURRENTLY or VACUUM; RLS for tables in `public`, `security_invoker` views, `search_path` on SECURITY DEFINER, no `auth.role()` or `user_metadata` in policies, destructive statements need `-- harness:allow-destructive` |
| `spec-gate` | PreToolUse edits | Code paths need an active spec that is approved, unchanged since approval and (features) has a completed design and plan; agents cannot approve specs or touch approval fields |
| `chat-approval` | UserPromptSubmit | A message that is only `approve spec <id>` approves that spec; a message that is only `send to production` records the production approval for the active spec, with the hash of its change script (human-typed text only; Claude and agents cannot trigger it) |
| `mcp-guard` | PreToolUse, PostToolUse MCP | `supabase` (development): data reads and writes, schema only as `-- devharness:apply <id>` (the change script, one transaction) and rolled-back test runs. `supabase-prod`: read-only, `-- devharness:schema-snapshot` swapped for the catalog query, the result saved to `migrations/schema.sql` after the call. `supabase-release`: only `-- devharness:release <id>` with a valid production approval for the current script. `apply_migration`, Vercel deploys and purchases are denied |
| `delegation` | PreToolUse Agent | Subagents cannot delegate; disabled agents are refused with their fallback; when `policies.delegation.requireBrief` is true (full and standard), briefs to team agents must contain `Spec:`, `Task:`, `Deliverables:` |
| `handoff` | SubagentStop | Team agents must end with a `## Handoff` block (`Status: done|partial|blocked`); compact in budget and minimal |
| `format` | PostToolUse | Prettier on edited source files |
| `context` | SessionStart, UserPromptSubmit, SubagentStart | Injects the workflow, active spec, gate state, next tasks, unreleased change scripts, missing Supabase projects; reminds the spec-first path on build requests; tells each agent its zones |
| `stop-gate` | Stop | Before ending a turn with code changes: typecheck, lint, and the security-auditor quick check once a spec's tasks are all done |
| `notify` | Notification | macOS banner and terminal notification when Claude needs you |
| `activity-log` | all | Appends guard decisions, edits and agent runs to `state/activity.jsonl` (audit trail) |

Every check is fail-open on internal errors (a warning appears in the session) so a bug never blocks your work; the permission rules in `settings.json` remain a second line of defense.

**Permission modes.** The harness never adds approval prompts on top of the mode you chose. In `default` mode a check may still ask; in auto, accept-edits and bypass modes its concern becomes a note for Claude and Claude Code's own permission handling decides. Denies stay denies in every mode. `settings.json` has no `ask` rules for file edits.

## Human-only escape hatches

Set when launching Claude Code (agents cannot set them for the hooks):

| Variable | Effect |
|---|---|
| `HARNESS_SPEC_GATE=warn` or `off` | Soften or disable the spec gate for this session |
| `HARNESS_OWNERSHIP=warn` | Ownership violations become warnings |
| `HARNESS_REVIEW_GATE=off` | Skip the review requirement at stop |
| `HARNESS_DISABLE=format,notify` | Disable listed checks |
| `HARNESS_ACTIVE_SPEC=004` | Force the active spec |

Example: `HARNESS_SPEC_GATE=warn claude`. Prefer fixing the process (create a chore spec) over bypassing it.

## Database: two projects, change scripts, snapshot

No local database, no Docker, no migration history (decision record: `docs/architecture/adr/0007-dev-and-prod-projects-change-scripts.md`).

- `pnpm harness supabase dev <ref>` and `pnpm harness supabase prod <ref>` configure the two projects and the three MCP servers.
- One change script per spec: `supabase/changes/<id>-<slug>.sql`. `-- devharness:apply <id>` on `supabase` applies it to development as one `DO` block (one transaction).
- `pnpm harness db test [filter] [--with <id>]` builds one rolled-back pgTAP run for development; it ends in an exception (`DEVHARNESS_DB_TEST_RESULT passed=.. failed=.. file_errors=..`) so Postgres undoes every change.
- After `send to production`: `-- devharness:release <id>` on `supabase-release` applies the same script to production, only if its hash matches the approval (24 hours).
- `/db-snapshot`: `-- devharness:schema-snapshot` on `supabase-prod` runs `.claude/harness/sql/schema-snapshot.sql` (catalog queries, read-only) and the hook writes `migrations/schema.sql`: the SQL that recreates the whole application schema, no data.
- `pnpm harness db status` lists change scripts, approvals and the snapshot date.

## Spec approval

Only humans approve, with two chat messages: `approve spec <id>` (start building) and `send to production` (or `send spec <id> to production`, `release spec <id>`, Spanish `enviar a producción`). For specs, the message contains only `approve spec <id>` (several ids work: `approve specs 3 and 4`; Spanish `aprobar spec 3` too). Claude Code passes the text you type to the `chat-approval` hook before Claude sees it, and Claude or its agents cannot produce that text, so the hook records the approval (`approved_via: chat`). Longer messages never approve ("do not approve spec 3 yet" is ignored). The terminal command `pnpm spec:approve <id>` does the same outside Claude Code; the CLI refuses when `CLAUDECODE` is set, permissions deny it, the bash guard blocks it, and nested `claude` calls that mention approval or production are denied. To let the product-manager approve bugfix and chore specs, set `policyOverrides.specGate.approval` to `tiered` in `config.json`; `agents` lets it approve everything after reviews.

## Config reference (`config.json`)

- `profile`, `modelPreset`, `overrides.enable|disable` (module ids).
- `stack.supabase.dev.projectRef`, `stack.supabase.prod.projectRef`: the two Supabase projects. Set them with `pnpm harness supabase dev|prod <ref>`.
- `policies`: base policies (profiles overlay `specGate.*`, `ownership.mode`, `delegation.requireBrief`, `handoff.compact`, `review.agents`, `stopGate.*`).
- `policyOverrides`: your project-specific overrides, applied last.

## Extending the harness

- **New agent:** add `.claude/agents/<name>.md`, a module in `catalog.json` (kind `agent`, profiles, fallback, skills), zones in `ownership.json`, then `pnpm harness render`.
- **New workflow command:** add `.claude/skills/<name>/SKILL.md` and a `workflow-skill` module.
- **New guard:** add `.claude/hooks/checks/<id>.mjs` exporting `run(ctx)`, register it in `REGISTRY` in `harness-hook.mjs`, add a `check` module, write tests in `tests/`.
- **New MCP server:** add an `mcp` module with its `definition`; or add it directly to `.mcp.json` (unmanaged servers are preserved).
- Run the test suite after any change: `node --test ".claude/harness/tests/*.test.mjs"`.

## Troubleshooting

- `pnpm harness doctor` explains missing tools, plugins, skills, MCP configuration and drift.
- `pnpm harness ownership check <agent|main> <path>` shows who may write a path and why.
- Hook messages start with `[harness:<check>]`; `/harness why <message>` explains them.
- The activity log (`.claude/harness/state/activity.jsonl`) records every deny and ask decision.
