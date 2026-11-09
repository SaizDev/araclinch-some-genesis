#!/usr/bin/env node
// Harness command line. Run from the project root:  pnpm harness <command>   (or node .claude/harness/harness.mjs)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARNESS_DIR, findProjectRoot, readJson, writeJson, relToRoot } from './lib/util.mjs';
import { loadHarness, PROFILES } from './lib/config.mjs';
import { render } from './lib/render.mjs';
import { doctor } from './lib/doctor.mjs';
import { installPlugins, installVendoredSkills } from './lib/installers.mjs';
import { createOwnership } from './lib/ownership.mjs';
import { dbStatus, changeScript, scriptProblems, releaseApproval, CHANGES_DIR, SNAPSHOT_FILE } from './lib/db-ops.mjs';
import { resolveActiveSpec, evaluateGate } from './lib/spec.mjs';
import * as specCli from './lib/cli-spec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = findProjectRoot(process.cwd()) ?? path.resolve(HERE, '..', '..');
const configPath = path.join(root, HARNESS_DIR, 'config.json');

const HELP = `Harness CLI

Usage: pnpm harness <command> [args]

Configuration
  status                          Profile, modules, active spec and database changes
  profile <${PROFILES.join('|')}>  Switch profile (resets module overrides; add --keep-overrides to keep them)
  enable <module-id...>           Turn modules on (see: pnpm harness modules)
  disable <module-id...>          Turn modules off (required modules cannot be disabled)
  models <budget|balanced|quality|inherit|economy>   Model preset for the agents
  supabase dev <project-ref|url>  Development Supabase project (agents apply and test changes here)
  supabase prod <project-ref|url> Production Supabase project (read-only for agents until the human types "send to production")
  config set <key> <value>        Set a config value, e.g. stack.web.host fly
  modules                         List every module with its state
  render [--check]                Apply the configuration to files (--check: report drift, exit 1 if any)
  doctor                          Check toolchain, configuration, agents, skills, plugins, MCP and specs
  preview                         Check that .env.local points to the development Supabase project before pnpm dev

Installation
  plugins install [--dry-run]     Install the enabled Claude Code plugins (project scope)
  skills install [--update] [--dry-run]   Install the enabled vendored agent skills
  bootstrap-steps                 Plugins, skills, render and doctor in sequence (used by bootstrap.sh)

Specs
  spec new <feature|bugfix|chore> <slug> [--title "..."] [--activate]
  spec scaffold <id> <design|data-model|ui|api|test-plan|tasks|release-notes...>
  spec list
  spec status [id]
  spec approve <id> [--by "Name"]  Human only, outside Claude Code (or type "approve spec <id>" in the chat)
  spec set-status <id> <status>
  spec activate <id> | spec deactivate

Other
  ownership check <agent|main> <path>
  ownership list [agent]
  db status                       Change scripts, release approvals and the production schema snapshot
  db test [file-filter] [--with <spec-id>]
                                  Build a pgTAP run for the development project (always rolled back);
                                  --with also applies that spec's change script inside the run
  db apply <spec-id>              How to apply a change script to the development project
  db release <spec-id>            How to release a change script to production (after "send to production")
  db snapshot                     How to save the production schema to migrations/schema.sql
`;

function out(line = '') {
  process.stdout.write(`${line}\n`);
}

function fail(msg, code = 1) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(code);
}

function flag(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, v && !v.startsWith('--') ? 2 : 1);
  return v && !v.startsWith('--') ? v : true;
}

function saveConfig(mutator) {
  const cfg = readJson(configPath, {});
  mutator(cfg);
  writeJson(configPath, cfg);
}

function doRender(check = false) {
  const h = loadHarness(root);
  const res = render(h, { apply: !check });
  if (!res.changes.length) out(check ? 'Render: no drift.' : 'Render: nothing to change.');
  for (const c of res.changes) out(`${check ? 'drift' : 'applied'}: ${c}`);
  for (const n of res.notes) out(`note: ${n}`);
  if (!check && res.changes.length) out('Restart Claude Code (or run /reload-plugins and open a new session) so agents, skills, plugins and MCP servers reload.');
  return res;
}

function printStatus() {
  const h = loadHarness(root);
  out(`Profile: ${h.profileName}  (${h.profile.description ?? ''})`);
  out(`Model preset: ${h.config.modelPreset ?? (h.profileName === 'budget' ? 'budget (profile default)' : 'balanced')}`);
  out(`Agents: ${h.enabledAgents.join(', ')}`);
  const kinds = ['check', 'workflow-skill', 'vendored-skill', 'mcp', 'plugin', 'workflow'];
  for (const k of kinds) {
    const mods = h.catalog.modules.filter((m) => m.kind === k);
    const on = mods.filter((m) => h.enabled.get(m.id)).map((m) => m.id.split('.').slice(1).join('.'));
    out(`${k.padEnd(15)} on: ${on.join(', ') || '-'}`);
  }
  const p = h.policies;
  out(`Policies: spec gate ${h.checkOn('spec-gate') ? p.specGate?.mode : 'off'} (approval ${p.specGate?.approval}), ownership ${h.checkOn('ownership') ? p.ownership?.mode : 'off'}, brief ${p.delegation?.requireBrief ? 'required' : 'optional'}, stop gate typecheck=${p.stopGate?.typecheck} lint=${p.stopGate?.lint} review=${p.stopGate?.reviewAfterCodeChange}`);
  const active = resolveActiveSpec(root);
  if (active.spec) {
    const gate = evaluateGate(active.spec, p.specGate ?? {});
    out(`Active spec: ${active.spec.id}-${active.spec.slug} [${active.spec.type}, ${active.spec.status}] via ${active.source}; gate ${gate.ok ? 'open' : 'closed'}`);
    for (const pr of gate.problems) out(`  - ${pr}`);
  } else {
    out('Active spec: none');
  }
  const sb = h.config.stack?.supabase ?? {};
  out(`Supabase: development ${sb.dev?.projectRef || 'not set'}, production ${sb.prod?.projectRef || 'not set'}`);
  const db = dbStatus(root);
  const pending = db.pending;
  out(`Database: ${db.changeScripts.length} change script(s), not released: ${pending.map((x) => x.file).join(', ') || 'none'}; snapshot ${db.snapshot.exists ? db.snapshot.modified : 'not taken'}`);
}

function listModules() {
  const h = loadHarness(root);
  for (const m of h.catalog.modules) {
    const state = h.enabled.get(m.id) ? 'on ' : 'off';
    out(`${state}  ${m.id.padEnd(42)} ${m.required ? '[required] ' : ''}${m.description ?? ''}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args.shift();
  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      out(HELP);
      return;
    case 'status':
      printStatus();
      return;
    case 'modules':
      listModules();
      return;
    case 'profile': {
      const name = args[0];
      if (!PROFILES.includes(name)) fail(`profile must be one of ${PROFILES.join(', ')}`);
      const keep = args.includes('--keep-overrides');
      saveConfig((c) => {
        c.profile = name;
        if (!keep) c.overrides = { enable: [], disable: [] };
      });
      out(`Profile set to ${name}${keep ? ' (overrides kept)' : ''}.`);
      doRender();
      return;
    }
    case 'enable':
    case 'disable': {
      if (!args.length) fail(`usage: pnpm harness ${cmd} <module-id...>`);
      const h = loadHarness(root);
      for (const id of args) {
        const m = h.modules.get(id);
        if (!m) fail(`unknown module ${id} (pnpm harness modules)`);
        if (cmd === 'disable' && m.required) fail(`${id} is required and cannot be disabled`);
      }
      saveConfig((c) => {
        c.overrides ??= { enable: [], disable: [] };
        const on = new Set(c.overrides.enable ?? []);
        const offSet = new Set(c.overrides.disable ?? []);
        for (const id of args) {
          if (cmd === 'enable') {
            on.add(id);
            offSet.delete(id);
          } else {
            offSet.add(id);
            on.delete(id);
          }
        }
        c.overrides.enable = [...on];
        c.overrides.disable = [...offSet];
      });
      out(`${cmd === 'enable' ? 'Enabled' : 'Disabled'}: ${args.join(', ')}`);
      doRender();
      return;
    }
    case 'models': {
      const h = loadHarness(root);
      const preset = args[0];
      if (!h.catalog.modelPresets?.[preset]) fail(`preset must be one of ${Object.keys(h.catalog.modelPresets ?? {}).join(', ')}`);
      saveConfig((c) => {
        c.modelPreset = preset;
      });
      out(`Model preset set to ${preset}.`);
      doRender();
      return;
    }
    case 'supabase': {
      // "supabase <ref>" (old form) means production.
      const env = ['dev', 'prod'].includes(args[0]) ? args[0] : 'prod';
      const input = String((['dev', 'prod'].includes(args[0]) ? args[1] : args[0]) ?? '').trim();
      const ref = (input.match(/^https?:\/\/([a-z0-9]{20})\.supabase\.co/) ?? [])[1] ?? input;
      if (!/^[a-z0-9]{20}$/.test(ref)) {
        fail('usage: pnpm harness supabase <dev|prod> <project-ref>  (the 20-character id in https://<project-ref>.supabase.co, or that URL)');
      }
      const other = readJson(configPath, {})?.stack?.supabase?.[env === 'dev' ? 'prod' : 'dev']?.projectRef;
      if (other === ref) fail('development and production must be different Supabase projects');
      saveConfig((c) => {
        c.stack ??= {};
        const sb = c.stack.supabase ?? {};
        delete sb.projectRef;
        sb[env] = { ...(sb[env] ?? {}), projectRef: ref };
        c.stack.supabase = sb;
      });
      out(`Supabase ${env === 'dev' ? 'development' : 'production'} project set to ${ref}.`);
      doRender();
      out(env === 'dev'
        ? 'Next: restart Claude Code, approve the "supabase" MCP server, then run /mcp and sign in.'
        : 'Next: restart Claude Code, approve the "supabase-prod" and "supabase-release" MCP servers, then run /mcp and sign in to both.');
      return;
    }
    case 'config': {
      if (args[0] !== 'set' || args.length < 3) fail('usage: pnpm harness config set <dotted.key> <value>');
      const [, key, raw] = args;
      let value = raw;
      try {
        value = JSON.parse(raw);
      } catch {
        value = raw;
      }
      saveConfig((c) => {
        const parts = key.split('.');
        let obj = c;
        for (const p of parts.slice(0, -1)) {
          obj[p] ??= {};
          obj = obj[p];
        }
        obj[parts[parts.length - 1]] = value;
      });
      out(`Set ${key} = ${JSON.stringify(value)}`);
      doRender();
      return;
    }
    case 'render': {
      const check = args.includes('--check');
      const res = doRender(check);
      if (check && res.changes.length) process.exit(1);
      return;
    }
    case 'preview': {
      const { previewCheck } = await import('./lib/preview.mjs');
      const r = previewCheck(root, loadHarness(root));
      for (const line of r.lines) out(line);
      if (!r.ok) process.exitCode = 1;
      return;
    }
    case 'doctor': {
      const rows = doctor(loadHarness(root));
      for (const r of rows) out(`${r.level === 'ok' ? 'OK  ' : r.level === 'warn' ? 'WARN' : 'FAIL'}  ${r.area.padEnd(12)} ${r.message}`);
      const fails = rows.filter((r) => r.level === 'fail').length;
      const warns = rows.filter((r) => r.level === 'warn').length;
      out(`\n${fails} failure(s), ${warns} warning(s).`);
      if (fails) process.exit(1);
      return;
    }
    case 'plugins': {
      if (args[0] !== 'install') fail('usage: pnpm harness plugins install [--dry-run]');
      const res = installPlugins(loadHarness(root), { dryRun: args.includes('--dry-run'), log: out });
      if (!res.ok) process.exitCode = 1;
      return;
    }
    case 'skills': {
      if (args[0] !== 'install') fail('usage: pnpm harness skills install [--update] [--dry-run]');
      const res = installVendoredSkills(loadHarness(root), { dryRun: args.includes('--dry-run'), update: args.includes('--update'), log: out });
      if (!args.includes('--dry-run')) doRender();
      if (!res.ok) process.exitCode = 1;
      return;
    }
    case 'bootstrap-steps': {
      const dryRun = args.includes('--dry-run');
      out('== Claude Code plugins');
      installPlugins(loadHarness(root), { dryRun, log: out });
      out('\n== Vendored agent skills');
      installVendoredSkills(loadHarness(root), { dryRun, log: out });
      out('\n== Render');
      doRender(dryRun);
      return;
    }
    case 'spec':
      return specCommand(args);
    case 'ownership': {
      const h = loadHarness(root);
      const own = createOwnership(h);
      if (args[0] === 'check') {
        const [, actor, p] = args;
        if (!actor || !p) fail('usage: pnpm harness ownership check <agent|main> <path>');
        const rel = relToRoot(root, p) ?? p;
        const v = own.check(actor, rel);
        out(`${v.decision.toUpperCase()}  ${rel}  zone=${v.zone.id}  owners=${v.owners.join(', ') || '-'}`);
        if (v.reason) out(v.reason);
        return;
      }
      if (args[0] === 'list') {
        const agents = args[1] ? [args[1]] : [...h.enabledAgents, 'main'];
        for (const a of agents) out(`${a}: ${own.zonesOwnedBy(a).flatMap((z) => z.paths).join(', ') || '-'}`);
        return;
      }
      fail('usage: pnpm harness ownership <check|list> ...');
      return;
    }
    case 'db': {
      if (args[0] === 'status' || !args[0]) {
        out(JSON.stringify(dbStatus(root), null, 2));
        return;
      }
      if (args[0] === 'test') {
        const { collectInputs, buildPayload, storePayload } = await import('./lib/db-test.mjs');
        const rest = args.slice(1);
        const i = rest.indexOf('--with');
        const withSpec = i >= 0 ? rest[i + 1] : null;
        if (i >= 0 && !withSpec) fail('usage: pnpm harness db test [file-filter] [--with <spec-id>]');
        const filter = rest.filter((a, idx) => i < 0 || (idx !== i && idx !== i + 1))[0] ?? '';
        let inputs;
        let payload;
        try {
          inputs = collectInputs(root, { filter, withSpec });
          payload = buildPayload(inputs);
        } catch (err) {
          fail(err.message);
        }
        const { id, reference } = storePayload(root, payload);
        out(`Database test run ${id}: ${inputs.tests.length} test file(s)${inputs.migrations.length ? `, change script ${inputs.migrations[0].rel} applied inside the run` : ''}.`);
        out(`Run it on the development project: mcp__supabase__execute_sql with exactly this query:`);
        out(`  ${reference}`);
        out('It ALWAYS ends in an error starting with DEVHARNESS_DB_TEST_RESULT (that rolls everything back).');
        out('Success means failed=0 and file_errors=0.');
        return;
      }
      if (args[0] === 'apply' || args[0] === 'release') {
        const { spec: s, rel, sql } = changeScript(root, args[1]);
        if (!s) fail(`usage: pnpm harness db ${args[0]} <spec-id>`);
        if (sql === null) fail(`${CHANGES_DIR}/${s.id}-${s.slug}.sql does not exist`);
        const problems = scriptProblems(sql);
        if (problems.length) fail(`${rel}: ${problems.join('; ')}`);
        if (args[0] === 'apply') {
          out(`Apply ${rel} to the development project: mcp__supabase__execute_sql with the query`);
          out(`  -- devharness:apply ${s.id}`);
          out('It runs as one transaction. Then regenerate src/types/database.types.ts with mcp__supabase__generate_typescript_types.');
        } else {
          const a = releaseApproval(root, s.id);
          out(a ? `Release approved by ${a.by} at ${a.approvedAt}.` : `Not approved yet: the human tests and types "send to production" in the chat.`);
          out(`Then: mcp__supabase-release__execute_sql with the query`);
          out(`  -- devharness:release ${s.id}`);
          out(`After it succeeds: pnpm harness spec set-status ${s.id} released, merge the pull request, /db-snapshot.`);
        }
        return;
      }
      if (args[0] === 'snapshot') {
        out(`Save the production schema to ${SNAPSHOT_FILE}: mcp__supabase-prod__execute_sql with the query`);
        out('  -- devharness:schema-snapshot');
        out('The harness swaps in the catalog query and writes the file when the result comes back.');
        return;
      }
      fail('usage: pnpm harness db <status|test|apply|release|snapshot>');
      return;
    }
    default:
      fail(`unknown command "${cmd}"\n\n${HELP}`);
  }
}

function specCommand(args) {
  const sub = args.shift();
  const h = loadHarness(root);
  switch (sub) {
    case 'new': {
      const title = flag(args, '--title');
      const activate = args.includes('--activate');
      const [type, slug] = args.filter((a) => a !== '--activate');
      const res = specCli.specNew(h, type, slug, { title: typeof title === 'string' ? title : undefined, activate });
      out(`Created ${res.dir}/spec.md (status draft)${activate ? ' and activated it' : ''}.`);
      out(`Next: product-manager fills the spec, then the human types in the chat: approve spec ${res.id}`);
      return;
    }
    case 'scaffold': {
      const [id, ...docs] = args;
      const created = specCli.specScaffold(h, id, docs);
      out(created.length ? `Created: ${created.join(', ')}` : 'Nothing created (documents already exist).');
      return;
    }
    case 'list': {
      const rows = specCli.specList(h);
      if (!rows.length) out('No specs yet. Create one with /spec-new or pnpm harness spec new feature <slug>.');
      for (const r of rows) out(`${r.active ? '*' : ' '} ${r.id}  ${r.type.padEnd(8)} ${r.status.padEnd(12)} approval:${r.approval.padEnd(8)} ${r.slug}  "${r.title}"`);
      return;
    }
    case 'status': {
      const res = specCli.specStatus(h, args[0]);
      if (!res.spec) {
        out(res.message);
        return;
      }
      const s = res.spec;
      out(`${s.id}-${s.slug} "${s.title}" [${s.type}, ${s.status}]`);
      out(`Approval: ${s.meta.approved_by ? `${s.meta.approved_by} at ${s.meta.approved_at} (${s.meta.approved_hash === s.currentHash ? 'current' : 'CHANGED since approval'})` : 'not approved'}`);
      out(`Documents: ${Object.entries(s.docs).map(([f, d]) => `${f}:${d.present ? (d.filled ? 'done' : 'template') : '-'}`).join('  ')}`);
      out(`Gate: ${res.gate.ok ? 'open' : 'closed'}`);
      for (const p of res.gate.problems) out(`  - ${p}`);
      if (res.tasks.length) {
        const done = res.tasks.filter((t) => t.status === 'done').length;
        out(`Tasks: ${done}/${res.tasks.length} done`);
        for (const t of res.tasks) out(`  [${t.status}] ${t.id} (${t.owner ?? '?'}) ${t.title}`);
      }
      return;
    }
    case 'approve': {
      const by = flag(args, '--by');
      const agent = flag(args, '--agent');
      const res = specCli.specApprove(h, args[0], { by: typeof by === 'string' ? by : undefined, agent: typeof agent === 'string' ? agent : undefined });
      out(`Spec ${res.id} approved by ${res.approver} (status ${res.status}, hash ${res.hash}).`);
      return;
    }
    case 'set-status': {
      const res = specCli.specSetStatus(h, args[0], args[1]);
      out(`Spec ${res.id}: ${res.from} -> ${res.to}`);
      return;
    }
    case 'activate': {
      const s = specCli.specActivate(h, args[0]);
      out(`Active spec pinned: ${s.id}-${s.slug} (status ${s.status}).`);
      return;
    }
    case 'deactivate':
      specCli.specActivate(h, null);
      out('Active spec pin removed (branch naming still applies).');
      return;
    default:
      fail('usage: pnpm harness spec <new|scaffold|list|status|approve|set-status|activate|deactivate>');
  }
}

main().catch((err) => fail(err.message));
