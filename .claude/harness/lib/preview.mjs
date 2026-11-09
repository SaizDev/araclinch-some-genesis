// Step 5 of the workflow: the human tests on their machine with \`pnpm dev\` against the DEVELOPMENT
// Supabase project. This check reads .env.local only to compare the project ref of
// NEXT_PUBLIC_SUPABASE_URL with the configured refs; it never prints keys or values.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readText } from './util.mjs';

function envValue(text, key) {
  const m = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*["']?([^"'\\n#]*)`, 'm').exec(text ?? '');
  return m ? m[1].trim() : '';
}

export function previewCheck(root, h) {
  const sb = h.config.stack?.supabase ?? {};
  const devRef = sb.dev?.projectRef || '';
  const prodRef = sb.prod?.projectRef || '';
  const env = readText(path.join(root, '.env.local'), null);
  const lines = [];
  if (env === null) {
    return {
      ok: false,
      lines: [
        '.env.local is missing. Ask the human to create it from .env.example with the DEVELOPMENT project values',
        `(${devRef ? `https://${devRef}.supabase.co` : 'development project URL'} and its publishable key). Never put production keys there.`,
      ],
    };
  }
  const url = envValue(env, 'NEXT_PUBLIC_SUPABASE_URL');
  const key = envValue(env, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') || envValue(env, 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const ref = (url.match(/^https?:\/\/([a-z0-9]{20})\.supabase\.co/) ?? [])[1] ?? '';
  let ok = true;
  if (!url || !key) {
    ok = false;
    lines.push('.env.local lacks NEXT_PUBLIC_SUPABASE_URL or the publishable key. Ask the human to fill them with the development project values.');
  } else if (prodRef && ref === prodRef) {
    ok = false;
    lines.push('STOP: .env.local points to the PRODUCTION Supabase project. Ask the human to switch it to the development project before testing.');
  } else if (devRef && ref && ref !== devRef) {
    ok = false;
    lines.push(`.env.local points to project ${ref}, not to the configured development project ${devRef}. Ask the human which one is right (pnpm harness supabase dev <ref>).`);
  } else if (!devRef) {
    lines.push('Warning: the development project ref is not configured (pnpm harness supabase dev <ref>); cannot confirm .env.local targets development.');
  }
  // Workers (pg-boss) connect with DATABASE_URL: it must point to development too. Only the project
  // ref is compared; the URL itself is never printed.
  const dbUrl = envValue(env, 'DATABASE_URL');
  if (dbUrl) {
    const dbRef = (dbUrl.match(/(?:db\.|postgres\.)([a-z0-9]{20})/) ?? [])[1] ?? '';
    if (prodRef && dbRef === prodRef) {
      ok = false;
      lines.push('STOP: DATABASE_URL in .env.local points to the PRODUCTION database. The workers would run against production. Ask the human to use the development connection string.');
    } else if (devRef && dbRef && dbRef !== devRef) {
      ok = false;
      lines.push(`DATABASE_URL points to project ${dbRef}, not to the development project ${devRef}. Ask the human which one is right.`);
    }
  } else {
    lines.push('Note: DATABASE_URL is not set in .env.local, so pnpm workers:dev cannot reach the queue. Ask the human to add the development connection string if the test needs workers.');
  }
  // Workers run on the development VM through a Docker context. Only the local context entry is
  // checked (no connection to the VM, so no SSH prompt); a missing one is a note, not a stop.
  const dockerContext = h.config.stack?.docker?.context;
  if (dockerContext) {
    const res = spawnSync('docker', ['context', 'inspect', dockerContext], { encoding: 'utf8', timeout: 5000 });
    if (res.error?.code === 'ENOENT') {
      lines.push('Note: the Docker CLI is not installed on this machine, so pnpm workers:dev cannot reach the development VM (GETTING-STARTED.md, section 3.4).');
    } else if (res.status !== 0) {
      lines.push(`Note: the Docker context "${dockerContext}" does not exist on this machine, so pnpm workers:dev cannot reach the development VM. The human creates it (GETTING-STARTED.md, section 3.4).`);
    }
  }
  if (ok) {
    lines.push(`OK: .env.local points to the development project${ref ? ` (${ref})` : ''}.`);
    lines.push('Start the app in the background: pnpm dev (and pnpm workers:dev when the spec touches workers), wait for "Ready", then give the human http://localhost:3000');
    lines.push('and the steps to check each acceptance criterion. Leave it running while they test; stop it when they are done.');
  }
  return { ok, lines };
}
