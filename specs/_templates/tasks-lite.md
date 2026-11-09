---
spec: "{{id}}"
title: "Plan: {{title}}"
owner: solution-architect
updated: {{date}}
---
<!-- harness:template -->
<!-- Lite plan (budget and minimal profiles), written by the solution-architect before the human approves.
The builders run on Sonnet and follow this plan as written, so make every task concrete enough that they do not explore or decide architecture:
  Task line: T-001 [owner: <agent>] [deps: -] Title (AC-001), as a checklist item
    - Files: files to create or change, and one existing file whose pattern to copy
    - How: the approach in one to five lines: functions, components or queries to reuse, data shapes, the RLS or permission rule in words, edge cases to handle
    - Check: how the builder proves it works (test name, command, what to see in the browser)
Keep small specs small: a typo fix is one task with one line of How. Remove the marker when complete. -->

# Plan: {{title}}

## Approach
<!-- Three to six lines: the overall design, what existing code it builds on, decisions the builders must not change. -->

## Tasks
- [ ] T-001 [owner: backend-engineer] [deps: -] (AC-001)
  - Files:
  - How:
  - Check:

## Risks
<!-- Only if any: what could break, and how the plan avoids it. -->
