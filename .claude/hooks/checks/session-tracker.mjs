// Always-on bookkeeping used by the stop gate and the activity log.
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'harness', 'lib');
const { EDIT_TOOLS, editTarget, isCodePath } = await import(pathToFileURL(path.join(LIB, 'edits.mjs')).href);

export async function run(ctx) {
  const { event, input } = ctx;
  if (event === 'PostToolUse' && EDIT_TOOLS.has(ctx.tool)) {
    const rel = ctx.rel(editTarget(ctx.tool, ctx.toolInput));
    if (rel === null) return null;
    ctx.record({ type: 'edit', path: rel, code: isCodePath(rel), actor: ctx.actor, tool: ctx.tool });
    ctx.log({ tool: ctx.tool, decision: 'edited', path: rel });
    return null;
  }
  if (event === 'SubagentStart') {
    ctx.record({ type: 'agent-start', agent: input.agent_type, agentId: input.agent_id });
    ctx.log({ agent: input.agent_type, decision: 'agent-start' });
    return null;
  }
  if (event === 'SubagentStop') {
    const msg = input.last_assistant_message ?? '';
    const status = msg.match(/Status:\s*\**\s*(done|partial|blocked)/i)?.[1]?.toLowerCase() ?? 'unknown';
    const verdict = msg.match(/Verdict:\s*\**\s*(approve|approved|changes-requested|reject)/i)?.[1]?.toLowerCase() ?? null;
    ctx.record({ type: 'agent-stop', agent: input.agent_type, agentId: input.agent_id, status, verdict });
    ctx.log({ agent: input.agent_type, decision: 'agent-stop', status, verdict });
    return null;
  }
  return null;
}
