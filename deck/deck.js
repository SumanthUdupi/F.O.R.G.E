/**
 * Command Deck client.
 *
 * No framework, and the reason is not minimalism for its own sake: the deck has to run on a
 * fresh clone with no install step, so anything it cannot get from the browser it does not
 * get. What that costs is a component tree. What it buys is that `forge deck` works on a
 * machine with no network.
 *
 * Rendering is full-redraw per view. The payloads are a few hundred rows at most, the views
 * are read-mostly, and a diffing layer here would be a hundred lines protecting against a
 * cost nobody has measured. If a view ever gets large enough to flicker, that is the moment
 * to make it incremental -- not before.
 */

const $ = (sel) => document.querySelector(sel);

/** Escape everything that reaches innerHTML. The ledger holds free text the Principal typed. */
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const api = async (path, body) => {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `request failed: ${res.status}`);
  return data;
};

/**
 * View is in the URL, not only in memory.
 *
 * Deep-linking a view is worth having on its own — "look at the Learning tab" should be a
 * link — and it is what makes each view independently capturable for documentation and CI.
 */
const params = new URLSearchParams(location.search);
const VIEW_IDS = ['deck', 'vector', 'board', 'roster', 'learning', 'charter', 'audit'];

const state = {
  org: null,
  live: null,
  view: VIEW_IDS.includes(params.get('view')) ? params.get('view') : 'deck',
  selected: null,
  vector: null,
  planning: false,
  filter: params.get('filter') || '',
};

/** HH:MM from an ISO stamp; the deck never shows a date, because everything on it is today. */
const clock = (iso) => {
  if (!iso) return '--:--';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '--:--' : d.toTimeString().slice(0, 5);
};

const seatOf = (id) => state.org.seats.find((s) => s.id === id);
const divOf = (id) => state.org.divisions.find((d) => d.id === id);

// ───────────────────────────────────────────────────────────────────────── views

const viewDeck = () => {
  const { org, live } = state;
  const st = live.status;

  const portfolios = org.seats
    .map((seat) => {
      const hexes = seat.divisions
        .map((id) => {
          const d = divOf(id);
          const s = st[id] || { state: 'idle', observations: 0 };
          return `<button class="hex" data-div="${id}" data-state="${s.state}" aria-pressed="${state.selected === id}"
                    title="${esc(d.name)} — ${esc(d.mission)}">
            <span class="ring"></span>
            <span class="face">
              <span class="code">${esc(d.code)}</span>
              <span class="n">${s.observations || '·'}</span>
            </span>
            ${d.mayHalt ? '<span class="halt" title="may halt a campaign"></span>' : ''}
          </button>`;
        })
        .join('');
      return `<div class="portfolio">
        <h3>${esc(seat.seat)}${seat.isChair ? '<span class="chair">CHAIR</span>' : ''}</h3>
        <p>${esc(seat.owns)}</p>
        <div class="hexrow">${hexes}</div>
      </div>`;
    })
    .join('');

  const feed = live.feed.length
    ? live.feed
        .map(
          (r) => `<div class="row">
            <span class="t">${clock(r.at)}</span>
            <span><span class="who">${esc(r.agent)}</span> <span class="cap">${esc(r.capability)}</span></span>
            <span class="tag ${r.outcome === 'ok' ? 'good' : r.outcome === 'fail' ? 'bad' : r.outcome === 'blocked' ? 'warn' : ''}">${esc(r.outcome)}</span>
          </div>${r.correction ? `<span class="corr">↳ ${esc(r.correction)}</span>` : ''}`,
        )
        .join('')
    : `<p class="empty">Nothing observed in this workspace yet. Every agent is running on the neutral prior — reliability <code>0.70</code>, worth four observations.<br><br>Record one with <code>forge observe --agent code-reviewer --capability review --outcome ok</code>.</p>`;

  const detail = state.selected ? divisionDetail(state.selected) : '';

  return `
    <h2 class="sec">DIVISION MAP — colour is state, the triangle marks a division that may halt a campaign</h2>
    <div class="portfolios">${portfolios}</div>
    ${detail}
    <div class="grid g-side" style="margin-top:22px">
      <section class="panel">
        <header>LIVE FEED<span class="right">${live.feed.length} of ${live.observations}</span></header>
        <div class="body feed scroll">${feed}</div>
      </section>
      <section class="panel">
        <header>WORKSPACE<span class="right">${esc(live.workspace)}</span></header>
        <div class="body">
          <dl class="detail-dl">
            ${Object.entries(live.profile)
              .map(
                ([k, v]) => `<dt>${esc(k.replace(/([A-Z])/g, ' $1').toUpperCase())}</dt>
                  <dd><b style="color:var(--text)">${esc(Array.isArray(v.value) ? v.value.join(', ') || '—' : String(v.value))}</b>
                  <span class="tag ${v.grade === 'EVIDENCE' ? 'good' : v.grade === 'INFERENCE' ? 'warn' : ''}" style="margin-left:6px">${esc(v.grade)}</span>
                  <div style="color:var(--faint);font-size:11px;margin-top:2px">${esc(v.why)}</div></dd>`,
              )
              .join('')}
          </dl>
        </div>
      </section>
    </div>`;
};

const divisionDetail = (id) => {
  const d = divOf(id);
  const seat = seatOf(d.seat);
  const s = state.live.status[id];
  const rows = d.agents
    .map((a) => {
      const m = state.live.memory[a.name];
      const rel = m ? m.reliability : null;
      return `<tr>
        <td><b>${esc(a.name)}</b>${a.role === 'manager' ? ' <span class="tag">MANAGER</span>' : ''}
            <div style="font-size:11px;color:var(--text-2);margin-top:3px;line-height:1.5">${esc(a.owns)}</div></td>
        <td><span class="tag ${a.writes ? 'warn' : ''}">${a.writes ? 'writes' : 'reads'}</span> <span class="tag">${esc(a.model)}</span></td>
        <td class="num">${rel === null ? '<span style="color:var(--faint)">unmeasured</span>' : `${rel} <div class="bar"><i class="${rel < 0.5 ? 'low' : rel < 0.7 ? 'mid' : ''}" style="width:${Math.round(rel * 100)}%"></i></div>`}</td>
      </tr>`;
    })
    .join('');

  return `<section class="panel" style="margin-top:14px">
    <header>${esc(d.name)} · ${esc(d.code)}<span class="right">${esc(seat.seat)} · ${esc(s.state)}</span></header>
    <div class="body">
      <p style="margin:0 0 4px;font-size:12.5px;color:var(--text-2);line-height:1.6">${esc(d.mission)}</p>
      <p style="margin:0 0 14px;font-size:11.5px;color:var(--faint);line-height:1.6">${esc(d.authority)}${d.mayHalt ? ' <span class="tag bad">MAY HALT</span>' : ''}</p>
      <div class="wide"><table><thead><tr><th>AGENT AND WHAT IT OWNS</th><th>MODE</th><th class="num">RELIABILITY</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>
  </section>`;
};

const viewVector = () => {
  const v = state.vector;
  const PHASES = ['frame', 'design', 'build', 'verify', 'release', 'deliver'];

  const composer = `<div class="composer">
      <input type="text" id="req" placeholder="What do you want the organization to do?" value="${esc(v ? v.request : '')}" autocomplete="off">
      <select id="mode">
        <option value="">auto</option>
        <option value="direct">direct</option>
        <option value="focused">focused</option>
        <option value="standard">standard</option>
        <option value="campaign">campaign</option>
      </select>
      <button class="act" id="compose"${state.planning ? ' disabled' : ''}>${state.planning ? 'COMPOSING' : 'COMPOSE'}</button>
    </div>`;

  if (!v) {
    return `${composer}<p class="empty">The Vector is composed deterministically — no model is involved, and the same request always produces the same plan. That is what makes a wrong route a diff against <code>registry/routing.yaml</code> rather than an argument.<br><br>Try <code>add rate limiting to the public api and deploy it</code>.</p>`;
  }

  const active = new Set(v.stages.map((s) => s.phase));
  const gatePhases = new Set(v.stages.filter((s) => s.gate).map((s) => s.phase));
  const chevrons = PHASES.map(
    (p) => `<span class="chev ${gatePhases.has(p) ? 'gate' : active.has(p) ? 'on' : ''}">${p.toUpperCase()}</span>`,
  ).join('');

  const gates = v.gates.length
    ? v.gates
        .map(
          (g) => `<div class="gatecard">
            <h4>⚠ ${esc(g.title)}</h4>
            <p>${esc(g.why)}</p>
            <p class="matched">matched “${esc(g.on)}” · the campaign stops here and waits for you</p>
          </div>`,
        )
        .join('')
    : '';

  let body = '';
  if (!v.stages.length) {
    body = `<p class="empty">${esc(v.note || 'No stages. Answer directly.')}</p>`;
  } else {
    let phase = null;
    for (const b of v.batches) {
      if (b.phase !== phase) {
        phase = b.phase;
        body += `<h2 class="sec">${phase.toUpperCase()}</h2>`;
      }
      body += `<div class="batch ${b.parallel ? 'par' : ''}">${b.parallel ? `PARALLEL ×${b.stages.length}` : 'SEQUENTIAL'}</div>`;
      for (const id of b.stages) {
        const s = v.stages.find((x) => x.id === id);
        const d = divOf(s.division);
        body += `<div class="stagerow ${s.gate ? 'gated' : s.writes ? 'writes' : ''}">
          <span class="sid">${esc(s.id)}</span>
          <div>
            <div class="who">${esc(s.agent)}</div>
            <div class="owns">${esc(s.owns)}</div>
            ${s.mandatory ? `<div class="owns" style="color:var(--amber)">mandatory — ${esc(s.mandatory)}</div>` : ''}
          </div>
          <div class="meta">
            <span class="tag">${esc(d.code)}</span>
            <span class="tag ${s.writes ? 'warn' : ''}">${s.writes ? 'writes' : 'reads'}</span>
            <span class="tag">${esc(s.model)}</span>
            <span class="tag ${s.gate ? 'warn' : 'on'}">${s.gate ? esc(s.gate) : s.score}</span>
          </div>
        </div>`;
      }
    }
  }

  const dropped = v.dropped.length
    ? `<h2 class="sec">DROPPED — named, never silently truncated</h2>
       ${v.dropped.map((d) => `<div class="stagerow"><span class="sid">—</span><div><div class="who">${esc(d.agent)}</div><div class="owns">${esc(d.why)}</div></div><div class="meta"><span class="tag">${esc(d.capability)}</span></div></div>`).join('')}`
    : '';

  const runners = v.considered.filter((c) => c.runnersUp.length).length
    ? `<h2 class="sec">RUNNERS-UP — who else could have taken each stage</h2>
       <div class="panel"><div class="body"><table><tbody>
       ${v.considered
         .filter((c) => c.runnersUp.length)
         .map((c) => `<tr><td style="width:150px"><b>${esc(c.capability)}</b></td><td>${c.runnersUp.map((r) => `${esc(r.agent.name)} <span style="color:var(--faint);font-family:var(--mono)">${r.score}</span>`).join(' · ')}</td></tr>`)
         .join('')}
       </tbody></table></div></div>`
    : '';

  return `${composer}
    <div class="panel" style="margin-bottom:16px"><div class="body">
      <div style="display:flex;gap:16px;align-items:baseline;flex-wrap:wrap;margin-bottom:12px">
        <span class="tag on">${esc(v.mode.toUpperCase())}</span>
        <span style="font-size:12px;color:var(--text-2)">${esc(v.intent)}</span>
        <span style="font-size:11px;color:var(--faint);font-family:var(--mono)">${esc(v.modeWhy)}</span>
      </div>
      <div class="chevrons">${chevrons}</div>
      ${gates}
    </div></div>
    ${body}${dropped}${runners}`;
};

const viewBoard = () => {
  const { org } = state;
  const seats = org.seats
    .map(
      (s) => `<section class="panel" style="margin-bottom:12px">
        <header>${esc(s.seat)}${s.isChair ? ' · CHAIR' : ''}<span class="right">${esc(s.id)} · ${esc(s.model)}</span></header>
        <div class="body">
          <p style="margin:0 0 12px;font-size:12.5px;color:var(--text);line-height:1.6">${esc(s.owns)}</p>
          <div class="divs" style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:14px">
            ${s.divisions.map((d) => `<span class="tag on">${esc(divOf(d).name)}</span>`).join('')}
          </div>
          <dl class="detail-dl">
            <dt>STANCE</dt><dd>${esc(s.stance)}</dd>
            <dt>REFUSES</dt><dd style="color:var(--magma)">${esc(s.refuses)}</dd>
            <dt>OBJECTS WHEN</dt><dd style="color:var(--amber)">${esc(s.dissentsWhen)}</dd>
          </dl>
        </div>
      </section>`,
    )
    .join('');

  return `
    <div class="panel" style="margin-bottom:16px"><div class="body">
      <h3 style="margin:0 0 6px;font-size:13px">There is no chief executive</h3>
      <p style="margin:0 0 12px;font-size:12.5px;color:var(--text-2);line-height:1.65">${esc(org.chairAuthority)}</p>
      <h2 class="sec" style="margin-top:16px">HOW A DISAGREEMENT RESOLVES</h2>
      <ol style="margin:0;padding-left:18px;font-size:12px;color:var(--text-2);line-height:1.8">
        ${org.resolution.map((r) => `<li>${esc(r)}</li>`).join('')}
      </ol>
      <h2 class="sec">CHANNELS THAT MAY BYPASS A SEAT</h2>
      ${org.channels.map((c) => `<div style="font-size:12px;color:var(--text-2);line-height:1.7"><b style="color:var(--text)">${esc(c.between.join(' ↔ '))}</b> — ${esc(c.why)}</div>`).join('')}
    </div></div>
    ${seats}`;
};

const viewRoster = () => {
  const q = state.filter.toLowerCase();
  const sections = state.org.divisions
    .map((d) => {
      const agents = d.agents.filter(
        (a) => !q || a.name.includes(q) || a.owns.toLowerCase().includes(q) || a.capabilities.some((c) => c.includes(q)) || d.name.toLowerCase().includes(q),
      );
      if (!agents.length) return '';
      return `<section class="panel" style="margin-bottom:12px">
        <header>${esc(d.name)} · ${esc(d.code)}<span class="right">${esc(seatOf(d.seat).seat)} · ${agents.length}</span></header>
        <div class="body">${agents
          .map(
            (a) => `<div class="agentrow">
              <div class="top">
                <span class="nm">${esc(a.name)}</span>
                <span class="tag ${a.role === 'manager' ? 'warn' : a.role === 'board' ? 'on' : ''}">${esc(a.role)}</span>
                <span class="tag">${esc(a.model)}</span>
                <span class="tag ${a.writes ? 'warn' : ''}">${a.writes ? 'writes' : 'reads'}</span>
                ${a.capabilities.map((c) => `<span class="tag">${esc(c)}</span>`).join('')}
              </div>
              <p class="owns">${esc(a.owns)}</p>
              <p class="ref"><b>REFUSES</b> ${esc(a.refuses)}</p>
              ${a.knows ? `<p class="ref"><b style="color:var(--cyan)">KNOWS</b> ${esc(a.knows)}</p>` : ''}
              <p class="ref" style="color:var(--faint)">contract: ${a.contract.map(esc).join(' · ')}</p>
            </div>`,
          )
          .join('')}</div>
      </section>`;
    })
    .join('');

  return `<div class="composer"><input type="text" id="filter" placeholder="Filter by name, capability, responsibility or division…" value="${esc(state.filter)}" autocomplete="off"></div>${sections || '<p class="empty">Nothing matches that filter.</p>'}`;
};

const viewLearning = () => {
  const { live } = state;
  const ranked = Object.entries(live.memory).sort((a, b) => b[1].reliability - a[1].reliability);

  const memory = ranked.length
    ? `<div class="wide"><table>
        <thead><tr><th>AGENT</th><th class="num">RELIABILITY</th><th class="num">N</th><th class="num">CORRECTIONS</th><th>BY CAPABILITY</th></tr></thead>
        <tbody>${ranked
          .map(
            ([n, m]) => `<tr>
              <td><b>${esc(n)}</b></td>
              <td class="num">${m.reliability}<div class="bar"><i class="${m.reliability < 0.5 ? 'low' : m.reliability < 0.7 ? 'mid' : ''}" style="width:${Math.round(m.reliability * 100)}%"></i></div></td>
              <td class="num">${m.n}</td>
              <td class="num">${m.corrections || '·'}</td>
              <td>${Object.entries(m.byClass).map(([c, v]) => `<span class="tag ${v.consecutiveFailures ? 'bad' : ''}">${esc(c)} ${v.rate}${v.consecutiveFailures ? ` ✕${v.consecutiveFailures}` : ''}</span>`).join(' ')}</td>
            </tr>`,
          )
          .join('')}</tbody></table></div>`
    : `<p class="empty">No agent has been measured in this workspace. Reliability is smoothed against a <code>0.70</code> prior worth four observations, so three lucky runs never read as a perfect agent.</p>`;

  const proposals = live.proposals.length
    ? live.proposals
        .map((p) => {
          const applied = live.overlay.some((a) => a.id === p.id);
          return `<div class="proposal ${p.refused ? 'refused' : applied ? 'applied' : ''}">
            <h4>${esc(p.id)} · ${esc(p.change)}</h4>
            <p class="why">because ${esc(p.observation)} <span class="tag ${p.grade === 'EVIDENCE' ? 'good' : 'warn'}">${esc(p.grade)}</span></p>
            ${(p.body || []).map((b) => `<div class="detail">${esc(b)}</div>`).join('')}
            <div style="margin-top:10px">
              ${p.refused ? `<span class="tag bad">REFUSED — ${esc(p.refused)}</span>` : applied ? '<span class="tag good">APPLIED — delete its block from .forge/overlay.yaml to withdraw</span>' : `<button class="act amber" data-approve="${esc(p.id)}">APPROVE</button>`}
            </div>
          </div>`;
        })
        .join('')
    : `<p class="empty">No pending proposals. Not every run should produce a change — an evolution layer that always has something to say trains you to approve without reading.</p>`;

  const corrections = live.corrections.length
    ? live.corrections.map((c) => `<div class="row" style="display:grid;grid-template-columns:58px 1fr;gap:10px;padding:6px 0;font-family:var(--mono);font-size:11.5px"><span class="t" style="color:var(--faint);font-size:10px">${clock(c.at)}</span><span><b style="color:var(--text)">${esc(c.agent)}</b> <span style="color:var(--amber)">${esc(c.text)}</span></span></div>`).join('')
    : '<p class="empty">No corrections recorded.</p>';

  return `
    <div class="composer">
      <button class="act" id="relearn">RUN LEARN</button>
      <span style="align-self:center;font-size:11.5px;color:var(--faint);line-height:1.6">Reads the workspace and the ledger, writes <code style="color:var(--cyan);font-family:var(--mono)">.forge/</code>, and proposes. Applies nothing.</span>
    </div>
    <h2 class="sec">PROPOSALS — the organization proposes, you approve</h2>
    ${proposals}
    <h2 class="sec">MEASURED PERFORMANCE</h2>
    <div class="panel"><div class="body">${memory}</div></div>
    <h2 class="sec">CORRECTIONS</h2>
    <div class="panel"><div class="body">${corrections}</div></div>
    <h2 class="sec">IN FORCE IN THIS WORKSPACE</h2>
    <div class="panel"><div class="body">${
      live.overlay.length
        ? live.overlay.map((a) => `<div class="proposal applied"><h4>${esc(a.id)} · ${esc(a.change)}</h4><p class="why">${esc(a.observation)}</p></div>`).join('')
        : '<p class="empty">Nothing approved here. The shipped organization is running unmodified.</p>'
    }</div></div>`;
};

const viewCharter = () => {
  const { org } = state;
  return `
    <div class="panel" style="margin-bottom:14px"><div class="body">
      <h3 style="margin:0 0 6px;font-size:13px">${esc(org.meta.expands_to)}</h3>
      <p style="margin:0 0 8px;font-size:12.5px;color:var(--text-2);line-height:1.65">${esc(org.meta.premise)}</p>
      <p style="margin:0;font-size:12px;color:var(--cyan)">North star — ${esc(org.meta.north_star)}</p>
    </div></div>
    <h2 class="sec">THE RULES — each names the check that enforces it</h2>
    ${org.rules
      .map(
        (r) => `<div class="proposal"><h4>${esc(r.id)} · ${esc(r.title)}</h4>
          <p class="why">${esc(r.statement)}</p>
          <div class="detail">enforced by <span style="color:var(--cyan)">${esc(r.check)}</span></div></div>`,
      )
      .join('')}
    <h2 class="sec">THE GATES — the loudest thing the organization does</h2>
    ${org.gates.map((g) => `<div class="gatecard"><h4>${esc(g.title)}</h4><p>${esc(g.why)}</p><p class="matched">${g.matches.map(esc).join(' · ')}</p></div>`).join('')}
    <h2 class="sec">PRINCIPLES — behaviour, not virtue</h2>
    <div class="panel"><div class="body"><table><tbody>
      ${org.principles.map((p) => `<tr><td style="width:190px"><b>${esc(p.name)}</b></td><td>${esc(p.behaviour)}</td></tr>`).join('')}
    </tbody></table></div></div>
    <h2 class="sec">ESCALATION — each rung is tried before the next</h2>
    <div class="panel"><div class="body">
      <div class="chevrons">${org.ladder.map((r, i) => `<span class="chev ${i === org.ladder.length - 1 ? 'gate' : 'on'}">${esc(r.toUpperCase())}</span>`).join('')}</div>
      <p style="font-size:12px;color:var(--text-2);margin:12px 0 6px">Straight to the Principal, skipping the ladder:</p>
      <ul style="margin:0;padding-left:18px;font-size:12px;color:var(--text-2);line-height:1.8">${org.escalateNow.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
    </div></div>`;
};

const viewAudit = () => `
  <div class="composer"><button class="act" id="rundoctor">RUN THE AUDIT</button>
  <span style="align-self:center;font-size:11.5px;color:var(--faint)">Twelve constitutional rules and six hygiene checks. Non-zero exit on any violation.</span></div>
  <div class="panel"><div class="body"><pre id="doctorout" style="margin:0;font-family:var(--mono);font-size:11.5px;line-height:1.75;color:var(--text-2);white-space:pre-wrap">Press RUN THE AUDIT.</pre></div></div>`;

const VIEWS = { deck: viewDeck, vector: viewVector, board: viewBoard, roster: viewRoster, learning: viewLearning, charter: viewCharter, audit: viewAudit };

// ───────────────────────────────────────────────────────────────────────── shell

const paintSpine = () => {
  const { org, live } = state;
  $('#expands').textContent = org.meta.expands_to;
  $('#ws').textContent = live.workspace;
  $('#obs').textContent = live.observations;
  $('#health').textContent = live.health.ok ? `HEALTHY${live.health.warnings ? ` · ${live.health.warnings} warn` : ''}` : `${live.health.failures} FAILURES`;
  $('#healthdot').className = `pulse${live.health.ok ? (live.health.warnings ? ' warn' : '') : ' bad'}`;
  $('#n-roster').textContent = org.divisions.reduce((n, d) => n + d.agents.length, 0);
  $('#n-rules').textContent = org.rules.length;
  $('#n-prop').textContent = live.proposals.filter((p) => !p.refused).length || '';
};

const render = () => {
  if (!state.org || !state.live) return;
  paintSpine();
  for (const b of document.querySelectorAll('.navitem')) b.setAttribute('aria-current', String(b.dataset.view === state.view));
  $('#stage').innerHTML = VIEWS[state.view]();
  // Keep focus in the field the reader was typing in across a redraw.
  const keep = state.view === 'roster' ? '#filter' : state.view === 'vector' ? '#req' : null;
  if (keep && state.focusField === keep) {
    const el = $(keep);
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }
};

const refresh = async () => {
  state.live = await api('/api/state');
  render();
};

const compose = async () => {
  const request = $('#req').value.trim();
  if (!request) return;
  state.planning = true;
  render();
  try {
    state.vector = await api('/api/plan', { request, mode: $('#mode')?.value || undefined });
  } catch (e) {
    state.vector = null;
    alert(e.message);
  }
  state.planning = false;
  render();
};

document.addEventListener('click', async (e) => {
  const nav = e.target.closest('.navitem');
  if (nav) {
    state.view = nav.dataset.view;
    state.focusField = null;
    const u = new URL(location.href);
    u.searchParams.set('view', state.view);
    history.replaceState(null, '', u);
    render();
    return;
  }

  const hex = e.target.closest('.hex');
  if (hex) {
    state.selected = state.selected === hex.dataset.div ? null : hex.dataset.div;
    render();
    return;
  }

  if (e.target.id === 'compose') return compose();

  if (e.target.id === 'relearn') {
    e.target.disabled = true;
    await api('/api/learn', {});
    await refresh();
    return;
  }

  if (e.target.dataset.approve) {
    const id = e.target.dataset.approve;
    e.target.disabled = true;
    try {
      await api('/api/approve', { id });
    } catch (err) {
      alert(err.message);
    }
    await refresh();
    return;
  }

  if (e.target.id === 'rundoctor') {
    const out = $('#doctorout');
    out.textContent = 'running…';
    const r = await api('/api/doctor');
    out.textContent = r.lines.join('\n');
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'filter') {
    state.filter = e.target.value;
    state.focusField = '#filter';
    render();
  }
  if (e.target.id === 'req') state.focusField = '#req';
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'req') compose();
});

/**
 * Live updates are opt-out via `?live=0`.
 *
 * An open EventSource never lets a page reach network idle, so a headless capture of the
 * deck hangs forever waiting for it. That is a real property worth an escape hatch: it makes
 * the deck screenshot-able for documentation and testable in CI, and it is the same switch
 * anyone would want to freeze the view while reading it.
 */
const LIVE = new URLSearchParams(location.search).get('live') !== '0';

const connect = () => {
  if (!LIVE) {
    $('#live').innerHTML = '<span style="color:var(--faint)">○ static</span>';
    return;
  }
  const src = new EventSource('/api/events');
  src.onopen = () => {
    $('#live').innerHTML = '<span style="color:var(--jade)">● live</span>';
  };
  src.addEventListener('dirty', refresh);
  src.onerror = () => {
    $('#live').innerHTML = '<span style="color:var(--amber)">● reconnecting</span>';
  };
};

(async () => {
  state.org = await api('/api/org');
  state.live = await api('/api/state');
  render();
  // `?request=` composes on load, so a Vector can be linked to as well as reached.
  const seeded = params.get('request');
  if (seeded) {
    const el = $('#req');
    if (el) {
      el.value = seeded;
      await compose();
    }
  }
  connect();
  // The stream is an optimisation, never the only path. fs.watch is best-effort across
  // platforms, and a missed event would freeze the deck with no sign that it had.
  if (LIVE) setInterval(refresh, 8000);
})();
