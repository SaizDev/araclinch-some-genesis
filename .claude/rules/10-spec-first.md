# Spec-first method (summary)

Full method: `specs/README.md`. Templates: `specs/_templates/`.

- Flow: request, product-manager intake (questions relayed by the orchestrator), spec, `approve spec <id>` typed by the human, build on the development environment, the human tests, `send to production` typed by the human.
- A spec folder `specs/NNN-slug/` holds `spec.md` (product-manager). Profiles with design documents add, for features, `design.md`, `api.md`, `tasks.md` (solution-architect), `data-model.md` (database-architect), `ui.md` (ux-ui-designer), `test-plan.md` (qa-engineer). Lite specs (budget, minimal) are one page of requirements; the solution-architect writes a concrete `tasks.md` (files, approach and check per task) before the human approves.
- Status flow: `draft` -> `in-review` -> `approved` (human only) -> `in-progress` -> `implemented` (ready for the human's test) -> `released` (after `send to production`). Side states: `on-hold`, `superseded`, `rejected`.
- Documents created from templates carry `<!-- harness:template -->` until their owner completes them. The gate ignores documents that still carry the marker.
- Acceptance criteria have stable IDs (`AC-001`); tasks reference them; tests name them.
- Approval stores a hash of the requirements (task marks do not count). Editing an approved `spec.md` closes the gate until the human re-approves. Record every change in the spec Changelog.
- Task lines: `- [ ] T-001 [owner: <agent>] [deps: T-000] Title (AC-001)`, followed in lite plans by `Files:`, `How:` and `Check:` notes. Marks: `[ ]` todo, `[~]` in progress, `[x]` done, `[!]` blocked.
