// Spec approval from the chat. Claude Code hands this hook the exact text the human typed, before
// Claude sees it; Claude and its agents cannot produce that text. So a message that is only
// "approve spec 003" (one or more ids) is a human approval, recorded here like the terminal
// command does. Anything longer is ignored, so "do not approve spec 003 yet" never approves.
// "send to production" (or "send spec 003 to production", "release spec 003", "enviar a producción")
// works the same way: it records the production approval for the spec, with the hash of its change
// script (supabase/changes/<id>-<slug>.sql) if it has one. The mcp-guard hook then lets
// "-- devharness:release 003" through on supabase-release for that exact script, and the bash guard
// lets the merge into main and the push through.
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'harness', 'lib');
const spec = await import(pathToFileURL(path.join(LIB, 'spec.mjs')).href);
const { recordApproval } = await import(pathToFileURL(path.join(LIB, 'cli-spec.mjs')).href);
const { gitUserName } = await import(pathToFileURL(path.join(LIB, 'git.mjs')).href);
const ops = await import(pathToFileURL(path.join(LIB, 'db-ops.mjs')).href);

const VERB = /^\s*(?:approve|aprobar|apruebo|aprueba)\s+(?:the\s+|la\s+|el\s+)?(?:specs?|especificaci[oó]n(?:es)?)\s+(.+?)\s*[.!]?\s*$/i;
const RELEASE_VERB = /^\s*(?:release|desplegar|despliega|publicar|publica)\s+(?:the\s+|la\s+|el\s+)?(?:specs?|especificaci[oó]n(?:es)?)\s+(.+?)\s*[.!]?\s*$/i;
// "send to production", "send spec 3 to production", "ship it to prod", "enviar a producción", "manda la spec 3 a producción".
const SEND_EN = /^\s*(?:please\s+)?(?:send|ship|deploy|push|move)\s+(?:it\s+|this\s+|that\s+)?(?:(?:the\s+)?(?:spec\s+)?#?(\d{1,4})\s+)?to\s+prod(?:uction)?\s*(?:please)?\s*[.!]?\s*$/i;
const SEND_ES = /^\s*(?:por\s+favor\s+)?(?:enviar|env[ií]a|envialo|env[ií]alo|mandar|manda|m[aá]ndalo|pasar|pasa|p[aá]salo|subir|sube|s[uú]belo|desplegar|despliega|despli[eé]galo)\s+(?:(?:la\s+)?(?:spec\s+|especificaci[oó]n\s+)?#?(\d{1,4})\s+)?(?:a|en)\s+producci[oó]n\s*[.!]?\s*$/i;
const ID_LIST = /^#?\d{1,4}(?:(?:\s*(?:,|&|\band\b|\by\b)\s*|\s+)#?\d{1,4})*$/i;

// "approve spec 003", "approve specs 3, 4 and 7", "aprobar spec 12". Returns the ids or null.
export function parseApproval(prompt) {
  const m = VERB.exec(String(prompt ?? ''));
  if (!m || !ID_LIST.test(m[1].trim())) return null;
  return [...new Set([...m[1].matchAll(/\d{1,4}/g)].map((x) => x[0]))];
}

// "send to production" (active spec), "send spec 3 to production", "release spec 3", "enviar a producción".
// Returns { ids } (empty ids = the active spec) or null.
export function parseRelease(prompt) {
  const text = String(prompt ?? '');
  const m = RELEASE_VERB.exec(text);
  if (m) return ID_LIST.test(m[1].trim()) ? { ids: [...new Set([...m[1].matchAll(/\d{1,4}/g)].map((x) => x[0]))] } : null;
  const s = SEND_EN.exec(text) ?? SEND_ES.exec(text);
  if (!s) return null;
  return { ids: s[1] ? [s[1]] : [] };
}

function release(ctx, ids, approver) {
  if (!ids.length) {
    const active = spec.resolveActiveSpec(ctx.root, ctx.env).spec;
    if (!active) {
      return {
        systemMessage: '[harness] Not recorded: no active spec. Type "send spec <id> to production".',
        context: '[harness] The human asked to send to production, but there is no active spec (branch or pnpm harness spec activate). Ask which spec, in one line.',
      };
    }
    ids = [active.id];
  }
  const done = [];
  const failed = [];
  for (const id of ids) {
    const { spec: s, rel, sql } = ops.changeScript(ctx.root, id);
    if (!s) {
      failed.push(`spec ${id} does not exist`);
      continue;
    }
    if (!s.meta?.approved_hash && ctx.h.checkOn('spec-gate')) {
      failed.push(`spec ${s.id} was never approved`);
      continue;
    }
    const problems = sql === null ? [] : ops.scriptProblems(sql);
    if (problems.length) {
      failed.push(`${rel}: ${problems.join('; ')}`);
      continue;
    }
    const hash = sql === null ? null : ops.sha(sql);
    ops.recordReleaseApproval(ctx.root, s.id, { by: approver, hash, branch: spec.resolveActiveSpec(ctx.root, ctx.env).branch ?? null });
    ctx.log({ decision: 'production-approved', spec: s.id, hash, via: 'chat' });
    done.push({ id: s.id, label: `${s.id}-${s.slug}${sql === null ? ' (no database change)' : ` (database change ${rel})`}` });
  }
  const lines = [];
  if (done.length) lines.push(`Production approved by ${approver}: ${done.map((d) => d.label).join(', ')}.`);
  if (failed.length) lines.push(`Not approved: ${failed.join('; ')}.`);
  return {
    systemMessage: `[harness] ${lines.join(' ')}`,
    context:
      `[harness] The human typed "${String(ctx.input.prompt).trim()}". ${lines.join(' ')} ` +
      'The approval is recorded (valid 24 hours): do not write any approval file. ' +
      (done.length ? `Run /spec-ship ${done.map((d) => d.id).join(' ')} now: database release first (if any), then merge into main and push, then the schema snapshot.` : ''),
  };
}

export async function run(ctx) {
  if (ctx.isSubagent) return null;
  const rel = parseRelease(ctx.input.prompt);
  if (rel) return release(ctx, rel.ids, gitUserName(ctx.root) || os.userInfo().username);
  const ids = parseApproval(ctx.input.prompt);
  if (!ids) return null;
  const approver = gitUserName(ctx.root) || os.userInfo().username;
  const done = [];
  const failed = [];
  for (const id of ids) {
    const s = spec.findSpec(ctx.root, id);
    if (!s) {
      failed.push(`spec ${id} does not exist`);
      continue;
    }
    if (s.meta?.approved_hash && s.meta.approved_hash === s.currentHash && spec.POST_APPROVAL.includes(s.status)) {
      done.push(`${s.id}-${s.slug} (already approved, unchanged)`);
      continue;
    }
    try {
      const r = recordApproval(ctx.h, s, approver, 'chat');
      done.push(`${s.id}-${s.slug} (${r.hash})`);
      ctx.log({ decision: 'spec-approved', spec: s.id, via: 'chat' });
    } catch (err) {
      failed.push(`spec ${s.id}: ${err.message}`);
    }
  }
  const lines = [];
  if (done.length) lines.push(`Approved from the chat by ${approver}: ${done.join(', ')}.`);
  if (failed.length) lines.push(`Not approved: ${failed.join('; ')}.`);
  return {
    systemMessage: `[harness] ${lines.join(' ')}`,
    context:
      `[harness] The human approved specs by typing "${String(ctx.input.prompt).trim()}". ${lines.join(' ')} ` +
      'The approval is already recorded in spec.md: do not run any approval command and do not edit the approval fields. ' +
      `Confirm in one line and start /spec-build ${done.map((d) => d.split('-')[0]).join(' ') || '<id>'} right away (dispatch the work to the team). ` +
      (failed.length ? 'For specs that were not approved, explain what is missing.' : ''),
  };
}
