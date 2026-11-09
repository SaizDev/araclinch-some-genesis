// Test suite of this project's harness (budget profile only). Run from the project root:
//   node --test ".claude/harness/tests/*.test.mjs"
// Builds a throwaway copy of the harness, then drives the hook dispatcher and the CLI with the same
// JSON Claude Code sends. No network, no Claude session, no node_modules needed.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..', '..', '..');
const lib = (p) => import(pathToFileURL(path.join(PROJECT, p)).href);
const BUILDERS = ['backend-engineer', 'frontend-engineer', 'media-engineer', 'ai-agent-engineer', 'integrations-engineer', 'platform-engineer'];

function sh(cwd, cmd, args) {
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

function cli(root, args, env = {}) {
  const res = spawnSync('node', [path.join(root, '.claude', 'harness', 'harness.mjs'), ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, CLAUDECODE: '', ...env } });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'araclinch-harness-'));
  fs.cpSync(path.join(PROJECT, '.claude'), path.join(root, '.claude'), {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}state${path.sep}sessions`) && !src.endsWith('activity.jsonl') && !src.endsWith('active-spec'),
  });
  fs.cpSync(path.join(PROJECT, 'specs', '_templates'), path.join(root, 'specs', '_templates'), { recursive: true });
  fs.copyFileSync(path.join(PROJECT, 'specs', 'README.md'), path.join(root, 'specs', 'README.md'));
  fs.mkdirSync(path.join(root, 'supabase', 'changes'), { recursive: true });
  fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: {} }));
  const r = cli(root, ['render']);
  assert.equal(r.status, 0, r.out);
  sh(root, 'git', ['init', '-q', '-b', 'main']);
  sh(root, 'git', ['config', 'user.email', 'test@example.com']);
  sh(root, 'git', ['config', 'user.name', 'Test Human']);
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'baseline']);
  return root;
}

function hook(root, event, input) {
  const res = spawnSync('node', [path.join(root, '.claude', 'hooks', 'harness-hook.mjs'), event], {
    cwd: root,
    input: JSON.stringify({ session_id: 'test-session', cwd: root, hook_event_name: event, ...input }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, HARNESS_ACTIVE_SPEC: '' },
  });
  assert.equal(res.status, 0, `hook exited ${res.status}: ${res.stderr}`);
  return res.stdout.trim() ? JSON.parse(res.stdout) : {};
}

const decision = (out) => out.hookSpecificOutput?.permissionDecision ?? 'allow';
const reason = (out) => out.hookSpecificOutput?.permissionDecisionReason ?? '';
const as = (agent) => (agent ? { agent_id: `agent-${agent}`, agent_type: agent } : {});
const preWrite = (root, rel, content, agent) => hook(root, 'PreToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(root, rel), content }, ...as(agent) });
const preBash = (root, command, agent) => hook(root, 'PreToolUse', { tool_name: 'Bash', tool_input: { command }, ...as(agent) });

function completeDoc(root, rel) {
  const file = path.join(root, rel);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('<!-- harness:template -->', ''));
}

// An approved lite spec with a completed plan, active on its branch: the gate is open.
function openSpec(root, slug = 'render-carousel') {
  assert.equal(cli(root, ['spec', 'new', 'feature', slug]).status, 0);
  const dir = fs.readdirSync(path.join(root, 'specs')).find((d) => d.endsWith(slug));
  const id = dir.slice(0, 3);
  completeDoc(root, `specs/${dir}/spec.md`);
  const ok = cli(root, ['spec', 'approve', id]);
  assert.equal(ok.status, 0, ok.out);
  assert.equal(cli(root, ['spec', 'scaffold', id, 'tasks']).status, 0);
  completeDoc(root, `specs/${dir}/tasks.md`);
  cli(root, ['spec', 'activate', id]);
  return { dir, id };
}

describe('budget only', () => {
  test('the project has exactly one profile and one model preset', async () => {
    const { PROFILES } = await lib('.claude/harness/lib/config.mjs');
    assert.deepEqual(PROFILES, ['budget']);
    const catalog = JSON.parse(fs.readFileSync(path.join(PROJECT, '.claude/harness/catalog.json'), 'utf8'));
    assert.deepEqual(Object.keys(catalog.modelPresets), ['budget']);
    const cfg = JSON.parse(fs.readFileSync(path.join(PROJECT, '.claude/harness/config.json'), 'utf8'));
    assert.equal(cfg.profile, 'budget');
    assert.equal(cfg.stack.web.host, '', 'web hosting is not decided yet');
    assert.equal(cfg.stack.fly.region, 'fra');
  });
  test('switching to another profile is refused', () => {
    const root = makeProject();
    assert.notEqual(cli(root, ['profile', 'lean']).status, 0);
  });
  test('the generated rules are in sync with the configuration', () => {
    const r = cli(PROJECT, ['render', '--check']);
    assert.equal(r.status, 0, r.out);
  });
});

describe('team', () => {
  const agent = (a) => fs.readFileSync(path.join(PROJECT, `.claude/agents/${a}.md`), 'utf8');
  test('nine agents: thinking on opus, building and the quick check on sonnet', () => {
    const files = fs.readdirSync(path.join(PROJECT, '.claude/agents')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
    assert.deepEqual(files, ['ai-agent-engineer', 'backend-engineer', 'frontend-engineer', 'integrations-engineer', 'media-engineer', 'platform-engineer', 'product-manager', 'security-auditor', 'solution-architect']);
    for (const a of ['product-manager', 'solution-architect']) assert.match(agent(a), /^model: opus$/m, a);
    for (const a of [...BUILDERS, 'security-auditor']) assert.match(agent(a), /^model: sonnet$/m, a);
  });
  test('builders cannot delegate further', () => {
    for (const a of BUILDERS) assert.match(agent(a), /^disallowedTools:.*\bAgent\b/m, a);
  });
  test('the roster lists every worker owner', () => {
    const rules = fs.readFileSync(path.join(PROJECT, '.claude/rules/00-delegation.md'), 'utf8');
    for (const a of BUILDERS) assert.ok(rules.includes(`\`${a}\``), a);
    assert.doesNotMatch(rules, /Vercel/);
  });
  test('new builders stay on sonnet; an escalation retry runs on opus', () => {
    const root = makeProject();
    const delegate = (type, prompt, model) => hook(root, 'PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: type, description: 'x', prompt, ...(model ? { model } : {}) } });
    const model = (out) => out.hookSpecificOutput?.updatedInput?.model;
    assert.equal(model(delegate('media-engineer', 'Spec: specs/001-x\nTask: T-001', 'opus')), 'sonnet');
    assert.equal(model(delegate('integrations-engineer', 'Spec: specs/001-x\nTask: T-002\nEscalation: Graph API container never finishes')), 'opus');
    assert.equal(model(delegate('solution-architect', 'Task: lite plan', 'sonnet')), 'opus');
  });
});

describe('ownership of the workers and packages', () => {
  let root;
  before(() => {
    root = makeProject();
    openSpec(root);
  });
  const owner = (rel, agent) => decision(preWrite(root, rel, '// x\n', agent));
  test('each worker belongs to its engineer', () => {
    assert.equal(owner('workers/media/src/transcribe.ts', 'media-engineer'), 'allow');
    assert.equal(owner('workers/render/src/reel.ts', 'media-engineer'), 'allow');
    assert.equal(owner('workers/agent/src/plan.ts', 'ai-agent-engineer'), 'allow');
    assert.equal(owner('workers/publish/src/publish.ts', 'integrations-engineer'), 'allow');
    assert.equal(owner('workers/discovery/src/apify.ts', 'integrations-engineer'), 'allow');
    assert.equal(owner('workers/publish/src/publish.ts', 'media-engineer'), 'deny');
    assert.equal(owner('workers/agent/src/plan.ts', 'integrations-engineer'), 'deny');
  });
  test('templates are shared with the frontend; deploy files belong to the platform', () => {
    assert.equal(owner('workers/render/templates/carousel/slide.html', 'frontend-engineer'), 'allow');
    assert.equal(owner('workers/render/src/reel.ts', 'frontend-engineer'), 'deny');
    assert.equal(owner('workers/media/fly.toml', 'platform-engineer'), 'allow');
    assert.equal(owner('workers/media/Dockerfile', 'platform-engineer'), 'allow');
    assert.equal(owner('workers/base/Dockerfile', 'platform-engineer'), 'allow');
    assert.equal(owner('workers/media/fly.toml', 'media-engineer'), 'deny');
  });
  test('shared packages and the database', () => {
    assert.equal(owner('packages/contracts/src/jobs.ts', 'integrations-engineer'), 'allow');
    assert.equal(owner('packages/queue/src/index.ts', 'platform-engineer'), 'allow');
    assert.equal(owner('packages/queue/src/index.ts', 'media-engineer'), 'deny');
    assert.equal(owner('packages/providers/src/elevenlabs.ts', 'ai-agent-engineer'), 'allow');
    assert.equal(owner('supabase/changes/001-render-carousel.sql', 'backend-engineer'), 'allow');
    assert.equal(owner('src/app/library/page.tsx', 'frontend-engineer'), 'allow');
  });
  test('the orchestrator writes none of it', () => {
    assert.equal(owner('workers/media/src/transcribe.ts'), 'deny');
    assert.equal(owner('packages/contracts/src/jobs.ts'), 'deny');
  });
});

describe('worker import boundary', () => {
  let root;
  before(() => {
    root = makeProject();
    openSpec(root);
  });
  const write = (rel, body, agent) => preWrite(root, rel, body, agent);
  test('a worker cannot import another worker', () => {
    const out = write('workers/render/src/a.ts', "import { transcribe } from '../../media/src/transcribe';\n", 'media-engineer');
    assert.equal(decision(out), 'deny');
    assert.match(reason(out), /Workers never call or import each other/);
    assert.equal(decision(write('workers/publish/src/a.ts', "import { x } from '@app/worker-agent';\n", 'integrations-engineer')), 'deny');
  });
  test('workers may use base, their own code and packages', () => {
    const body = "import { runLoop } from '@app/worker-base';\nimport { jobs } from '@app/contracts';\nimport { helper } from './helper';\n";
    assert.equal(decision(write('workers/render/src/b.ts', body, 'media-engineer')), 'allow');
  });
  test('the web app and packages never import worker code; workers never import the web app', () => {
    assert.equal(decision(write('src/server/services/a.ts', "import 'server-only';\nimport { x } from '@app/worker-publish';\n", 'backend-engineer')), 'deny');
    assert.equal(decision(write('packages/providers/src/a.ts', "import { x } from '../../../workers/agent/src/x';\n", 'ai-agent-engineer')), 'deny');
    assert.equal(decision(write('workers/agent/src/c.ts', "import { x } from '@/server/dal/posts';\n", 'ai-agent-engineer')), 'deny');
  });
});

describe('fly.io gate', () => {
  let root;
  before(() => {
    root = makeProject();
    openSpec(root, 'publish-flow');
  });
  const fly = (cmd) => decision(preBash(root, cmd, 'platform-engineer'));
  test('development apps are free to change', () => {
    assert.equal(fly('fly deploy --remote-only --app worker-media-dev --config workers/media/fly.toml'), 'allow');
    assert.equal(fly('fly scale count 0 --app worker-render-dev'), 'allow');
    assert.equal(fly('fly status --app worker-media'), 'allow', 'reading production is fine');
    assert.equal(fly('fly logs -a worker-publish'), 'allow');
  });
  test('production apps and commands without --app are closed', () => {
    assert.equal(fly('fly deploy --remote-only --app worker-media --config workers/media/fly.toml'), 'deny');
    assert.equal(fly('flyctl machine restart 1234 --app worker-publish'), 'deny');
    assert.equal(fly('fly deploy --remote-only'), 'deny');
    assert.equal(fly('fly secrets set X=1 --app worker-agent'), 'deny');
  });
  test('accounts, tokens and app deletion are human-only, always', () => {
    for (const c of ['fly auth token', 'fly tokens create deploy', 'fly apps destroy worker-media-dev', 'fly orgs list']) assert.equal(fly(c), 'deny', c);
  });
  test('after "send to production" the production deploy goes through', () => {
    const out = hook(root, 'UserPromptSubmit', { prompt: 'send to production' });
    assert.match(out.systemMessage ?? '', /Production approved/);
    assert.equal(fly('fly deploy --remote-only --app worker-media --config workers/media/fly.toml'), 'allow');
    assert.equal(fly('fly apps destroy worker-media'), 'deny', 'still human-only');
  });
});

describe('specs and approvals', () => {
  let root;
  before(() => {
    root = makeProject();
  });
  test('workers and packages are gated until the spec and its plan are approved', () => {
    assert.equal(cli(root, ['spec', 'new', 'feature', 'discovery-search']).status, 0);
    completeDoc(root, 'specs/001-discovery-search/spec.md');
    cli(root, ['spec', 'activate', '001']);
    assert.equal(decision(preWrite(root, 'workers/discovery/src/a.ts', 'x', 'integrations-engineer')), 'deny', 'not approved');
    const out = hook(root, 'UserPromptSubmit', { prompt: 'approve spec 001' });
    assert.match(out.systemMessage ?? '', /approved/i);
    const closed = preWrite(root, 'workers/discovery/src/a.ts', 'x', 'integrations-engineer');
    assert.equal(decision(closed), 'deny');
    assert.match(reason(closed), /tasks\.md/);
    assert.equal(cli(root, ['spec', 'scaffold', '001', 'tasks']).status, 0);
    completeDoc(root, 'specs/001-discovery-search/tasks.md');
    assert.equal(decision(preWrite(root, 'workers/discovery/src/a.ts', 'x', 'integrations-engineer')), 'allow');
  });
  test('main stays closed until "send to production"', () => {
    sh(root, 'git', ['switch', '-q', '-c', 'feat/001-discovery-search']);
    assert.equal(decision(preBash(root, 'git push origin main')), 'deny');
    assert.equal(decision(preBash(root, 'git push -u origin feat/001-discovery-search')), 'allow');
    hook(root, 'UserPromptSubmit', { prompt: 'send to production' });
    assert.equal(decision(preBash(root, 'git push origin main')), 'allow');
    assert.equal(decision(preBash(root, 'git push --force origin main')), 'deny');
  });
});

describe('preview', () => {
  test('.env.local must point the web app and the workers to development', () => {
    const root = makeProject();
    cli(root, ['supabase', 'prod', 'prodrefprodrefprodre']);
    cli(root, ['supabase', 'dev', 'devrefdevrefdevrefde']);
    const env = (dbRef) =>
      fs.writeFileSync(
        path.join(root, '.env.local'),
        `NEXT_PUBLIC_SUPABASE_URL=https://devrefdevrefdevrefde.supabase.co\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=k\n${dbRef ? `DATABASE_URL=postgresql://postgres.${dbRef}:secretpw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres\n` : ''}`,
      );
    env('prodrefprodrefprodre');
    let r = cli(root, ['preview']);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /DATABASE_URL .*PRODUCTION/);
    assert.doesNotMatch(r.out, /secretpw/, 'never prints values');
    env('devrefdevrefdevrefde');
    r = cli(root, ['preview']);
    assert.equal(r.status, 0, r.out);
    env(null);
    assert.match(cli(root, ['preview']).out, /DATABASE_URL is not set/);
  });
});
