---
spec: "{{id}}"
kind: qa | code-review | security
reviewer: <agent>
date: {{date}}
verdict: approve | changes-requested
---

# <QA verification | Code review | Security review>: {{title}}

## Scope
<!-- What was reviewed: commits or diff range, files, environments, ACs. State what was NOT covered. -->

## Checks run
| Command or method | Result |
|---|---|
| `pnpm typecheck` | pass |

## Results per acceptance criterion (QA)
| AC | Result | Evidence |
|---|---|---|
| AC-001 | pass / fail / blocked | test name, screenshot, log |

## Findings
| ID | Severity | Location | Problem | Recommendation | Owner |
|---|---|---|---|---|---|
| F-001 | high | `src/server/actions/x.ts:42` | | | backend-engineer |

Severity scales: QA and security use critical, high, medium, low, info. Code review uses blocker, major, minor, nit.

## Accepted risks proposed
<!-- Items the reviewer suggests accepting; the human signs off in docs/security/accepted-risks.md. -->

## Verdict
approve | changes-requested, with one sentence of justification.
