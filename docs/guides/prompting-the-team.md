# Prompting the team: a guide for humans

You talk to one Claude session, the orchestrator. It does not write the product itself: it runs the intake, delegates every artifact to a specialist agent, checks their work and tells you what needs your decision. Good prompts give it a clear outcome and boundaries; the harness takes care of the process.

You only ever type three kinds of messages: requests ("New feature: ..."), answers to the questions, and the two approvals (`approve spec <id>` to start building, `send to production` after your test). Claude runs every harness command itself. The status line at the bottom of Claude Code shows the active spec and the database state.

## 1. The shape of a good prompt

Describe the outcome and its boundaries, not the implementation.

| Element | Ask yourself | Example |
|---|---|---|
| Goal | What should be possible afterwards that is not possible now? | "Workspace owners can export invoices as CSV" |
| Who and why | Who uses it, and what problem does it solve for them? | "for their accountant, who asks us by email every month" |
| In scope | What must the first version do? | "filter by date range" |
| Out of scope | What is tempting but not now? | "no Excel, no scheduled exports" |
| Constraints | Deadlines, rules, data limits, compliance | "customer names are personal data; keep EU residency" |
| Done when | How will you judge it? | "my accountant can import the file without edits" |
| References | Screens, emails, links, existing specs | "see spec 004 for the invoice fields" |

You do not need all seven. Goal plus one or two boundaries is enough to start: the intake asks for the rest.

Avoid prescribing tables, components or libraries ("add a column `exported_at`", "use react-table"). Specialists decide those in the design step, and you approve the result there. Say it only when it is a real constraint ("must work with our existing Stripe account").

## 2. The intake wizard

Every new feature, bugfix or chore starts with an intake. The product-manager reads your request together with the product files, existing specs and code. It then prepares a few questions about the decisions that shape the spec:
- what is in and what is explicitly out;
- who may use it;
- what data it touches;
- the rules and edge cases;
- how success is measured.

The orchestrator shows them as tappable questions, up to 4 at a time and usually one or two rounds.

- **Answer by tapping.** The first option is the recommendation. Multi-select questions ("which of these belong in the first release?") let you tap several.
- **Use "Other"** to type your own answer or to correct an assumption shown before the questions.
- **"Use your recommendations"** accepts every recommended option; the spec records them as recommended defaults.
- **"Skip the questions"** goes straight to a spec built on assumptions, all listed in its "Intake decisions" section for you to check.
- Answers land in the spec ("Intake decisions" and "Out of scope"), so you can review and change them before approving.

## 3. Recipes for everyday requests

### A new feature
```
New feature: <goal in one sentence>.
Users: <who>, because <problem>.
Must include: <1 to 3 items>. Not now: <tempting extras>.
Done when: <observable result>.
```
Example: "New feature: members can comment on a task. Users: team members coordinating work, because today they use email. Must include: plain text comments, edit and delete own comments. Not now: mentions, attachments, notifications. Done when: a member sees new comments without reloading."

What follows: questions, the spec, your approval (`approve spec <id>`), the build on the development database (and the workers locally or on the `-dev` Fly apps), your test on http://localhost:3000, and `send to production`.

### Fixing something
```
Bug: <what happens> when <steps or context>.
Expected: <what should happen>. Since: <when it started, if known>.
Affects: <who, how badly; workaround if any>.
```
Example: "Bug: the invoice total shows 0 when an invoice has a discount line. Expected: total minus the discount. Since the last release. Affects every customer with discounts; no workaround."

Paste error messages and the page or URL where it happens. Do not paste secrets, tokens or personal data. What follows: the product-manager reads the code and logs to understand it, one question round at most, a bugfix spec with a regression test, your approval, the fix, your test, `send to production`.

### A small change or chore
```
Chore: <change> because <reason>. Must not change: <behavior or data>.
```
Example: "Chore: upgrade Next.js to the latest patch because of the security advisory. Must not change any behavior."

### Continuing, checking, steering
- "Where are we?" or `/progress`: specs by status, the active spec, what waits for you.
- "Continue spec 007" or `/spec-build 007`: picks up where the build stopped.
- "Spec 007: the save button does nothing on mobile": after your test, fixes go back to the owners.
- "Pause spec 007 and start the login bug first": the orchestrator parks one and opens the other.
- "Change of scope for spec 007: drop mentions, add email notifications": it updates the spec; you approve again because approved requirements changed.

### Database changes
Ask for the outcome ("store the reason when an invoice is cancelled"), not the SQL. The database owner writes the spec's change script, applies it to the development project and runs the database tests there. Production gets the same script only after you type `send to production`. You never need a local database.

## 4. Your decisions (human-only)

| Decision | How |
|---|---|
| Start building a spec | Type `approve spec <id>` as a message on its own. A hook records it; Claude cannot approve for you |
| Put a tested change live | Type `send to production` (or `send spec <id> to production`) as a message on its own |
| Accept a risk or an ADR | Edit or confirm the file Claude points to |
| Secrets and environment variables | Fly.io secrets, Supabase dashboard, the web host once chosen |

## 5. Who does the work

The thinking happens once, on Opus: the product-manager settles the requirements and the solution-architect writes a plan with files, approach and a check per task, naming the owner of each task (backend, frontend, media, ai-agent, integrations or platform engineer). The builders run on Sonnet and follow it; a task that fails is retried once on Opus. A security-auditor quick check runs before you test. You approve the spec and the plan together. Short, concrete requests work best: "Bug: ... Expected: ...", and name the screen or worker when you know it ("the render worker cuts the captions short").

## 6. Habits that save time

- **One request per prompt.** Two features in one message become two specs anyway; say which comes first.
- **Name the spec id** when you continue work ("spec 007"), and the bug's place ("checkout page, Safari").
- **Say what must not change** in refactors and fixes.
- **Answer the questions instead of writing essays up front**: it asks what actually matters for the spec.
- **Read the spec before approving.** The "Intake decisions" and "Out of scope" sections show what Claude understood.
- **When a hook blocks Claude**, it is the process speaking (no spec, wrong owner, unsafe command). Ask "why were you blocked?" (or `/harness why`) instead of asking it to work around the rule.

## 7. Quick reference

| You want | Say |
|---|---|
| A new feature | "New feature: ..." (then answer the wizard) |
| Accept all recommendations | "Use your recommendations" |
| Approve a spec | `approve spec 007` (a message on its own) |
| No questions this time | "Skip the questions" |
| A fix | "Bug: ... Expected: ..." |
| Status | "Where are we?" or `/progress` |
| Continue | "Continue spec 007" or `/spec-build 007` |
| Report a problem after testing | "Spec 007: ..." |
| Put it live | `send to production` (a message on its own) |
| Change scope | "Change of scope for spec 007: ..." |
| Adapt the harness | `/harness` |
