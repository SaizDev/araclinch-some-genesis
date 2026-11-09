// Delegation enforcement for file edits: the orchestrator delegates, agents stay in their zones.
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'harness', 'lib');
const { EDIT_TOOLS, editTarget } = await import(pathToFileURL(path.join(LIB, 'edits.mjs')).href);

export async function run(ctx) {
  if (!EDIT_TOOLS.has(ctx.tool)) return null;
  const mode = ctx.policies.ownership?.mode ?? 'enforce';
  if (mode === 'off') return null;
  const rel = ctx.rel(editTarget(ctx.tool, ctx.toolInput));
  if (rel === null || rel === '') return null;
  const verdict = ctx.ownership.check(ctx.actor, rel);
  if (verdict.decision === 'allow') return null;
  if (mode === 'warn') return { context: `[harness warning: ownership] ${verdict.reason}` };
  return { decision: verdict.decision, reason: verdict.reason };
}
