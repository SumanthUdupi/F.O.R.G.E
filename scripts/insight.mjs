/**
 * The questions the ledger can answer but nothing was asking.
 *
 * `doctor` checks STRUCTURE — is the organization constitutional. `memory` reports
 * RELIABILITY — who is good at what. Neither answers the questions a Principal actually has
 * after a month of use, which are about SHAPE and WASTE:
 *
 *   audit        is this organization out of balance — a division nobody uses, a capability
 *                routed to one agent forever, a roster that has stopped learning?
 *   burn         where did the tokens actually go, grouped by the things you can act on?
 *   compare      would this proposal have routed differently, and is that better?
 *   abtest       does routing beat not routing — the one claim nothing here can currently make
 *
 * All arithmetic, no model call, no network. Everything is derived from the ledger, so every
 * number can be traced to rows the organization actually recorded.
 */

import fs from 'node:fs';
import path from 'node:path';
import { workspaceDir } from './core.mjs';
import { readLedger, derive } from './ledger.mjs';

// ─────────────────────────────────────────────────────────── audit: semantic health

/**
 * Beyond structural: the things that are legal and still wrong.
 *
 * Every finding is a WARNING with a number attached, never a failure. These are judgement
 * calls about an organization's shape, and a check that fails the build over "this division
 * is a bit thin" would be a check people learn to route around.
 */
export const auditOrganization = (org, rows, { now = null } = {}) => {
  const { memory, capability } = derive(rows);
  const findings = [];

  const observed = rows.filter((r) => r.agent && !r.corrupt && r.kind !== 'spotcheck');
  if (!observed.length) {
    return { findings: [{ level: 'info', text: 'no observations yet — the audit has nothing to reason about. This is honest, not a problem.' }], observations: 0 };
  }

  // 1. Divisions nobody uses. A division with a full roster and zero observations is either
  //    work you do not actually do, or work being done somewhere it should not be.
  for (const d of org.constitution.divisions) {
    const members = (org.byDivision.get(d.id) || []).filter((a) => a.role === 'specialist');
    const used = members.filter((a) => memory[a.name]);
    if (members.length && !used.length) {
      findings.push({ level: 'warn', text: `${d.name} has ${members.length} specialists and has never been used — either that work does not happen here, or it happens somewhere it should not` });
    }
  }

  // 2. A capability carried by one agent. Not wrong, but it is a single point of failure the
  //    roster is otherwise designed to avoid, and worth knowing before that agent regresses.
  for (const [cap, c] of Object.entries(capability)) {
    if (c.n >= 5 && c.staffedBy === 1) {
      findings.push({ level: 'warn', text: `"${cap}" was requested ${c.n} times and routed to exactly one agent every time — that capability has no depth` });
    }
  }

  // 3. Division size against RULE 003's band. Legal at 3-10, but the ends are worth naming.
  for (const d of org.constitution.divisions) {
    const n = (org.byDivision.get(d.id) || []).filter((a) => a.role === 'specialist').length;
    if (n <= 3) findings.push({ level: 'info', text: `${d.name} holds ${n} specialists — the floor RULE 003 allows. One retirement puts it below constitutional.` });
    if (n >= 9) findings.push({ level: 'info', text: `${d.name} holds ${n} specialists — near the RULE 003 ceiling of 10. The next addition needs a split, not a seat.` });
  }

  // 4. Learning staleness. Measured in observations rather than days, because a workspace
  //    nobody touched for a month is not stale, it is idle — a different thing.
  const dates = observed.map((r) => r.at).filter(Boolean).sort();
  if (dates.length && now) {
    const days = Math.floor((new Date(now) - new Date(dates[dates.length - 1])) / 86400000);
    if (days > 30) findings.push({ level: 'warn', text: `the last observation was ${days} days ago — routing is deciding on evidence that old` });
  }

  // 5. Load imbalance. One agent carrying a third of everything is a bus factor.
  const total = observed.length;
  for (const [agent, m] of Object.entries(memory)) {
    if (m.n / total > 0.33 && total >= 12) {
      findings.push({ level: 'warn', text: `${agent} carried ${Math.round((m.n / total) * 100)}% of all observed work — that is a bus factor, not a specialist` });
    }
  }

  // 6. Declining agents, from the trend derive() already computes.
  for (const [agent, m] of Object.entries(memory)) {
    if (m.trend && m.trend.downtrend) {
      findings.push({ level: 'warn', text: `${agent} is trending down (${m.trend.first} → ${m.trend.last}) while still above the de-preference floor — the slope is actionable, the level is not yet` });
    }
  }

  // 7. Honesty gap: agents whose EVIDENCE claims fail spot-checks more than they pass.
  for (const [agent, m] of Object.entries(memory)) {
    if (m.evidence && m.evidence.checked >= 3 && m.evidence.confirmed / m.evidence.checked < 0.5) {
      findings.push({ level: 'warn', text: `${agent}'s EVIDENCE claims fail spot-check more often than they pass (${m.evidence.confirmed}/${m.evidence.checked}) — its reliability score is measuring the wrong thing` });
    }
  }

  return { findings, observations: observed.length };
};

// ───────────────────────────────────────────────────────────────────── burn: where it went

/**
 * Token spend grouped by the things you can actually change.
 *
 * `forge spend` answers "how much" — measured against attributed. This answers "on what",
 * which is the question that precedes a decision. Grouped four ways because the useful
 * grouping depends on what you suspect: an expensive division, an expensive capability, an
 * expensive agent, or cost going to outcomes that failed.
 */
export const burn = (rows) => {
  const observed = rows.filter((r) => r.agent && !r.corrupt && r.kind !== 'spotcheck' && r.tokens > 0);
  const total = observed.reduce((n, r) => n + r.tokens, 0);
  const group = (keyOf) => {
    const out = {};
    for (const r of observed) {
      const k = keyOf(r) || '(unattributed)';
      const g = (out[k] ??= { tokens: 0, n: 0, failed: 0 });
      g.tokens += r.tokens;
      g.n += 1;
      if (r.outcome === 'fail') g.failed += r.tokens;
    }
    return Object.entries(out)
      .map(([k, g]) => ({ key: k, ...g, share: total ? Number(((g.tokens / total) * 100).toFixed(1)) : 0 }))
      .sort((a, b) => b.tokens - a.tokens);
  };

  const wasted = observed.filter((r) => r.outcome === 'fail').reduce((n, r) => n + r.tokens, 0);
  return {
    total,
    rows: observed.length,
    wasted,
    wastedShare: total ? Number(((wasted / total) * 100).toFixed(1)) : 0,
    byAgent: group((r) => r.agent),
    byCapability: group((r) => r.capability),
    byCampaign: group((r) => r.campaign),
    byOutcome: group((r) => r.outcome),
  };
};

/** A proportional bar, so a share is read rather than computed. */
export const bar = (share, width = 24) => {
  const n = Math.max(0, Math.min(width, Math.round((share / 100) * width)));
  return `${'█'.repeat(n)}${'·'.repeat(width - n)}`;
};

// ───────────────────────────────────────────────────── compare: what a change would do

/**
 * Two Vectors, side by side.
 *
 * A proposal that changes routing is currently approved on its stated reason alone. This
 * shows the actual consequence — who would be staffed instead, what the reliability of the
 * new set is, and which stages are unaffected — so the decision is about an outcome rather
 * than about a sentence.
 */
export const compareVectors = (current, proposed) => {
  const byStage = (v) => Object.fromEntries(v.stages.map((s) => [s.id, s]));
  const a = byStage(current);
  const b = byStage(proposed);
  const ids = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const changes = [];
  for (const id of ids) {
    const x = a[id];
    const y = b[id];
    if (!x) changes.push({ id, kind: 'added', to: y.agent, capability: y.capability });
    else if (!y) changes.push({ id, kind: 'dropped', from: x.agent, capability: x.capability });
    else if (x.agent !== y.agent) changes.push({ id, kind: 'reassigned', from: x.agent, to: y.agent, capability: x.capability, scoreFrom: x.score, scoreTo: y.score });
  }
  const avg = (v) => (v.stages.length ? Number((v.stages.reduce((n, s) => n + (s.score || 0), 0) / v.stages.length).toFixed(4)) : 0);
  return {
    changes,
    unchanged: ids.length - changes.length,
    currentAvg: avg(current),
    proposedAvg: avg(proposed),
    delta: Number((avg(proposed) - avg(current)).toFixed(4)),
  };
};

// ───────────────────────────────────────────────────────── A/B: does routing beat not routing

/**
 * The one claim this project cannot currently make.
 *
 * Everything else here measures the organization against itself. This is the only mechanism
 * that measures it against the alternative — the same real task done twice, once routed and
 * once not. It cannot be automated, because doing the task is the expensive part and a model
 * cannot honestly grade its own two attempts.
 *
 * So it is a LOG, not a test: pairs accumulate, and after ten of them there is an answer.
 * The answer being "no measurable difference on small tasks" is a finding worth having, and
 * this file will report it as readily as the flattering one.
 */
const abFile = (cwd) => path.join(workspaceDir(cwd), 'ab-log.jsonl');

export const recordAB = (entry, cwd = process.cwd()) => {
  const required = ['task', 'arm'];
  const missing = required.filter((k) => !entry[k]);
  if (missing.length) throw new Error(`an A/B entry needs ${missing.join(', ')}`);
  if (!['with-forge', 'without-forge'].includes(entry.arm)) throw new Error('arm must be with-forge or without-forge');
  const row = {
    at: entry.at || new Date().toISOString(),
    task: entry.task,
    arm: entry.arm,
    minutes: Number(entry.minutes || 0),
    tokens: Number(entry.tokens || 0),
    testsPassed: entry.testsPassed === undefined ? null : !!entry.testsPassed,
    satisfaction: entry.satisfaction === undefined ? null : Number(entry.satisfaction),
    note: entry.note || null,
  };
  fs.mkdirSync(path.dirname(abFile(cwd)), { recursive: true });
  fs.appendFileSync(abFile(cwd), `${JSON.stringify(row)}\n`);
  return row;
};

export const readAB = (cwd = process.cwd()) => {
  const p = abFile(cwd);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
};

export const abSummary = (rows) => {
  const byTask = {};
  for (const r of rows) (byTask[r.task] ??= {})[r.arm] = r;
  const pairs = Object.entries(byTask).filter(([, arms]) => arms['with-forge'] && arms['without-forge']);
  if (!pairs.length) {
    return { pairs: 0, unpaired: Object.keys(byTask).length, verdict: 'no complete pairs yet — a single arm proves nothing, and saying so is the point' };
  }
  const mean = (f) => {
    const vals = pairs.map(f).filter((v) => Number.isFinite(v));
    return vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null;
  };
  const tokenDelta = mean(([, a]) => a['with-forge'].tokens - a['without-forge'].tokens);
  const minuteDelta = mean(([, a]) => a['with-forge'].minutes - a['without-forge'].minutes);
  const satDelta = mean(([, a]) => a['with-forge'].satisfaction - a['without-forge'].satisfaction);
  const testsBetter = pairs.filter(([, a]) => a['with-forge'].testsPassed && !a['without-forge'].testsPassed).length;
  const testsWorse = pairs.filter(([, a]) => !a['with-forge'].testsPassed && a['without-forge'].testsPassed).length;

  return {
    pairs: pairs.length,
    unpaired: Object.keys(byTask).length - pairs.length,
    tokenDelta,
    minuteDelta,
    satDelta,
    testsBetter,
    testsWorse,
    // Under ten pairs this refuses to draw a conclusion, and says why. A sample of three that
    // happened to favour the routed arm is the exact evidence this whole project says it
    // will not accept from anyone else.
    verdict: pairs.length < 10
      ? `${pairs.length} of 10 pairs. Too few to conclude anything — reported so the number is visible, not so it can be cited.`
      : satDelta === null
        ? 'pairs recorded, but no satisfaction ratings to compare'
        : Math.abs(satDelta) < 0.5
          ? 'no measurable difference at this sample size. That is a finding, not a failure.'
          : satDelta > 0
            ? `routed campaigns rate ${satDelta} higher on average across ${pairs.length} pairs`
            : `UNROUTED campaigns rate ${Math.abs(satDelta)} higher across ${pairs.length} pairs — the organization is costing more than it returns on this kind of task`,
  };
};
