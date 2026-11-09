// Spec-first enforcement:
// 1. Code edits (policy.gatedPaths) require an active spec that passes the gate.
// 2. Agents cannot approve specs or tamper with approval metadata.
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'harness', 'lib');
const { EDIT_TOOLS, editTarget, projectedContent, currentContent } = await import(pathToFileURL(path.join(LIB, 'edits.mjs')).href);
const { parseFrontmatter } = await import(pathToFileURL(path.join(LIB, 'frontmatter.mjs')).href);
const { matchAny } = await import(pathToFileURL(path.join(LIB, 'glob.mjs')).href);
const spec = await import(pathToFileURL(path.join(LIB, 'spec.mjs')).href);

const SPEC_MD = /^specs\/(\d{3,4})-[a-z0-9-]+\/spec\.md$/;
const APPROVAL_FIELDS = ['approved_by', 'approved_at', 'approved_hash', 'approved_via'];

function canAgentApprove(policy, actor, type) {
  if (actor !== 'product-manager') return false;
  if (policy.approval === 'agents') return true;
  if (policy.approval === 'tiered') return type === 'bugfix' || type === 'chore';
  return false;
}

function protectSpecFile(ctx, rel, policy) {
  const before = currentContent(ctx.root, ctx.tool, ctx.toolInput);
  const after = projectedContent(ctx.root, ctx.tool, ctx.toolInput) ?? '';
  const oldFm = before ? parseFrontmatter(before).data : {};
  const newFm = parseFrontmatter(after).data;
  const oldStatus = oldFm.status ?? (before ? 'draft' : null);
  const newStatus = newFm.status ?? 'draft';
  const type = newFm.type ?? oldFm.type ?? 'feature';

  if (!spec.STATUSES.includes(newStatus)) {
    return { decision: 'deny', reason: `Unknown spec status "${newStatus}". Use one of: ${spec.STATUSES.join(', ')}.` };
  }
  const tamperedApproval = APPROVAL_FIELDS.some((f) => String(oldFm[f] ?? '') !== String(newFm[f] ?? ''));
  const crossesApproval = spec.POST_APPROVAL.includes(newStatus) && !spec.POST_APPROVAL.includes(oldStatus ?? 'draft');
  if ((tamperedApproval || crossesApproval) && !canAgentApprove(policy, ctx.actor, type)) {
    return {
      decision: 'deny',
      reason:
        'Spec approval is human-only. You may set status to draft or in-review. ' +
        `When the spec is ready, ask the human to type \`approve spec ${SPEC_MD.exec(rel)?.[1] ?? '<id>'}\` in the chat.`,
    };
  }
  if (before && spec.POST_APPROVAL.includes(oldStatus) && oldFm.approved_hash) {
    const changed = spec.specHash(before) !== spec.specHash(after);
    if (changed) {
      return {
        context:
          '[harness] You are changing the requirements of an approved spec. The spec gate will block code for this spec until the human re-approves it ' +
          '(the human types "approve spec <id>" in the chat again). Record the change in the spec Changelog section and tell the human why.',
      };
    }
  }
  return null;
}

export async function run(ctx) {
  if (!EDIT_TOOLS.has(ctx.tool)) return null;
  const policy = ctx.policies.specGate ?? {};
  const rel = ctx.rel(editTarget(ctx.tool, ctx.toolInput));
  if (!rel) return null;

  if (SPEC_MD.test(rel)) return protectSpecFile(ctx, rel, policy);

  const mode = policy.mode ?? 'strict';
  if (mode === 'off') return null;
  if (!matchAny(rel, policy.gatedPaths ?? ['src/**'])) return null;

  const active = spec.resolveActiveSpec(ctx.root, ctx.env);
  const gate = spec.evaluateGate(active.spec, policy);
  if (gate.ok) return null;
  const msg = `Spec-first gate for ${rel}: ${gate.problems.join(' ')}`;
  if (mode === 'warn') return { context: `[harness warning: spec gate] ${msg}` };
  return { decision: 'deny', reason: msg };
}
