---
id: "{{id}}"
title: "{{title}}"
type: chore
status: draft
owner: product-manager
created: {{date}}
updated: {{date}}
priority: low
related: []
approved_by:
approved_at:
approved_hash:
approved_via:
---
<!-- harness:template -->
<!-- Chores change no user-visible behavior: dependency updates, refactors, tooling, CI. If users would notice, it is a feature or bugfix. Remove the marker when complete. -->

# {{title}}

## 1. Motivation
<!-- Why now: security advisory, maintenance, performance, developer experience. -->

## 2. Change
<!-- What will change, at the level a reviewer can check. -->

## 3. Acceptance criteria
| ID | Criterion |
|---|---|
| AC-001 | No user-visible behavior changes: existing tests and e2e flows pass. |
| AC-002 | |

## 4. Risks and rollback
- Risk:
- Rollback:

## 5. Changelog
| Date | Change | By |
|---|---|---|
| {{date}} | Created | product-manager |
