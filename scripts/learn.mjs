/**
 * The evolution layer. This is the part that makes the tenth campaign better than the first.
 *
 * WHAT IT IS ALLOWED TO CHANGE, AND WHAT IT IS NOT
 *
 * Article 86: self-improvement is not self-modification. The organization observes,
 * hypothesizes, and PROPOSES. It applies nothing on its own. Concretely:
 *
 *   may write   .forge/profile.yaml     what this workspace is
 *               .forge/memory.json      who is good at what, measured
 *               .forge/overlay.yaml     per-workspace routing and instruction deltas
 *               .forge/proposals.json   what it would like to change, and why
 *
 *   may never   charter/constitution.yaml   RULE 001. The skeleton is the Principal's.
 *               registry/*.yaml              the shipped organization
 *               scripts/*                    including this file
 *
 * FORBIDDEN is enforced in code, not in a comment, and there is a test that plants a
 * proposal against each forbidden target and asserts it is refused. A guardrail nobody
 * tried to break is a guardrail nobody knows the state of.
 *
 * WHY A CAPACITY CAP
 *
 * Five proposals per run, three agents touched. Not because more would be wrong, but
 * because a review queue nobody reads approves everything, and an evolution layer whose
 * proposals are rubber-stamped has quietly become a self-modification layer.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse } from './yaml.mjs';
import { files, readLedger, derive } from './ledger.mjs';

const readLedgerFor = (cwd) => readLedger(cwd);

export const CAP = { proposals: 5, agents: 3 };

/** Nothing under these may ever be a proposal target. Checked by prefix, after resolution. */
export const FORBIDDEN = ['charter/', 'registry/', 'scripts/', 'agents/', 'skills/'];

export const isForbidden = (target) => {
  const t = String(target || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (t.startsWith('/') || t.includes('..')) return true; // escapes the workspace
  return FORBIDDEN.some((f) => t === f.slice(0, -1) || t.startsWith(f));
};

// ---------------------------------------------------------------- workspace profiling

const readIf = (p) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};

const STACK_MARKERS = [
  { file: 'package.json', stack: 'javascript', why: 'package.json present' },
  { file: 'tsconfig.json', stack: 'typescript', why: 'tsconfig.json present' },
  { file: 'pyproject.toml', stack: 'python', why: 'pyproject.toml present' },
  { file: 'requirements.txt', stack: 'python', why: 'requirements.txt present' },
  { file: 'go.mod', stack: 'go', why: 'go.mod present' },
  { file: 'Cargo.toml', stack: 'rust', why: 'Cargo.toml present' },
  { file: 'Gemfile', stack: 'ruby', why: 'Gemfile present' },
  { file: 'pom.xml', stack: 'java', why: 'pom.xml present' },
  { file: 'composer.json', stack: 'php', why: 'composer.json present' },
];

/**
 * Read the workspace and say what it is. Every field carries a grade, because RULE 007
 * applies to the organization's beliefs about itself as much as to its output.
 *
 * EVIDENCE  read out of a file that exists
 * INFERENCE derived from more than one weak signal
 * UNKNOWN   not found. Written down as UNKNOWN, never omitted -- an absent field reads as
 *           "nothing to say here", and "I could not tell" is a different statement.
 */
export const profileWorkspace = (cwd = process.cwd()) => {
  const at = (p) => path.join(cwd, p);
  const stacks = STACK_MARKERS.filter((m) => fs.existsSync(at(m.file)));

  let testCommand = { value: null, grade: 'UNKNOWN', why: 'no runner found' };
  const pkgRaw = readIf(at('package.json'));
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw);
      if (pkg.scripts?.test) {
        testCommand = { value: 'npm test', grade: 'EVIDENCE', why: `package.json scripts.test = ${pkg.scripts.test}` };
      }
    } catch {
      testCommand = { value: null, grade: 'UNKNOWN', why: 'package.json did not parse' };
    }
  }
  if (!testCommand.value && fs.existsSync(at('Makefile'))) {
    const mk = readIf(at('Makefile')) || '';
    if (/^test:/m.test(mk)) testCommand = { value: 'make test', grade: 'EVIDENCE', why: 'Makefile declares a test target' };
  }
  if (!testCommand.value && fs.existsSync(at('pyproject.toml'))) {
    testCommand = { value: 'pytest', grade: 'INFERENCE', why: 'python project, no explicit runner declared' };
  }

  // House style, sampled rather than assumed. Two spaces vs four is the argument most
  // likely to produce a diff nobody asked for.
  let indent = { value: null, grade: 'UNKNOWN', why: 'no source sampled' };
  const sample = [];
  const walk = (dir, depth) => {
    if (depth > 3 || sample.length > 40) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === 'vendor') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/\.(js|mjs|ts|tsx|py|go|rs|rb|java|php|css)$/.test(e.name)) sample.push(full);
      if (sample.length > 40) return;
    }
  };
  walk(cwd, 0);
  if (sample.length) {
    const counts = { 2: 0, 4: 0 };
    for (const f of sample.slice(0, 40)) {
      for (const line of (readIf(f) || '').split('\n')) {
        const m = /^( +)\S/.exec(line);
        if (!m) continue;
        if (m[1].length === 2) counts[2] += 1;
        else if (m[1].length === 4) counts[4] += 1;
      }
    }
    const total = counts[2] + counts[4];
    if (total > 20) {
      const win = counts[4] > counts[2] ? 4 : 2;
      indent = {
        value: win,
        grade: counts[win] / total > 0.8 ? 'EVIDENCE' : 'INFERENCE',
        why: `${counts[win]} of ${total} indented lines use ${win} spaces, across ${sample.length} files`,
      };
    }
  }

  return {
    stacks: stacks.length
      ? { value: [...new Set(stacks.map((s) => s.stack))], grade: 'EVIDENCE', why: stacks.map((s) => s.why).join('; ') }
      : { value: [], grade: 'UNKNOWN', why: 'no manifest found at the workspace root' },
    testCommand,
    indent,
    hasTests: fs.existsSync(at('tests')) || fs.existsSync(at('test')) || fs.existsSync(at('spec'))
      ? { value: true, grade: 'EVIDENCE', why: 'a test directory exists' }
      : { value: false, grade: 'INFERENCE', why: 'no conventional test directory at the root' },
    vcs: fs.existsSync(at('.git'))
      ? { value: 'git', grade: 'EVIDENCE', why: '.git present' }
      : { value: null, grade: 'UNKNOWN', why: 'no .git at the workspace root' },
  };
};

/** Serialize the profile as YAML this repo's own reader can read back. */
export const renderProfile = (p) => {
  const L = ['# Learned by `forge learn`. Derived, not authored -- edit the workspace, not this file.', '#', '# Every field carries a grade. UNKNOWN is written down rather than omitted, because an', '# absent field reads as "nothing to say" and "I could not tell" is a different claim.', 'profile:'];
  for (const [k, v] of Object.entries(p)) {
    const val = Array.isArray(v.value) ? `[${v.value.join(', ')}]` : v.value === null ? 'null' : String(v.value);
    L.push(`  ${k}:`);
    L.push(`    value: ${val}`);
    L.push(`    grade: ${v.grade}`);
    L.push(`    why: ${JSON.stringify(v.why)}`);
  }
  return `${L.join('\n')}\n`;
};

// ------------------------------------------------------------------------- proposals

/**
 * Look at the evidence and say what should change. Proposals only.
 *
 * Each carries the observation that produced it, so a proposal can be argued with. A
 * recommendation with no traceable observation behind it is the organization guessing, and
 * RULE 007 forbids dressing a guess as a finding.
 */
export const propose = (org, { rows, profile }) => {
  const { memory, corrections } = derive(rows);
  const out = [];
  const touched = new Set();

  const add = (p) => {
    if (out.length >= CAP.proposals) return;
    if (p.agent) {
      if (touched.size >= CAP.agents && !touched.has(p.agent)) return;
      touched.add(p.agent);
    }
    if (isForbidden(p.target)) {
      out.push({ ...p, id: `P${out.length + 1}`, refused: `${p.target} is outside what evolution may write` });
      return;
    }
    out.push({ ...p, id: `P${out.length + 1}` });
  };

  // 1. Repeated correction of the same agent is a standing instruction the org has not
  //    absorbed. Article 34: classify it; do not auto-promote every note.
  const byAgent = {};
  for (const c of corrections) (byAgent[c.agent] ??= []).push(c);
  for (const [agent, list] of Object.entries(byAgent).sort((a, b) => b[1].length - a[1].length)) {
    if (list.length < 2) continue;
    add({
      kind: 'instruction',
      agent,
      target: '.forge/overlay.yaml',
      change: `append a standing instruction to ${agent} for this workspace`,
      body: list.slice(-3).map((c) => c.text),
      observation: `${list.length} corrections recorded against ${agent}`,
      grade: 'EVIDENCE',
      reversible: true,
    });
  }

  // 2. Measured reliability well under the prior is a routing signal, not a scolding. The
  //    proposal is to prefer someone else on that class, and it names who.
  for (const [agent, m] of Object.entries(memory)) {
    if (m.n < 4 || m.reliability >= 0.55) continue;
    const worst = Object.entries(m.byClass).sort((a, b) => a[1].rate - b[1].rate)[0];
    if (!worst) continue;
    const alt = org.all
      .filter((a) => a.role === 'specialist' && a.name !== agent && (a.capabilities || []).includes(worst[0]))
      .map((a) => a.name);
    add({
      kind: 'routing',
      agent,
      target: '.forge/overlay.yaml',
      change: `de-prefer ${agent} for "${worst[0]}" in this workspace`,
      body: alt.length ? [`prefer instead: ${alt.join(', ')}`] : ['no alternative specialist holds this capability — this is a Talent gap, not a routing fix'],
      observation: `${agent} scored ${m.reliability} over ${m.n} observations; worst class "${worst[0]}" at ${worst[1].rate}`,
      grade: 'EVIDENCE',
      reversible: true,
    });
  }

  // 3. A capability the workspace keeps needing that nobody owns is a Talent gap. The
  //    proposal is a candidate specialist -- never an automatic hire (Article 40).
  const supplied = new Set(org.all.flatMap((a) => a.capabilities || []));
  const demanded = {};
  for (const r of rows) if (r.capability) demanded[r.capability] = (demanded[r.capability] || 0) + 1;
  for (const [cap, n] of Object.entries(demanded)) {
    if (supplied.has(cap) || n < 3) continue;
    add({
      kind: 'talent',
      agent: null,
      target: '.forge/proposals.json',
      change: `draft a candidate specialist owning "${cap}"`,
      body: [`observed ${n} times with no specialist holding the capability`],
      observation: `capability "${cap}" requested ${n} times, supplied by nobody`,
      grade: 'EVIDENCE',
      reversible: true,
    });
  }

  // 4. The profile is the cheapest adaptation there is: stop rediscovering the test command.
  if (profile.testCommand.grade !== 'UNKNOWN') {
    add({
      kind: 'profile',
      agent: null,
      target: '.forge/overlay.yaml',
      change: `pin the verification command for this workspace to "${profile.testCommand.value}"`,
      body: [profile.testCommand.why],
      observation: 'detected from the workspace itself, not from the ledger',
      grade: profile.testCommand.grade,
      reversible: true,
    });
  }
  if (profile.indent.grade !== 'UNKNOWN') {
    add({
      kind: 'profile',
      agent: null,
      target: '.forge/overlay.yaml',
      change: `write new code with ${profile.indent.value}-space indentation`,
      body: [profile.indent.why],
      observation: 'sampled from existing source; matching it keeps diffs to what was asked for',
      grade: profile.indent.grade,
      reversible: true,
    });
  }

  return { proposals: out, memory, corrections: corrections.length, capped: { ...CAP } };
};

/**
 * Apply one approved proposal, and record how to undo it.
 *
 * The `applied.jsonl` row carries the PRIOR value. Article 38: training is reversible, and
 * so is every other adaptation. An improvement you cannot withdraw is a commitment.
 */
export const applyProposal = (proposal, cwd = process.cwd()) => {
  if (isForbidden(proposal.target)) throw new Error(`refusing: ${proposal.target} is outside what evolution may write`);
  const f = files(cwd);
  fs.mkdirSync(f.dir, { recursive: true });
  const overlayPath = path.join(cwd, '.forge', 'overlay.yaml');
  const before = fs.existsSync(overlayPath) ? fs.readFileSync(overlayPath, 'utf8') : '';

  const header = before || '# Per-workspace deltas, applied by the Principal from `forge evolve`.\n# Delete any block to withdraw it. The shipped organization is unaffected.\nadaptations:\n';
  const block = [
    `  - id: ${proposal.id}`,
    `    kind: ${proposal.kind}`,
    proposal.agent ? `    agent: ${proposal.agent}` : null,
    `    change: ${JSON.stringify(proposal.change)}`,
    `    observation: ${JSON.stringify(proposal.observation)}`,
    `    grade: ${proposal.grade}`,
    ...(proposal.body || []).map((b, i) => (i === 0 ? `    detail: ${JSON.stringify(b)}` : `    detail_${i + 1}: ${JSON.stringify(b)}`)),
  ]
    .filter(Boolean)
    .join('\n');

  fs.writeFileSync(overlayPath, `${header}${block}\n`);
  fs.appendFileSync(
    f.applied,
    `${JSON.stringify({ at: new Date().toISOString(), proposal: proposal.id, change: proposal.change, undo: { file: 'overlay.yaml', restore: before } })}\n`,
  );
  return overlayPath;
};

/** Read the workspace overlay, if the Principal has approved anything here. */
export const loadOverlay = (cwd = process.cwd()) => {
  const p = path.join(cwd, '.forge', 'overlay.yaml');
  if (!fs.existsSync(p)) return { adaptations: [] };
  try {
    return parse(fs.readFileSync(p, 'utf8')) || { adaptations: [] };
  } catch {
    return { adaptations: [] };
  }
};

/**
 * The session briefing.
 *
 * Absorbed from the harness this organization replaced, which injected a repository scan at
 * the start of every session. That version listed what existed; it hit its own scan limits
 * on a large tree and reported "UNKNOWN" for most of what mattered, which is a briefing that
 * costs tokens and answers nothing.
 *
 * This one carries only what the organization has actually LEARNED about the workspace --
 * the graded profile, the adaptations the Principal approved, and the agents whose measured
 * reliability would change a routing decision. Everything else is discoverable on demand and
 * does not belong in every prompt.
 *
 * Silence is the correct output for a workspace nothing is known about. A briefing that
 * always has something to say trains the reader to skip it.
 */
export const briefing = (org, cwd = process.cwd()) => {
  const rows = readLedgerFor(cwd);
  const { memory } = derive(rows);
  const overlay = loadOverlay(cwd);
  const profile = profileWorkspace(cwd);

  const lines = [];
  // A field has to carry information, not merely have been determined. The first version
  // filtered on grade alone and emitted a briefing whose entire content was
  // "hasTests=false (INFERENCE)" -- true, graded, and worth nothing in every prompt of
  // every session. An absent thing is only worth saying when something else is present.
  const informative = ([, v]) =>
    v.grade !== 'UNKNOWN' && v.value !== null && v.value !== false && !(Array.isArray(v.value) && !v.value.length);
  const known = Object.entries(profile).filter(informative);
  if (known.some(([, v]) => v.grade === 'EVIDENCE')) {
    lines.push(`WORKSPACE  ${known.map(([k, v]) => `${k}=${Array.isArray(v.value) ? v.value.join('/') : v.value} (${v.grade})`).join(' · ')}`);
  }

  const adaptations = overlay.adaptations || [];
  if (adaptations.length) {
    lines.push('IN FORCE HERE, approved by the Principal — these outrank your general instinct:');
    for (const a of adaptations) lines.push(`  - ${a.change}${a.detail ? ` (${a.detail})` : ''}`);
  }

  // Only agents far enough from the prior to change a route are worth the tokens.
  const notable = Object.entries(memory)
    .filter(([, m]) => m.n >= 3 && (m.reliability < 0.55 || m.reliability > 0.85))
    .sort((a, b) => a[1].reliability - b[1].reliability);
  if (notable.length) {
    lines.push('MEASURED HERE:');
    for (const [n, m] of notable) lines.push(`  - ${n} ${m.reliability} over ${m.n} observations`);
  }

  if (!lines.length) return '';
  return `F.O.R.G.E. — what this workspace has taught the organization\n${lines.join('\n')}`;
};
