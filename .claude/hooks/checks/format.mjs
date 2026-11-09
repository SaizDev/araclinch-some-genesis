// PostToolUse: format the edited file with the project's Prettier (if installed).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'harness', 'lib');
const { EDIT_TOOLS, editTarget } = await import(pathToFileURL(path.join(LIB, 'edits.mjs')).href);
const { matchAny } = await import(pathToFileURL(path.join(LIB, 'glob.mjs')).href);

const FORMATTABLE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|json|css|scss|yml|yaml|html)$/;

export async function run(ctx) {
  if (!EDIT_TOOLS.has(ctx.tool) || ctx.tool === 'NotebookEdit') return null;
  const policy = ctx.policies.format ?? {};
  if (policy.enabled === false) return null;
  const rel = ctx.rel(editTarget(ctx.tool, ctx.toolInput));
  if (!rel || !FORMATTABLE.test(rel) || matchAny(rel, policy.exclude ?? [])) return null;
  const bin = path.join(ctx.root, 'node_modules', '.bin', process.platform === 'win32' ? 'prettier.cmd' : 'prettier');
  if (!fs.existsSync(bin)) return null;
  const res = spawnSync(bin, ['--write', '--log-level', 'warn', rel], { cwd: ctx.root, encoding: 'utf8', timeout: 20000 });
  if (res.status !== 0 && res.stderr) {
    return { context: `[harness] Prettier could not format ${rel}: ${res.stderr.split('\n').slice(0, 5).join(' ')}` };
  }
  return null;
}
