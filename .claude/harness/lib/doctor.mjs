// Health check for the harness and the project toolchain.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exists, isDir, readJson, readText } from './util.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
import { hasBinary } from './installers.mjs';
import { dbStatus } from './db-ops.mjs';
import { listSpecs, resolveActiveSpec, evaluateGate } from './spec.mjs';
import { render } from './render.mjs';

function version(bin, args = ['--version']) {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 20000 });
  return r.status === 0 ? `${r.stdout}${r.stderr}`.trim().split('\n')[0] : null;
}

export function doctor(h) {
  const rows = [];
  const add = (level, area, message) => rows.push({ level, area, message });
  const root = h.root;

  // Toolchain.
  const [major, minor] = process.versions.node.split('.').map(Number);
  add(major > 20 || (major === 20 && minor >= 9) ? 'ok' : 'fail', 'node', `Node ${process.versions.node} (Next.js 16 needs 20.9+, 22 LTS recommended)`);
  const pm = h.config.stack?.packageManager ?? 'pnpm';
  add(hasBinary(pm) ? 'ok' : 'fail', pm, hasBinary(pm) ? version(pm) ?? 'found' : `${pm} not found (corepack enable)`);
  add(hasBinary('git') ? 'ok' : 'fail', 'git', hasBinary('git') ? 'found' : 'git not found');
  add(hasBinary('claude') ? 'ok' : 'warn', 'claude', hasBinary('claude') ? version('claude') ?? 'found' : 'Claude Code CLI not found (plugin installs need it)');
  add(hasBinary('gh') ? 'ok' : 'warn', 'gh', hasBinary('gh') ? 'found' : 'GitHub CLI not found (PR workflow)');
  const pluginPrereqs = [
    ['plugin.typescript-lsp', 'typescript-language-server', 'npm install -g typescript-language-server typescript'],
    ['plugin.security-guidance', 'python3', 'install Python 3.8+'],
    ['vskill.next-dev-loop', 'agent-browser', 'npm install -g agent-browser'],
  ];
  for (const [id, bin, fix] of pluginPrereqs) {
    if (h.enabled.get(id)) add(hasBinary(bin) ? 'ok' : 'warn', bin, hasBinary(bin) ? `found (for ${id})` : `missing for ${id}: ${fix}`);
  }

  // Configuration files.
  for (const f of ['.claude/settings.json', '.mcp.json', '.claude/harness/config.json', '.claude/harness/catalog.json', '.claude/harness/ownership.json']) {
    try {
      const data = readJson(path.join(root, f));
      add(data ? 'ok' : 'fail', 'config', data ? `${f} valid` : `${f} missing`);
    } catch (err) {
      add('fail', 'config', err.message);
    }
  }
  for (const f of ['CLAUDE.md', 'AGENTS.md', '.claude/rules/00-delegation.md', 'specs/README.md']) {
    add(exists(path.join(root, f)) ? 'ok' : 'fail', 'instructions', `${f} ${exists(path.join(root, f)) ? 'present' : 'missing'}`);
  }

  // Agents.
  for (const name of h.enabledAgents) {
    const text = readText(path.join(root, '.claude', 'agents', `${name}.md`));
    if (!text) {
      add('fail', 'agents', `${name}: file missing (run pnpm harness render)`);
      continue;
    }
    const fm = parseFrontmatter(text).data;
    add(fm.name === name && fm.description ? 'ok' : 'fail', 'agents', `${name}: ${fm.name === name ? 'frontmatter ok' : `name mismatch (${fm.name})`}, model ${fm.model ?? 'inherit'}`);
  }

  // Skills.
  for (const m of h.catalog.modules.filter((x) => (x.kind === 'workflow-skill' || x.kind === 'vendored-skill') && h.enabled.get(x.id))) {
    const name = m.name ?? m.skill;
    const ok = exists(path.join(root, '.claude', 'skills', name, 'SKILL.md'));
    const level = ok ? 'ok' : m.kind === 'vendored-skill' ? 'warn' : 'fail';
    add(level, 'skills', `${name} ${ok ? 'installed' : m.kind === 'vendored-skill' ? 'not installed (pnpm harness skills install)' : 'missing'}`);
  }

  // Plugins.
  const wanted = h.catalog.modules.filter((x) => x.kind === 'plugin' && h.enabled.get(x.id)).map((x) => x.plugin);
  if (wanted.length && hasBinary('claude')) {
    const r = spawnSync('claude', ['plugin', 'list'], { cwd: root, encoding: 'utf8', timeout: 60000 });
    const out = `${r.stdout ?? ''}`;
    for (const p of wanted) add(out.includes(p) ? 'ok' : 'warn', 'plugins', `${p} ${out.includes(p) ? 'installed' : 'not installed (pnpm harness plugins install)'}`);
  }

  // MCP.
  const mcp = readJson(path.join(root, '.mcp.json'), { mcpServers: {} }) ?? { mcpServers: {} };
  for (const m of h.catalog.modules.filter((x) => x.kind === 'mcp' && h.enabled.get(x.id))) {
    const present = Boolean(mcp.mcpServers?.[m.server]);
    add(present ? 'ok' : 'warn', 'mcp', `${m.server} ${present ? 'configured' : 'not configured (see pnpm harness render notes)'}`);
  }

  // Project scaffold.
  const pkg = readJson(path.join(root, 'package.json'), null);
  add(pkg?.dependencies?.next ? 'ok' : 'warn', 'app', pkg?.dependencies?.next ? `Next.js ${pkg.dependencies.next}` : 'Next.js app not scaffolded yet (scripts/harness/bootstrap.sh)');
  const sb = h.config.stack?.supabase ?? {};
  for (const [env, label] of [['dev', 'development'], ['prod', 'production']]) {
    add(sb[env]?.projectRef ? 'ok' : 'warn', 'supabase', sb[env]?.projectRef ? `${label} project ${sb[env].projectRef}` : `${label} project not set: pnpm harness supabase ${env} <project-ref>`);
  }
  const db = dbStatus(root);
  const pending = db.pending;
  add('ok', 'db', `${db.changeScripts.length} change script(s), ${pending.length} not released; schema snapshot ${db.snapshot.exists ? `from ${db.snapshot.modified}` : 'not taken yet (/db-snapshot after the first release)'}`);

  // Ownership references.
  const known = new Set([...h.allAgents, 'main', '*']);
  for (const zone of h.ownership.zones ?? []) {
    for (const o of zone.owners ?? []) {
      if (!o.startsWith('@') && !known.has(o)) add('fail', 'ownership', `zone ${zone.id}: unknown owner ${o}`);
    }
  }

  // Render drift.
  const drift = render(h, { apply: false });
  add(drift.changes.length ? 'warn' : 'ok', 'render', drift.changes.length ? `pending: ${drift.changes.join('; ')} (pnpm harness render)` : 'files match the configuration');
  for (const n of drift.notes) add('warn', 'render', n);

  // Specs.
  const specs = listSpecs(root);
  const active = resolveActiveSpec(root);
  add('ok', 'specs', `${specs.length} spec(s); active: ${active.spec ? `${active.spec.id} (${active.spec.status})` : 'none'}`);
  if (active.spec) {
    const gate = evaluateGate(active.spec, h.policies.specGate ?? {});
    add(gate.ok ? 'ok' : 'warn', 'spec-gate', gate.ok ? 'open' : gate.problems.join(' '));
  }
  if (!exists(path.join(root, '.git'))) add('warn', 'git', 'not a git repository yet (git init)');
  return rows;
}
