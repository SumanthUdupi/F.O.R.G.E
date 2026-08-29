/**
 * The campaign retrospective — a timeline you can look at, and the reasoning behind it.
 *
 * `forge postmortem` answers "what went wrong". This answers "what HAPPENED", in order, with
 * cost and gates and decisions on the same line of time. They are different questions: one is
 * for fixing, this one is for understanding a campaign you did not watch.
 *
 * Rendered as a self-contained HTML file with no dependency and no network — same constraint
 * as the Console. It opens from disk with a double-click, which matters because the audience
 * for a retrospective is often someone who does not have the CLI.
 */

import fs from 'node:fs';
import path from 'node:path';
import { workspaceDir } from './core.mjs';
import { readLedger, derive, parentCampaign } from './ledger.mjs';
import { readDecisions } from './minutes.mjs';

/**
 * Agent reasoning, kept apart from the ledger on purpose.
 *
 * The ledger is the record routing depends on; polluting it with narration would mean every
 * derivation walks past text nothing reads. `.forge/reasoning.jsonl` is DIAGNOSTIC ONLY —
 * `derive()` never opens it, and deleting it changes no score.
 */
const reasoningPath = (cwd) => path.join(workspaceDir(cwd), 'reasoning.jsonl');

export const recordReasoning = (entry, cwd = process.cwd()) => {
  if (!entry || !entry.agent || !entry.text) throw new Error('a reasoning entry needs an agent and text');
  const row = {
    at: entry.at || new Date().toISOString(),
    agent: entry.agent,
    campaign: entry.campaign || null,
    stage: entry.stage || null,
    considered: [].concat(entry.considered || []),
    text: String(entry.text),
  };
  fs.mkdirSync(path.dirname(reasoningPath(cwd)), { recursive: true });
  fs.appendFileSync(reasoningPath(cwd), `${JSON.stringify(row)}\n`);
  return row;
};

export const readReasoning = (cwd = process.cwd()) => {
  const p = reasoningPath(cwd);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
};

/** Everything that happened in one campaign, in time order, from every source. */
export const timeline = (campaign, cwd = process.cwd()) => {
  const rows = readLedger(cwd).filter((r) => r.campaign === campaign || parentCampaign(r.campaign) === campaign);
  const decisions = readDecisions(cwd).filter((d) => d.campaign === campaign || parentCampaign(d.campaign) === campaign);
  const reasoning = readReasoning(cwd).filter((r) => r.campaign === campaign);

  const events = [
    ...rows.filter((r) => r.kind !== 'spotcheck').map((r) => ({ at: r.at, kind: 'work', agent: r.agent, capability: r.capability, outcome: r.outcome, tokens: r.tokens || 0, grade: r.grade, note: r.note, correction: r.correction, sub: r.campaign })),
    ...rows.filter((r) => r.kind === 'spotcheck').map((r) => ({ at: r.at, kind: 'spotcheck', agent: r.agent, outcome: r.outcome, note: r.note })),
    ...decisions.map((d) => ({ at: d.at, kind: 'decision', text: d.decision, contested: d.contested, minority: d.minority, alternatives: d.alternatives })),
    ...reasoning.map((r) => ({ at: r.at, kind: 'reasoning', agent: r.agent, text: r.text, considered: r.considered })),
  ].sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const work = events.filter((e) => e.kind === 'work');
  return {
    campaign,
    events,
    found: events.length > 0,
    tokens: work.reduce((n, e) => n + e.tokens, 0),
    stages: work.length,
    failed: work.filter((e) => e.outcome === 'fail').length,
    agents: [...new Set(work.map((e) => e.agent))],
    subCampaigns: [...new Set(rows.map((r) => r.campaign).filter((c) => c !== campaign))],
    memory: derive(rows).memory,
  };
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Render the timeline as one standalone HTML file.
 *
 * Same three-state theming as the Console (explicit choice, else the OS), and the same
 * semantic tokens — so a retrospective opened next to the Console does not look like it came
 * from a different product.
 */
export const renderRetro = (t) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Retrospective — ${esc(t.campaign)}</title>
<style>
:root{--paper:#f5efe3;--card:#fffdf8;--card-2:#fbf6ec;--ink:#2b2117;--ink-2:#6d5f4e;--faint:#a08f78;--line:#e6dbc6;
--copper:#b05f2a;--good:#3d7a5c;--warn:#a8741c;--bad:#b23b3b;--mark:#0d8ea3;
--sans:"Avenir Next","Inter Tight",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;--mono:ui-monospace,"SF Mono",Menlo,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--paper:#14161a;--card:#1c1f25;--card-2:#23272e;--ink:#e9e4da;--ink-2:#a9a294;--faint:#756e60;--line:#2c313a;--copper:#d98a4e;--good:#5fb98a;--warn:#d3a44a;--bad:#e0706b;--mark:#35b4c9}}
:root[data-theme="dark"]{--paper:#14161a;--card:#1c1f25;--card-2:#23272e;--ink:#e9e4da;--ink-2:#a9a294;--faint:#756e60;--line:#2c313a;--copper:#d98a4e;--good:#5fb98a;--warn:#d3a44a;--bad:#e0706b;--mark:#35b4c9}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
.wrap{max-width:860px;margin:0 auto;padding:40px 24px 80px}
h1{font-size:26px;margin:0 0 4px;letter-spacing:-.01em}.sub{color:var(--ink-2);margin:0 0 28px}
.stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:32px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px;min-width:110px}
.stat b{display:block;font-size:22px;font-variant-numeric:tabular-nums}.stat span{font-size:11px;color:var(--faint);letter-spacing:.1em;text-transform:uppercase}
.tl{position:relative;padding-left:26px}.tl::before{content:"";position:absolute;left:7px;top:6px;bottom:6px;width:2px;background:var(--line)}
.ev{position:relative;margin-bottom:14px}
.ev::before{content:"";position:absolute;left:-24px;top:7px;width:10px;height:10px;border-radius:50%;background:var(--faint);box-shadow:0 0 0 3px var(--paper)}
.ev.ok::before{background:var(--good)}.ev.fail::before{background:var(--bad)}.ev.blocked::before{background:var(--warn)}
.ev.decision::before{background:var(--copper)}.ev.reasoning::before{background:var(--mark)}.ev.spotcheck::before{background:var(--ink-2)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px}
.card.q{background:var(--card-2)}
.who{font-weight:600}.meta{color:var(--faint);font:11px/1.4 var(--mono);margin-top:3px}
.txt{color:var(--ink-2);margin-top:6px;font-size:14px}
.min{margin-top:8px;padding:8px 12px;border-left:3px solid var(--copper);background:var(--card-2);font-size:13px}
.empty{color:var(--faint);font-style:italic}
footer{margin-top:40px;color:var(--faint);font-size:12px;border-top:1px solid var(--line);padding-top:14px}
</style></head><body><div class="wrap">
<h1>${esc(t.campaign)}</h1>
<p class="sub">${t.stages} stage(s) · ${t.agents.length} agent(s)${t.subCampaigns.length ? ` · ${t.subCampaigns.length} sub-campaign(s)` : ''}</p>
<div class="stats">
  <div class="stat"><b>${t.stages}</b><span>stages</span></div>
  <div class="stat"><b>${t.tokens.toLocaleString()}</b><span>tokens</span></div>
  <div class="stat"><b>${t.failed}</b><span>failed</span></div>
  <div class="stat"><b>${t.events.filter((e) => e.kind === 'decision').length}</b><span>decisions</span></div>
</div>
<div class="tl">
${t.events.map((e) => {
  const cls = e.kind === 'work' ? (e.outcome || '') : e.kind;
  if (e.kind === 'decision') {
    return `<div class="ev decision"><div class="card"><div class="who">Decision${e.contested ? ' — contested' : ''}</div>
      <div class="meta">${esc(e.at)}</div><div class="txt">${esc(e.text)}</div>
      ${e.minority ? `<div class="min"><b>Minority:</b> ${esc(e.minority)}</div>` : ''}
      ${(e.alternatives || []).length ? `<div class="meta">rejected: ${esc(e.alternatives.join('; '))}</div>` : ''}</div></div>`;
  }
  if (e.kind === 'reasoning') {
    return `<div class="ev reasoning"><div class="card q"><div class="who">${esc(e.agent)} — reasoning</div>
      <div class="meta">${esc(e.at)}${(e.considered || []).length ? ` · considered ${esc(e.considered.join(', '))}` : ''}</div>
      <div class="txt">${esc(e.text)}</div></div></div>`;
  }
  if (e.kind === 'spotcheck') {
    return `<div class="ev spotcheck"><div class="card q"><div class="who">spot-check — ${esc(e.agent)}</div>
      <div class="meta">${esc(e.at)} · ${e.outcome === 'ok' ? 'confirmed' : 'CONTRADICTED'}</div>
      <div class="txt">${esc(e.note)}</div></div></div>`;
  }
  return `<div class="ev ${cls}"><div class="card"><div class="who">${esc(e.agent)}<span style="color:var(--faint);font-weight:400"> · ${esc(e.capability)}</span></div>
    <div class="meta">${esc(e.at)} · ${esc(e.outcome)}${e.tokens ? ` · ${e.tokens.toLocaleString()} tokens` : ''}${e.grade ? ` · ${esc(e.grade)}` : ''}${e.sub && e.sub !== t.campaign ? ` · ${esc(e.sub)}` : ''}</div>
    ${e.note ? `<div class="txt">${esc(e.note)}</div>` : ''}
    ${e.correction ? `<div class="min"><b>Corrected:</b> ${esc(e.correction)}</div>` : ''}</div></div>`;
}).join('\n') || '<p class="empty">Nothing recorded for this campaign.</p>'}
</div>
<footer>Generated by <code>forge retro ${esc(t.campaign)}</code> from this workspace's ledger. Derived, not authored — regenerate rather than edit.</footer>
</div></body></html>`;
