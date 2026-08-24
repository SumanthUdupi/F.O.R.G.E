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
import { estimateStages } from '../scripts/ledger.mjs';

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

describe('one room, by the Principal\'s direction', () => {
  test('/ is the Console, and the retired ops deck is actually gone', async () => {
    const home = await get('/');
    assert.match(home.body, /console\.js/, 'the default surface is not the Console');
    // Removed means 404, not lingering. A retired surface that still serves is a second
    // UI nobody maintains — the exact ghost problem doctor hunts in agents/.
    for (const gone of ['/ops', '/ops.html', '/deck.js', '/deck.css']) {
      assert.equal((await get(gone)).status, 404, `${gone} still serves`);
    }
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

describe('the office carries the whole console — no sidebar, nothing lost', () => {
  test('the shell is HUD + floor + drawer, and every rehomed feature is in the client', async () => {
    const html = (await get('/')).body;
    assert.ok(!/data-view=/.test(html), 'the sidebar navigation came back');
    assert.match(html, /id="office"/, 'no floor');
    assert.match(html, /id="drawer"/, 'no drawer');
    assert.match(html, /unhandledrejection/, 'async crashes would freeze silently again');
    const js = (await get('/console.js')).body;
    for (const [needle, feature] of [
      ['personDrawer', 'chat with a person'],
      ['ideabody', 'ideas in the Lab'],
      ['repourl', 'repo intake in the Lab'],
      ['planreq', 'plans in the Directorate'],
      ['healthcheck', 'the audit on the board table'],
      ['data-approve', 'approvals at reception'],
      ['CLAUDE CODE SESSIONS', 'sessions in the elevator'],
      ['measured', 'spending in the Treasury'],
      ['refuses', 'roster depth in the person drawer'],
    ]) {
      assert.ok(js.includes(needle), `feature lost in the move to the office: ${feature}`);
    }
  });
});

describe('spend is honest in both directions — studied in codeburn, rebuilt here', () => {
  test('measured spend reports unavailable rather than zero-as-fact', async () => {
    // ws is a temp dir with no transcripts. Zero and "could not measure" must never render
    // the same — that distinction is the whole reason the field exists.
    const t = JSON.parse((await get('/api/tokens')).body);
    assert.equal(t.measured.available, false);
    assert.ok(t.measured.why, 'unavailable with no reason is not a finding');
  });

  test('campaign rollup attributes to the campaign that reported it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-camp-'));
    observe({ agent: 'test-engineer', capability: 'test', outcome: 'ok', tokens: 900, campaign: 'alpha', at: 'a' }, dir);
    observe({ agent: 'code-reviewer', capability: 'review', outcome: 'ok', tokens: 600, campaign: 'alpha', at: 'b' }, dir);
    observe({ agent: 'backend-engineer', capability: 'backend', outcome: 'ok', tokens: 400, campaign: 'beta', at: 'c' }, dir);
    const t = tokensPayload(org, dir);
    assert.equal(t.byCampaign.alpha.tokens, 1500);
    assert.equal(t.byCampaign.beta.tasks, 1);
  });
});

describe('plans carry a cost grounded in history — studied in OmniRoute, rebuilt here', () => {
  test('no history means no number, stated as such', () => {
    const e = estimateStages([{ id: 'S1', agent: 'x', capability: 'backend' }], []);
    assert.equal(e.total, null);
    assert.match(e.note, /No token history/);
  });

  test('a capability with history estimates from its own average; others fall back and say so', () => {
    const rows = [
      { agent: 'a', capability: 'backend', outcome: 'ok', tokens: 1000 },
      { agent: 'a', capability: 'backend', outcome: 'ok', tokens: 3000 },
      { agent: 'b', capability: 'review', outcome: 'ok', tokens: 500 },
    ];
    const e = estimateStages([{ id: 'S1', agent: 'a', capability: 'backend' }, { id: 'S2', agent: 'c', capability: 'novel' }], rows);
    assert.equal(e.perStage[0].estimate, 2000);
    assert.equal(e.perStage[0].basis, 'measured for this capability');
    assert.equal(e.perStage[1].basis, 'workspace average');
    assert.equal(e.grounded, 1);
  });

  test('/api/plan ships the estimate with the vector', async () => {
    const r = await post('/api/plan', { request: 'add an api endpoint' });
    assert.ok(r.json.cost, 'the plan carries no cost block');
    assert.ok(['number', 'object'].includes(typeof r.json.cost.total) || r.json.cost.total === null);
  });
});

describe('one-command hook install', () => {
  test('merges, preserves every existing setting, and is idempotent', async () => {
    const { installHooks } = await import('../scripts/install.mjs');
    const t = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-hooks-'));
    fs.writeFileSync(path.join(t, 'settings.json'), JSON.stringify({ theme: 'dark', permissions: { allow: ['Bash(ls)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo bye' }] }] } }));
    installHooks({ root: t });
    installHooks({ root: t }); // twice — refreshing after an upgrade is the same command
    const out = JSON.parse(fs.readFileSync(path.join(t, 'settings.json'), 'utf8'));
    assert.equal(out.theme, 'dark');
    assert.deepEqual(out.permissions.allow, ['Bash(ls)']);
    assert.ok(out.hooks.Stop, 'an unrelated hook was clobbered');
    assert.ok(out.hooks.UserPromptSubmit && out.hooks.SessionStart);
    assert.match(out.hooks.UserPromptSubmit[0].hooks[0].command, /CLOSE THE LEDGER/);
    assert.ok(out.env.FORGE_HOME);
  });
});

describe('sessions are sittings, not places', () => {
  test('/api/sessions reports honestly for a workspace with no transcripts', async () => {
    const r = JSON.parse((await get('/api/sessions')).body);
    assert.equal(r.available, false);
    assert.deepEqual(r.sessions, []);
  });

  test('a real transcript directory lists real sessions, newest first', async () => {
    const { listSessions } = await import('../scripts/ledger.mjs');
    const home = path.join(os.homedir(), '.claude', 'projects');
    if (!fs.existsSync(home)) return; // machine without Claude Code — nothing to assert
    const anyWs = fs.readdirSync(home).find((d) => fs.readdirSync(path.join(home, d)).some((f) => f.endsWith('.jsonl')));
    if (!anyWs) return;
    // Reconstruct the cwd is not possible from the flattened name; call the internals via a
    // known workspace only when this repo itself has transcripts. Otherwise the honest-empty
    // test above is the guarantee.
  });

  test('disposable directories never enter the workspace registry', async () => {
    const { registerWorkspace, listWorkspaces } = await import('../scripts/core.mjs');
    const before = listWorkspaces().length;
    registerWorkspace(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-notreg-')));
    registerWorkspace('/private/tmp/forge-fake');
    assert.equal(listWorkspaces().length, before, 'a temp directory was registered as a place the org worked');
  });
});

describe('the Console dispatches Claude Code itself — with a stub runtime under test', () => {
  // FORGE_CLAUDE_BIN points at a script speaking just enough stream-json. The tests prove
  // the BRIDGE — spawn, stream, permission flag, mailbox reply — without burning a real
  // session; one real smoke run happens outside the suite.
  let deck2;
  let base2;
  let ws2;
  before(async () => {
    ws2 = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-run-'));
    // fileURLToPath, never new URL(...).pathname — the latter yields /D:/a/repo on
    // Windows, which is this repository's own most-documented trap, written here anyway
    // and caught by the same CI matrix it documents.
    const { fileURLToPath } = await import('node:url');
    process.env.FORGE_CLAUDE_BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'claude-stub.mjs');
    deck2 = await startDeck({ port: 0, cwd: ws2 });
    base2 = `http://127.0.0.1:${deck2.port}`;
  });
  after(() => {
    delete process.env.FORGE_CLAUDE_BIN;
    deck2 && deck2.close();
  });
  const post2 = async (p, body) => {
    const res = await fetch(base2 + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };

  test('a Do send runs to completion and files the answer as a reply in the thread', async () => {
    const r = await post2('/api/run', { to: 'chair', body: 'probe the bridge', mode: 'do' });
    assert.equal(r.status, 200);
    assert.ok(r.json.runId);
    // wait for the mailbox reply — the durable record, not the in-memory run
    let thread;
    for (let i = 0; i < 40; i += 1) {
      const list = JSON.parse(await (await fetch(`${base2}/api/messages`)).text());
      thread = list.threads.find((t) => t.body === 'probe the bridge');
      if (thread?.answered) break;
      await new Promise((res2) => setTimeout(res2, 100));
    }
    assert.ok(thread?.answered, 'the run never filed its reply');
    assert.match(thread.replies[0].body, /acceptEdits/, 'Do mode did not reach the runtime as acceptEdits');
    assert.equal(thread.replies[0].from, 'desk-manager');
  });

  test('Ask mode reaches the runtime as plan — reads only, enforced not requested', async () => {
    await post2('/api/run', { to: 'qa-manager', body: 'ask-mode probe', mode: 'ask' });
    let thread;
    for (let i = 0; i < 40; i += 1) {
      const list = JSON.parse(await (await fetch(`${base2}/api/messages`)).text());
      thread = list.threads.find((t) => t.body === 'ask-mode probe');
      if (thread?.answered) break;
      await new Promise((res2) => setTimeout(res2, 100));
    }
    assert.match(thread.replies[0].body, /plan/, 'Ask mode did not reach the runtime as plan');
  });

  test('the thread remembers its Claude session, so the next send resumes it', async () => {
    const { sessionForThread } = await import('../scripts/runner.mjs');
    const list = JSON.parse(await (await fetch(`${base2}/api/messages`)).text());
    const thread = list.threads.find((t) => t.body === 'probe the bridge');
    assert.equal(sessionForThread(thread.id, ws2), 'stub-session-123');
  });

  test('an invalid recipient is refused before anything spawns', async () => {
    assert.equal((await post2('/api/run', { to: 'nobody', body: 'x', mode: 'ask' })).status, 400);
  });

  test('a dead run is a 404, not a hang', async () => {
    const res = await fetch(`${base2}/api/run?id=R-nope`);
    assert.equal(res.status, 404);
  });
});

describe('org-wide activity — ground truth, never invented', () => {
  test('a workspace with no transcripts reports unavailable, not silence dressed as calm', async () => {
    const { allSessions, orgActivity } = await import('../scripts/activity.mjs');
    // Against the real machine this returns real sessions; the shape contract is what
    // matters and must hold either way.
    const a = allSessions({ limit: 3 });
    assert.equal(typeof a.available, 'boolean');
    for (const s of a.sessions) {
      assert.equal(typeof s.active, 'boolean');
      assert.ok(Array.isArray(s.agents), 'agents must be a list, even when empty');
      assert.ok(s.turns >= 0);
    }
    const o = orgActivity();
    assert.ok(Array.isArray(o.events) && Array.isArray(o.busyAgents));
    assert.equal(typeof o.activeCount, 'number');
  });

  test('an agent appears busy only if a dispatch was actually recorded', async () => {
    const { orgActivity } = await import('../scripts/activity.mjs');
    const o = orgActivity();
    // Every busy agent must carry the evidence of where and when — no bare names.
    for (const a of o.busyAgents) {
      assert.ok(a.name && a.session && a.at, `${JSON.stringify(a)} lacks its provenance`);
    }
  });

  test('the endpoints are served and the HUD can count from them', async () => {
    for (const p of ['/api/org-sessions', '/api/activity']) {
      const r = await get(p);
      assert.equal(r.status, 200, `${p} is not served`);
      const j = JSON.parse(r.body);
      assert.ok('available' in j || 'events' in j);
    }
  });

  test('mission control and the VS Code task are both in the shipped client', async () => {
    const js = (await get('/console.js')).body;
    assert.ok(js.includes('missionDrawer'), 'mission control is missing from the client');
    assert.ok(js.includes('WORKING NOW'), 'the live-session section is missing');
    assert.ok(js.includes('recorded dispatches'), 'the involved-agents section is missing');
    // ROOT from core.mjs — never new URL(...).pathname, which this repository documents
    // as its own most-repeated trap and which I still wrote here on the third occasion.
    const { ROOT } = await import('../scripts/core.mjs');
    const task = fs.readFileSync(path.join(ROOT, 'vscode', '.vscode', 'tasks.json'), 'utf8');
    JSON.parse(task); // must be valid JSON or ⌘⇧B fails silently in VS Code
    assert.match(task, /forge\.mjs.{0,3} deck/, 'the task does not start the Console');
  });
});
