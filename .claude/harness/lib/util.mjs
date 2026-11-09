// Shared helpers for the harness CLI and the hook dispatcher.
// Zero dependencies: only Node.js built-ins (Node 20+).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const HARNESS_DIR = '.claude/harness';

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

export function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function readText(p, fallback = null) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return fallback;
  }
}

export function readJson(p, fallback = null) {
  const raw = readText(p, null);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${p}: ${err.message}`);
  }
}

export function writeText(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, p);
}

export function writeJson(p, data) {
  writeText(p, `${JSON.stringify(data, null, 2)}\n`);
}

export function appendLine(p, line) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, `${line}\n`, 'utf8');
  } catch {
    // Logging must never break a hook.
  }
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function nowIso() {
  return new Date().toISOString();
}

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Deep merge where arrays and scalars from `b` replace those in `a`.
export function deepMerge(a, b) {
  if (!isPlainObject(a)) return structuredClone(b);
  if (!isPlainObject(b)) return b === undefined ? structuredClone(a) : b;
  const out = structuredClone(a);
  for (const [k, v] of Object.entries(b)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : structuredClone(v);
  }
  return out;
}

// Walk up from `start` until a directory containing .claude/harness/config.json is found.
export function findProjectRoot(start) {
  const envRoot = process.env.CLAUDE_PROJECT_DIR;
  if (envRoot && exists(path.join(envRoot, HARNESS_DIR, 'config.json'))) return path.resolve(envRoot);
  let dir = path.resolve(start || process.cwd());
  for (;;) {
    if (exists(path.join(dir, HARNESS_DIR, 'config.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Returns a normalized project-relative POSIX path, or null when outside the root.
export function relToRoot(root, filePath) {
  if (!filePath) return null;
  const abs = path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(root, filePath);
  let real = abs;
  try {
    // Resolve symlinks for existing parents to avoid escaping through links.
    const parent = fs.realpathSync(path.dirname(abs));
    real = path.join(parent, path.basename(abs));
  } catch {
    // Parent may not exist yet (new file). Keep the normalized path.
  }
  let rootReal = root;
  try {
    rootReal = fs.realpathSync(root);
  } catch {
    // keep root
  }
  for (const [base, target] of [
    [rootReal, real],
    [root, abs],
  ]) {
    const rel = path.relative(base, target);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return toPosix(rel);
    if (rel === '') return '';
  }
  return null;
}

export function listDirs(p) {
  try {
    return fs
      .readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

export function listFiles(p) {
  try {
    return fs
      .readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

export function moveInto(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(src, dest);
}

export function truncate(text, max = 1500) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}\n[truncated ${text.length - max} chars]` : text;
}

export function unique(arr) {
  return [...new Set(arr)];
}
