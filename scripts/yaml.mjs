import fs from 'node:fs';
/**
 * A deliberately small YAML reader.
 *
 * WHY NOT A DEPENDENCY
 *
 * The Charter requires that division and agent definitions be inspectable configuration
 * (Article 120) and that the kernel run without a graphical deck (Article 70). A parser
 * dependency would make `forge doctor` unrunnable on a machine that has not run
 * `npm install`, which is exactly the machine where a constitutional audit matters most.
 *
 * WHAT IT SUPPORTS, EXACTLY
 *
 *   key: scalar                 plain, 'single', "double", 12, 1.5, true, false, null, ~
 *   key:                        nested block map, indented two spaces
 *   key: [a, b, c]              inline list of scalars
 *   - scalar                    list of scalars
 *   - key: value                list of maps; following keys at the same column join it
 *   key: >                      folded block scalar (newlines become spaces)
 *   key: |                      literal block scalar (newlines kept)
 *   # comment                   whole-line, or trailing on a plain scalar
 *
 * WHAT IT REFUSES
 *
 * Anchors, aliases, tags, multiple documents, flow maps, and complex keys all THROW with
 * the line number. Silently ignoring a construct is how a registry field becomes a
 * comment: declared in the file, absent from the parse, and rendered nowhere. Refusing is
 * the whole point of writing the parser rather than importing one.
 */

const INDENT = 2;

class YamlError extends Error {
  constructor(msg, line) {
    super(`${msg} (line ${line})`);
    this.name = 'YamlError';
    this.line = line;
  }
}

/** Strip a trailing `# comment` that is not inside quotes. */
const stripComment = (s) => {
  let quote = null;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
      return s.slice(0, i);
    }
  }
  return s;
};

/** Turn one plain scalar into a JS value. Quoted stays a string, always. */
const scalar = (raw, line) => {
  const s = raw.trim();
  if (s === '') return '';
  if (s.startsWith('"')) {
    if (!s.endsWith('"') || s.length < 2) throw new YamlError('unterminated double quote', line);
    return s.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (s.startsWith("'")) {
    if (!s.endsWith("'") || s.length < 2) throw new YamlError('unterminated single quote', line);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return Number.parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return Number.parseFloat(s);
  if (s.startsWith('&') || s.startsWith('*') || s.startsWith('!')) {
    throw new YamlError('anchors, aliases and tags are not supported', line);
  }
  if (s.startsWith('{')) throw new YamlError('flow maps are not supported — use a block map', line);
  return s;
};

/** `[a, b, "c, d"]` -> array. Nesting is not supported and throws. */
const inlineList = (raw, line) => {
  const body = raw.trim().slice(1, -1).trim();
  if (body === '') return [];
  if (body.includes('[')) throw new YamlError('nested inline lists are not supported', line);
  const out = [];
  let cur = '';
  let quote = null;
  for (const c of body) {
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === ',') {
      out.push(scalar(cur, line));
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(scalar(cur, line));
  return out;
};

/** One physical line, pre-classified. Blank and comment lines are dropped up front. */
const lex = (text) =>
  text.split('\n').flatMap((raw, i) => {
    const line = i + 1;
    if (/^\s*$/.test(raw)) return [];
    if (/^\s*#/.test(raw)) return [];
    const indent = raw.length - raw.trimStart().length;
    if (raw.includes('\t')) throw new YamlError('tabs are not valid indentation', line);
    if (indent % INDENT !== 0) throw new YamlError(`indent must be a multiple of ${INDENT}`, line);
    return [{ line, indent, text: raw.trimEnd() }];
  });

/**
 * Collect the raw lines of a `>` or `|` block scalar that starts at `at`.
 * Returns the joined string and the index of the first line after it.
 */
const blockScalar = (lines, at, ownerIndent, style) => {
  const body = [];
  let i = at;
  while (i < lines.length && lines[i].indent > ownerIndent) {
    body.push(lines[i].text.slice(ownerIndent + INDENT));
    i += 1;
  }
  const joined = style === '|' ? body.join('\n') : body.join(' ').replace(/\s+/g, ' ').trim();
  return [joined, i];
};

/**
 * Parse the block starting at `lines[at]` whose members sit at column `indent`.
 * Returns [value, nextIndex]. Mutual recursion between maps and lists, which is the
 * whole grammar.
 */
const parseBlock = (lines, at, indent) => {
  if (at >= lines.length) return [null, at];
  return lines[at].text.trimStart().startsWith('- ') || lines[at].text.trim() === '-'
    ? parseList(lines, at, indent)
    : parseMap(lines, at, indent);
};

const parseList = (lines, at, indent) => {
  const out = [];
  let i = at;
  while (i < lines.length && lines[i].indent === indent) {
    const { text, line } = lines[i];
    const body = text.trimStart();
    if (!body.startsWith('- ') && body !== '-') break;
    const item = body === '-' ? '' : body.slice(2);
    const inner = indent + INDENT;

    if (item === '') {
      // `-` alone: the item is the indented block beneath it.
      const [v, next] = parseBlock(lines, i + 1, inner);
      out.push(v);
      i = next;
      continue;
    }

    const kv = splitKey(item, line);
    if (!kv) {
      out.push(scalar(stripComment(item), line));
      i += 1;
      continue;
    }

    // `- key: value` opens a map whose remaining keys are indented to `inner`.
    const synthetic = [{ line, indent: inner, text: ' '.repeat(inner) + item }];
    let j = i + 1;
    while (j < lines.length && lines[j].indent >= inner) {
      synthetic.push(lines[j]);
      j += 1;
    }
    const [v, consumed] = parseMap(synthetic, 0, inner);
    if (consumed !== synthetic.length) {
      throw new YamlError('unsupported structure inside a list item', synthetic[consumed].line);
    }
    out.push(v);
    i = j;
  }
  return [out, i];
};

/** Split `key: rest` -> [key, rest], or null when the line is not a mapping. */
const splitKey = (body, line) => {
  let quote = null;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ':' && (i + 1 === body.length || /\s/.test(body[i + 1]))) {
      const key = scalar(body.slice(0, i), line);
      if (typeof key !== 'string' && typeof key !== 'number') {
        throw new YamlError('complex keys are not supported', line);
      }
      return [String(key), body.slice(i + 1).trim()];
    }
  }
  return null;
};

const parseMap = (lines, at, indent) => {
  const out = {};
  let i = at;
  while (i < lines.length && lines[i].indent === indent) {
    const { text, line } = lines[i];
    const body = text.trimStart();
    if (body.startsWith('- ')) break;
    const kv = splitKey(body, line);
    if (!kv) throw new YamlError(`expected "key: value", got ${JSON.stringify(body)}`, line);
    const [key, rest] = kv;
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      throw new YamlError(`duplicate key ${JSON.stringify(key)}`, line);
    }

    if (rest === '>' || rest === '|') {
      const [v, next] = blockScalar(lines, i + 1, indent, rest);
      out[key] = v;
      i = next;
    } else if (rest === '') {
      const [v, next] = parseBlock(lines, i + 1, indent + INDENT);
      // A key with nothing under it is an empty map, never a silent null.
      out[key] = next === i + 1 ? {} : v;
      i = next;
    } else if (rest.startsWith('[')) {
      if (!rest.trimEnd().endsWith(']')) throw new YamlError('inline list must close on one line', line);
      out[key] = inlineList(stripComment(rest), line);
      i += 1;
    } else {
      out[key] = scalar(stripComment(rest), line);
      i += 1;
    }
  }
  return [out, i];
};

/** Parse a YAML document. Throws YamlError with a line number on anything unsupported. */
export const parse = (text) => {
  const lines = lex(text.replace(/\r\n/g, '\n'));
  if (!lines.length) return {};
  if (lines[0].indent !== 0) throw new YamlError('document must start at column 0', lines[0].line);
  const [value, next] = parseBlock(lines, 0, 0);
  if (next !== lines.length) throw new YamlError('unsupported structure', lines[next].line);
  return value;
};

export { YamlError };

/**
 * Reading YAML from a file — one wrapper, so failures say the same thing everywhere.
 *
 * Four call sites each wrote `parse(fs.readFileSync(p, 'utf8'))` with their own (or no)
 * error handling. Three different failure modes came out of that: core.mjs let a parse error
 * escape as a bare "unsupported structure at line 41" with no filename, learn.mjs swallowed
 * it into a default, and benchmark.mjs let ENOENT surface raw. The same broken file produced
 * three different experiences depending on which command you happened to run.
 *
 * The filename is the whole point. A parser error without one sends you looking through four
 * files for a line 41 that is in exactly one of them — which is how the golden-set failure
 * was diagnosed the slow way.
 */
export const readYamlFile = (file, { fallback = undefined } = {}) => {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw new Error(`cannot read ${file}: ${e.code === 'ENOENT' ? 'no such file' : e.message}`);
  }
  try {
    const value = parse(text);
    return value === null || value === undefined ? (fallback !== undefined ? fallback : value) : value;
  } catch (e) {
    if (fallback !== undefined) return fallback;
    // The parser reports a line; this adds the file, which is the half that was missing.
    throw new Error(`${file} is not valid YAML: ${e.message}`);
  }
};
