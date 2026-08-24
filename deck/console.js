/**
 * The Console, third shape: the office IS the app.
 *
 * The Principal's direction, verbatim in spirit: "I need the whole console within the
 * office. I don't need the menu slider bar at all." So the sidebar is gone and every
 * feature is REHOMED to the place in the office where it belongs — nothing dropped:
 *
 *   click a person        → their profile, your conversation with them, Ask/Do composer
 *   Discovery Lab room    → ideas and repos-to-study live in the lab
 *   Core Treasury room    → spending, measured and attributed
 *   Directorate room      → the plan composer (Vectors are the Directorate's craft)
 *   Workforce Health room → recognition, earned from the ledger
 *   Archives room         → what the team knows here, and what is in force
 *   the board table       → the rules, the gates, the health check
 *   your reception desk   → approvals and the quick ask
 *   the elevator          → Claude Code sessions, and other places the org has worked
 *
 * The floor mounts ONCE and is never repainted by a data refresh — the drawer is the only
 * thing that re-renders. That structural choice retires the whole family of "the refresh
 * destroyed what I was typing" bugs the sidebar console kept having to defend against.
 *
 * Old ?view= deep links translate to drawer opens, so bookmarks and the E2E stay honest.
 */

import * as Office from '/office.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  org: null, live: null, mail: null, tokens: null, rewards: null, wsinfo: null, sessions: null, runsActive: [],
  ws: null, drawer: null, recipient: 'chair', draft: {}, mode: 'ask', run: null, orgSessions: null, activity: null,
};

const api = async (path, body) => {
  const sep = path.includes('?') ? '&' : '?';
  const url = state.ws ? `${path}${sep}ws=${encodeURIComponent(state.ws)}` : path;
  const res = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await res.json();
  if (!res.ok) throw new Error(`${data.error || 'something went wrong'}`);
  return data;
};

const ago = (iso) => {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const HUES = ['#b05f2a', '#0d8ea3', '#3d7a5c', '#a8741c', '#7d5a7a', '#6b7c8f'];
const avatar = (name, kind = '') => {
  const initials = kind === 'you' ? 'You' : name.split('-').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const hue = kind === 'you' ? 'var(--copper)' : HUES[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % HUES.length];
  return `<span class="av" style="background:${hue}" title="${esc(name)}">${esc(initials)}</span>`;
};

const divOf = (id) => state.org.divisions.find((d) => d.id === id);
const agentOf = (name) => {
  for (const d of state.org.divisions) {
    const a = d.agents.find((x) => x.name === name);
    if (a) return { ...a, divisionName: d.name };
  }
  const s = state.org.seats.find((x) => x.name === name);
  return s ? { name: s.name, role: 'board', owns: s.owns, refuses: s.refuses, stance: s.stance, divisionName: s.seat } : null;
};
const threadsFor = (who) => ((state.mail && state.mail.threads) || []).filter((t) => t.to === who && t.kind === 'message');
const pendingProposals = () => (state.live.proposals || []).filter((p) => !p.refused && !(state.live.overlay || []).some((a) => a.id === p.id));
const OUTCOME_WORDS = { ok: 'went well', partial: 'partly done', fail: "didn't work", blocked: 'is waiting on approval' };

// ── drawer bodies — every old view, rehomed ──────────────────────────────────────────

const personDrawer = (name) => {
  const a = agentOf(name);
  if (!a) return `<p class="empty">Nobody called ${esc(name)} works here.</p>`;
  const m = state.live.memory[name];
  const thread = threadsFor(name)
    .slice(0, 12)
    .reverse()
    .map(
      (t) => `<div class="msgrow mine">${avatar('You', 'you')}<div class="msg mine"><div class="who">You · ${ago(t.at)}</div>${esc(t.body)}</div></div>
      ${t.replies.map((r) => `<div class="msgrow">${avatar(r.from)}<div class="msg theirs"><div class="who">${esc(r.from)} · ${ago(r.at)}</div>${esc(r.body)}</div></div>`).join('')}
      ${!t.answered ? `<p class="pendingnote">Waiting…</p>` : ''}`,
    )
    .join('');

  return `
    <div class="dhead">${avatar(name)}<div><h2>${esc(name)}</h2><p>${esc(a.divisionName)} · ${esc(a.role)}${m ? ` · <b class="${m.reliability >= 0.75 ? 'ok' : m.reliability < 0.55 ? 'bad' : ''}">${Math.round(m.reliability * 100)}% reliable</b>` : ''}</p></div></div>
    <details class="dmeta"><summary>What they own, and what they refuse</summary>
      <p><b>Owns:</b> ${esc(a.owns)}</p><p><b>Won't do:</b> ${esc(a.refuses)}</p></details>
    <div class="thread">${thread || `<p class="empty">No conversation yet. Say hello.</p>`}</div>
    ${state.run ? `<div class="msgrow">${avatar('the organization')}<div class="msg theirs live"><div class="who">working<span class="workdots"></span></div>${esc(state.run.text || '')}${state.run.tool ? `<div class="toolline">using ${esc(state.run.tool)}…</div>` : ''}</div></div><p class="pendingnote"><button class="go quiet" id="runkill">Stop</button></p>` : ''}
    <div class="composer2">
      <textarea id="chatbody" placeholder="Write to ${esc(name)}…">${esc(state.draft[name] || '')}</textarea>
      <div class="crow">
        <span class="modeswitch"><button class="modeopt ${state.mode !== 'do' ? 'on' : ''}" data-mode="ask" title="Answers only — cannot change files.">Ask</button><button class="modeopt ${state.mode === 'do' ? 'on' : ''}" data-mode="do" title="A live work order in this workspace.">Do</button></span>
        <button class="go" id="chatsend"${state.run ? ' disabled' : ''}>${state.run ? 'Working…' : 'Send'}</button>
      </div>
      <p class="hint">${state.mode === 'do' ? 'Do runs Claude Code here, live.' : 'Ask cannot change anything.'} ⌘↵ sends.</p>
    </div>`;
};

const roomExtras = {
  'DIV-DSC': () => {
    const ideas = ((state.mail && state.mail.threads) || []).filter((t) => t.kind === 'idea').slice(0, 4);
    const repos = ((state.mail && state.mail.threads) || []).filter((t) => t.kind === 'repo').slice(0, 4);
    return `
      <h3 class="dsec">DROP AN IDEA</h3>
      <textarea id="ideabody" placeholder="Anything worth looking into — the Lab researches it and answers."></textarea>
      <button class="go" id="ideasend" style="margin-top:8px">Send to the Lab</button>
      <h3 class="dsec">REPO TO STUDY</h3>
      <input type="text" id="repourl" placeholder="https://github.com/…" autocomplete="off">
      <textarea id="repogoal" style="margin-top:8px" placeholder="What do you want from it?"></textarea>
      <button class="go" id="reposend" style="margin-top:8px">Send for study</button>
      ${[...repos, ...ideas].map((t) => `<div class="minithread"><span class="chip ${t.answered ? 'good' : 'warn'}">${t.answered ? 'Answered' : t.kind === 'repo' ? 'Queued' : 'Considering'}</span> ${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noreferrer">${esc(t.url.replace('https://github.com/', ''))}</a> — ` : ''}${esc(t.body.slice(0, 90))}${t.replies[0] ? `<div class="minireply">${esc(t.replies[0].body.slice(0, 220))}</div>` : ''}</div>`).join('')}`;
  },
  'DIV-TRS': () => {
    const t = state.tokens;
    const m = t.measured || {};
    const campaigns = Object.entries(t.byCampaign || {}).sort((a, b) => b[1].tokens - a[1].tokens).slice(0, 6);
    const max = Math.max(1, ...campaigns.map(([, v]) => v.tokens));
    return `
      <h3 class="dsec">SPENDING</h3>
      ${m.available ? `<p class="bignum" style="font-size:26px">${(m.input + m.output).toLocaleString()}<small> measured tokens · ${m.sessions} sessions</small></p><p class="hint">${m.cacheRead.toLocaleString()} cache reads listed apart — they bill far cheaper.</p>` : `<p class="empty">No transcripts here yet — the measured number appears after the first session.</p>`}
      <p class="bignum" style="font-size:22px">${t.total.toLocaleString()}<small> attributed · self-reported by campaigns</small></p>
      ${campaigns.length ? `<h3 class="dsec">BY CAMPAIGN</h3>${campaigns.map(([n, v]) => `<div class="barrow"><span>${esc(n)}</span><span class="track"><i style="width:${Math.max(3, Math.round((v.tokens / max) * 100))}%"></i></span><span class="val">${v.tokens.toLocaleString()}</span></div>`).join('')}` : ''}`;
  },
  'DIV-WFH': () => {
    const r = state.rewards;
    const any = r.streaks.length || r.improved.length || r.reliable.length;
    return `<h3 class="dsec">RECOGNITION — earned, never granted</h3>
      ${any ? `${r.streaks.map((x) => `<p>🔥 <b>${esc(x.agent)}</b> — ${x.streak} good results in a row</p>`).join('')}
      ${r.improved.map((x) => `<p>📈 <b>${esc(x.agent)}</b> — most improved</p>`).join('')}
      ${r.reliable.map((x) => `<p>🏅 <b>${esc(x.agent)}</b> — ${Math.round(x.reliability * 100)}% over ${x.n} tasks</p>`).join('')}`
      : '<p class="empty">Appears once the team has a track record — computed from outcomes, so it cannot be gamed.</p>'}`;
  },
  'DIV-ARC': () => `
    <h3 class="dsec">WHAT THE TEAM KNOWS HERE</h3>
    ${Object.entries(state.live.profile)
      .filter(([, v]) => v.grade !== 'UNKNOWN' && v.value !== null && v.value !== false && !(Array.isArray(v.value) && !v.value.length))
      .map(([k, v]) => `<p><b>${esc(k.replace(/([A-Z])/g, ' $1').toLowerCase())}</b>: ${esc(Array.isArray(v.value) ? v.value.join(', ') : String(v.value))} <span class="chip ${v.grade === 'EVIDENCE' ? 'good' : 'warn'}">${esc(v.grade)}</span></p>`)
      .join('') || '<p class="empty">Nothing learned yet — it reads the workspace the first time it works here.</p>'}
    <h3 class="dsec">IN FORCE — approved by you</h3>
    ${(state.live.overlay || []).map((a) => `<p class="minithread">${esc(a.change)}</p>`).join('') || '<p class="empty">Nothing yet. Approvals land at your reception desk.</p>'}`,
  'DIV-DIR': () => {
    const v = state.plan;
    const PHASE_WORDS = { frame: 'Understand', design: 'Shape it', build: 'Build', verify: 'Check it', release: 'Ship it', deliver: 'Report back' };
    let out = `<h3 class="dsec">PLAN SOMETHING — see who works, where it pauses, what it costs</h3>
      <input type="text" id="planreq" placeholder="e.g. add rate limiting to the api and deploy it" autocomplete="off" value="${esc(v ? v.request : '')}">
      <button class="go" id="plango" style="margin-top:8px"${state.planning ? ' disabled' : ''}>${state.planning ? 'Planning…' : 'Show me the plan'}</button>
      <p class="hint">Computed by fixed rules — asking twice gives the same answer. Nothing starts until you take it to a session.</p>`;
    if (v) {
      out += `<p><span class="chip good">${esc(v.mode)}</span> ${v.cost && v.cost.total !== null ? `<b>~${v.cost.total.toLocaleString()} tokens</b>, from this workspace's history` : ''}</p>`;
      for (const g of v.gates) out += `<p class="minithread">⏸ <b>${esc(g.title)}</b> — pauses for you</p>`;
      let phase = null;
      for (const s of v.stages) {
        if (s.phase !== phase) { phase = s.phase; out += `<h3 class="dsec">${esc((PHASE_WORDS[phase] || phase).toUpperCase())}</h3>`; }
        out += `<p>${avatar(s.agent)} <b>${esc(s.agent)}</b> <span class="chip ${s.writes ? 'warn' : 'plain'}">${s.writes ? 'changes files' : 'reads'}</span>${s.gate ? ' <span class="chip bad">pauses</span>' : ''}</p>`;
      }
    }
    return out;
  },
};

const roomDrawer = (id) => {
  const d = divOf(id);
  const st = state.live.status[id] || { state: 'idle' };
  const mgr = d.agents.find((a) => a.role === 'manager');
  const specialists = d.agents.filter((a) => a.role === 'specialist');
  return `
    <div class="dhead"><span class="dot ${esc(st.state)}" style="width:12px;height:12px"></span><div><h2>${esc(d.name)}</h2><p>${esc(d.mission)}</p></div></div>
    ${d.mayHalt ? '<p class="chip bad">may halt a campaign</p>' : ''}
    <h3 class="dsec">PEOPLE — click to talk</h3>
    <div class="peoplerow">
      <button class="personbtn" data-person="${esc(mgr.name)}">${avatar(mgr.name)}<span>${esc(mgr.name)}<small>manager</small></span></button>
      ${specialists.map((a) => {
        const m = state.live.memory[a.name];
        return `<button class="personbtn" data-person="${esc(a.name)}">${avatar(a.name)}<span>${esc(a.name)}<small>${m ? `${Math.round(m.reliability * 100)}%` : 'unmeasured'}</small></span></button>`;
      }).join('')}
    </div>
    ${roomExtras[id] ? roomExtras[id]() : ''}`;
};

const boardDrawer = () => `
  <div class="dhead"><h2>The Board</h2></div>
  <p class="hint">Six seats, no head chair. A deadlock comes to you — that's the design.</p>
  <div class="peoplerow">${state.org.seats.map((s) => `<button class="personbtn" data-person="${esc(s.name)}">${avatar(s.name)}<span>${esc(s.seat)}<small>${s.isChair ? 'convenes' : 'seat'}</small></span></button>`).join('')}</div>
  <h3 class="dsec">WHAT STOPS IT DOING SOMETHING STUPID</h3>
  ${state.org.gates.map((g) => `<p class="minithread">⏸ <b>${esc(g.title)}</b> — ${esc(g.why)}</p>`).join('')}
  <details class="dmeta"><summary>The ten working principles</summary>${state.org.principles.map((p) => `<p><b>${esc(p.name)}.</b> ${esc(p.behaviour)}</p>`).join('')}</details>
  <h3 class="dsec">HEALTH CHECK</h3>
  <button class="go quiet" id="healthcheck">Run the health check</button>
  <div id="healthout" style="margin-top:8px"></div>`;

const receptionDrawer = () => {
  const needs = pendingProposals();
  const digest = (state.live.feed || []).slice(0, 6);
  return `
    <div class="dhead">${avatar('You', 'you')}<div><h2>Your desk</h2><p>${needs.length ? `${needs.length} thing${needs.length === 1 ? '' : 's'} need${needs.length === 1 ? 's' : ''} your decision.` : 'Nothing needs you right now.'}</p></div></div>
    ${needs.map((p) => `<div class="minithread needsyou" style="padding:12px"><b>${esc(p.change)}</b><p class="hint" style="margin:6px 0 8px">${esc(p.observation)}</p><button class="go" data-approve="${esc(p.id)}">Approve</button></div>`).join('')}
    <h3 class="dsec">ASK THE ORGANIZATION</h3>
    <div class="askrow"><input type="text" id="quickask" placeholder="Goes to the Chair" autocomplete="off"><button class="go" id="quicksend">Send</button></div>
    <h3 class="dsec">WHAT HAPPENED LATELY</h3>
    ${digest.map((r) => `<p class="minithread"><b>${esc(r.agent)}</b> ${esc(r.capability)} — ${OUTCOME_WORDS[r.outcome] || esc(r.outcome)}${r.correction ? ` · you noted: “${esc(r.correction)}”` : ''}</p>`).join('') || '<p class="empty">Quiet so far.</p>'}`;
};

const sessionsDrawer = () => {
  const sess = state.sessions || { available: false, sessions: [] };
  const fmtTok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
  return `
    <div class="dhead"><h2>The elevator</h2></div>
    <h3 class="dsec">CLAUDE CODE SESSIONS HERE</h3>
    ${sess.available
      ? sess.sessions.slice(0, 8).map((x) => `<p class="minithread">${x.active ? '<span class="chip good">live</span>' : `<span class="chip plain">${new Date(x.lastActive).toLocaleDateString()}</span>`} ${x.active ? 'Active session' : 'Session'} · ${ago(x.lastActive)} · ${x.turns.toLocaleString()} turns · ${fmtTok(x.tokens)} tokens</p>`).join('')
      : '<p class="empty">No sessions in this workspace yet — run <b>claude</b> here once and they appear.</p>'}
    <h3 class="dsec">OTHER PLACES THE ORG HAS WORKED</h3>
    ${state.wsinfo.workspaces.map((w) => {
      const name = w.path.split('/').filter(Boolean).pop();
      const current = w.path === (state.ws || state.wsinfo.current);
      return `<p class="minithread">${current ? '<span class="chip good">here</span>' : `<button class="go quiet" data-ws="${esc(w.path)}">Go</button>`} <b>${esc(name)}</b> <span class="hint">${esc(w.path)}</span></p>`;
    }).join('')}`;
};


/**
 * Mission Control — the drawer the Principal was missing.
 *
 * Every session on this machine, what each is doing right now, and which agents the
 * transcripts show involved. Nothing here is inferred: a session with no recent line
 * says idle, and an agent appears only because a dispatch was actually recorded.
 */
const missionDrawer = () => {
  const os_ = state.orgSessions || { available: false, sessions: [] };
  const act = state.activity || { events: [], busyAgents: [], activeCount: 0 };
  const fmtTok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
  const wsName = (p) => (p ? p.split('/').filter(Boolean).pop() : 'unknown');

  const live = os_.sessions.filter((x) => x.active);
  const idle = os_.sessions.filter((x) => !x.active).slice(0, 8);

  const card = (x) => `<div class="minithread ${x.active ? 'needsyou' : ''}">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="chip ${x.active ? 'good' : 'plain'}">${x.active ? 'LIVE' : ago(x.lastAt)}</span>
        <b>${esc(wsName(x.cwd))}</b>
        ${x.branch && x.branch !== 'HEAD' ? `<span class="chip plain">${esc(x.branch)}</span>` : ''}
        <span class="hint" style="margin:0">${x.turns.toLocaleString()} turns · ${fmtTok(x.tokens)} tokens</span>
      </div>
      ${x.slug ? `<div style="font-size:12.5px;color:var(--ink-2);margin-top:4px">“${esc(x.slug.replace(/-/g, ' '))}”</div>` : ''}
      ${x.doing ? `<div style="font-size:13px;margin-top:5px">${x.active ? '<b>now:</b>' : 'last:'} ${esc(x.doing)}</div>` : ''}
      ${x.agents.length ? `<div style="margin-top:6px">${x.agents.slice(0, 6).map((a) => `<button class="personbtn" data-person="${esc(a.name)}" style="margin:2px 4px 0 0">${avatar(a.name)}<span>${esc(a.name)}<small>${ago(a.at)}</small></span></button>`).join('')}</div>`
        : '<div class="hint" style="margin-top:5px">no specialist dispatches recorded in this session</div>'}
    </div>`;

  return `
    <div class="dhead"><h2>Mission control</h2><p>${act.activeCount ? `${act.activeCount} session${act.activeCount === 1 ? '' : 's'} working right now` : 'Nothing running right now.'} · ${os_.total || 0} on this machine</p></div>
    ${live.length ? `<h3 class="dsec">WORKING NOW</h3>${live.map(card).join('')}` : '<p class="empty">No session has produced a line in the last three minutes. Start one with <b>claude</b> in any workspace, or send a <b>Do</b> message to anyone in the office.</p>'}
    <h3 class="dsec">WHO IS INVOLVED — recorded dispatches</h3>
    ${act.busyAgents.length
      ? `<div class="peoplerow">${act.busyAgents.slice(0, 12).map((a) => `<button class="personbtn" data-person="${esc(a.name)}">${avatar(a.name)}<span>${esc(a.name)}<small>${esc(a.workspace)} · ${ago(a.at)}</small></span></button>`).join('')}</div>`
      : '<p class="empty">No specialist dispatches in the recent window. The organization only claims involvement the transcripts actually record.</p>'}
    <h3 class="dsec">ORG FEED — what is happening across every session</h3>
    ${act.events.length
      ? act.events.slice(0, 16).map((e) => `<div class="feedline"><span class="ft">${ago(e.at)}</span><span class="fw">${esc(e.workspace)}</span><span>${esc(e.text)}</span></div>`).join('')
      : '<p class="empty">Quiet everywhere.</p>'}
    ${idle.length ? `<h3 class="dsec">RECENT, NOT ACTIVE</h3>${idle.map(card).join('')}` : ''}`;
};

const DRAWERS = { mission: missionDrawer, person: (id) => personDrawer(id), room: (id) => roomDrawer(id), board: boardDrawer, reception: receptionDrawer, sessions: sessionsDrawer };

// ── render: HUD + drawer only. The floor is mounted once and left alone. ─────────────

const typingNow = () => {
  const el = document.activeElement;
  return el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && el.closest('.drawer');
};

const render = () => {
  if (!state.org || !state.live || !state.mail || !state.tokens || !state.rewards || !state.wsinfo) return;
  const focus = document.activeElement;
  const keep = focus && focus.id && (focus.tagName === 'TEXTAREA' || focus.tagName === 'INPUT')
    ? { id: focus.id, value: focus.value, start: focus.selectionStart, end: focus.selectionEnd } : null;

  $('#ws-name').textContent = state.live.workspace;
  const needs = pendingProposals().length;
  const waiting = ((state.mail && state.mail.threads) || []).filter((t) => !t.answered).length;
  const liveN = state.activity?.activeCount ?? (state.sessions?.sessions || []).filter((x) => x.active).length;
  $('#hud-needs').textContent = needs ? `${needs} need${needs === 1 ? 's' : ''} you` : 'nothing needs you';
  $('#hud-needs').classList.toggle('hot', needs > 0);
  $('#hud-mail').textContent = `${waiting} in flight`;
  $('#hud-live').textContent = liveN === 1 ? '1 session live' : `${liveN} sessions live`;
  $('#hud-live').classList.toggle('hot', liveN > 0);

  const drawer = $('#drawer');
  if (state.drawer) {
    drawer.setAttribute('aria-hidden', 'false');
    $('#drawerbody').innerHTML = DRAWERS[state.drawer.type](state.drawer.id);
    const t = drawer.querySelector('.thread');
    if (t) t.scrollTop = t.scrollHeight;
  } else {
    drawer.setAttribute('aria-hidden', 'true');
    $('#drawerbody').innerHTML = '';
  }

  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) { el.value = keep.value; el.focus(); try { el.setSelectionRange(keep.start, keep.end); } catch { /* ok */ } }
  }
};

const openDrawer = (type, id = null) => {
  if (state.drawer?.type === 'person' && $('#chatbody')) state.draft[state.drawer.id] = $('#chatbody').value;
  state.drawer = { type, id };
  if (type === 'person') state.recipient = id;
  render();
};

const officeData = () => ({
  status: state.live?.status || {},
  waitingThreads: ((state.mail && state.mail.threads) || []).filter((t) => !t.answered),
  // A run the Console started AND any agent the transcripts show working — the office
  // animates the organization's real activity, not only the part it kicked off itself.
  runs: [...(state.runsActive || []), ...((state.activity?.busyAgents) || []).map((a) => ({ to: a.name }))],
  rewards: state.rewards || {},
});

const refresh = async ({ passive = false } = {}) => {
  [state.live, state.mail, state.tokens, state.rewards, state.wsinfo, state.sessions, state.runsActive] = await Promise.all([
    api('/api/state'), api('/api/messages'), api('/api/tokens'), api('/api/rewards'), api('/api/workspaces'), api('/api/sessions'),
    api('/api/runs').then((r) => r.active),
  ]);
  // Org-wide activity is a separate, cheap poll: it must never be able to break the
  // Console if a transcript directory is unreadable.
  try {
    [state.orgSessions, state.activity] = await Promise.all([api('/api/org-sessions'), api('/api/activity')]);
  } catch { state.activity = state.activity || { events: [], busyAgents: [], activeCount: 0 }; }
  Office.update(officeData());
  if (passive && typingNow()) return;
  render();
};

const buildLegend = () => {
  $('#legend').innerHTML = [
    `<button class="legendchip" data-open="reception"><span class="dot active"></span>Your desk</button>`,
    `<button class="legendchip" data-open="board"><span class="dot active"></span>The Board</button>`,
    ...state.org.divisions.map((d) => `<button class="legendchip" data-room="${d.id}"><span class="dot ${esc(state.live.status[d.id]?.state || 'idle')}"></span>${esc(d.name)}</button>`),
    `<button class="legendchip" data-open="mission"><span class="dot active"></span>Mission control</button>`,
    `<button class="legendchip" data-open="sessions"><span class="dot idle"></span>Elevator · this workspace</button>`,
  ].join('');
};

// ── events ────────────────────────────────────────────────────────────────────────────

document.addEventListener('click', async (e) => {
  const chip = e.target.closest('[data-room]');
  if (chip) { openDrawer('room', chip.dataset.room); return; }
  const open = e.target.closest('[data-open]');
  if (open) { openDrawer(open.dataset.open); return; }
  const person = e.target.closest('[data-person]');
  if (person) { openDrawer('person', person.dataset.person); return; }
  if (e.target.id === 'drawerclose') { state.drawer = null; render(); return; }

  if (e.target.closest('.modeopt')) { state.mode = e.target.closest('.modeopt').dataset.mode; render(); return; }

  if (e.target.id === 'chatsend') {
    const v = $('#chatbody').value.trim();
    if (!v || state.run) return;
    state.draft[state.recipient] = '';
    const prior = threadsFor(state.recipient)[0];
    try {
      const r = await api('/api/run', { to: state.recipient, body: v, mode: state.mode, threadId: prior ? prior.id : null });
      state.run = { id: r.runId, text: '', tool: null };
      Office.courier(state.recipient);
    } catch (err) { alert(err.message); }
    await refresh();
    return;
  }
  if (e.target.id === 'runkill') { if (state.run) await api('/api/run/kill', { id: state.run.id }); return; }

  if (e.target.id === 'quicksend') {
    const v = $('#quickask').value.trim();
    if (v) {
      try { await api('/api/messages', { to: 'chair', body: v }); } catch (err) { alert(err.message); }
      openDrawer('person', 'chair');
      await refresh();
    }
    return;
  }
  if (e.target.id === 'ideasend') {
    const v = $('#ideabody').value.trim();
    if (v) { try { await api('/api/messages', { to: 'discovery-manager', body: v, kind: 'idea' }); } catch (err) { alert(err.message); } await refresh(); }
    return;
  }
  if (e.target.id === 'reposend') {
    const url = $('#repourl').value.trim();
    const goal = $('#repogoal').value.trim() || 'Study this and report what is worth adopting.';
    if (url) { try { await api('/api/messages', { to: 'discovery-manager', body: goal, kind: 'repo', url }); } catch (err) { alert(err.message); } await refresh(); }
    return;
  }
  if (e.target.id === 'plango') {
    const req = $('#planreq').value.trim();
    if (!req) return;
    state.planning = true; render();
    try { state.plan = await api('/api/plan', { request: req }); } catch (err) { alert(err.message); }
    state.planning = false; render();
    return;
  }
  if (e.target.dataset.approve) {
    e.target.disabled = true;
    try { await api('/api/approve', { id: e.target.dataset.approve }); } catch (err) { alert(err.message); }
    await refresh();
    return;
  }
  if (e.target.id === 'healthcheck') {
    e.target.disabled = true;
    const r = await api('/api/doctor');
    $('#healthout').innerHTML = r.ok
      ? `<span class="chip good">All checks passed</span> <span class="hint">The constitution holds${r.warnings ? ` — ${r.warnings} minor note(s)` : ''}.</span>`
      : `<span class="chip bad">${r.failures} problem(s)</span><pre style="font-size:11px;white-space:pre-wrap">${esc(r.lines.filter((l) => l.includes('FAIL')).join('\n'))}</pre>`;
    e.target.disabled = false;
    return;
  }
  if (e.target.dataset.ws) { state.ws = e.target.dataset.ws; await refresh(); buildLegend(); render(); }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'chatbody' && state.drawer?.type === 'person') state.draft[state.drawer.id] = e.target.value;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'quickask') $('#quicksend').click();
  if (e.key === 'Enter' && e.target.id === 'planreq') $('#plango').click();
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.id === 'chatbody') $('#chatsend').click();
  if (e.key === 'Escape' && state.drawer) { state.drawer = null; render(); }
});

// ── boot ──────────────────────────────────────────────────────────────────────────────

const LIVE = new URLSearchParams(location.search).get('live') !== '0';
(async () => {
  const p = new URLSearchParams(location.search);
  if (p.get('ws')) state.ws = p.get('ws');
  state.org = await api('/api/org');
  await refresh();
  buildLegend();

  Office.mount($('#office'), state.org, {
    onRoom: (id) => openDrawer('room', id),
    onAgent: (name) => openDrawer('person', name),
    onBoard: () => openDrawer('board'),
    onReception: () => openDrawer('reception'),
    onElevator: () => openDrawer('sessions'),
  });
  Office.update(officeData());

  // Old deep links keep working: every retired view has a home in the office.
  const view = p.get('view');
  const map = { chat: () => openDrawer('person', p.get('recipient') || 'chair'), ideas: () => openDrawer('room', 'DIV-DSC'), repos: () => openDrawer('room', 'DIV-DSC'), plans: () => openDrawer('room', 'DIV-DIR'), team: () => openDrawer('board'), spend: () => openDrawer('room', 'DIV-TRS'), sessions: () => openDrawer('mission'), home: () => {} };
  if (map[view]) map[view]();
  if (p.get('request') && view === 'plans') {
    state.planning = true; render();
    try { state.plan = await api('/api/plan', { request: p.get('request') }); } catch { /* composer stays */ }
    state.planning = false; render();
  }

  if (LIVE) {
    try {
      const src = new EventSource('/api/events');
      src.onopen = () => { $('#live').innerHTML = '<span style="color:var(--good)">● live</span>'; };
      src.addEventListener('dirty', () => refresh({ passive: true }));
      src.addEventListener('run', (e) => {
        const ev = JSON.parse(e.data);
        if (!state.run || ev.runId !== state.run.id) return;
        if (ev.kind === 'text') { state.run.text = (state.run.text ? `${state.run.text}\n\n` : '') + ev.text; state.run.tool = null; }
        if (ev.kind === 'tool') state.run.tool = ev.name;
        if (ev.kind === 'status') { state.run = null; refresh(); return; }
        if (state.drawer?.type === 'person' && !typingNow()) render();
      });
      src.onerror = () => { $('#live').innerHTML = '<span style="color:var(--warn)">● reconnecting</span>'; };
    } catch { /* timer covers it */ }
    setInterval(() => refresh({ passive: true }), 12000);
  } else {
    $('#live').textContent = '○ static';
    setTimeout(() => Office.freeze(), 1200); // one settled frame, then stillness for capture
  }
})();
