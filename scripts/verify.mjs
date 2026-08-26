/**
 * Spot-checking evidence claims — the difference between an audit trail and a diary.
 *
 * WHAT WAS WRONG, AND WHY IT WAS THE WORST OF THE GAPS
 *
 * RULE-007 says every claim carries EVIDENCE, INFERENCE or UNKNOWN, and its named check
 * (`evidence_grades_declared`) verifies that the three grades are declared and that the field
 * is required. That is a check on the SCHEMA, not on the CLAIM. An agent could write
 * `EVIDENCE_GRADE: EVIDENCE` about a test it never ran and pass every check this repo has.
 * The grading system was self-reported and unfalsifiable, which makes it a diary with a
 * schema — and the whole organization's routing, reliability and learning sit on top of it.
 *
 * WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT
 *
 * Not every EVIDENCE claim is re-checkable. "I read the file and it says X" is only
 * re-checkable by re-reading the file, and a verifier that guessed at those would produce
 * confident nonsense — the exact failure it exists to catch. So the verdict space has three
 * values and `unverifiable` is a first-class one:
 *
 *   confirmed     the artifact exists / the command still exits the way the claim said
 *   contradicted  the artifact is missing, or the line does not exist, or the command disagrees
 *   unverifiable  nothing mechanical could decide it — NOT a mark against the agent
 *
 * Punishing an agent for an honestly unautomatable claim would teach it to stop making
 * checkable ones, which is precisely backwards.
 *
 * COMMANDS ARE OPT-IN. Re-running a workspace's verification command is the strongest
 * evidence available and also arbitrary code execution, so it never happens unless the
 * caller passes a runner explicitly. The default verifier touches the filesystem and nothing
 * else.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readLedger, observe } from './ledger.mjs';

export const VERDICTS = ['confirmed', 'contradicted', 'unverifiable'];

/**
 * Parse an artifact reference into something checkable.
 * Accepts `src/api/users.ts:42`, `src/api/users.ts:42 (new endpoint)`, or a bare path.
 */
export const parseArtifact = (ref) => {
  const text = String(ref || '').trim();
  if (!text) return null;
  // Strip a trailing parenthetical note before parsing — it is prose, not part of the path.
  const bare = text.replace(/\s*\(.*\)\s*$/, '').trim();
  const m = bare.match(/^(.*?):(\d+)$/);
  if (m) return { file: m[1], line: Number(m[2]), raw: text };
  return { file: bare, line: null, raw: text };
};

/** Does this artifact still exist where the claim said it did? */
export const checkArtifact = (ref, cwd = process.cwd()) => {
  const a = parseArtifact(ref);
  if (!a) return { verdict: 'unverifiable', why: 'empty artifact reference', ref };

  // "none" is an explicitly valid and common answer to ARTIFACTS. It is not a failed claim.
  if (/^(none|n\/a|-)$/i.test(a.file)) return { verdict: 'unverifiable', why: 'artifact is "none"', ref };

  // A reference that escapes the workspace is refused rather than followed. The verifier
  // reads whatever it is pointed at, so it must never be pointable at the whole disk.
  const abs = path.resolve(cwd, a.file);
  const root = path.resolve(cwd);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    return { verdict: 'unverifiable', why: 'artifact points outside the workspace', ref };
  }

  if (!fs.existsSync(abs)) return { verdict: 'contradicted', why: `${a.file} does not exist`, ref };
  if (a.line === null) return { verdict: 'confirmed', why: `${a.file} exists`, ref };

  let lines;
  try {
    lines = fs.readFileSync(abs, 'utf8').split('\n');
  } catch {
    return { verdict: 'unverifiable', why: `${a.file} exists but could not be read`, ref };
  }
  if (a.line > lines.length) {
    return { verdict: 'contradicted', why: `${a.file} has ${lines.length} lines; the claim names line ${a.line}`, ref };
  }
  return { verdict: 'confirmed', why: `${a.file}:${a.line} exists`, ref };
};

/**
 * Spot-check one ledger row.
 *
 * Only rows claiming EVIDENCE are checked. A row graded INFERENCE or UNKNOWN is already
 * telling the truth about its own confidence, and there is nothing to catch.
 */
export const spotCheck = (row, { cwd = process.cwd(), run = null } = {}) => {
  const base = { at: row.at, agent: row.agent, capability: row.capability, campaign: row.campaign || null };

  if (row.kind === 'spotcheck') return { ...base, verdict: 'unverifiable', why: 'row is itself a spot-check' };
  if (row.grade !== 'EVIDENCE') {
    return { ...base, verdict: 'unverifiable', why: `graded ${row.grade || 'nothing'}; only EVIDENCE is spot-checkable` };
  }

  const checks = [];
  for (const ref of row.artifacts || []) checks.push(checkArtifact(ref, cwd));

  // A verification claim ("tests pass") is only checkable when the caller supplied a runner
  // AND the workspace has a known command. Both conditions, deliberately.
  const claimsVerification = /\btests?\b.*\b(pass|green|succeed)/i.test(`${row.note || ''} ${row.raw_output || ''}`);
  if (claimsVerification) {
    if (typeof run === 'function') {
      const res = run();
      checks.push(
        res.code === 0
          ? { verdict: 'confirmed', why: `verification command exited 0`, ref: res.command }
          : { verdict: 'contradicted', why: `claim says tests pass; the command exited ${res.code}`, ref: res.command },
      );
    } else {
      checks.push({ verdict: 'unverifiable', why: 'claims tests pass; no runner was supplied', ref: null });
    }
  }

  if (!checks.length) {
    return { ...base, verdict: 'unverifiable', why: 'EVIDENCE claim with no artifact and no verification claim', checks };
  }
  // One contradiction is enough. A claim that is half true is not true.
  if (checks.some((c) => c.verdict === 'contradicted')) {
    return { ...base, verdict: 'contradicted', why: checks.filter((c) => c.verdict === 'contradicted').map((c) => c.why).join('; '), checks };
  }
  if (checks.some((c) => c.verdict === 'confirmed')) {
    return { ...base, verdict: 'confirmed', why: checks.filter((c) => c.verdict === 'confirmed').map((c) => c.why).join('; '), checks };
  }
  return { ...base, verdict: 'unverifiable', why: checks.map((c) => c.why).join('; '), checks };
};

/** Spot-check every row in one campaign (or the whole ledger when campaign is null). */
export const spotCheckCampaign = (campaign, { cwd = process.cwd(), run = null, rows = null } = {}) => {
  const all = rows || readLedger(cwd);
  const scope = campaign ? all.filter((r) => r.campaign === campaign) : all;
  const results = scope.filter((r) => !r.corrupt && r.agent).map((r) => spotCheck(r, { cwd, run }));
  const tally = { confirmed: 0, contradicted: 0, unverifiable: 0 };
  for (const r of results) tally[r.verdict] += 1;
  return { campaign, results, tally, checked: results.length };
};

/**
 * Write the verdicts back as spotcheck rows.
 *
 * Append-only, like everything else — a spot-check does not edit the row it judged, it adds
 * a row about it. `derive()` counts these into `evidence.accuracy` and pointedly NOT into
 * reliability, so being audited is never mistaken for doing work.
 *
 * `unverifiable` is not recorded. Storing "nothing could be decided" as a row would drag
 * every agent's accuracy toward the prior for reasons that say nothing about the agent.
 */
export const recordSpotChecks = (report, cwd = process.cwd()) => {
  let written = 0;
  for (const r of report.results) {
    if (r.verdict === 'unverifiable') continue;
    observe(
      {
        agent: r.agent,
        capability: r.capability,
        outcome: r.verdict === 'confirmed' ? 'ok' : 'fail',
        campaign: r.campaign,
        kind: 'spotcheck',
        note: r.why,
      },
      cwd,
    );
    written += 1;
  }
  return written;
};

/** Did this campaign close with unresolved contradictions? Used by the doctor check. */
export const unresolvedMismatches = (cwd = process.cwd()) => {
  const rows = readLedger(cwd).filter((r) => r.kind === 'spotcheck' && r.outcome === 'fail');
  return rows.map((r) => ({ agent: r.agent, campaign: r.campaign, why: r.note, at: r.at }));
};
