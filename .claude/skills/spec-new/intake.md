# Spec intake protocol

The intake turns a request into the decisions a spec needs, by asking the human a few tappable
questions before any spec file is written. It runs at the start of every new feature, bugfix or
chore (`/spec-new`) unless the human says "skip the questions".

## Roles

| Step | Who | What |
|---|---|---|
| Assess and prepare questions | `product-manager` (orchestrator when the role is disabled) | Reads the request and the context, decides what is unknown, writes an `intake` block |
| Ask | orchestrator (main session) | Shows the questions with the AskUserQuestion tool (tappable wizard), collects the answers |
| Write the spec | `product-manager` (orchestrator when disabled) | Writes `spec.md` from the answers and records every decision |

Subagents cannot use AskUserQuestion (Claude Code removes it from every subagent), so the
product-manager prepares the questions and the orchestrator asks them. The orchestrator never
answers a question on the human's behalf.

## Rounds and limits

- One AskUserQuestion call holds 1 to 4 questions; each question has 2 to 4 options, a header of
  at most 12 characters, and labels of 1 to 5 words. The tool adds "Other" (free text) to every question.
- Feature: round 1 has up to 4 questions on the decisions that change the most; round 2 (optional)
  has up to 4 follow-ups; a round 3 only for a blocking contradiction. Never more than 12 questions.
- Bugfix and chore: one round of up to 4 questions.
- Lite spec profiles (budget, minimal): at most 2 rounds and 6 questions in total; prefer assumptions for low-risk details.
- Stop as soon as no unknown would change scope, acceptance criteria, data, permissions or effort.

## What makes a good intake question

1. **Decision-critical.** Its answer changes what is built, what is not built, who may use it, what
   data is kept, or how success is judged. If a sensible default exists and the cost of being wrong
   is low, state it as an assumption instead of asking.
2. **Not answerable from the repository.** Read `specs/product/*` (vision, personas, glossary, NFRs),
   `specs/roadmap.md`, existing specs and the relevant code first. Never ask what is already written.
3. **Concrete options.** Each option is a real, mutually exclusive choice with its consequence in the
   description ("Only the owner can see it; simpler RLS"). Put the recommended option first and end
   its label with "(Recommended)".
4. **multiSelect for sets.** Use it for "which of these belong in the first release" and "which of
   these are explicitly out". Use single choice for trade-offs.
5. **Product language.** No table names, libraries or components. Technical choices belong to the
   solution-architect, unless they change the product (for example offline use or real-time updates).

## Decision checklist

Pick the questions from these decisions, most uncertain and most expensive first.

### Feature
| Decision | Typical question |
|---|---|
| Outcome | What problem does this solve, and what does success look like for the user? |
| Users and roles | Who uses it? Who must not see or do it? (roles, ownership, sharing) |
| First-release scope | Which capabilities are in the first release? (multiSelect) |
| Non-goals | Which tempting, adjacent capabilities are explicitly out? (multiSelect) |
| Entry point and main flow | Where does the user start, and what is the happy path? |
| Data | What is captured or shown, is any of it personal, how long is it kept, who owns it? |
| Rules and edge cases | Limits, duplicates, deletion (soft or hard), editing after submission, empty states |
| Notifications and integrations | Emails, webhooks, external services, imports or exports |
| Quality bars beyond the baseline | Volume, response time, languages, accessibility, compliance (see `specs/product/nfr.md`) |
| Success measure | Which observable result proves it works (metric, event, report)? |
| Release | Priority, deadline, gradual rollout or all at once |

### Bugfix
| Decision | Typical question |
|---|---|
| Expected behavior | What should happen instead? (offer the readings of the report) |
| Impact | Who is affected and how badly? (severity, workaround exists or not) |
| Reproduction | Where does it happen? (environment, browser or device, account type) |
| Fix scope | Fix only, fix and prevent similar cases, or also repair affected data? |

### Chore
| Decision | Typical question |
|---|---|
| Motivation | Why now? (security, cost, upgrade path, developer speed) |
| Boundary | What must not change? (behavior, API, data) |
| Risk | Is downtime or a behavior change acceptable? |

## The `intake` block (product-manager output)

The product-manager ends its Handoff with exactly one fenced block whose info string is `intake`,
containing JSON:

```intake
{
  "round": 1,
  "type": "feature",
  "understanding": "One short paragraph: the request restated in product terms.",
  "assumptions": [
    "Things the spec will assume unless the human objects, for example: only signed-in users."
  ],
  "questions": [
    {
      "id": "Q1",
      "decision": "first-release scope",
      "header": "Scope",
      "question": "Which capabilities belong in the first release?",
      "multiSelect": true,
      "options": [
        { "label": "Create and edit (Recommended)", "description": "Core value; everything else builds on it" },
        { "label": "CSV export", "description": "Useful for accountants; adds an export flow" },
        { "label": "Email reminders", "description": "Needs email delivery and scheduling" }
      ]
    }
  ],
  "ready": false
}
```

- `ready: true` with an empty `questions` list means the spec can be written now.
- `suggested_slug` (optional) proposes the spec folder name, for example `"invoice-export"`.

## Asking (orchestrator)

1. Send the human one short message with the `understanding` and the `assumptions` (they can
   correct them in the "Other" field or in chat).
2. Call AskUserQuestion with the questions of the round, mapped one to one (question, header,
   multiSelect, options with label and description). More than 4 questions means more calls.
3. Pass the answers back to the product-manager verbatim, one line per question:
   `Q1 (first-release scope): Create and edit; CSV export` and `Q3 (data): Other: "keep 2 years"`.
4. If the human says "use your recommendations", take the options marked "(Recommended)" and mark
   those answers as `recommended default` for the record.
5. Never invent an answer. If the human does not answer, stop and wait.

## Recording (spec writer)

Every answer and assumption goes into the spec section "Intake decisions" with its source
(`human`, `recommended default` or `assumption`). Non-goals chosen during the intake go into
"Out of scope". Unanswered but non-blocking points go into "Open questions".
