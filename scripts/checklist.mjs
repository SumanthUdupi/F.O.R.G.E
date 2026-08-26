/**
 * Completion auditing — closing the loop between what was asked and what was delivered.
 *
 * THE FAILURE THIS EXISTS FOR
 *
 * You give five items. One gets done well. The rest are dropped, half-done, or silently
 * skipped, and nothing says so until you notice yourself. The Chair composes the Vector and
 * sequences it; the handoff contract requires fields per stage — but nothing ever diffed
 * REQUEST ITEMS against DELIVERED ITEMS. Every part of the machinery was working and the
 * request was still only two-thirds answered.
 *
 * The fix is deliberately mechanical, not a model call. A model asked "did you do
 * everything?" will say yes, because saying yes is what the surrounding text rewards. A file
 * that lists five items and shows two still PENDING cannot be talked around.
 *
 * DECOMPOSITION RULES, learned from watching this go wrong
 *
 * One item = one thing that can be independently verified as done or not done. A clause
 * joined by "and" is almost always a separate item. An item restated from an earlier message
 * is STILL an item — it is marked `repeat`, because a repeat is evidence the last pass failed,
 * not evidence it can be skipped.
 */

import fs from 'node:fs';
import path from 'node:path';
import { workspaceDir } from './core.mjs';

export const STATUSES = ['PENDING', 'SUCCESS', 'FAILED', 'BLOCKED'];
export const TERMINAL = ['SUCCESS', 'FAILED', 'BLOCKED'];

const dir = (cwd) => path.join(workspaceDir(cwd), 'checklists');
const file = (campaign, cwd) => path.join(dir(cwd), `${String(campaign).replace(/[^A-Za-z0-9._-]/g, '_')}.json`);

/**
 * Split a request into atomic items — deterministic, no model call.
 *
 * This is a helper, not an oracle. It splits on the boundaries that actually carry separate
 * asks in the requests this organization receives: newlines, numbered or bulleted lists,
 * sentence ends, and the conjunctions that join two imperatives. A caller that has already
 * decomposed the request passes an array and skips this entirely.
 */
export const decompose = (request) => {
  const text = String(request || '').trim();
  if (!text) return [];

  // Lists first — an explicit list is the author telling you where the boundaries are, and
  // guessing at them again with sentence rules would only lose that information.
  const listish = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => /^([-*•]|\d+[.)])\s+/.test(l));
  if (listish.length > 1) return listish.map((l) => l.replace(/^([-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean);

  const parts = [];
  for (const line of text.split(/\n+/)) {
    for (const sentence of line.split(/(?<=[.!?;])\s+/)) {
      const s = sentence.trim();
      if (!s) continue;
      for (const piece of splitClauses(s)) {
        const p = piece.replace(/^(?:and|also|then|plus)\s+/i, '').trim();
        if (p.length > 3) parts.push(p);
      }
    }
  }
  return parts;
};

/**
 * A comma between two imperatives is a list; a comma anywhere else is punctuation.
 *
 * "make it compact, reduce the tabs, combine overview into change" is THREE asks, and the
 * first version of this read it as one because it only split on ", and". That is the exact
 * failure this module exists to prevent, found by running it rather than by reasoning about
 * it — the decomposer silently under-counting is worse than no decomposer, because the
 * checklist then reports 2/2 complete while the third item was never seen.
 *
 * The test for "is this fragment a new ask" is whether it STARTS WITH AN IMPERATIVE. That
 * needs a verb list, which is unashamedly a heuristic: it will miss an unusual verb, and a
 * caller who has already decomposed the request passes an array and skips this entirely.
 * A bounded, inspectable, wrong-in-a-knowable-direction list beats a clever rule that
 * over-splits prose, because a spurious item is noise the Principal has to dismiss while a
 * missed item is the bug.
 */
const IMPERATIVES = [
  'add', 'remove', 'delete', 'fix', 'make', 'build', 'create', 'write', 'update', 'change',
  'move', 'rename', 'refactor', 'reduce', 'increase', 'combine', 'merge', 'split', 'gate',
  'check', 'verify', 'test', 'run', 'ensure', 'implement', 'support', 'handle', 'show',
  'hide', 'render', 'improve', 'clean', 'document', 'record', 'migrate', 'deploy', 'install',
  'enable', 'disable', 'replace', 'extract', 'expose', 'wire', 'stop', 'start', 'keep',
  'drop', 'sort', 'group', 'cache', 'log', 'send', 'print', 'set', 'give', 'let', 'put',
];
const IMPERATIVE_RE = new RegExp(`^(?:${IMPERATIVES.join('|')})\\b`, 'i');

export const splitClauses = (sentence) => {
  const out = [];
  let current = [];
  for (const raw of String(sentence).split(/\s*,\s*/)) {
    const frag = raw.trim();
    if (!frag) continue;
    const lead = frag.replace(/^(?:and|also|then|plus)\s+/i, '');
    // A new ask if it opens with an imperative, or is explicitly joined as an additional
    // one ("and also ..."). Otherwise it is a continuation of the clause before it, and
    // re-joining with the comma preserves the author's sentence rather than shredding it.
    const isNew = IMPERATIVE_RE.test(lead) || /^(?:and|also|then|plus)\s/i.test(frag);
    if (isNew && current.length) {
      out.push(current.join(', '));
      current = [frag];
    } else {
      current.push(frag);
    }
  }
  if (current.length) out.push(current.join(', '));
  // " and also " inside a single clause is the same signal without a comma.
  return out.flatMap((c) => c.split(/\s+(?:and also)\s+/i)).map((c) => c.trim()).filter(Boolean);
};

/** Write the checklist for a campaign. Refuses to clobber one that already has progress. */
export const writeChecklist = (campaign, items, cwd = process.cwd(), { force = false } = {}) => {
  const p = file(campaign, cwd);
  if (fs.existsSync(p) && !force) {
    const existing = readChecklist(campaign, cwd);
    if (existing.items.some((i) => i.status !== 'PENDING')) {
      throw new Error(`checklist for ${campaign} already has progress — pass force to overwrite, or use markItem`);
    }
  }
  const list = {
    campaign,
    created: new Date().toISOString(),
    items: (items || []).map((it, i) => {
      const text = typeof it === 'string' ? it : it.text;
      return {
        id: typeof it === 'object' && it.id ? it.id : `${i + 1}`,
        text,
        status: 'PENDING',
        repeat: typeof it === 'object' ? Number(it.repeat || 0) : 0,
        area: (typeof it === 'object' && it.area) || null,
        evidence: null,
      };
    }),
  };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(list, null, 2)}\n`);
  return list;
};

export const readChecklist = (campaign, cwd = process.cwd()) => {
  const p = file(campaign, cwd);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { campaign, created: parsed.created || null, items: parsed.items || [] };
  } catch {
    return { campaign, created: null, items: [], corrupt: true };
  }
};

/** Give one item a terminal status. Evidence is required for SUCCESS and for nothing else. */
export const markItem = (campaign, id, status, { evidence = null, cwd = process.cwd() } = {}) => {
  if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
  const list = readChecklist(campaign, cwd);
  if (!list) throw new Error(`no checklist for campaign ${campaign}`);
  const item = list.items.find((i) => String(i.id) === String(id));
  if (!item) throw new Error(`checklist ${campaign} has no item ${id}`);
  if (status === 'SUCCESS' && !evidence) {
    throw new Error(`item ${id} cannot be SUCCESS with no evidence — that is the claim this file exists to stop`);
  }
  item.status = status;
  item.evidence = evidence;
  fs.writeFileSync(file(campaign, cwd), `${JSON.stringify({ campaign, created: list.created, items: list.items }, null, 2)}\n`);
  return item;
};

/**
 * Is every item terminal?
 *
 * Note what this deliberately does NOT do: it does not judge whether the work was good, and
 * it does not treat FAILED or BLOCKED as incomplete. An item honestly marked BLOCKED with a
 * reason is a finished conversation. An item still PENDING is the one that was forgotten.
 */
export const checklistComplete = (campaign, cwd = process.cwd()) => {
  const list = readChecklist(campaign, cwd);
  if (!list) return { complete: false, missing: true, open: [], items: [], why: `no checklist exists for ${campaign}` };
  const open = list.items.filter((i) => !TERMINAL.includes(i.status));
  return {
    complete: open.length === 0,
    missing: false,
    open,
    items: list.items,
    why: open.length ? `${open.length} of ${list.items.length} item(s) have no terminal status` : `all ${list.items.length} item(s) accounted for`,
  };
};

export const listChecklists = (cwd = process.cwd()) => {
  const d = dir(cwd);
  if (!fs.existsSync(d)) return [];
  return fs
    .readdirSync(d)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readChecklist(f.replace(/\.json$/, ''), cwd))
    .filter(Boolean);
};
