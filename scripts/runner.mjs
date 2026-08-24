/**
 * The runner — the Console's bridge to Claude Code itself.
 *
 * THE DECISION THIS FILE RECORDS
 *
 * The Console was built read-mostly on purpose: "a second thing that can start work is a
 * second thing that can start work nobody asked for." The Principal has now asked. The
 * honest way to grant it is not to grow a model runtime here — it is to make the Console a
 * FRONT-END to the runtime that already exists: each send spawns `claude` headlessly in
 * the chosen workspace, so the Principal's existing auth, permission system, hooks, gates
 * and briefing all apply, because it IS Claude Code underneath. The alternative (a second
 * runtime with its own key and its own rules) was rejected and is recorded here.
 *
 * Two modes, and the difference is enforced, not requested:
 *   ask  — --permission-mode plan: the organization may read and answer, never write.
 *   do   — --permission-mode acceptEdits: file edits in the workspace proceed; Claude
 *          Code's own gates still hold for anything beyond that, and F.O.R.G.E.'s seven
 *          gates ride in through the routing hook like every other session.
 *
 * A finished run files its answer back into the mailbox as a reply, so the thread reads
 * the same whether the organization answered live or at its next convening.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { workspaceDir } from './core.mjs';

const BIN = () => process.env.FORGE_CLAUDE_BIN || 'claude';

/** Live runs, per deck process. The durable record is the mailbox reply, not this map. */
const runs = new Map();
let seq = 0;

const runsPath = (cwd) => path.join(workspaceDir(cwd), 'runs.jsonl');

/** thread → Claude session id, latest wins, so a thread continues one conversation. */
export const sessionForThread = (threadId, cwd) => {
  const p = runsPath(cwd);
  if (!fs.existsSync(p)) return null;
  let found = null;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      const r = JSON.parse(line);
      if (r.threadId === threadId && r.sessionId) found = r.sessionId;
    } catch { /* one corrupt line */ }
  }
  return found;
};

export const startRun = ({ to, body, mode = 'ask', threadId = null }, { cwd, onEvent, onDone }) => {
  const id = `R${Date.now().toString(36)}${(seq += 1)}`;
  const resume = threadId ? sessionForThread(threadId, cwd) : null;

  const prompt = [
    `The Principal writes to ${to} through the F.O.R.G.E. Console.`,
    mode === 'ask' ? 'Answer without changing any files — this is a question, not a work order.' : 'This is a work order for this workspace.',
    'When finished, give ONE plain-language answer for the Principal — no internal routing, no field ceremony.',
    '',
    body,
  ].join('\n');

  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', mode === 'do' ? 'acceptEdits' : 'plan',
    ...(resume ? ['--resume', resume] : []),
  ];

  let child;
  try {
    // A .mjs runtime (the test stub) is spawned through node itself — Windows cannot
    // execute a script file directly, and a shell:true spawn would reopen quoting bugs.
    const bin = BIN();
    const viaNode = bin.endsWith('.mjs') || bin.endsWith('.js');
    child = viaNode
      ? spawn(process.execPath, [bin, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
      : spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  } catch (e) {
    return { id, error: e.message };
  }

  const run = { id, to, mode, threadId, cwd, status: 'running', startedAt: Date.now(), sessionId: resume, text: '', usage: null, exit: null, child };
  runs.set(id, run);
  if (runs.size > 50) for (const [k, v] of runs) if (v.status !== 'running') { runs.delete(k); break; }

  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue; // a partial or non-JSON line is not an event
      }
      if (ev.type === 'system' && ev.subtype === 'init' && ev.session_id) {
        run.sessionId = ev.session_id;
        fs.mkdirSync(workspaceDir(cwd), { recursive: true });
        fs.appendFileSync(runsPath(cwd), `${JSON.stringify({ at: new Date().toISOString(), runId: id, threadId, sessionId: ev.session_id })}\n`);
      }
      if (ev.type === 'assistant') {
        for (const block of ev.message?.content || []) {
          if (block.type === 'text' && block.text) {
            run.text += (run.text ? '\n\n' : '') + block.text;
            onEvent?.({ runId: id, kind: 'text', text: block.text });
          }
          if (block.type === 'tool_use') onEvent?.({ runId: id, kind: 'tool', name: block.name });
        }
      }
      if (ev.type === 'result') {
        run.usage = { turns: ev.num_turns ?? null, costUsd: ev.total_cost_usd ?? null, durationMs: ev.duration_ms ?? null };
        if (ev.result && (!run.text || ev.subtype === 'success')) run.text = ev.result;
      }
    }
  });

  let err = '';
  child.stderr.on('data', (c) => { err += c; if (err.length > 8000) err = err.slice(-8000); });

  child.on('close', (code) => {
    run.exit = code;
    run.status = run.status === 'killed' ? 'killed' : code === 0 ? 'done' : 'failed';
    if (run.status === 'failed' && !run.text) run.text = `The run failed (exit ${code}). ${err.split('\n').slice(-3).join(' ').trim()}`.trim();
    onDone?.(run);
    onEvent?.({ runId: id, kind: 'status', status: run.status });
  });

  return { id };
};

export const getRun = (id) => {
  const r = runs.get(id);
  if (!r) return null;
  const { child, ...rest } = r;
  return rest;
};

export const killRun = (id) => {
  const r = runs.get(id);
  if (!r || r.status !== 'running') return false;
  r.status = 'killed';
  try { r.child.kill('SIGTERM'); } catch { /* already gone */ }
  return true;
};

export const activeRuns = () => [...runs.values()].filter((r) => r.status === 'running').map(({ child, ...r }) => r);
