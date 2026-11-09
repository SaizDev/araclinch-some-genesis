// Tiny YAML-frontmatter reader/writer for the formats used by this harness.
// Supported values: scalars (quoted or bare), inline arrays [a, b], block lists (- item).
// Writing only replaces or appends top-level keys, preserving everything else verbatim.

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseScalar(raw) {
  let v = raw.trim();
  if (!v.startsWith('"') && !v.startsWith("'")) v = v.replace(/\s+#.*$/, '').trim();
  if (v === '' || v === '~' || v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v) && !/^0\d/.test(v)) return Number(v);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => parseScalar(s));
  }
  return v;
}

export function parseFrontmatter(text) {
  const src = text ?? '';
  const m = src.match(FM_RE);
  if (!m) return { data: {}, body: src, hasFrontmatter: false, raw: '' };
  const data = {};
  const lines = m[1].split(/\r?\n/);
  let currentListKey = null;
  for (const line of lines) {
    if (/^\s*#/.test(line) || line.trim() === '') continue;
    const listItem = line.match(/^\s+-\s+(.*)$/);
    if (listItem && currentListKey) {
      data[currentListKey].push(parseScalar(listItem[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      const [, key, value] = kv;
      if (value.trim() === '') {
        data[key] = [];
        currentListKey = key;
      } else {
        data[key] = parseScalar(value);
        currentListKey = null;
      }
    }
  }
  // Empty block keys that never received items become null.
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v) && v.length === 0 && !m[1].includes(`${k}: []`)) data[k] = null;
  }
  return { data, body: src.slice(m[0].length), hasFrontmatter: true, raw: m[1] };
}

function formatValue(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return `[${value.join(', ')}]`;
  const s = String(value);
  return /[:#\[\]{}]|^\s|\s$/.test(s) ? JSON.stringify(s) : s;
}

// Replace or append top-level keys inside the frontmatter block.
export function setFrontmatterFields(text, fields) {
  const m = text.match(FM_RE);
  if (!m) {
    const block = Object.entries(fields)
      .map(([k, v]) => `${k}: ${formatValue(v)}`.trimEnd())
      .join('\n');
    return `---\n${block}\n---\n\n${text}`;
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = m[1].split(/\r?\n/);
  for (const [key, value] of Object.entries(fields)) {
    const idx = lines.findIndex((l) => l.startsWith(`${key}:`));
    const rendered = `${key}: ${formatValue(value)}`.trimEnd();
    if (idx >= 0) {
      // Drop block-list continuation lines of the old value.
      let end = idx + 1;
      while (end < lines.length && /^\s+-\s+/.test(lines[end])) end += 1;
      lines.splice(idx, end - idx, rendered);
    } else {
      lines.push(rendered);
    }
  }
  const newBlock = `---${eol}${lines.join(eol)}${eol}---${eol}`;
  return newBlock + text.slice(m[0].length);
}

// Remove top-level keys (and their block-list lines) from the frontmatter.
export function removeFrontmatterFields(text, keys) {
  const m = text.match(FM_RE);
  if (!m) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = m[1].split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const key = lines[i].match(/^([A-Za-z0-9_-]+):/)?.[1];
    if (key && keys.includes(key)) {
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) i += 1;
      continue;
    }
    out.push(lines[i]);
  }
  return `---${eol}${out.join(eol)}${eol}---${eol}${text.slice(m[0].length)}`;
}

export function stripFrontmatter(text) {
  return (text ?? '').replace(FM_RE, '');
}
