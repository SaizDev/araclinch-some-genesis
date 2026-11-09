// Spec discovery, hashing, active-spec resolution and gate evaluation.
import fs from 'node:fs';
import path from 'node:path';
import { HARNESS_DIR, exists, listDirs, readText, sha256 } from './util.mjs';
import { parseFrontmatter, stripFrontmatter } from './frontmatter.mjs';
import { currentBranch } from './git.mjs';

export const SPEC_ROOT = 'specs';
export const SPEC_DIR_RE = /^(\d{3,4})-([a-z0-9][a-z0-9-]*)$/;
export const TYPES = ['feature', 'bugfix', 'chore'];
export const STATUSES = [
  'draft',
  'in-review',
  'approved',
  'in-progress',
  'implemented',
  'verified',
  'released',
  'on-hold',
  'superseded',
  'rejected',
];
export const PRE_APPROVAL = ['draft', 'in-review', 'on-hold', 'rejected', 'superseded'];
export const POST_APPROVAL = ['approved', 'in-progress', 'implemented', 'verified', 'released'];
export const SPEC_FILES = ['spec.md', 'design.md', 'data-model.md', 'ui.md', 'api.md', 'test-plan.md', 'tasks.md'];

export function normalizeId(id) {
  const digits = String(id ?? '').match(/\d+/)?.[0];
  if (!digits) return null;
  return digits.padStart(3, '0');
}

// Task marks ([ ], [~], [x], [!]) are progress, not requirements: they do not change the hash, so
// a lite spec that carries its plan can be ticked off without closing the gate.
export function specHash(specText) {
  const body = stripFrontmatter(specText)
    .replace(/\r\n/g, '\n')
    .replace(/^(\s*[-*]\s+)\[(?: |x|X|~|!)\](\s+T-\d+)/gm, '$1[ ]$2')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .trim();
  return `sha256:${sha256(body).slice(0, 16)}`;
}

export const TEMPLATE_MARKER = '<!-- harness:template -->';

// A spec document counts only when it exists and no longer carries the template marker.
function docState(file) {
  const text = readText(file, null);
  if (text === null) return { present: false, filled: false };
  return { present: true, filled: !text.includes(TEMPLATE_MARKER) };
}

export function readSpec(root, dirName) {
  const m = dirName.match(SPEC_DIR_RE);
  if (!m) return null;
  const rel = `${SPEC_ROOT}/${dirName}`;
  const abs = path.join(root, rel);
  const specText = readText(path.join(abs, 'spec.md'));
  const fm = specText ? parseFrontmatter(specText) : { data: {} };
  const docs = Object.fromEntries(SPEC_FILES.map((f) => [f, docState(path.join(abs, f))]));
  const files = Object.fromEntries(SPEC_FILES.map((f) => [f, docs[f].filled]));
  return {
    docs,
    id: m[1],
    slug: m[2],
    dir: rel,
    abs,
    meta: fm.data,
    type: fm.data.type ?? 'feature',
    status: fm.data.status ?? 'draft',
    title: fm.data.title ?? m[2],
    specText,
    files,
    currentHash: specText ? specHash(specText) : null,
  };
}

export function listSpecs(root) {
  return listDirs(path.join(root, SPEC_ROOT))
    .filter((d) => SPEC_DIR_RE.test(d))
    .map((d) => readSpec(root, d))
    .filter(Boolean);
}

export function findSpec(root, idOrDir) {
  if (!idOrDir) return null;
  const direct = String(idOrDir).replace(/^specs\//, '').replace(/\/$/, '');
  if (SPEC_DIR_RE.test(direct)) return readSpec(root, direct);
  const id = normalizeId(idOrDir);
  if (!id) return null;
  return listSpecs(root).find((s) => s.id === id || Number(s.id) === Number(id)) ?? null;
}

export function nextSpecId(root) {
  const ids = listSpecs(root).map((s) => Number(s.id));
  const next = (ids.length ? Math.max(...ids) : 0) + 1;
  return String(next).padStart(3, '0');
}

export function activeSpecFile(root) {
  return path.join(root, HARNESS_DIR, 'state', 'active-spec');
}

export function specIdFromBranch(branch) {
  if (!branch) return null;
  const m = branch.match(/(?:^|\/)(\d{3,4})[-_][a-z0-9]/i);
  return m ? m[1] : null;
}

export function resolveActiveSpec(root, env = process.env) {
  const candidates = [];
  if (env.HARNESS_ACTIVE_SPEC) candidates.push([env.HARNESS_ACTIVE_SPEC, 'env HARNESS_ACTIVE_SPEC']);
  const pinned = readText(activeSpecFile(root), '').trim();
  if (pinned) candidates.push([pinned, 'pinned (pnpm harness spec activate)']);
  const branch = currentBranch(root);
  const fromBranch = specIdFromBranch(branch);
  if (fromBranch) candidates.push([fromBranch, `branch ${branch}`]);
  for (const [value, source] of candidates) {
    const spec = findSpec(root, value);
    if (spec) return { spec, source, branch };
  }
  return { spec: null, source: null, branch };
}

export function setActiveSpec(root, specId) {
  const file = activeSpecFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (specId) fs.writeFileSync(file, `${specId}\n`, 'utf8');
  else if (exists(file)) fs.unlinkSync(file);
}

// Evaluate whether code may be written for the given spec under the policy.
export function evaluateGate(spec, policy = {}) {
  const problems = [];
  if (!spec) {
    problems.push(
      'No active spec. Create one with /spec-new, have the human approve it (they type "approve spec <id>" in the chat), ' +
        'then activate it (branch feat/<id>-<slug> or pnpm harness spec activate <id>).',
    );
    return { ok: false, problems };
  }
  const allowed = policy.allowedStatuses ?? ['approved', 'in-progress', 'implemented'];
  if (!allowed.includes(spec.status)) {
    problems.push(
      `Spec ${spec.id} is "${spec.status}". Code changes need one of: ${allowed.join(', ')}. ` +
        (PRE_APPROVAL.includes(spec.status)
          ? 'The human approves it by typing "approve spec ' + spec.id + '" in the chat.'
          : 'Closed specs need a new spec (or the human reopens it).'),
    );
  }
  const approvedHash = spec.meta?.approved_hash;
  if (approvedHash && spec.currentHash && approvedHash !== spec.currentHash) {
    problems.push(
      `Spec ${spec.id} requirements changed after approval (approved ${approvedHash}, now ${spec.currentHash}). ` +
        'The human must review and re-approve it by typing in the chat: approve spec ' +
        spec.id,
    );
  }
  if ((policy.requireDesignFor ?? ['feature']).includes(spec.type)) {
    const missing = ['design.md', 'tasks.md'].filter((f) => !spec.files[f]);
    if (missing.length) {
      problems.push(
        `Spec ${spec.id} is a ${spec.type} without a completed ${missing.join(' and ')} (missing, or still carrying the template marker). /spec-build starts with the design step.`,
      );
    }
  } else if ((policy.requirePlanFor ?? []).includes(spec.type) && !spec.files['tasks.md']) {
    problems.push(
      `Spec ${spec.id} has no completed tasks.md. The solution-architect writes the plan (files and approach per task) right after spec.md, before the human approves.`,
    );
  }
  return { ok: problems.length === 0, problems };
}

// Parse tasks.md checklist lines such as:
// - [ ] T-003 [owner: backend-engineer] [deps: T-001] Implement the invoices repository
export function parseTasks(text) {
  const tasks = [];
  for (const line of (text ?? '').split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s+\[( |x|X|~|!)\]\s+(T-\d+)\b(.*)$/);
    if (!m) continue;
    const rest = m[3];
    const owner = rest.match(/\[owner:\s*([^\]]+)\]/i)?.[1]?.trim() ?? null;
    const deps = rest.match(/\[deps:\s*([^\]]+)\]/i)?.[1]?.split(',').map((s) => s.trim()).filter((s) => s && s !== '-') ?? [];
    const title = rest.replace(/\[[^\]]*\]/g, '').trim();
    const mark = m[1];
    const status = mark === ' ' ? 'todo' : mark === '~' ? 'in-progress' : mark === '!' ? 'blocked' : 'done';
    tasks.push({ id: m[2], owner, deps, title, status });
  }
  return tasks;
}

// Tasks come from tasks.md, or from the Plan section of a lite spec.md when there is no tasks.md.
export function specTasks(spec) {
  if (!spec) return [];
  if (spec.files['tasks.md']) return parseTasks(readText(path.join(spec.abs, 'tasks.md'), ''));
  return parseTasks(readText(path.join(spec.abs, 'spec.md'), ''));
}

export function nextTasks(spec, limit = 3) {
  const tasks = specTasks(spec);
  const done = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.id));
  return tasks
    .filter((t) => t.status === 'in-progress' || (t.status === 'todo' && t.deps.every((d) => done.has(d))))
    .slice(0, limit);
}
