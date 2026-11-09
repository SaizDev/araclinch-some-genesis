// Guards the Supabase and Vercel MCP servers.
//
//   supabase          DEVELOPMENT project, read-write. Agents may read and write data freely (test
//                     data, seeds). Schema changes only arrive as change scripts: the query
//                     "-- devharness:apply <spec-id>" is swapped for supabase/changes/<id>-<slug>.sql
//                     wrapped in one transaction. Test runs ("-- devharness:db-test <id>") are swapped
//                     for the stored run, which always rolls back. Ad-hoc DDL is denied.
//   supabase-prod     PRODUCTION project, read-only (read_only=true). Read queries, advisors, docs.
//                     "-- devharness:schema-snapshot" is swapped for the schema snapshot query.
//   supabase-release  PRODUCTION project, read-write, ONLY "-- devharness:release <spec-id>" after the
//                     human typed "send to production" (chat-approval hook) for the current script.
// apply_migration is denied everywhere: the harness keeps no migration history in the database.
// PostToolUse: when a schema snapshot comes back from supabase-prod, it is saved to
// migrations/schema.sql without the agent having to copy hundreds of lines (no tokens spent).
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'harness', 'lib');
const { containsSqlDdl } = await import(pathToFileURL(path.join(LIB, 'shell.mjs')).href);
const { resolveReference } = await import(pathToFileURL(path.join(LIB, 'db-test.mjs')).href);
const ops = await import(pathToFileURL(path.join(LIB, 'db-ops.mjs')).href);

const DEV = 'supabase';
const PROD = 'supabase-prod';
const RELEASE = 'supabase-release';

function swap(ctx, payload, note) {
  const key = ctx.toolInput.sql !== undefined && ctx.toolInput.query === undefined ? 'sql' : 'query';
  return { decision: 'allow', updatedInput: { ...ctx.toolInput, [key]: payload }, context: note };
}

function queryOf(ctx) {
  return String(ctx.toolInput.query ?? ctx.toolInput.sql ?? '');
}

function devServer(ctx, name) {
  if (name !== 'execute_sql') return null;
  const query = queryOf(ctx);
  if (ops.REFERENCES.test.test(query)) {
    const { payload, reason } = resolveReference(ctx.root, query);
    if (!payload) return { decision: 'deny', reason };
    return swap(ctx, payload, '[harness] Database test run sent. It ends with an error whose message starts with DEVHARNESS_DB_TEST_RESULT: that is the planned ending that rolls everything back. Success means failed=0 and file_errors=0.');
  }
  const apply = ops.REFERENCES.apply.exec(query);
  if (apply) {
    const r = ops.applyPayload(ctx.root, apply[1]);
    if (!r.ok) return { decision: 'deny', reason: r.reason };
    return swap(ctx, r.payload, `[harness] Applying ${r.rel} to the development project as one transaction. If it fails, nothing was applied: fix the script and apply again. Regenerate src/types/database.types.ts with generate_typescript_types afterwards.`);
  }
  if (containsSqlDdl(query)) {
    return {
      decision: 'deny',
      reason:
        'Schema changes go into the spec change script supabase/changes/<id>-<slug>.sql (the same script is later released to production). ' +
        'Write it there, then run execute_sql with the query "-- devharness:apply <id>" on this server.',
    };
  }
  return null;
}

function prodServer(ctx, name) {
  if (name === 'apply_migration' || name === 'deploy_edge_function') {
    return { decision: 'deny', reason: 'Production is read-only for agents. Database changes reach production only through an approved release (the human types "send to production").' };
  }
  if (name !== 'execute_sql') return null;
  const query = queryOf(ctx);
  if (ops.REFERENCES.snapshot.test(query)) {
    const sql = ops.snapshotQuery(ctx.root);
    if (!sql) return { decision: 'deny', reason: '.claude/harness/sql/schema-snapshot.sql is missing.' };
    return swap(ctx, sql, `[harness] Reading the production schema. The harness saves the result to ${ops.SNAPSHOT_FILE} automatically; if it reports that it could not, write the text between the DEVHARNESS_SCHEMA markers to that file yourself.`);
  }
  if (containsSqlDdl(query) || /\b(insert|update|delete|merge|copy|truncate)\b/i.test(query)) {
    return { decision: 'deny', reason: 'Production is read-only for agents. Changes reach production only as an approved release of a change script.' };
  }
  return null;
}

function releaseServer(ctx, name) {
  if (name !== 'execute_sql') {
    return { decision: 'deny', reason: `The ${RELEASE} server only applies approved releases ("-- devharness:release <spec-id>").` };
  }
  const m = ops.REFERENCES.release.exec(queryOf(ctx));
  if (!m) {
    return { decision: 'deny', reason: `The ${RELEASE} server only accepts "-- devharness:release <spec-id>" after the human typed "send to production". Read queries go to ${PROD}.` };
  }
  const r = ops.releasePayload(ctx.root, m[1]);
  if (!r.ok) return { decision: 'deny', reason: `Release refused: ${r.reason}.` };
  ctx.log({ decision: 'release', spec: r.spec.id, script: r.rel });
  return swap(ctx, r.payload, `[harness] Releasing ${r.rel} to production as one transaction. If it succeeds: set the spec status to released and run /db-snapshot. If it fails, nothing changed in production.`);
}

function captureSnapshot(ctx) {
  if (ctx.tool !== `mcp__${PROD}__execute_sql`) return null;
  if (!ops.REFERENCES.snapshot.test(queryOf(ctx)) && !String(queryOf(ctx)).includes(ops.SNAPSHOT_BEGIN)) return null;
  const body = ops.extractSnapshot(ctx.input.tool_response);
  if (!body) {
    return { context: `[harness] The schema snapshot was not found in the response. If the query failed, report the error. Otherwise write the text between the markers to ${ops.SNAPSHOT_FILE} yourself.` };
  }
  const r = ops.saveSnapshot(ctx.root, body, { projectRef: ctx.h.config?.stack?.supabase?.prod?.projectRef });
  ctx.log({ decision: 'schema-snapshot', file: r.file, lines: r.lines });
  return {
    systemMessage: `[harness] Production schema saved to ${r.file} (${r.lines} lines).`,
    context: `[harness] Saved the production schema to ${r.file} (${r.lines} lines). Do not print or rewrite it. Commit it with the message "chore(db): production schema snapshot" if the human asks for commits, and tell the human in one line.`,
  };
}

export async function run(ctx) {
  const tool = ctx.tool ?? '';
  if (!tool.startsWith('mcp__')) return null;
  if (ctx.event === 'PostToolUse') return captureSnapshot(ctx);
  const [, server = '', name = ''] = tool.match(/^mcp__(.+?)__(.+)$/) ?? [];
  if (/supabase/i.test(server) && name === 'apply_migration') {
    return { decision: 'deny', reason: 'apply_migration is not used: schema changes are change scripts in supabase/changes, applied with "-- devharness:apply <id>" (development) and released with "-- devharness:release <id>" (production).' };
  }
  if (server === DEV) return devServer(ctx, name);
  if (server === PROD) return prodServer(ctx, name);
  if (server === RELEASE) return releaseServer(ctx, name);
  if (/supabase/i.test(server) && name === 'execute_sql' && containsSqlDdl(queryOf(ctx))) {
    return { decision: 'deny', reason: 'Schema changes go through change scripts in supabase/changes and the harness servers (supabase, supabase-release).' };
  }
  if (/vercel/i.test(server) && (name === 'deploy_to_vercel' || name.startsWith('buy_'))) {
    return { decision: 'deny', reason: 'Deployments go through git; purchases are human-only.' };
  }
  return null;
}
