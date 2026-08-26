/**
 * The minutes — decisions, dissent, and what a campaign taught.
 *
 * P6 says "the rejected alternative and who argued it are recorded with the decision", and
 * `decision-recorder` exists to do it. Nothing STORED it. The principle was real, the
 * specialist was real, and the artefact went into a message that scrolled away.
 *
 * So decisions get a file, and it is append-only for the same reason the ledger is: a
 * decision record you can edit is a record of what you currently think you decided.
 *
 * THE FIELD THAT MATTERS IS `minority`.
 *
 * A decision record with only the winning argument is a press release. The whole reason a
 * board without a tie-breaker is worth the friction is that a contested call leaves both
 * positions on the record — so when it turns out wrong, the person who said so is findable
 * and the reasoning is intact. `breakers.dissentPreserved` fails a campaign whose contested
 * decisions carry no minority position.
 */

import fs from 'node:fs';
import path from 'node:path';
import { workspaceDir } from './core.mjs';
import { readLedger, derive } from './ledger.mjs';

const file = (cwd) => path.join(workspaceDir(cwd), 'decisions.jsonl');

export const recordDecision = (d, cwd = process.cwd()) => {
  if (!d || !d.decision) throw new Error('a decision record needs a decision');
  if (d.contested && !String(d.minority || '').trim()) {
    throw new Error('a contested decision needs `minority` — a record with only the winning argument is a press release, not a record (P6)');
  }
  const row = {
    at: d.at || new Date().toISOString(),
    campaign: d.campaign || null,
    stage: d.stage || null,
    decision: d.decision,
    why: d.why || null,
    // Who argued which way. Recorded even when uncontested, because "nobody objected" is
    // itself worth being able to see later.
    for: [].concat(d.for || []),
    against: [].concat(d.against || []),
    contested: !!d.contested,
    minority: d.minority || null,
    alternatives: [].concat(d.alternatives || []),
    evidence: d.evidence || null,
    grade: d.grade || 'UNKNOWN',
    outcome: d.outcome || 'escalated_to_principal',
  };
  fs.mkdirSync(path.dirname(file(cwd)), { recursive: true });
  fs.appendFileSync(file(cwd), `${JSON.stringify(row)}\n`);
  return row;
};

export const readDecisions = (cwd = process.cwd()) => {
  const p = file(cwd);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
};

/**
 * Sequences of agents that keep working together, and how they turn out.
 *
 * Individual reliability answers "is this agent good"; it cannot answer "do these three work
 * well in this order", which is the question a repeated campaign shape actually poses. This
 * derives the shape from campaign ids already in the ledger — nothing extra to record, and
 * therefore nothing extra to forget to record.
 *
 * It refuses to call a pattern below `minRuns`. Two campaigns that happened to share a shape
 * is a coincidence, and promoting a coincidence into a standing routing rule is how a router
 * learns superstition.
 */
export const campaignPatterns = (rows, { minRuns = 3 } = {}) => {
  const byCampaign = {};
  for (const r of rows) {
    if (!r.campaign || r.corrupt || !r.agent || r.kind === 'spotcheck') continue;
    (byCampaign[r.campaign] ??= []).push(r);
  }
  const shapes = {};
  for (const [campaign, list] of Object.entries(byCampaign)) {
    const seq = [];
    for (const r of list) if (seq[seq.length - 1] !== r.agent) seq.push(r.agent);
    if (seq.length < 2) continue;
    const key = seq.join(' → ');
    const s = (shapes[key] ??= { sequence: seq, runs: 0, campaigns: [], ok: 0, failed: 0, tokens: 0 });
    s.runs += 1;
    s.campaigns.push(campaign);
    if (list.some((r) => r.outcome === 'fail')) s.failed += 1; else s.ok += 1;
    s.tokens += list.reduce((n, r) => n + (r.tokens || 0), 0);
  }
  return Object.values(shapes)
    .filter((s) => s.runs >= minRuns)
    .map((s) => ({ ...s, successRate: Number((s.ok / s.runs).toFixed(2)), avgTokens: Math.round(s.tokens / s.runs) }))
    .sort((a, b) => b.runs - a.runs || b.successRate - a.successRate);
};

/**
 * A post-mortem, composed from what was already recorded.
 *
 * Not a narrative — a narrative is what gets written instead of a fix. This is: what failed,
 * what it cost, what the Principal corrected, what claims did not survive spot-check, and
 * which items were never closed. Each line is traceable to a row.
 *
 * The playbook lines it proposes are PROPOSALS. They go through `forge evolve` like anything
 * else, because a lesson the organization applied to itself without being asked is a
 * self-modification, and Article 86 says no.
 */
export const postmortem = (campaign, cwd = process.cwd(), { rows = null, checklist = null } = {}) => {
  const all = rows || readLedger(cwd);
  const mine = all.filter((r) => r.campaign === campaign && !r.corrupt);
  if (!mine.length) return { campaign, found: false };

  const work = mine.filter((r) => r.kind !== 'spotcheck');
  const failures = work.filter((r) => r.outcome === 'fail');
  const blocked = work.filter((r) => r.outcome === 'blocked');
  const corrections = work.filter((r) => r.correction).map((r) => ({ agent: r.agent, text: r.correction }));
  const contradicted = mine.filter((r) => r.kind === 'spotcheck' && r.outcome === 'fail');
  const tokens = work.reduce((n, r) => n + (r.tokens || 0), 0);
  const wasted = failures.reduce((n, r) => n + (r.tokens || 0), 0);

  const lessons = [];
  for (const c of corrections) {
    lessons.push({ kind: 'instruction', agent: c.agent, change: c.text, why: `the Principal corrected ${c.agent} during ${campaign}` });
  }
  for (const f of failures) {
    const streak = derive(all).memory[f.agent]?.byClass?.[f.capability]?.consecutiveFailures || 0;
    if (streak >= 2) {
      lessons.push({ kind: 'routing', agent: f.agent, change: `de-prefer ${f.agent} for "${f.capability}" in this workspace`, why: `${streak} consecutive failures at ${f.capability}` });
    }
  }
  for (const c of contradicted) {
    lessons.push({ kind: 'instruction', agent: c.agent, change: `${c.agent} must name a checkable artifact with every EVIDENCE claim`, why: `a spot-check contradicted its claim: ${c.note}` });
  }

  // Two failures by the same agent at the same capability produce the same lesson twice, and
  // a proposal list with a repeat in it reads as two reasons when it is one. Dedupe on the
  // change text, keeping the first — which carries the lowest streak count and is therefore
  // the more conservative claim.
  const seen = new Set();
  const deduped = lessons.filter((l) => (seen.has(l.change) ? false : seen.add(l.change)));

  return {
    campaign,
    found: true,
    stages: work.length,
    tokens,
    wasted,
    wastedShare: tokens ? Number(((wasted / tokens) * 100).toFixed(1)) : 0,
    failures: failures.map((r) => ({ agent: r.agent, capability: r.capability, note: r.note })),
    blocked: blocked.map((r) => ({ agent: r.agent, capability: r.capability })),
    corrections,
    contradicted: contradicted.map((r) => ({ agent: r.agent, why: r.note })),
    openItems: checklist ? checklist.open.map((i) => i.text) : null,
    lessons: deduped,
    // The honest headline: a campaign with no failures, no corrections and no contradictions
    // does not need a post-mortem, and saying so beats generating a page of nothing.
    verdict: !failures.length && !corrections.length && !contradicted.length
      ? 'nothing went wrong that was recorded. Either it went well, or the ledger is thinner than the campaign was.'
      : `${failures.length} failure(s), ${corrections.length} correction(s), ${contradicted.length} contradicted claim(s)`,
  };
};
