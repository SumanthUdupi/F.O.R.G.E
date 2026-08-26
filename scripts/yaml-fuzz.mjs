/**
 * Fuzzing the hand-rolled YAML parser.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT "JUST USE js-yaml"
 *
 * `scripts/yaml.mjs` is 252 lines of hand-rolled parser sitting under every file the
 * organization loads — the constitution, the roster, the routing table, the contracts. If it
 * misparses, every downstream check runs confidently against the wrong organization. That is
 * a real single point of failure, and the usual answer is a dependency.
 *
 * The dependency is not available here: zero-dependency is load-bearing, not aesthetic. CI
 * has no `npm install` step precisely so that the day one creeps in is visible. So the answer
 * is to test the hand-rolled one much harder than 17 hand-written cases can.
 *
 * THE ONE FAILURE MODE THAT MATTERS
 *
 * There are exactly two acceptable outcomes for malformed input: throw, or parse correctly.
 * A SILENT WRONG PARSE is the bug — it is the one that produces a plausible object nobody
 * inspects. So the fuzzer does not assert "does not crash". It asserts:
 *
 *   1. no mutation of a valid file ever yields a value with a KEY THAT WAS NEVER IN THE
 *      SOURCE (the parser inventing structure), and
 *   2. round-tripping every valid file is stable, and
 *   3. a throw is fine — throwing is the parser doing its job.
 *
 * This is deliberately a property test, not a corpus of expected outputs: nobody can write
 * down the correct parse of 5000 random mutations, but everyone can say that inventing a key
 * is always wrong.
 *
 * Deterministic by seed, so a failure is reproducible: `node scripts/yaml-fuzz.mjs --seed 42`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, paths } from './core.mjs';
import { parse } from './yaml.mjs';

/** A small deterministic PRNG. Math.random would make a failure unreproducible, which defeats the point. */
const rng = (seed) => {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
};

/** The mutations that actually break YAML in practice, rather than random byte flips. */
export const MUTATIONS = [
  { name: 'drop a colon', apply: (l) => l.replace(':', '') },
  { name: 'shift indentation by one', apply: (l) => (l.startsWith(' ') ? l.slice(1) : ` ${l}`) },
  { name: 'remove one quote', apply: (l) => l.replace(/["']/, '') },
  { name: 'add a stray quote', apply: (l) => `${l}"` },
  { name: 'unclose a bracket', apply: (l) => l.replace(']', '') },
  { name: 'unclose a brace', apply: (l) => l.replace('}', '') },
  { name: 'insert a tab', apply: (l) => `\t${l}` },
  { name: 'duplicate the line', apply: (l) => `${l}\n${l}` },
  { name: 'drop the list dash', apply: (l) => l.replace(/^(\s*)- /, '$1') },
  { name: 'add a list dash', apply: (l) => l.replace(/^(\s*)/, '$1- ') },
  { name: 'truncate mid-token', apply: (l) => l.slice(0, Math.max(1, Math.floor(l.length / 2))) },
  { name: 'trailing colon', apply: (l) => `${l}:` },
  { name: 'empty the value', apply: (l) => l.replace(/:.*$/, ':') },
];

/** Every key that appears anywhere in a parsed object, at any depth. */
const keysOf = (v, out = new Set()) => {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') for (const [k, val] of Object.entries(v)) { out.add(k); keysOf(val, out); }
  return out;
};

/**
 * Could the source text have produced this key at all?
 *
 * The first version of this used a regex for "word before a colon", and it reported 243
 * failures against a parser that was behaving correctly — every one a multi-word key like
 * `show me:` that the regex `[A-Za-z0-9_.-]+` could not see. A fuzzer that cries wolf is
 * worse than no fuzzer, because the first thing anyone does with a noisy one is stop reading
 * it.
 *
 * So the property is weaker and SOUND instead of stronger and wrong: a key must appear
 * verbatim in the input. A parser cannot legitimately produce a key whose characters are not
 * in the text it was handed. This does not catch every conceivable misparse — a parser could
 * still lift a substring from the wrong place — but it catches fabrication, and it never
 * accuses correct behaviour.
 */
const couldHaveComeFromText = (key, text) => text.includes(String(key));

export const fuzzOnce = (source, mutate, random) => {
  const lines = source.split('\n');
  const i = Math.floor(random() * lines.length);
  const mutation = MUTATIONS[Math.floor(random() * MUTATIONS.length)];
  const mutated = [...lines.slice(0, i), mutation.apply(lines[i]), ...lines.slice(i + 1)].join('\n');

  let value;
  try {
    value = parse(mutated);
  } catch {
    return { outcome: 'threw', mutation: mutation.name, line: i + 1 };
  }

  // The parser did not throw. The only remaining question is whether what it produced could
  // have come from the text — a key that is in the object and nowhere in the source is the
  // parser inventing structure, and that is the silent misparse this exists to catch.
  const invented = [...keysOf(value)].filter((k) => !couldHaveComeFromText(k, mutated));
  if (invented.length) {
    return { outcome: 'invented', mutation: mutation.name, line: i + 1, invented, mutated };
  }
  return { outcome: 'parsed', mutation: mutation.name, line: i + 1 };
};

export const fuzz = (source, { iterations = 2000, seed = 1 } = {}) => {
  const random = rng(seed);
  const tally = { threw: 0, parsed: 0, invented: 0 };
  const failures = [];
  for (let n = 0; n < iterations; n += 1) {
    const r = fuzzOnce(source, null, random);
    tally[r.outcome] += 1;
    if (r.outcome === 'invented') failures.push(r);
  }
  return { tally, failures, iterations, seed };
};

/** Every valid registry file must round-trip identically twice — parsing is not allowed to be stateful. */
export const stableOnValidInput = () => {
  const problems = [];
  for (const p of [paths.constitution, paths.roster, paths.routing, paths.contracts]) {
    const text = fs.readFileSync(p, 'utf8');
    const a = JSON.stringify(parse(text));
    const b = JSON.stringify(parse(text));
    if (a !== b) problems.push(`${path.basename(p)} parses differently on a second read`);
  }
  return problems;
};

// ---------------------------------------------------------------------------- CLI
if (process.argv[1] && process.argv[1].endsWith('yaml-fuzz.mjs')) {
  const arg = (n, d) => {
    const i = process.argv.indexOf(`--${n}`);
    return i === -1 ? d : process.argv[i + 1];
  };
  const iterations = Number(arg('iterations', 2000));
  const seed = Number(arg('seed', 1));

  const stability = stableOnValidInput();
  if (stability.length) {
    console.error(`\n  UNSTABLE PARSE\n  - ${stability.join('\n  - ')}\n`);
    process.exit(1);
  }

  const sources = [paths.roster, paths.routing, paths.contracts, paths.constitution];
  let bad = 0;
  console.log(`\n  fuzzing ${sources.length} registry files, ${iterations} iterations each, seed ${seed}\n`);
  for (const p of sources) {
    const r = fuzz(fs.readFileSync(p, 'utf8'), { iterations, seed });
    const name = path.relative(ROOT, p);
    console.log(`  ${name.padEnd(30)} ${r.tally.threw} threw · ${r.tally.parsed} parsed · ${r.tally.invented} INVENTED`);
    for (const f of r.failures.slice(0, 3)) {
      console.error(`\n    line ${f.line}, mutation "${f.mutation}" invented key(s): ${f.invented.join(', ')}`);
    }
    bad += r.failures.length;
  }
  console.log('');
  if (bad) {
    console.error(`  ${bad} silent misparse(s). A parser that invents structure is worse than one that throws.\n`);
    process.exit(1);
  }
  console.log('  no silent misparse: every mutation either threw or produced only keys the text contained.\n');
}
