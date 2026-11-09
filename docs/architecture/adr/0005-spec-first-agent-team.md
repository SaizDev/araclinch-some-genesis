---
status: accepted
date: 2026-01-01
deciders: harness baseline
---

# 0005: Spec-first delivery by an agent team with enforced delegation

## Context
Claude Code can write code quickly, but without structure it mixes concerns, skips requirements and reviews its own work. The project needs repeatable quality and human control over what gets built.

## Decision
- Work starts from specs (`specs/`), approved by a human, with hashed requirements that close the gate when changed.
- The main Claude session acts only as orchestrator. Specialists own zones of the repository: product-manager, solution-architect, database-architect, backend-engineer, ux-ui-designer, frontend-engineer, qa-engineer, security-auditor, code-reviewer, devops-engineer, technical-writer.
- Hooks enforce the rules (ownership, spec gate, delegation briefs, handoffs, migration and content guards, stop gate); permissions deny production actions.
- The harness is modular (profiles full, standard, lean, minimal) and configured in `.claude/harness/`.

## Consequences
- Positive: separation of concerns, traceability from AC to test, independent reviews, human approval at the right points.
- Negative: more ceremony for tiny changes (use chore specs); hooks need maintenance when Claude Code evolves (`node --test ".claude/harness/tests/*.test.mjs"`).
