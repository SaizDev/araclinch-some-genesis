---
name: spec-ship
description: Step 6 of the workflow, only after the human typed "send to production" (the hook records it). Release the spec's database change to the production Supabase project, merge the branch into main and push, deploy the changed workers to their production Fly.io apps, save the production schema snapshot.
argument-hint: <spec-id>
---

# /spec-ship

Spec: $ARGUMENTS

!`node .claude/harness/harness.mjs spec status $ARGUMENTS 2>&1 || true`
!`node .claude/harness/harness.mjs db status 2>&1 || true`

Hooks block the production release, the merge into `main` and the push until the human has typed `send to production` (valid 24 hours). If a hook says it is missing, ask the human for it; never look for another way.

## Steps
1. **Final check on the branch:** `pnpm verify` (lint, typecheck, tests, build). If it fails, stop, tell the human production was not touched, and fix it through `/spec-build <id> <failure>`.
2. **Database first** (only if `supabase/changes/<id>-<slug>.sql` exists): `mcp__supabase-release__execute_sql` with the query `-- devharness:release <id>`. One transaction: if it fails, nothing changed in production; stop and report. The script must work with the code currently in production (add first, remove in a later spec), because the database goes live a minute before the code.
3. **Status:** `node .claude/harness/harness.mjs spec set-status <id> released`, commit it on the branch.
4. **Merge and push:**
   ```
   git switch main
   git pull --ff-only
   git merge --no-ff <branch> -m "<type>(<id>): <title>"
   git push origin main
   ```
   On a merge conflict: `git merge --abort`, tell the human, stop.
5. **Web:** the web host deploys `main`. Hosting is not decided yet (`stack.web.host` in `.claude/harness/config.json`): if it is empty, tell the human the web app was not deployed and stop after the workers.
6. **Workers:** for each worker whose folder (or a package it uses) changed since the last release, deploy it to its production Fly.io app in `fra`, one at a time, and wait for health:
   ```
   fly deploy --remote-only --app <production app from stack.fly.apps> --config workers/<worker>/fly.toml
   ```
   If a deploy fails, stop, report which workers are live, and do not deploy the rest. New production secrets are set by the human (`fly secrets set` per app); list any the spec added.
7. **Snapshot** (only if there was a database change): `/db-snapshot`, then commit `migrations/schema.sql` on `main` (`chore(db): production schema snapshot after <id>`) and push.
8. **Report in 3 lines:** what went live (database, web, which workers), and anything the human must do (production secrets or environment variables, if any). Stop the local dev server and the local workers if they are still running.
