// Blocks secrets and unsafe client/server boundaries in file edits.
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'harness', 'lib');
const { EDIT_TOOLS, editTarget, projectedContent, introducedText } = await import(pathToFileURL(path.join(LIB, 'edits.mjs')).href);
const { matchAny } = await import(pathToFileURL(path.join(LIB, 'glob.mjs')).href);

const SECRET_PATTERNS = [
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY-----/, 'a private key'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, 'a JWT (Supabase keys are JWTs; load them from environment variables)'],
  [/\bsb_secret_[A-Za-z0-9_-]{16,}/, 'a Supabase secret key'],
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/, 'a Stripe secret key'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, 'an AWS access key id'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/, 'a GitHub token'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'a Google API key'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'an Anthropic API key'],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/, 'an OpenAI-style API key'],
  [/\bpostgres(?:ql)?:\/\/[^:\s/]+:[^@\s]{6,}@(?!(?:127\.0\.0\.1|localhost|0\.0\.0\.0|host\.docker\.internal|db)[:/])[A-Za-z0-9.-]+/, 'a database URL with a password'],
];
const GENERIC_SECRET = /\b(secret|password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*['"`]([^'"`\s]{12,})['"`]/i;
const PLACEHOLDER = /(process\.env|import\.meta\.env|<[^>]+>|your[-_]|example|changeme|placeholder|xxx|dummy|fake|test[-_]?value|\$\{)/i;
const FIXTURE_PATHS = ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/fixtures/**', '**/__mocks__/**', 'tests/**', 'e2e/**', 'supabase/tests/**', 'docs/**', 'specs/**', '**/*.md'];
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|json|ya?ml|toml|sql|sh|env)$/;
const ADMIN_KEY = /\b(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|service_role|sb_secret_)/;
const ADMIN_ALLOWED = ['src/server/**', 'workers/**', 'packages/queue/**', 'supabase/functions/**', 'scripts/**', '.env.example', 'docs/**', 'specs/**', '**/*.md', '**/*.test.*', 'tests/**', 'supabase/tests/**', '.github/**'];

function isClientComponent(text) {
  const head = text.replace(/^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/g, '').slice(0, 200);
  return /^\s*(['"])use client\1/.test(head);
}

export async function run(ctx) {
  if (!EDIT_TOOLS.has(ctx.tool)) return null;
  const target = editTarget(ctx.tool, ctx.toolInput);
  const rel = ctx.rel(target);
  if (rel === null) return null;
  const base = path.posix.basename(rel);

  if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') {
    return { decision: 'deny', reason: `Editing ${rel} is blocked: environment files hold secrets and are human-maintained. Document new variables in .env.example.` };
  }

  const added = introducedText(ctx.tool, ctx.toolInput) ?? '';
  const isFixture = matchAny(rel, FIXTURE_PATHS);
  const problems = [];
  const warnings = [];

  for (const [rx, label] of SECRET_PATTERNS) {
    if (rx.test(added)) {
      if (isFixture && !/PRIVATE KEY|database URL/.test(label)) warnings.push(`This change contains what looks like ${label}. Use obviously fake values in fixtures.`);
      else problems.push(`The change contains ${label}. Never hardcode credentials: read them from environment variables (server-only) and document the name in .env.example.`);
    }
  }
  const generic = added.match(GENERIC_SECRET);
  if (generic && CODE_FILE.test(rel) && !PLACEHOLDER.test(generic[0]) && !isFixture) {
    return { decision: 'ask', reason: `Possible hardcoded credential in ${rel} ("${generic[1]}" = ${generic[2].slice(0, 4)}...). Confirm it is not a secret.` };
  }
  const publicSecret = added.match(/\bNEXT_PUBLIC_[A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|TOKEN|DATABASE_URL|DB_URL)[A-Z0-9_]*/);
  if (publicSecret) {
    problems.push(`${publicSecret[0]} would be inlined into the browser bundle. NEXT_PUBLIC_ variables must never hold secrets.`);
  }

  const isSource = /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(rel) && rel.startsWith('src/');
  if (isSource) {
    const content = projectedContent(ctx.root, ctx.tool, ctx.toolInput) ?? '';
    const isTest = /\.(test|spec)\.[a-z]+$/.test(rel) || rel.includes('__tests__/');
    if (isClientComponent(content)) {
      if (ADMIN_KEY.test(content)) problems.push('A client component references the Supabase admin key. Admin access belongs in src/server only.');
      const serverEnv = content.match(/process\.env\.(?!NEXT_PUBLIC_|NODE_ENV\b)([A-Z0-9_]+)/);
      if (serverEnv) problems.push(`Client component reads process.env.${serverEnv[1]}. Only NEXT_PUBLIC_ variables reach the browser; move this logic to a server action or route handler.`);
      if (/from\s+['"](@\/server\/|server-only['"])/.test(content) || /import\s+['"]server-only['"]/.test(content)) {
        problems.push('A client component imports server-only code (@/server or server-only). Call a server action instead.');
      }
    }
    if (rel.startsWith('src/server/') && !isTest && !rel.endsWith('.d.ts') && /\.(ts|tsx)$/.test(rel)) {
      const hasGuard = /import\s+['"]server-only['"]/.test(content) || /^\s*(['"])use server\1/m.test(content.slice(0, 400));
      if (!hasGuard) problems.push(`${rel} must start with \`import 'server-only'\` (or the 'use server' directive for server actions) so it can never be bundled for the browser.`);
    }
    if (!isTest && ADMIN_KEY.test(added) && !matchAny(rel, ADMIN_ALLOWED)) {
      problems.push(`The Supabase admin key may only be used under src/server/** (for example src/server/supabase/admin.ts). ${rel} is outside that boundary.`);
    }
    if (/dangerouslySetInnerHTML/.test(added)) warnings.push('dangerouslySetInnerHTML: sanitize the HTML (for example with DOMPurify) or render structured content instead.');
    if (/\beval\s*\(|new\s+Function\s*\(/.test(added)) warnings.push('eval/new Function detected: avoid dynamic code execution.');
    if (/auth\.getSession\s*\(/.test(added) && /^(src\/server|src\/app\/api|src\/proxy|src\/middleware)|\/route\.[jt]s$/.test(rel)) {
      warnings.push('On the server, authorize with supabase.auth.getClaims() or getUser(); getSession() does not revalidate the JWT.');
    }
    if (/@ts-ignore/.test(added)) warnings.push('Prefer `// @ts-expect-error <reason>` over @ts-ignore.');
  }

  // Process boundaries of this system: workers never import each other, web and workers share
  // code only through packages/.
  if (/\.(ts|tsx|js|jsx|mjs|cjs|mts)$/.test(rel) && (rel.startsWith('workers/') || rel.startsWith('src/') || rel.startsWith('packages/'))) {
    const code = projectedContent(ctx.root, ctx.tool, ctx.toolInput) ?? '';
    const specs = [...code.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
    const own = rel.startsWith('workers/') ? rel.split('/')[1] : null;
    for (const spec of specs) {
      const target = spec.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)) : spec;
      const worker = /^(?:workers\/|@workers\/|@[\w-]+\/worker-)([\w-]+)/.exec(target)?.[1];
      if (rel.startsWith('workers/') && worker && worker !== own && worker !== 'base') {
        problems.push(`${rel} imports from worker "${worker}" (${spec}). Workers never call or import each other: share code through packages/ and pass work through pg-boss jobs.`);
      } else if ((rel.startsWith('src/') || rel.startsWith('packages/')) && worker) {
        problems.push(`${rel} imports worker code (${spec}). The web app and packages talk to workers only through pg-boss jobs; shared code lives in packages/.`);
      } else if ((rel.startsWith('workers/') || rel.startsWith('packages/')) && (/^(?:src\/|@\/)/.test(target))) {
        problems.push(`${rel} imports web app code (${spec}). Move shared code to packages/.`);
      }
    }
  }

  if (problems.length) return { decision: 'deny', reason: problems.join(' ') };
  if (warnings.length) return { context: `[harness warning] ${warnings.join(' ')}` };
  return null;
}
