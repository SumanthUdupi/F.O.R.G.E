/**
 * The Command Deck server.
 *
 * Tested against a real listening socket rather than by calling the handlers directly,
 * because most of what can go wrong here is in the HTTP layer: a path that escapes the deck
 * directory, a write endpoint that trusts its input, a payload the browser cannot join back
 * together. Calling the functions would pass while the server was still wrong.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startDeck } from '../scripts/deck.mjs';
import { observe } from '../scripts/ledger.mjs';

let deck;
let base;
let ws;

before(async () => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-deck-'));
  observe({ agent: 'code-reviewer', capability: 'review', outcome: 'ok', at: '2026-01-01T09:00:00Z' }, ws);
  observe({ agent: 'backend-engineer', capability: 'backend', outcome: 'fail', at: '2026-01-01T09:05:00Z', correction: 'bound the query' }, ws);
  // Port 0 so the suite never collides with a deck the Principal is actually running.
  deck = await startDeck({ port: 0, cwd: ws });
  base = `http://127.0.0.1:${deck.port}`;
});
after(() => deck && deck.close());

const get = async (p) => {
  const res = await fetch(base + p);
  return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
};
const post = async (p, body) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
};

describe('it binds to loopback only', () => {
  test('the address is 127.0.0.1, never 0.0.0.0', () => {
    // The deck serves the ledger and the workspace profile with no authentication, because
    // it has no remote. Binding wider would publish that with no way to say no.
    assert.equal(deck.server.address().address, '127.0.0.1');
  });
});

describe('the static deck', () => {
  test('serves the page, the stylesheet and the client', async () => {
    for (const [p, type] of [['/', 'text/html'], ['/console.css', 'text/css'], ['/console.js', 'text/javascript']]) {
      const r = await get(p);
      assert.equal(r.status, 200, p);
      assert.match(r.type, new RegExp(type), p);
      assert.ok(r.body.length > 100, `${p} is suspiciously small`);
    }
  });

  test('nothing outside deck/ is reachable', async () => {
    for (const p of ['/../scripts/core.mjs', '/../../etc/passwd', '/..%2f..%2fpackage.json', '/../charter/constitution.yaml']) {
      const r = await get(p);
      assert.ok(r.status === 403 || r.status === 404, `${p} returned ${r.status}`);
      assert.ok(!r.body.includes('constitution'), `${p} leaked repository content`);
    }
  });

  test('an unknown api path is a 404, not a static lookup', async () => {
    assert.equal((await get('/api/nope')).status, 404);
  });
});

describe('/api/org — the organization, joined server-side', () => {
  let org;
  before(async () => {
    org = JSON.parse((await get('/api/org')).body);
  });

  test('six seats, twelve divisions, sixty-four agents', () => {
    assert.equal(org.seats.length, 6);
    assert.equal(org.divisions.length, 12);
    assert.equal(org.divisions.reduce((n, d) => n + d.agents.length, 0), 64);
  });

  test('every division names its seat, and every seat its divisions', () => {
    // The browser must never have to re-derive this join. Two implementations of one
    // relationship is two chances for the deck to describe an organization that does not exist.
    const owned = org.seats.flatMap((s) => s.divisions);
    assert.equal(new Set(owned).size, 12);
    for (const d of org.divisions) assert.ok(org.seats.some((s) => s.id === d.seat), `${d.id} has no seat`);
  });

  test('exactly one chair, and it is not the widest portfolio', () => {
    const chairs = org.seats.filter((s) => s.isChair);
    assert.equal(chairs.length, 1);
    const widest = Math.max(...org.seats.map((s) => s.divisions.length));
    assert.ok(chairs[0].divisions.length < widest);
  });

  test('every agent ships its resolved contract keys', () => {
    for (const d of org.divisions) {
      for (const a of d.agents) {
        assert.ok(a.contract.includes('STATUS'), `${a.name} has no STATUS in its contract`);
        assert.ok(a.refuses, `${a.name} refuses nothing`);
      }
    }
  });
});

describe('/api/state — everything that moves', () => {
  test('derives division status from the ledger rather than storing it', async () => {
    // A status field somebody has to write is a status field that is wrong whenever
    // something crashes. Derived, it can only ever be stale — never lying.
    const s = JSON.parse((await get('/api/state')).body);
    assert.equal(s.status['DIV-QAA'].state, 'active', 'a division with a recent success reads idle');
    assert.equal(s.status['DIV-ENG'].state, 'failing', 'a division whose last observation failed reads healthy');
    assert.equal(s.status['DIV-TRS'].state, 'idle');
  });

  test('carries the graded workspace profile', async () => {
    const s = JSON.parse((await get('/api/state')).body);
    for (const v of Object.values(s.profile)) {
      assert.ok(['EVIDENCE', 'INFERENCE', 'UNKNOWN'].includes(v.grade));
      assert.ok(v.why, 'a profile field with no reason is not a finding');
    }
  });

  test('reports constitutional health, so the spine cannot show green on a broken org', async () => {
    const s = JSON.parse((await get('/api/state')).body);
    assert.equal(typeof s.health.ok, 'boolean');
    assert.equal(s.health.ok, true);
  });
});

describe('/api/plan', () => {
  test('composes a Vector and respects the learned memory', async () => {
    const r = await post('/api/plan', { request: 'add an api endpoint for invoices' });
    assert.equal(r.status, 200);
    assert.ok(r.json.stages.length > 0);
    assert.ok(r.json.stages.some((s) => /review|test/.test(s.capability)), 'a writing plan with no verification');
  });

  test('a gated request reports the gate', async () => {
    const r = await post('/api/plan', { request: 'deploy the service to production' });
    assert.ok(r.json.gates.some((g) => g.id === 'GATE-RELEASE'));
  });

  test('an empty request is refused rather than planned', async () => {
    assert.equal((await post('/api/plan', { request: '   ' })).status, 400);
  });
});

describe('/api/approve — the one write the deck performs', () => {
  test('refuses a proposal targeting anything outside .forge/', async () => {
    // Planted directly into the proposals file, which is the realistic attack: the guard
    // must live in applyProposal, not in whatever generated the proposal.
    const f = path.join(ws, '.forge', 'proposals.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(
      f,
      JSON.stringify([
        { id: 'PX', kind: 'evil', target: 'charter/constitution.yaml', change: 'rewrite the constitution', observation: 'none', grade: 'UNKNOWN' },
        { id: 'PY', kind: 'evil', target: '../../etc/passwd', change: 'escape', observation: 'none', grade: 'UNKNOWN' },
        { id: 'PO', kind: 'profile', target: '.forge/overlay.yaml', change: 'pin the test command', observation: 'detected', grade: 'EVIDENCE' },
      ]),
    );
    for (const id of ['PX', 'PY']) {
      const r = await post('/api/approve', { id });
      assert.equal(r.status, 500, `${id} was not refused`);
      assert.match(r.json.error, /refusing/, `${id}: ${JSON.stringify(r.json)}`);
    }
    assert.ok(!fs.existsSync(path.join(ws, 'charter')), 'the deck wrote outside .forge/');
  });

  test('applies a legitimate proposal and records its undo', async () => {
    const r = await post('/api/approve', { id: 'PO' });
    assert.equal(r.status, 200);
    assert.match(fs.readFileSync(path.join(ws, '.forge', 'overlay.yaml'), 'utf8'), /pin the test command/);
    assert.ok(fs.existsSync(path.join(ws, '.forge', 'applied.jsonl')), 'no undo was recorded');
  });

  test('an unknown proposal is a 404', async () => {
    assert.equal((await post('/api/approve', { id: 'NOPE' })).status, 404);
  });
});

describe('/api/doctor', () => {
  test('returns the audit the CLI runs, not a summary of it', async () => {
    const r = JSON.parse((await get('/api/doctor')).body);
    assert.equal(r.ok, true);
    assert.ok(r.lines.some((l) => l.includes('RULE-001')));
    assert.ok(r.lines.some((l) => l.includes('RULE-012')));
  });
});
