// SubagentStop: team agents must end with a structured Handoff block so the
// orchestrator can integrate results without re-reading everything.
export const HANDOFF_TEMPLATE = [
  '## Handoff',
  'Status: done | partial | blocked',
  'Summary: 2-4 sentences on what changed and why',
  'Files: created/changed files (paths)',
  'Checks: commands run and their results (tests, typecheck, database test run, advisors)',
  'Spec coverage: AC-IDs satisfied, AC-IDs pending',
  'Decisions: choices made (flag anything that needs an ADR)',
  'Follow-ups: work for other owners, risks, open questions',
  'Verdict: approve | changes-requested   (reviewers only)',
].join('\n');

export const COMPACT_TEMPLATE = [
  '## Handoff',
  'Status: done | partial | blocked',
  'Files: changed paths',
  'Checks: what ran, pass or fail',
  'Follow-ups: only what someone else must do (or "none")',
  'Verdict: approve | changes-requested   (reviewers only)',
].join('\n');

export async function run(ctx) {
  const policy = ctx.policies.handoff ?? {};
  if (policy.required === false) return null;
  const agent = ctx.input.agent_type;
  if (!ctx.h.enabledAgents.includes(agent)) return null;
  if (ctx.input.stop_hook_active) return null;
  const msg = String(ctx.input.last_assistant_message ?? '');
  const hasBlock = /^#{1,4}\s*Handoff\b/im.test(msg) && /Status:\s*\**\s*(done|partial|blocked)/i.test(msg);
  if (hasBlock) return null;
  return {
    block: true,
    reason: `Finish with the required Handoff block (the orchestrator relies on it):\n${policy.compact ? COMPACT_TEMPLATE : HANDOFF_TEMPLATE}`,
  };
}
