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

  const row = {
    at: event.at || new Date().toISOString(),
    agent: event.agent,
    capability: event.capability,
    outcome: event.outcome,
    campaign: event.campaign || null,
    tokens: Number(event.tokens || 0),
    correction: event.correction || null,
    note: event.note || null,
  };
  const f = files(cwd);
  ensure(f.dir);
  fs.appendFileSync(f.ledger, `${JSON.stringify(row)}\n`);
  return row;
};

export const readLedger = (cwd = process.cwd()) => {
  const f = files(cwd);
  if (!fs.existsSync(f.ledger)) return [];
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
  for (const r of rows) {
    if (r.corrupt || !r.agent) continue;
    const m = (memory[r.agent] ??= { n: 0, score: 0, tokens: 0, byClass: {}, corrections: 0 });
    const w = WEIGHT[r.outcome];
    m.tokens += r.tokens || 0;
    if (r.correction) {
      m.corrections += 1;
      corrections.push({ agent: r.agent, capability: r.capability, text: r.correction, at: r.at });
    }
    if (w === null || w === undefined) continue;
    m.n += 1;
    m.score += w;
    const c = (m.byClass[r.capability] ??= { n: 0, score: 0, consecutiveFailures: 0 });
    c.n += 1;
    c.score += w;
    c.consecutiveFailures = r.outcome === 'fail' ? c.consecutiveFailures + 1 : 0;
  }
  for (const m of Object.values(memory)) {
    m.reliability = Number(((m.score + prior * priorStrength) / (m.n + priorStrength)).toFixed(4));
    m.costPerTask = m.n ? Math.round(m.tokens / m.n) : 0;
    for (const c of Object.values(m.byClass)) {
      c.rate = Number(((c.score + prior * priorStrength) / (c.n + priorStrength)).toFixed(4));
    }
  }
  return { memory, corrections, observations: rows.filter((r) => !r.corrupt && r.agent).length };
};

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
