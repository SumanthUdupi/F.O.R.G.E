/**
 * Live activity, read from the host runtime's own transcripts.
 *
 * WHY THIS EXISTS
 *
 * The Console could see only the runs it started itself, in one workspace, so the
 * organization looked idle while the Principal was working with it — the honest complaint
 * that produced this file. The truth was already on disk: every session writes a JSONL
 * transcript recording its cwd, its branch, every tool call, and every subagent dispatch
 * by name. That is ground truth about what the organization is actually doing, and none
 * of it needs inventing.
 *
 * TWO RULES THAT SHAPE EVERY FUNCTION HERE
 *
 * 1. Never invent activity. If a session's last line is thirty minutes old it is idle,
 *    and it says idle. A dashboard that animates on hope is worse than a blank one.
 * 2. Never read 29MB to answer "what is happening now". Files are tailed from the end
 *    with a bounded window and cached on (mtime, size), so a poll costs kilobytes.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PROJECTS = () => path.join(os.homedir(), '.claude', 'projects');
const TAIL_BYTES = 260_000;      // enough for a few hundred recent lines on a busy session
const ACTIVE_MS = 3 * 60 * 1000; // "working right now" — deliberately short, so idle reads idle
const RECENT_MS = 45 * 60 * 1000;

const cache = new Map();

/**
 * The editors currently linked to Claude Code, straight from ~/.claude/ide/*.lock.
 *
 * This is the authoritative answer to "which VS Code windows are connected", and it is
 * the one the transcripts cannot give: an editor can be open and linked with no session
 * started yet, so it has no transcript at all. The Principal asked why a workspace they
 * see in VS Code was missing from the Console — this is why, and this is the fix.
 *
 * The recorded pid is checked for liveness, because a crashed editor leaves its lock
 * behind and a stale lock claiming a live editor is exactly the kind of confident lie
 * this reader exists to avoid.
 */
export const connectedEditors = () => {
  const dir = path.join(os.homedir(), '.claude', 'ide');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.lock')) continue;
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    let alive = true;
    try { process.kill(j.pid, 0); } catch { alive = false; }
    for (const folder of j.workspaceFolders || []) {
      out.push({ ide: j.ideName || 'editor', pid: j.pid, folder, alive });
    }
  }
  return out;
};

/**
 * Sessions this organization started for its own machinery — E2E runs, smoke tests, the
 * deck's own probes. They are real sessions, and showing them as the Principal's work is
 * noise that made the live count wrong: "2 sessions live" was this conversation plus one
 * of my own test directories. Same class as the temp-directory pollution already fixed in
 * the workspace registry.
 */
const isOwnNoise = (s) => {
  const cwd = s.cwd || '';
  const tmp = path.resolve(os.tmpdir());
  if (cwd.startsWith(tmp) || /^(\/private)?\/tmp\//.test(cwd) || cwd.includes('/var/folders/')) return true;
  return s.entrypoint === 'sdk-cli';
};

/** Read the last window of a file as complete lines, newest last. */
const tailLines = (file, size) => {
  const start = Math.max(0, size - TAIL_BYTES);
  const fd = fs.openSync(file, 'r');
  try {
    const len = size - start;
    const buf = Buffer.allocUnsafe(len);
    fs.readSync(fd, buf, 0, len, start);
    const text = buf.toString('utf8');
    const lines = text.split('\n');
    if (start > 0) lines.shift(); // the first line is a fragment
    return lines.filter(Boolean);
  } finally {
    fs.closeSync(fd);
  }
};

/** Human phrase for what a tool call is doing — the Principal reads verbs, not tool names. */
const phrase = (name, input = {}) => {
  const base = (p) => (p ? String(p).split('/').filter(Boolean).slice(-1)[0] : '');
  switch (name) {
    case 'Read': return `reading ${base(input.file_path)}`;
    case 'Edit': return `editing ${base(input.file_path)}`;
    case 'Write': return `writing ${base(input.file_path)}`;
    case 'Bash': return input.description ? String(input.description).toLowerCase() : 'running a command';
    case 'Grep': return `searching for ${String(input.pattern || '').slice(0, 30)}`;
    case 'Glob': return 'looking for files';
    case 'Task': return `dispatched ${input.subagent_type || 'a specialist'}`;
    case 'WebFetch': case 'WebSearch': return 'researching';
    case 'TodoWrite': return 'planning';
    default: return `using ${name}`;
  }
};

/**
 * Parse one session file into a live summary.
 *
 * Only the tail is parsed, so `agents` is who has been involved RECENTLY, not ever — which
 * is the honest answer to "who is on this" and the useful one.
 */
const readSession = (file) => {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const key = `${file}:${st.mtimeMs}:${st.size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const out = {
    id: path.basename(file, '.jsonl'),
    cwd: null, branch: null, slug: null, model: null, entrypoint: null,
    lastAt: st.mtime, startedAt: st.birthtime, size: st.size,
    turns: 0, tokens: 0, cacheRead: 0,
    agents: [], doing: null, doingAt: null, tools: [],
  };

  const agentSeen = new Map();
  const toolTrail = [];
  for (const line of tailLines(file, st.size)) {
    if (line.length < 20) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.cwd) out.cwd = j.cwd;
    if (j.gitBranch) out.branch = j.gitBranch;
    if (j.slug) out.slug = j.slug;
    if (j.entrypoint) out.entrypoint = j.entrypoint;
    const u = j.message?.usage;
    if (u) {
      out.turns += 1;
      out.tokens += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
      out.cacheRead += u.cache_read_input_tokens || 0;
      if (j.message?.model) out.model = j.message.model;
    }
    for (const c of j.message?.content || []) {
      if (c.type !== 'tool_use') continue;
      const at = j.timestamp ? new Date(j.timestamp) : st.mtime;
      toolTrail.push({ name: c.name, text: phrase(c.name, c.input), at });
      const sub = c.input?.subagent_type;
      if (sub) agentSeen.set(sub, at);
    }
  }

  out.tools = toolTrail.slice(-8).reverse();
  const last = toolTrail[toolTrail.length - 1];
  if (last) { out.doing = last.text; out.doingAt = last.at; }
  out.agents = [...agentSeen.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, at]) => ({ name, at }));
  out.active = Date.now() - st.mtime.getTime() < ACTIVE_MS;
  out.recent = Date.now() - st.mtime.getTime() < RECENT_MS;

  cache.set(key, out);
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return out;
};

/**
 * Every session on this machine, newest first — across ALL workspaces.
 *
 * `scanLimit` bounds the work: only the most recently touched files per workspace are
 * parsed, because a machine with a year of history should not make the Console slow.
 */
export const allSessions = ({ limit = 24, perWorkspace = 6, includeOwnNoise = false } = {}) => {
  const root = PROJECTS();
  // One shape, always. The first version returned a short object on the no-transcripts
  // path, so activeCount came back undefined on exactly the machine that path exists for
  // — a CI runner with no ~/.claude/projects. A contract that changes shape when the
  // answer is "nothing" is not a contract.
  if (!fs.existsSync(root)) return { available: false, total: 0, sessions: [], hidden: 0, editors: connectedEditors(), activeCount: 0 };
  const files = [];
  for (const dir of fs.readdirSync(root)) {
    const full = path.join(root, dir);
    let entries = [];
    try { entries = fs.readdirSync(full).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    const withStat = entries
      .map((f) => { try { return { f: path.join(full, f), m: fs.statSync(path.join(full, f)).mtimeMs }; } catch { return null; } })
      .filter(Boolean)
      .sort((a, b) => b.m - a.m)
      .slice(0, perWorkspace);
    files.push(...withStat);
  }
  files.sort((a, b) => b.m - a.m);
  const editors = connectedEditors();
  let sessions = files.slice(0, limit * 2).map((x) => readSession(x.f)).filter(Boolean);
  const hidden = includeOwnNoise ? 0 : sessions.filter(isOwnNoise).length;
  if (!includeOwnNoise) sessions = sessions.filter((s) => !isOwnNoise(s));
  sessions = sessions.slice(0, limit);
  for (const s of sessions) {
    const link = editors.find((e) => e.alive && s.cwd && (s.cwd === e.folder || s.cwd.startsWith(`${e.folder}/`)));
    s.ide = link ? link.ide : null;
  }
  return {
    available: true,
    total: files.length,
    sessions,
    hidden,
    editors,
    activeCount: sessions.filter((s) => s.active).length,
  };
};

/**
 * The org-wide feed: what the whole organization is doing right now, one line each.
 * Names only agents the transcripts actually recorded — never a guess.
 */
export const orgActivity = () => {
  const { sessions, available, activeCount = 0 } = allSessions({ limit: 24 });
  const events = [];
  const agentBusy = new Map();
  for (const s of sessions) {
    if (!s.recent) continue;
    for (const t of s.tools.slice(0, 4)) {
      events.push({ at: t.at, session: s.id, workspace: s.cwd ? path.basename(s.cwd) : 'unknown', text: t.text, tool: t.name });
    }
    for (const a of s.agents) {
      const prev = agentBusy.get(a.name);
      if (!prev || a.at > prev.at) agentBusy.set(a.name, { at: a.at, session: s.id, workspace: s.cwd ? path.basename(s.cwd) : 'unknown' });
    }
  }
  events.sort((a, b) => new Date(b.at) - new Date(a.at));
  return {
    available,
    activeCount,
    editors: connectedEditors(),
    events: events.slice(0, 40),
    busyAgents: [...agentBusy.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => new Date(b.at) - new Date(a.at)),
  };
};

/**
 * The agent board: every specialist the organization has, and what it is doing.
 *
 * Three honest states, and the third is the point — "idle" and "never used here" are
 * different facts, and collapsing them would hide the roster's real shape from the
 * Principal who is trying to decide whether an agent earns its desk.
 */
export const agentBoard = (org) => {
  const { sessions } = allSessions({ limit: 24 });
  const working = new Map();
  for (const s of sessions) {
    if (!s.recent) continue;
    for (const a of s.agents) {
      const prev = working.get(a.name);
      if (!prev || a.at > prev.at) {
        working.set(a.name, { at: a.at, workspace: s.cwd ? path.basename(s.cwd) : 'unknown', live: s.active, doing: s.doing });
      }
    }
  }
  const rows = [];
  for (const d of org.constitution.divisions) {
    for (const a of org.byDivision.get(d.id) || []) {
      const w = working.get(a.name);
      rows.push({
        name: a.name, division: d.name, role: a.role, owns: a.owns,
        state: w ? (w.live ? 'working' : 'recent') : 'available',
        at: w ? w.at : null, workspace: w ? w.workspace : null, doing: w ? w.doing : null,
      });
    }
  }
  const rank = { working: 0, recent: 1, available: 2 };
  rows.sort((a, b) => rank[a.state] - rank[b.state] || (b.at ? new Date(b.at) : 0) - (a.at ? new Date(a.at) : 0));
  return { rows, workingCount: rows.filter((r) => r.state === 'working').length };
};
