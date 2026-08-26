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
import { load, ui, ROOT, registerWorkspace } from './core.mjs';
import { composeVector, renderVector } from './vector.mjs';
import { runDoctor } from './doctor.mjs';
import { build } from './render.mjs';
import { observe, readLedger, derive, derivedMemory, saveMemory, files, estimateStages, measuredSpend } from './ledger.mjs';

/**
 * Current memory, derived from the ledger.
 *
 * The first version read the cached `.forge/memory.json`, which is only refreshed by
 * `forge learn`. Observations recorded since the last learn were therefore invisible to
 * `plan`, and the planner staffed an agent the ledger already showed failing -- silently,
 * because a stale cache and an empty one render identically.
 *
 * So it derives, but no longer re-derives blindly. `derivedMemory` memoises the fold and
 * invalidates on the ledger's size+mtime, which is a `stat` rather than a read: the
 * correctness property (never serve a memory older than the newest observation) is preserved
 * exactly, and the cost of the per-turn routing path stops scaling with ledger length.
 */
const currentMemory = () => derivedMemory().memory;
import { profileWorkspace, renderProfile, propose, applyProposal, loadOverlay, briefing, CAP } from './learn.mjs';
import { install, installHooks } from './install.mjs';
import { charterDoc } from './charter-doc.mjs';
import { startDeck } from './deck.mjs';
import * as mailbox from './mailbox.mjs';

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
      --with-policy             print the full governance text (the per-turn hook is short
                                on purpose; this is where the detail is paid for)
      --json                    machine-readable

  forge checklist <campaign>    RULE 014 — what was asked, against what was delivered
      --from "<request>"        decompose a request into items before work starts
      --mark <id> --status SUCCESS|FAILED|BLOCKED [--evidence "..."]
      --strict                  non-zero exit while any item is still PENDING
  forge verify [--campaign id]  RULE 013 — re-check EVIDENCE claims against the artifacts
      --record                  write the verdicts back as spotcheck rows
      --all                     show unverifiable claims too
  forge handoff <campaign> [task]
                                the prior agent's raw output block, verbatim. --flat for the
                                machine format
  forge benchmark [--top N]     reliability leaderboard and regressions, from this ledger
  forge bench-routing [file]    replay the golden routing set. Non-zero exit on a change
  forge explain <agent>         one agent's fully resolved prompt
      --all                     the whole system reference, generated
  forge new-agent --division .. --name .. --owns .. --capabilities a,b [--apply]
                                scaffold a specialist; refuses on RULE 004 overlap

  forge board                   the six seats, their portfolios and what each objects to
  forge roster [division]       who exists, what they own, what they refuse
  forge doctor                  the constitutional audit. Non-zero exit on any violation.
  forge build [--apply]         regenerate agents/ and the skill from the registry
  forge install [--apply] [--hooks]
                                install into ~/.claude (agents + skill; --hooks wires the
                                routing gate and session briefing too)
  forge charter [--apply]       regenerate CHARTER.md from the constitution

  forge deck [--port 7717]      open the Command Deck in a browser. Loopback only,
                                zero dependencies, reads this workspace's .forge/
  forge context                 the session briefing: what this workspace has taught the
                                organization. Prints nothing when nothing is known.

  forge inbox                   messages from the Principal waiting for an answer
  forge reply <id> --as <agent> "text"
                                answer one, as the agent that owns the question

  forge observe --agent <n> --capability <c> --outcome ok|partial|fail|blocked
      [--correction "..."] [--tokens N] [--campaign id]
                                record one outcome in this workspace's ledger

  forge audit                   semantic health — a division nobody uses, a capability with
                                no depth, an agent carrying too much, learning gone stale
  forge burn [--by capability|agent|campaign|outcome] [--top N]
                                where the tokens actually went
  forge ab-test "<task>"        routed against unrouted, from paired real runs
      --record --arm with-forge|without-forge [--minutes N] [--tokens N]
      [--satisfaction 1-5] [--tests-passed true|false]

  forge decide "<decision>"     record it with the position that lost (P6)
      --why .. --for a,b --against c --contested --minority ".." --rejected "x; y"
  forge postmortem <campaign>   what it cost, what went wrong, what to propose
  forge patterns [--min N]      agent sequences that keep recurring, and how they turn out
  forge compare "<request>"     the counterfactual: what a routing change would actually do
      --proposal <id> | --prefer <agent> | --avoid <agent>
  forge instruction --add ".."  a standing instruction for this workspace
      --applies-to <agent> --expires YYYY-MM-DD
  forge plugins                 installed validators, hooks and exporters
  forge export --format <name>  render the ledger through an installed exporter

  forge learn                   read the workspace and the ledger; write memory + profile,
                                and propose adaptations. Applies nothing.
  forge evolve                  review pending proposals
      --apply <id>              approve one. This is the only way anything is applied.
  forge memory                  what the organization currently believes about who is good at what
  forge spend                   measured workspace spend (from session transcripts) and
                                the attributed ledger, side by side

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
    const { routingBias } = await import('./tuning.mjs');
    const v = composeVector(request, o, { memory: currentMemory(), mode: flag('mode'), bias: routingBias() });
    const cost = estimateStages(v.stages, readLedger());
    // Fixed dispatch overhead: every staffed agent's rendered prompt is sent in full, and
    // that cost is knowable with no history at all — it is the size of files already on disk.
    // Leaving it out of the estimate made the largest predictable component of a campaign's
    // cost the one component the estimate never mentioned.
    const overhead = v.stages.reduce((sum, s) => {
      try {
        return sum + Math.round(fs.statSync(path.join(ROOT, 'agents', `${s.agent}.md`)).size / 4);
      } catch {
        return sum;
      }
    }, 0);
    if (flag('json')) console.log(JSON.stringify({ ...v, cost, promptOverhead: overhead }, null, 2));
    else {
      console.log(renderVector(v, o));
      console.log(`\nCOST, from this workspace's own history`);
      if (cost.total === null) console.log(`  ${cost.note}`);
      else console.log(`  task, from measured history   ~${cost.total.toLocaleString()} tokens · ${cost.note}`);
      console.log(`  fixed agent-dispatch overhead ~${overhead.toLocaleString()} tokens · ${v.stages.length} prompt(s), measured from agents/ on disk`);
      if (cost.total !== null) console.log(`  projected total               ~${(cost.total + overhead).toLocaleString()} tokens`);
      if (flag('with-policy')) {
        const { POLICY } = await import('./install.mjs');
        console.log(`\n${POLICY}\n`);
      }
    }
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
    // Machine-readable, so a script or an editor plugin does not have to parse the human
    // layout above — which is presentation and is allowed to change.
    if (flag('json')) {
      const mem = derivedMemory().memory;
      console.log(JSON.stringify(
        o.constitution.divisions
          .filter((d) => !only || d.id.toLowerCase().includes(only.toLowerCase()) || d.name.toLowerCase().includes(only.toLowerCase()))
          .map((d) => ({
            id: d.id,
            name: d.name,
            code: d.code,
            seat: o.seatOf.get(d.id),
            agents: (o.byDivision.get(d.id) || []).map((a) => ({
              id: a.id, name: a.name, role: a.role, model: a.model, writes: !!a.writes,
              capabilities: a.capabilities || [], owns: a.owns, refuses: a.refuses,
              reliability: mem[a.name] ? mem[a.name].reliability : null,
              observations: mem[a.name] ? mem[a.name].n : 0,
            })),
          })),
        null, 2,
      ));
      break;
    }
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
    // Custom validators run alongside the built-ins and may only make the audit stricter.
    // Reported by name, because a check running from an unlisted file is worse than no check.
    const { runValidators } = await import('./plugins.mjs');
    const o = org();
    const r = runDoctor(o);
    console.log(r.lines.join('\n'));
    const custom = await runValidators(o);
    let customFailed = 0;
    if (custom.length) {
      console.log(ui.rule('custom validators'));
      for (const c of custom) {
        for (const n of c.notes) {
          if (n.level === 'fail') customFailed += 1;
          console.log(ui[n.level] ? ui[n.level](`${c.name}  ${n.text}`) : `  ${n.level}  ${c.name}  ${n.text}`);
        }
        if (!c.notes.length) console.log(ui.pass(`${c.name}  passed`));
      }
      console.log(ui.rule());
      console.log(customFailed ? `  ${customFailed} custom validator failure(s) — this workspace's own rules` : `  ${custom.length} custom validator(s), all clean`);
    }
    console.log('');
    process.exit(r.ok && !customFailed ? 0 : 1);
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
    if (flag('hooks') && r.ok && r.applied) {
      const h = installHooks();
      console.log(`  hooks merged into ${h.file} — ${h.keysBefore} setting(s) before, ${h.keysAfter} after, nothing dropped.`);
      console.log('  Restart the host session for the hooks to load.\n');
    } else if (!flag('hooks')) {
      console.log('  add --hooks to also wire the routing gate and session briefing into ~/.claude/settings.json\n');
    }
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
    if (flag('vscode')) {
      // Drop the task file into the CURRENT project so ⌘⇧B works there, then tell the
      // Principal the two keystrokes. Never overwrites an existing tasks.json — a project's
      // own build tasks are not ours to replace.
      const dst = path.join(process.cwd(), '.vscode', 'tasks.json');
      if (fs.existsSync(dst)) {
        console.log(`  ${path.relative(process.cwd(), dst)} already exists — left alone. Add the task from ${path.join(ROOT, 'vscode', '.vscode', 'tasks.json')}`);
      } else {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(ROOT, 'vscode', '.vscode', 'tasks.json'), dst);
        console.log(`  wrote ${path.relative(process.cwd(), dst)} — press ⌘⇧B in VS Code to start the Console here`);
      }
      console.log('  then: ⌘⇧P → "Simple Browser: Show" → http://127.0.0.1:7717');
      console.log('  drag the tab beside your code and leave it there.\n');
    }
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

  case 'inbox': {
    const w = mailbox.waiting(process.cwd());
    if (!w.length) {
      console.log('\n  nothing waiting. The Principal has been answered.\n');
      break;
    }
    console.log(ui.head('INBOX — the Principal is waiting'));
    for (const m of w) {
      console.log(`\n  ${m.id}  [${m.kind}]  to ${m.to}  ·  ${m.at.slice(0, 16).replace('T', ' ')}`);
      console.log(`      ${m.body}${m.url ? `\n      ${m.url}` : ''}`);
    }
    console.log(`\n  answer with: forge reply <id> --as <agent-name> "the answer"\n`);
    break;
  }

  case 'reply': {
    const o = org();
    const re = positional()[0];
    const from = flag('as');
    const text = positional().slice(1).join(' ');
    if (!re || !from || !text) die('usage: forge reply <id> --as <agent-name> "the answer"');
    try {
      const row = mailbox.reply({ re, from: String(from), body: text }, o, process.cwd());
      console.log(`\n  ${row.from} answered ${re}. The Console shows it immediately.\n`);
    } catch (e) {
      die(e.message);
    }
    break;
  }

  case 'observe': {
    registerWorkspace(process.cwd());
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
          task: flag('task') === true ? null : flag('task'),
          // The grade and the artifacts are what make a claim spot-checkable at all. Without
          // them `forge verify` can only ever answer "unverifiable", which is why RULE 013
          // needed the ledger row to grow before it could mean anything.
          grade: flag('grade') === true ? null : flag('grade'),
          artifacts: flag('artifacts') === true || !flag('artifacts') ? null : String(flag('artifacts')).split(',').map((s) => s.trim()).filter(Boolean),
          raw_output: flag('raw') === true ? null : flag('raw'),
          trace: flag('trace') === true ? null : flag('trace'),
          hypothesis: flag('hypothesis') === true ? null : flag('hypothesis'),
        },
        process.cwd(),
      );
      console.log(`\n  recorded  ${row.agent} · ${row.capability} · ${row.outcome}${row.correction ? ` · correction noted` : ''}${row.grade ? ` · ${row.grade}` : ''}\n`);
    } catch (e) {
      die(e.message);
    }
    break;
  }

  case 'spend': {
    const m = measuredSpend();
    const rows = readLedger().filter((r) => r.agent);
    const attributed = rows.reduce((n, r) => n + (r.tokens || 0), 0);
    console.log(ui.head('SPEND'));
    if (m.available) {
      console.log(`\n  measured   ${(m.input + m.output).toLocaleString()} tokens across ${m.sessions} session(s) — provider-reported, from the transcripts`);
      console.log(`             ${m.input.toLocaleString()} in · ${m.output.toLocaleString()} out · ${m.cacheRead.toLocaleString()} cache reads (billed cheaper, listed apart)`);
    } else {
      console.log(`\n  measured   unavailable — ${m.why}`);
    }
    console.log(`  attributed ${attributed.toLocaleString()} tokens across ${rows.length} ledger row(s) — what campaigns reported about themselves`);
    if (m.available && attributed) {
      const pct = Math.round((attributed / Math.max(1, m.input + m.output)) * 100);
      console.log(`\n  ${pct}% of measured spend is attributed. The gap is work that never closed its ledger.`);
    }
    console.log('');
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
    registerWorkspace(process.cwd());
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
      console.log('\n  The organization proposes. You approve. Article 86: self-improvement is not self-modification.');
      console.log('  Ranked by measured impact — the share of observed work each one would actually change,');
      console.log('  not the order the code happened to generate them in.\n');
      // Highest impact first. Refused ones sink regardless: they cannot be applied, so they
      // are information rather than a decision, and putting them first wastes the attention
      // this ordering exists to protect.
      const ranked = [...proposals].sort((a, b) => (a.refused ? 1 : 0) - (b.refused ? 1 : 0) || (b.impactScore || 0) - (a.impactScore || 0));
      for (const p of ranked) {
        const badge = p.impact ? `${String(p.impact).toUpperCase()} impact` : 'impact unrated';
        console.log(`  ${p.id}  [${p.kind}]  ${badge}${p.affectsShare ? ` · touches ${p.affectsShare}% of observed work` : ''}`);
        console.log(`      ${p.change}`);
        console.log(`      because  ${p.observation}  (${p.grade})`);
        console.log(`      reversible: ${p.reversible ? 'yes — recorded with its undo' : p.reversibility || 'NO'}`);
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
    const { isExpired } = await import('./learn.mjs');
    const o = loadOverlay();
    console.log(ui.head('WORKSPACE OVERLAY'));
    if (!o.adaptations?.length) {
      console.log('\n  nothing approved in this workspace. The shipped organization is running unmodified.\n');
      break;
    }
    for (const a of o.adaptations) {
      const expired = isExpired(a);
      const scope = a.applies_to ? ` · applies to ${a.applies_to}` : '';
      // Expired entries are SHOWN, struck through in words rather than removed. The record of
      // what was in force and when is what makes a past decision explainable.
      const when = a.expires ? (expired ? ` · EXPIRED ${a.expires}, no longer in force` : ` · expires ${a.expires}`) : '';
      console.log(`\n  ${a.id} [${a.kind}]${expired ? ' (lapsed)' : ''} ${a.change}${scope}${when}`);
      console.log(`      because ${a.observation} (${a.grade})`);
    }
    const live = o.adaptations.filter((a) => !isExpired(a)).length;
    console.log(`\n  ${live} of ${o.adaptations.length} in force.\n`);
    break;
  }

  /**
   * A standing instruction, added by hand rather than proposed from the ledger.
   *
   * `forge learn` proposes an instruction after two corrections. This is for the case where
   * the Principal already knows the rule and does not want to be corrected twice to get it.
   */
  case 'instruction': {
    const { applyProposal, loadOverlay: lo } = await import('./learn.mjs');
    const text = flag('add');
    if (!text || text === true) {
      const o = lo();
      const inst = (o.adaptations || []).filter((a) => a.kind === 'instruction');
      console.log(ui.head('STANDING INSTRUCTIONS'));
      if (!inst.length) console.log('\n  none. Add one: forge instruction --add "..." --applies-to <agent> [--expires YYYY-MM-DD]\n');
      for (const a of inst) console.log(`\n  ${a.id}  ${a.change}${a.applies_to ? ` · ${a.applies_to}` : ''}${a.expires ? ` · expires ${a.expires}` : ''}`);
      console.log('');
      break;
    }
    const appliesTo = flag('applies-to');
    if (appliesTo && appliesTo !== true && !org().byName.has(String(appliesTo))) die(`no agent named "${appliesTo}". Try: forge roster`);
    const expires = flag('expires');
    if (expires && expires !== true && !Number.isFinite(new Date(String(expires)).getTime())) die(`--expires must be a date: --expires 2027-01-01`);
    const existing = (lo().adaptations || []).length;
    try {
      const written = applyProposal({
        id: `I${existing + 1}`,
        kind: 'instruction',
        agent: appliesTo === true ? null : appliesTo,
        appliesTo: appliesTo === true ? null : appliesTo,
        expires: expires === true ? null : expires,
        target: '.forge/overlay.yaml',
        change: String(text),
        observation: 'added directly by the Principal, not derived from the ledger',
        grade: 'UNKNOWN',
      }, process.cwd());
      console.log(`\n  in force: ${text}`);
      console.log(`  written to ${path.relative(process.cwd(), written)} — delete the block to withdraw it.\n`);
    } catch (e) { die(e.message); }
    break;
  }

  /**
   * RULE 014 — the completion audit, as a command that can fail a pipeline.
   *
   * A model asked "did you do everything?" answers yes, because the surrounding text rewards
   * yes. A file listing five items with two still PENDING cannot be talked around, and
   * `--strict` turns that into a non-zero exit the host cannot ignore.
   */
  case 'checklist': {
    const { decompose, writeChecklist, readChecklist, markItem, checklistComplete, listChecklists } = await import('./checklist.mjs');
    const campaign = positional()[0];

    if (!campaign) {
      const all = listChecklists();
      if (!all.length) die('no checklists in this workspace. Start one: forge checklist <campaign> --from "<request>"');
      console.log(ui.head('CHECKLISTS'));
      for (const l of all) {
        const open = l.items.filter((i) => i.status === 'PENDING').length;
        console.log(`\n  ${l.campaign}  ${l.items.length - open}/${l.items.length} closed${open ? `  — ${open} PENDING` : ''}`);
      }
      console.log('');
      break;
    }

    const from = flag('from');
    if (from && from !== true) {
      const items = decompose(String(from));
      if (!items.length) die('nothing decomposed out of that request');
      const list = writeChecklist(campaign, items, process.cwd(), { force: flag('force') === true });
      console.log(ui.head(`CHECKLIST ${campaign}`));
      console.log(`\n  ${list.items.length} item(s) captured before work starts:\n`);
      for (const i of list.items) console.log(`  ${String(i.id).padStart(3)}  PENDING  ${i.text}`);
      console.log('\n  Close each with: forge checklist ' + campaign + ' --mark <id> --status SUCCESS --evidence "..."\n');
      break;
    }

    const mark = flag('mark');
    if (mark && mark !== true) {
      try {
        const item = markItem(campaign, String(mark), String(flag('status') || 'SUCCESS'), {
          evidence: flag('evidence') === true ? null : flag('evidence'),
        });
        console.log(`\n  ${campaign} item ${item.id} → ${item.status}\n`);
      } catch (e) {
        die(e.message);
      }
      break;
    }

    const list = readChecklist(campaign);
    if (!list) die(`no checklist for campaign ${campaign}`);
    const state = checklistComplete(campaign);
    console.log(ui.head(`CHECKLIST ${campaign}`));
    console.log('');
    for (const i of list.items) {
      const badge = i.status === 'PENDING' ? 'PENDING ' : i.status.padEnd(8);
      console.log(`  ${String(i.id).padStart(3)}  ${badge} ${i.text}${i.evidence ? `\n           evidence: ${i.evidence}` : ''}`);
    }
    console.log(`\n  ${state.why}\n`);
    if (flag('strict') && !state.complete) {
      console.error(`  REFUSED — a campaign may not close over a pending item (RULE 014).\n`);
      process.exit(1);
    }
    break;
  }

  /** RULE 013 — re-check the EVIDENCE claims that are mechanically checkable. */
  case 'verify': {
    const { spotCheckCampaign, recordSpotChecks } = await import('./verify.mjs');
    const campaign = flag('campaign') === true ? null : flag('campaign');
    const report = spotCheckCampaign(campaign, { cwd: process.cwd() });
    console.log(ui.head(`SPOT-CHECK${campaign ? ` — ${campaign}` : ' — whole ledger'}`));
    if (!report.checked) {
      console.log('\n  nothing to check. Record claims with --grade EVIDENCE --artifacts <file:line> to make them checkable.\n');
      break;
    }
    console.log('');
    for (const r of report.results) {
      if (r.verdict === 'unverifiable' && !flag('all')) continue;
      const mark = { confirmed: 'PASS', contradicted: 'FAIL', unverifiable: 'SKIP' }[r.verdict];
      console.log(`  ${mark}  ${r.agent} · ${r.capability} — ${r.why}`);
    }
    console.log(
      `\n  ${report.tally.confirmed} confirmed · ${report.tally.contradicted} contradicted · ${report.tally.unverifiable} unverifiable`,
    );
    console.log('  unverifiable counts against nobody — an honestly unautomatable claim is not a false one.\n');
    if (flag('record')) {
      const n = recordSpotChecks(report, process.cwd());
      console.log(`  recorded ${n} verdict(s) to the ledger as spotcheck rows (they move evidence accuracy, never reliability).\n`);
    }
    if (report.tally.contradicted) process.exit(1);
    break;
  }

  /** Handoff, passed verbatim — a paraphrase is the whisper this command exists to remove. */
  case 'handoff': {
    const [campaign, task] = positional();
    if (!campaign) die('handoff needs a campaign: forge handoff <campaign-id> [task-id]');
    const rows = readLedger().filter((r) => r.campaign === campaign && (!task || String(r.task) === String(task)));
    if (!rows.length) die(`no ledger rows for campaign ${campaign}${task ? ` task ${task}` : ''}`);
    const last = rows[rows.length - 1];
    if (flag('flat')) {
      const { flatHandoff } = await import('./ledger.mjs');
      console.log(flatHandoff(last));
      break;
    }
    if (!last.raw_output) {
      die(`${last.agent} recorded no raw output for that task. Record it with: forge observe ... --raw "<the contract block>"`);
    }
    // Nothing but the block. Anything this command adds is something an operator might paste
    // onward as if the previous agent had written it.
    console.log(last.raw_output);
    break;
  }

  /** The leaderboard and the golden replay — the two things "benchmark" means. */
  case 'benchmark': {
    const { benchmarkReport } = await import('./benchmark.mjs');
    const rep = benchmarkReport();
    console.log(ui.head('BENCHMARK — measured in this workspace'));
    if (!rep.board.length) {
      console.log('\n  the ledger is empty. This is honest rather than useful: there is no starting number to invent.\n');
      break;
    }
    console.log('\n  agent                     capability            rate      n   evidence\n');
    for (const r of rep.board.slice(0, Number(flag('top') || 25))) {
      const ev = r.evidenceAccuracy === null ? '   —  ' : String(r.evidenceAccuracy).padEnd(6);
      console.log(`  ${r.agent.padEnd(24)}  ${String(r.capability).padEnd(20)}  ${String(r.reliability).padEnd(7)} ${String(r.n).padStart(3)}   ${ev}`);
    }
    if (rep.regressions.length) {
      console.log('\n  REGRESSIONS — recent work materially worse than earlier work\n');
      for (const r of rep.regressions) console.log(`  ${r.agent.padEnd(24)}  ${r.first} → ${r.last}  (${r.delta}, over ${r.n} observations)`);
    } else {
      console.log('\n  no regressions: nobody has 20+ observations with a >0.15 drop between first and last ten.');
    }
    console.log('');
    break;
  }

  case 'bench-routing': {
    const { loadGolden, replayGolden } = await import('./benchmark.mjs');
    const o = org();
    const file = positional()[0] || 'routing-golden.yaml';
    let golden;
    try {
      golden = loadGolden(file);
    } catch (e) {
      die(`could not read the golden set: ${e.message}`);
    }
    const rep = replayGolden(golden.cases || [], o, { memory: currentMemory() });
    console.log(ui.head('GOLDEN ROUTING REPLAY'));
    console.log('');
    for (const r of rep.results) {
      console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.request.replace(/\s+/g, ' ').slice(0, 78)}`);
      for (const f of r.failures) console.log(`        ${f}`);
    }
    console.log(`\n  ${rep.passed} passed · ${rep.failed} failed\n`);
    if (rep.failed) process.exit(1);
    break;
  }

  /** One generated reference for the whole system — or one agent's resolved prompt. */
  case 'explain': {
    const { explainAll, explainAgent } = await import('./explain.mjs');
    const o = org();
    if (flag('all')) {
      console.log(explainAll(o, { help: HELP }));
      break;
    }
    const name = positional()[0];
    if (!name) die('explain needs an agent name, or --all for the whole system reference');
    try {
      console.log(explainAgent(o, name));
    } catch (e) {
      die(e.message);
    }
    break;
  }

  /**
   * Scaffold a specialist. The point is not saving keystrokes — it is that the three things
   * people forget (the routing rule, the doctor run, the overlap check) all happen anyway.
   */
  case 'new-agent': {
    const { scaffoldAgent } = await import('./scaffold.mjs');
    try {
      const res = scaffoldAgent({
        division: flag('division'),
        name: flag('name'),
        owns: flag('owns'),
        capabilities: String(flag('capabilities') || '').split(',').map((s) => s.trim()).filter(Boolean),
        specialization: flag('specialization'),
        stance: flag('stance'),
        refuses: flag('refuses'),
        model: flag('model') || 'standard',
        writes: flag('writes') === 'true' || flag('writes') === true,
        apply: flag('apply') === true,
      });
      console.log(res.report);
      if (!res.applied) console.log('  Nothing was written. Re-run with --apply to append it to registry/roster.yaml.\n');
    } catch (e) {
      die(e.message);
    }
    break;
  }

  /** Semantic health — the things that are constitutional and still wrong. */
  case 'audit': {
    const { auditOrganization } = await import('./insight.mjs');
    const o = org();
    const r = auditOrganization(o, readLedger(), { now: new Date().toISOString() });
    console.log(ui.head('AUDIT — shape, not structure'));
    console.log(`\n  doctor checks whether the organization is constitutional. This checks whether it is\n  BALANCED, over ${r.observations} observation(s). Everything below is a judgement call.\n`);
    if (!r.findings.length) console.log('  nothing to flag.\n');
    for (const f of r.findings) console.log(`  ${f.level === 'warn' ? 'WARN' : 'note'}  ${f.text}`);
    console.log('');
    break;
  }

  /** Where the tokens went, grouped by something you can act on. */
  case 'burn': {
    const { burn, bar } = await import('./insight.mjs');
    const b = burn(readLedger());
    console.log(ui.head('BURN'));
    if (!b.rows) {
      console.log('\n  no attributed tokens yet. Record them: forge observe ... --tokens <estimate>\n');
      break;
    }
    console.log(`\n  ${b.total.toLocaleString()} attributed tokens across ${b.rows} row(s).`);
    console.log(`  ${b.wasted.toLocaleString()} (${b.wastedShare}%) went to work that failed.\n`);
    const by = flag('by') || 'capability';
    const group = { agent: b.byAgent, capability: b.byCapability, campaign: b.byCampaign, outcome: b.byOutcome }[by];
    if (!group) die(`--by must be agent, capability, campaign or outcome`);
    console.log(`  by ${by}:\n`);
    for (const g of group.slice(0, Number(flag('top') || 15))) {
      console.log(`  ${String(g.key).slice(0, 22).padEnd(24)} ${bar(g.share)} ${String(g.share).padStart(5)}%  ${g.tokens.toLocaleString().padStart(9)}  ${String(g.n).padStart(3)} row(s)`);
    }
    console.log('');
    break;
  }

  /** The paired comparison this project cannot otherwise make. */
  case 'ab-test': {
    const { recordAB, readAB, abSummary } = await import('./insight.mjs');
    const task = positional().join(' ');
    if (flag('record')) {
      if (!task) die('ab-test --record needs the task: forge ab-test "add rate limiting" --record --arm with-forge --minutes 25 --tokens 40000 --satisfaction 4');
      try {
        const row = recordAB({
          task,
          arm: String(flag('arm') || ''),
          minutes: flag('minutes'),
          tokens: flag('tokens'),
          testsPassed: flag('tests-passed') === true ? true : flag('tests-passed') === 'false' ? false : undefined,
          satisfaction: flag('satisfaction'),
          note: flag('note') === true ? null : flag('note'),
        }, process.cwd());
        console.log(`\n  recorded  ${row.task} · ${row.arm}\n`);
      } catch (e) { die(e.message); }
      break;
    }
    const s = abSummary(readAB());
    console.log(ui.head('A/B — routed against unrouted'));
    console.log(`\n  ${s.pairs} complete pair(s)${s.unpaired ? `, ${s.unpaired} task(s) with only one arm` : ''}.`);
    if (s.pairs) {
      console.log(`\n  tokens        ${s.tokenDelta > 0 ? '+' : ''}${s.tokenDelta} with routing`);
      console.log(`  minutes       ${s.minuteDelta > 0 ? '+' : ''}${s.minuteDelta} with routing`);
      console.log(`  satisfaction  ${s.satDelta === null ? 'not rated' : `${s.satDelta > 0 ? '+' : ''}${s.satDelta} with routing`}`);
      console.log(`  tests         ${s.testsBetter} pair(s) better routed, ${s.testsWorse} worse`);
    }
    console.log(`\n  ${s.verdict}\n`);
    console.log('  Run the same real task twice and record both arms. This is the only measurement');
    console.log('  here that compares the organization to the alternative rather than to itself.\n');
    break;
  }

  /** What has been plugged in, and what each seam is allowed to do. */
  case 'plugins': {
    const { pluginSummary, HOOK_EVENTS } = await import('./plugins.mjs');
    const s2 = await pluginSummary();
    console.log(ui.head('PLUGINS'));
    console.log(`\n  Three seams, each with a hard boundary. A hook runs AFTER a decision and its return`);
    console.log(`  value is discarded — it can notify, it cannot veto a gate or change a route. A validator`);
    console.log(`  may only make doctor STRICTER. An exporter returns a string and never sends it.\n`);
    const show = (label, list, note) => {
      console.log(ui.rule(label));
      if (!list.length) { console.log(`  none — create ~/.claude/forge-${label.toLowerCase()}/ to add some`); return; }
      for (const x of list) {
        console.log(x.broken ? `  BROKEN  ${x.name} — ${x.broken}` : `  ok      ${x.name}${x.on ? `  on: ${x.on.join(', ')}` : ''}`);
      }
      if (note) console.log(`  ${note}`);
    };
    show('Validators', s2.validators, 'run during `forge doctor`; may fail the audit');
    show('Hooks', s2.hooks, `events: ${HOOK_EVENTS.join(', ')}`);
    show('Exporters', s2.exporters, 'used by `forge export --format <name>`');
    console.log('');
    break;
  }

  case 'export': {
    const { loadExporters } = await import('./plugins.mjs');
    const name = flag('format');
    const all = await loadExporters();
    if (!name || name === true) {
      console.log(all.length ? `\n  available formats: ${all.filter((e) => !e.broken).map((e) => e.name).join(', ')}\n` : '\n  no exporters installed. Add one at ~/.claude/forge-exporters/<name>.mjs\n');
      break;
    }
    const e = all.find((x) => x.name === name);
    if (!e) die(`no exporter named "${name}". Installed: ${all.map((x) => x.name).join(', ') || 'none'}`);
    if (e.broken) die(`exporter "${name}" is broken: ${e.broken}`);
    const { burn } = await import('./insight.mjs');
    const rows = readLedger();
    try {
      // The exporter returns a string; this prints it. It never sends anything — egress is a
      // gate, and a read command must not cross one on the Principal's behalf.
      console.log(await e.format({ rows, memory: derivedMemory().memory, burn: burn(rows), workspace: process.cwd() }));
    } catch (err) {
      die(`exporter "${name}" threw: ${err.message}`);
    }
    break;
  }

  /** Decisions, and the dissent that would otherwise scroll away (P6). */
  case 'decide': {
    const { recordDecision, readDecisions } = await import('./minutes.mjs');
    const text = positional().join(' ');
    if (!text) {
      const all = readDecisions();
      console.log(ui.head('DECISIONS'));
      if (!all.length) {
        console.log('\n  nothing recorded. A decision that lives only in a message is a decision nobody can audit.');
        console.log('  forge decide "<what was decided>" --why "..." --contested --minority "who disagreed and why"\n');
        break;
      }
      for (const d of all.slice(-Number(flag('last') || 15))) {
        console.log(`\n  ${d.at.slice(0, 10)}  ${d.campaign || 'no campaign'}${d.contested ? '  [CONTESTED]' : ''}`);
        console.log(`      ${d.decision}`);
        if (d.why) console.log(`      because ${d.why}`);
        if (d.for.length || d.against.length) console.log(`      for: ${d.for.join(', ') || '—'}  ·  against: ${d.against.join(', ') || '—'}`);
        if (d.minority) console.log(`      MINORITY: ${d.minority}`);
        if (d.alternatives.length) console.log(`      rejected: ${d.alternatives.join('; ')}`);
      }
      const contested = all.filter((d) => d.contested).length;
      console.log(`\n  ${all.length} decision(s), ${contested} contested — each with the position that lost.\n`);
      break;
    }
    try {
      const row = recordDecision({
        campaign: flag('campaign') === true ? null : flag('campaign'),
        stage: flag('stage') === true ? null : flag('stage'),
        decision: text,
        why: flag('why') === true ? null : flag('why'),
        for: flag('for') === true || !flag('for') ? [] : String(flag('for')).split(',').map((x) => x.trim()),
        against: flag('against') === true || !flag('against') ? [] : String(flag('against')).split(',').map((x) => x.trim()),
        contested: flag('contested') === true,
        minority: flag('minority') === true ? null : flag('minority'),
        alternatives: flag('rejected') === true || !flag('rejected') ? [] : String(flag('rejected')).split(';').map((x) => x.trim()),
        grade: flag('grade') === true ? 'UNKNOWN' : flag('grade'),
      }, process.cwd());
      console.log(`\n  recorded${row.contested ? ' (contested — the minority position is on the record)' : ''}\n`);
    } catch (e) { die(e.message); }
    break;
  }

  /** What a campaign cost, what it got wrong, and what to propose because of it. */
  case 'postmortem': {
    const { postmortem } = await import('./minutes.mjs');
    const { checklistComplete } = await import('./checklist.mjs');
    const campaign = positional()[0] || (flag('campaign') === true ? null : flag('campaign'));
    if (!campaign) die('postmortem needs a campaign: forge postmortem <campaign-id>');
    const cl = checklistComplete(campaign);
    const r = postmortem(campaign, process.cwd(), { checklist: cl.missing ? null : cl });
    if (!r.found) die(`no ledger rows for campaign ${campaign}`);
    console.log(ui.head(`POST-MORTEM — ${campaign}`));
    console.log(`\n  ${r.stages} stage(s) · ${r.tokens.toLocaleString()} tokens · ${r.wasted.toLocaleString()} (${r.wastedShare}%) spent on work that failed`);
    console.log(`\n  ${r.verdict}\n`);
    for (const f of r.failures) console.log(`  FAILED       ${f.agent} · ${f.capability}${f.note ? ` — ${f.note}` : ''}`);
    for (const b of r.blocked) console.log(`  BLOCKED      ${b.agent} · ${b.capability} (not the agent's fault)`);
    for (const c of r.corrections) console.log(`  CORRECTED    ${c.agent} — "${c.text}"`);
    for (const c of r.contradicted) console.log(`  CONTRADICTED ${c.agent} — ${c.why}`);
    if (r.openItems && r.openItems.length) {
      console.log(`\n  NEVER CLOSED — the campaign reported done over these:`);
      for (const i of r.openItems) console.log(`    · ${i}`);
    }
    if (r.lessons.length) {
      console.log(`\n  WHAT TO PROPOSE (these are proposals, not changes — Article 86):\n`);
      for (const l of r.lessons) console.log(`  [${l.kind}] ${l.change}\n      because ${l.why}`);
    }
    console.log('');
    break;
  }

  /** Sequences that keep recurring, and whether they work. */
  case 'patterns': {
    const { campaignPatterns } = await import('./minutes.mjs');
    const pats = campaignPatterns(readLedger(), { minRuns: Number(flag('min') || 3) });
    console.log(ui.head('CAMPAIGN PATTERNS'));
    if (!pats.length) {
      console.log(`\n  no sequence has run ${flag('min') || 3}+ times yet. Two campaigns sharing a shape is a`);
      console.log('  coincidence, and promoting a coincidence into a routing rule teaches superstition.\n');
      break;
    }
    console.log('');
    for (const p2 of pats) {
      console.log(`  ${p2.runs}× · ${Math.round(p2.successRate * 100)}% clean · ~${p2.avgTokens.toLocaleString()} tokens`);
      console.log(`      ${p2.sequence.join(' → ')}`);
    }
    console.log('');
    break;
  }

  /**
   * What a proposal would actually do — the counterfactual, before approving it.
   *
   * A routing proposal is currently approved on its stated reason alone. This replays the
   * same request with the proposal's bias applied and shows who would be staffed instead,
   * so the decision is about a consequence rather than about a sentence.
   */
  case 'compare': {
    const { compareVectors } = await import('./insight.mjs');
    const request = positional().join(' ');
    if (!request) die('compare needs a request: forge compare "add rate limiting" --proposal P1');
    const o = org();
    const { routingBias } = await import('./tuning.mjs');
    const memory = currentMemory();
    const current = composeVector(request, o, { memory, bias: routingBias() });

    // The proposed world: either a named pending proposal, or an explicit --prefer/--avoid.
    let bias = { ...routingBias() };
    let label = '';
    const pid = flag('proposal');
    if (pid && pid !== true) {
      const f2 = files();
      if (!fs.existsSync(f2.proposals)) die('no proposals. Run `forge learn` first.');
      const pr = JSON.parse(fs.readFileSync(f2.proposals, 'utf8')).find((x) => x.id === pid);
      if (!pr) die(`no proposal ${pid}`);
      if (pr.kind !== 'routing') die(`${pid} is a ${pr.kind} proposal — only a routing proposal changes a Vector`);
      bias[pr.agent] = 0.55;
      label = `${pid}: ${pr.change}`;
    } else if (flag('avoid') && flag('avoid') !== true) {
      bias[String(flag('avoid'))] = 0.55;
      label = `de-prefer ${flag('avoid')}`;
    } else if (flag('prefer') && flag('prefer') !== true) {
      bias[String(flag('prefer'))] = 1.45;
      label = `prefer ${flag('prefer')}`;
    } else {
      die('compare needs --proposal <id>, --prefer <agent> or --avoid <agent>');
    }

    const proposed = composeVector(request, o, { memory, bias });
    const c = compareVectors(current, proposed);
    console.log(ui.head('COUNTERFACTUAL'));
    console.log(`\n  request   ${request}`);
    console.log(`  change    ${label}\n`);
    if (!c.changes.length) {
      console.log('  NO DIFFERENCE. This change would not alter the plan for this request —');
      console.log('  which is worth knowing before approving it on the strength of its reason.\n');
      break;
    }
    for (const ch of c.changes) {
      if (ch.kind === 'reassigned') console.log(`  ${ch.id}  ${ch.capability.padEnd(14)} ${ch.from} (${ch.scoreFrom})  →  ${ch.to} (${ch.scoreTo})`);
      if (ch.kind === 'dropped') console.log(`  ${ch.id}  ${ch.capability.padEnd(14)} ${ch.from}  →  nobody`);
      if (ch.kind === 'added') console.log(`  ${ch.id}  ${ch.capability.padEnd(14)} nobody  →  ${ch.to}`);
    }
    console.log(`\n  ${c.changes.length} stage(s) change, ${c.unchanged} unaffected.`);
    console.log(`  average score ${c.currentAvg} → ${c.proposedAvg} (${c.delta > 0 ? '+' : ''}${c.delta})`);
    console.log(`\n  A higher average is not automatically better — it can mean the router simply found`);
    console.log('  a more confident agent for a task the de-preferred one was actually right for.\n');
    break;
  }

  default:
    die(`unknown command "${cmd}".${HELP}`);
}
