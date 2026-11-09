// Heuristic shell parsing for the Bash guard. It does not need to be a full shell
// parser: it splits compound commands, tokenizes with quote awareness and extracts
// the paths a command is likely to write.
import path from 'node:path';

const SEPARATORS = new Set(['&&', '||', ';', '|', '&', '\n', '|&']);
const WRAPPERS = new Set([
  'sudo', 'timeout', 'time', 'nice', 'nohup', 'stdbuf', 'command', 'builtin', 'noglob', 'env', 'exec', 'xargs',
  'npx', 'pnpx', 'bunx', 'dlx', 'pnpm', 'npm', 'yarn', 'bun', 'run',
]);

// Separates heredoc bodies from a command. Returns the command with every body removed
// (the operator stays as "<< DELIM") and the bodies in order of appearance, so body
// lines are never parsed as commands while the guards can still inspect them.
export function splitHeredocs(cmd) {
  const src = String(cmd ?? '');
  const bodies = [];
  const pending = [];
  let out = '';
  let quote = null;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === '\\' && quote === '"' && i + 1 < src.length) {
        out += src[i + 1];
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '\\' && i + 1 < src.length) {
      out += c + src[i + 1];
      i += 2;
      continue;
    }
    if (c === '<' && src[i + 1] === '<' && src[i + 2] !== '<' && src[i - 1] !== '<') {
      const m = /^<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|\\?([A-Za-z0-9_.@%+-]+))/.exec(src.slice(i));
      if (m) {
        const delim = m[2] ?? m[3] ?? m[4];
        pending.push({ delim, dash: m[1] === '-' });
        out += `<< ${delim}`;
        i += m[0].length;
        continue;
      }
    }
    if (c === '\n' && pending.length) {
      out += '\n';
      i += 1;
      while (pending.length) {
        const { delim, dash } = pending.shift();
        const body = [];
        while (i < src.length) {
          const nl = src.indexOf('\n', i);
          const end = nl === -1 ? src.length : nl;
          const line = src.slice(i, end);
          i = nl === -1 ? src.length : nl + 1;
          if ((dash ? line.replace(/^\t+/, '') : line) === delim) break;
          body.push(line);
        }
        bodies.push(body.join('\n'));
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return { command: out, bodies };
}

// Tokenize into words and operators. Keeps quoted strings as single tokens (quotes removed).
export function tokenize(cmd) {
  const tokens = [];
  let cur = '';
  let quote = null;
  let hadQuote = false;
  const push = () => {
    if (cur !== '' || hadQuote) tokens.push(cur);
    cur = '';
    hadQuote = false;
  };
  for (let i = 0; i < cmd.length; i += 1) {
    const c = cmd[i];
    if (quote) {
      if (c === quote) {
        quote = null;
      } else if (c === '\\' && quote === '"' && i + 1 < cmd.length) {
        cur += cmd[i + 1];
        i += 1;
      } else {
        cur += c;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      hadQuote = true;
      continue;
    }
    if (c === '\\' && i + 1 < cmd.length) {
      if (cmd[i + 1] === '\n') {
        i += 1;
        continue;
      }
      cur += cmd[i + 1];
      i += 1;
      continue;
    }
    if (c === ' ' || c === '\t') {
      push();
      continue;
    }
    if (c === '\n' || c === ';') {
      push();
      tokens.push(c === '\n' ? '\n' : ';');
      continue;
    }
    if (c === '&' || c === '|') {
      push();
      const two = cmd.slice(i, i + 2);
      if (two === '&&' || two === '||' || two === '|&') {
        tokens.push(two);
        i += 1;
      } else if (c === '&' && cmd[i + 1] === '>') {
        // &> redirection
        tokens.push(cmd[i + 2] === '>' ? '&>>' : '&>');
        i += cmd[i + 2] === '>' ? 2 : 1;
      } else {
        tokens.push(c);
      }
      continue;
    }
    if (c === '>' || c === '<') {
      // Attach fd digit (2>, 1>>) if cur is a lone digit.
      let op = c;
      if (/^\d$/.test(cur)) {
        op = cur + op;
        cur = '';
      } else {
        push();
      }
      if (cmd[i + 1] === c) {
        op += c;
        i += 1;
        if (c === '<' && cmd[i + 1] === '<') {
          op += '<';
          i += 1;
        }
      } else if (c === '>' && cmd[i + 1] === '|') {
        op += '|';
        i += 1;
      } else if (cmd[i + 1] === '&') {
        op += '&';
        i += 1;
      }
      tokens.push(op);
      continue;
    }
    cur += c;
  }
  push();
  return tokens;
}

export function segments(cmd) {
  const toks = tokenize(splitHeredocs(cmd).command);
  const segs = [];
  let cur = [];
  for (const t of toks) {
    if (SEPARATORS.has(t)) {
      if (cur.length) segs.push(cur);
      cur = [];
    } else {
      cur.push(t);
    }
  }
  if (cur.length) segs.push(cur);
  return segs;
}

const isAssignment = (t) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(t);
const isRedirect = (t) => /^(\d?>>?|&>>?|\d?>\||\d?>&|<{1,3}|\d?<&?)$/.test(t);

// Returns the words of a segment with env assignments, wrappers and redirections removed.
export function commandWords(seg) {
  const words = [];
  let i = 0;
  while (i < seg.length && isAssignment(seg[i])) i += 1;
  for (; i < seg.length; i += 1) {
    const t = seg[i];
    if (isRedirect(t)) {
      i += 1; // skip the target: a file, a file descriptor or a heredoc delimiter
      continue;
    }
    words.push(t);
  }
  return words;
}

const isWrapperish = (word) =>
  WRAPPERS.has(path.posix.basename(word)) || word.startsWith('-') || /^\d+(\.\d+)?[smhd]?$/.test(word);

// Locate a program at a command position, looking through wrappers such as
// "pnpm exec", "npx -y", "timeout 30" or "./node_modules/.bin/".
export function findProgram(words, names) {
  const wanted = new Set([].concat(names));
  for (let i = 0; i < words.length; i += 1) {
    const base = path.posix.basename(words[i]);
    if (wanted.has(base)) return { index: i, name: base, args: words.slice(i + 1) };
    if (!isWrapperish(words[i])) return null;
  }
  return null;
}

// The first word that is not a wrapper, with its arguments.
export function programOf(words) {
  let i = 0;
  while (i < words.length - 1 && isWrapperish(words[i])) i += 1;
  return { name: path.posix.basename(words[i] ?? ''), args: words.slice(i + 1) };
}

export function positional(args) {
  return args.filter((a) => !a.startsWith('-'));
}

export function hasFlag(args, ...flags) {
  return args.some((a) => flags.some((f) => a === f || a.startsWith(`${f}=`)));
}

// Extract likely write targets from a full command string.
export function writeTargets(cmd) {
  const targets = [];
  for (const seg of segments(cmd)) {
    // Redirections anywhere in the segment.
    for (let i = 0; i < seg.length; i += 1) {
      if (/^(\d?>>?|&>>?|\d?>\|)$/.test(seg[i]) && seg[i + 1]) targets.push(seg[i + 1]);
    }
    const words = commandWords(seg);
    if (!words.length) continue;
    const { name, args } = programOf(words);
    const pos = positional(args);
    switch (name) {
      case 'cp':
      case 'mv':
      case 'install':
      case 'rsync':
      case 'ln':
        if (pos.length >= 2) targets.push(pos[pos.length - 1]);
        if (name === 'mv') targets.push(...pos.slice(0, -1)); // moving a file removes it from its zone
        break;
      case 'rm':
      case 'rmdir':
      case 'unlink':
      case 'touch':
      case 'truncate':
      case 'shred':
      case 'rimraf':
        targets.push(...pos);
        break;
      case 'tee':
        targets.push(...pos);
        break;
      case 'chmod':
      case 'chown':
        targets.push(...pos.slice(1));
        break;
      case 'dd': {
        const of = args.find((a) => a.startsWith('of='));
        if (of) targets.push(of.slice(3));
        break;
      }
      case 'sed':
      case 'perl':
      case 'gsed': {
        if (args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'))) {
          const exprGiven = args.some((a) => a === '-e' || a === '--expression');
          const files = exprGiven ? pos.filter((p, idx) => args[args.indexOf(p) - 1] !== '-e') : pos.slice(1);
          targets.push(...files);
        }
        break;
      }
      default:
        break;
    }
  }
  return targets.filter((t) => t && !/^\/dev\//.test(t) && t !== '-');
}

// Inline interpreter writes such as node -e "fs.writeFileSync('src/x.ts', ...)" or a
// heredoc fed to python3. Returns the quoted paths found in scripts that write files.
const WRITE_FN = /(writeFile|appendFile|createWriteStream|rmSync|unlinkSync|renameSync|copyFile|cpSync|open\([^)]*['"][wa+]|write_text|write_bytes|shutil\.(move|copy|rmtree)|os\.(remove|rename|unlink)|File\.write)/;
const PATH_LITERAL = /['"`]((?:\.{0,2}\/)?[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.[\]-]+)+)['"`]/g;
const INTERPRETER = /\b(node|python3?|ruby|perl|deno|bun|tsx|ts-node)\b/;

// Script texts executed by interpreters: the command itself when it uses an inline
// flag (-e, -c, --eval, -p) and heredoc bodies fed to an interpreter.
export function interpreterScripts(cmd) {
  const { command, bodies } = splitHeredocs(cmd);
  const sources = [];
  if (/\b(node|python3?|ruby|perl|deno|bun)\b[^|;&]*\s(-e|-c|--eval|-p)\s/.test(command)) sources.push(command);
  if (bodies.length && new RegExp(`${INTERPRETER.source}[^|;&\\n]*<<`).test(command)) sources.push(...bodies);
  return sources;
}

export function inlineScriptPaths(cmd) {
  const out = [];
  for (const text of interpreterScripts(cmd)) {
    if (!WRITE_FN.test(text)) continue;
    for (const m of text.matchAll(PATH_LITERAL)) out.push(m[1]);
  }
  return out;
}

// Shell code nested in a command: bash -c "...", sh -c '...', eval "..." and heredocs
// fed to a shell (bash <<EOF). The guards evaluate these strings like top-level commands.
export function nestedShellCommands(cmd) {
  const { bodies } = splitHeredocs(cmd);
  const nested = [];
  let heredocToShell = false;
  for (const seg of segments(cmd)) {
    const words = commandWords(seg);
    const { name, args } = programOf(words);
    if (['bash', 'sh', 'zsh', 'dash', 'ksh'].includes(name)) {
      const idx = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
      if (idx !== -1 && args[idx + 1] !== undefined) nested.push(args[idx + 1]);
      if (seg.includes('<<')) heredocToShell = true;
    }
    if (name === 'eval' && args.length) nested.push(args.join(' '));
  }
  if (heredocToShell) nested.push(...bodies);
  return nested;
}

// DDL detection for ad-hoc SQL. Comments and single-quoted literals are ignored, but
// dollar-quoted bodies are kept on purpose so DDL inside DO blocks is still detected.
export function containsSqlDdl(text) {
  const sql = stripSqlStrings(text);
  return (
    /\b(create|alter|drop|grant|revoke|truncate|comment\s+on|reindex|cluster|rename\s+to|security\s+label|import\s+foreign\s+schema)\b/i.test(sql) ||
    /(^|;)\s*do\b/i.test(sql)
  );
}

export function stripSqlStrings(text) {
  return String(text ?? '')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''");
}
