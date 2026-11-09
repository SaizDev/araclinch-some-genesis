// Stop gate for the main session. Before Claude ends a turn that changed code:
// typecheck and lint must pass, and completed specs must have been reviewed (per profile). Blocks at most `maxBlocksPerTurn` times per prompt.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'harness', 'lib');
const { readEvents, summarizeSession, stopBlocksFor } = await import(pathToFileURL(path.join(LIB, 'state.mjs')).href);
const { readJson, truncate } = await import(pathToFileURL(path.join(LIB, 'util.mjs')).href);
const { matchAny } = await import(pathToFileURL(path.join(LIB, 'glob.mjs')).href);
const spec = await import(pathToFileURL(path.join(LIB, 'spec.mjs')).href);

function runCmd(root, cmd, args, timeoutSec) {
  const res = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', timeout: timeoutSec * 1000, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } });
  if (res.error?.code === 'ENOENT') return null;
  if (res.error?.code === 'ETIMEDOUT' || res.signal) return { ok: true, timedOut: true, output: '' };
  return { ok: res.status === 0, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

function typecheck(root, pm, timeoutSec) {
  const pkg = readJson(path.join(root, 'package.json'), null);
  if (!pkg) return null;
  if (pkg.scripts?.typecheck) return runCmd(root, pm, ['run', 'typecheck'], timeoutSec);
  const tsc = path.join(root, 'node_modules', '.bin', 'tsc');
  if (fs.existsSync(tsc) && fs.existsSync(path.join(root, 'tsconfig.json'))) return runCmd(root, tsc, ['--noEmit', '-p', '.'], timeoutSec);
  return null;
}

function lint(root, files, timeoutSec) {
  const eslint = path.join(root, 'node_modules', '.bin', 'eslint');
  const targets = files.filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f) && fs.existsSync(path.join(root, f)));
  if (!fs.existsSync(eslint) || !targets.length) return null;
  return runCmd(root, eslint, ['--no-warn-ignored', ...targets], timeoutSec);
}

export async function run(ctx) {
  const policy = ctx.policies.stopGate ?? {};
  const events = readEvents(ctx.root, ctx.sessionId);
  const blocks = stopBlocksFor(events, ctx.promptId);
  const max = policy.maxBlocksPerTurn ?? 2;
  if (blocks >= max) {
    return { systemMessage: `[harness] Stop gate released after ${blocks} blocks this turn. Unresolved items remain; review them before merging.` };
  }
  const s = summarizeSession(events);
  const timeout = policy.commandTimeoutSec ?? 240;
  const pm = ctx.h.config.stack?.packageManager ?? 'pnpm';
  const warnings = [];
  let reason = null;

  // 1. Typecheck and lint when code changed since the last successful typecheck.
  const codeChangedSinceCheck = s.codePaths.length > 0 && (!s.lastTypecheckOk || s.lastCodeEdit > s.lastTypecheckOk);
  if (!reason && policy.typecheck && codeChangedSinceCheck) {
    const r = typecheck(ctx.root, pm, timeout);
    if (r && !r.ok) {
      reason = `Typecheck failed. Route each error to the owning agent (do not fix application code yourself):\n${truncate(r.output.trim(), 2500)}`;
    } else if (r?.ok && !r.timedOut) {
      ctx.record({ type: 'typecheck-ok' });
    }
  }
  if (!reason && policy.lint && s.codePaths.length > 0) {
    const r = lint(ctx.root, s.codePaths, timeout);
    if (r && !r.ok) reason = `Lint errors in files changed this session. Route fixes to the owning agents:\n${truncate(r.output.trim(), 2500)}`;
  }

  // 2. Review before a spec is considered implemented.
  if (!reason && policy.reviewAfterCodeChange && s.codePaths.length > 0) {
    const active = spec.resolveActiveSpec(ctx.root, ctx.env).spec;
    const tasks = active?.files['tasks.md'] ? spec.parseTasks(fs.readFileSync(path.join(active.abs, 'tasks.md'), 'utf8')) : [];
    const complete = active && (['implemented', 'verified'].includes(active.status) || (tasks.length > 0 && tasks.every((t) => t.status === 'done')));
    if (complete) {
      const required = (policy.reviewers ?? ['code-reviewer']).filter((a) => ctx.h.enabledAgents.includes(a));
      if (ctx.h.enabledAgents.includes('security-auditor') && s.codePaths.some((p) => matchAny(p, policy.securityReviewPaths ?? []))) {
        required.push('security-auditor');
      }
      const reviewed = new Set(
        s.agentRuns.filter((r) => r.at >= s.lastCodeEdit && (r.status !== 'unknown' || r.verdict)).map((r) => r.agent),
      );
      const missing = [...new Set(required)].filter((a) => !reviewed.has(a));
      if (missing.length) {
        reason =
          `Spec ${active.id} looks complete but ${missing.join(' and ')} has not reviewed the latest changes. ` +
          `Run the review step of /spec-build (delegate the review with a brief whose Deliverables are specs/${active.id}-${active.slug}/reviews/*.md). ` +
          'If the human explicitly asked to stop without review, say so in one line and end the turn.';
      }
    }
  }

  if (reason) {
    ctx.record({ type: 'stop-block', prompt: ctx.promptId });
    ctx.log({ decision: 'stop-block', reason: reason.slice(0, 300) });
    return { block: true, reason, systemMessage: warnings.length ? `[harness] ${warnings.join(' ')}` : undefined };
  }
  return warnings.length ? { systemMessage: `[harness] ${warnings.join(' ')}` } : null;
}
