// Applies the effective harness configuration to the file tree:
// parks or restores agents, skills and CI workflows, regenerates .mcp.json,
// syncs enabledPlugins in .claude/settings.json, rewrites agent model/skills
// frontmatter and regenerates .claude/rules/00-delegation.md.
import fs from 'node:fs';
import path from 'node:path';
import { HARNESS_DIR, exists, isDir, listDirs, moveInto, readJson, readText, writeJson, writeText } from './util.mjs';
import { configValue, modelFor } from './config.mjs';
import { parseFrontmatter, removeFrontmatterFields, setFrontmatterFields } from './frontmatter.mjs';
import { createOwnership } from './ownership.mjs';

const DISABLED = `${HARNESS_DIR}/disabled`;

function parkOrRestore(root, activeRel, parkedRel, enabled, changes, apply) {
  const active = path.join(root, activeRel);
  const parked = path.join(root, parkedRel);
  if (enabled && !exists(active) && exists(parked)) {
    changes.push(`restore ${activeRel}`);
    if (apply) moveInto(parked, active);
  } else if (!enabled && exists(active)) {
    changes.push(`park ${activeRel}`);
    if (apply) {
      if (exists(parked)) fs.rmSync(parked, { recursive: true, force: true });
      moveInto(active, parked);
    }
  }
  if (apply) return exists(active);
  return enabled ? exists(active) || exists(parked) : false;
}

export function installedSkills(root) {
  const dir = path.join(root, '.claude', 'skills');
  const names = new Set();
  for (const d of listDirs(dir)) {
    const text = readText(path.join(dir, d, 'SKILL.md'));
    if (!text) continue;
    names.add(parseFrontmatter(text).data.name ?? d);
    names.add(d);
  }
  return names;
}

function substitute(value, config, missing) {
  if (typeof value === 'string') {
    return value.replace(/\{\{([A-Za-z0-9_.]+)\}\}/g, (_, key) => {
      const v = configValue(config, key);
      if (v === undefined || v === null || v === '') missing.push(key);
      return v ?? '';
    });
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, config, missing));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, config, missing)]));
  return value;
}

function renderMcp(h, changes, notes, apply) {
  const file = path.join(h.root, '.mcp.json');
  const current = readJson(file, { mcpServers: {} }) ?? { mcpServers: {} };
  const servers = { ...(current.mcpServers ?? {}) };
  const managed = new Set();
  for (const m of h.catalog.modules.filter((x) => x.kind === 'mcp')) {
    managed.add(m.server);
    if (!h.enabled.get(m.id) || (m.requiresModules ?? []).some((id) => !h.enabled.get(id))) {
      delete servers[m.server];
      continue;
    }
    const missing = [];
    for (const req of m.requires ?? []) {
      const v = configValue(h.config, req);
      if (v === undefined || v === null || v === '') missing.push(req);
    }
    const def = substitute(m.definition, h.config, missing);
    if (missing.length) {
      delete servers[m.server];
      const which = { 'stack.supabase.dev.projectRef': 'dev', 'stack.supabase.prod.projectRef': 'prod' }[missing[0]];
      const how = which ? `pnpm harness supabase ${which} <project-ref>` : `pnpm harness config set ${missing[0]} <value>`;
      notes.push(`MCP "${m.server}" not added yet: connect it with ${how}.`);
      continue;
    }
    servers[m.server] = def;
  }
  // Stable order: managed servers in catalog order, then user servers.
  const ordered = {};
  for (const m of h.catalog.modules.filter((x) => x.kind === 'mcp')) if (servers[m.server]) ordered[m.server] = servers[m.server];
  for (const [k, v] of Object.entries(servers)) if (!managed.has(k)) ordered[k] = v;
  const next = { mcpServers: ordered };
  if (JSON.stringify(next) !== JSON.stringify(current)) {
    changes.push('update .mcp.json');
    if (apply) writeJson(file, next);
  }
}

function renderPlugins(h, changes, apply) {
  const file = path.join(h.root, '.claude', 'settings.json');
  const settings = readJson(file, {}) ?? {};
  const enabledPlugins = { ...(settings.enabledPlugins ?? {}) };
  for (const m of h.catalog.modules.filter((x) => x.kind === 'plugin')) {
    if (h.enabled.get(m.id)) enabledPlugins[m.plugin] = true;
    else if (enabledPlugins[m.plugin] === true) delete enabledPlugins[m.plugin];
  }
  const sorted = Object.fromEntries(Object.entries(enabledPlugins).sort(([a], [b]) => a.localeCompare(b)));
  if (JSON.stringify(sorted) !== JSON.stringify(settings.enabledPlugins ?? {})) {
    changes.push('update enabledPlugins in .claude/settings.json');
    if (apply) writeJson(file, { ...settings, enabledPlugins: sorted });
  }
}

function renderAgentFrontmatter(h, m, installed, changes, apply) {
  const rel = `.claude/agents/${m.name}.md`;
  const file = path.join(h.root, rel);
  const text = readText(file);
  if (!text) return;
  const fm = parseFrontmatter(text).data;
  const model = modelFor(h, m.name);
  const skills = (m.skills ?? []).filter((s) => installed.has(s));
  let next = text;
  if (fm.model !== model) next = setFrontmatterFields(next, { model });
  const currentSkills = Array.isArray(fm.skills) ? fm.skills : fm.skills ? [fm.skills] : [];
  if (JSON.stringify(currentSkills) !== JSON.stringify(skills)) {
    next = skills.length ? setFrontmatterFields(next, { skills }) : removeFrontmatterFields(next, ['skills']);
  }
  if (next !== text) {
    changes.push(`update ${rel} (model ${model}${skills.length ? `, skills ${skills.join(', ')}` : ''})`);
    if (apply) writeText(file, next);
  }
}

export function delegationDoc(h) {
  const own = createOwnership(h);
  const catalogAgents = h.catalog.modules.filter((m) => m.kind === 'agent');
  const rows = catalogAgents
    .filter((m) => h.enabledAgents.includes(m.name))
    .map((m) => {
      const zones = own.primaryZones(m.name).flatMap((z) => z.paths).slice(0, 7);
      return `| \`${m.name}\` | ${m.description} | ${zones.map((z) => `\`${z}\``).join(', ') || 'review reports only'} | ${modelFor(h, m.name)} |`;
    });
  const disabled = catalogAgents
    .filter((m) => !h.enabledAgents.includes(m.name))
    .map((m) => `- \`${m.name}\` is OFF in this profile. Its work goes to: ${[...new Set(own.expand(m.name))].map((f) => (f === 'main' ? 'you (orchestrator)' : `\`${f}\``)).join(' or ')}.`);
  const on = (a) => h.enabledAgents.includes(a);
  const owner = (a) => (on(a) ? `\`${a}\`` : own.expand(a).map((x) => (x === 'main' ? 'you' : `\`${x}\``)).join(' or '));
  const design = (h.policies?.specGate?.requireDesignFor ?? ['feature']).length > 0;
  const reviewers = (h.policies?.review?.agents ?? []).filter(on);
  const quick = Boolean(h.policies?.review?.quick);
  const build = [
    design ? `   a. Features: ${owner('solution-architect')} writes \`design.md\` and \`tasks.md\`${on('database-architect') ? ', `database-architect` the data model' : ''}${on('ux-ui-designer') ? ', `ux-ui-designer` the UI spec' : ''}.` : '   a. Tasks come from `tasks.md`, the plan the solution-architect wrote before approval. No design documents.',
    `   b. Schema: \`backend-engineer\` writes \`supabase/changes/<id>-<slug>.sql\`, applies it to the development project, regenerates types, runs the pgTAP tests.`,
    `   c. Shared contracts and queue names first (\`packages/contracts\`, \`packages/queue\`). Then the workers: \`media-engineer\` (media, render), \`ai-agent-engineer\` (agent), \`integrations-engineer\` (discovery, publish, analytics), \`platform-engineer\` (base image, Fly apps, local runs). Server and database: \`backend-engineer\`. Screens: \`frontend-engineer\`. Independent tasks in parallel when their files do not overlap.`,
    ...(h.policies?.delegation?.pinModels
      ? ['      Builders run on the model in the roster and follow the plan as written; the hook keeps it. A task that comes back partial or blocked is retried once with an `Escalation: <what failed>` line in the brief, which runs it on opus.']
      : []),
    reviewers.length
      ? `   d. Review: ${reviewers.map((r) => `\`${r}\``).join(', ')}${quick ? ' (quick check: the diff only, high and critical issues only)' : ''}. Findings go back to their owners.`
      : '   d. No review agents in this profile: the human reviews while testing.',
  ];
  const intro = `You are the orchestrator. You never write application code, schema or tests: you relay questions, dispatch work, integrate handoffs and keep the human informed.
Hooks deny edits outside an agent's zones, and deny your own edits to owned paths.

## Workflow

1. The human asks for a feature or a fix: run \`/spec-new\`.
2. \`product-manager\` assesses the request. When it needs information it returns questions; you ask them with AskUserQuestion and pass the answers back, until it is ready.
3. \`product-manager\` writes the spec${h.policies?.specGate?.template === 'lite' ? ' (one-page lite spec), then ' + owner('solution-architect') + ' writes the plan in `tasks.md` (files, approach and check per task)' : ''}. You wait until the human types \`approve spec <id>\`.
4. \`/spec-build <id>\` dispatches the work:
${build.join('\n')}
5. The human tests: the development Supabase project plus \`pnpm dev\` and \`pnpm workers:dev\` started by you (\`pnpm harness preview\` checks that \`.env.local\` points to development). Give the URL and the steps to check each acceptance criterion. Fixes go back to the owners.
6. When the human types \`send to production\`: \`/spec-ship\` releases the database change to production (if any), merges the branch into \`main\` and pushes (the web host deploys \`main\`; hosting is not decided yet), deploys the changed workers to their production Fly.io apps and saves the production schema to \`migrations/schema.sql\`.
`;
  return `<!-- GENERATED by \`pnpm harness render\` from .claude/harness (catalog, config, ownership). Do not edit by hand. -->
# Delegation rules (profile: ${h.profileName})

${intro}
## Team roster

| Agent | Responsibility | Writes (main zones) | Model |
|---|---|---|---|
${rows.join('\n')}

${disabled.length ? `## Disabled roles\n\n${disabled.join('\n')}\n` : ''}
## Routing table

| Work item | Owner |
|---|---|
| Intake questions, requirements, acceptance criteria (\`spec.md\`) | ${owner('product-manager')} |
| Architecture, technical design, ADRs, \`design.md\`, \`tasks.md\` | ${owner('solution-architect')} |
| Schema change scripts (\`supabase/changes\`), RLS, pg_cron, Storage, Vault, pgTAP, seeds, generated DB types | \`backend-engineer\` |
| Server actions, route handlers, DAL, auth, integrations, edge functions | \`backend-engineer\` |
| Pages, layouts, client state, forms, data wiring | \`frontend-engineer\` |
| worker-media (export ZIP import, FFmpeg, WhisperX, analysis) and worker-render (Playwright templates, HyperFrames, captions, audio) | \`media-engineer\` |
| worker-agent (Claude Agent SDK, Instagram skills, ContentSpec), video and voice provider adapters | \`ai-agent-engineer\` |
| worker-discovery (Apify, YouTube Data API, yt-dlp), worker-publish (Instagram Graph API, Meta ads), worker-analytics | \`integrations-engineer\` |
| Dockerfiles, worker base image, \`compose.dev.yaml\` on the development VM, Fly.io apps, pg-boss setup, secrets layout | \`platform-engineer\` |
| Security review | ${owner('security-auditor')} |
| Environments, runbooks | \`platform-engineer\` |
| README, guides, changelog | you |

## Delegation protocol

1. One task per delegation, taken from \`specs/<id>-<slug>/tasks.md\` (or a spec step such as review or design).
2. Brief format (hook-enforced when the profile requires it):
   \`Spec:\`, \`Task:\`, \`Goal:\`, \`Inputs:\`, \`Deliverables:\`, \`Acceptance:\`, \`Constraints:\`.
3. Run independent tasks in parallel only when their files do not overlap. Sequence schema, then server, then UI.
4. Each agent ends with a \`## Handoff\` block (Status, Summary, Files, Checks, Spec coverage, Decisions, Follow-ups, Verdict for reviewers).
5. Route every Follow-up to its owner. Never fix another agent's zone yourself.
6. Plugin agents (names with a colon) and built-in agents (Explore, Plan, general-purpose) may research; they cannot write owned paths.
`;
}

export function render(h, { apply = true } = {}) {
  const changes = [];
  const notes = [];
  const root = h.root;
  const installed = installedSkills(root);

  for (const m of h.catalog.modules) {
    const on = h.enabled.get(m.id) === true;
    if (m.kind === 'agent') {
      const ok = parkOrRestore(root, `.claude/agents/${m.name}.md`, `${DISABLED}/agents/${m.name}.md`, on, changes, apply);
      if (on && !ok) notes.push(`Agent file missing: .claude/agents/${m.name}.md`);
    } else if (m.kind === 'workflow-skill' || m.kind === 'vendored-skill') {
      const name = m.name ?? m.skill;
      const activeRel = `.claude/skills/${name}`;
      const parkedRel = `${DISABLED}/skills/${name}`;
      if (!on && !isDir(path.join(root, activeRel))) continue;
      parkOrRestore(root, activeRel, parkedRel, on, changes, apply);
      if (on && m.kind === 'vendored-skill' && !isDir(path.join(root, activeRel)) && !isDir(path.join(root, parkedRel))) {
        notes.push(`Vendored skill "${name}" is enabled but not installed. Run: pnpm harness skills install`);
      }
    } else if (m.kind === 'workflow') {
      parkOrRestore(root, `.github/${m.file}`, `${DISABLED}/github/${m.file}`, on, changes, apply);
    }
  }

  const installedAfter = apply ? installedSkills(root) : installed;
  for (const m of h.catalog.modules.filter((x) => x.kind === 'agent' && h.enabled.get(x.id))) {
    renderAgentFrontmatter(h, m, installedAfter, changes, apply);
  }
  renderMcp(h, changes, notes, apply);
  renderPlugins(h, changes, apply);

  const docRel = '.claude/rules/00-delegation.md';
  const doc = delegationDoc(h);
  if (readText(path.join(root, docRel)) !== doc) {
    changes.push(`regenerate ${docRel}`);
    if (apply) writeText(path.join(root, docRel), doc);
  }
  return { changes, notes };
}
