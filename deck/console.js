/**
 * The Console client — the Principal's side of the glass.
 *
 * Everything here is written for someone who will never open the Ops deck: plain words,
 * one decision per card, no identifiers unless they asked for them. The honesty rule that
 * governs the whole page: messages are MAIL, not live chat. The organization answers when
 * it next convenes, and every composer says so — a spinner pretending otherwise would be
 * the interface lying about the architecture.
 */

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  org: null, live: null, mail: null, tokens: null, rewards: null, wsinfo: null, integrations: null,
  view: 'home', ws: null, recipient: 'chair', draft: {},
};

const qs = () => (state.ws ? `?ws=${encodeURIComponent(state.ws)}` : '');
const api = async (path, body) => {
  const sep = path.includes('?') ? '&' : '?';
  const url = state.ws ? `${path}${sep}ws=${encodeURIComponent(state.ws)}` : path;
  const res = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'something went wrong');
  return data;
};

/** "2h ago" — the Principal never needs an ISO timestamp. */
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

const divOf = (id) => state.org.divisions.find((d) => d.id === id);

const OUTCOME_WORDS = { ok: 'went well', partial: 'partly done', fail: "didn't work", blocked: 'is waiting on approval' };
const KIND_WORDS = { message: '', idea: 'idea', repo: 'repo to study' };

const divName = (id) => state.org.divisions.find((d) => d.id === id)?.name ?? id;
const pendingProposals = () => (state.live.proposals || []).filter((p) => !p.refused && !(state.live.overlay || []).some((a) => a.id === p.id));

// ─────────────────────────────────────────────────────────────────────────── views

const viewHome = () => {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const needs = pendingProposals();
  const waiting = (state.mail.threads || []).filter((t) => !t.answered).length;

  const needsCards = needs
    .map(
      (p) => `<div class="card needsyou">
        <h3>${esc(p.change)}</h3>
        <p>${esc(p.observation)}</p>
        <button class="go" data-approve="${esc(p.id)}">Approve</button>
        <span class="why" style="margin-left:12px">Approving is reversible — it can be withdrawn any time.</span>
      </div>`,
    )
    .join('');

  const answered = (state.mail.threads || []).filter((t) => t.answered).slice(0, 3);
  const digest = (state.live.feed || []).slice(0, 8);

  return `
    <h1>${greet}.</h1>
    <p class="sub">${
      needs.length
        ? `${needs.length === 1 ? 'One thing needs' : `${needs.length} things need`} your decision.`
        : waiting
          ? `Nothing needs you. ${waiting === 1 ? 'One message is' : `${waiting} messages are`} waiting for the team's next session.`
          : 'Nothing needs you right now.'
    }</p>

    ${needs.length ? `<h2 class="sec">NEEDS YOU</h2>${needsCards}` : ''}

    <h2 class="sec">ASK THE ORGANIZATION</h2>
    <div class="card">
      <div class="askrow">
        <input type="text" id="quickask" placeholder="Ask anything — it goes to the Chair of the Board" autocomplete="off">
        <button class="go" id="quicksend">Send</button>
      </div>
      <p class="hint">Delivered the next time the team convenes in this workspace. Answers appear in Chat.</p>
    </div>

    ${answered.length ? `<h2 class="sec">NEW ANSWERS</h2>${answered
      .map((t) => `<div class="card"><div class="msg mine"><div class="who">You → ${esc(t.to)}</div>${esc(t.body)}</div>
        ${t.replies.map((r) => `<div class="msg theirs" style="margin-top:8px"><div class="who">${esc(r.from)}</div>${esc(r.body)}</div>`).join('')}</div>`)
      .join('')}` : ''}

    <h2 class="sec">WHAT HAPPENED LATELY</h2>
    <div class="card digest">
      ${digest.length
        ? digest.map((r) => `<div class="row"><span class="when">${ago(r.at)}</span><span class="what"><b>${esc(r.agent)}</b> ${esc(r.capability)} — ${OUTCOME_WORDS[r.outcome] || esc(r.outcome)}${r.correction ? ` · you noted: “${esc(r.correction)}”` : ''}</span></div>`).join('')
        : `<p class="empty">Quiet so far. Activity shows up here as the team works.</p>`}
    </div>`;
};

const viewChat = () => {
  const seats = state.org.seats.map((s) => `<option value="${esc(s.name)}">${esc(s.seat)}</option>`).join('');
  const managers = state.org.divisions.map((d) => `<option value="${esc(d.manager)}">${esc(d.name)} — manager</option>`).join('');
  const specialists = state.org.divisions
    .flatMap((d) => d.agents.filter((a) => a.role === 'specialist').map((a) => `<option value="${esc(a.name)}">${esc(a.name)} (${esc(d.name)})</option>`))
    .join('');

  const mine = (state.mail.threads || []).filter((t) => t.to === state.recipient && t.kind === 'message');
  const thread = mine.length
    ? mine
        .slice(0, 20)
        .reverse()
        .map(
          (t) => `<div class="msg mine"><div class="who">You · ${ago(t.at)}</div>${esc(t.body)}</div>
          ${t.replies.map((r) => `<div class="msg theirs"><div class="who">${esc(r.from)} · ${ago(r.at)}</div>${esc(r.body)}</div>`).join('')}
          ${!t.answered ? `<p class="pendingnote">Waiting for the team's next session…</p>` : ''}`,
        )
        .join('')
    : `<p class="empty">No conversation with <b>${esc(state.recipient)}</b> yet. Say hello below.</p>`;

  return `
    <h1>Chat</h1>
    <p class="sub">Talk to any seat, manager or specialist. Messages are delivered when the team next convenes — like leaving a note on someone's desk, and the answer arrives here.</p>
    <div class="card">
      <div class="field"><label for="rcpt">Who are you writing to?</label>
        <select id="rcpt">
          <optgroup label="The Board">${seats}</optgroup>
          <optgroup label="Department managers">${managers}</optgroup>
          <optgroup label="Specialists">${specialists}</optgroup>
        </select>
      </div>
      <div class="thread">${thread}</div>
      <div class="field" style="margin-top:16px"><label for="chatbody">Your message</label>
        <textarea id="chatbody" placeholder="Write it the way you'd say it. No format required.">${esc(state.draft[state.recipient] || '')}</textarea>
      </div>
      <div style="margin-top:12px"><button class="go" id="chatsend">Send</button></div>
    </div>`;
};

const viewIdeas = () => {
  const ideas = (state.mail.threads || []).filter((t) => t.kind === 'idea');
  return `
    <h1>Ideas</h1>
    <p class="sub">Anything you think the organization should look into. Ideas go straight to the Discovery Lab, which researches them and answers with what it found.</p>
    <div class="card">
      <div class="field"><label for="ideabody">Your idea</label>
        <textarea id="ideabody" placeholder="e.g. Could we cache the report queries? They feel slow on big months."></textarea>
      </div>
      <div style="margin-top:12px"><button class="go" id="ideasend">Send to the Discovery Lab</button></div>
    </div>
    ${ideas.length ? `<h2 class="sec">YOUR IDEAS</h2>${ideas
      .map((t) => `<div class="card"><span class="chip ${t.answered ? 'good' : 'warn'}">${t.answered ? 'Answered' : 'Being considered'}</span>
        <p style="margin:10px 0 0">${esc(t.body)}</p>
        ${t.replies.map((r) => `<div class="msg theirs" style="margin-top:10px"><div class="who">${esc(r.from)}</div>${esc(r.body)}</div>`).join('')}</div>`)
      .join('')}` : ''}`;
};

const viewRepos = () => {
  const repos = (state.mail.threads || []).filter((t) => t.kind === 'repo');
  return `
    <h1>Repos to study</h1>
    <p class="sub">Found something good on GitHub? Hand it over. The Discovery Lab reverse-engineers it, keeps what's worth keeping, and reports back before anything is copied in.</p>
    <div class="card">
      <div class="field"><label for="repourl">Link</label>
        <input type="text" id="repourl" placeholder="https://github.com/someone/something" autocomplete="off">
      </div>
      <div class="field"><label for="repogoal">What do you want from it?</label>
        <textarea id="repogoal" placeholder="e.g. Their onboarding flow is great — see what we can learn for our console."></textarea>
      </div>
      <div style="margin-top:12px"><button class="go" id="reposend">Send for study</button></div>
    </div>
    ${repos.length ? `<h2 class="sec">IN THE STUDY QUEUE</h2>${repos
      .map((t) => `<div class="card"><span class="chip ${t.answered ? 'good' : 'warn'}">${t.answered ? 'Studied' : 'Queued'}</span>
        <p style="margin:10px 0 4px"><a href="${esc(t.url)}" target="_blank" rel="noreferrer" style="color:var(--copper-ink)">${esc(t.url)}</a></p>
        <p style="margin:0;color:var(--ink-2);font-size:14px">${esc(t.body)}</p>
        ${t.replies.map((r) => `<div class="msg theirs" style="margin-top:10px"><div class="who">${esc(r.from)}</div>${esc(r.body)}</div>`).join('')}</div>`)
      .join('')}` : ''}`;
};

const viewTeam = () => {
  const seats = state.org.seats
    .map((s) => {
      const rows = s.divisions
        .map((id) => {
          const d = state.org.divisions.find((x) => x.id === id);
          const st = state.live.status[id] || { state: 'idle' };
          const specialists = d.agents.filter((a) => a.role === 'specialist');
          const mgr = d.agents.find((a) => a.role === 'manager');
          const person = (a) => {
            const m = state.live.memory[a.name];
            return `<details class="person"><summary>${esc(a.name)}${m ? ` <span class="chip ${m.reliability >= 0.75 ? 'good' : m.reliability < 0.55 ? 'bad' : 'plain'}">${Math.round(m.reliability * 100)}%</span>` : ''}</summary>
              <div class="persondetail"><b>Owns:</b> ${esc(a.owns)}<br><b>Won't do:</b> ${esc(a.refuses)}</div></details>`;
          };
          return `<details class="deptrowwrap"><summary>
              <div class="deptrow">
                <span class="dot ${esc(st.state)}" title="${esc(st.state)}"></span>
                <span class="nm">${esc(d.name)}</span>
                <span class="meta">${specialists.length} specialists · led by ${esc(d.manager)}</span>
              </div></summary>
            <div class="deptdetail">${esc(d.mission)}
              ${mgr && mgr.knows ? `<br><b>${esc(mgr.name)}</b> keeps track of ${esc(mgr.knows)}` : ''}
              <div style="margin-top:8px">${specialists.map(person).join('')}</div>
            </div></details>`;
        })
        .join('');
      return `<div class="card seatcard">
        <h3>${esc(s.seat)}${s.isChair ? ' <span class="chip plain">convenes the board</span>' : ''}</h3>
        <p class="role">${esc(s.owns)}</p>
        ${rows}</div>`;
    })
    .join('');

  const rec = state.rewards;
  const anyRec = rec.streaks.length || rec.improved.length || rec.reliable.length;
  return `
    <h1>The team</h1>
    <p class="sub">Six board seats, twelve departments, ${state.org.divisions.reduce((n, d) => n + d.agents.filter((a) => a.role === 'specialist').length, 0)} specialists. There's no CEO — the seats decide together, and anything they can't agree on comes to you.</p>
    <h2 class="sec">RECOGNITION — earned from real results, never hand-outs</h2>
    <div class="card recognition">
      ${anyRec ? `
        ${rec.streaks.map((r) => `<div class="rec"><span class="medal">🔥</span><span><b>${esc(r.agent)}</b> — ${r.streak} good results in a row</span></div>`).join('')}
        ${rec.improved.map((r) => `<div class="rec"><span class="medal">📈</span><span><b>${esc(r.agent)}</b> — most improved lately</span></div>`).join('')}
        ${rec.reliable.map((r) => `<div class="rec"><span class="medal">🏅</span><span><b>${esc(r.agent)}</b> — consistently dependable (${Math.round(r.reliability * 100)}% over ${r.n} tasks)</span></div>`).join('')}`
        : `<p class="empty">Recognition appears once the team has a track record. It's computed from real outcomes, so it can't be gamed.</p>`}
    </div>
    <h2 class="sec">THE BOARD AND THEIR DEPARTMENTS</h2>
    ${seats}
    <h2 class="sec">WHAT STOPS IT DOING SOMETHING STUPID</h2>
    <div class="card">
      ${state.org.gates.map((g) => `<div class="deptrow"><span class="dot blocked"></span><span class="nm">${esc(g.title)}</span><span class="meta">${esc(g.why)}</span></div>`).join('')}
      <p class="hint" style="margin-top:10px">These seven always pause and wait for you — the organization cannot approve them for itself.</p>
    </div>
    <details class="card" style="margin-top:12px"><summary style="cursor:pointer;font-weight:600">The ten working principles</summary>
      ${state.org.principles.map((pr) => `<p style="margin:8px 0 0;font-size:14px"><b>${esc(pr.name)}.</b> <span style="color:var(--ink-2)">${esc(pr.behaviour)}</span></p>`).join('')}
    </details>
    <h2 class="sec">HEALTH CHECK</h2>
    <div class="card">
      <button class="go quiet" id="healthcheck">Run the health check</button>
      <div id="healthout" style="margin-top:10px"></div>
      <p class="hint">Checks the whole organization against its own constitution — ${state.org.rules.length} rules and the hygiene that keeps them real.</p>
    </div>`;
};

const viewSpend = () => {
  const t = state.tokens;
  const divs = Object.entries(t.byDivision).sort((a, b) => b[1].tokens - a[1].tokens);
  const max = Math.max(1, ...divs.map(([, v]) => v.tokens));
  const agents = Object.entries(t.byAgent).sort((a, b) => b[1].tokens - a[1].tokens).slice(0, 10);
  const m = t.measured || {};
  const campaigns = Object.entries(t.byCampaign || {}).sort((a, b) => b[1].tokens - a[1].tokens).slice(0, 8);
  return `
    <h1>Spending</h1>
    <p class="sub">Two honest numbers: what the sessions actually consumed (read from the transcripts), and what campaigns reported about themselves. The gap is work that never closed its ledger.</p>
    ${m.available
      ? `<div class="card"><span class="bignum">${(m.input + m.output).toLocaleString()}<small>measured tokens · ${m.sessions} sessions · from the transcripts</small></span>
         <p class="hint">${m.input.toLocaleString()} in · ${m.output.toLocaleString()} out · ${m.cacheRead.toLocaleString()} cache reads, listed apart because they bill far cheaper.</p></div>`
      : `<div class="card"><p class="empty">No session transcripts found for this workspace yet — the measured number appears after the first session here.</p></div>`}
    <div class="card" style="margin-top:12px"><span class="bignum">${t.total.toLocaleString()}<small>attributed tokens across ${t.tasks} tasks — self-reported by campaigns</small></span></div>
    <h2 class="sec">COMPANIONS — optional, and the organization runs identically without them</h2>
    <div class="card">
      <div class="deptrow"><span class="dot ${state.integrations?.codeburn?.installed ? 'active' : 'idle'}"></span>
        <span class="nm">CodeBurn</span>
        <span class="meta">the desktop deep-dive on the same transcripts this page reads</span>
        ${state.integrations?.codeburn?.installed
          ? '<button class="go quiet" id="opencodeburn" style="margin-left:12px">Open menu bar app</button>'
          : '<span class="chip plain" style="margin-left:12px">brew install codeburn</span>'}
      </div>
      <div class="deptrow"><span class="dot ${state.integrations?.omniroute?.running ? 'active' : 'idle'}"></span>
        <span class="nm">OmniRoute</span>
        <span class="meta">${state.integrations?.omniroute?.running ? 'gateway answering on port 20128 — wiring guide in docs/INTEGRATIONS.md' : 'free-tier gateway, not running — see docs/INTEGRATIONS.md before wiring it'}</span>
      </div>
      <p class="hint">Both are the Principal's call, never the organization's: one shows spend, the other changes which models answer. F.O.R.G.E. detects them and explains them — it flips neither switch itself.</p>
    </div>
    ${campaigns.length ? `<h2 class="sec">BY CAMPAIGN</h2><div class="card">${campaigns.map(([name, v]) => `<div class="barrow"><span>${esc(name)}</span><span class="track"><i style="width:${Math.max(3, Math.round((v.tokens / Math.max(1, campaigns[0][1].tokens)) * 100))}%"></i></span><span class="val">${v.tokens.toLocaleString()}</span></div>`).join('')}</div>` : ''}
    ${t.total === 0 ? `<div class="card" style="margin-top:12px"><p class="empty">No spend recorded yet. When sessions record outcomes with token counts, this fills in by itself — <b>honest zero beats an invented chart</b>.</p></div>` : `
    <h2 class="sec">BY DEPARTMENT</h2>
    <div class="card">${divs.map(([name, v]) => `<div class="barrow"><span>${esc(name)}</span><span class="track"><i style="width:${Math.max(2, Math.round((v.tokens / max) * 100))}%"></i></span><span class="val">${v.tokens.toLocaleString()}</span></div>`).join('')}</div>
    <h2 class="sec">TOP SPENDERS</h2>
    <div class="card">${agents.map(([name, v]) => `<div class="barrow"><span>${esc(name)}</span><span class="track"><i style="width:${Math.max(2, Math.round((v.tokens / Math.max(1, agents[0][1].tokens)) * 100))}%"></i></span><span class="val">${v.tokens.toLocaleString()}</span></div>`).join('')}</div>`}`;
};

const viewSessions = () => {
  const info = state.wsinfo;
  const rows = info.workspaces
    .map((w) => {
      const name = w.path.split('/').filter(Boolean).pop();
      const current = w.path === (state.ws || info.current);
      return `<div class="card wsrow">
        <span><span class="nm">${esc(name)}</span><br><span class="path">${esc(w.path)}</span></span>
        <span class="spacer"></span>
        ${current ? '<span class="chip good">Viewing</span>' : `<button class="go quiet" data-ws="${esc(w.path)}">View</button>`}
      </div>`;
    })
    .join('');
  return `
    <h1>Sessions</h1>
    <p class="sub">Every workspace the organization has worked in. Each keeps its own memory, its own mail and its own spending — switch to see any of them from here.</p>
    ${rows || '<div class="card"><p class="empty">Just this one so far. Run any <b>forge</b> command in another project and it appears here.</p></div>'}
    <h2 class="sec">WHAT THE TEAM KNOWS ABOUT THIS ONE</h2>
    <div class="card">${Object.entries(state.live.profile)
      .filter(([, v]) => v.grade !== 'UNKNOWN' && v.value !== null && v.value !== false && !(Array.isArray(v.value) && !v.value.length))
      .map(([k, v]) => `<div class="deptrow"><span class="nm">${esc(k.replace(/([A-Z])/g, ' $1').toLowerCase())}</span><span class="meta">${esc(Array.isArray(v.value) ? v.value.join(', ') : String(v.value))} — ${esc(v.why)}</span></div>`)
      .join('') || '<p class="empty">Nothing learned yet. It reads the workspace on its own the first time it works here.</p>'}</div>
    <div class="card" style="margin-top:16px"><p class="empty">To put the team to work in a workspace: open a terminal there and start <b>claude</b> — waiting messages are handed over automatically at the start of the session.</p></div>`;
};

const PHASE_WORDS = {
  frame: ['1 · Understand', 'Pin down what done means before anyone starts.'],
  design: ['2 · Shape it', 'Decide the approach while changing it is still cheap.'],
  build: ['3 · Build', 'Make exactly what was decided — nothing extra.'],
  verify: ['4 · Check it', 'Prove it works. A claim without evidence does not count.'],
  release: ['5 · Ship it', 'Rollback plan first, then release.'],
  deliver: ['6 · Report back', 'One clear summary for you, and notes kept for next time.'],
};

const viewPlans = () => {
  const v = state.plan;
  const composer = `<div class="card">
      <div class="field"><label for="planreq">What would you like done?</label>
        <input type="text" id="planreq" placeholder="e.g. add rate limiting to the public api and deploy it" autocomplete="off" value="${esc(v ? v.request : '')}">
      </div>
      <div style="margin-top:12px"><button class="go" id="plango"${state.planning ? ' disabled' : ''}>${state.planning ? 'Planning…' : 'Show me the plan'}</button></div>
      <p class="hint">The plan is computed by fixed rules, not by an AI guessing — asking twice gives the same answer. Nothing starts until you take the plan to a session.</p>
    </div>`;

  if (!v) return `<h1>Plans</h1><p class="sub">See exactly who would work on something, in what order, and where it would pause for you — before anything happens.</p>${composer}`;

  const gates = v.gates
    .map((g) => `<div class="card needsyou" style="margin-top:12px"><h3>⏸ This will pause for your approval</h3><p><b>${esc(g.title)}.</b> ${esc(g.why)}</p></div>`)
    .join('');

  let stages = '';
  let phase = null;
  for (const b of v.batches) {
    if (b.phase !== phase) {
      phase = b.phase;
      const [t, d] = PHASE_WORDS[phase] || [phase, ''];
      stages += `<h2 class="sec">${esc(t.toUpperCase())} — ${esc(d)}</h2>`;
    }
    if (b.parallel) stages += `<p class="hint" style="margin:0 0 8px">These ${b.stages.length} work side by side:</p>`;
    for (const id of b.stages) {
      const st = v.stages.find((x) => x.id === id);
      const d = divOf(st.division);
      stages += `<div class="card" style="margin-bottom:8px"><b>${esc(st.agent)}</b>
        <span class="chip plain">${esc(d.name)}</span>
        <span class="chip ${st.writes ? 'warn' : 'plain'}">${st.writes ? 'changes files' : 'reads only'}</span>
        ${st.gate ? '<span class="chip bad">pauses for you</span>' : ''}
        <p style="margin:6px 0 0;color:var(--ink-2);font-size:14px">${esc(st.owns)}</p></div>`;
    }
  }

  const dropped = v.dropped.length
    ? `<h2 class="sec">LEFT OUT, ON PURPOSE</h2><div class="card">${v.dropped
        .map((d) => `<p style="margin:4px 0;font-size:14px;color:var(--ink-2)"><b>${esc(d.agent)}</b> — ${esc(d.why)}</p>`)
        .join('')}</div>`
    : '';

  return `<h1>Plans</h1>
    <p class="sub">See exactly who would work on something, in what order, and where it would pause for you — before anything happens.</p>
    ${composer}
    <div class="card" style="margin-top:16px"><span class="chip good">${esc(v.mode)}</span>
      <span style="margin-left:10px;color:var(--ink-2);font-size:14px">${esc(v.intent)}</span>
      ${v.cost ? `<p class="hint" style="margin-top:10px">${v.cost.total === null ? esc(v.cost.note) : `Rough cost, from this workspace's own history: <b style="color:var(--ink)">~${v.cost.total.toLocaleString()} tokens</b>. ${esc(v.cost.note)}`}</p>` : ''}</div>
    ${gates}${stages}${dropped}
    <div class="card" style="margin-top:16px"><p class="empty">Happy with it? Open a session in this workspace and ask for exactly this — the same plan will drive the work.</p></div>`;
};

const VIEWS = { plans: viewPlans, home: viewHome, chat: viewChat, ideas: viewIdeas, repos: viewRepos, team: viewTeam, spend: viewSpend, sessions: viewSessions };

// ─────────────────────────────────────────────────────────────────────────── shell

const render = () => {
  if (!state.org || !state.live) return;
  for (const b of document.querySelectorAll('.nav')) b.setAttribute('aria-current', String(b.dataset.view === state.view));
  $('#ws-name').textContent = state.live.workspace;
  $('#c-home').textContent = pendingProposals().length || '';
  $('#c-chat').textContent = (state.mail.threads || []).filter((t) => t.answered && !seenReplies.has(t.id)).length || '';
  const banner = state.ws && state.ws !== state.wsinfo.current
    ? `<div class="viewingbanner">Viewing another session: ${esc(state.ws)} <button class="go quiet" id="wsback">Back to this one</button></div>`
    : '';
  $('#stage').innerHTML = banner + VIEWS[state.view]();
  if (state.view === 'chat') $('#rcpt').value = state.recipient;
};

const seenReplies = new Set(JSON.parse(localStorage.getItem('forge-seen') || '[]'));
const markSeen = () => {
  for (const t of state.mail.threads || []) if (t.answered) seenReplies.add(t.id);
  try { localStorage.setItem('forge-seen', JSON.stringify([...seenReplies].slice(-200))); } catch { /* private windows */ }
};

const refresh = async () => {
  [state.live, state.mail, state.tokens, state.rewards, state.wsinfo, state.integrations] = await Promise.all([
    api('/api/state'), api('/api/messages'), api('/api/tokens'), api('/api/rewards'), api('/api/workspaces'), api('/api/integrations'),
  ]);
  render();
};

const send = async (payload, doneMsg) => {
  try {
    await api('/api/messages', payload);
    await refresh();
    if (doneMsg) window.setTimeout(() => {}, 0);
  } catch (e) {
    alert(e.message);
  }
};

document.addEventListener('click', async (e) => {
  const nav = e.target.closest('.nav');
  if (nav) {
    if (state.view === 'chat' && $('#chatbody')) state.draft[state.recipient] = $('#chatbody').value;
    state.view = nav.dataset.view;
    if (state.view === 'chat') markSeen();
    render();
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
  if (e.target.id === 'healthcheck') {
    e.target.disabled = true;
    const r = await api('/api/doctor');
    const out = $('#healthout');
    out.innerHTML = r.ok
      ? `<span class="chip good">All checks passed</span> <span style="font-size:13.5px;color:var(--ink-2)">The constitution holds${r.warnings ? ` — ${r.warnings} minor note(s)` : ''}.</span>`
      : `<span class="chip bad">${r.failures} problem(s) found</span><pre style="font-size:12px;white-space:pre-wrap;color:var(--ink-2)">${esc(r.lines.filter((l) => l.includes('FAIL')).join('\n'))}</pre>`;
    e.target.disabled = false;
    return;
  }
  if (e.target.id === 'opencodeburn') {
    e.target.disabled = true;
    try { await api('/api/codeburn/open', {}); e.target.textContent = 'Opened — check the menu bar'; } catch (err) { alert(err.message); e.target.disabled = false; }
    return;
  }
  if (e.target.id === 'quicksend') {
    const v = $('#quickask').value.trim();
    if (v) { await send({ to: 'chair', body: v }); state.view = 'chat'; state.recipient = 'chair'; render(); }
    return;
  }
  if (e.target.id === 'chatsend') {
    const v = $('#chatbody').value.trim();
    if (v) { state.draft[state.recipient] = ''; await send({ to: state.recipient, body: v }); }
    return;
  }
  if (e.target.id === 'ideasend') {
    const v = $('#ideabody').value.trim();
    if (v) await send({ to: 'discovery-manager', body: v, kind: 'idea' });
    return;
  }
  if (e.target.id === 'reposend') {
    const url = $('#repourl').value.trim();
    const goal = $('#repogoal').value.trim() || 'Study this and report what is worth adopting.';
    if (url) await send({ to: 'discovery-manager', body: goal, kind: 'repo', url });
    return;
  }
  if (e.target.dataset.approve) {
    e.target.disabled = true;
    try { await api('/api/approve', { id: e.target.dataset.approve }); } catch (err) { alert(err.message); }
    await refresh();
    return;
  }
  if (e.target.dataset.ws) { state.ws = e.target.dataset.ws; await refresh(); return; }
  if (e.target.id === 'wsback') { state.ws = null; await refresh(); }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'rcpt') {
    if ($('#chatbody')) state.draft[state.recipient] = $('#chatbody').value;
    state.recipient = e.target.value;
    render();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'quickask') $('#quicksend').click();
  if (e.key === 'Enter' && e.target.id === 'planreq') $('#plango').click();
});

const LIVE = new URLSearchParams(location.search).get('live') !== '0';
(async () => {
  const p = new URLSearchParams(location.search);
  if (VIEWS[p.get('view')]) state.view = p.get('view');
  state.org = await api('/api/org');
  // A deep-linked plan (?view=plans&request=...) joins the SAME await as the first paint.
  // Sequencing it after the initial render left a window where the page showed
  // "Planning…" and a capture — or an impatient reader — saw a frozen button; one batch
  // means the first thing anyone sees is the finished plan.
  const seeded = p.get('request');
  if (seeded && state.view === 'plans') {
    try { state.plan = await api('/api/plan', { request: seeded }); } catch { /* composer stays */ }
  }
  await refresh();
  if (LIVE) {
    try {
      const src = new EventSource('/api/events');
      src.addEventListener('dirty', refresh);
    } catch { /* the timer below still covers it */ }
    setInterval(refresh, 10000);
  }
})();
