/**
 * Carrying lessons between workspaces — and the gate that stands in front of it.
 *
 * THE GATE IS THE FEATURE HERE, NOT AN OBSTACLE
 *
 * Two identical services in two repos currently run two independent learning curves. Sharing
 * what one learned is genuinely valuable. It is also the single most dangerous thing in this
 * codebase, because `.forge/` is a description of a private workspace: which agents fail at
 * what, the stack, the test command, the standing instructions the Principal approved. That
 * is somebody's working habits.
 *
 * So this file is arranged around one rule: **NOTHING LEAVES THE MACHINE FROM HERE.**
 *
 *   publish   writes a LOCAL file. It never uploads. Moving that file anywhere is a separate,
 *             human act, which is exactly where the egress gate belongs.
 *   learnFrom reads a local path. No URLs.
 *   federate  is the one thing that would fetch, and it REFUSES unless the Principal passes
 *             an explicit approval token — and even then it only ever reads, never sends.
 *
 * And publish REDACTS by default. A published bundle carries capability-level reliability and
 * the lessons; it does not carry raw ledger rows, absolute paths, the workspace name, or the
 * standing instructions, because those are the parts that are about a person rather than
 * about the work.
 */

import fs from 'node:fs';
import path from 'node:path';
import { workspaceDir } from './core.mjs';
import { readLedger, derive } from './ledger.mjs';
import { profileWorkspace, loadOverlay } from './learn.mjs';
import { capabilityLinks } from './growth.mjs';

export const PUBLISHED_VERSION = 1;

/**
 * Build a shareable bundle from this workspace.
 *
 * `includeInstructions` defaults to FALSE. Standing instructions are the most useful thing
 * here and also the most revealing — "never touch the billing module without asking Priya"
 * tells a stranger about your team, not about your code. Opt in per publish, never by default.
 */
export const buildBundle = (cwd = process.cwd(), { workspaceId = null, includeInstructions = false } = {}) => {
  const rows = readLedger(cwd);
  const { memory, capability } = derive(rows);
  const profile = profileWorkspace(cwd);
  const overlay = loadOverlay(cwd);

  // Capability-level only. Per-agent reliability from one workspace is not portable — an
  // agent that fails at "backend" in a Rails shop says nothing about it in a Go shop — and
  // shipping it would import a prejudice rather than a lesson.
  const cost = {};
  for (const [cap, c] of Object.entries(capability)) {
    if (c.n < 3) continue; // below three, a cost figure is one campaign wearing a percentage
    cost[cap] = { costPerTask: c.costPerTask, successRate: c.successes / c.n, observations: c.n };
  }

  const lessons = [];
  for (const a of overlay.adaptations || []) {
    if (a.kind === 'instruction' && !includeInstructions) continue;
    lessons.push({ kind: a.kind, change: a.change, why: a.observation || null });
  }
  for (const l of capabilityLinks(rows).links) {
    lessons.push({ kind: 'capability_link', change: `"${l.from}" failures are often rescued by "${l.to}"`, why: l.why });
  }

  return {
    version: PUBLISHED_VERSION,
    // The id is supplied, never derived from the directory name — a path is a leak.
    workspace_id: workspaceId || 'unnamed',
    published_at: new Date().toISOString(),
    profile: {
      stacks: profile.stacks.value,
      testCommand: profile.testCommand.value,
      indent: profile.indent.value,
      hasTests: profile.hasTests.value,
    },
    cost_profile: cost,
    lessons,
    observations: rows.filter((r) => r.agent && !r.corrupt).length,
    // Stated in the bundle itself so a reader can weigh it without asking. A bundle from 40
    // observations deserves less trust than one from 4000, and hiding that would make every
    // bundle look equally authoritative.
    confidence: rows.length >= 200 ? 'measured' : rows.length >= 50 ? 'indicative' : 'thin',
    principal_approved: false,
    // Deliberately absent: raw ledger rows, per-agent reliability, absolute paths, the
    // workspace name, mailbox contents, and (by default) standing instructions.
  };
};

/** A quick scan for the things that must never be in a bundle. Runs before every write. */
export const leakCheck = (bundle, cwd = process.cwd()) => {
  const text = JSON.stringify(bundle);
  const problems = [];
  const home = process.env.HOME || '';
  if (home && text.includes(home)) problems.push('the bundle contains an absolute home path');
  if (text.includes(path.resolve(cwd))) problems.push('the bundle contains this workspace\'s absolute path');
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) problems.push('the bundle contains something shaped like an email address');
  if (/-----BEGIN|api[_-]?key|secret|password|token["\s:=]/i.test(text)) problems.push('the bundle contains something shaped like a credential');
  return problems;
};

/** Write the bundle to a LOCAL file. This function does not know how to upload anything. */
export const publish = (cwd = process.cwd(), opts = {}) => {
  const bundle = buildBundle(cwd, opts);
  const problems = leakCheck(bundle, cwd);
  if (problems.length) throw new Error(`refusing to write a bundle:\n  - ${problems.join('\n  - ')}`);
  const out = opts.out || path.join(workspaceDir(cwd), 'published.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`);
  return { path: out, bundle, problems };
};

/**
 * Read a bundle from another workspace and turn it into PROPOSALS.
 *
 * It applies nothing, and that is not caution for its own sake — a lesson from elsewhere is
 * the weakest evidence this system handles. It was true somewhere else, about a codebase this
 * one has never seen. So it arrives as a proposal graded INFERENCE, goes through
 * `forge evolve` like everything else, and the Principal decides.
 *
 * MEMORY IS NEVER IMPORTED. A new workspace starts with an empty ledger by design: reliability
 * has to be earned here. Importing it would mean the router trusted an agent on the strength
 * of work it did in a different repo, which is precisely the assumption RULE 007 forbids.
 */
export const learnFrom = (bundlePath, { cwd = process.cwd() } = {}) => {
  if (/^https?:/i.test(String(bundlePath))) {
    throw new Error('learn-from reads a local path only. Fetching a URL is egress — see `forge federate`, which requires explicit approval.');
  }
  let bundle;
  try {
    bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read a bundle at ${bundlePath}: ${e.message}`);
  }
  if (bundle.version !== PUBLISHED_VERSION) {
    throw new Error(`bundle is version ${bundle.version}, this build reads version ${PUBLISHED_VERSION}`);
  }

  const proposals = [];
  const from = bundle.workspace_id || 'another workspace';
  const grade = bundle.confidence === 'measured' ? 'INFERENCE' : 'UNKNOWN';

  if (bundle.profile && bundle.profile.testCommand) {
    proposals.push({
      kind: 'profile', target: '.forge/overlay.yaml',
      change: `consider "${bundle.profile.testCommand}" as the verification command`,
      observation: `${from} uses it, over ${bundle.observations} observation(s)`,
      grade, body: [], reversible: true, imported: from,
    });
  }
  for (const l of bundle.lessons || []) {
    proposals.push({
      kind: l.kind === 'capability_link' ? 'routing' : l.kind, target: '.forge/overlay.yaml',
      change: l.change,
      observation: `imported from ${from}${l.why ? `: ${l.why}` : ''}`,
      grade, body: [], reversible: true, imported: from,
    });
  }
  return {
    from,
    confidence: bundle.confidence,
    proposals,
    // Said plainly, because an import that looks like a measurement is the failure mode.
    note: `nothing was applied, and no reliability was imported — ${from}'s measurements are about ${from}'s codebase.`,
  };
};

/**
 * Fetching a bundle from a registry. THE ONE FUNCTION HERE THAT CROSSES A GATE.
 *
 * It refuses unless the caller passes `approve: true`, which the CLI only sets from an
 * explicit `--i-approve-egress` flag typed by the Principal. Even approved, it only ever
 * GETs — it never sends this workspace's data anywhere, so the worst case is importing
 * someone else's opinion, not exporting your own.
 *
 * I argued against building this at all and was overruled, which is recorded here rather than
 * only in a chat log: with 126 ledger rows there is nothing worth federating yet, and the
 * gate is what keeps that from mattering.
 */
export const federate = async (url, { approve = false, fetchImpl = null } = {}) => {
  if (!approve) {
    throw new Error(
      'REFUSED: fetching a remote registry is egress, which is one of the seven gates.\n' +
      '  Nothing was sent and nothing was fetched.\n' +
      '  Re-run with --i-approve-egress if you intend to reach that host.',
    );
  }
  if (!/^https:/i.test(String(url))) throw new Error('federate requires an https URL — plaintext would publish the request itself');
  const f = fetchImpl || globalThis.fetch;
  if (typeof f !== 'function') throw new Error('no fetch available in this runtime');
  const res = await f(url, { method: 'GET' });
  if (!res.ok) throw new Error(`registry returned ${res.status}`);
  const bundle = await res.json();
  if (bundle.version !== PUBLISHED_VERSION) throw new Error(`registry bundle is version ${bundle.version}, this build reads ${PUBLISHED_VERSION}`);
  return bundle;
};
