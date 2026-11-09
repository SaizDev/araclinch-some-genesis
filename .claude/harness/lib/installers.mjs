// Installs recommended Claude Code plugins and vendored agent skills for the enabled modules.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDir } from './util.mjs';

function which(bin) {
  const res = spawnSync(process.platform === 'win32' ? 'where' : 'command', process.platform === 'win32' ? [bin] : ['-v', bin], {
    encoding: 'utf8',
    shell: process.platform !== 'win32',
  });
  return res.status === 0 ? res.stdout.trim().split('\n')[0] : null;
}

export function hasBinary(bin) {
  return Boolean(which(bin));
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', stdio: opts.inherit ? 'inherit' : 'pipe', cwd: opts.cwd, timeout: opts.timeout ?? 600000 });
  return { ok: res.status === 0, out: `${res.stdout ?? ''}${res.stderr ?? ''}`.trim(), status: res.status };
}

export function installPlugins(h, { dryRun = false, log = console.log } = {}) {
  const modules = h.catalog.modules.filter((m) => m.kind === 'plugin' && h.enabled.get(m.id));
  if (!modules.length) {
    log('No plugins enabled in this profile.');
    return { ok: true, results: [] };
  }
  if (!hasBinary('claude')) {
    log('Claude Code CLI not found on PATH. Install it (https://code.claude.com) and run: pnpm harness plugins install');
    for (const m of modules) log(`  claude plugin install ${m.plugin} --scope project`);
    return { ok: false, results: [] };
  }
  const results = [];
  const marketplaces = [...new Set(modules.map((m) => m.plugin.split('@')[1]))];
  for (const mk of marketplaces) {
    if (mk === 'claude-plugins-official') {
      const cmd = ['plugin', 'marketplace', 'add', 'anthropics/claude-plugins-official'];
      log(`$ claude ${cmd.join(' ')}`);
      if (!dryRun) {
        const r = run('claude', cmd, { cwd: h.root });
        log(`  ${r.ok ? 'ok' : 'warning'}: ${r.out.split('\n').pop()}`);
      }
    }
  }
  for (const m of modules) {
    const args = ['plugin', 'install', m.plugin, '--scope', 'project'];
    log(`$ claude ${args.join(' ')}${m.prereq ? `   (prerequisite: ${m.prereq})` : ''}`);
    if (dryRun) continue;
    const r = run('claude', args, { cwd: h.root });
    results.push({ plugin: m.plugin, ok: r.ok, message: r.out.split('\n').pop() });
    log(`  ${r.ok ? 'ok' : 'FAILED'}: ${r.out.split('\n').pop()}`);
  }
  return { ok: results.every((r) => r.ok), results };
}

export function installVendoredSkills(h, { dryRun = false, update = false, log = console.log } = {}) {
  const modules = h.catalog.modules.filter((m) => m.kind === 'vendored-skill' && h.enabled.get(m.id));
  const bySource = new Map();
  for (const m of modules) {
    const installed = isDir(path.join(h.root, '.claude', 'skills', m.skill));
    if (installed && !update) continue;
    if (!bySource.has(m.source)) bySource.set(m.source, []);
    bySource.get(m.source).push(m.skill);
  }
  if (!bySource.size) {
    log('All enabled vendored skills are installed.');
    return { ok: true };
  }
  if (!hasBinary('npx')) {
    log('npx not found. Install Node.js 20+ and re-run: pnpm harness skills install');
    return { ok: false };
  }
  let ok = true;
  for (const [source, skills] of bySource) {
    const args = ['-y', 'skills@latest', 'add', source, ...skills.flatMap((s) => ['--skill', s]), '-a', 'claude-code', '-y', '--copy'];
    log(`$ npx ${args.join(' ')}`);
    if (dryRun) continue;
    const r = run('npx', args, { cwd: h.root, timeout: 900000 });
    const missing = skills.filter((s) => !isDir(path.join(h.root, '.claude', 'skills', s)));
    if (!r.ok || missing.length) {
      ok = false;
      log(`  FAILED for ${missing.join(', ') || source}. Output tail:\n${r.out.split('\n').slice(-8).join('\n')}`);
    } else {
      log(`  ok: ${skills.join(', ')}`);
    }
  }
  return { ok };
}
