// Guards shell commands: destructive operations, remote or production writes,
// secret exposure, approval bypass and writes into zones the actor does not own.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'harness', 'lib');
const shell = await import(pathToFileURL(path.join(LIB, 'shell.mjs')).href);
const { currentBranch } = await import(pathToFileURL(path.join(LIB, 'git.mjs')).href);
const { validProductionApprovals } = await import(pathToFileURL(path.join(LIB, 'db-ops.mjs')).href);

// Merging into or pushing the default branch is production (the web host deploys it once chosen). Allowed only after
// the human typed "send to production" in the chat (recorded by the chat-approval hook, 24 hours).
function productionGate(ctx, what) {
  const approvals = validProductionApprovals(ctx.root);
  if (approvals.length) return null;
  return deny(`${what} deploys to production. It runs only after the human tests the change and types "send to production" in the chat; then /spec-ship does it.`);
}

const {
  segments, commandWords, findProgram, positional, hasFlag, writeTargets, inlineScriptPaths, containsSqlDdl,
  splitHeredocs, nestedShellCommands, interpreterScripts,
} = shell;

const ENV_FILE = /(^|\/)\.env(\.[A-Za-z0-9_.-]+)?$/;
const READ_VERBS = new Set([
  'cat', 'less', 'more', 'head', 'tail', 'grep', 'egrep', 'rg', 'ag', 'sed', 'awk', 'cut', 'sort', 'uniq', 'strings',
  'xxd', 'od', 'hexdump', 'base64', 'bat', 'nl', 'diff', 'cmp', 'source', '.', 'cp', 'mv', 'scp', 'rsync', 'curl',
  'open', 'code', 'vim', 'vi', 'nano', 'emacs', 'python', 'python3', 'node', 'jq', 'yq', 'tee', 'paste', 'column',
  'tr', 'wc', 'xargs', 'ln',
]);
const SECRET_HOME = /(~|\$HOME|\/Users\/[^/\s]+|\/home\/[^/\s]+)\/(\.ssh|\.aws|\.gnupg|\.config\/gh|\.supabase|\.netrc|\.npmrc|\.docker\/config\.json|\.vercel|Library\/Keychains|\.kube)/;
const SECRET_VAR = /\$\{?[A-Za-z_]*(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|SERVICE_ROLE|API_KEY|ACCESS_KEY)[A-Za-z_]*\}?/;
const ENV_LITERAL = /['"`](?:[^'"`\s]*\/)?\.env(?:\.(?!example\b)[A-Za-z0-9_.-]+)?['"`]/;
const MAX_NESTING = 3;

function deny(reason) {
  return { decision: 'deny', reason };
}
function ask(reason) {
  return { decision: 'ask', reason };
}

function isEnvFileArg(a) {
  const base = a.replace(/^.*\//, '');
  return ENV_FILE.test(a) && base !== '.env.example' && !a.endsWith('.env.example');
}

function checkGit(args, ctx) {
  const sub = args.find((a) => !a.startsWith('-'));
  const cfg = ctx.policies.bashGuard ?? {};
  if (hasFlag(args, '--no-verify')) return deny('git --no-verify bypasses repository hooks. Fix the hook failure instead.');
  if (sub === 'push') {
    const idx = args.indexOf('push');
    const rest = args.slice(idx + 1);
    if (hasFlag(rest, '--force', '-f', '--force-with-lease', '--force-if-includes') || rest.some((a) => /^\+/.test(a))) {
      return deny('Force pushes are blocked. If history must be rewritten, the human does it.');
    }
    if (cfg.blockPushToDefaultBranch !== false) {
      const defaults = cfg.defaultBranches ?? ['main', 'master'];
      const pos = positional(rest);
      const refspecs = pos.slice(1);
      const branch = currentBranch(ctx.root);
      const targetsDefault = refspecs.some((r) => {
        let dest = r.includes(':') ? r.split(':').pop() : r;
        if (dest === 'HEAD' || dest === '@') dest = branch ?? dest;
        return defaults.includes(dest.replace(/^refs\/heads\//, ''));
      });
      const implicitDefault = refspecs.length === 0 && branch && defaults.includes(branch);
      if (targetsDefault || implicitDefault) return productionGate(ctx, `Pushing to ${defaults.join('/')}`);
    }
    return null;
  }
  if (sub === 'merge' && cfg.blockPushToDefaultBranch !== false) {
    const defaults = cfg.defaultBranches ?? ['main', 'master'];
    const branch = currentBranch(ctx.root);
    const rest = args.slice(args.indexOf('merge') + 1);
    if (branch && defaults.includes(branch) && !hasFlag(rest, '--abort', '--quit')) return productionGate(ctx, `Merging into ${branch}`);
    return null;
  }
  if (sub === 'reset' && hasFlag(args, '--hard')) return ask('git reset --hard discards uncommitted work.');
  if (sub === 'clean' && args.some((a) => /^-[a-zA-Z]*f/.test(a))) return ask('git clean -f deletes untracked files.');
  if ((sub === 'checkout' || sub === 'restore') && positional(args.slice(args.indexOf(sub) + 1)).includes('.')) {
    return ask(`git ${sub} . discards changes in the whole working tree.`);
  }
  if (sub === 'branch' && hasFlag(args, '-D')) return ask('Force-deleting a branch.');
  if (sub === 'stash' && args.some((a) => a === 'drop' || a === 'clear')) return ask('Dropping stashed work.');
  if (sub === 'filter-branch' || sub === 'filter-repo' || (sub === 'reflog' && args.includes('expire'))) {
    return deny('History rewriting commands are human-only.');
  }
  return null;
}

// Values of the given flags (-c x, --command x, --command=x, -cx).
function flagValues(args, short, long) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if ((a === short || a === long) && args[i + 1] !== undefined) out.push(args[i + 1]);
    else if (long && a.startsWith(`${long}=`)) out.push(a.slice(long.length + 1));
    else if (short && a.startsWith(short) && a.length > short.length && !a.startsWith('--')) out.push(a.slice(short.length));
  }
  return out;
}

function readSqlFiles(ctx, files) {
  return files.map((f) => {
    try {
      const abs = path.isAbsolute(f) ? f : path.resolve(ctx.input.cwd || ctx.root, f);
      return fs.readFileSync(abs, 'utf8');
    } catch {
      return '';
    }
  });
}

// Everything a database CLI call will execute: inline SQL, SQL files and heredoc input.
function sqlOf(ctx, seg, bodies, inline, files) {
  const parts = [...inline, ...readSqlFiles(ctx, files)];
  if (seg.includes('<<')) parts.push(...bodies);
  return parts.join('\n;\n');
}

function checkSupabase(args, ctx, seg, bodies) {
  const pos = positional(args);
  const [a, b] = pos;
  const remote = hasFlag(args, '--linked', '--db-url', '--project-ref');
  const two = `${a ?? ''} ${b ?? ''}`.trim();
  const humanOnly = 'Production changes reach Supabase only as an approved release (the human types "send to production", then /spec-ship).';
  const noLocal =
    'This project has no local database and no Docker. Schema changes are applied to the development project through the MCP (-- devharness:apply <id>) and database tests run there, rolled back: ' +
    '`pnpm harness db test` (see .claude/rules/20-database.md).';
  const changes = 'This project keeps no migration history: write the schema change in supabase/changes/<spec-id>-<slug>.sql and apply it with -- devharness:apply <id> on the supabase MCP server.';
  if (a === 'start' || a === 'stop' || two === 'test db' || (two === 'db reset' && !remote) || two === 'db start' || (a === 'status' && !remote && args.includes('-o'))) {
    return deny(`supabase ${two} needs a local Supabase stack (Docker). ${noLocal}`);
  }
  if (two === 'db push') return deny(`supabase db push is blocked for agents. ${humanOnly}`);
  if (two === 'db reset') return deny(`Resetting a remote database is blocked. ${humanOnly}`);
  if (a === 'migration' || two === 'db pull' || two === 'db diff') return deny(changes);
  if (two === 'db dump' && remote) return ask('Dumping a remote database may expose production data.');
  if (two === 'db query' && remote) return ask('Querying a remote database. Prefer the Supabase MCP server (read-only).');
  if (two === 'db query' && containsSqlDdl(sqlOf(ctx, seg, bodies, pos.slice(2), flagValues(args, '-f', '--file')))) {
    return deny(`Ad-hoc DDL is blocked. ${changes}`);
  }
  if (a === 'seed' && remote) return deny(humanOnly);
  if (a === 'functions' && ['deploy', 'delete'].includes(b)) return deny(`Edge function deploys run through CI or the human. ${humanOnly}`);
  if (a === 'secrets' && ['set', 'unset'].includes(b)) return deny('Managing remote secrets is human-only.');
  if (a === 'projects' && ['create', 'delete'].includes(b)) return deny('Creating or deleting projects is human-only.');
  if (a === 'branches' && ['create', 'delete', 'update', 'pause', 'unpause'].includes(b)) return ask(`supabase branches ${b} changes remote preview branches.`);
  if (a === 'storage' && ['rm', 'cp', 'mv'].includes(b)) return deny('Remote storage writes are human-only.');
  if (['link', 'unlink', 'login', 'logout'].includes(a)) return ask(`supabase ${a} changes the project link or credentials.`);
  if (['sso', 'network-restrictions', 'network-bans', 'ssl-enforcement', 'domains', 'vanity-subdomains', 'encryption', 'backups', 'postgres-config', 'orgs'].includes(a)) {
    return deny(`supabase ${a} manages production infrastructure and is human-only.`);
  }
  return null;
}

function checkVercel(args) {
  const pos = positional(args);
  const a = pos[0];
  const b = pos[1];
  if (hasFlag(args, '--prod', '--production') || args.includes('--target=production')) {
    return deny('Production deploys happen through git (merge to main) or by the human. Use preview deployments.');
  }
  if (['promote', 'rollback', 'remove', 'rm', 'alias', 'domains', 'dns', 'certs', 'teams', 'billing', 'transfer'].includes(a)) {
    return deny(`vercel ${a} changes production routing, domains or account state and is human-only.`);
  }
  if (a === 'project' && ['rm', 'remove'].includes(b)) return deny('Removing a Vercel project is human-only.');
  if (a === 'env' && ['rm', 'remove'].includes(b)) return deny('Removing environment variables is human-only.');
  if (a === 'env' && ['add', 'update'].includes(b)) return ask(`vercel env ${b} changes remote configuration.`);
  if (a === 'integration' && ['add', 'remove'].includes(b)) return ask(`vercel integration ${b}.`);
  if (a === undefined || a === 'deploy' || a === 'redeploy' || a === 'link' || a === 'git') {
    return ask(`vercel ${a ?? '(deploy)'} creates or links remote resources. Confirm it targets a preview.`);
  }
  return null;
}

// Fly.io: development apps (name ending in stack.fly.devSuffix, default "-dev") are free to use.
// Anything that changes a production app runs only after the human typed "send to production".
function checkFly(args, ctx) {
  const pos = positional(args);
  const [a, b] = pos;
  const suffix = ctx.h.config.stack?.fly?.devSuffix || '-dev';
  const app = flagValues(args, '-a', '--app')[0];
  const isDev = Boolean(app && app.endsWith(suffix));
  if (a === 'auth' && ['token', 'logout'].includes(b)) return deny(`fly auth ${b} is human-only.`);
  if (a === 'tokens' || a === 'orgs' || (a === 'apps' && ['destroy', 'move'].includes(b)) || a === 'destroy') {
    return deny(`fly ${a}${b ? ` ${b}` : ''} changes accounts, tokens or deletes apps and is human-only.`);
  }
  const changes =
    ['deploy', 'scale', 'launch'].includes(a) ||
    (a === 'secrets' && ['set', 'unset', 'import', 'deploy'].includes(b)) ||
    (['machine', 'machines', 'm'].includes(a) && ['run', 'update', 'destroy', 'remove', 'rm', 'clone', 'start', 'stop', 'restart'].includes(b)) ||
    (a === 'volumes' && ['create', 'destroy', 'extend', 'delete'].includes(b)) ||
    (a === 'releases' && b === 'rollback');
  if (!changes) return null;
  if (isDev) return null;
  if (!app) {
    return deny(`fly ${a}${b ? ` ${b}` : ''} without --app could target a production app. Pass --app <worker>${suffix} for development; production changes run in /spec-ship after "send to production".`);
  }
  return productionGate(ctx, `fly ${a}${b ? ` ${b}` : ''} on ${app}`);
}

// Docker runs only on the development VM, reached from this machine through one Docker context
// (stack.docker.context, set as DOCKER_CONTEXT in .claude/settings.json). Docker access on a host is
// root access and the containers receive the development secrets, so the guard keeps commands on
// that context, blocks host escapes and public ports, and blocks commands that print container
// environments. Registries, logins and contexts are human-only. Production never runs on Docker.
const DOCKER_SUBS = new Set(['compose', 'build', 'buildx', 'run', 'create', 'exec', 'ps', 'logs', 'images', 'image', 'container', 'inspect', 'login', 'logout', 'push', 'pull', 'tag', 'context', 'system', 'volume', 'network', 'stop', 'start', 'restart', 'rm', 'rmi', 'kill', 'stats', 'top', 'cp', 'info', 'version', 'swarm', 'plugin', 'trust', 'secret', 'service', 'stack', 'save', 'load', 'export', 'import', 'commit', 'update', 'events', 'port', 'diff', 'wait', 'attach']);
const COMPOSE_SUBS = new Set(['up', 'down', 'build', 'run', 'exec', 'ps', 'logs', 'config', 'pull', 'push', 'restart', 'stop', 'start', 'rm', 'kill', 'create', 'images', 'top', 'ls', 'version', 'cp', 'watch', 'events', 'port', 'pause', 'unpause', 'wait', 'attach', 'stats']);
const ENV_DUMP = /(^|\s)(printenv|env|export|set)(\s|$)|\/proc\/[^\s]*environ|\$\{?[A-Z_]*(SECRET|TOKEN|KEY|PASSWORD|DATABASE_URL)/;

function firstOf(args, subs) {
  const i = args.findIndex((a) => subs.has(a));
  return i < 0 ? { sub: null, rest: [], before: args } : { sub: args[i], rest: args.slice(i + 1), before: args.slice(0, i) };
}

function runFlagsProblem(args) {
  const joined = ` ${args.join(' ')} `;
  if (/\s--privileged(\s|=)/.test(joined)) return '--privileged';
  if (/\s--cap-add[\s=]/.test(joined)) return '--cap-add';
  if (/\s--device[\s=]/.test(joined)) return '--device';
  if (/\s--(pid|ipc|uts|userns)[\s=]host\s/.test(joined)) return 'host namespaces';
  if (/\s--(network|net)[\s=]host\s/.test(joined)) return '--network host';
  if (/docker\.sock/.test(joined)) return 'the Docker socket';
  const values = [...flagValues(args, '-v', '--volume'), ...flagValues(args, '', '--mount')];
  if (values.some((v) => /^(\/|~|\.|\$)/.test(v) || /(^|,)(type=bind|source=\/|src=\/)/.test(v))) return 'a bind mount of a host path';
  const ports = flagValues(args, '-p', '--publish');
  if (ports.some((v) => !/^127\.0\.0\.1:/.test(v)) || /\s(-P|--publish-all)\s/.test(joined)) return 'a port that is not bound to 127.0.0.1';
  return null;
}

function checkDocker(name, args, seg, ctx) {
  const context = ctx.h.config.stack?.docker?.context || 'araclinch-vm';
  const raw = seg.join(' ');
  if (/\bDOCKER_(HOST|CONTEXT|CONFIG|TLS[A-Z_]*)=/.test(raw)) return deny('Docker commands run only on the development VM context; changing DOCKER_HOST or DOCKER_CONTEXT is blocked.');
  const isCompose = name === 'docker-compose';
  const top = isCompose ? { sub: 'compose', rest: args, before: [] } : firstOf(args, DOCKER_SUBS);
  const { sub, rest, before } = top;
  // Global flags come before the subcommand; later -c or -H belong to the command run in a container.
  const ctxFlag = flagValues(before, '-c', '--context')[0];
  if (ctxFlag && ctxFlag !== context) return deny(`Docker commands run only on the "${context}" context (the development VM).`);
  if (flagValues(before, '-H', '--host').length || before.some((a) => a === '--config' || a.startsWith('--config='))) {
    return deny('Docker commands run only on the development VM context; --host and --config are blocked.');
  }
  if (!sub) return null;
  if (['login', 'logout', 'push', 'trust', 'swarm', 'secret', 'service', 'stack', 'plugin'].includes(sub)) {
    return deny(`docker ${sub} is human-only: registries, credentials and cluster setup are not part of development.`);
  }
  if (sub === 'context') {
    const [c] = positional(rest);
    return ['ls', 'list', 'show', 'inspect'].includes(c) ? null : deny(`docker context ${c ?? ''} changes where Docker runs and is human-only.`);
  }
  if (sub === 'image' && positional(rest)[0] === 'push') return deny('Pushing images is human-only; production images are built by Fly.');
  if ((sub === 'build' || sub === 'buildx') && rest.includes('--push')) return deny('Pushing images is human-only; production images are built by Fly.');
  if (sub === 'inspect' || (sub === 'container' && positional(rest)[0] === 'inspect')) {
    return deny('docker inspect prints container environments, which hold the development secrets. Use docker ps, docker logs or docker compose ps.');
  }
  if (['run', 'create'].includes(sub) || (sub === 'container' && ['run', 'create'].includes(positional(rest)[0]))) {
    if (rest.some((a) => /^(?:[\w.-]+\/)*(postgres|postgis|supabase\/postgres|pgvector\/pgvector)(:|@|$)/.test(a))) {
      return deny('No local database, also not in a container: workers use the development Supabase project.');
    }
    const problem = runFlagsProblem(rest);
    if (problem) return deny(`Containers on the development VM may not use ${problem}. Workers need none of it; the VM is reachable from the internet.`);
  }
  if (sub === 'exec' && ENV_DUMP.test(rest.join(' '))) return deny('Printing a container environment is blocked: it holds the development secrets.');
  if ((sub === 'system' && positional(rest)[0] === 'prune') || (sub === 'volume' && ['prune', 'rm'].includes(positional(rest)[0]))) {
    return ask(`docker ${sub} ${positional(rest)[0]} deletes data on the development VM.`);
  }
  if (sub === 'compose') {
    const c = firstOf(rest, COMPOSE_SUBS);
    if (c.sub === 'push') return deny('Pushing images is human-only; production images are built by Fly.');
    if (c.sub === 'config' && !c.rest.some((a) => ['-q', '--quiet', '--services', '--volumes', '--profiles', '--images', '--networks'].includes(a))) {
      return deny('docker compose config prints the resolved environment, which holds the development secrets. Use `docker compose config --quiet` to validate or `--services` to list.');
    }
    if (c.sub === 'run') {
      const problem = runFlagsProblem(c.rest);
      if (problem) return deny(`Containers on the development VM may not use ${problem}.`);
    }
    if ((c.sub === 'exec' || c.sub === 'run') && ENV_DUMP.test(c.rest.join(' '))) return deny('Printing a container environment is blocked: it holds the development secrets.');
    if (c.sub === 'down' && c.rest.some((a) => a === '-v' || a === '--volumes')) return ask('docker compose down --volumes deletes the volumes on the development VM.');
  }
  return null;
}

function checkGh(args, ctx) {
  const [a, b] = positional(args);
  if (a === 'auth' && b === 'token') return deny('Printing GitHub tokens is blocked.');
  if (a === 'repo' && ['delete', 'archive', 'rename', 'edit'].includes(b)) return deny(`gh repo ${b} is human-only.`);
  if (a === 'secret') return deny('Managing GitHub secrets is human-only.');
  if (a === 'pr' && b === 'merge') return productionGate(ctx, 'Merging a pull request');
  if (a === 'release' && ['create', 'delete', 'edit'].includes(b)) return ask(`gh release ${b}.`);
  if (a === 'workflow' && ['run', 'enable', 'disable'].includes(b)) return ask(`gh workflow ${b}.`);
  if (a === 'variable' && ['set', 'delete'].includes(b)) return ask(`gh variable ${b}.`);
  if (a === 'api' && args.some((x, i) => (x === '-X' || x === '--method') && /^(POST|PUT|PATCH|DELETE)$/i.test(args[i + 1] ?? ''))) {
    return ask('Mutating GitHub API call.');
  }
  return null;
}

function checkPackageManager(name, args, ctx) {
  const [a] = positional(args);
  if (a === 'publish' || args.includes('publish')) return deny('Publishing packages is human-only.');
  const adding = ['add', 'install', 'i'].includes(a) && positional(args).length > 1;
  if (hasFlag(args, '-g', '--global') && adding) return ask('Global package installation changes the machine, not the project.');
  if (adding && ctx.actor === 'main' && ctx.h.checkOn('ownership')) {
    return deny('Adding dependencies is an engineering decision. Delegate it to the owning agent, who records the rationale in design.md or an ADR.');
  }
  if (adding) {
    return { context: 'You are adding a dependency: record it (name, reason, alternatives, license) in the spec design.md or an ADR, and prefer well-maintained packages.' };
  }
  return null;
}

function resolveTarget(ctx, target) {
  let t = target.replace(/^~(?=\/|$)/, os.homedir());
  if (!path.isAbsolute(t)) t = path.resolve(ctx.input.cwd || ctx.root, t);
  return ctx.rel(t);
}

function analyze(ctx, cmd, results, depth) {
  const add = (r) => r && results.push(r);
  const { command: bare, bodies } = splitHeredocs(cmd);

  // Whole-command patterns. Credential stores are checked on the raw text, heredoc
  // bodies included; the rest on the command without bodies (bodies fed to a shell
  // are analyzed recursively below).
  if (/\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/.test(bare) || /\b(ba|z)?sh\s+<\(\s*(curl|wget)/.test(bare)) {
    add(deny('Piping remote scripts into a shell is blocked.'));
  }
  if (SECRET_HOME.test(cmd) || /\bsecurity\s+find-(generic|internet)-password\b/.test(cmd)) {
    add(deny('Access to credential stores (~/.ssh, ~/.aws, keychain, CLI tokens) is blocked.'));
  }
  if (/(^|[\s;&|])(spec:approve)\b/.test(bare) || /harness(\.mjs)?\s+spec\s+approve\b/.test(bare)) {
    const approval = ctx.policies.specGate?.approval ?? 'human';
    const agentMayApprove = approval !== 'human' && ctx.actor === 'product-manager' && /--agent\s+product-manager\b/.test(bare);
    if (!agentMayApprove) add(deny('Spec approval is human-only. Ask the human to type `approve spec <id>` in the chat.'));
  }
  if (/\bharness(\.mjs)?\s+(profile|enable|disable|render|models|supabase)\b/.test(bare) || /(^|\s)pnpm\s+harness\s+(profile|enable|disable|render|models|supabase)\b/.test(bare)) {
    add(ask('This changes the harness configuration (agents, guards, MCP servers). Confirm with the human.'));
  }
  if (/:\(\)\s*\{\s*:\|:&\s*\};:/.test(bare) || /\bmkfs\b|\bdd\b[^|;&]*\bof=\/dev\/(sd|disk|nvme)/.test(bare) || /\b(shutdown|reboot|halt)\b/.test(bare)) {
    add(deny('System-destructive command blocked.'));
  }
  if (interpreterScripts(cmd).some((text) => ENV_LITERAL.test(text))) {
    add(deny('Scripts that open environment files (.env, .env.local, ...) are blocked. Use .env.example for variable names.'));
  }

  for (const seg of segments(cmd)) {
    const words = commandWords(seg);
    if (!words.length) continue;
    const first = path.posix.basename(words[0]);

    if (first === 'sudo' || first === 'doas') add(deny('sudo is not allowed in project sessions.'));
    if (['printenv', 'export', 'set', 'declare', 'env'].includes(first)) {
      const rest = words.slice(1);
      const dumps =
        first === 'printenv' ||
        (first === 'env' && (rest.length === 0 || rest.every((w) => w.startsWith('-')))) ||
        (first === 'export' && (rest.length === 0 || rest[0] === '-p')) ||
        (first === 'set' && rest.length === 0) ||
        (first === 'declare' && rest.some((w) => /^-[a-z]*x/.test(w)));
      if (dumps) add(deny('Dumping environment variables can leak secrets. Read specific, non-secret variables instead.'));
    }
    if ((first === 'echo' || first === 'printf') && SECRET_VAR.test(seg.join(' '))) {
      add(deny('Printing secret environment variables is blocked.'));
    }
    if (READ_VERBS.has(first) && words.slice(1).some(isEnvFileArg)) {
      add(deny('Reading or copying environment files (.env, .env.local, ...) is blocked. Use .env.example for variable names.'));
    }
    if (seg.some((t, i) => /^\d?<$/.test(t) && seg[i + 1] && isEnvFileArg(seg[i + 1]))) {
      add(deny('Redirecting environment files into a command is blocked.'));
    }
    if (first === 'chmod' && words.includes('777')) add(deny('chmod 777 is blocked.'));
    if (first === 'rm') {
      const pos = positional(words.slice(1));
      const recursive = words.some((w) => /^-[a-zA-Z]*[rR]/.test(w) || w === '--recursive');
      const dangerous = pos.some((p) => /^(\/|~|\$HOME|\.\.?|\.\/?|\*)$/.test(p) || /^(\/|~\/)?\.git(\/|$)/.test(p) || /^\.\/?\.git/.test(p));
      if (dangerous) add(deny(`rm on ${pos.join(' ')} is blocked.`));
      if (recursive && pos.some((p) => /^(\.\/)?(supabase\/changes|supabase\/migrations|migrations|specs|\.claude)\/?$/.test(p))) {
        add(deny('Recursive deletion of change scripts, the schema snapshot, specs or harness directories is blocked.'));
      }
    }
    if (first === 'claude') {
      if (/\b(?:approve|aprobar|apruebo|aprueba)\b|\bprod(?:uction)?\b|producci[oó]n|\brelease\s+spec/i.test(cmd)) {
        add(deny('Approvals ("approve spec <id>", "send to production") come only from the human typing them in their own chat. Nested Claude sessions cannot carry them.'));
      } else if (words.some((w) => ['--bare', '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions'].includes(w))) {
        add(deny('Nested Claude sessions that skip hooks or permissions are blocked.'));
      } else {
        add(ask('Starting a nested Claude Code process.'));
      }
    }
    if (['podman', 'colima', 'orbctl'].includes(first)) {
      add(deny('Local container runtimes are not used. Containers run on the development VM through the Docker context in stack.docker.context (`pnpm workers:dev`).'));
    }
    const dk = findProgram(words, ['docker', 'docker-compose']);
    if (dk) add(checkDocker(dk.name, dk.args, seg, ctx));

    const git = findProgram(words, 'git');
    if (git) add(checkGit(git.args, ctx));
    const sb = findProgram(words, 'supabase');
    if (sb) add(checkSupabase(sb.args, ctx, seg, bodies));
    const vc = findProgram(words, 'vercel');
    if (vc) add(checkVercel(vc.args));
    const fly = findProgram(words, ['fly', 'flyctl']);
    if (fly) add(checkFly(fly.args, ctx));
    const gh = findProgram(words, 'gh');
    if (gh) add(checkGh(gh.args, ctx));
    const pm = findProgram(words, ['pnpm', 'npm', 'yarn', 'bun']);
    if (pm && pm.index === 0) add(checkPackageManager(pm.name, pm.args, ctx));
    const pg = findProgram(words, ['psql', 'pg_dump', 'pg_restore', 'pg_dumpall']);
    if (pg) {
      const joined = pg.args.join(' ');
      const remoteHost = /(@|host=|-h\s*|--host[= ])(?!localhost|127\.0\.0\.1|0\.0\.0\.0|::1|\[::1\])[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(joined);
      const sql = pg.name === 'psql' ? sqlOf(ctx, seg, bodies, flagValues(pg.args, '-c', '--command'), flagValues(pg.args, '-f', '--file')) : '';
      if (pg.name === 'psql' && containsSqlDdl(sql)) {
        add(deny('Schema changes through psql are blocked. Write a migration instead.'));
      } else if (remoteHost) {
        add(ask(`${pg.name} against a remote database host. Confirm this is intended and read-only.`));
      }
    }
  }

  // Ownership of shell writes.
  if (ctx.h.checkOn('ownership') && ctx.policies.ownership?.mode !== 'off') {
    const targets = [...writeTargets(cmd), ...inlineScriptPaths(cmd)];
    const seen = new Set();
    for (const t of targets) {
      const rel = resolveTarget(ctx, t);
      if (rel === null || rel === '' || seen.has(rel)) continue;
      seen.add(rel);
      const verdict = ctx.ownership.check(ctx.actor, rel);
      if (verdict.decision === 'allow') continue;
      const msg = `Shell write to ${rel}: ${verdict.reason} Use the Write/Edit tools from the owning agent instead of shell redirection.`;
      if (ctx.policies.ownership?.mode === 'warn') add({ context: `[warning] ${msg}` });
      else add(verdict.decision === 'ask' ? ask(msg) : deny(msg));
    }
  }

  // Shell code nested in the command (bash -c, eval, heredocs fed to a shell).
  const nested = nestedShellCommands(cmd);
  if (nested.length && depth >= MAX_NESTING) {
    add(deny('Deeply nested shell commands are blocked. Run the inner command directly.'));
  } else {
    for (const inner of nested) analyze(ctx, inner, results, depth + 1);
  }
}

export async function run(ctx) {
  if (ctx.tool !== 'Bash') return null;
  const cmd = String(ctx.toolInput.command ?? '');
  if (!cmd.trim()) return null;
  const results = [];
  analyze(ctx, cmd, results, 0);

  const unique = (list) => [...new Set(list)];
  const denies = results.filter((r) => r.decision === 'deny');
  if (denies.length) return deny(unique(denies.map((r) => r.reason)).join(' | '));
  const asks = results.filter((r) => r.decision === 'ask');
  if (asks.length) return ask(unique(asks.map((r) => r.reason)).join(' | '));
  const contexts = unique(results.filter((r) => r.context).map((r) => r.context));
  return contexts.length ? { context: contexts.join('\n') } : null;
}
