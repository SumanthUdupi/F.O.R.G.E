/**
 * The evolution layer, tested by trying to break out of it.
 *
 * The claim this repository makes is that the organization adapts to a workspace and cannot
 * modify itself. Both halves need proving, and the second half needs proving the way a
 * guardrail is proved: by attacking it. A boundary nobody tried to cross is a boundary
 * whose state is unknown.
 */

import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load } from '../scripts/core.mjs';
import { observe, readLedger, derive } from '../scripts/ledger.mjs';
import { isForbidden, FORBIDDEN, propose, applyProposal, profileWorkspace, loadOverlay, CAP } from '../scripts/learn.mjs';
import { selectAgents } from '../scripts/router.mjs';

const org = load();
let ws;
beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-ws-'));
});
after(() => {});

describe('the ledger refuses what it cannot attribute', () => {
  test('an observation with no agent is rejected, not stored as unknown', () => {
    // A ledger of unattributable rows looks like data and teaches nothing.
    assert.throws(() => observe({ capability: 'backend', outcome: 'ok' }, ws), /agent/);
  });
  test('an invented outcome is rejected', () => {
    assert.throws(() => observe({ agent: 'a', capability: 'b', outcome: 'great' }, ws), /outcome/);
  });
  test('a corrupt line does not destroy the history around it', () => {
    observe({ agent: 'a', capability: 'b', outcome: 'ok', at: 'T1' }, ws);
    fs.appendFileSync(path.join(ws, '.forge', 'ledger.jsonl'), '{not json\n');
    observe({ agent: 'a', capability: 'b', outcome: 'ok', at: 'T2' }, ws);
    assert.equal(derive(readLedger(ws)).observations, 2);
  });
});

describe('derivation is a pure function of the rows', () => {
  test('the same ledger derives the same memory, twice', () => {
    for (const o of ['ok', 'fail', 'partial']) observe({ agent: 'x', capability: 'c', outcome: o, at: o }, ws);
    const rows = readLedger(ws);
    assert.deepEqual(derive(rows), derive(rows));
  });

  test('an unmeasured agent is not treated as proven', () => {
    observe({ agent: 'x', capability: 'c', outcome: 'ok', at: 'T' }, ws);
    // One success must not read as 100%. The prior is worth four observations.
    assert.ok(derive(readLedger(ws)).memory.x.reliability < 0.85);
  });

  test('a blocked outcome is not counted against the agent', () => {
    observe({ agent: 'x', capability: 'c', outcome: 'blocked', at: 'T' }, ws);
    assert.equal(derive(readLedger(ws)).memory.x.n, 0, 'being blocked was scored as a failure');
  });

  test('a consecutive-failure streak resets on any success', () => {
    observe({ agent: 'x', capability: 'c', outcome: 'fail', at: '1' }, ws);
    observe({ agent: 'x', capability: 'c', outcome: 'fail', at: '2' }, ws);
    observe({ agent: 'x', capability: 'c', outcome: 'ok', at: '3' }, ws);
    assert.equal(derive(readLedger(ws)).memory.x.byClass.c.consecutiveFailures, 0);
  });
});

describe('measured failure actually changes who is staffed', () => {
  test('an agent that keeps failing a class loses that class', () => {
    // The entire claim of the learning layer, end to end and with no model involved.
    const cold = selectAgents(['backend'], org, {}).staffed[0].agent.name;
    for (let i = 0; i < 5; i += 1) observe({ agent: cold, capability: 'backend', outcome: 'fail', at: `t${i}` }, ws);
    const memory = derive(readLedger(ws)).memory;
    const warm = selectAgents(['backend'], org, memory).staffed[0].agent.name;
    assert.notEqual(warm, cold, 'five recorded failures did not move the route');
  });
});

describe('evolution cannot modify the organization', () => {
  test('every forbidden prefix is refused', () => {
    for (const f of FORBIDDEN) assert.ok(isForbidden(`${f}anything.yaml`), `${f} is not enforced`);
  });

  test('the constitution, the roster and the scripts are all out of reach', () => {
    for (const t of ['charter/constitution.yaml', 'registry/roster.yaml', 'registry/routing.yaml', 'scripts/learn.mjs', 'agents/chair.md', 'skills/forge/SKILL.md']) {
      assert.ok(isForbidden(t), `${t} was writable`);
    }
  });

  test('path traversal and absolute paths are refused', () => {
    for (const t of ['../../etc/passwd', '/etc/passwd', '.forge/../registry/roster.yaml']) {
      assert.ok(isForbidden(t), `${t} escaped the workspace`);
    }
  });

  test('applyProposal throws rather than writing outside the workspace', () => {
    assert.throws(() => applyProposal({ id: 'P1', target: 'charter/constitution.yaml', kind: 'x', change: 'y', observation: 'z', grade: 'EVIDENCE' }, ws), /refusing/);
  });

  test('only .forge/ is written when a proposal is applied', () => {
    const before = fs.readdirSync(ws);
    applyProposal({ id: 'P1', target: '.forge/overlay.yaml', kind: 'profile', change: 'pin the test command', observation: 'detected', grade: 'EVIDENCE', body: ['npm test'] }, ws);
    const after = fs.readdirSync(ws).filter((f) => !before.includes(f));
    assert.deepEqual(after, ['.forge']);
  });
});

describe('adaptation is reversible and readable back', () => {
  test('applying records the prior state so it can be withdrawn', () => {
    applyProposal({ id: 'P1', target: '.forge/overlay.yaml', kind: 'profile', change: 'first', observation: 'o', grade: 'EVIDENCE' }, ws);
    applyProposal({ id: 'P2', target: '.forge/overlay.yaml', kind: 'profile', change: 'second', observation: 'o', grade: 'EVIDENCE' }, ws);
    const undo = fs.readFileSync(path.join(ws, '.forge', 'applied.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(undo.length, 2);
    assert.equal(undo[0].undo.restore, '', 'the first application recorded no prior state');
    assert.match(undo[1].undo.restore, /first/, 'the second application did not record what it replaced');
  });

  test('what was applied parses back as YAML this repo can read', () => {
    applyProposal({ id: 'P1', target: '.forge/overlay.yaml', kind: 'routing', change: 'de-prefer x', observation: 'measured', grade: 'EVIDENCE', agent: 'backend-engineer' }, ws);
    const o = loadOverlay(ws);
    assert.equal(o.adaptations.length, 1);
    assert.equal(o.adaptations[0].agent, 'backend-engineer');
  });
});

describe('proposals are capped and evidenced', () => {
  test('never more than the declared cap, however much evidence there is', () => {
    for (let i = 0; i < 40; i += 1) {
      observe({ agent: 'backend-engineer', capability: 'backend', outcome: 'fail', correction: `fix ${i}`, at: `t${i}` }, ws);
      observe({ agent: 'frontend-engineer', capability: 'frontend', outcome: 'fail', correction: `fix ${i}`, at: `u${i}` }, ws);
      observe({ agent: 'data-engineer', capability: 'data', outcome: 'fail', correction: `fix ${i}`, at: `v${i}` }, ws);
      observe({ agent: 'test-engineer', capability: 'test', outcome: 'fail', correction: `fix ${i}`, at: `w${i}` }, ws);
    }
    const r = propose(org, { rows: readLedger(ws), profile: profileWorkspace(ws) });
    assert.ok(r.proposals.length <= CAP.proposals, `${r.proposals.length} proposals exceeds the cap`);
    const agents = new Set(r.proposals.map((p) => p.agent).filter(Boolean));
    assert.ok(agents.size <= CAP.agents, `${agents.size} agents touched exceeds the cap`);
  });

  test('every proposal carries the observation that produced it', () => {
    for (let i = 0; i < 6; i += 1) observe({ agent: 'backend-engineer', capability: 'backend', outcome: 'fail', correction: 'bound the query', at: `t${i}` }, ws);
    for (const p of propose(org, { rows: readLedger(ws), profile: profileWorkspace(ws) }).proposals) {
      assert.ok(p.observation, `${p.id} proposes a change with no evidence behind it`);
      assert.ok(['EVIDENCE', 'INFERENCE', 'UNKNOWN'].includes(p.grade), `${p.id} is ungraded`);
    }
  });

  test('a quiet workspace produces few or no proposals', () => {
    // Not every run should produce a change. An evolution layer that always has something
    // to say trains the Principal to approve without reading.
    const r = propose(org, { rows: [], profile: { testCommand: { grade: 'UNKNOWN' }, indent: { grade: 'UNKNOWN' } } });
    assert.equal(r.proposals.length, 0);
  });
});

describe('the workspace profile grades itself', () => {
  test('an empty directory reports UNKNOWN rather than omitting fields', () => {
    const p = profileWorkspace(ws);
    assert.equal(p.testCommand.grade, 'UNKNOWN');
    assert.ok(p.testCommand.why, 'UNKNOWN with no reason is not a finding');
    assert.equal(p.stacks.value.length, 0);
  });

  test('a declared test script is EVIDENCE, an inferred one is not', () => {
    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }));
    const p = profileWorkspace(ws);
    assert.equal(p.testCommand.grade, 'EVIDENCE');
    assert.match(p.testCommand.why, /vitest/);
  });

  test('a python project with no declared runner is INFERENCE, not EVIDENCE', () => {
    fs.writeFileSync(path.join(ws, 'pyproject.toml'), '[project]\nname="x"\n');
    assert.equal(profileWorkspace(ws).testCommand.grade, 'INFERENCE');
  });
});

describe('standing instructions can expire', () => {
  test('an expired adaptation is lapsed, a dateless one is permanent, a future one is live', async () => {
    const { isExpired } = await import('../scripts/learn.mjs');
    assert.equal(isExpired({ change: 'x' }), false, 'no date means permanent — the right default');
    assert.equal(isExpired({ change: 'x', expires: '2020-01-01' }), true);
    assert.equal(isExpired({ change: 'x', expires: '2099-01-01' }), false);
    assert.equal(isExpired({ change: 'x', expires: 'not a date' }), false, 'an unparseable date must not silently lapse an instruction');
  });

  test('an expired instruction is KEPT in the overlay but never reaches an agent', async () => {
    const { applyProposal, loadOverlay, briefing } = await import('../scripts/learn.mjs');
    const { load } = await import('../scripts/core.mjs');
    const fsx = await import('node:fs');
    const osx = await import('node:os');
    const pathx = await import('node:path');
    const d = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'forge-exp-'));

    applyProposal({ id: 'I1', kind: 'instruction', target: '.forge/overlay.yaml', change: 'live rule', observation: 'o', grade: 'UNKNOWN' }, d);
    const first = fsx.readFileSync(pathx.join(d, '.forge', 'overlay.yaml'), 'utf8');
    fsx.writeFileSync(pathx.join(d, '.forge', 'overlay.yaml'), `${first}  - id: I2\n    kind: instruction\n    change: "lapsed rule"\n    observation: "o"\n    grade: UNKNOWN\n    expires: 2020-01-01\n`);

    // Kept in the record — deleting it would make a past decision unexplainable.
    assert.equal((loadOverlay(d).adaptations || []).length, 2);

    // And absent from what an agent is told, because the header says "IN FORCE HERE".
    // briefing(org, cwd) — org first. Passing the directory alone silently briefed THIS
    // repo's own workspace, which is a test that would have passed for the wrong reason.
    const text = briefing(load(), d) || '';
    assert.ok(text.includes('live rule'), 'the live instruction did not reach the briefing');
    assert.ok(!text.includes('lapsed rule'), 'a lapsed instruction was injected under a header claiming it is in force');
  });
});
