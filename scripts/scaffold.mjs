/**
 * Scaffolding a new specialist.
 *
 * WHAT THIS IS ACTUALLY FOR
 *
 * Not keystrokes. `docs/EXTENDING.md` already documents the manual loop, and it works. What
 * it cannot do is stop you skipping a step, and there are exactly three steps people skip:
 *
 *   1. the routing rule — the agent exists and no request phrasing ever reaches it. doctor
 *      warns about this, and a warning in a wall of PASS lines is easy to read past.
 *   2. the overlap check — a new specialist whose `owns` restates an existing one's is a
 *      RULE 004 violation, and it is much cheaper to catch before the entry is written than
 *      after five campaigns have routed to the wrong one of the pair.
 *   3. running doctor at all.
 *
 * So this refuses on overlap, prints the routing stub as part of its output rather than as a
 * suggestion, and validates every constitutional requirement before it will write anything.
 *
 * IT APPENDS TO roster.yaml AND NOTHING ELSE. Not to agents/ — those are build output, and
 * an agent file written by hand is overwritten by the next build with no warning. That is the
 * single most common way people lose work in this repo, which is why the scaffolder cannot
 * do it even if asked.
 */

import fs from 'node:fs';
import { load, paths } from './core.mjs';

/** Same normalisation doctor uses for RULE 004, so the two cannot disagree about overlap. */
const ownsKey = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !['that', 'this', 'with', 'from', 'they', 'them', 'what', 'when', 'which', 'been', 'were', 'have', 'does', 'than', 'into', 'every', 'their'].includes(w))
    .sort()
    .join(' ');

const jaccard = (a, b) => {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const x of A) if (B.has(x)) hit += 1;
  return hit / (A.size + B.size - hit);
};

const nextId = (org, division) => {
  const prefix = `AGT-${division.replace(/^DIV-/, '')}-`;
  const used = org.all
    .filter((a) => a.id.startsWith(prefix))
    .map((a) => Number(String(a.id).slice(prefix.length)))
    .filter((n) => Number.isFinite(n));
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
};

export const scaffoldAgent = (spec) => {
  const org = load();
  const problems = [];

  const required = ['division', 'name', 'owns', 'specialization', 'stance', 'refuses'];
  for (const k of required) {
    if (!spec[k] || spec[k] === true) problems.push(`--${k} is required`);
  }
  if (!spec.capabilities || !spec.capabilities.length) problems.push('--capabilities is required — it is the routing key, and without it nothing can reach the agent');
  if (problems.length) throw new Error(`cannot scaffold:\n  - ${problems.join('\n  - ')}`);

  const division = String(spec.division);
  if (!org.constitution.divisions.some((d) => d.id === division)) {
    throw new Error(`unknown division ${division}. One of: ${org.constitution.divisions.map((d) => d.id).join(', ')}`);
  }
  if (org.byName.has(String(spec.name))) throw new Error(`an agent named ${spec.name} already exists`);
  if (!org.roster.meta.tiers[spec.model]) {
    throw new Error(`unknown model tier "${spec.model}". One of: ${Object.keys(org.roster.meta.tiers).join(', ')}`);
  }

  // RULE 003 — a division holds 3-10 specialists. Refusing here is much kinder than letting
  // doctor fail after the entry is written and the Principal has to work out which to remove.
  const members = (org.byDivision.get(division) || []).filter((a) => a.role === 'specialist');
  if (members.length >= 10) {
    throw new Error(`${division} already holds ${members.length} specialists; RULE 003 caps a division at 10. Split the division's work or retire one first.`);
  }

  // RULE 004 — distinct ownership. The threshold matches doctor's.
  const key = ownsKey(spec.owns);
  const clashes = org.all
    .map((a) => ({ a, sim: jaccard(key, ownsKey(a.owns)) }))
    .filter((x) => x.sim > 0.6)
    .sort((x, y) => y.sim - x.sim);
  if (clashes.length) {
    const c = clashes[0];
    throw new Error(
      `"${spec.owns}"\noverlaps ${c.a.name} (${Math.round(c.sim * 100)}%), which owns:\n"${c.a.owns}"\n\n` +
        `Two agents with the same ownership is RULE 004, and routing between them is a coin flip. ` +
        `Either narrow this one's ownership, or extend ${c.a.name} instead of adding a second.`,
    );
  }

  const id = nextId(org, division);
  const yaml = [
    `  - id: ${id}`,
    `    name: ${spec.name}`,
    `    division: ${division}`,
    `    role: specialist`,
    `    specialization: ${spec.specialization}`,
    `    owns: ${spec.owns}`,
    `    model: ${spec.model}`,
    `    writes: ${spec.writes ? 'true' : 'false'}`,
    `    tools: [Read, Grep, Glob, Bash${spec.writes ? ', Edit, Write' : ''}]`,
    `    capabilities: [${spec.capabilities.join(', ')}]`,
    `    stance: ${spec.stance}`,
    `    refuses: ${spec.refuses}`,
    '',
  ].join('\n');

  // The capabilities nothing currently routes to. This is step 2, the one people skip.
  const asked = new Set(org.routing.rules.flatMap((r) => r.capabilities || []));
  const governance = new Set(org.routing.governance_capabilities || []);
  const unreachable = spec.capabilities.filter((c) => !asked.has(c) && !governance.has(c));

  const report = [];
  report.push('');
  report.push(`  ${id}  ${spec.name}  →  ${division}`);
  report.push('');
  report.push('  registry/roster.yaml — this block:');
  report.push('');
  report.push(yaml.replace(/^/gm, '  '));
  if (unreachable.length) {
    report.push(`  registry/routing.yaml — REQUIRED, or ${spec.name} is unreachable by any plan:`);
    report.push('');
    report.push(`    - id: R-${spec.capabilities[0].toUpperCase().replace(/[^A-Z0-9]/g, '-')}`);
    report.push(`      when_any: [${unreachable.join(', ')}]   # the words a request would actually use`);
    report.push(`      capabilities: [${unreachable.join(', ')}]`);
    report.push('      phase: verify');
    report.push('      why: <one sentence — doctor does not check this, readers do>');
    report.push('');
    report.push(`  Without it doctor warns "capability supplied but never asked for". Treat that as a hard stop.`);
    report.push('');
  }
  report.push('  Then: forge doctor && forge build --apply && node --test tests/');
  report.push('');

  let applied = false;
  if (spec.apply) {
    const body = fs.readFileSync(paths.roster, 'utf8');
    // Append at the end of the roster's agent list. Placing it inside the right division's
    // block would be prettier and would mean parsing and rewriting YAML this repo's own
    // reader does not round-trip — a lossy rewrite of the roster is not worth tidy ordering.
    fs.writeFileSync(paths.roster, `${body.replace(/\s*$/, '')}\n\n${yaml}`);
    applied = true;
    report.push(`  appended to registry/roster.yaml. Run doctor before building.`);
    report.push('');
  }

  return { id, yaml, unreachable, report: report.join('\n'), applied };
};
