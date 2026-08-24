/**
 * Routing. Deterministic, model-free, explainable.
 *
 * Given the same request text, roster and policy, this returns the same answer every time,
 * and reports which rules fired and which candidates lost. That property is the reason a
 * wrong route can be argued about: the disagreement resolves into an edit of
 * `registry/routing.yaml` rather than a re-run and a shrug.
 *
 * The one thing here that CHANGES with use is the reliability term, which comes from the
 * workspace memory the evolution layer writes. Shape is policy; staffing is learned.
 */

/** Word-boundary containment. Substring matching turns "index" into a hit on "indexed". */
const hits = (text, needle) => {
  const n = needle.toLowerCase().trim();
  if (!n) return false;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i').test(text);
};

const MODE_ORDER = ['direct', 'focused', 'standard', 'campaign'];

/**
 * Pick the effort mode. The HIGHEST matching mode wins, because under-planning a campaign
 * costs a rebuild and over-planning a typo costs one wasted dispatch. The asymmetry is
 * deliberate and is the reason this is a max and not a first-match.
 */
export const detectMode = (request, routing, override = null) => {
  const text = String(request || '').toLowerCase();
  if (override) {
    if (!routing.modes[override]) throw new Error(`unknown mode "${override}"`);
    return { mode: override, why: 'set explicitly by the Principal', matched: [] };
  }
  const matched = [];
  let best = 'focused'; // Neutral default: something to do, nothing signalling scale.
  for (const mode of MODE_ORDER) {
    for (const sig of routing.escalators[mode] || []) {
      if (hits(text, sig)) {
        matched.push({ mode, signal: sig });
        if (MODE_ORDER.indexOf(mode) > MODE_ORDER.indexOf(best)) best = mode;
      }
    }
  }
  // "what is" plus nothing else really is a question; "what is slow about the import job"
  // is not. So `direct` only survives when it is the ONLY thing that matched.
  const nonDirect = matched.filter((m) => m.mode !== 'direct');
  if (matched.some((m) => m.mode === 'direct') && nonDirect.length === 0) best = 'direct';
  return {
    mode: best,
    why: matched.length ? `matched ${matched.map((m) => `"${m.signal}"`).join(', ')}` : 'no scale signal; defaulted',
    matched,
  };
};

/** Which routing rules fire for this request. */
export const matchRules = (request, routing) => {
  const text = String(request || '').toLowerCase();
  const fired = [];
  for (const r of routing.rules) {
    if (r.always) {
      fired.push({ ...r, on: 'always' });
      continue;
    }
    const on = (r.when_any || []).find((s) => hits(text, s));
    if (!on) continue;
    if ((r.unless || []).some((s) => hits(text, s))) continue;
    fired.push({ ...r, on });
  }
  return fired;
};

/** Which human gates this request crosses. The loudest output the organization produces. */
export const matchGates = (request, gates) => {
  const text = String(request || '').toLowerCase();
  return gates
    .map((g) => ({ ...g, on: (g.matches || []).find((s) => hits(text, s)) }))
    .filter((g) => g.on);
};

/** The neutral prior for an agent nobody has measured yet. Not 1.0 — unmeasured is not proven. */
export const PRIOR = { reliability: 0.7, recent: 0.7, availability: 1 };

/**
 * Article 144. Capability match x reliability x recent success x cost x availability.
 * Article 145: never route on cost alone — cost is the smallest weight and cannot reach
 * zero, so a cheap agent can win a tie and can never win on price alone.
 */
export const scoreAgent = (agent, capability, org, memory = {}, bias = {}) => {
  const w = org.routing.score;
  const m = memory[agent.name] || {};
  const caps = agent.capabilities || [];
  if (!caps.includes(capability)) return null;

  // A specialist with three capabilities is more focused on each than one with ten.
  const match = 1 / Math.sqrt(caps.length);
  const reliability = m.reliability ?? PRIOR.reliability;
  const recent = m.byClass?.[capability]?.rate ?? PRIOR.recent;
  const tierCost = { lean: 1, standard: 0.6, deep: 0.3 }[agent.model] ?? 0.6;
  const availability = m.busy ? 0.4 : PRIOR.availability;

  let score =
    w.capability_match * match +
    w.reliability * reliability +
    w.recent_success_on_class * recent +
    w.cost_efficiency * tierCost +
    w.availability * availability;

  // Article 146. A recent run of failures on THIS class lowers confidence here only.
  const streak = m.byClass?.[capability]?.consecutiveFailures ?? 0;
  if (streak > 0) {
    const p = org.routing.failure_penalty;
    score = Math.max(score * p.floor, score * (1 - p.consecutive_failures_on_class * streak));
  }

  // The Principal's own thumb on the scale for this workspace. It multiplies AFTER the
  // measured terms, so a preference nudges a choice between qualified agents and can
  // never hand work to someone who lacks the capability — that check happened above.
  const nudge = bias[agent.name];
  if (nudge) score *= nudge;

  return {
    agent,
    capability,
    score: Number(score.toFixed(4)),
    biased: nudge ? (nudge > 1 ? 'preferred here' : 'de-preferred here') : null,
    parts: { match: Number(match.toFixed(3)), reliability, recent, tierCost, availability, streak },
  };
};

/**
 * Best agent per capability, plus the runners-up.
 *
 * Managers are excluded from staffing. A manager who takes the task has become a
 * specialist with a title, which RULE 005 exists to prevent -- and doctor asserts it.
 */
export const selectAgents = (capabilities, org, memory = {}, bias = {}) => {
  const chosen = [];
  const considered = [];
  for (const cap of [...new Set(capabilities)]) {
    const ranked = org.all
      .filter((a) => a.role === 'specialist')
      .map((a) => scoreAgent(a, cap, org, memory, bias))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.agent.id.localeCompare(b.agent.id));
    if (!ranked.length) continue;
    chosen.push(ranked[0]);
    considered.push({ capability: cap, runnersUp: ranked.slice(1, 4) });
  }
  // One agent can satisfy two capabilities. Convening it twice is the classic double-bill.
  const seen = new Map();
  for (const c of chosen) {
    const prev = seen.get(c.agent.id);
    if (!prev) seen.set(c.agent.id, { ...c, capabilities: [c.capability] });
    else prev.capabilities.push(c.capability);
  }
  return { staffed: [...seen.values()], considered };
};

export { hits };
