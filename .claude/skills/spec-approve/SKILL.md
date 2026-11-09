---
name: spec-approve
description: Human-only guide. Shows the approval checklist for a spec and the two chat messages only the human can send, "approve spec <id>" and "send to production". Claude never approves.
argument-hint: <spec-id>
disable-model-invocation: true
---

# /spec-approve (guide for the human)

!`node .claude/harness/harness.mjs spec status $ARGUMENTS 2>&1 || true`

Present this to the human, filled in for the spec above. Do not approve anything yourself: hooks block it, and only a message the human types can approve.

## Approval checklist
- [ ] The problem, users and value are right.
- [ ] Acceptance criteria are complete, testable and have IDs.
- [ ] "Intake decisions" and "Out of scope" match what you want.
- [ ] Open questions are answered or consciously deferred.

## Approve
Type this as your whole next message (nothing else in it):

```
approve spec <id>
```

A hook records the approval: who approved, when, and a hash of the requirements. If `spec.md` changes later, the gate closes until you approve again. (Outside Claude Code, `pnpm spec:approve <id>` does the same.)

After approval the team starts building right away (`/spec-build <id>`). When it is ready you get a local URL to test against the development database.

## Production
When your test passes, type `send to production` as a whole message (or `send spec <id> to production`). It approves the release of that spec: the database change (that exact script), the merge into `main` and the push. If anything changes afterwards, test again and type it again.
