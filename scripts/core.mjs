/**
 * Loading and cross-referencing. Every other script starts here.
 *
 * The one job that matters in this file is `load()`: it refuses to hand back an
 * organization whose references do not resolve. A manager pointing at a division that does
 * not exist, a rule naming a check nobody wrote, a routing rule asking for a capability no
 * agent has -- each of those is a file that parses cleanly and describes an organization
 * that cannot run. Catching them at load time means every downstream command can assume
 * the graph is whole.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse } from './yaml.mjs';

// fileURLToPath, not `new URL(...).pathname` -- the latter yields "/D:/a/repo" on Windows
// and every path built from it silently misses.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const paths = {
  constitution: path.join(ROOT, 'charter', 'constitution.yaml'),
  roster: path.join(ROOT, 'registry', 'roster.yaml'),
  routing: path.join(ROOT, 'registry', 'routing.yaml'),
  contracts: path.join(ROOT, 'registry', 'contracts.yaml'),
  agents: path.join(ROOT, 'agents'),
  skill: path.join(ROOT, 'skills', 'forge'),
};

/** Where the organization keeps what it has learned about ONE workspace. */
export const workspaceDir = (cwd = process.cwd()) => path.join(cwd, '.forge');

/**
 * The workspace registry — every place the organization has convened.
 *
 * Lives in the home directory, not in any one workspace, because its whole job is to let
 * the Console list SESSIONS across workspaces. Written by the CLI, never by the evolution
 * layer; it is a bookmark file, not learned state, and it is also the allowlist the deck
 * checks a ?ws= parameter against — an unregistered path is refused, so the HTTP surface
 * can never be talked into reading an arbitrary directory.
 */
const registryPath = () => path.join(os.homedir(), '.claude', 'forge-workspaces.json');

export const registerWorkspace = (cwd = process.cwd()) => {
  try {
    // A test boots a deck in a mkdtemp directory and the Sessions view fills with
    // /var/folders garbage that outlives the test by exactly one glance. Disposable
    // locations are not places the organization has worked; they are places it was
    // exercised — the same distinction the hook installer already enforces.
    const abs0 = path.resolve(cwd);
    // Portable disposability check: anything under the OS temp root, on any platform.
    // The first version pattern-matched /tmp and /var/folders, which is Unix-shaped —
    // Windows temp lives in AppData\Local\Temp and sailed straight through in CI.
    const tmpRoot = path.resolve(os.tmpdir());
    if (abs0 === tmpRoot || abs0.startsWith(tmpRoot + path.sep)) return;
    if (/^(\/private)?\/tmp\//.test(abs0) || abs0.includes('/var/folders/')) return;
    const p = registryPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const list = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
    const abs = path.resolve(cwd);
    const rest = list.filter((w) => w.path !== abs);
    rest.unshift({ path: abs, lastSeen: new Date().toISOString() });
    fs.writeFileSync(p, `${JSON.stringify(rest.slice(0, 20), null, 2)}\n`);
  } catch {
    /* a broken bookmark file must never break the command that tried to write it */
  }
};

export const listWorkspaces = () => {
  try {
    return JSON.parse(fs.readFileSync(registryPath(), 'utf8')).filter((w) => fs.existsSync(w.path));
  } catch {
    return [];
  }
};

const readYaml = (p) => parse(fs.readFileSync(p, 'utf8'));

/** Every doctor check named in the constitution must exist here. Named, so RULE -> code is greppable. */
export const CHECK_NAMES = [
  'divisions_are_immutable',
  'one_manager_per_division',
  'specialist_band',
  'specialists_are_distinct',
  'managers_route_not_perform',
  'gated_actions_require_principal',
  'evidence_grades_declared',
  'protocol_carries_questions',
  'audit_fields_present',
  'retirement_requires_extraction',
  'board_partition_is_exact',
  'chair_does_not_override',
];

/**
 * Resolve one agent's output contract: base + role + every capability family it joins.
 *
 * Composed rather than authored, so all 64 agents get one. The specification this was built
 * from hand-wrote a contract for its six executives and left every specialist without --
 * which is exactly inverted, since the specialists emit most of the messages and are the
 * ones whose output has to be checkable.
 */
export const resolveContract = (agent, contracts) => {
  const fields = [...contracts.base.fields];
  const optional = [...(contracts.base.when_applicable || [])];
  const rules = [...(contracts.base.rules || [])];
  const families = [];

  const role = contracts.by_role[agent.role];
  if (role) {
    fields.push(...(role.fields || []));
    rules.push(...(role.rules || []));
  }
  for (const fam of contracts.by_family) {
    if (!(agent.capabilities || []).some((c) => fam.capabilities.includes(c))) continue;
    families.push(fam.name);
    fields.push(...(fam.fields || []));
    rules.push(...(fam.rules || []));
  }

  // Two families can ask for the same field. Keep the first definition and drop the repeat,
  // rather than printing the key twice and letting the agent choose which to answer.
  const seen = new Set();
  const dedup = fields.filter((f) => (seen.has(f.key) ? false : seen.add(f.key)));
  return { fields: dedup, optional, rules: [...new Set(rules)], families };
};

/**
 * Load the whole organization and cross-reference it.
 * Throws on any dangling reference. Returns a frozen object.
 */
export const load = () => {
  const constitution = readYaml(paths.constitution);
  const roster = readYaml(paths.roster);
  const routing = readYaml(paths.routing);
  const contracts = readYaml(paths.contracts);

  const all = [...roster.board, ...roster.agents];
  const divisionIds = new Set(constitution.divisions.map((d) => d.id));
  const problems = [];

  const seenId = new Set();
  const seenName = new Set();
  for (const a of all) {
    if (seenId.has(a.id)) problems.push(`duplicate agent id ${a.id}`);
    if (seenName.has(a.name)) problems.push(`duplicate agent name ${a.name}`);
    seenId.add(a.id);
    seenName.add(a.name);
    if (!divisionIds.has(a.division)) problems.push(`${a.id} sits in unknown division ${a.division}`);
    if (!a.owns) problems.push(`${a.id} declares no owns — RULE 004 has nothing to compare`);
    if (!roster.meta.tiers[a.model]) problems.push(`${a.id} asks for unknown model tier ${a.model}`);
    // A stance with no refusal is decoration. The whole point of giving an agent a
    // character is that the character makes it decline something.
    if (a.stance && !a.refuses) problems.push(`${a.id} declares a stance and refuses nothing`);
    if (!a.stance) problems.push(`${a.id} has no stance`);
  }

  // RULE 011, checked at load so nothing downstream can assume a partition that is not one.
  const seatIds = new Set(roster.board.map((b) => b.id));
  const owned = new Map();
  for (const pf of constitution.board.portfolios) {
    if (!seatIds.has(pf.seat)) problems.push(`portfolio names unknown seat ${pf.seat}`);
    for (const d of pf.owns) {
      if (!divisionIds.has(d)) problems.push(`seat ${pf.seat} owns unknown division ${d}`);
      if (owned.has(d)) problems.push(`${d} is owned by both ${owned.get(d)} and ${pf.seat}`);
      owned.set(d, pf.seat);
    }
  }
  for (const d of divisionIds) if (!owned.has(d)) problems.push(`${d} has no owning board seat`);

  for (const r of constitution.rules) {
    if (!CHECK_NAMES.includes(r.check)) {
      problems.push(`${r.id} names check "${r.check}", which no code implements`);
    }
  }

  // A capability a rule can ask for but no agent supplies is a stage that plans and then
  // cannot be staffed. Better to fail here than at dispatch.
  const supplied = new Set(all.flatMap((a) => a.capabilities || []));
  for (const r of routing.rules) {
    for (const c of r.capabilities || []) {
      if (!supplied.has(c)) problems.push(`routing rule ${r.id} needs capability "${c}", which no agent has`);
    }
  }

  // Article: conflicts are symmetric or they are a trap.
  for (const c of routing.conflicts || []) {
    if (!Array.isArray(c.between) || c.between.length !== 2) {
      problems.push(`conflict entry must name exactly two rules: ${JSON.stringify(c.between)}`);
    }
  }

  if (problems.length) {
    const e = new Error(`the organization does not cross-reference:\n  - ${problems.join('\n  - ')}`);
    e.problems = problems;
    throw e;
  }

  const byId = new Map(all.map((a) => [a.id, a]));
  const byName = new Map(all.map((a) => [a.name, a]));
  const byDivision = new Map(constitution.divisions.map((d) => [d.id, all.filter((a) => a.division === d.id)]));

  const seatOf = new Map([...owned].map(([d, seat]) => [d, seat]));
  return Object.freeze({ constitution, roster, routing, contracts, all, byId, byName, byDivision, seatOf });
};

/** Small formatting helpers shared by every command that prints to a terminal. */
export const ui = {
  pass: (s) => `  PASS  ${s}`,
  warn: (s) => `  WARN  ${s}`,
  fail: (s) => `  FAIL  ${s}`,
  rule: (t = '') => (t ? `\n── ${t} ${'─'.repeat(Math.max(0, 68 - t.length))}` : '─'.repeat(72)),
  head: (t) => `\n${t}\n${'═'.repeat(t.length)}`,
};

export { fs, path };
