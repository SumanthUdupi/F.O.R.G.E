/**
 * The mechanisms added because a rule that nothing evaluates is a comment with a serial
 * number: circuit breakers, the checkable principles, evidence spot-checking, and the
 * completion checklist.
 *
 * Every test here works the way this repo's doctor tests work — by PLANTING A VIOLATION and
 * asserting the mechanism catches it. A test that only exercises the happy path proves the
 * code runs; it does not prove the code would ever say no, and saying no is the entire
 * reason these files exist.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BREAKERS, trippedBreakers, exceedsRounds, reuseBeforeBuild, dissentPreserved, campaignLeftARecord } from '../scripts/breakers.mjs';
import { parseArtifact, checkArtifact, spotCheck, spotCheckCampaign, recordSpotChecks } from '../scripts/verify.mjs';
import { decompose, splitClauses, writeChecklist, markItem, checklistComplete, readChecklist } from '../scripts/checklist.mjs';
import { observe, readLedger, derive, derivedMemory, invalidateMemory, flatHandoff, parseFlatHandoff } from '../scripts/ledger.mjs';
import { load, resolveContract } from '../scripts/core.mjs';
import { selectAgents } from '../scripts/router.mjs';
import { leaderboard, regressions, replayGolden, loadGolden } from '../scripts/benchmark.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'forge-enf-'));
const org = load();

describe('circuit breakers actually trip', () => {
  test('a breaker under its limit does not fire, and one over it does', () => {
    assert.equal(BREAKERS.rounds({ rounds: 3 }, 3).tripped, false, '3 rounds is the limit, not past it');
    assert.equal(BREAKERS.rounds({ rounds: 4 }, 3).tripped, true);
    assert.equal(exceedsRounds({ rounds: 4 }, 3), true);
  });

  test('every breaker names STOP -> REPORT -> ESCALATE, because Article 76 forbids continuing quietly', () => {
    for (const [name, fn] of Object.entries(BREAKERS)) {
      const v = fn({}, 0);
      assert.match(v.action, /STOP -> REPORT -> ESCALATE/, `${name} does not state the required action`);
      assert.equal(v.breaker, name);
    }
  });

  test('tasks and width count a list, not just a number — the shape a campaign actually holds', () => {
    assert.equal(BREAKERS.tasks_per_campaign({ tasks: new Array(25) }, 24).tripped, true);
    assert.equal(BREAKERS.parallel_width({ batch: new Array(7) }, 6).tripped, true);
    assert.equal(BREAKERS.parallel_width({ batch: new Array(6) }, 6).tripped, false);
  });

  test('trippedBreakers reports only what fired, against the constitution\'s own limits', () => {
    const limits = org.constitution.circuit_breakers;
    const fired = trippedBreakers({ rounds: 99, batch: new Array(2) }, limits);
    assert.equal(fired.length, 1);
    assert.equal(fired[0].breaker, 'rounds');
  });

  test('the constitution declares no breaker without a predicate', () => {
    for (const name of Object.keys(org.constitution.circuit_breakers || {})) {
      assert.ok(BREAKERS[name], `${name} is declared in the constitution and implemented nowhere`);
    }
  });
});

describe('the three checkable principles', () => {
  test('P3 — writing without searching the Archives is caught, and not-writing is not', () => {
    assert.equal(reuseBeforeBuild({ wrote: false }).held, true, 'a campaign that wrote nothing cannot rediscover anything');
    assert.equal(reuseBeforeBuild({ wrote: true, searchedArchives: false }).held, false);
    assert.equal(reuseBeforeBuild({ wrote: true, searchedArchives: true }).held, true);
  });

  test('P3 — unrecorded is null, not false. "I could not tell" is a different claim from "no"', () => {
    assert.equal(reuseBeforeBuild({ wrote: true }).held, null);
  });

  test('P6 — a contested decision with no minority position is a destroyed record', () => {
    assert.equal(dissentPreserved({ decisions: [{ contested: true, minority: '' }] }).held, false);
    assert.equal(dissentPreserved({ decisions: [{ contested: true, minority: 'the Ledger argued the cost was not earned' }] }).held, true);
    assert.equal(dissentPreserved({ decisions: [{ contested: false }] }).held, true, 'an uncontested decision has no dissent to preserve');
  });

  test('P10 — a campaign that recorded nothing and gave no reason fails; one that explained itself does not', () => {
    assert.equal(campaignLeftARecord({ observations: 0 }).held, false);
    assert.equal(campaignLeftARecord({ observations: 0, whyNoRecord: 'refused at the gate before any agent ran' }).held, true);
    assert.equal(campaignLeftARecord({ observations: 3 }).held, true);
  });
});

describe('evidence spot-checking — RULE 013', () => {
  test('an artifact reference parses with or without a line, and a trailing note is prose not path', () => {
    assert.deepEqual(parseArtifact('src/a.ts:42').file, 'src/a.ts');
    assert.equal(parseArtifact('src/a.ts:42').line, 42);
    assert.equal(parseArtifact('src/a.ts').line, null);
    assert.equal(parseArtifact('src/a.ts:42 (new endpoint POST /v2/users)').file, 'src/a.ts');
  });

  test('a claim naming a file that does not exist is CONTRADICTED, not merely unverified', () => {
    const d = tmp();
    assert.equal(checkArtifact('nope.ts:1', d).verdict, 'contradicted');
  });

  test('a claim naming a line past the end of a real file is contradicted too', () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'a.ts'), 'one\ntwo\n');
    assert.equal(checkArtifact('a.ts:2', d).verdict, 'confirmed');
    assert.equal(checkArtifact('a.ts:900', d).verdict, 'contradicted');
  });

  test('an artifact pointing outside the workspace is refused, never followed', () => {
    const d = tmp();
    const r = checkArtifact('../../../etc/passwd', d);
    assert.equal(r.verdict, 'unverifiable');
    assert.match(r.why, /outside the workspace/);
  });

  test('"none" is a valid ARTIFACTS answer and must not read as a false claim', () => {
    assert.equal(checkArtifact('none', tmp()).verdict, 'unverifiable');
  });

  test('only EVIDENCE is checked — INFERENCE is already telling the truth about itself', () => {
    const d = tmp();
    assert.equal(spotCheck({ grade: 'INFERENCE', artifacts: ['nope.ts:1'] }, { cwd: d }).verdict, 'unverifiable');
    assert.equal(spotCheck({ grade: 'EVIDENCE', artifacts: ['nope.ts:1'] }, { cwd: d }).verdict, 'contradicted');
  });

  test('a claim that tests pass is unverifiable without a runner, and checkable with one', () => {
    const d = tmp();
    const row = { grade: 'EVIDENCE', note: 'the tests pass', agent: 'test-engineer', capability: 'test' };
    assert.equal(spotCheck(row, { cwd: d }).verdict, 'unverifiable');
    assert.equal(spotCheck(row, { cwd: d, run: () => ({ code: 0, command: 'npm test' }) }).verdict, 'confirmed');
    assert.equal(spotCheck(row, { cwd: d, run: () => ({ code: 1, command: 'npm test' }) }).verdict, 'contradicted');
  });

  test('a spot-check moves evidence accuracy and leaves reliability alone', () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'real.ts'), 'x\n');
    observe({ agent: 'liar', capability: 'backend', outcome: 'ok', grade: 'EVIDENCE', artifacts: ['ghost.ts:1'], campaign: 'C1' }, d);
    observe({ agent: 'honest', capability: 'backend', outcome: 'ok', grade: 'EVIDENCE', artifacts: ['real.ts:1'], campaign: 'C1' }, d);

    const before = derive(readLedger(d)).memory;
    assert.equal(before.liar.reliability, before.honest.reliability, 'both did one successful task; task reliability must be identical');

    const report = spotCheckCampaign('C1', { cwd: d });
    assert.equal(report.tally.confirmed, 1);
    assert.equal(report.tally.contradicted, 1);
    recordSpotChecks(report, d);

    const after = derive(readLedger(d)).memory;
    assert.equal(after.liar.reliability, before.liar.reliability, 'a spot-check must never move task reliability');
    assert.ok(after.liar.evidence.accuracy < after.honest.evidence.accuracy, 'the false claim must be visible somewhere');
  });

  test('unverifiable verdicts are not written — they would drag every agent toward the prior for no reason', () => {
    const d = tmp();
    observe({ agent: 'quiet', capability: 'x', outcome: 'ok', grade: 'INFERENCE', campaign: 'C2' }, d);
    const written = recordSpotChecks(spotCheckCampaign('C2', { cwd: d }), d);
    assert.equal(written, 0);
  });
});

describe('the completion checklist — RULE 014', () => {
  test('a comma-joined list of imperatives is several asks, not one', () => {
    const items = decompose('make it compact, reduce the tabs, and also combine the overview into the change tab');
    assert.equal(items.length, 3, `expected 3 items, got ${items.length}: ${JSON.stringify(items)}`);
  });

  test('prose with a comma in it is NOT split — a spurious item is noise, but shredding a sentence is worse', () => {
    assert.equal(decompose('the quick, brown fox jumped over the lazy dog').length, 1);
    assert.equal(splitClauses('a small, careful change to the parser').length, 1);
  });

  test('an explicit list wins over sentence rules — the author already marked the boundaries', () => {
    assert.equal(decompose('1. add the index\n2. fix the flaky test\n3. document the gate').length, 3);
    assert.equal(decompose('- one thing\n- another thing').length, 2);
  });

  test('completion is refused while any item is PENDING, and BLOCKED counts as answered', () => {
    const d = tmp();
    writeChecklist('C', ['do a', 'do b'], d);
    assert.equal(checklistComplete('C', d).complete, false);
    markItem('C', '1', 'SUCCESS', { evidence: 'x.ts:1', cwd: d });
    assert.equal(checklistComplete('C', d).complete, false, 'one of two is PARTIAL, never SUCCESS');
    markItem('C', '2', 'BLOCKED', { cwd: d });
    assert.equal(checklistComplete('C', d).complete, true, 'BLOCKED with a reason is a finished conversation');
  });

  test('SUCCESS without evidence is refused — that is the exact claim this file exists to stop', () => {
    const d = tmp();
    writeChecklist('C', ['do a'], d);
    assert.throws(() => markItem('C', '1', 'SUCCESS', { cwd: d }), /evidence/);
  });

  test('a checklist with progress is not silently clobbered', () => {
    const d = tmp();
    writeChecklist('C', ['do a'], d);
    markItem('C', '1', 'FAILED', { cwd: d });
    assert.throws(() => writeChecklist('C', ['something else'], d), /already has progress/);
    assert.equal(readChecklist('C', d).items[0].status, 'FAILED');
  });

  test('a missing checklist is incomplete, not complete — absence is not permission to close', () => {
    assert.equal(checklistComplete('never-created', tmp()).complete, false);
  });
});

describe('the ledger cache is a memo, never an authority', () => {
  test('a new observation is visible immediately — a stale memory is worse than none', () => {
    const d = tmp();
    observe({ agent: 'a', capability: 'x', outcome: 'ok' }, d);
    assert.equal(derivedMemory(d).memory.a.n, 1);
    observe({ agent: 'a', capability: 'x', outcome: 'fail' }, d);
    assert.equal(derivedMemory(d).memory.a.n, 2, 'the cache served a memory older than the newest row');
  });

  test('the cached derivation is byte-identical to the uncached one', () => {
    const d = tmp();
    for (let i = 0; i < 5; i += 1) observe({ agent: 'a', capability: 'x', outcome: 'ok', tokens: 100 }, d);
    const direct = derive(readLedger(d));
    assert.deepEqual(derivedMemory(d, { force: true }), direct);
    assert.deepEqual(derivedMemory(d), direct, 'the cached read disagreed with the computation');
  });

  test('deleting the cache file is always safe', () => {
    const d = tmp();
    observe({ agent: 'a', capability: 'x', outcome: 'ok' }, d);
    derivedMemory(d);
    fs.unlinkSync(path.join(d, '.forge', '.memory-cache.json'));
    invalidateMemory(d);
    assert.equal(derivedMemory(d).memory.a.n, 1);
  });
});

describe('the ledger row carries what a claim needs to be checkable', () => {
  test('v1 rows without the new fields still derive', () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, '.forge'), { recursive: true });
    fs.writeFileSync(path.join(d, '.forge', 'ledger.jsonl'), `${JSON.stringify({ at: '2026-01-01', agent: 'old', capability: 'x', outcome: 'ok', tokens: 5 })}\n`);
    const m = derive(readLedger(d)).memory;
    assert.equal(m.old.n, 1);
    assert.equal(m.old.tokens, 5);
  });

  test('a bad kind is refused rather than stored', () => {
    assert.throws(() => observe({ agent: 'a', capability: 'x', outcome: 'ok', kind: 'nonsense' }, tmp()), /kind must be one of/);
  });

  test('downtrend needs 20 observations before it will call a slope', () => {
    const d = tmp();
    for (let i = 0; i < 10; i += 1) observe({ agent: 'a', capability: 'x', outcome: 'ok' }, d);
    assert.equal(derive(readLedger(d)).memory.a.trend, undefined, '10 observations is not a trend');
    for (let i = 0; i < 10; i += 1) observe({ agent: 'a', capability: 'x', outcome: 'fail' }, d);
    assert.equal(derive(readLedger(d)).memory.a.trend.downtrend, true);
  });

  test('cost per capability separates a hard capability from an expensively staffed one', () => {
    const d = tmp();
    observe({ agent: 'a', capability: 'cheap', outcome: 'ok', tokens: 100 }, d);
    observe({ agent: 'b', capability: 'dear', outcome: 'ok', tokens: 9000 }, d);
    const { capability } = derive(readLedger(d));
    assert.equal(capability.cheap.costPerTask, 100);
    assert.equal(capability.dear.costPerTask, 9000);
    assert.equal(capability.dear.staffedBy, 1);
  });

  test('a hypothesis is tallied as supported or refuted', () => {
    const d = tmp();
    observe({ agent: 'a', capability: 'x', outcome: 'ok', hypothesis: 'cache invalidation is the bottleneck' }, d);
    observe({ agent: 'a', capability: 'x', outcome: 'fail', hypothesis: 'cache invalidation is the bottleneck' }, d);
    const h = derive(readLedger(d)).hypotheses['cache invalidation is the bottleneck'];
    assert.deepEqual({ n: h.n, supported: h.supported, refuted: h.refuted }, { n: 2, supported: 1, refuted: 1 });
  });
});

describe('the flat handoff format', () => {
  test('round-trips, and a delimiter inside a value cannot forge a field', () => {
    const row = { task: 'T4', agent: 'a', capability: 'backend', outcome: 'ok', grade: 'EVIDENCE', artifacts: ['src/a.ts:42'], campaign: 'C1' };
    const parsed = parseFlatHandoff(flatHandoff(row));
    assert.equal(parsed.status, 'SUCCESS');
    assert.equal(parsed.artifact, 'src/a.ts:42');
    const evil = parseFlatHandoff(flatHandoff({ ...row, campaign: 'C1|status=FAILED' }));
    assert.equal(evil.status, 'SUCCESS', 'a value containing the delimiter forged a field');
  });
});

describe('the capability index is a performance change and nothing else', () => {
  test('indexed and unindexed routing produce identical rankings', () => {
    const caps = [...new Set(org.all.filter((a) => a.role === 'specialist').flatMap((a) => a.capabilities || []))];
    const memory = { 'backend-engineer': { reliability: 0.9, byClass: { backend: { rate: 0.95, n: 9, consecutiveFailures: 0 } } } };
    const withIndex = selectAgents(caps, org, memory);
    // Same org, index removed — the fallback path this must agree with.
    const noIndex = selectAgents(caps, { ...org, byCapability: undefined }, memory);
    assert.deepEqual(
      withIndex.staffed.map((s) => [s.agent.id, s.score]),
      noIndex.staffed.map((s) => [s.agent.id, s.score]),
      'the index changed which agent was chosen — that is a routing change, not a cache',
    );
    assert.deepEqual(
      withIndex.considered.map((c) => [c.capability, c.runnersUp.map((r) => r.agent.id)]),
      noIndex.considered.map((c) => [c.capability, c.runnersUp.map((r) => r.agent.id)]),
      'runners-up diverged',
    );
  });

  test('the index holds specialists only — managers route, they are never staffed', () => {
    for (const [, holders] of org.byCapability) {
      for (const a of holders) assert.equal(a.role, 'specialist', `${a.name} is in the capability index and is a ${a.role}`);
    }
  });
});

describe('benchmarking', () => {
  test('an empty ledger produces an empty board rather than an invented number', () => {
    assert.deepEqual(leaderboard([]), []);
    assert.deepEqual(regressions([]), []);
  });

  test('a regression needs both halves populated before it will speak', () => {
    const good = new Array(10).fill({ agent: 'a', capability: 'x', outcome: 'ok' });
    const bad = new Array(10).fill({ agent: 'a', capability: 'x', outcome: 'fail' });
    assert.equal(regressions([...good]).length, 0, '10 observations cannot be split into two halves of 10');
    assert.equal(regressions([...good, ...bad]).length, 1);
  });

  test('blocked never counts against an agent in a regression', () => {
    const rows = [...new Array(10).fill({ agent: 'a', capability: 'x', outcome: 'ok' }), ...new Array(10).fill({ agent: 'a', capability: 'x', outcome: 'blocked' })];
    assert.equal(regressions(rows).length, 0, 'blocked is not the agent\'s fault and must not read as decline');
  });

  test('the golden routing set still passes — this is the regression guard itself', () => {
    const golden = loadGolden('routing-golden.yaml');
    const rep = replayGolden(golden.cases, org, { memory: {} });
    const failures = rep.results.filter((r) => !r.ok);
    assert.equal(rep.failed, 0, `golden routing changed:\n${failures.map((f) => `  ${f.request}\n    ${f.failures.join('\n    ')}`).join('\n')}`);
  });

  test('the golden set asserts negatives too — a gate that fires on everything is unreadable', () => {
    const golden = loadGolden('routing-golden.yaml');
    assert.ok(golden.cases.some((c) => c.expect_no_gate), 'no negative gate assertion; the suite cannot catch a gate becoming noise');
  });
});

describe('contract weight stays bounded', () => {
  test('no agent requires more than 20 fields', () => {
    for (const a of org.all) {
      const r = resolveContract(a, org.contracts);
      assert.ok(r.fields.length <= 20, `${a.name} requires ${r.fields.length} fields`);
    }
  });
});

describe('contract weight scales with the effort mode', () => {
  test('direct and focused are lighter; standard and campaign are untouched', () => {
    const a = org.byName.get('chief-of-works');
    const full = resolveContract(a, org.contracts).fields.length;
    assert.ok(resolveContract(a, org.contracts, { mode: 'direct' }).fields.length < full);
    assert.ok(resolveContract(a, org.contracts, { mode: 'focused' }).fields.length < full);
    assert.equal(resolveContract(a, org.contracts, { mode: 'standard' }).fields.length, full, 'standard must not be weakened');
    assert.equal(resolveContract(a, org.contracts, { mode: 'campaign' }).fields.length, full, 'campaign must not be weakened');
  });

  test('nothing is LOST — a trimmed field becomes optional, never forbidden', () => {
    const a = org.byName.get('chief-of-works');
    const full = resolveContract(a, org.contracts);
    const direct = resolveContract(a, org.contracts, { mode: 'direct' });
    const keys = (r) => new Set([...r.fields, ...r.optional].map((f) => f.key));
    assert.deepEqual([...keys(full)].sort(), [...keys(direct)].sort(), 'a field disappeared entirely instead of being demoted');
  });

  test('the three fields that survive every mode are the ones a claim cannot be checked without', () => {
    for (const mode of ['direct', 'focused']) {
      const keys = resolveContract(org.byName.get('backend-engineer'), org.contracts, { mode }).fields.map((f) => f.key);
      for (const must of ['STATUS', 'SUMMARY', 'EVIDENCE_GRADE']) {
        assert.ok(keys.includes(must), `${mode} dropped ${must}, which RULE 007 makes mandatory in every handoff`);
      }
    }
  });

  test('a mode naming only fields that no longer exist falls back to the full contract, never to nothing', () => {
    const contracts = JSON.parse(JSON.stringify(org.contracts));
    contracts.by_mode = { direct: { fields_required: ['A_FIELD_THAT_WAS_RENAMED'] } };
    const r = resolveContract(org.byName.get('backend-engineer'), contracts, { mode: 'direct' });
    assert.ok(r.fields.length > 0, 'a stale by_mode entry emptied the contract — an agent with no required fields reports nothing');
  });

  test('an unknown mode changes nothing', () => {
    const a = org.byName.get('backend-engineer');
    assert.equal(resolveContract(a, org.contracts, { mode: 'nonsense' }).fields.length, resolveContract(a, org.contracts).fields.length);
  });
});

describe('the plugin seams, and the boundary each one has', () => {
  const mkPlugins = (kind, files) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-plug-'));
    const d = path.join(root, `forge-${kind}`);
    fs.mkdirSync(d, { recursive: true });
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(d, name), body);
    return root;
  };

  test('a custom validator can FAIL the audit — that is the point of the seam', async () => {
    const { runValidators } = await import('../scripts/plugins.mjs');
    const root = mkPlugins('validators', {
      'x.mjs': 'export default { name: "x", check: () => ({ ok: false, notes: [{ level: "fail", text: "nope" }] }) };',
    });
    const r = await runValidators(org, { root });
    assert.equal(r[0].ok, false);
  });

  test('a validator returning something truthy-but-odd does not pass', async () => {
    const { runValidators } = await import('../scripts/plugins.mjs');
    const root = mkPlugins('validators', { 'x.mjs': 'export default { name: "x", check: () => ({ ok: "yes", notes: [] }) };' });
    const r = await runValidators(org, { root });
    assert.equal(r[0].ok, false, 'ok must be strictly true; a string passed the audit');
  });

  test('a validator that throws is reported as a broken validator, not as a broken organization', async () => {
    const { runValidators } = await import('../scripts/plugins.mjs');
    const root = mkPlugins('validators', { 'x.mjs': 'export default { name: "x", check: () => { throw new Error("boom"); } };' });
    const r = await runValidators(org, { root });
    assert.equal(r[0].ok, true, 'a broken check must not fail the audit — that is a different problem');
    assert.match(r[0].notes[0].text, /threw and was skipped/);
  });

  test('a hook naming an unknown event is refused rather than silently never firing', async () => {
    const { loadHooks } = await import('../scripts/plugins.mjs');
    const root = mkPlugins('hooks', {
      'good.json': JSON.stringify({ name: 'g', on: ['gate_fired'], command: 'true' }),
      'bad.json': JSON.stringify({ name: 'b', on: ['when_i_feel_like_it'], command: 'true' }),
      'nocmd.json': JSON.stringify({ name: 'n', on: ['gate_fired'] }),
    });
    const hooks = loadHooks({ root });
    assert.equal(hooks.find((h) => h.name === 'g').broken, undefined);
    assert.match(hooks.find((h) => h.name === 'b').broken, /unknown event/);
    assert.match(hooks.find((h) => h.name === 'n').broken, /no command/);
  });

  test('a hook cannot change a decision — its return value is discarded', async () => {
    const { fireHooks } = await import('../scripts/plugins.mjs');
    const root = mkPlugins('hooks', { 'a.json': JSON.stringify({ name: 'a', on: ['gate_fired'], command: 'true' }) });
    let saw = null;
    const fired = await fireHooks('gate_fired', { gate: 'GATE-RELEASE' }, { root, exec: async (h, payload) => { saw = payload; return { veto: true }; } });
    assert.deepEqual(saw, { gate: 'GATE-RELEASE' });
    assert.equal(fired[0].ok, true);
    // The veto is nowhere in the result. There is no field for it, deliberately.
    assert.equal('veto' in fired[0], false);
  });

  test('a throwing hook never breaks the thing it was notifying about', async () => {
    const { fireHooks } = await import('../scripts/plugins.mjs');
    const root = mkPlugins('hooks', { 'a.json': JSON.stringify({ name: 'a', on: ['gate_fired'], command: 'true' }) });
    const fired = await fireHooks('gate_fired', {}, { root, exec: async () => { throw new Error('slack is down'); } });
    assert.equal(fired[0].ok, false, 'the failure should be reported');
    // and the call itself resolved rather than rejecting — reaching this line is the assertion
  });

  test('no plugin directory means no plugins and no behaviour change', async () => {
    const { pluginSummary } = await import('../scripts/plugins.mjs');
    const s = await pluginSummary({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'forge-empty-')) });
    assert.deepEqual([s.validators.length, s.hooks.length, s.exporters.length], [0, 0, 0]);
  });
});

describe('reading the ledger under load', () => {
  test('a small ledger reads synchronously and a large one still parses identically', async () => {
    const { readLedgerAsync, ASYNC_READ_THRESHOLD } = await import('../scripts/ledger.mjs');
    const d = tmp();
    for (let i = 0; i < 20; i += 1) observe({ agent: 'a', capability: 'x', outcome: 'ok' }, d);
    assert.deepEqual(await readLedgerAsync(d), readLedger(d), 'the async path disagreed with the sync one');

    // Past the threshold, the other branch runs — and must still produce the same rows.
    const pad = 'z'.repeat(200);
    while (fs.statSync(path.join(d, '.forge', 'ledger.jsonl')).size < ASYNC_READ_THRESHOLD + 1000) {
      observe({ agent: 'a', capability: 'x', outcome: 'ok', note: pad }, d);
    }
    const big = await readLedgerAsync(d);
    assert.deepEqual(big, readLedger(d), 'the large-file branch parsed differently');
    assert.ok(big.length > 20);
  });

  test('a corrupt line does not destroy the history around it', () => {
    const d = tmp();
    observe({ agent: 'a', capability: 'x', outcome: 'ok' }, d);
    fs.appendFileSync(path.join(d, '.forge', 'ledger.jsonl'), '{this is not json\n');
    observe({ agent: 'b', capability: 'x', outcome: 'ok' }, d);
    const m = derive(readLedger(d)).memory;
    assert.ok(m.a && m.b, 'a corrupt line took its neighbours with it');
    assert.equal(readLedger(d).filter((r) => r.corrupt).length, 1);
  });
});

describe('the ledger survives concurrency and corruption', () => {
  test('five concurrent observes produce five valid rows — proving append-safety rather than assuming it', async () => {
    const d = tmp();
    // JSONL is line-based and order-independent, so concurrent appends can interleave lines
    // but cannot corrupt each other. That has always been true and was never tested, which
    // is why parallel dispatch "felt" unreliable.
    await Promise.all([1, 2, 3, 4, 5].map((i) => Promise.resolve().then(() => observe({ agent: `a${i}`, capability: 'x', outcome: 'ok', campaign: 'C-par' }, d))));
    const rows = readLedger(d);
    assert.equal(rows.length, 5);
    assert.equal(rows.filter((r) => r.corrupt).length, 0);
    assert.equal(new Set(rows.map((r) => r.agent)).size, 5, 'a concurrent write was lost');
  });

  test('memory.json can be corrupt and the ledger still rebuilds everything', () => {
    const d = tmp();
    observe({ agent: 'a', capability: 'x', outcome: 'ok', tokens: 10 }, d);
    fs.writeFileSync(path.join(d, '.forge', 'memory.json'), '{ not json at all');
    // loadMemory must degrade to empty rather than throw, and derive must not consult it.
    assert.deepEqual(derive(readLedger(d)).memory.a.n, 1);
  });

  test('a corrupt derivation cache is a cache miss, never an error', () => {
    const d = tmp();
    observe({ agent: 'a', capability: 'x', outcome: 'ok' }, d);
    derivedMemory(d);
    fs.writeFileSync(path.join(d, '.forge', '.memory-cache.json'), 'garbage{{{');
    invalidateMemory(d);
    assert.equal(derivedMemory(d).memory.a.n, 1);
  });
});

describe('the minutes — decisions, patterns, post-mortem', () => {
  test('a contested decision with no minority position is REFUSED at the door', async () => {
    const { recordDecision } = await import('../scripts/minutes.mjs');
    const d = tmp();
    assert.throws(() => recordDecision({ decision: 'ship it', contested: true }, d), /press release/);
    assert.throws(() => recordDecision({ decision: 'ship it', contested: true, minority: '   ' }, d), /press release/, 'whitespace is not a position');
    const row = recordDecision({ decision: 'ship it', contested: true, minority: 'works disagreed on incident history' }, d);
    assert.equal(row.contested, true);
    assert.match(row.minority, /works disagreed/);
  });

  test('an uncontested decision needs no minority — nobody objected is a valid record', async () => {
    const { recordDecision, readDecisions } = await import('../scripts/minutes.mjs');
    const d = tmp();
    recordDecision({ decision: 'reuse the retry helper', why: 'P3' }, d);
    assert.equal(readDecisions(d).length, 1);
  });

  test('a pattern under the run threshold is not reported — a coincidence is not a rule', async () => {
    const { campaignPatterns } = await import('../scripts/minutes.mjs');
    const rows = [];
    for (const c of ['C1', 'C2']) {
      rows.push({ campaign: c, agent: 'a', capability: 'x', outcome: 'ok' }, { campaign: c, agent: 'b', capability: 'y', outcome: 'ok' });
    }
    assert.equal(campaignPatterns(rows, { minRuns: 3 }).length, 0);
    rows.push({ campaign: 'C3', agent: 'a', capability: 'x', outcome: 'ok' }, { campaign: 'C3', agent: 'b', capability: 'y', outcome: 'ok' });
    const p = campaignPatterns(rows, { minRuns: 3 });
    assert.equal(p.length, 1);
    assert.deepEqual(p[0].sequence, ['a', 'b']);
    assert.equal(p[0].runs, 3);
  });

  test('a post-mortem proposes each lesson once, however many times it was earned', async () => {
    const { postmortem } = await import('../scripts/minutes.mjs');
    const d = tmp();
    observe({ agent: 'test-engineer', capability: 'test', outcome: 'fail', campaign: 'C', tokens: 10 }, d);
    observe({ agent: 'test-engineer', capability: 'test', outcome: 'fail', campaign: 'C', tokens: 10 }, d);
    observe({ agent: 'test-engineer', capability: 'test', outcome: 'fail', campaign: 'C', tokens: 10 }, d);
    const r = postmortem('C', d);
    const routing = r.lessons.filter((l) => l.kind === 'routing');
    assert.equal(routing.length, 1, `three failures produced ${routing.length} identical proposals`);
  });

  test('a clean campaign says so instead of generating a page of nothing', async () => {
    const { postmortem } = await import('../scripts/minutes.mjs');
    const d = tmp();
    observe({ agent: 'a', capability: 'x', outcome: 'ok', campaign: 'C', tokens: 100 }, d);
    const r = postmortem('C', d);
    assert.match(r.verdict, /nothing went wrong/);
    assert.equal(r.lessons.length, 0);
  });

  test('a post-mortem surfaces checklist items the campaign closed over', async () => {
    const { postmortem } = await import('../scripts/minutes.mjs');
    const d = tmp();
    observe({ agent: 'a', capability: 'x', outcome: 'ok', campaign: 'C' }, d);
    writeChecklist('C', ['done thing', 'forgotten thing'], d);
    markItem('C', '1', 'SUCCESS', { evidence: 'x', cwd: d });
    const r = postmortem('C', d, { checklist: checklistComplete('C', d) });
    assert.deepEqual(r.openItems, ['forgotten thing']);
  });
});
