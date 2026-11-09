---
status: accepted
date: 2026-01-01
deciders: harness baseline
---

# 0001: Record architecture decisions

## Context
Agents and humans change this codebase in parallel. Decisions made in chat are lost; decisions made silently in code are rediscovered expensively.

## Decision
Significant, hard-to-reverse decisions are recorded as ADRs in `docs/architecture/adr/NNNN-title.md` using `template.md` (MADR style). The solution-architect writes them (`/adr-new`); the human accepts them. Accepted ADRs are changed only by superseding them.

A decision needs an ADR when it adds a runtime dependency or external service, changes data modeling strategy, authentication or authorization, caching or rendering model, hosting, or portability.

## Consequences
- Positive: context survives turnover and model changes; reviewers can check code against decisions.
- Negative: small overhead per decision.
