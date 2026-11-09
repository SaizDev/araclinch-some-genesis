// `pnpm harness spec ...` commands: new, scaffold, list, status, approve, activate, set-status.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exists, readText, writeText } from './util.mjs';
import { setFrontmatterFields, parseFrontmatter } from './frontmatter.mjs';
import { gitUserName } from './git.mjs';
import * as spec from './spec.mjs';

const TEMPLATES = 'specs/_templates';
const SPEC_TEMPLATE = { feature: 'feature-spec.md', bugfix: 'bugfix-spec.md', chore: 'chore-spec.md' };
const DOC_TEMPLATES = {
  design: ['technical-design.md', 'design.md'],
  'data-model': ['data-model.md', 'data-model.md'],
  ui: ['ui-spec.md', 'ui.md'],
  api: ['api-contract.md', 'api.md'],
  'test-plan': ['test-plan.md', 'test-plan.md'],
  tasks: ['tasks.md', 'tasks.md'],
  'release-notes': ['release-notes.md', 'release-notes.md'],
};

function fill(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

function varsFor(s, extra = {}) {
  return {
    id: s.id,
    slug: s.slug,
    title: s.title,
    type: s.type,
    date: new Date().toISOString().slice(0, 10),
    spec_dir: s.dir,
    ...extra,
  };
}

function requireSpec(root, id) {
  const s = spec.findSpec(root, id);
  if (!s) throw new Error(`Spec "${id}" not found under specs/.`);
  return s;
}

export function specNew(h, type, slug, opts = {}) {
  if (!spec.TYPES.includes(type)) throw new Error(`Type must be one of: ${spec.TYPES.join(', ')}`);
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug ?? '')) throw new Error('Slug must be kebab-case, for example: invoice-export');
  const id = spec.nextSpecId(h.root);
  const dir = path.join(h.root, 'specs', `${id}-${slug}`);
  if (exists(dir)) throw new Error(`${dir} already exists`);
  const tplName = h.policies?.specGate?.template === 'lite' ? 'spec-lite.md' : SPEC_TEMPLATE[type];
  const tpl = readText(path.join(h.root, TEMPLATES, tplName));
  if (!tpl) throw new Error(`Template ${TEMPLATES}/${tplName} not found`);
  const title = opts.title || slug.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  const vars = { id, slug, title, type, date: new Date().toISOString().slice(0, 10), spec_dir: `specs/${id}-${slug}` };
  writeText(path.join(dir, 'spec.md'), fill(tpl, vars));
  fs.mkdirSync(path.join(dir, 'reviews'), { recursive: true });
  writeText(path.join(dir, 'reviews', '.gitkeep'), '');
  if (opts.activate) spec.setActiveSpec(h.root, id);
  return { id, dir: `specs/${id}-${slug}` };
}

export function specScaffold(h, id, docs) {
  const s = requireSpec(h.root, id);
  const created = [];
  for (const doc of docs) {
    const entry = DOC_TEMPLATES[doc];
    if (!entry) throw new Error(`Unknown document "${doc}". Use: ${Object.keys(DOC_TEMPLATES).join(', ')}`);
    const [defaultTpl, outName] = entry;
    const tplName = doc === 'tasks' && h.policies?.specGate?.template === 'lite' ? 'tasks-lite.md' : defaultTpl;
    const out = path.join(s.abs, outName);
    if (exists(out)) continue;
    const tpl = readText(path.join(h.root, TEMPLATES, tplName));
    if (!tpl) throw new Error(`Template ${TEMPLATES}/${tplName} not found`);
    writeText(out, fill(tpl, varsFor(s)));
    created.push(`${s.dir}/${outName}`);
  }
  return created;
}

export function specList(h) {
  const active = spec.resolveActiveSpec(h.root).spec;
  return spec.listSpecs(h.root).map((s) => ({
    id: s.id,
    slug: s.slug,
    type: s.type,
    status: s.status,
    title: s.title,
    approval: s.meta.approved_hash ? (s.meta.approved_hash === s.currentHash ? 'current' : 'CHANGED') : '-',
    active: active?.id === s.id,
  }));
}

export function specStatus(h, id) {
  const s = id ? requireSpec(h.root, id) : spec.resolveActiveSpec(h.root).spec;
  if (!s) return { spec: null, message: 'No active spec.' };
  const gate = spec.evaluateGate(s, h.policies.specGate ?? {});
  const tasks = s.docs['tasks.md'].present ? spec.parseTasks(readText(path.join(s.abs, 'tasks.md'), '')) : spec.specTasks(s);
  return { spec: s, gate, tasks };
}

export function specApprove(h, id, opts = {}) {
  const policy = h.policies.specGate ?? {};
  const s = requireSpec(h.root, id);
  const insideClaude = Boolean(process.env.CLAUDECODE);
  if (insideClaude) {
    const allowed =
      opts.agent === 'product-manager' &&
      (policy.approval === 'agents' || (policy.approval === 'tiered' && ['bugfix', 'chore'].includes(s.type)));
    if (!allowed) {
      throw new Error(`Spec approval is human-only. The human types "approve spec ${s.id}" in the Claude Code chat, or runs pnpm spec:approve ${s.id} in their own terminal.`);
    }
  }
  const approver = insideClaude ? `agent:${opts.agent}` : opts.by || gitUserName(h.root) || os.userInfo().username;
  return recordApproval(h, s, approver, insideClaude ? 'agent' : 'terminal');
}

// Writes the approval into spec.md. Called by the CLI above (terminal) and by the chat-approval
// hook, which only reacts to text the human typed in Claude Code (never reachable from tools).
export function recordApproval(h, s, approver, via) {
  if (!s.specText) throw new Error(`${s.dir}/spec.md is missing`);
  if (s.specText.includes(spec.TEMPLATE_MARKER)) {
    throw new Error(`${s.dir}/spec.md is not finished yet (it still carries the template marker). The product-manager completes it first.`);
  }
  if (['rejected', 'superseded'].includes(s.status)) throw new Error(`Spec ${s.id} is ${s.status}.`);
  const status = spec.POST_APPROVAL.includes(s.status) ? s.status : 'approved';
  const next = setFrontmatterFields(s.specText, {
    status,
    approved_by: approver,
    approved_at: new Date().toISOString(),
    approved_hash: s.currentHash,
    approved_via: via,
  });
  writeText(path.join(s.abs, 'spec.md'), next);
  return { id: s.id, status, approver, hash: s.currentHash, via };
}

const AGENT_TRANSITIONS = new Set(['draft', 'in-review', 'in-progress', 'implemented', 'verified', 'released', 'on-hold', 'superseded', 'rejected']);

export function specSetStatus(h, id, status) {
  const s = requireSpec(h.root, id);
  if (!spec.STATUSES.includes(status)) throw new Error(`Unknown status. Use: ${spec.STATUSES.join(', ')}`);
  if (status === 'approved') throw new Error('Approval is human-only: the human types "approve spec <id>" in the chat (or runs pnpm spec:approve <id> in a terminal).');
  if (!AGENT_TRANSITIONS.has(status)) throw new Error(`Status ${status} cannot be set here.`);
  if (spec.POST_APPROVAL.includes(status) && !spec.POST_APPROVAL.includes(s.status)) {
    throw new Error(`Spec ${s.id} is "${s.status}" and must be approved before it can move to "${status}".`);
  }
  if (spec.POST_APPROVAL.includes(status) && s.meta.approved_hash && s.meta.approved_hash !== s.currentHash) {
    throw new Error(`Spec ${s.id} changed after approval. It needs re-approval before moving to "${status}".`);
  }
  writeText(path.join(s.abs, 'spec.md'), setFrontmatterFields(s.specText, { status, updated: new Date().toISOString().slice(0, 10) }));
  return { id: s.id, from: s.status, to: status };
}

export function specActivate(h, id) {
  if (!id) {
    spec.setActiveSpec(h.root, null);
    return null;
  }
  const s = requireSpec(h.root, id);
  spec.setActiveSpec(h.root, s.id);
  return s;
}

export { parseFrontmatter };
