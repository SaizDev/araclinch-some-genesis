// Append-only runtime state (gitignored). JSON Lines keep concurrent hook runs safe.
import path from 'node:path';
import { HARNESS_DIR, appendLine, nowIso, readText } from './util.mjs';

export function stateDir(root) {
  return path.join(root, HARNESS_DIR, 'state');
}

function safeName(s) {
  return String(s || 'unknown').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120);
}

export function sessionFile(root, sessionId) {
  return path.join(stateDir(root), 'sessions', `${safeName(sessionId)}.jsonl`);
}

export function recordEvent(root, sessionId, event) {
  appendLine(sessionFile(root, sessionId), JSON.stringify({ at: nowIso(), ...event }));
}

export function readEvents(root, sessionId) {
  const raw = readText(sessionFile(root, sessionId), '');
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // ignore partial lines
    }
  }
  return out;
}

export function logActivity(root, entry) {
  appendLine(path.join(stateDir(root), 'activity.jsonl'), JSON.stringify({ at: nowIso(), ...entry }));
}

// Aggregate session events into the facts the stop gate needs.
export function summarizeSession(events) {
  const edits = events.filter((e) => e.type === 'edit');
  const codeEdits = edits.filter((e) => e.code);
  const lastCodeEdit = codeEdits.length ? codeEdits[codeEdits.length - 1].at : null;
  const typechecks = events.filter((e) => e.type === 'typecheck-ok');
  const lastTypecheckOk = typechecks.length ? typechecks[typechecks.length - 1].at : null;
  const agentRuns = events.filter((e) => e.type === 'agent-stop');
  const agentsAfter = (ts) => new Set(agentRuns.filter((r) => !ts || r.at >= ts).map((r) => r.agent));
  const codePaths = [...new Set(codeEdits.map((e) => e.path))];
  const migrationEdits = edits.filter((e) => e.path?.startsWith('supabase/changes/'));
  return { edits, codeEdits, codePaths, lastCodeEdit, lastTypecheckOk, agentRuns, agentsAfter, migrationEdits };
}

export function stopBlocksFor(events, promptId) {
  return events.filter((e) => e.type === 'stop-block' && e.prompt === (promptId ?? null)).length;
}
