/**
 * Routing and Vector composition.
 *
 * The properties that matter are the ones about being WRONG:
 *   - a Vector that writes and does not verify must not be producible;
 *   - a cap must never silently remove the verification or the brief;
 *   - two writers must never share a batch;
 *   - a gate must fire on the destructive phrasing and stay silent on the innocent one.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../scripts/core.mjs';
import { detectMode, matchGates, scoreAgent, selectAgents, hits } from '../scripts/router.mjs';
import { composeVector, batch, PHASES } from '../scripts/vector.mjs';

const org = load();
const plan = (q, opts) => composeVector(q, org, opts);

describe('matching is on words, not substrings', () => {
  test('"index" does not match inside "indexed"', () => {
    assert.ok(hits('add an index here', 'index'));
    assert.ok(!hits('the rows are indexedly stored', 'index'));
  });
});

describe('effort mode', () => {
  test('the highest matching mode wins', () => {
    // Under-planning a campaign costs a rebuild; over-planning a typo costs one dispatch.
    // The asymmetry is why this is a max and not a first-match.
    assert.equal(detectMode('add a new module from scratch', org.routing).mode, 'campaign');
  });

  test('direct survives only when nothing else matched', () => {
    assert.equal(detectMode('what is the test command', org.routing).mode, 'direct');
    assert.notEqual(detectMode('what is slow about the import job, fix the query', org.routing).mode, 'direct');
  });

  test('an explicit instruction from the Principal wins', () => {
    assert.equal(detectMode('rename a label', org.routing, 'campaign').mode, 'campaign');
  });
});

describe('gates', () => {
  const fires = (q) => matchGates(q, org.constitution.gates).length > 0;

  test('destructive phrasings fire', () => {
    for (const q of ['force push the develop branch', 'drop table audit_log', 'deploy to production', 'rotate the api key']) {
      assert.ok(fires(q), `no gate on: ${q}`);
    }
  });

  test('innocent phrasings do not', () => {
    // A gate that fires on everything is a gate nobody reads.
    for (const q of ['drop the trailing comma', 'the production numbers look wrong in the report', 'rename a variable']) {
      assert.ok(!fires(q), `spurious gate on: ${q}`);
    }
  });
});

describe('a Vector that writes must verify', () => {
  test('a writing plan with no verify keyword still gets a correctness check', () => {
    const v = plan('rename the label on the settings form');
    assert.ok(v.stages.some((s) => s.writes), 'nothing writes; wrong fixture');
    assert.ok(v.stages.some((s) => /review|test/.test(s.capability)), 'a writing Vector produced no correctness check');
  });

  test('an accessibility audit does not count as the correctness check', () => {
    // It sits in the verify phase and answers a different question. Treating its presence
    // as verification let a writing Vector through with nothing checking correctness.
    const v = plan('adjust the contrast on the settings form');
    const a11yOnly = v.stages.filter((s) => s.phase === 'verify').every((s) => s.capability === 'a11y');
    assert.ok(!a11yOnly || !v.stages.some((s) => s.writes));
  });

  test('a read-only plan is not forced to verify nothing', () => {
    const v = plan('explain how the routing score is calculated');
    assert.equal(v.stages.filter((s) => s.rule === 'R-VERIFY-WRITES').length, 0);
  });
});

describe('caps are honest', () => {
  test('what a cap removed is reported, never silently dropped', () => {
    const v = plan('build and integrate and deploy and document a reporting module with a dashboard', { mode: 'focused' });
    if (v.dropped.length) for (const d of v.dropped) assert.ok(d.why, 'a stage was dropped with no reason given');
  });

  test('a cap cannot remove the frame or the brief', () => {
    const v = plan('build and integrate and deploy and document a reporting module', { mode: 'focused' });
    assert.ok(v.stages.some((s) => s.rule === 'R-INTENT'), 'the cap removed the frame');
    assert.ok(v.stages.some((s) => s.rule === 'R-REPORT'), 'the cap removed the Principal brief');
  });
});

describe('batching is about write sets, not ambition', () => {
  test('two writers never share a batch', () => {
    for (const q of ['build a dashboard and an api endpoint and a migration', 'implement the frontend and the backend and the integration']) {
      const v = plan(q);
      for (const b of v.batches) {
        const writers = b.stages.map((id) => v.stages.find((s) => s.id === id)).filter((s) => s.writes);
        assert.ok(writers.length <= 1, `${writers.length} writers batched together on: ${q}`);
      }
    }
  });

  test('readers batch freely', () => {
    const b = batch([{ writes: false }, { writes: false }, { writes: false }], 6);
    assert.equal(b.length, 1);
  });

  test('stage ids run in execution order', () => {
    const v = plan('build a reporting module and deploy it');
    const order = v.stages.map((s) => PHASES.indexOf(s.phase));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), 'phases are out of order');
    assert.deepEqual(v.stages.map((s) => s.id), v.stages.map((_, i) => `S${String(i + 1).padStart(2, '0')}`));
  });
});

describe('the routing score', () => {
  test('a manager is never staffed — RULE 005, enforced where it matters', () => {
    for (const q of ['build an api', 'review the diff', 'deploy to staging']) {
      for (const s of plan(q).stages) {
        assert.notEqual(org.byName.get(s.agent).role, 'manager', `${s.agent} was staffed`);
      }
    }
  });

  test('an unmeasured agent gets the prior, not a perfect score', () => {
    const s = scoreAgent(org.byName.get('backend-engineer'), 'backend', org, {});
    assert.ok(s.parts.reliability < 1, 'an unmeasured agent scored as proven');
  });

  test('consecutive failures on a class push an agent down, on that class only', () => {
    const memory = { 'backend-engineer': { reliability: 0.3, n: 5, byClass: { backend: { rate: 0.3, consecutiveFailures: 4 } } } };
    const cold = selectAgents(['backend'], org, {}).staffed[0].agent.name;
    const warm = selectAgents(['backend'], org, memory).staffed[0].agent.name;
    assert.equal(cold, 'backend-engineer', 'fixture assumption changed');
    assert.notEqual(warm, 'backend-engineer', 'measured failure did not change the route');
  });

  test('cost alone never decides — Article 145', () => {
    // The lean tier is worth 0.10 at most. A lean agent cannot outrank a standard one on
    // capability match alone, or the organization would optimise itself into cheap wrong answers.
    const w = org.routing.score;
    assert.ok(w.cost_efficiency < w.capability_match, 'cost outweighs capability');
    assert.ok(w.cost_efficiency <= 0.15, 'cost is weighted heavily enough to decide alone');
  });

  test('one agent satisfying two capabilities is convened once', () => {
    const { staffed } = selectAgents(['review', 'security'], org, {});
    assert.equal(new Set(staffed.map((s) => s.agent.id)).size, staffed.length);
  });
});

describe('regressions found by running the planner on a real request', () => {
  // "add rate limiting to the public api and deploy it" produced a FOCUSED plan with no
  // release gate, and the cap then trimmed the security review and the release stage off a
  // request that says "public" and "deploy". Three separate holes in one sentence.

  test('a bare "deploy" fires the release gate', () => {
    assert.ok(matchGates('add rate limiting and deploy it', org.constitution.gates).some((g) => g.id === 'GATE-RELEASE'));
  });

  test('a crossed gate raises the effort mode floor to standard', () => {
    const v = plan('add rate limiting to the public api and deploy it');
    assert.ok(['standard', 'campaign'].includes(v.mode), `a gated request planned as ${v.mode}`);
    assert.match(v.modeWhy, /raised to standard/);
  });

  test('a cap can never remove the stage a gate is attached to', () => {
    const v = plan('deploy the api and document it and migrate the schema', { mode: 'focused' });
    if (v.gates.length) {
      assert.ok(v.stages.some((s) => s.gate), 'the cap deleted the gated stage and the gate with it');
    }
  });

  test('a security review, once raised, survives the cap', () => {
    const v = plan('change the permission check on the public endpoint and document it', { mode: 'focused' });
    assert.ok(v.stages.some((s) => s.capability === 'security'), 'the security review was trimmed away');
  });

  test('widening the gate vocabulary did not make it fire on everything', () => {
    for (const q of ['drop the trailing comma', 'rename a variable', 'explain the scoring weights']) {
      assert.equal(matchGates(q, org.constitution.gates).length, 0, `spurious gate on: ${q}`);
    }
  });
});
