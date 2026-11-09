// Delegation routing: only the orchestrator delegates, only enabled team agents can be
// used (disabled ones are refused with their fallback) and, when the profile policy
// requires it (policies.delegation.requireBrief), briefs carry Spec, Task and Deliverables.
// Pinned models (policies.delegation.pinModels, budget profile): each agent runs on the model of
// the profile's preset (Opus for product-manager and solution-architect, Sonnet for the builders
// and the quick security check). The orchestrator cannot raise it, with one exception: a brief with
// an "Escalation:" line (a retry after a failed or partial attempt) runs a builder on Opus once.
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'harness', 'lib');
const { modelFor } = await import(pathToFileURL(path.join(LIB, 'config.mjs')).href);
const BUILDERS = new Set(['backend-engineer', 'frontend-engineer', 'media-engineer', 'ai-agent-engineer', 'integrations-engineer', 'platform-engineer']);

function pinModel(ctx, type) {
  const prompt = String(ctx.toolInput.prompt ?? '');
  const escalation = BUILDERS.has(type) && /^\s*[*_-]*\s*Escalation:\s*\S/im.test(prompt);
  const asked = ctx.toolInput.model;
  if (!asked && !escalation) return null; // the agent file already carries the profile's model
  const target = escalation ? 'opus' : modelFor(ctx.h, type);
  if (target === 'inherit' || asked === target) return null;
  return {
    decision: 'allow',
    updatedInput: { ...ctx.toolInput, model: target },
    context: escalation
      ? `[harness] ${type} runs on opus for this retry (Escalation).`
      : `[harness] ${type} runs on ${target} in this profile; the requested model ${asked} was replaced. To retry a failed task on opus, add an "Escalation: <what failed>" line to the brief.`,
  };
}

const BRIEF_TEMPLATE = [
  'Spec: specs/<id>-<slug> (or "none: exploration only")',
  'Task: T-00X from tasks.md (or a one-line goal)',
  'Goal: what outcome is needed and why',
  'Inputs: files, docs and decisions to read first',
  'Deliverables: files to create or change, reports to write',
  'Acceptance: AC-IDs and checks to run (tests, typecheck, database test run)',
  'Constraints: scope limits, things not to touch',
].join('\n');

export async function run(ctx) {
  if (ctx.tool !== 'Agent' && ctx.tool !== 'Task') return null;
  if (ctx.isSubagent) {
    return { decision: 'deny', reason: 'Only the orchestrator delegates. Finish your task and list follow-ups in your Handoff.' };
  }
  const type = ctx.toolInput.subagent_type ?? '';
  if (!ctx.h.allAgents.includes(type)) return null; // built-in or plugin agents are not policed here
  if (!ctx.h.enabledAgents.includes(type)) {
    const fb = (ctx.h.fallbacks[type] ?? []).filter((a) => a === 'main' || ctx.h.enabledAgents.includes(a));
    return {
      decision: 'deny',
      reason: `Agent "${type}" is disabled in the "${ctx.h.profileName}" profile. Route the work to: ${fb.join(' or ') || 'the owning agent from .claude/rules/00-delegation.md'}.`,
    };
  }
  const policy = ctx.policies.delegation ?? {};
  const routed = policy.pinModels ? pinModel(ctx, type) : null;
  if (!policy.requireBrief) return routed;
  const prompt = String(ctx.toolInput.prompt ?? '');
  const fields = policy.briefFields ?? ['Spec:', 'Task:', 'Deliverables:'];
  const missing = fields.filter((f) => !new RegExp(`^\\s*[*_-]*\\s*${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'im').test(prompt));
  if (missing.length) {
    return {
      decision: 'deny',
      reason: `Delegation brief for ${type} is missing ${missing.join(', ')}. Use this structure:\n${BRIEF_TEMPLATE}`,
    };
  }
  return routed;
}
