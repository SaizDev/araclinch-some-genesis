// Minimal glob matcher for project-relative POSIX paths.
// Supports: ** (any depth), * (within a segment), ? (one char), {a,b} alternation,
// and [abc] / [!abc] character classes. Patterns are anchored to the project root.
const cache = new Map();

const REGEX_SPECIAL = new Set(['\\', '^', '$', '+', '.', '(', ')', '|', '/']);

export function globToRegExp(glob) {
  const cached = cache.get(glob);
  if (cached) return cached;
  let re = '';
  let groupDepth = 0;
  const n = glob.length;
  let i = 0;
  while (i < n) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const atSegmentStart = i === 0 || glob[i - 1] === '/';
        const followedBySlash = glob[i + 2] === '/';
        if (atSegmentStart && followedBySlash) {
          re += '(?:[^/]+/)*';
          i += 3;
          continue;
        }
        re += '.*';
        i += 2;
        continue;
      }
      re += '[^/]*';
      i += 1;
      continue;
    }
    if (c === '?') {
      re += '[^/]';
      i += 1;
      continue;
    }
    if (c === '{') {
      groupDepth += 1;
      re += '(?:';
      i += 1;
      continue;
    }
    if (c === '}' && groupDepth > 0) {
      groupDepth -= 1;
      re += ')';
      i += 1;
      continue;
    }
    if (c === ',' && groupDepth > 0) {
      re += '|';
      i += 1;
      continue;
    }
    if (c === '[') {
      const close = glob.indexOf(']', i + 1);
      if (close > i + 1) {
        let body = glob.slice(i + 1, close);
        if (body.startsWith('!')) body = `^${body.slice(1)}`;
        re += `[${body.replace(/\\/g, '\\\\')}]`;
        i = close + 1;
        continue;
      }
    }
    re += REGEX_SPECIAL.has(c) ? `\\${c}` : c;
    i += 1;
  }
  const rx = new RegExp(`^${re}$`);
  cache.set(glob, rx);
  return rx;
}

export function matchGlob(relPath, glob) {
  return globToRegExp(glob).test(relPath);
}

export function matchAny(relPath, globs = []) {
  return globs.some((g) => matchGlob(relPath, g));
}
