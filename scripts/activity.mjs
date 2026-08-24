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
    cwd: null, branch: null, slug: null, model: null,
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
export const allSessions = ({ limit = 24, perWorkspace = 6 } = {}) => {
  const root = PROJECTS();
  // One shape, always. The first version returned a short object on the no-transcripts
  // path, so activeCount came back undefined on exactly the machine that path exists for
  // — a CI runner with no ~/.claude/projects. A contract that changes shape when the
  // answer is "nothing" is not a contract.
  if (!fs.existsSync(root)) return { available: false, total: 0, sessions: [], activeCount: 0 };
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
  const sessions = files.slice(0, limit).map((x) => readSession(x.f)).filter(Boolean);
  return {
    available: true,
    total: files.length,
    sessions,
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
    events: events.slice(0, 40),
    busyAgents: [...agentBusy.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => new Date(b.at) - new Date(a.at)),
  };
};
