// Context injection: session start (and after compaction), prompt submit and subagent start.
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'harness', 'lib');
const spec = await import(pathToFileURL(path.join(LIB, 'spec.mjs')).href);
const { dbStatus } = await import(pathToFileURL(path.join(LIB, 'db-ops.mjs')).href);
const { modelFor } = await import(pathToFileURL(path.join(LIB, 'config.mjs')).href);

function specLine(ctx) {
  const policy = ctx.policies.specGate ?? {};
  const active = spec.resolveActiveSpec(ctx.root, ctx.env);
  if (!active.spec) {
    return { active, text: `Active spec: none${active.branch ? ` (branch ${active.branch})` : ''}.` };
  }
  const s = active.spec;
  const gate = spec.evaluateGate(s, policy);
  const hash = s.meta?.approved_hash ? (s.meta.approved_hash === s.currentHash ? 'approval current' : 'CHANGED SINCE APPROVAL') : 'no approval hash';
  return {
    active,
    gate,
    text: `Active spec: ${s.id}-${s.slug} "${s.title}" [${s.type}, ${s.status}, ${hash}] via ${active.source}. Gate: ${gate.ok ? 'open' : `closed (${gate.problems.join(' ')})`}`,
  };
}

function sessionContext(ctx) {
  const { h } = ctx;
  const policy = ctx.policies.specGate ?? {};
  const lines = [];
  lines.push(
    `[harness] Profile "${h.profileName}". Team: ${h.enabledAgents.join(', ')}.`,
    'You are the ORCHESTRATOR. Flow: (1) the human asks; (2) product-manager runs the intake, you relay its questions with AskUserQuestion; (3) product-manager writes the spec, the human types "approve spec <id>"; ' +
      '(4) /spec-build dispatches the work per .claude/rules/00-delegation.md; (5) the team applies database changes to the development Supabase project, reviews per profile, and you start the local server for the human to test; ' +
      '(6) the human types "send to production", then /spec-ship releases the database change, merges to main and pushes. You never write application code, schema or tests yourself.',
    `Spec gate: ${h.checkOn('spec-gate') ? policy.mode ?? 'strict' : 'off'}.`,
  );
  const sl = specLine(ctx);
  lines.push(sl.text);
  if (sl.active.spec) {
    const next = spec.nextTasks(sl.active.spec, 4);
    if (next.length) lines.push(`Next tasks: ${next.map((t) => `${t.id} [${t.owner ?? '?'}] ${t.title}${t.status === 'in-progress' ? ' (in progress)' : ''}`).join('; ')}`);
  }
  const waiting = spec.listSpecs(ctx.root).filter((s) => s.status === 'in-review');
  if (waiting.length) lines.push(`Waiting for human approval: ${waiting.map((s) => `${s.id}-${s.slug}`).join(', ')} (the human approves by typing "approve spec <id>" in the chat).`);
  const db = dbStatus(ctx.root);
  const pending = db.pending;
  if (pending.length) {
    lines.push(`Database change scripts not yet released to production: ${pending.map((p) => `${p.file}${p.approval ? ' (release approved)' : ''}`).join(', ')}.`);
  }
  const sb = h.config.stack?.supabase ?? {};
  if (!sb.dev?.projectRef || !sb.prod?.projectRef) {
    lines.push(`Supabase projects not configured: ${[!sb.dev?.projectRef && 'development', !sb.prod?.projectRef && 'production'].filter(Boolean).join(' and ')}. Ask the human for the project ref and run pnpm harness supabase dev|prod <ref>.`);
  }
  lines.push('Commands: /spec-new, /spec-build, /spec-ship, /db-change, /db-snapshot, /progress, /harness.');
  return lines.join('\n');
}

const BUILD_INTENT = /\b(implement|build|add|create|develop|code|fix|refactor|migrate|integrate|scaffold|wire|hook up|ship)\b/i;

function promptContext(ctx) {
  if (!ctx.h.checkOn('spec-gate')) return null;
  const policy = ctx.policies.specGate ?? {};
  if ((policy.mode ?? 'strict') === 'off') return null;
  const prompt = String(ctx.input.prompt ?? ctx.input.prompt_text ?? '');
  if (!BUILD_INTENT.test(prompt)) return null;
  const sl = specLine(ctx);
  if (sl.gate?.ok) return null;
  return (
    '[harness] Spec-first reminder: there is no active spec whose gate is open. Start with /spec-new: the product-manager runs the intake (you relay its questions with AskUserQuestion), writes the spec, and the human approves it by typing "approve spec <id>". Questions and research can proceed normally.'
  );
}

function subagentContext(ctx) {
  const agent = ctx.input.agent_type ?? 'subagent';
  const sl = specLine(ctx);
  if (!ctx.h.allAgents.includes(agent)) {
    return `[harness] You are "${agent}". Prefer read-only exploration. Writes to owned paths (src, supabase, specs, docs...) are denied for agents outside the team roster.`;
  }
  const zones = ctx.ownership.zonesOwnedBy(agent).flatMap((z) => z.paths);
  if (ctx.policies.handoff?.compact) {
    return [
      `[harness] You are "${agent}". ${sl.text}`,
      `You may write only: ${zones.length ? zones.join(', ') : 'report files assigned to you'}.`,
      'Read only what the brief names plus what you must open to do the task. Do not delegate. End with a short Handoff: Status, Files, Checks, Follow-ups (reviewers add Verdict).',
    ].join('\n');
  }
  return [
    `[harness] You are "${agent}" (model ${modelFor(ctx.h, agent)}) on a spec-first product team led by the orchestrator.`,
    sl.text,
    `You may write only: ${zones.length ? zones.join(', ') : 'report files assigned to you'}. Other paths are denied by hooks: put needed changes under Follow-ups.`,
    'Do not delegate. Stay inside the brief. Run the checks your definition of done requires. End with the Handoff block (Status, Summary, Files, Checks, Spec coverage, Decisions, Follow-ups; reviewers add Verdict).',
  ].join('\n');
}

export async function run(ctx) {
  if (ctx.event === 'SessionStart') return { context: sessionContext(ctx) };
  if (ctx.event === 'UserPromptSubmit') {
    const c = promptContext(ctx);
    return c ? { context: c } : null;
  }
  if (ctx.event === 'SubagentStart') return { context: subagentContext(ctx) };
  return null;
}
