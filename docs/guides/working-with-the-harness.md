# Working with the harness (guide for humans)

First time in this project? Read `GETTING-STARTED.md` at the root first.

You direct a team of Claude agents through one session, the orchestrator. The work follows six steps.

## The loop
1. **Ask** for a feature or a fix in plain words (or `/spec-new <request>`).
2. **Answer** the questions the product-manager needs (tappable; "use your recommendations" is fine).
3. **Approve** the spec: read `specs/NNN-slug/spec.md`, then type `approve spec NNN` as a message on its own.
4. **Wait.** The orchestrator dispatches the work; agents build it on the development Supabase project; reviewers check it. Ask "where are we?" any time.
5. **Test** on http://localhost:3000 with the checklist Claude gives you (the app uses the development database). Reply with what is wrong; fixes go back to the owners and you test again.
6. **Ship:** type `send to production`. The database change is released to production, the branch is merged into `main` and pushed, the changed workers are deployed to production Fly apps, and `migrations/schema.sql` is refreshed.

## Your decisions (the harness never takes them)
- `approve spec <id>`: start building. Changing an approved spec needs a new approval.
- `send to production`: release, merge and push. Valid 24 hours and only for what you tested.
- Secrets, production environment variables, accepted risks.

## Small changes
A typo or a dependency bump is still a (short) spec: "Chore: bump next to the latest patch". One question round at most, one approval, one test, one `send to production`.

## Adapting the harness
- `/harness` explains the current setup and changes it with your confirmation.
- Profiles: budget (default), minimal, lean, standard, full. Single modules can be enabled or disabled.
- Details: `.claude/harness/README.md`.

## When Claude is blocked
Messages starting with `[harness:...]` come from the guards. They say what rule applied and how to proceed. Ask `/harness why <message>` if unclear.
