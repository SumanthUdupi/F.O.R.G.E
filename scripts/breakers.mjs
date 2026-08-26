/**
 * Circuit breakers and the checkable principles — the numbers, given a code path.
 *
 * WHAT WAS WRONG
 *
 * `charter/constitution.yaml` declares five circuit breakers (rounds, tasks per campaign,
 * parallel width, consecutive failures, repeated objection) and ten principles. Exactly one
 * of those numbers was ever read by running code: `parallel_width`, in vector.mjs. The other
 * four were rendered into a markdown table in CHARTER.md and never consulted again, and six
 * of the ten principles are not mechanically checkable at all while the document implied all
 * ten were enforced uniformly.
 *
 * A limit nothing evaluates is a comment with a serial number — the same criticism this repo
 * levels at rules with no doctor check. This file is the answer: every breaker is a pure
 * predicate over campaign state, every predicate is exported under the name the constitution
 * uses, and `principles_declare_enforcement` (doctor) fails if the constitution names a
 * predicate that does not exist here.
 *
 * PURE FUNCTIONS, NO I/O, NO CLOCK. Same input, same verdict — so a breaker can be tested,
 * and so replaying a ledger reaches the same conclusions it reached live.
 *
 * Every breaker returns the same shape:
 *   { tripped: boolean, limit: number, observed: number, breaker: string, action: string }
 * `action` is always STOP -> REPORT -> ESCALATE, spelled out, because Article 76's whole
 * point is that exceeding a limit is never allowed to mean "continue quietly".
 */

const ACTION = 'STOP -> REPORT -> ESCALATE to the Principal. Never continue quietly.';

const verdict = (breaker, observed, limit) => ({
  breaker,
  observed,
  limit,
  tripped: observed > limit,
  action: ACTION,
});

/**
 * The five breakers, keyed by their constitution name so a caller can do
 * `BREAKERS[name](state, constitution.circuit_breakers[name])` without a lookup table.
 *
 * `state` is a plain object a campaign accumulates. Every field is optional and defaults to
 * the harmless value, because a breaker that throws on incomplete state is a breaker nobody
 * calls.
 */
export const BREAKERS = {
  /** Article 76 — a request that has been re-planned this many times is not converging. */
  rounds: (state = {}, limit = 3) => verdict('rounds', Number(state.rounds || 0), limit),

  /** A campaign wider than this stopped being a campaign and became a project. */
  tasks_per_campaign: (state = {}, limit = 24) =>
    verdict('tasks_per_campaign', Array.isArray(state.tasks) ? state.tasks.length : Number(state.tasks || 0), limit),

  /** The only breaker that already had a code path (vector.mjs); it lives here too so all five are testable together. */
  parallel_width: (state = {}, limit = 6) =>
    verdict('parallel_width', Array.isArray(state.batch) ? state.batch.length : Number(state.width || 0), limit),

  /**
   * Consecutive failures BY ONE AGENT AT ONE CAPABILITY — not failures in general.
   * `derive()` already tracks exactly this as `byClass[cap].consecutiveFailures`, so the
   * breaker reads the memory the ledger produced rather than keeping a second tally that
   * could disagree with it.
   */
  consecutive_failures: (state = {}, limit = 2) =>
    verdict('consecutive_failures', Number(state.consecutiveFailures || 0), limit),

  /** The same seat objecting to the same thing this many times is a deadlock wearing a process costume. */
  repeated_objection: (state = {}, limit = 2) =>
    verdict('repeated_objection', Number(state.objections || 0), limit),
};

/** Evaluate every breaker against one campaign state. Returns only the ones that tripped. */
export const trippedBreakers = (state = {}, limits = {}) =>
  Object.entries(BREAKERS)
    .map(([name, fn]) => fn(state, limits[name]))
    .filter((v) => v.tripped);

/** Convenience for the common single question, kept because callers read better with it. */
export const exceedsRounds = (state = {}, limit = 3) => BREAKERS.rounds(state, limit).tripped;

// ------------------------------------------------------------- the checkable principles
//
// Three of the ten principles are decidable from campaign state. The other six are design
// philosophy and are marked `aspirational` in the constitution rather than pretended into
// enforcement. Each predicate returns { held, why } — `held: null` means "not decidable
// from what was recorded", which is honestly different from `false`.

/** P3 — Reuse before build. Writing without having searched the Archives is rediscovery at full price. */
export const reuseBeforeBuild = (campaign = {}) => {
  const wrote = Boolean(campaign.wrote);
  if (!wrote) return { held: true, why: 'campaign wrote nothing; there was nothing to rediscover' };
  if (campaign.searchedArchives === undefined) {
    return { held: null, why: 'campaign wrote, and did not record whether the Archives were searched' };
  }
  return campaign.searchedArchives
    ? { held: true, why: 'Archives searched before the first write' }
    : { held: false, why: 'campaign wrote without searching the Archives — P3' };
};

/** P6 — Dissent is preserved. A deadlock whose record carries no minority position destroyed the information it existed to keep. */
export const dissentPreserved = (campaign = {}) => {
  const decisions = campaign.decisions || [];
  const contested = decisions.filter((d) => d && d.contested);
  if (!contested.length) return { held: true, why: 'no contested decision in this campaign' };
  const silent = contested.filter((d) => !d.minority || !String(d.minority).trim());
  return silent.length
    ? { held: false, why: `${silent.length} contested decision(s) recorded with no minority position — P6` }
    : { held: true, why: `${contested.length} contested decision(s), each carrying the position that lost` };
};

/** P10 — The organization learns or it repeats. Either the ledger gained a row, or the campaign said why not. */
export const campaignLeftARecord = (campaign = {}) => {
  const observations = Number(campaign.observations || 0);
  if (observations > 0) return { held: true, why: `${observations} observation(s) reached the ledger` };
  return campaign.whyNoRecord
    ? { held: true, why: `no observation, and the reason is stated: ${campaign.whyNoRecord}` }
    : { held: false, why: 'campaign closed with no ledger observation and no stated reason — P10' };
};

/** Every principle predicate, under the exact name the constitution's `enforcement:` field uses. */
export const PRINCIPLE_CHECKS = { reuseBeforeBuild, dissentPreserved, campaignLeftARecord };
