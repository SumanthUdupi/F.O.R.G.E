/**
 * The append-only record, and the memory derived from it.
 *
 * Two files, and the difference between them is the whole design:
 *
 *   .forge/ledger.jsonl   what happened. Append-only. Never rewritten, never compacted.
 *   .forge/memory.json    what it means. Derived. Deletable at any time and rebuilt.
 *
 * Keeping the derivation separate from the record is what makes the learning reversible
 * (Article 38). If the scoring model turns out to be wrong, `forge learn --rebuild` throws
 * away every conclusion and recomputes from the events, which are still exactly what the
 * organization observed. A system that learns by mutating its only copy of the evidence
 * cannot do that, and cannot be audited either.
 *
 * ATTRIBUTION IS MANDATORY. An event with no agent is refused rather than stored as
 * "unknown". A ledger of unattributable rows looks like data and teaches nothing -- it is
 * the failure mode this file exists to avoid, and the reason `observe` validates.
 */

import fs from 'node:fs';
import path from 'node:path';
import { workspaceDir } from './core.mjs';

export const OUTCOMES = ['ok', 'partial', 'fail', 'blocked'];

/**
 * The ledger row format version.
 *
 * v1 rows carry no `v` at all and are read as v1 — every field this version added is
 * optional and absent means null, so an old ledger keeps deriving byte-identical memory.
 * The version exists so that a future format change has somewhere to branch, rather than
 * needing to guess an old row's shape from which keys happen to be present.
 */
export const LEDGER_VERSION = 2;

/**
 * A row is either an OBSERVATION (an agent did something) or a SPOTCHECK (a later pass
 * re-checked a claim an observation made). They live in the same append-only file because
 * they are the same kind of fact — something happened, at a time, attributable — but they
 * are counted differently: a spotcheck must never move an agent's reliability, or verifying
 * work would be indistinguishable from doing it.
 */
export const KINDS = ['observation', 'spotcheck'];

const ensure = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

export const files = (cwd = process.cwd()) => {
  const d = workspaceDir(cwd);
  return {
    dir: d,
    ledger: path.join(d, 'ledger.jsonl'),
    memory: path.join(d, 'memory.json'),
    profile: path.join(d, 'profile.yaml'),
    proposals: path.join(d, 'proposals.json'),
    applied: path.join(d, 'applied.jsonl'),
  };
};

/**
 * Append one observation.
 *
 * `at` is supplied by the caller rather than read from the clock here, so that replaying a
 * ledger reproduces byte-identical derived memory (Article 156). A derivation that depends
 * on when it ran is not a derivation.
 */
export const observe = (event, cwd = process.cwd()) => {
  const required = ['agent', 'capability', 'outcome'];
  const missing = required.filter((k) => !event[k]);
  if (missing.length) throw new Error(`observation is missing ${missing.join(', ')} — an unattributed row teaches nothing`);
  if (!OUTCOMES.includes(event.outcome)) throw new Error(`outcome must be one of ${OUTCOMES.join(', ')}`);

  if (event.kind && !KINDS.includes(event.kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`);

  const row = {
    v: LEDGER_VERSION,
    at: event.at || new Date().toISOString(),
    kind: event.kind || 'observation',
    agent: event.agent,
    capability: event.capability,
    outcome: event.outcome,
    campaign: event.campaign || null,
    task: event.task || null,
    tokens: Number(event.tokens || 0),
    correction: event.correction || null,
    note: event.note || null,
    // The claim's own grade, so a spot-check has something to disagree WITH. Without this
    // the ledger records that work happened and never records what was asserted about it,
    // which is why RULE-007 could only ever check that a grade field existed somewhere.
    grade: event.grade || null,
    // file:line references, kept as data. This is what makes a claim mechanically
    // re-checkable — prose saying "I changed the handler" is not.
    artifacts: event.artifacts && event.artifacts.length ? [].concat(event.artifacts) : null,
    // The verbatim output block, stored so the NEXT agent can be handed the original rather
    // than a paraphrase of it. Storage is a few hundred bytes on disk; it is never re-sent
    // to a model unless `forge handoff` retrieves it.
    raw_output: event.raw_output || null,
    // Why this dispatch/escalation happened. Diagnostic only — routing never reads it.
    trace: event.trace || null,
    // Which standing hypothesis this outcome tests, so `forge learn` can report which
    // beliefs the evidence confirmed and which it refuted.
    hypothesis: event.hypothesis || null,
    // Which build of the organization produced this outcome. Without it, "C-8 succeeded and
    // C-9 failed" cannot distinguish a change in the work from a change in the roster.
    // Supplied by the caller so that `derive()` stays a pure function of its rows.
    build: event.build || null,
  };
  const f = files(cwd);
  ensure(f.dir);
  fs.appendFileSync(f.ledger, `${JSON.stringify(row)}\n`);
  // The on-disk cache keys off size+mtime and will invalidate itself; the in-process memo
  // cannot see the write it just made within the same millisecond, so drop it explicitly.
  invalidateMemory(cwd);
  return row;
};

/**
 * Above this, a synchronous read is long enough to be felt by another request.
 *
 * Below it, sync is genuinely better: simpler, no async colouring of every caller, and the
 * read completes in well under a millisecond. The Console is a long-lived process serving
 * several registered workspaces, so two concurrent requests can already contend for the same
 * event loop — which is the reason the async path exists at all, before ledger size is a
 * problem on any single workspace.
 *
 * 1MB is roughly 4000 ledger rows. Everything measured so far is three orders of magnitude
 * under that, so this is a guard rail, not a live concern.
 */
export const ASYNC_READ_THRESHOLD = 1024 * 1024;

/**
 * Sub-campaign ids — one parent, N children.
 *
 * Five parallel items writing every outcome under one campaign id makes the ledger say
 * "campaign C-0001 had nine rows" and never which item each belonged to. `C-0001.3` keeps
 * the parent groupable (`forge burn --by campaign` still rolls up) while making the item
 * addressable, which is what `forge checklist` and `forge handoff <campaign> <task>` need.
 *
 * A string convention rather than a second field, deliberately: every existing query that
 * filters on `campaign` keeps working, and `parentCampaign()` is the only thing that has to
 * know the format.
 */
export const subCampaign = (parent, n) => `${parent}.${n}`;
export const parentCampaign = (id) => String(id || '').split('.')[0] || null;
export const isSubCampaign = (id) => String(id || '').includes('.');

/**
 * Ledger shards — one file per year, read as one history.
 *
 * `.forge/ledger.jsonl` stays the live file and is never rewritten; `forge archive` MOVES
 * closed years out to `.forge/ledger.<year>.jsonl`. Nothing is deleted and nothing is
 * compacted — the shard is the same rows in a different file, which is why `readLedger`
 * concatenates them in year order and every downstream derivation is unchanged.
 *
 * Built now rather than at 100k rows because the shape of the fix, not the urgency, was the
 * open question. Running `archive` on a 126-row ledger correctly archives nothing.
 */
export const shardPaths = (cwd = process.cwd()) => {
  const d = workspaceDir(cwd);
  if (!fs.existsSync(d)) return [];
  return fs
    .readdirSync(d)
    .filter((f) => /^ledger\.\d{4}\.jsonl$/.test(f))
    .sort()
    .map((f) => path.join(d, f));
};

const parseRows = (text) =>
  text.split('\n').filter(Boolean).map((l, i) => {
    try {
      return JSON.parse(l);
    } catch {
      return { at: null, agent: null, capability: null, outcome: null, corrupt: i + 1 };
    }
  });

/**
 * Move every row from a closed year into its own shard.
 *
 * `before` is a year: rows dated strictly earlier are archived. The live file is rewritten
 * with what remains — the ONLY rewrite of the ledger anywhere in this codebase, and it is a
 * move, not an edit: every archived row is written to its shard and verified readable before
 * the live file is truncated. If anything throws in between, the live file is untouched.
 */
export const archiveLedger = (cwd = process.cwd(), { before = new Date().getFullYear() } = {}) => {
  const f = files(cwd);
  if (!fs.existsSync(f.ledger)) return { archived: 0, kept: 0, shards: [] };
  const rows = parseRows(fs.readFileSync(f.ledger, 'utf8'));
  const byYear = {};
  const keep = [];
  for (const r of rows) {
    const y = r.at ? Number(String(r.at).slice(0, 4)) : null;
    if (y && y < before) (byYear[y] ??= []).push(r);
    else keep.push(r);
  }
  const written = [];
  for (const [year, list] of Object.entries(byYear)) {
    const p = path.join(workspaceDir(cwd), `ledger.${year}.jsonl`);
    // Append, never overwrite — archiving twice must not lose the first archive.
    fs.appendFileSync(p, `${list.map((r) => JSON.stringify(r)).join('\n')}\n`);
    // Read it back before touching the live file. A move that cannot be verified is a delete.
    const check = parseRows(fs.readFileSync(p, 'utf8'));
    if (check.length < list.length) throw new Error(`shard ${p} did not take every row — the live ledger was not touched`);
    written.push(p);
  }
  if (written.length) {
    fs.writeFileSync(f.ledger, keep.length ? `${keep.map((r) => JSON.stringify(r)).join('\n')}\n` : '');
    invalidateMemory(cwd);
  }
  return { archived: rows.length - keep.length, kept: keep.length, shards: written };
};

export const readLedger = (cwd = process.cwd()) => {
  const f = files(cwd);
  // Shards first, in year order, then the live file — so the history reads as one sequence
  // and `derive()` cannot tell whether a row was archived.
  const shards = shardPaths(cwd);
  const archived = shards.flatMap((p) => {
    try {
      return parseRows(fs.readFileSync(p, 'utf8'));
    } catch {
      return [];
    }
  });
  if (!fs.existsSync(f.ledger)) return archived;
  if (archived.length) return [...archived, ...parseRows(fs.readFileSync(f.ledger, 'utf8'))];
  return fs
    .readFileSync(f.ledger, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch {
        // One corrupt line must not destroy the history around it.
        return { at: null, agent: null, capability: null, outcome: null, corrupt: i + 1 };
      }
    });
};

/**
 * The same read, yielding the event loop for a large file.
 *
 * Small files stay synchronous — identical behaviour, no added complexity, and the common
 * case never pays for a case it does not have. Past the threshold the read is awaited, which
 * hands the loop back so a second request is not stuck behind the first one's I/O.
 *
 * Used by the Console, which is the only long-lived process here. The CLI exits after one
 * command and has nothing to block.
 */
export const readLedgerAsync = async (cwd = process.cwd()) => {
  const f = files(cwd);
  // Shards are read here too. The first version of this read only the live file, which would
  // have made the Console silently show a shorter history than the CLI the moment anyone ran
  // `forge archive` — two views of the same ledger disagreeing is worse than a slow read.
  const shards = shardPaths(cwd);
  const archived = [];
  for (const p2 of shards) {
    try {
      archived.push(...parseRows(await fs.promises.readFile(p2, 'utf8')));
    } catch { /* an unreadable shard is not a reason to lose the live rows */ }
  }
  if (!fs.existsSync(f.ledger)) return archived;
  let size = 0;
  try { size = fs.statSync(f.ledger).size; } catch { return archived; }
  if (size < ASYNC_READ_THRESHOLD) return archived.length ? [...archived, ...parseRows(fs.readFileSync(f.ledger, 'utf8'))] : readLedger(cwd);

  return [...archived, ...parseRows(await fs.promises.readFile(f.ledger, 'utf8'))];
};

const WEIGHT = { ok: 1, partial: 0.5, fail: 0, blocked: null }; // blocked is not the agent's fault

/**
 * Derive memory. Pure function of the rows -- same input, same output, no clock, no I/O.
 *
 * The reliability estimate is Laplace-smoothed against the neutral prior, so three lucky
 * successes do not read as a perfect agent. `PRIOR_STRENGTH` is how many observations the
 * prior is worth; at 4, an agent needs a real track record before the number moves much.
 */
export const derive = (rows, { prior = 0.7, priorStrength = 4 } = {}) => {
  const memory = {};
  const corrections = [];
  const capability = {};
  const hypotheses = {};
  for (const r of rows) {
    if (r.corrupt || !r.agent) continue;

    // A spotcheck is a verdict ON an observation, never an observation itself. Counting it
    // into reliability would mean an agent whose claims are re-checked often looks busier
    // than one nobody audits, which inverts the incentive this whole mechanism exists for.
    if (r.kind === 'spotcheck') {
      const m = (memory[r.agent] ??= { n: 0, score: 0, tokens: 0, byClass: {}, corrections: 0 });
      const e = (m.evidence ??= { checked: 0, confirmed: 0 });
      e.checked += 1;
      if (r.outcome === 'ok') e.confirmed += 1;
      continue;
    }

    const m = (memory[r.agent] ??= { n: 0, score: 0, tokens: 0, byClass: {}, corrections: 0 });
    const w = WEIGHT[r.outcome];
    m.tokens += r.tokens || 0;
    if (r.correction) {
      m.corrections += 1;
      corrections.push({ agent: r.agent, capability: r.capability, text: r.correction, at: r.at });
    }
    if (r.hypothesis) {
      const h = (hypotheses[r.hypothesis] ??= { n: 0, supported: 0, refuted: 0 });
      h.n += 1;
      if (r.outcome === 'ok') h.supported += 1;
      if (r.outcome === 'fail') h.refuted += 1;
    }
    if (w === null || w === undefined) continue;
    m.n += 1;
    m.score += w;
    (m.history ??= []).push(w);
    const c = (m.byClass[r.capability] ??= { n: 0, score: 0, consecutiveFailures: 0 });
    c.n += 1;
    c.score += w;
    c.consecutiveFailures = r.outcome === 'fail' ? c.consecutiveFailures + 1 : 0;

    // Cost per capability, across every agent that holds it. This is what separates
    // "this capability is intrinsically hard" from "this capability is staffed expensively"
    // — two very different problems that a per-agent cost figure cannot tell apart.
    const cc = (capability[r.capability] ??= { tokens: 0, n: 0, successes: 0, agents: {} });
    cc.tokens += r.tokens || 0;
    cc.n += 1;
    if (w === 1) cc.successes += 1;
    cc.agents[r.agent] = (cc.agents[r.agent] || 0) + 1;
  }

  for (const m of Object.values(memory)) {
    m.reliability = Number(((m.score + prior * priorStrength) / (m.n + priorStrength)).toFixed(4));
    m.costPerTask = m.n ? Math.round(m.tokens / m.n) : 0;
    for (const c of Object.values(m.byClass)) {
      c.rate = Number(((c.score + prior * priorStrength) / (c.n + priorStrength)).toFixed(4));
    }
    if (m.evidence) {
      // Smoothed against the same neutral prior as reliability, and for the same reason:
      // two confirmed claims is not a track record of honesty.
      m.evidence.accuracy = Number(
        ((m.evidence.confirmed + prior * priorStrength) / (m.evidence.checked + priorStrength)).toFixed(4),
      );
    }
    // DOWNTREND — an agent falling below 0.55 already triggers a de-preference proposal, but
    // by then the damage is done. This flags the slope while the level is still fine, which
    // is the whole difference between a warning and a post-mortem. It needs 10 observations
    // in each half before it will say anything, so a bad first week cannot read as a trend.
    const h = m.history || [];
    if (h.length >= 20) {
      const first = h.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
      const last = h.slice(-10).reduce((a, b) => a + b, 0) / 10;
      m.trend = { first, last, delta: Number((last - first).toFixed(4)) };
      if (first - last > 0.15) m.trend.downtrend = true;
    }
    delete m.history; // an accumulator, not a fact about the agent
  }

  for (const c of Object.values(capability)) {
    c.costPerTask = c.n ? Math.round(c.tokens / c.n) : 0;
    c.costPerSuccess = c.successes ? Math.round(c.tokens / c.successes) : null;
    c.staffedBy = Object.keys(c.agents).length;
  }

  return {
    memory,
    corrections,
    capability,
    hypotheses,
    observations: rows.filter((r) => !r.corrupt && r.agent && r.kind !== 'spotcheck').length,
  };
};

/**
 * The derivation, memoised — the fix for the hot path.
 *
 * `derive(readLedger())` was called on every CLI invocation, including the per-turn routing
 * path, and it reads and folds the entire ledger every time. At 126 rows that is free; the
 * design is meant to survive 100k, and it would not.
 *
 * Invalidated by size + mtime — a `stat`, not a re-read, so the common case (ledger
 * unchanged since the last command) costs one stat and one small JSON read instead of a full
 * parse-and-fold. TWO layers, because the two callers have opposite lifetimes:
 *
 *   in-process Map   the Console is one long-lived process serving many clicks; it should
 *                    not touch disk at all between them.
 *   .memory-cache.json  the CLI exits after every command and would lose an in-process cache
 *                    entirely, so the memo has to outlive the process.
 *
 * The ledger remains the single source of truth. This cache is provably safe to delete at
 * any moment — deleting it forces the next call to recompute, which is exactly the same
 * reversibility property memory.json already has. It is never read as authority, only as a
 * shortcut whose key proves it is current.
 */
const memoryMemo = new Map();

const signature = (p) => {
  try {
    const st = fs.statSync(p);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return 'empty';
  }
};

export const derivedMemory = (cwd = process.cwd(), { force = false } = {}) => {
  const f = files(cwd);
  const sig = signature(f.ledger);
  const key = path.resolve(cwd);

  if (!force) {
    const hot = memoryMemo.get(key);
    if (hot && hot.sig === sig) return hot.derived;

    try {
      const disk = JSON.parse(fs.readFileSync(path.join(f.dir, '.memory-cache.json'), 'utf8'));
      if (disk && disk.sig === sig && disk.derived) {
        memoryMemo.set(key, { sig, derived: disk.derived });
        return disk.derived;
      }
    } catch {
      /* a missing or corrupt cache is not an error — it is a cache miss */
    }
  }

  const derived = derive(readLedger(cwd));
  memoryMemo.set(key, { sig, derived });
  try {
    ensure(f.dir);
    fs.writeFileSync(path.join(f.dir, '.memory-cache.json'), `${JSON.stringify({ sig, derived })}\n`);
  } catch {
    /* an unwritable cache must never break the command that tried to warm it */
  }
  return derived;
};

/** Drop the memo for one workspace (or all of them). Used by tests and by `observe`. */
export const invalidateMemory = (cwd) => {
  if (cwd === undefined) memoryMemo.clear();
  else memoryMemo.delete(path.resolve(cwd));
};

/**
 * The flat machine-to-machine handoff line.
 *
 * `status=SUCCESS|evidence=EVIDENCE|artifact=src/api/users.ts:42|handoff=none`
 *
 * This is the small, real version of what the TOON wire-protocol idea was reaching for, and
 * it needs no library: split on `|`, split on the first `=`, done. It is cheaper than the
 * markdown contract block and — more importantly — unambiguous, because there is nowhere for
 * a nested sentence to hide.
 *
 * Scope is deliberately narrow. The rich markdown contract stays for anything a human reads,
 * including the board minutes. Machine hops get this. Using the flat format for human-facing
 * output would be optimising the wrong cost.
 */
export const HANDOFF_KEYS = ['task', 'agent', 'capability', 'status', 'evidence', 'artifact', 'campaign'];

export const flatHandoff = (row = {}) => {
  const pairs = {
    task: row.task || 'none',
    agent: row.agent || 'unknown',
    capability: row.capability || 'none',
    status: { ok: 'SUCCESS', partial: 'PARTIAL', fail: 'FAILED', blocked: 'BLOCKED' }[row.outcome] || 'UNKNOWN',
    evidence: row.grade || 'UNKNOWN',
    artifact: (row.artifacts || []).join(',') || 'none',
    campaign: row.campaign || 'none',
  };
  // A value containing the delimiter would silently split into two fields on the far side.
  const safe = (v) => String(v).replace(/[|=\n]/g, ' ').trim();
  return HANDOFF_KEYS.map((k) => `${k}=${safe(pairs[k])}`).join('|');
};

export const parseFlatHandoff = (line) =>
  Object.fromEntries(
    String(line || '')
      .split('|')
      .map((p) => {
        const i = p.indexOf('=');
        return i === -1 ? null : [p.slice(0, i), p.slice(i + 1)];
      })
      .filter(Boolean),
  );

export const loadMemory = (cwd = process.cwd()) => {
  const f = files(cwd);
  if (!fs.existsSync(f.memory)) return {};
  try {
    return JSON.parse(fs.readFileSync(f.memory, 'utf8')).memory || {};
  } catch {
    return {};
  }
};

export const saveMemory = (derived, cwd = process.cwd()) => {
  const f = files(cwd);
  ensure(f.dir);
  fs.writeFileSync(f.memory, `${JSON.stringify(derived, null, 2)}\n`);
  return f.memory;
};

/**
 * Cost estimation for a plan — absorbed from studying OmniRoute, rebuilt on our terms.
 *
 * OmniRoute cuts spend by routing requests across provider free tiers through a gateway.
 * The gateway is the part that cannot come here (a runtime service, credentials, egress —
 * three gates in one). The part worth keeping is smaller and better: a plan should say
 * what it will roughly cost BEFORE it runs, and the only honest source for that number is
 * this workspace's own measured history. No history, no number — an invented estimate is
 * worse than none, because it gets budgeted against.
 */
export const estimateStages = (stages, rows) => {
  const byCap = {};
  for (const r of rows) {
    if (!r.capability || !(r.tokens > 0)) continue;
    const c = (byCap[r.capability] ??= { tokens: 0, n: 0 });
    c.tokens += r.tokens;
    c.n += 1;
  }
  const measured = Object.values(byCap);
  const overall = measured.length ? Math.round(measured.reduce((s, c) => s + c.tokens, 0) / measured.reduce((s, c) => s + c.n, 0)) : null;

  let total = 0;
  let grounded = 0;
  const perStage = stages.map((s) => {
    const caps = String(s.capability || '').split('+');
    const hit = caps.map((c) => byCap[c]).find(Boolean);
    const est = hit ? Math.round(hit.tokens / hit.n) : overall;
    if (hit) grounded += 1;
    if (est) total += est;
    return { id: s.id, agent: s.agent, estimate: est, basis: hit ? 'measured for this capability' : overall ? 'workspace average' : 'no history' };
  });

  return {
    total: overall === null ? null : total,
    perStage,
    grounded,
    of: stages.length,
    note:
      overall === null
        ? 'No token history in this workspace yet — estimates appear once campaigns close their ledger.'
        : `Grounded in ${grounded} of ${stages.length} stages' own history; the rest use the workspace average.`,
  };
};

/**
 * Measured spend, read from the host runtime's own session transcripts — absorbed from
 * studying codeburn, rebuilt without the desktop app.
 *
 * codeburn's real insight is the data source: the transcripts already record exactly what
 * each request cost, so a spend view built on estimates is leaving the truth on disk.
 * This reads the JSONL transcripts for THIS workspace and sums the provider-reported
 * usage. It is workspace-total truth; per-agent attribution still comes from the ledger,
 * and the Console shows both, labelled as what they are.
 */
/**
 * Per-transcript usage, cached by (path, mtime, size).
 *
 * A workspace can hold a hundred transcripts at tens of megabytes each; re-parsing them on
 * every Console poll would make the Spending view the most expensive thing in the room.
 * The cache key includes mtime AND size, so an actively-running session re-parses and a
 * finished one never does.
 */
const usageCache = new Map();

const fileUsage = (full) => {
  let st;
  try {
    st = fs.statSync(full);
  } catch {
    return null;
  }
  const key = `${full}:${st.mtimeMs}:${st.size}`;
  const hit = usageCache.get(key);
  if (hit) return hit;
  const u = { input: 0, output: 0, cacheRead: 0, turns: 0, mtime: st.mtime, birth: st.birthtime, size: st.size };
  let body = '';
  try {
    body = fs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }
  for (const line of body.split('\n')) {
    if (!line.includes('"usage"')) continue;
    try {
      const usage = JSON.parse(line).message?.usage;
      if (!usage) continue;
      u.input += (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
      u.cacheRead += usage.cache_read_input_tokens || 0;
      u.output += usage.output_tokens || 0;
      u.turns += 1;
    } catch { /* one corrupt line is one corrupt line */ }
  }
  usageCache.set(key, u);
  if (usageCache.size > 400) usageCache.delete(usageCache.keys().next().value);
  return u;
};

const transcriptDir = (cwd) => path.join(process.env.HOME || '', '.claude', 'projects', path.resolve(cwd).replace(/[/.]/g, '-'));

/**
 * The Claude Code sessions of THIS workspace — the real ones, from the transcripts.
 *
 * The Sessions view listed registered workspaces and called them sessions, and the
 * Principal correctly objected: a workspace is a place, a session is a sitting. Each
 * transcript file IS one session, with its own start, last activity, turns and spend.
 */
export const listSessions = (cwd = process.cwd(), { limit = 15 } = {}) => {
  const dir = transcriptDir(cwd);
  if (!fs.existsSync(dir)) return { available: false, sessions: [] };
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, st: fs.statSync(path.join(dir, f)) }))
    .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  const sessions = [];
  for (const { f } of files.slice(0, limit)) {
    const u = fileUsage(path.join(dir, f));
    if (!u) continue;
    sessions.push({
      id: f.replace(/\.jsonl$/, ''),
      started: u.birth,
      lastActive: u.mtime,
      turns: u.turns,
      tokens: u.input + u.output,
      cacheRead: u.cacheRead,
      active: Date.now() - u.mtime.getTime() < 10 * 60 * 1000,
    });
  }
  return { available: true, total: files.length, sessions };
};

export const measuredSpend = (cwd = process.cwd()) => {
  const dir = transcriptDir(cwd);
  if (!fs.existsSync(dir)) {
    return { available: false, why: 'no session transcripts found for this workspace', input: 0, output: 0, cacheRead: 0, sessions: 0 };
  }
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let sessions = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const u = fileUsage(path.join(dir, f));
    if (!u) continue;
    sessions += 1;
    input += u.input;
    output += u.output;
    cacheRead += u.cacheRead;
  }
  return { available: true, input, output, cacheRead, sessions };
};
