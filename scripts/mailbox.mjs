/**
 * The mailbox — how the Principal talks to the organization between sessions.
 *
 * THE HONEST LATENCY MODEL, STATED UP FRONT
 *
 * The Console has no model runtime, so it cannot make a manager answer live. What it can
 * do is take a message and guarantee delivery: everything queued here is surfaced by
 * `forge context` at the start of the next session in this workspace, and the addressed
 * agent answers with `forge reply`. Chat-shaped, delivered like mail. Pretending otherwise
 * — a spinner over a canned response — would be the one lie this repository is built to
 * refuse.
 *
 * ONE STORE, THREE LENSES
 *
 * A chat message, an idea for the Discovery Lab, and a repository to reverse-engineer are
 * the same thing: a message with a kind. One append-only file, one reply mechanism, one
 * threading rule. Three stores would be three sync bugs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { workspaceDir } from './core.mjs';

export const KINDS = ['message', 'idea', 'repo'];

const inboxPath = (cwd) => path.join(workspaceDir(cwd), 'inbox.jsonl');

const newId = () => `M${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`;

/** Post one message from the Principal. Validates against the ROSTER, not against hope. */
export const post = ({ to, body, kind = 'message', url = null }, org, cwd = process.cwd()) => {
  if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`);
  const text = String(body || '').trim();
  if (!text) throw new Error('an empty message delivers nothing');
  if (text.length > 4000) throw new Error('keep it under 4000 characters — a brief, not a spec');
  if (!org.byName.has(String(to))) throw new Error(`nobody on the roster is named "${to}"`);
  if (kind === 'repo') {
    if (!/^https:\/\/[^\s]+$/.test(String(url || ''))) throw new Error('a repo intake needs an https:// URL');
  }
  const row = { id: newId(), at: new Date().toISOString(), from: 'principal', to: String(to), kind, body: text, url };
  fs.mkdirSync(workspaceDir(cwd), { recursive: true });
  fs.appendFileSync(inboxPath(cwd), `${JSON.stringify(row)}\n`);
  return row;
};

/** An agent answers. `re` must name a real queued message — a reply to nothing is noise. */
export const reply = ({ re, from, body }, org, cwd = process.cwd()) => {
  const text = String(body || '').trim();
  if (!text) throw new Error('an empty reply answers nothing');
  if (!org.byName.has(String(from))) throw new Error(`nobody on the roster is named "${from}"`);
  const all = read(cwd);
  if (!all.some((m) => m.id === re && m.from === 'principal')) throw new Error(`no message ${re} to answer`);
  const row = { id: newId(), at: new Date().toISOString(), from: String(from), to: 'principal', re, kind: 'reply', body: text };
  fs.appendFileSync(inboxPath(cwd), `${JSON.stringify(row)}\n`);
  return row;
};

export const read = (cwd = process.cwd()) => {
  const p = inboxPath(cwd);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null; // one corrupt line must not eat the mailbox
      }
    })
    .filter(Boolean);
};

/** Threads: each Principal message with its replies, newest thread first. */
export const threads = (cwd = process.cwd()) => {
  const all = read(cwd);
  const roots = all.filter((m) => m.from === 'principal');
  const byRe = new Map();
  for (const m of all) {
    if (m.re) {
      if (!byRe.has(m.re)) byRe.set(m.re, []);
      byRe.get(m.re).push(m);
    }
  }
  return roots
    .map((r) => ({ ...r, replies: byRe.get(r.id) || [], answered: (byRe.get(r.id) || []).length > 0 }))
    .reverse();
};

/** What the next session must deal with: queued, unanswered, oldest first. */
export const waiting = (cwd = process.cwd()) => threads(cwd).filter((t) => !t.answered).reverse();
