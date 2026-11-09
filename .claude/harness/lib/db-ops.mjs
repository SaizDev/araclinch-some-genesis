// Database operations without migrations history or a local database.
//
// Development project (MCP server "supabase", read-write):
//   every spec that changes the schema has ONE change script, supabase/changes/<id>-<slug>.sql.
//   It is applied to development with `-- devharness:apply <id>`; the mcp-guard hook swaps in the
//   script wrapped in one DO block, so it applies completely or not at all.
// Production project (MCP "supabase-prod" read-only, "supabase-release" read-write):
//   after the human types "send to production" (recorded by the chat-approval hook with the hash
//   of the script), `-- devharness:release <id>` on supabase-release applies the same script.
//   Nothing else can write to production.
// Snapshot: `-- devharness:schema-snapshot` on supabase-prod runs a read-only catalog query that
//   returns the SQL to recreate the schema; a PostToolUse hook saves it as migrations/schema.sql.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HARNESS_DIR, readText, writeText, readJson, writeJson, listFiles } from './util.mjs';
import { findSpec } from './spec.mjs';

export const CHANGES_DIR = 'supabase/changes';
export const SNAPSHOT_FILE = 'migrations/schema.sql';
export const SNAPSHOT_BEGIN = '-- DEVHARNESS_SCHEMA_BEGIN';
export const SNAPSHOT_END = '-- DEVHARNESS_SCHEMA_END';
const APPROVAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const REFERENCES = {
  test: /^\s*--\s*devharness:db-test\s+([a-f0-9]{16})\s*$/,
  apply: /^\s*--\s*devharness:apply\s+(\d{1,4})\s*$/,
  release: /^\s*--\s*devharness:release\s+(\d{1,4})\s*$/,
  snapshot: /^\s*--\s*devharness:schema-snapshot\s*$/,
};

export function sha(text) {
  return crypto.createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex').slice(0, 16);
}

export function changeScript(root, idOrDir) {
  const spec = findSpec(root, idOrDir);
  if (!spec) return { spec: null, rel: null, sql: null };
  const rel = `${CHANGES_DIR}/${spec.id}-${spec.slug}.sql`;
  const sql = readText(path.join(root, rel), null);
  return { spec, rel, sql };
}

export function listChangeScripts(root) {
  return listFiles(path.join(root, CHANGES_DIR))
    .filter((f) => /^\d{3,4}-[a-z0-9-]+\.sql$/.test(f))
    .map((f) => ({ file: `${CHANGES_DIR}/${f}`, id: f.slice(0, f.indexOf('-')) }));
}

// One DO block: every statement of the script runs through EXECUTE, so the whole script commits
// or nothing does. EXECUTE cannot run COMMIT or ROLLBACK, so the script cannot split itself.
export function atomicPayload(sql, { label, lockTimeout = '10s' } = {}) {
  let base;
  do base = `dh_${crypto.randomBytes(6).toString('hex')}`;
  while (sql.includes(base));
  return [
    `-- devharness: ${label ?? 'change script'} (applied as one unit)`,
    `DO $${base}$`,
    'BEGIN',
    `  PERFORM set_config('lock_timeout', '${lockTimeout}', true);`,
    `  EXECUTE $${base}_s$${sql}$${base}_s$;`,
    `END $${base}$;`,
  ].join('\n');
}

// Change scripts must be able to run inside a transaction.
export function scriptProblems(sql) {
  const problems = [];
  if (/\bconcurrently\b/i.test(sql)) problems.push('CONCURRENTLY cannot run inside a transaction; create the index without it (or in its own small script)');
  if (/^\s*(begin|commit|rollback|start\s+transaction)\s*;/im.test(sql)) problems.push('remove BEGIN/COMMIT/ROLLBACK: the harness wraps the script in one transaction');
  if (/\bvacuum\b/i.test(sql)) problems.push('VACUUM cannot run inside a transaction');
  return problems;
}

// ---------- release approvals (written only by the chat-approval hook) ----------

const releasesDir = (root) => path.join(root, HARNESS_DIR, 'state', 'releases');

// Written when the human types "send to production". hash is null when the spec has no change script.
export function recordReleaseApproval(root, specId, { by, hash, branch = null }) {
  const file = path.join(releasesDir(root), `${specId}.json`);
  writeJson(file, { spec: specId, hash, branch, by, approvedAt: new Date().toISOString(), via: 'chat' });
  return file;
}

// Production approvals typed in the last 24 hours (the bash guard lets the merge to main through).
export function validProductionApprovals(root) {
  let files = [];
  try {
    files = fs.readdirSync(releasesDir(root)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files
    .map((f) => releaseApproval(root, f.replace(/\.json$/, '')))
    .filter((a) => a && Date.now() - Date.parse(a.approvedAt) <= APPROVAL_MAX_AGE_MS);
}

export function releaseApproval(root, specId) {
  try {
    return readJson(path.join(releasesDir(root), `${specId}.json`), null);
  } catch {
    return null;
  }
}

// Returns { ok, reason, payload } for a release of the spec's current change script.
export function releasePayload(root, idOrDir) {
  const { spec, rel, sql } = changeScript(root, idOrDir);
  if (!spec) return { ok: false, reason: `spec ${idOrDir} does not exist` };
  if (sql === null) return { ok: false, reason: `${CHANGES_DIR}/${spec.id}-${spec.slug}.sql does not exist: this spec has no database change to release` };
  const approval = releaseApproval(root, spec.id);
  if (!approval) return { ok: false, reason: `the human has not approved production for spec ${spec.id}. They type "send to production" in the chat when their test passes` };
  if (Date.now() - Date.parse(approval.approvedAt) > APPROVAL_MAX_AGE_MS) {
    return { ok: false, reason: `the release approval for spec ${spec.id} is older than 24 hours. The human types "send to production" again` };
  }
  if (approval.hash !== sha(sql)) {
    return { ok: false, reason: `${rel} changed after the human approved the release. The human tests again and types "send to production"` };
  }
  return { ok: true, spec, rel, payload: atomicPayload(sql, { label: `release of ${rel} to production`, lockTimeout: '5s' }) };
}

export function applyPayload(root, idOrDir) {
  const { spec, rel, sql } = changeScript(root, idOrDir);
  if (!spec) return { ok: false, reason: `spec ${idOrDir} does not exist` };
  if (sql === null) return { ok: false, reason: `${CHANGES_DIR}/${spec.id}-${spec.slug}.sql does not exist yet` };
  const problems = scriptProblems(sql);
  if (problems.length) return { ok: false, reason: `${rel}: ${problems.join('; ')}` };
  return { ok: true, spec, rel, payload: atomicPayload(sql, { label: `${rel} on the development project` }) };
}

// ---------- production schema snapshot ----------

export function snapshotQuery(root) {
  return readText(path.join(root, HARNESS_DIR, 'sql', 'schema-snapshot.sql'), null);
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

// Finds the snapshot in an MCP tool response, whatever its wrapping (JSON rows inside text).
export function extractSnapshot(response) {
  for (const s of collectStrings(response)) {
    const start = s.indexOf(SNAPSHOT_BEGIN);
    const end = s.indexOf(SNAPSHOT_END);
    if (start === -1 || end <= start) continue;
    let body = s.slice(start + SNAPSHOT_BEGIN.length, end);
    for (let i = 0; i < 3 && !body.includes('\n') && body.includes('\\n'); i += 1) {
      try {
        body = JSON.parse(`"${body.replace(/(?<!\\)"/g, '\\"')}"`);
      } catch {
        break;
      }
    }
    body = body.replace(/^\s+/, '').replace(/\s+$/, '');
    if (body.includes('create') || body.includes('CREATE')) return body;
  }
  return null;
}

export function saveSnapshot(root, body, { projectRef } = {}) {
  const header = [
    `-- Production schema of this project${projectRef ? ` (Supabase project ${projectRef})` : ''}, taken ${new Date().toISOString().slice(0, 10)}.`,
    '-- Recreates the whole application schema on an empty Supabase project. Schema only, no data.',
    '-- Written by the harness after a release (/db-snapshot). Do not edit by hand; git keeps earlier versions.',
    '',
  ].join('\n');
  const file = path.join(root, SNAPSHOT_FILE);
  writeText(file, `${header}${body}\n`);
  return { file: SNAPSHOT_FILE, lines: body.split('\n').length };
}

export function snapshotInfo(root) {
  const file = path.join(root, SNAPSHOT_FILE);
  try {
    const st = fs.statSync(file);
    return { exists: true, modified: st.mtime.toISOString().slice(0, 10) };
  } catch {
    return { exists: false };
  }
}

export function dbStatus(root) {
  const scripts = listChangeScripts(root).map((c) => {
    const spec = findSpec(root, c.id);
    return { ...c, status: spec?.status ?? 'unknown', approval: releaseApproval(root, c.id) ? 'release approved' : null };
  });
  return { changeScripts: scripts, pending: scripts.filter((s) => s.status !== 'released'), snapshot: snapshotInfo(root) };
}
