---
id: "{{id}}"
title: "{{title}}"
type: feature
status: draft
owner: product-manager
created: {{date}}
updated: {{date}}
priority: medium
target_release:
related: []
approved_by:
approved_at:
approved_hash:
approved_via:
---
<!-- harness:template -->
<!-- Author: product-manager. Remove the marker above when the spec is complete. Remove guidance comments as you fill sections. Write WHAT and WHY, never HOW (no tables, components or libraries). -->

# {{title}}

## 1. Summary
<!-- 2-4 sentences: the capability, who gets it, and the value. -->

## 2. Problem and context
<!-- What hurts today, evidence (feedback, metrics, support tickets), why now. Link related specs. -->

## 3. Goals and non-goals
**Goals**
- G1:

**Non-goals** (explicitly not solved by this spec)
- NG1:

## 4. Users and personas
<!-- Reference personas from specs/product/personas.md. Include roles that must NOT have access. -->

| Persona / role | Relationship to this feature | Access |
|---|---|---|
| | | allowed / denied |

## 5. User stories
- **US-1** As a <persona>, I want <capability>, so that <benefit>.

## 6. Acceptance criteria
<!-- Stable IDs. EARS or Given/When/Then. Observable and measurable. Cover the happy path, validation errors, permissions (who is denied), empty states, limits and concurrency. -->

| ID | Story | Criterion |
|---|---|---|
| AC-001 | US-1 | When <trigger>, the system shall <observable response>. |
| AC-002 | US-1 | If <unwanted condition>, then the system shall <response>. |

## 7. Functional requirements
<!-- Behavior not fully captured by ACs: rules, calculations, states, notifications. -->
- **FR-001**

## 8. Non-functional requirements
<!-- Inherit specs/product/nfr.md; add feature-specific thresholds. -->
| ID | Category | Requirement |
|---|---|---|
| NFR-001 | Performance | e.g. page interactive (INP) under 200 ms at p75 on mid-range mobile |
| NFR-002 | Accessibility | WCAG 2.2 AA for all new screens |
| NFR-003 | Security | e.g. only members of the workspace can read its records |
| NFR-004 | Observability | e.g. log export failures with request id, without personal data |

## 9. Data and privacy
<!-- Personal data involved, purpose, legal basis (GDPR art. 6), retention, who can see it, export/deletion needs. Write "No personal data" if true. -->
| Data | Purpose | Legal basis | Retention | Visible to |
|---|---|---|---|---|

## 10. UX notes
<!-- Key flows and states in words; the designer writes ui.md. Include copy that matters (errors, confirmations). -->

## 11. Dependencies and assumptions
- Assumption:
- Depends on:

## 12. Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|

## 13. Success metrics
<!-- How we will know it worked, with a target and a time window. -->

## 14. Out of scope
-

## 15. Open questions
| # | Question | Owner | Answer |
|---|---|---|---|
| Q1 | | human | |

## 16. Intake decisions
<!-- Every intake question with its answer. Source: human, recommended default or assumption. -->
| # | Decision | Answer | Source |
|---|---|---|---|
| Q1 | | | |

## 17. Changelog
| Date | Change | By |
|---|---|---|
| {{date}} | Created | product-manager |
