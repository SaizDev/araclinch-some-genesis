---
name: spec-new
description: Steps 1 to 3 of the workflow for any new feature, change, fix or chore. The product-manager assesses the request and returns questions when it needs information; you ask them with the tappable wizard and pass the answers back; then it writes the spec and you wait for the human to type "approve spec <id>".
argument-hint: <what to build or fix>
---

# /spec-new

Request: $ARGUMENTS

## Current specs
!`node .claude/harness/harness.mjs spec list 2>&1 || true`

Protocol and question format: `.claude/skills/spec-new/intake.md`.

## Steps

1. **Existing spec?** If a spec in the list already covers the request, say so and ask whether to update it instead (the product-manager does the update).

2. **Intake.** Delegate to `product-manager`:
   ```
   Spec: none yet (intake)
   Task: intake
   Goal: <the request in the human's words, plus anything they already said>
   Inputs: .claude/skills/spec-new/intake.md, specs/product/* (if present), related code: <paths you know, or "find it">
   Deliverables: Handoff ending with an intake block (type feature|bugfix|chore, questions or "ready": true, suggested_slug)
   Constraints: read-only; no spec files yet. For a bug, reproduce it by reading code and logs; do not fix it.
   ```

3. **Relay the questions.** If the block has questions: send the human one short message with the `understanding` and `assumptions`, then call AskUserQuestion with the questions mapped one to one (at most 4 per call). Never answer for the human. Send the answers back verbatim (`Task: intake round 2`). Repeat until `"ready": true`.

4. **Create the folder:** `node .claude/harness/harness.mjs spec new <type> <suggested_slug> --title "<title>"`. The profile picks the template (one-page lite spec, or the full spec).

5. **Spec.** Delegate to `product-manager`:
   ```
   Spec: specs/<id>-<slug>
   Task: write spec.md
   Goal: <the request> + the intake answers verbatim + accepted assumptions
   Inputs: specs/<id>-<slug>/spec.md (template), .claude/skills/spec-new/intake.md, related code: <paths>
   Deliverables: spec.md complete (testable AC-IDs, out of scope, intake decisions), template marker removed, status in-review
   Constraints: no code; schema changes are planned as supabase/changes/<id>-<slug>.sql
   ```

6. **Plan (lite specs: budget and minimal profiles).** Delegate to `solution-architect`:
   ```
   Spec: specs/<id>-<slug>
   Task: lite plan
   Goal: a plan concrete enough for Sonnet builders to follow without exploring or deciding architecture
   Inputs: specs/<id>-<slug>/spec.md, the code areas the intake named: <paths>
   Deliverables: specs/<id>-<slug>/tasks.md (node .claude/harness/harness.mjs spec scaffold <id> tasks), marker removed
   Constraints: sized to the spec; no design.md
   ```
7. **Wait for approval.** Tell the human in at most 6 lines: what is in, what is out, the plan in one or two lines (lite: from tasks.md), and the exact message to send: `approve spec <id>`. Do nothing else on this spec until they send it. When they do, the hook records it and you start `/spec-build <id>`.

The human can skip the questions ("no questions, use your judgment"): then go to step 4 and have the product-manager record every choice as an assumption.
