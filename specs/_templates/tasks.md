---
spec: "{{id}}"
title: "Tasks: {{title}}"
owner: solution-architect
updated: {{date}}
---
<!-- harness:template -->
<!-- Author: solution-architect; the orchestrator updates the status marks. Remove the marker when the plan is complete.
Format (parsed by the harness): - [ ] T-001 [owner: <agent>] [deps: T-000, ...] Title (AC-001, AC-002)
Marks: [ ] todo, [~] in progress, [x] done, [!] blocked. One owner per task, 1 to 4 hours of focused work, no two tasks in one wave touching the same files. -->

# Tasks: {{title}}

## Tasks
- [ ] T-001 [owner: database-architect] [deps: -] Change script supabase/changes/NNN-slug.sql with RLS, applied to development; pgTAP tests (AC-001)
- [ ] T-002 [owner: backend-engineer] [deps: T-001] DAL functions and Server Actions with unit tests (AC-001, AC-002)
- [ ] T-003 [owner: ux-ui-designer] [deps: -] UI primitives and states from ui.md (AC-002)
- [ ] T-004 [owner: frontend-engineer] [deps: T-002, T-003] Route, forms and wiring; runtime verification (AC-001, AC-002)
- [ ] T-005 [owner: qa-engineer] [deps: T-004] End-to-end tests per test-plan.md and verification report
- [ ] T-006 [owner: code-reviewer] [deps: T-004] Code review report
- [ ] T-007 [owner: security-auditor] [deps: T-004] Security review report
- [ ] T-008 [owner: technical-writer] [deps: T-005] Release notes, changelog, docs
- [ ] T-009 [owner: devops-engineer] [deps: T-005, T-006, T-007] PR, preview check, migration deploy plan, env vars

## Waves
| Wave | Tasks | Notes |
|---|---|---|
| 1 | T-001, T-003 | no shared files |
| 2 | T-002 | |
| 3 | T-004 | |
| 4 | T-005, T-006, T-007 | verification in parallel |
| 5 | T-008, T-009 | release |

## AC coverage
| AC | Tasks |
|---|---|
| AC-001 | T-001, T-002, T-004, T-005 |

## Notes
<!-- Decisions made during implementation, root cause analysis for bugfixes, follow-up items. -->
