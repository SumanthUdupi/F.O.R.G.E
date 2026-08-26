/**
 * Benchmarking — two different questions that both get called "benchmark".
 *
 * 1. WHICH AGENT IS GOOD AT WHAT (leaderboard, regression)
 *    Pure arithmetic over this workspace's own ledger. That is a better benchmark than any
 *    public leaderboard, because it is measured against the tasks this workspace actually
 *    runs rather than tasks nobody here will ever run. It costs nothing and needs no model.
 *
 * 2. DID THE LAST EDIT MAKE ROUTING WORSE (golden replay)
 *    A frozen set of requests with expected capabilities and gates, replayed after any change
 *    to roster.yaml / routing.yaml / contracts.yaml. Routing is deterministic and model-free,
 *    so this is a real regression test and not a sampling exercise. It is the thing that
 *    catches "I tweaked contracts.yaml and now nothing escalates on production release"
 *    BEFORE it ships.
 *
 * DELIBERATELY NOT HERE: any public multi-agent benchmark. SWE-bench and Terminal-Bench
 * measure the underlying model, not this routing and governance layer; AgentBench and GAIA
 * score neither auditability nor reversibility, which are the only things that make this
 * organization different from a for-loop over subagents. Chasing them would produce a number
 * that moves when the model changes and never when this repo does.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './core.mjs';
import { parse } from './yaml.mjs';
import { readLedger, derive } from './ledger.mjs';
import { composeVector } from './vector.mjs';

/**
 * The leaderboard: one row per agent per capability, sorted by reliability.
 *
 * `n` is printed beside every rate on purpose. A 1.0 over two observations and a 0.85 over
 * forty are not comparable, and a leaderboard that hides the sample size invites exactly
 * that comparison.
 */
export const leaderboard = (rows) => {
  const { memory } = derive(rows);
  const out = [];
  for (const [agent, m] of Object.entries(memory)) {
    for (const [capability, c] of Object.entries(m.byClass || {})) {
      out.push({
        agent,
        capability,
        reliability: c.rate,
        n: c.n,
        consecutiveFailures: c.consecutiveFailures,
        costPerTask: m.costPerTask,
        evidenceAccuracy: m.evidence ? m.evidence.accuracy : null,
      });
    }
    if (!Object.keys(m.byClass || {}).length) {
      out.push({ agent, capability: '(none)', reliability: m.reliability, n: m.n, consecutiveFailures: 0, costPerTask: m.costPerTask, evidenceAccuracy: m.evidence ? m.evidence.accuracy : null });
    }
  }
  return out.sort((a, b) => b.reliability - a.reliability || b.n - a.n);
};

/**
 * Regression: whose recent work is materially worse than their earlier work.
 *
 * Deliberately different from "who is below the de-preference floor". An agent at 0.80 and
 * falling is invisible to a threshold and obvious to a slope, and the slope is the one you
 * can still act on. Needs `window` observations in each half before it will say anything —
 * a bad first week must not read as a trend.
 */
export const regressions = (rows, { window = 10, drop = 0.15 } = {}) => {
  const byAgent = {};
  for (const r of rows) {
    if (r.corrupt || !r.agent || r.kind === 'spotcheck') continue;
    const w = { ok: 1, partial: 0.5, fail: 0 }[r.outcome];
    if (w === undefined) continue; // blocked is not the agent's fault
    (byAgent[r.agent] ??= []).push(w);
  }
  const out = [];
  for (const [agent, h] of Object.entries(byAgent)) {
    if (h.length < window * 2) continue;
    const first = h.slice(0, window).reduce((a, b) => a + b, 0) / window;
    const last = h.slice(-window).reduce((a, b) => a + b, 0) / window;
    if (first - last > drop) {
      out.push({ agent, first: Number(first.toFixed(3)), last: Number(last.toFixed(3)), delta: Number((last - first).toFixed(3)), n: h.length });
    }
  }
  return out.sort((a, b) => a.delta - b.delta);
};

export const GOLDEN_DIR = path.join(ROOT, 'tests', 'benchmarks');

export const loadGolden = (file) => {
  const p = path.isAbsolute(file) ? file : path.join(GOLDEN_DIR, file);
  return parse(fs.readFileSync(p, 'utf8'));
};

/**
 * Replay a golden routing file and report every expectation that no longer holds.
 *
 * Each case may assert any of:
 *   expect_capability   every named capability appears somewhere in the Vector
 *   expect_gate         this gate is crossed
 *   expect_no_gate      this gate is NOT crossed — the half people forget, and the half that
 *                       catches a gate that has quietly started firing on everything
 *   expect_mode         the effort mode the router chose
 *   expect_staffed      an agent that must appear
 *   expect_min_stages   the Vector is at least this long
 */
export const replayGolden = (cases, org, { memory = {} } = {}) => {
  const results = [];
  for (const c of cases) {
    const failures = [];
    let vector = null;
    try {
      vector = composeVector(c.request, org, { memory });
    } catch (e) {
      results.push({ request: c.request, ok: false, failures: [`routing threw: ${e.message}`] });
      continue;
    }
    const caps = new Set(vector.stages.flatMap((s) => String(s.capability || '').split('+')));
    // Both the id AND the title. A gate is `{id: 'GATE-RELEASE', title: 'Production release'}`,
    // and matching only the id made every human-readable expectation in the golden file fail
    // while the router was behaving perfectly — a fixture that cries wolf is worse than none.
    const gates = new Set((vector.gates || []).flatMap((g) => [g.id, g.title, g].filter((x) => typeof x === 'string')));
    const staffed = new Set(vector.stages.map((s) => s.agent));

    for (const want of c.expect_capability || []) {
      if (!caps.has(want)) failures.push(`capability "${want}" is no longer routed (got: ${[...caps].join(', ') || 'none'})`);
    }
    for (const want of [].concat(c.expect_gate || [])) {
      if (![...gates].some((g) => String(g).toLowerCase().includes(String(want).toLowerCase()))) {
        failures.push(`gate "${want}" no longer fires (got: ${[...gates].join(', ') || 'none'})`);
      }
    }
    for (const unwanted of [].concat(c.expect_no_gate || [])) {
      if ([...gates].some((g) => String(g).toLowerCase().includes(String(unwanted).toLowerCase()))) {
        failures.push(`gate "${unwanted}" has started firing on a request that should not cross it`);
      }
    }
    // `vector.mode` is a plain string ('direct' | 'focused' | 'standard' | 'campaign'), not
    // an object — checked against the real shape rather than assumed from the field name.
    if (c.expect_mode && vector.mode !== c.expect_mode) {
      failures.push(`mode is "${vector.mode}", expected "${c.expect_mode}"`);
    }
    for (const want of c.expect_staffed || []) {
      if (!staffed.has(want)) failures.push(`${want} is no longer staffed (got: ${[...staffed].join(', ')})`);
    }
    if (c.expect_min_stages && vector.stages.length < c.expect_min_stages) {
      failures.push(`${vector.stages.length} stages, expected at least ${c.expect_min_stages}`);
    }
    results.push({ request: c.request, ok: failures.length === 0, failures, stages: vector.stages.length });
  }
  return { results, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
};

export const benchmarkReport = (cwd = process.cwd()) => {
  const rows = readLedger(cwd);
  return { board: leaderboard(rows), regressions: regressions(rows), observations: rows.length };
};
