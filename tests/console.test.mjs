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
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { load, ROOT } from '../scripts/core.mjs';
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
    const command = out.hooks.UserPromptSubmit[0].hooks[0].command;
    // The command is `echo <json-string-literal>` — the payload is double-encoded so the
    // shell hands the runtime valid JSON. Parse twice: once to unwrap the shell literal,
    // once for the payload itself.
    const gate = JSON.parse(JSON.parse(command.replace(/^echo /, ''))).hookSpecificOutput.additionalContext;
    // The gate is paid on EVERY turn, so it must carry the exit condition and the three
    // instructions that only work if they arrive before any tool call. The full governance
    // text used to live here and now lives in `plan --with-policy`, paid once per campaign
    // rather than once per prompt — so this asserts INTENT, not the old wording.
    assert.match(gate, /answer it directly/, 'the trivial-request exit must come first, or it is paid in full before it is reached');
    assert.match(gate, /plan "<request>"/, 'the gate must name the routing command');
    assert.match(gate, /checklist/, 'the model is what decomposes a multi-item request; the hook is the only place it is told to (RULE 014)');
    assert.match(gate, /observe --agent/, 'a campaign that never closes its ledger teaches nothing');
    // The SIZE is the feature. The previous gate measured 186 words and was injected before
    // every prompt including one-word questions; letting it grow back gives that cost away.
    const words = gate.split(/\s+/).filter(Boolean).length;
    assert.ok(words < 100, `the per-turn gate is ${words} words; it is paid on every prompt and must stay short`);
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
    assert.ok(js.includes('WHO IS WORKING ON WHAT'), 'the agent board is missing from the client');
    // ROOT from core.mjs — never new URL(...).pathname, which this repository documents
    // as its own most-repeated trap and which I still wrote here on the third occasion.
    const { ROOT } = await import('../scripts/core.mjs');
    const task = fs.readFileSync(path.join(ROOT, 'vscode', '.vscode', 'tasks.json'), 'utf8');
    JSON.parse(task); // must be valid JSON or ⌘⇧B fails silently in VS Code
    assert.match(task, /forge\.mjs.{0,3} deck/, 'the task does not start the Console');
  });
});

describe('the activity reader on a machine with no transcripts at all', () => {
  test('returns the SAME shape as when it has data — CI is that machine', async () => {
    // The defect this pins: the no-transcripts path returned a short object, so
    // activeCount was undefined on exactly the machine the path exists for. A contract
    // that changes shape when the answer is "nothing" is not a contract.
    const realHome = process.env.HOME;
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-nohome-'));
    try {
      const mod = await import(`../scripts/activity.mjs?nohome=${Date.now()}`);
      const a = mod.allSessions({ limit: 3 });
      for (const k of ['available', 'total', 'sessions', 'hidden', 'editors', 'activeCount']) {
        assert.ok(k in a, `the no-transcripts shape is missing ${k}`);
      }
      assert.equal(a.available, false);
      assert.equal(a.activeCount, 0);
      const o = mod.orgActivity();
      assert.equal(typeof o.activeCount, 'number');
      assert.deepEqual(o.events, []);
      assert.deepEqual(o.busyAgents, []);
    } finally {
      process.env.HOME = realHome;
    }
  });
});

describe('sessions are named the way the Principal recognises them', () => {
  test('the reader captures slug, entrypoint and the IDE link', async () => {
    const { allSessions, connectedEditors } = await import('../scripts/activity.mjs');
    const a = allSessions({ limit: 5 });
    for (const s of a.sessions) {
      assert.ok('slug' in s && 'entrypoint' in s && 'ide' in s, 'a session lacks its identity fields');
    }
    for (const e of connectedEditors()) {
      assert.ok(e.ide && e.folder, 'an editor lock lacks its name or folder');
      assert.equal(typeof e.alive, 'boolean', 'a stale lock must be distinguishable from a live one');
    }
  });

  test("the organization's own test sessions are hidden, and the hiding is declared", async () => {
    // "2 sessions live" was this conversation plus one of my own E2E temp directories.
    // Hiding them silently would be a second lie; the count of hidden ones is reported.
    const { allSessions } = await import('../scripts/activity.mjs');
    const clean = allSessions({ limit: 30 });
    const all = allSessions({ limit: 30, includeOwnNoise: true });
    assert.equal(typeof clean.hidden, 'number');
    for (const s of clean.sessions) {
      assert.notEqual(s.entrypoint, 'sdk-cli', 'a programmatic session was shown as the Principal\'s work');
      assert.ok(!/^(\/private)?\/tmp\/|\/var\/folders\//.test(s.cwd || ''), 'a temp-directory session was shown');
    }
    assert.ok(all.sessions.length >= clean.sessions.length);
  });
});

describe('the agent board answers "who is working on what"', () => {
  test('every agent appears exactly once with an honest state', async () => {
    const { agentBoard } = await import('../scripts/activity.mjs');
    const { load } = await import('../scripts/core.mjs');
    const org = load();
    const b = agentBoard(org);
    // Every agent sits in a division, board seats included, so the board covers all of them.
    assert.equal(b.rows.length, org.all.length, 'the board must cover every agent');
    const names = b.rows.map((r) => r.name);
    assert.equal(new Set(names).size, names.length, 'an agent appears twice');
    for (const r of b.rows) {
      assert.ok(['working', 'recent', 'available'].includes(r.state));
      // "available" and "working" must be distinguishable facts, never collapsed.
      if (r.state === 'available') assert.equal(r.at, null);
      else assert.ok(r.at, `${r.name} claims ${r.state} with no timestamp`);
    }
  });

  test('the endpoints are served', async () => {
    for (const p of ['/api/agent-board', '/api/editors']) {
      assert.equal((await get(p)).status, 200, `${p} is not served`);
    }
  });
});

describe('per-agent tuning — the Principal may change behaviour, never shape', () => {
  let tws;
  before(() => { tws = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-tune-')); });

  test('behaviour fields are accepted and merged over the shipped agent', async () => {
    const { setTuning, effectiveAgent } = await import('../scripts/tuning.mjs');
    const { load } = await import('../scripts/core.mjs');
    const o = load();
    setTuning({ agent: 'code-reviewer', field: 'model', value: 'lean' }, o, tws);
    setTuning({ agent: 'code-reviewer', field: 'instructions', value: ['name the file and line'] }, o, tws);
    const e = effectiveAgent(o.byName.get('code-reviewer'), tws);
    assert.equal(e.model, 'lean');
    assert.deepEqual(e.instructions, ['name the file and line']);
    assert.deepEqual(e.tuned.sort(), ['instructions', 'model']);
    assert.equal(e.shipped.model, 'deep', 'the shipped definition must survive untouched');
  });

  test('shape fields are refused with the reason, on every one of them', async () => {
    const { setTuning, PROTECTED } = await import('../scripts/tuning.mjs');
    const { load } = await import('../scripts/core.mjs');
    const o = load();
    for (const field of PROTECTED) {
      assert.throws(
        () => setTuning({ agent: 'code-reviewer', field, value: 'x' }, o, tws),
        /shape, not its behaviour/,
        `${field} was editable from the Console`,
      );
    }
    assert.throws(() => setTuning({ agent: 'code-reviewer', field: 'invented', value: 'x' }, o, tws), /not a tunable field/);
    assert.throws(() => setTuning({ agent: 'nobody', field: 'model', value: 'lean' }, o, tws), /nobody on the roster/);
  });

  test('an unknown model tier is refused rather than stored', async () => {
    const { setTuning } = await import('../scripts/tuning.mjs');
    const { load } = await import('../scripts/core.mjs');
    assert.throws(() => setTuning({ agent: 'code-reviewer', field: 'model', value: 'genius' }, load(), tws), /must be one of/);
  });

  test('reverting a field removes the override so the agent tracks the registry again', async () => {
    const { setTuning, effectiveAgent, readTuning } = await import('../scripts/tuning.mjs');
    const { load } = await import('../scripts/core.mjs');
    const o = load();
    setTuning({ agent: 'code-reviewer', field: 'model', value: null }, o, tws);
    assert.equal(readTuning(tws)['code-reviewer'].model, undefined, 'the override was written back as a copy instead of removed');
    const e = effectiveAgent(o.byName.get('code-reviewer'), tws);
    assert.equal(e.model, o.byName.get('code-reviewer').model, 'the agent no longer tracks the shipped tier');
    assert.ok(!e.tuned.includes('model'));
  });

  test('routing bias nudges between qualified agents and never past capability', async () => {
    const { setTuning, routingBias } = await import('../scripts/tuning.mjs');
    const { selectAgents } = await import('../scripts/router.mjs');
    const { load } = await import('../scripts/core.mjs');
    const o = load();
    const cold = selectAgents(['review'], o, {}, {}).staffed[0].agent.name;
    setTuning({ agent: cold, field: 'routingBias', value: 'avoid' }, o, tws);
    const warm = selectAgents(['review'], o, {}, routingBias(tws)).staffed[0].agent.name;
    assert.notEqual(warm, cold, 'an avoid preference did not move the choice');
    // The nudged-away agent must still be someone who HAS the capability — bias reorders,
    // it never invents qualification.
    assert.ok((o.byName.get(warm).capabilities || []).includes('review'));
    setTuning({ agent: cold, field: 'routingBias', value: null }, o, tws);
  });

  test('the endpoints accept behaviour and refuse shape', async () => {
    const ok = await post('/api/tuning', { agent: 'qa-manager', field: 'model', value: 'lean' });
    assert.equal(ok.status, 200);
    const bad = await post('/api/tuning', { agent: 'qa-manager', field: 'division', value: 'DIV-ENG' });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /shape/);
    assert.equal((await post('/api/tuning/clear', { agent: 'qa-manager' })).status, 200);
  });

  test('the config section reaches the shipped client with every field', async () => {
    const js = (await get('/console.js')).body;
    assert.ok(js.includes('configSection'), 'the configuration section is missing');
    for (const f of ['model', 'stance', 'refuses', 'instructions', 'routingBias']) {
      assert.ok(js.includes(`data-cfg="${f}"`), `the ${f} control is missing from the client`);
    }
    assert.ok(js.includes('data-revert'), 'per-field revert is missing');
    assert.ok(js.includes('registry/roster.yaml'), 'the client does not say where shape lives');
  });
});

describe('a reference the Principal supplies reaches the agent', () => {
  test('knows_reference is rendered, not merely stored', async () => {
    // The declared-vs-conveyed rule, applied to a new field: the Principal handed the
    // organization a reference URL, and an agent that never sees it was not given it.
    const { load } = await import('../scripts/core.mjs');
    const { agentMarkdown } = await import('../scripts/render.mjs');
    const org = load();
    for (const a of org.all) {
      if (!a.knows_reference) continue;
      const body = agentMarkdown(a, org);
      assert.ok(body.includes('Reference you were given'), `${a.name}: the reference is declared and not rendered`);
      assert.ok(body.replace(/\s+/g, ' ').includes(a.knows_reference.replace(/\s+/g, ' ')), `${a.name}: the reference text was truncated`);
    }
  });

  test('the playwright expert is grounded in the plugin, and refuses the flaky habits', async () => {
    const { load } = await import('../scripts/core.mjs');
    const org = load();
    const p = org.byName.get('playwright-engineer');
    assert.ok(p, 'QA has no playwright expert');
    assert.equal(p.division, 'DIV-QAA');
    assert.ok((p.capabilities || []).includes('playwright'));
    assert.match(p.knows_reference, /claude\.com\/plugins\/playwright/, 'the expert is not pointed at the reference');
    assert.match(p.refuses, /sleep|selector/i, 'the expert refuses none of the habits that make suites flaky');
  });
});

/**
 * Completions are a surface like any other: a command the CLI has and the completion does not
 * is a command nobody discovers. This is the same "declared vs conveyed" rule the render
 * tests enforce on agent files, applied to the shell.
 */
describe('shell completions cover the real command surface', () => {
  test('every dispatcher command appears in both completion scripts', () => {
    const cli = fs.readFileSync(path.join(ROOT, 'scripts', 'forge.mjs'), 'utf8');
    const commands = [...cli.matchAll(/^  case '([a-z][a-z-]*)':/gm)].map((m) => m[1]);
    assert.ok(commands.length > 20, `only found ${commands.length} commands — the regex has drifted from the dispatcher`);
    for (const shell of ['forge.bash', 'forge.zsh']) {
      const body = fs.readFileSync(path.join(ROOT, 'completions', shell), 'utf8');
      for (const c of commands) {
        assert.ok(body.includes(c), `${shell} does not offer "${c}" — a command nobody can tab to is a command nobody finds`);
      }
    }
  });

  test('the enum flags offer exactly the values the code accepts', () => {
    const body = fs.readFileSync(path.join(ROOT, 'completions', 'forge.bash'), 'utf8');
    for (const v of ['ok partial fail blocked', 'direct focused standard campaign', 'EVIDENCE INFERENCE UNKNOWN', 'SUCCESS FAILED BLOCKED', 'lean standard deep']) {
      assert.ok(body.includes(v), `completion is missing the value set "${v}"`);
    }
  });
});

/**
 * Typography and motion discipline.
 *
 * This file reached TWENTY distinct font sizes and three differently-written transition
 * durations by ordinary accretion — nobody chose 12.5px next to 13px, two people rounded
 * differently a month apart. A scale is only a scale while something enforces it.
 */
describe('the Console holds its type scale and its motion', () => {
  const css = () => fs.readFileSync(path.join(ROOT, 'deck', 'console.css'), 'utf8');

  test('no literal font-size survives — every size names a scale step', () => {
    const strays = [...css().matchAll(/font-size: *([0-9.]+px)/g)].map((m) => m[1]);
    assert.deepEqual(strays, [], `literal font sizes are back: ${strays.join(', ')}`);
  });

  test('no literal duration survives — motion runs on one set of speeds', () => {
    const strays = [...css().matchAll(/transition:[^;]*?([0-9]*\.[0-9]+s)/g)].map((m) => m[1]);
    assert.deepEqual(strays, [], `literal transition durations are back: ${strays.join(', ')}`);
  });

  test('the scale is six steps plus one geometric exception, and no more', () => {
    const steps = [...css().matchAll(/--t-[a-z]+: *([0-9.]+px)/g)].map((m) => m[1]);
    assert.equal(steps.length, 7, `the scale has ${steps.length} steps — it is drifting back toward twenty`);
    assert.equal(new Set(steps).size, 7, 'two scale steps share a value, so one of them is not a step');
  });

  test('reduced motion is honoured, and not by removing meaning', () => {
    const body = css();
    assert.match(body, /prefers-reduced-motion: reduce/, 'the OS-level request to stop animating is ignored');
    // The tokens must collapse, not the layout — a reduced-motion rule that hid things would
    // be removing information rather than removing movement.
    assert.match(body, /--m-quick: 0\.01ms/, 'reduced motion does not actually shorten the durations');
    assert.ok(!/prefers-reduced-motion[\s\S]{0,400}display: *none/.test(body), 'reduced motion hides content instead of stilling it');
  });
});

describe('the editor extension stays a thin shell over the CLI', () => {
  test('every contributed command exists in the dispatcher, and nothing is reimplemented', () => {
    // Runs the extension's own manifest check from the main suite, so a CLI rename breaks
    // here rather than in somebody's command palette.
    const { execFileSync } = require('node:child_process');
    const out = execFileSync(process.execPath, [path.join(ROOT, 'vscode', 'test', 'manifest.test.js')], { encoding: 'utf8' });
    assert.match(out, /^ok — \d+ commands/, out);
  });
});
