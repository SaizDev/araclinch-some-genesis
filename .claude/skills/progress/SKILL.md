---
name: progress
description: Delivery status report - specs by status, the active spec with its tasks, items waiting for the human, unreleased database changes and the next best actions. Use when the human asks where things stand or what to do next.
allowed-tools: Bash(node .claude/harness/harness.mjs *), Bash(git status*), Bash(git log*), Bash(git branch*)
---

# /progress

## Specs
!`node .claude/harness/harness.mjs spec list 2>&1 || true`

## Active spec
!`node .claude/harness/harness.mjs spec status 2>&1 || true`

## Harness
!`node .claude/harness/harness.mjs status 2>&1 || true`

## Git
!`git status --short --branch 2>&1 | head -30 || true`

## Report format
Write a short report for the human:
1. **Now:** active spec, its status and gate, tasks done / total, anything blocked (with owner).
2. **Waiting for you:** specs to approve (`approve spec <id>`), features ready to test, `send to production` once tested, open questions, environment variables to set.
3. **Next actions:** the 1 to 3 commands that move work forward (for example `/spec-build 004`).
4. **Health:** change scripts not yet released, schema snapshot older than the last release, failing checks, specs changed after approval.
Keep it under 20 lines.
