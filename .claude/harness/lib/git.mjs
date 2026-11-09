// Git helpers that avoid spawning git on hot paths (hooks run on every tool call).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readText } from './util.mjs';

function gitDir(root) {
  const dotGit = path.join(root, '.git');
  try {
    const st = fs.statSync(dotGit);
    if (st.isDirectory()) return dotGit;
    const content = readText(dotGit, '');
    const m = content.match(/^gitdir:\s*(.+)\s*$/m);
    if (m) return path.resolve(root, m[1]);
  } catch {
    // not a git repository
  }
  return null;
}

export function currentBranch(root) {
  const dir = gitDir(root);
  if (!dir) return null;
  const head = readText(path.join(dir, 'HEAD'), '');
  const m = head.match(/^ref:\s*refs\/heads\/(.+)\s*$/m);
  return m ? m[1].trim() : null;
}

export function isTrackedInHead(root, relPath) {
  if (!gitDir(root)) return false;
  const res = spawnSync('git', ['-C', root, 'cat-file', '-e', `HEAD:${relPath}`], {
    stdio: 'ignore',
    timeout: 5000,
  });
  return res.status === 0;
}

export function gitUserName(root) {
  const res = spawnSync('git', ['-C', root, 'config', 'user.name'], { encoding: 'utf8', timeout: 5000 });
  return res.status === 0 ? res.stdout.trim() : null;
}
