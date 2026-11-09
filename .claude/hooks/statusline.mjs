#!/usr/bin/env node
// Status line: harness profile, active spec and gate, branch, database artifact sync.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(HERE, '..', 'harness', 'lib');
const lib = (n) => import(pathToFileURL(path.join(LIB, n)).href);

async function main() {
  let input = {};
  try {
    const raw = fs.readFileSync(0, 'utf8');
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }
  const { findProjectRoot } = await lib('util.mjs');
  const root = findProjectRoot(input.workspace?.project_dir || input.workspace?.current_dir || input.cwd || process.cwd());
  if (!root) return;
  const { loadHarness } = await lib('config.mjs');
  const spec = await lib('spec.mjs');
  const { dbStatus } = await lib('db-ops.mjs');
  const h = loadHarness(root);
  const parts = [`harness:${h.profileName}`];
  const active = spec.resolveActiveSpec(root);
  if (active.spec) {
    const gate = spec.evaluateGate(active.spec, h.policies.specGate ?? {});
    parts.push(`spec ${active.spec.id} ${active.spec.status}${gate.ok ? '' : ' (gate closed)'}`);
  } else {
    parts.push('no active spec');
  }
  if (active.branch) parts.push(active.branch);
  const pending = dbStatus(root).pending.length;
  if (pending) parts.push(`db ${pending} to release`);
  const model = input.model?.display_name;
  if (model) parts.push(model);
  process.stdout.write(parts.join(' | '));
}

main().catch(() => {});
