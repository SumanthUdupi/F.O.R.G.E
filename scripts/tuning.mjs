/**
 * Per-agent tuning — the Principal's hand on any agent, manager or specialist.
 *
 * WHERE AN EDIT MAY LAND, AND WHY NOT THE REGISTRY
 *
 * The obvious implementation is "let the Console edit registry/roster.yaml". It is also
 * the wrong one: the roster is the shipped organization, doctor audits it, CI diffs it,
 * and a hand-edit there would be overwritten by the next `forge build` or silently break
 * a constitutional rule. So tuning is a per-workspace OVERLAY — `.forge/tuning.json` —
 * applied on top of the registry at render time. The shipped organization stays pristine
 * and portable; this machine's opinions stay on this machine.
 *
 * WHAT MAY BE TUNED, AND WHAT MAY NOT
 *
 * Editable: model tier, the stance, the refusal, extra standing instructions, and a
 * routing nudge. Those are how an agent BEHAVES.
 *
 * Refused: name, id, division, role, and `owns`. Those are how the organization is
 * SHAPED, and RULES 001–005 are asserted against them — letting a text box rename an
 * agent's division would let the Console quietly produce an unconstitutional org that
 * doctor would then fail. Shape changes belong in the registry, by hand, deliberately.
 *
 * Every field is individually revertible, and a field the Principal has not touched
 * stays absent rather than being written as a copy of the default — so an upgrade to the
 * shipped roster still reaches an agent the Principal has partly tuned.
 */

import fs from 'node:fs';
import path from 'node:path';
import { workspaceDir } from './core.mjs';

/** Fields the Principal may set. Anything else submitted is refused, loudly. */
export const TUNABLE = {
  model: { label: 'Model tier', kind: 'choice', options: ['lean', 'standard', 'deep'], help: 'Lean is cheap and fast; deep is for ambiguity, architecture and anything irreversible.' },
  stance: { label: 'How they work', kind: 'text', help: 'The disposition that shapes their judgement. Written to them, in the second person.' },
  refuses: { label: "What they won't do", kind: 'text', help: 'The sentence that makes them decline something. A stance without a refusal changes nothing.' },
  instructions: { label: 'Standing instructions', kind: 'lines', help: 'One per line. Added to their prompt for this workspace only.' },
  routingBias: { label: 'Routing preference', kind: 'choice', options: ['default', 'prefer', 'avoid'], help: 'Nudge the planner toward or away from this agent here. Never overrides a capability they do not have.' },
};

/** Shape is the constitution's, not the Console's. Named so the refusal can explain itself. */
export const PROTECTED = ['name', 'id', 'division', 'role', 'owns', 'capabilities', 'tools', 'writes'];

const file = (cwd) => path.join(workspaceDir(cwd), 'tuning.json');

export const readTuning = (cwd = process.cwd()) => {
  const f = file(cwd);
  if (!fs.existsSync(f)) return {};
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return {}; // a corrupt tuning file must never take the organization down with it
  }
};

/**
 * Set or clear one field on one agent.
 *
 * `value === null` clears it — that is the revert, and it removes the key entirely rather
 * than writing the shipped default back, so the agent resumes tracking the registry.
 */
export const setTuning = ({ agent, field, value }, org, cwd = process.cwd()) => {
  if (!org.byName.has(String(agent))) throw new Error(`nobody on the roster is named "${agent}"`);
  if (PROTECTED.includes(field)) {
    throw new Error(`${field} is the organization's shape, not its behaviour — change it in registry/roster.yaml, where doctor can check it`);
  }
  if (!TUNABLE[field]) throw new Error(`"${field}" is not a tunable field`);

  const spec = TUNABLE[field];
  let v = value;
  if (v !== null && v !== undefined) {
    if (spec.kind === 'choice') {
      if (!spec.options.includes(String(v))) throw new Error(`${field} must be one of ${spec.options.join(', ')}`);
      v = String(v);
    } else if (spec.kind === 'lines') {
      v = (Array.isArray(v) ? v : String(v).split('\n')).map((x) => String(x).trim()).filter(Boolean);
      if (v.join('\n').length > 4000) throw new Error('standing instructions are capped at 4000 characters');
      if (!v.length) v = null;
    } else {
      v = String(v).trim();
      if (v.length > 2000) throw new Error(`${field} is capped at 2000 characters`);
      if (!v) v = null;
    }
  }

  const all = readTuning(cwd);
  const entry = { ...(all[agent] || {}) };
  if (v === null || v === undefined) delete entry[field];
  else entry[field] = v;

  // A default routing bias is the absence of one — never store a no-op that later reads
  // as a deliberate choice.
  if (field === 'routingBias' && v === 'default') delete entry.routingBias;

  if (Object.keys(entry).length) all[agent] = entry;
  else delete all[agent];

  fs.mkdirSync(workspaceDir(cwd), { recursive: true });
  fs.writeFileSync(file(cwd), `${JSON.stringify(all, null, 2)}\n`);
  return all[agent] || {};
};

export const clearAgent = (agent, cwd = process.cwd()) => {
  const all = readTuning(cwd);
  delete all[agent];
  fs.mkdirSync(workspaceDir(cwd), { recursive: true });
  fs.writeFileSync(file(cwd), `${JSON.stringify(all, null, 2)}\n`);
};

/**
 * The agent as this workspace sees it: the shipped definition with the Principal's edits
 * laid over it, and `tuned` naming exactly which fields were changed — so the Console can
 * show provenance instead of a silently different agent.
 */
export const effectiveAgent = (agent, cwd = process.cwd()) => {
  const t = readTuning(cwd)[agent.name] || {};
  const merged = { ...agent };
  const tuned = [];
  for (const f of Object.keys(TUNABLE)) {
    if (t[f] === undefined) continue;
    tuned.push(f);
    if (f === 'instructions' || f === 'routingBias') continue; // not registry fields
    merged[f] = t[f];
  }
  return { ...merged, instructions: t.instructions || [], routingBias: t.routingBias || 'default', tuned, shipped: agent };
};

/** Routing weights this workspace has been given. Consumed by the planner, not the UI. */
export const routingBias = (cwd = process.cwd()) => {
  const out = {};
  for (const [name, t] of Object.entries(readTuning(cwd))) {
    if (t.routingBias === 'prefer') out[name] = 1.25;
    if (t.routingBias === 'avoid') out[name] = 0.5;
  }
  return out;
};
