/**
 * The Console — the mailbox, the rollups, and the session boundary.
 *
 * The properties worth testing are the honesty properties:
 *   - mail that cannot be attributed or delivered is refused at the door;
 *   - the briefing carries exactly the unanswered mail, so delivery is guaranteed by the
 *     same mechanism that already starts every session;
 *   - the ?ws= parameter cannot read a directory the CLI never convened in;
 *   - recognition is derived from outcomes, so it cannot be granted, only earned.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load } from '../scripts/core.mjs';
import { observe } from '../scripts/ledger.mjs';
import * as mailbox from '../scripts/mailbox.mjs';
import { briefing } from '../scripts/learn.mjs';
import { startDeck, tokensPayload, rewardsPayload } from '../scripts/deck.mjs';

const org = load();
let deck;
let base;
let ws;

before(async () => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-console-'));
  deck = await startDeck({ port: 0, cwd: ws });
  base = `http://127.0.0.1:${deck.port}`;
});
after(() => deck && deck.close());

const get = async (p) => {
  const res = await fetch(base + p);
  return { status: res.status, body: await res.text() };
};
const post = async (p, body) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
};

describe('two rooms, one server', () => {
  test('/ is the Console and /ops is the instrument panel', async () => {
    const home = await get('/');
    assert.match(home.body, /console\.js/, 'the default surface is not the Console');
    const ops = await get('/ops');
    assert.match(ops.body, /deck\.js/, '/ops does not serve the dense deck');
  });
});

describe('the mailbox refuses what it cannot deliver', () => {
  test('an unknown recipient is refused — mail to nobody is a black hole', async () => {
    assert.equal((await post('/api/messages', { to: 'the-ceo', body: 'hello' })).status, 400);
  });
  test('an empty body is refused', async () => {
    assert.equal((await post('/api/messages', { to: 'chair', body: '   ' })).status, 400);
  });
  test('a repo intake without an https URL is refused', async () => {
    assert.equal((await post('/api/messages', { to: 'discovery-manager', kind: 'repo', body: 'study this' })).status, 400);
  });
  test('a well-formed message is accepted and threads', async () => {
    const r = await post('/api/messages', { to: 'chair', body: 'status please' });
    assert.equal(r.status, 200);
    const list = JSON.parse((await get('/api/messages')).body);
    assert.equal(list.waiting, 1);
    assert.equal(list.threads[0].answered, false);
  });
  test('a reply must answer a real message, from a real agent', () => {
    assert.throws(() => mailbox.reply({ re: 'M-nope', from: 'chair', body: 'x' }, org, ws), /no message/);
    const m = mailbox.post({ to: 'qa-manager', body: 'how bad is it' }, org, ws);
    assert.throws(() => mailbox.reply({ re: m.id, from: 'ghost', body: 'x' }, org, ws), /nobody on the roster/);
    mailbox.reply({ re: m.id, from: 'qa-manager', body: 'two findings, one fixed' }, org, ws);
    const t = mailbox.threads(ws).find((x) => x.id === m.id);
    assert.equal(t.answered, true);
    assert.equal(t.replies[0].from, 'qa-manager');
  });
});

describe('delivery is the briefing, so it cannot be forgotten', () => {
  test('unanswered mail appears in the session briefing; answered mail does not', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-brief-'));
    const m1 = mailbox.post({ to: 'chair', body: 'the one still waiting' }, org, dir);
    const m2 = mailbox.post({ to: 'chair', body: 'the one already handled' }, org, dir);
    mailbox.reply({ re: m2.id, from: 'chair', body: 'done' }, org, dir);
    const text = briefing(org, dir);
    assert.match(text, /MESSAGES FROM THE PRINCIPAL/);
    assert.match(text, new RegExp(m1.id));
    assert.ok(!text.includes(m2.id), 'an answered message was re-delivered');
    assert.match(text, /forge reply/, 'the briefing does not say how to answer');
  });

  test('mail bypasses the nothing-known silence rule — mail is mail', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-brief2-'));
    mailbox.post({ to: 'chair', body: 'hello from an empty workspace' }, org, dir);
    assert.match(briefing(org, dir), /MESSAGES FROM THE PRINCIPAL/, 'an empty workspace swallowed the mail');
  });
});

describe('the session boundary', () => {
  test('?ws= refuses a directory the CLI never convened in', async () => {
    const r = await get('/api/state?ws=/etc');
    assert.equal(r.status, 403);
    assert.ok(!r.body.includes('profile'), 'the guard leaked state from an unregistered path');
  });
  test('/api/workspaces names the workspace being served', async () => {
    const r = JSON.parse((await get('/api/workspaces')).body);
    assert.equal(r.current, ws);
  });
});

describe('rollups are derived, never stored', () => {
  test('token spend attributes to agent and division, and sums', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-tok-'));
    observe({ agent: 'backend-engineer', capability: 'backend', outcome: 'ok', tokens: 1200, at: 'a' }, dir);
    observe({ agent: 'code-reviewer', capability: 'review', outcome: 'ok', tokens: 800, at: 'b' }, dir);
    observe({ agent: 'backend-engineer', capability: 'backend', outcome: 'fail', tokens: 500, at: 'c' }, dir);
    const t = tokensPayload(org, dir);
    assert.equal(t.total, 2500);
    assert.equal(t.byAgent['backend-engineer'].tokens, 1700);
    assert.equal(t.byDivision.Engineering.tokens, 1700);
    assert.equal(t.byDivision['Adversarial QA'].tokens, 800);
  });

  test('a streak is earned by consecutive successes and dies on a failure', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-rew-'));
    for (const o of ['ok', 'ok', 'ok']) observe({ agent: 'test-engineer', capability: 'test', outcome: o, at: o + Math.random() }, dir);
    for (const o of ['ok', 'ok', 'fail']) observe({ agent: 'data-engineer', capability: 'data', outcome: o, at: o + Math.random() }, dir);
    const r = rewardsPayload(dir);
    assert.ok(r.streaks.some((s) => s.agent === 'test-engineer' && s.streak === 3));
    assert.ok(!r.streaks.some((s) => s.agent === 'data-engineer'), 'a broken streak survived its failure');
  });

  test('improvement compares halves, so one lucky run is not a trend', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-imp-'));
    for (const o of ['fail', 'fail', 'ok', 'ok']) observe({ agent: 'frontend-engineer', capability: 'frontend', outcome: o, at: o + Math.random() }, dir);
    const r = rewardsPayload(dir);
    assert.ok(r.improved.some((x) => x.agent === 'frontend-engineer'), 'a real turnaround was not recognised');
  });
});
