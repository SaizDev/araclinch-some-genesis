#!/usr/bin/env node
// Helpers used by scripts/harness/bootstrap.sh. Idempotent: safe to run again.
//   merge <from> <to>        copy the create-next-app output without overwriting harness files
//   package                  add harness scripts to package.json
//   configs                  write test and lint configuration if missing, patch tsconfig and eslint ignores
//   env-local                create .env.local from .env.example, with the development Supabase project URL when it is configured
//   foundation-dates         stamp today's date into specs/000-foundation/spec.md
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const [cmd, ...args] = process.argv.slice(2);

const KEEP = new Set(['README.md', 'AGENTS.md', 'CLAUDE.md', '.git', 'node_modules', '.next']);

function copyTree(from, to, rel = '') {
  const created = [];
  for (const entry of fs.readdirSync(path.join(from, rel), { withFileTypes: true })) {
    const r = path.join(rel, entry.name);
    if (!rel && KEEP.has(entry.name)) continue;
    const src = path.join(from, r);
    const dst = path.join(to, r);
    if (entry.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      created.push(...copyTree(from, to, r));
    } else if (entry.name === '.gitignore' && !rel && fs.existsSync(dst)) {
      const have = new Set(fs.readFileSync(dst, 'utf8').split('\n').map((l) => l.trim()));
      const extra = fs.readFileSync(src, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#') && !have.has(l.trim()) && l.trim() !== '.env*');
      if (extra.length) fs.appendFileSync(dst, `\n# from create-next-app\n${extra.join('\n')}\n`);
    } else if (!fs.existsSync(dst)) {
      fs.copyFileSync(src, dst);
      created.push(r);
    }
  }
  return created;
}

const SCRIPTS = {
  typecheck: 'next typegen && tsc --noEmit',
  test: 'vitest run --passWithNoTests',
  'test:watch': 'vitest',
  'test:e2e': 'playwright test --pass-with-no-tests',
  format: 'prettier --write .',
  'format:check': 'prettier --check .',
  'spec:new': 'node .claude/harness/harness.mjs spec new',
  'spec:list': 'node .claude/harness/harness.mjs spec list',
  'spec:status': 'node .claude/harness/harness.mjs spec status',
  'spec:approve': 'node .claude/harness/harness.mjs spec approve',
  harness: 'node .claude/harness/harness.mjs',
  verify: 'pnpm lint && pnpm typecheck && pnpm test && pnpm -r --filter "./workers/*" --filter "./packages/*" --if-present typecheck && pnpm -r --filter "./workers/*" --filter "./packages/*" --if-present test && pnpm build',
  // The workers run as containers on the development VM (Docker context in DOCKER_CONTEXT),
  // against the development Supabase project. compose.dev.yaml belongs to the platform-engineer.
  'workers:dev': 'docker compose -f compose.dev.yaml up --build --remove-orphans',
  'workers:down': 'docker compose -f compose.dev.yaml down --remove-orphans',
  'workers:logs': 'docker compose -f compose.dev.yaml logs -f --tail=200',
  'workers:ps': 'docker compose -f compose.dev.yaml ps',
};

const WORKSPACE_PACKAGES = "packages:\n  - 'workers/*'\n  - 'packages/*'\n";

export function pinnedPnpm() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'harness', 'config.json'), 'utf8'));
    return cfg.stack?.pnpmVersion || '10.34.6';
  } catch {
    return '10.34.6';
  }
}

function patchPackage() {
  const file = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  pkg.scripts ??= {};
  const added = [];
  for (const [k, v] of Object.entries(SCRIPTS)) {
    if (!pkg.scripts[k]) {
      pkg.scripts[k] = v;
      added.push(k);
    }
  }
  pkg.engines ??= { node: '>=22' };
  // create-next-app names the package after its temporary folder; use the project folder.
  if (!pkg.name || pkg.name === 'app') {
    pkg.name = path.basename(root).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+/, '') || 'web-app';
  }
  // Pin pnpm (stack.pnpmVersion) before any pnpm command runs in the project: corepack, local
  // shims and pnpm/action-setup in CI all read packageManager, so everyone uses the tested version.
  if (!pkg.packageManager) pkg.packageManager = `pnpm@${pinnedPnpm()}`;
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  return added;
}

const VITEST = `import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

// Unit and component tests (colocated *.test.ts(x)). End-to-end tests live in tests/e2e (Playwright).
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'tests/e2e/**'],
  },
});
`;

const VITEST_SETUP = `import '@testing-library/jest-dom/vitest';
`;

const PLAYWRIGHT = `import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3000);

// End-to-end tests. Local: reuses a running \`pnpm dev\`. CI: builds and serves the app.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: \`http://localhost:\${PORT}\`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: process.env.CI ? 'pnpm start' : 'pnpm dev',
    url: \`http://localhost:\${PORT}\`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
`;

function writeIfMissing(rel, content) {
  const file = path.join(root, rel);
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}

function patchWorkspace() {
  const file = path.join(root, 'pnpm-workspace.yaml');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, WORKSPACE_PACKAGES);
    return 'pnpm-workspace.yaml';
  }
  const text = fs.readFileSync(file, 'utf8');
  if (/^packages:/m.test(text)) return null;
  fs.writeFileSync(file, `${WORKSPACE_PACKAGES}${text}`);
  return 'pnpm-workspace.yaml packages';
}

function patchConfigs() {
  const done = [];
  const ws = patchWorkspace();
  if (ws) done.push(ws);
  if (writeIfMissing('vitest.config.mts', VITEST)) done.push('vitest.config.mts');
  if (writeIfMissing('vitest.setup.ts', VITEST_SETUP)) done.push('vitest.setup.ts');
  if (writeIfMissing('playwright.config.ts', PLAYWRIGHT)) done.push('playwright.config.ts');

  const tsconfigPath = path.join(root, 'tsconfig.json');
  if (fs.existsSync(tsconfigPath)) {
    try {
      const ts = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
      ts.exclude ??= ['node_modules'];
      for (const x of ['supabase/functions', '.claude', 'workers', 'packages']) if (!ts.exclude.includes(x)) ts.exclude.push(x);
      fs.writeFileSync(tsconfigPath, `${JSON.stringify(ts, null, 2)}\n`);
      done.push('tsconfig.json exclude');
    } catch {
      console.warn('warning: tsconfig.json is not plain JSON; add "supabase/functions", ".claude", "workers" and "packages" to "exclude" manually.');
    }
  }
  const eslintPath = path.join(root, 'eslint.config.mjs');
  if (fs.existsSync(eslintPath)) {
    const text = fs.readFileSync(eslintPath, 'utf8');
    if (!text.includes('".claude/**"')) {
      const patched = text.replace(/globalIgnores\(\[/, 'globalIgnores([\n    ".claude/**",\n    "supabase/**",\n    "workers/**",\n    "packages/**",\n    "playwright-report/**",\n    "test-results/**",');
      if (patched !== text) {
        fs.writeFileSync(eslintPath, patched);
        done.push('eslint ignores');
      } else {
        console.warn('warning: could not patch eslint.config.mjs; ignore .claude/** and supabase/** manually.');
      }
    }
  }
  return done;
}

function envLocal() {
  const target = path.join(root, '.env.local');
  if (fs.existsSync(target)) return 'exists';
  const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  let devRef = '';
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'harness', 'config.json'), 'utf8'));
    devRef = cfg.stack?.supabase?.dev?.projectRef || '';
  } catch {
    devRef = '';
  }
  const out = example
    .split('\n')
    .map((line) => (devRef && /^NEXT_PUBLIC_SUPABASE_URL=\s*$/.test(line) ? `NEXT_PUBLIC_SUPABASE_URL=https://${devRef}.supabase.co` : line))
    .join('\n');
  fs.writeFileSync(target, out, { mode: 0o600 });
  return devRef ? 'created with the development project URL (add its publishable key)' : 'created from .env.example (fill the development project values)';
}

function foundationDates() {
  const file = path.join(root, 'specs', '000-foundation', 'spec.md');
  if (!fs.existsSync(file)) return;
  const today = new Date().toISOString().slice(0, 10);
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('status: draft')) return;
  fs.writeFileSync(file, text.replace(/2026-01-01/g, today));
}

switch (cmd) {
  case 'merge': {
    const [from, to = root] = args;
    const created = copyTree(path.resolve(from), path.resolve(to));
    console.log(`merged ${created.length} files from the Next.js scaffold`);
    break;
  }
  case 'package':
    console.log(`package.json scripts added: ${patchPackage().join(', ') || 'none (already present)'}`);
    break;
  case 'configs':
    console.log(`configs: ${patchConfigs().join(', ') || 'already present'}`);
    break;
  case 'env-local':
    console.log(`.env.local: ${envLocal()}`);
    break;
  case 'foundation-dates':
    foundationDates();
    break;
  default:
    console.error('usage: scaffold.mjs <merge|package|configs|env-local|foundation-dates>');
    process.exit(2);
}
