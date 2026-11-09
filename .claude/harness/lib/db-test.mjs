// Database tests on the development Supabase project, through the MCP, leaving nothing behind.
//
// `pnpm harness db test` turns the pgTAP files in supabase/tests/database (and, with --with <spec>,
// that spec's change script, to test it before it is applied) into ONE PL/pgSQL `DO` block:
//   - every statement runs through EXECUTE, which cannot COMMIT or ROLLBACK;
//   - each test file runs in its own subtransaction that is always undone after the file;
//   - the block ends by raising an exception whose message carries the TAP results, so Postgres
//     rolls back the whole transaction: test rows, the optional change script, pgTAP itself.
// The payload is stored under .claude/harness/state/db-tests/; the agent sends the reference
// "-- devharness:db-test <id>" to the "supabase" (development) MCP server and the mcp-guard hook
// swaps in the stored text.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HARNESS_DIR, readText, writeText } from './util.mjs';

export const RESULT_MARKER = 'DEVHARNESS_DB_TEST_RESULT';
export const REFERENCE_RE = /^\s*--\s*devharness:db-test\s+([a-f0-9]{16})\s*$/;
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const TESTS_DIR = 'supabase/tests/database';

// Things that could write outside the transaction or reach other systems from inside it.
const FORBIDDEN = [
  [/\bdblink(_exec|_connect|_send_query)?\s*\(/i, 'dblink opens a second connection that commits on its own'],
  [/\bpg_background/i, 'pg_background runs work outside the transaction'],
  [/\bcopy\b[^;]*\b(to|from)\s+program\b/i, 'COPY ... PROGRAM runs shell commands on the database server'],
  [/\blo_(export|import)\s*\(/i, 'large object file access'],
  [/\balter\s+system\b/i, 'ALTER SYSTEM changes server configuration'],
  [/\bnet\.http_(get|post|delete)\s*\(/i, 'pg_net requests reach external systems'],
  [/\bhttp_(get|post|put|patch|delete)\s*\(/i, 'http extension requests reach external systems'],
  [/\bpg_(terminate|cancel)_backend\s*\(/i, 'it would stop other sessions on the project'],
  [/\bpg_(reload_conf|rotate_logfile|read_file|read_binary_file|ls_dir|stat_file)\s*\(/i, 'server administration or file access'],
];

// Splits SQL into statements, aware of quotes, dollar quotes and comments.
export function splitStatements(sql) {
  const out = [];
  let cur = '';
  let i = 0;
  const n = sql.length;
  const push = () => {
    const s = cur.trim();
    if (s && s.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim()) out.push(s);
    cur = '';
  };
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      cur += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') {
          depth += 1;
          j += 2;
        } else if (sql[j] === '*' && sql[j + 1] === '/') {
          depth -= 1;
          j += 2;
        } else j += 1;
      }
      cur += sql.slice(i, j);
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      const escapes = c === "'" && /[eE]$/.test(cur) && !/[A-Za-z0-9_][eE]$/.test(cur);
      let j = i + 1;
      while (j < n) {
        if (escapes && sql[j] === '\\') {
          j += 2;
          continue;
        }
        if (sql[j] === c) {
          if (sql[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m && !/[A-Za-z0-9_]$/.test(cur)) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? n : end + tag.length;
        cur += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (c === ';') {
      push();
      i += 1;
      continue;
    }
    cur += c;
    i += 1;
  }
  push();
  return out;
}

const stripComments = (s) => s.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
const TX_CONTROL = /^(begin|start\s+transaction|commit|end|rollback|abort|savepoint|release|prepare\s+transaction)\b/i;
const RETURNS_ROWS = /^(select|with|values|table|show)\b/i;

// A random dollar-quote prefix that appears in none of the inputs, so no input can close a
// quoted string early. Every tag in the payload starts with it ($dh_xxxx$, $dh_xxxx_m$, ...).
function dollarTag(texts) {
  for (;;) {
    const base = `dh_${crypto.randomBytes(6).toString('hex')}`;
    if (!texts.some((t) => t.includes(base))) return base;
  }
}

function sqlLiteral(text) {
  return `'${String(text).replace(/'/g, "''")}'`;
}

export function forbiddenIn(text) {
  return FORBIDDEN.filter(([rx]) => rx.test(text)).map(([, why]) => why);
}

// Collects the inputs: the test files (optionally filtered) and, with `withSpec`, that spec's
// change script from supabase/changes, applied inside the run before the tests.
export function collectInputs(root, { filter = '', withSpec = null } = {}) {
  const migrations = [];
  if (withSpec) {
    const changesDir = path.join(root, 'supabase', 'changes');
    const id = String(withSpec).match(/\d+/)?.[0]?.padStart(3, '0');
    const file = fs.existsSync(changesDir) ? fs.readdirSync(changesDir).find((f) => f.startsWith(`${id}-`) && f.endsWith('.sql')) : null;
    if (!file) throw new Error(`no change script for spec ${withSpec} in supabase/changes`);
    migrations.push({ rel: `supabase/changes/${file}`, sql: readText(path.join(changesDir, file), '') });
  }
  const testDir = path.join(root, TESTS_DIR);
  const tests = fs.existsSync(testDir) ? fs.readdirSync(testDir).filter((f) => f.endsWith('.sql') && f.includes(filter)).sort() : [];
  return { migrations, tests: tests.map((f) => ({ rel: `${TESTS_DIR}/${f}`, sql: readText(path.join(testDir, f), '') })) };
}

export function buildPayload({ migrations = [], tests = [] }) {
  const problems = [];
  for (const f of [...migrations, ...tests]) {
    for (const why of forbiddenIn(f.sql)) problems.push(`${f.rel}: ${why}`);
  }
  if (problems.length) throw new Error(`refusing to build the test payload:\n${problems.join('\n')}`);
  if (!tests.length) throw new Error(`no test files in ${TESTS_DIR}`);
  const texts = [...migrations, ...tests].map((f) => f.sql);
  const base = dollarTag(texts);
  const q = `$${base}$`;
  const qm = `$${base}_m$`;
  const lines = [];
  lines.push(`DO ${q}`);
  lines.push('DECLARE');
  lines.push("  out text := '';");
  lines.push('  r record;');
  lines.push('  v text;');
  lines.push('  failed_files int := 0;');
  lines.push('BEGIN');
  lines.push("  PERFORM set_config('lock_timeout', '5s', true);");
  lines.push("  PERFORM set_config('statement_timeout', '120s', true);");
  lines.push("  EXECUTE 'create extension if not exists pgtap with schema extensions';");
  lines.push("  IF position('extensions' in current_setting('search_path')) = 0 THEN");
  lines.push("    PERFORM set_config('search_path', current_setting('search_path') || ', extensions', true);");
  lines.push('  END IF;');
  for (const m of migrations) {
    lines.push('  BEGIN');
    lines.push(`    EXECUTE ${qm}${m.sql}${qm};`);
    lines.push(`    out := out || ${sqlLiteral(`# change script applied (rolled back at the end): ${m.rel}`)} || E'\\n';`);
    lines.push('  EXCEPTION WHEN OTHERS THEN');
    lines.push(`    RAISE EXCEPTION '${RESULT_MARKER} change script failed: % : %', ${sqlLiteral(m.rel)}, SQLERRM;`);
    lines.push('  END;');
  }
  for (const t of tests) {
    const statements = splitStatements(t.sql)
      .map((s) => ({ raw: s, bare: stripComments(s) }))
      .filter((s) => s.bare && !TX_CONTROL.test(s.bare));
    lines.push(`  out := out || ${sqlLiteral(`# file: ${t.rel}`)} || E'\\n';`);
    lines.push('  BEGIN');
    statements.forEach((s, idx) => {
      const tag = `$${base}_s${idx}$`;
      if (RETURNS_ROWS.test(s.bare)) {
        lines.push(`    FOR r IN EXECUTE ${tag}${s.raw}${tag} LOOP`);
        lines.push("      SELECT string_agg(value, ' ') INTO v FROM jsonb_each_text(to_jsonb(r));");
        lines.push("      out := out || coalesce(v, '') || E'\\n';");
        lines.push('    END LOOP;');
      } else {
        lines.push(`    EXECUTE ${tag}${s.raw}${tag};`);
      }
    });
    lines.push("    RAISE EXCEPTION 'devharness_file_done';");
    lines.push('  EXCEPTION WHEN OTHERS THEN');
    lines.push("    IF SQLERRM <> 'devharness_file_done' THEN");
    lines.push('      failed_files := failed_files + 1;');
    lines.push(`      out := out || 'not ok - ERROR in ' || ${sqlLiteral(t.rel)} || ': ' || SQLERRM || E'\\n';`);
    lines.push('    END IF;');
    lines.push('  END;');
  }
  lines.push(`  RAISE EXCEPTION '${RESULT_MARKER} passed=% failed=% file_errors=% (everything rolled back)%',`);
  lines.push("    (SELECT count(*) FROM regexp_matches(out, '(^|\\n)ok \\d+', 'g')),");
  lines.push("    (SELECT count(*) FROM regexp_matches(out, '(^|\\n)not ok', 'g')),");
  lines.push("    failed_files, E'\\n' || out;");
  lines.push(`END ${q};`);
  return lines.join('\n');
}

export function storeDir(root) {
  return path.join(root, HARNESS_DIR, 'state', 'db-tests');
}

export function storePayload(root, payload) {
  const id = crypto.randomBytes(8).toString('hex');
  const file = path.join(storeDir(root), `${id}.sql`);
  writeText(file, payload);
  return { id, file, reference: `-- devharness:db-test ${id}` };
}

// Returns the stored payload for a reference query, or null with a reason.
export function resolveReference(root, query) {
  const m = REFERENCE_RE.exec(String(query ?? ''));
  if (!m) return { payload: null, reason: 'not a test payload reference' };
  const file = path.join(storeDir(root), `${m[1]}.sql`);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return { payload: null, reason: `no stored test run ${m[1]}; build one with pnpm harness db test` };
  }
  if (Date.now() - stat.mtimeMs > MAX_AGE_MS) return { payload: null, reason: `test payload ${m[1]} is older than 2 hours; build a new one` };
  return { payload: readText(file, null), id: m[1] };
}

// Reads the result line from an execute_sql error message.
export function parseResult(text) {
  const m = new RegExp(`${RESULT_MARKER} passed=(\\d+) failed=(\\d+) file_errors=(\\d+)`).exec(String(text ?? ''));
  if (!m) return null;
  return { passed: Number(m[1]), failed: Number(m[2]), fileErrors: Number(m[3]) };
}
