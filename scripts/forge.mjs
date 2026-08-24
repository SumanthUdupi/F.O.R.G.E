#!/usr/bin/env node
/**
 * The F.O.R.G.E. command line.
 *
 * Every command here is deterministic and free: no model call, no network, no dependency.
 * That is what makes them usable inside a hook, inside CI, and inside an agent's own turn
 * without the agent paying for its own routing.
 *
 * Exit codes are load-bearing. `doctor` exits non-zero on a constitutional violation, so a
 * violation cannot reach a machine through a green pipeline.
 */

import fs from 'node:fs';
import path from 'node:path';
import { load, ui, ROOT } from './core.mjs';
import { composeVector, renderVector } from './vector.mjs';
import { runDoctor } from './doctor.mjs';
import { build } from './render.mjs';
import { observe, readLedger, derive, saveMemory, files } from './ledger.mjs';

/**
 * Current memory, derived from the ledger on every call.
 *
 * The first version read the cached `.forge/memory.json`, which is only refreshed by
 * `forge learn`. Observations recorded since the last learn were therefore invisible to
 * `plan`, and the planner staffed an agent the ledger already showed failing -- silently,
 * because a stale cache and an empty one render identically. Deriving is a file read and a
 * fold over a few hundred rows; there was never a reason to cache it for correctness.
 */
const currentMemory = () => derive(readLedger()).memory;
import { profileWorkspace, renderProfile, propose, applyProposal, loadOverlay, briefing, CAP } from './learn.mjs';
import { install } from './install.mjs';
import { charterDoc } from './charter-doc.mjs';
import { startDeck } from './deck.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};
const positional = () => argv.slice(1).filter((a, i, arr) => !a.startsWith('--') && !(arr[i - 1] || '').startsWith('--'));

const die = (msg, code = 1) => {
  console.error(`\n  ${msg}\n`);
  process.exit(code);
};

const HELP = `
F.O.R.G.E. — Foundry for Organized Reasoning, Governance and Evolution

  forge plan "<request>"        compose the Campaign Vector. Deterministic, model-free.
      --mode <m>                force direct | focused | standard | campaign
      --json                    machine-readable

  forge board                   the six seats, their portfolios and what each objects to
  forge roster [division]       who exists, what they own, what they refuse
  forge doctor                  the constitutional audit. Non-zero exit on any violation.
  forge build [--apply]         regenerate agents/ and the skill from the registry
  forge install [--apply]       install into ~/.claude (agents + skill)
  forge charter [--apply]       regenerate CHARTER.md from the constitution

  forge deck [--port 7717]      open the Command Deck in a browser. Loopback only,
                                zero dependencies, reads this workspace's .forge/
  forge context                 the session briefing: what this workspace has taught the
                                organization. Prints nothing when nothing is known.

  forge observe --agent <n> --capability <c> --outcome ok|partial|fail|blocked
      [--correction "..."] [--tokens N] [--campaign id]
                                record one outcome in this workspace's ledger

  forge learn                   read the workspace and the ledger; write memory + profile,
                                and propose adaptations. Applies nothing.
  forge evolve                  review pending proposals
      --apply <id>              approve one. This is the only way anything is applied.
  forge memory                  what the organization currently believes about who is good at what

Everything the organization learns lives in ./.forge/ and is scoped to this workspace.
`;

const org = () => {
  try {
    return load();
  } catch (e) {
    die(`the organization failed to load.\n\n${e.message}`);
  }
};

switch (cmd) {
  case undefined:
  case 'help':
  case '--help':
  case '-h':
    console.log(HELP);
    break;

  case 'plan': {
    const request = positional().join(' ');
    if (!request) die('plan needs a request: forge plan "add rate limiting to the public api"');
    const o = org();
    const v = composeVector(request, o, { memory: currentMemory(), mode: flag('mode') });
    if (flag('json')) console.log(JSON.stringify(v, null, 2));
    else console.log(renderVector(v, o));
    break;
  }

  case 'board': {
    const o = org();
    console.log(ui.head('THE BOARD'));
    console.log(`\n  ${o.constitution.board.seats} seats. No chief executive.`);
    console.log(`  Chair: ${o.constitution.board.chair} — ${String(o.constitution.board.chair_authority).replace(/\s+/g, ' ').trim()}\n`);
    for (const seat of o.roster.board) {
      const owns = o.constitution.board.portfolios.find((p) => p.seat === seat.id).owns
        .map((d) => o.constitution.divisions.find((x) => x.id === d).name);
      console.log(ui.rule(seat.seat));
      console.log(`  ${seat.id}  tier ${seat.model}`);
      console.log(`  owns      ${owns.join(', ')}`);
      console.log(`  answers for  ${seat.owns.replace(/\s+/g, ' ').trim()}`);
      console.log(`  refuses   ${seat.refuses.replace(/\s+/g, ' ').trim()}`);
      console.log(`  objects   ${seat.dissents_when.replace(/\s+/g, ' ').trim()}`);
    }
    console.log(ui.rule('resolution'));
    for (const r of o.constitution.board.resolution) console.log(`  - ${r}`);
    console.log('');
    break;
  }

  case 'roster': {
    const o = org();
    const only = positional()[0];
    console.log(ui.head('ROSTER'));
    for (const d of o.constitution.divisions) {
      if (only && !d.id.toLowerCase().includes(only.toLowerCase()) && !d.name.toLowerCase().includes(only.toLowerCase())) continue;
      const seat = o.roster.board.find((b) => b.id === o.seatOf.get(d.id));
      console.log(ui.rule(`${d.name} (${d.code}) — ${seat.seat}`));
      for (const a of o.byDivision.get(d.id)) {
        console.log(`  ${a.role === 'manager' ? '*' : ' '} ${a.name.padEnd(24)} ${a.model.padEnd(9)} ${(a.capabilities || []).join(' ')}`);
        console.log(`    owns    ${a.owns}`);
        console.log(`    refuses ${String(a.refuses).replace(/\s+/g, ' ').trim()}`);
      }
    }
    console.log('');
    break;
  }

  case 'doctor': {
    const r = runDoctor(org());
    console.log(r.lines.join('\n'));
    console.log('');
    process.exit(r.ok ? 0 : 1);
    break;
  }

  case 'build': {
    const o = org();
    const apply = Boolean(flag('apply'));
    const r = build(o, { apply });
    console.log(`\n  ${apply ? 'wrote' : 'would write'} ${r.written.length} files from the registry`);
    if (!apply) console.log('  run with --apply to write them\n');
    else console.log(`  agents/  ${o.all.length} agents\n  skills/forge/SKILL.md\n`);
    break;
  }

  case 'install': {
    const r = install(org(), { apply: Boolean(flag('apply')), force: Boolean(flag('force')) });
    console.log(r.report);
    process.exit(r.ok ? 0 : 1);
    break;
  }

  case 'charter': {
    const o = org();
    const body = charterDoc(o);
    const out = path.join(ROOT, 'CHARTER.md');
    if (flag('apply')) {
      fs.writeFileSync(out, body);
      console.log(`\n  wrote ${path.relative(process.cwd(), out)} from charter/constitution.yaml\n`);
    } else {
      console.log(body);
    }
    break;
  }

  case 'deck': {
    const port = Number(flag('port', 7717));
    let deck;
    try {
      deck = await startDeck({ port, cwd: process.cwd() });
    } catch (e) {
      die(e.code === 'EADDRINUSE' ? `port ${port} is busy. Try: forge deck --port ${port + 1}` : e.message);
    }
    const url = `http://127.0.0.1:${deck.port}`;
    console.log(`\n  COMMAND DECK  ${url}`);
    console.log(`  workspace     ${process.cwd()}`);
    console.log('  bound to loopback only — the deck reads your ledger and profile, and has no auth because it has no remote.');
    console.log('  ctrl-c to stop\n');
    if (!flag('no-open')) {
      // Best effort. A failure to launch a browser is not a failure to serve the deck, so
      // it stays silent and the URL above is the fallback.
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      import('node:child_process').then(({ spawn }) => {
        try {
          spawn(opener, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
        } catch { /* the URL is printed above */ }
      });
    }
    process.on('SIGINT', () => {
      deck.close();
      process.exit(0);
    });
    break;
  }

  case 'context': {
    // Emits the session briefing, or nothing at all. Wired into a SessionStart hook, so
    // "nothing to say" must print nothing rather than a header with no content under it.
    const text = briefing(org(), process.cwd());
    if (text) console.log(text);
    break;
  }

  case 'observe': {
    const o = org();
    const agent = flag('agent');
    if (!agent) die('observe needs --agent');
    if (!o.byName.has(String(agent))) die(`no agent named "${agent}". Try: forge roster`);
    try {
      const row = observe(
        {
          agent: String(agent),
          capability: String(flag('capability') || ''),
          outcome: String(flag('outcome') || ''),
          correction: flag('correction') === true ? null : flag('correction'),
          tokens: Number(flag('tokens') || 0),
          campaign: flag('campaign') === true ? null : flag('campaign'),
        },
        process.cwd(),
      );
      console.log(`\n  recorded  ${row.agent} · ${row.capability} · ${row.outcome}${row.correction ? ` · correction noted` : ''}\n`);
    } catch (e) {
      die(e.message);
    }
    break;
  }

  case 'memory': {
    const rows = readLedger();
    if (!rows.length) {
      console.log('\n  no observations in this workspace yet. Every agent carries the neutral prior.\n');
      break;
    }
    const d = derive(rows);
    console.log(ui.head(`MEMORY — ${d.observations} observations`));
    const ranked = Object.entries(d.memory).sort((a, b) => b[1].reliability - a[1].reliability);
    console.log('');
    for (const [name, m] of ranked) {
      const classes = Object.entries(m.byClass).map(([c, v]) => `${c} ${v.rate}${v.consecutiveFailures ? ` (${v.consecutiveFailures} consecutive failures)` : ''}`);
      console.log(`  ${name.padEnd(24)} ${String(m.reliability).padEnd(8)} n=${String(m.n).padEnd(4)} ${classes.join(', ')}`);
    }
    console.log(`\n  ${d.corrections.length} correction(s) recorded. Reliability is smoothed against a 0.7 prior worth 4 observations,`);
    console.log('  so three lucky runs do not read as a perfect agent.\n');
    break;
  }

  case 'learn': {
    const o = org();
    const rows = readLedger();
    const profile = profileWorkspace();
    const derived = derive(rows);
    const f = files();
    fs.mkdirSync(f.dir, { recursive: true });
    saveMemory(derived);
    fs.writeFileSync(f.profile, renderProfile(profile));

    const result = propose(o, { rows, profile });
    fs.writeFileSync(f.proposals, `${JSON.stringify(result.proposals, null, 2)}\n`);

    console.log(ui.head('LEARN'));
    console.log(ui.rule('what this workspace is'));
    for (const [k, v] of Object.entries(profile)) {
      const val = Array.isArray(v.value) ? v.value.join(', ') || '(none)' : String(v.value);
      console.log(`  ${k.padEnd(14)} ${val.padEnd(22)} ${v.grade.padEnd(10)} ${v.why}`);
    }
    console.log(ui.rule('what it has observed'));
    console.log(`  ${derived.observations} observation(s), ${derived.corrections.length} correction(s), ${Object.keys(derived.memory).length} agent(s) measured`);
    console.log(ui.rule(`proposals — capped at ${CAP.proposals}, touching at most ${CAP.agents} agents`));
    if (!result.proposals.length) {
      console.log('  nothing to propose. Not every run should produce a change.');
    }
    for (const p of result.proposals) {
      console.log(`\n  ${p.id}  [${p.kind}]  ${p.change}`);
      console.log(`      because  ${p.observation}  (${p.grade})`);
      for (const b of p.body || []) console.log(`      ${b}`);
      if (p.refused) console.log(`      REFUSED  ${p.refused}`);
    }
    console.log(`\n  wrote ${path.relative(process.cwd(), f.profile)}, ${path.relative(process.cwd(), f.memory)}, ${path.relative(process.cwd(), f.proposals)}`);
    console.log('  Nothing was applied. `forge evolve --apply <id>` is the only way anything changes.\n');
    break;
  }

  case 'evolve': {
    const f = files();
    if (!fs.existsSync(f.proposals)) die('no proposals. Run `forge learn` first.');
    const proposals = JSON.parse(fs.readFileSync(f.proposals, 'utf8'));
    const id = flag('apply');
    if (!id || id === true) {
      console.log(ui.head('PENDING PROPOSALS'));
      console.log('\n  The organization proposes. You approve. Article 86: self-improvement is not self-modification.\n');
      for (const p of proposals) {
        console.log(`  ${p.id}  [${p.kind}]  ${p.change}`);
        console.log(`      because  ${p.observation}  (${p.grade})`);
        console.log(`      reversible: ${p.reversible ? 'yes — recorded with its undo' : 'NO'}`);
        if (p.refused) console.log(`      REFUSED  ${p.refused}`);
        console.log('');
      }
      console.log('  forge evolve --apply <id>\n');
      break;
    }
    const p = proposals.find((x) => x.id === id);
    if (!p) die(`no proposal ${id}`);
    if (p.refused) die(`${id} was refused at proposal time: ${p.refused}`);
    try {
      const written = applyProposal(p, process.cwd());
      console.log(`\n  applied ${p.id} to ${path.relative(process.cwd(), written)}`);
      console.log(`  undo recorded in ${path.relative(process.cwd(), files().applied)} — delete the block to withdraw it.\n`);
    } catch (e) {
      die(e.message);
    }
    break;
  }

  case 'overlay': {
    const o = loadOverlay();
    console.log(ui.head('WORKSPACE OVERLAY'));
    if (!o.adaptations?.length) {
      console.log('\n  nothing approved in this workspace. The shipped organization is running unmodified.\n');
      break;
    }
    for (const a of o.adaptations) console.log(`\n  ${a.id} [${a.kind}] ${a.change}\n      because ${a.observation} (${a.grade})`);
    console.log('');
    break;
  }

  default:
    die(`unknown command "${cmd}".${HELP}`);
}
