/**
 * Learning that needs history — apprenticeship, capability correlation, campaign templates.
 *
 * A HONEST WARNING, AND IT IS NOT BOILERPLATE
 *
 * Everything in this file infers from the ledger, and the ledger this was written against
 * held 126 rows. None of these functions has ever produced a finding from real data, because
 * there is not enough real data for one to be trustworthy. They were built because the
 * Principal asked for them after being told exactly this.
 *
 * So every function here refuses to speak below a threshold, and the thresholds are
 * deliberately high enough to be annoying. `mentorships` needs 8 observations before it will
 * pair anyone; `capabilityLinks` needs 3 co-occurrences AND a 2:1 ratio; `templates` needs 3
 * runs of the same shape. Below those they return an empty list with a `why`, and the `why`
 * says "not enough data" rather than nothing — an empty result that looks like "no findings"
 * is how a system with no evidence starts sounding confident.
 *
 * The failure mode this guards against is specific: with 5 observations, ANY correlation
 * looks strong. A system that reported it would teach the router superstition, and the router
 * has no way to un-learn.
 */

import { derive } from './ledger.mjs';

/** Below this many observations for an agent, nothing here will say anything about it. */
export const MIN_OBSERVATIONS = 8;

/**
 * Who should learn from whom.
 *
 * A capability with one strong holder and one weak-or-unmeasured holder is a pairing: the
 * router should keep preferring the strong one while letting the other take a small share, so
 * it accumulates evidence instead of never being selected and therefore never improving.
 *
 * That last part is the real problem being solved. Reliability starts at a neutral prior, a
 * stronger incumbent out-scores a newcomer, and the newcomer never gets an observation — so
 * its score never moves and it is effectively retired on arrival. An apprentice share breaks
 * that loop deliberately.
 *
 * `share` is capped low (10%) because this is spending real campaign quality on training.
 */
export const mentorships = (org, rows, { minObservations = MIN_OBSERVATIONS, share = 0.1 } = {}) => {
  const { memory } = derive(rows);
  const out = [];
  const skipped = [];

  for (const [cap, holders] of org.byCapability || new Map()) {
    const measured = holders
      .map((a) => ({ agent: a, m: memory[a.name] }))
      .filter((x) => x.m && x.m.byClass && x.m.byClass[cap]);
    if (!measured.length) continue;

    const best = measured.sort((a, b) => b.m.byClass[cap].rate - a.m.byClass[cap].rate)[0];
    if (best.m.byClass[cap].n < minObservations) {
      skipped.push({ capability: cap, why: `strongest holder has ${best.m.byClass[cap].n} observations, needs ${minObservations}` });
      continue;
    }

    // Anyone who holds the capability and is either unmeasured or materially worse.
    for (const a of holders) {
      if (a.name === best.agent.name) continue;
      const m = memory[a.name];
      const rate = m && m.byClass && m.byClass[cap] ? m.byClass[cap].rate : null;
      if (rate !== null && rate >= best.m.byClass[cap].rate - 0.1) continue; // already comparable
      out.push({
        capability: cap,
        mentor: best.agent.name,
        mentorRate: best.m.byClass[cap].rate,
        mentorN: best.m.byClass[cap].n,
        apprentice: a.name,
        apprenticeRate: rate,
        apprenticeN: m && m.byClass && m.byClass[cap] ? m.byClass[cap].n : 0,
        share,
        why: rate === null
          ? `${a.name} has never been selected for "${cap}" and so can never improve at it`
          : `${a.name} sits at ${rate} against ${best.agent.name}'s ${best.m.byClass[cap].rate}`,
      });
    }
  }
  return { pairs: out, skipped, enoughData: out.length > 0 };
};

/**
 * Which capabilities rescue which.
 *
 * When A fails at a task and B succeeds at the same campaign shortly after, that is weak
 * evidence the work belonged to B's capability. Weak is the operative word — it is also
 * exactly what a normal campaign looks like when a reviewer follows a builder, and reading
 * that as "review rescues build" would be nonsense.
 *
 * So the bar is two-sided: at least `minCases` co-occurrences AND the pattern must be at
 * least twice as common as the reverse. A link that holds in both directions is a sequence,
 * not a rescue.
 */
export const capabilityLinks = (rows, { minCases = 3, ratio = 2 } = {}) => {
  const byCampaign = {};
  for (const r of rows) {
    if (!r.campaign || r.corrupt || !r.agent || r.kind === 'spotcheck') continue;
    (byCampaign[r.campaign] ??= []).push(r);
  }
  const pairs = {};
  for (const list of Object.values(byCampaign)) {
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].outcome !== 'fail') continue;
      for (let j = i + 1; j < list.length; j += 1) {
        if (list[j].outcome !== 'ok') continue;
        if (list[i].capability === list[j].capability) continue;
        const k = `${list[i].capability}→${list[j].capability}`;
        pairs[k] = (pairs[k] || 0) + 1;
      }
    }
  }
  const links = [];
  for (const [k, n] of Object.entries(pairs)) {
    if (n < minCases) continue;
    const [from, to] = k.split('→');
    const reverse = pairs[`${to}→${from}`] || 0;
    if (n < reverse * ratio) continue; // symmetric means it is a sequence, not a rescue
    links.push({ from, to, cases: n, reverse, why: `${n} case(s) where "${from}" failed and "${to}" then succeeded in the same campaign (${reverse} the other way)` });
  }
  return {
    links: links.sort((a, b) => b.cases - a.cases),
    enoughData: links.length > 0,
    why: links.length ? null : `no capability pair reached ${minCases} one-directional cases — with less than that, any correlation looks strong`,
  };
};

/**
 * Campaign templates, distilled from shapes that actually recurred.
 *
 * A template invented from intuition is a guess with a name. This only proposes one where the
 * same agent sequence has run `minRuns` times and mostly worked, so the template is a
 * description of what already happens rather than a prescription nobody validated.
 */
export const templates = (rows, { minRuns = 3, minSuccess = 0.66 } = {}) => {
  const byCampaign = {};
  for (const r of rows) {
    if (!r.campaign || r.corrupt || !r.agent || r.kind === 'spotcheck') continue;
    (byCampaign[r.campaign] ??= []).push(r);
  }
  const shapes = {};
  for (const list of Object.values(byCampaign)) {
    const seq = [];
    const caps = [];
    for (const r of list) {
      if (seq[seq.length - 1] !== r.agent) { seq.push(r.agent); caps.push(r.capability); }
    }
    if (seq.length < 2) continue;
    const key = seq.join(' → ');
    const s = (shapes[key] ??= { sequence: seq, capabilities: caps, runs: 0, ok: 0, tokens: 0 });
    s.runs += 1;
    if (!list.some((r) => r.outcome === 'fail')) s.ok += 1;
    s.tokens += list.reduce((n, r) => n + (r.tokens || 0), 0);
  }
  const found = Object.values(shapes)
    .filter((s) => s.runs >= minRuns && s.ok / s.runs >= minSuccess)
    .map((s) => ({
      name: s.capabilities.filter(Boolean).slice(0, 3).join('-') || 'unnamed',
      sequence: s.sequence,
      capabilities: s.capabilities,
      runs: s.runs,
      successRate: Number((s.ok / s.runs).toFixed(2)),
      avgTokens: Math.round(s.tokens / s.runs),
    }))
    .sort((a, b) => b.runs - a.runs);
  return {
    templates: found,
    enoughData: found.length > 0,
    why: found.length ? null : `no agent sequence has run ${minRuns}+ times with a ${Math.round(minSuccess * 100)}%+ clean rate — a template invented from fewer is a guess with a name`,
  };
};
