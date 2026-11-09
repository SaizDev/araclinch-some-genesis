---
name: spec-build
description: Steps 4 and 5 of the workflow, right after the human approves a spec. Dispatch the work to the team of the current profile, apply database changes to the development Supabase project, run the profile's reviews, then start the local server so the human can test. Also used to continue an interrupted build or to fix what the human found while testing.
argument-hint: <spec-id> [what the human reported while testing]
---

# /spec-build

Arguments: $ARGUMENTS

!`node .claude/harness/harness.mjs spec status $ARGUMENTS 2>&1 || true`

Who does what in this profile: `.claude/rules/00-delegation.md` (Workflow, step 4).

## 1. Prepare
- The gate must be open (above). If it is closed, tell the human why and stop.
- Branch: `git switch -c <feat|fix|chore>/<id>-<slug>` from an up-to-date `main` (or switch to it if it exists).
- `node .claude/harness/harness.mjs spec set-status <id> in-progress`.

## 2. Design (profiles with design documents, features only)
If the gate requires `design.md` and `tasks.md` for this spec, delegate them first (architect: design and tasks; database-architect: data model; designer: UI spec), in parallel. Lite specs skip this: the architect wrote `tasks.md` before approval.

## 3. Build
- Take the ready tasks (all dependencies done) from `tasks.md`. Group them in waves: schema, then server, then UI, then tests. Tasks in one wave run in parallel when their files do not overlap.
- Brief per task (keep it short; name the files to read so the agent does not explore). Copy the task's `Files:`, `How:` and `Check:` notes from `tasks.md` into the brief:
  ```
  Spec: specs/<id>-<slug>
  Task: T-00X <title>
  Goal: <what and why, AC-IDs>
  Inputs: <spec sections, the exact files to read, the Files, How and Check notes of the task>
  Deliverables: <files to create or change> and tests
  Acceptance: <AC-IDs>; checks: typecheck, the tests it wrote, database test run if schema changed
  Constraints: stay in your zones; anything else goes under Follow-ups
  ```
- Models (budget profile): builders run on Sonnet and follow the plan; do not pass a model yourself. When a task comes back `partial` or `blocked` because it was harder than planned, delegate it again with an `Escalation: <what failed>` line in the brief: that retry runs on opus. If the plan itself was wrong, ask the solution-architect to fix `tasks.md` first.
- Schema tasks: the owner writes `supabase/changes/<id>-<slug>.sql`, applies it to the DEVELOPMENT project (`-- devharness:apply <id>` on the `supabase` MCP server), regenerates `src/types/database.types.ts`, runs `pnpm harness db test`.
- After each handoff: mark the task `[x]` (or `[!]` and decide), route Follow-ups to their owners as new tasks. Between waves run `pnpm typecheck` and `pnpm test` and route failures.
- Docs: when the profile has a `technical-writer`, the last wave includes README, CHANGELOG and release notes.
- Fix round (the human reported problems): turn each report into a task for its owner, then continue here.

## 4. Review (per profile)
Delegate to the review agents listed in step 4d of the delegation rules, in parallel, with `git diff main...HEAD --stat` and the spec path in the brief. A quick check reviews only the diff and reports only high and critical issues. Route findings to their owners and repeat only the reviews that asked for changes. No review agents in this profile: go to step 5.
Then `node .claude/harness/harness.mjs spec set-status <id> implemented`.

## 5. Hand over for testing
1. `node .claude/harness/harness.mjs preview`. If it is not OK, tell the human exactly what to fix in `.env.local` and stop.
2. Start `pnpm dev` and, when the spec touches any worker, `pnpm workers:dev` in the background (run_in_background); wait until both are ready. Both use the development Supabase project from `.env.local`; paid providers run for real, so tell the human roughly which calls a test triggers.
3. Commit the work on the branch (Conventional Commits with the spec id).
4. Tell the human: the URL (http://localhost:3000), a short checklist (one line per AC: where to click, what to expect), test users or data created in the development project, the jobs to watch (queue and status), and the two possible answers:
   - what is wrong: you run `/spec-build <id> <their notes>` again;
   - `send to production`: the hook records it and you run `/spec-ship <id>`.
