---
id: "{{id}}"
title: "{{title}}"
type: bugfix
status: draft
owner: product-manager
created: {{date}}
updated: {{date}}
severity: medium
priority: medium
related: []
approved_by:
approved_at:
approved_hash:
approved_via:
---
<!-- harness:template -->
<!-- Author: product-manager with QA reproduction. Remove the marker when complete. Severity: critical (data loss, security, outage), high (core flow broken, no workaround), medium (workaround exists), low (cosmetic). -->

# {{title}}

## 1. Summary
<!-- One or two sentences: what is broken and for whom. -->

## 2. Impact
- Affected users / roles:
- Frequency:
- Data or security impact:
- Workaround:

## 3. Reproduction
Environment: local | preview | production, browser, account role, relevant data.

1.
2.
3.

**Actual:**

**Expected:** <!-- reference the spec and AC that define the correct behavior, if any -->

Evidence: <!-- error messages, log lines (no personal data), screenshots -->

## 4. Acceptance criteria
| ID | Criterion |
|---|---|
| AC-001 | Given <reproduction preconditions>, when <steps>, then <expected behavior>. |
| AC-002 | A regression test reproduces the original failure and passes after the fix. |

## 5. Scope
- In scope:
- Out of scope:

## 6. Root cause
<!-- Leave as "To be analyzed". The root cause analysis goes into tasks.md (Notes) after approval, because any edit to this file after approval closes the gate until the human re-approves. -->
To be analyzed.

## 7. Intake decisions
| # | Decision | Answer | Source |
|---|---|---|---|
| Q1 | | | |

## 8. Changelog
| Date | Change | By |
|---|---|---|
| {{date}} | Created | product-manager |
