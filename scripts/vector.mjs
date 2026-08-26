/**
 * The Campaign Vector: a request turned into an explicit graph of stages.
 *
 * Not a linear pipeline. Stages carry `dependsOn`, and independent stages share a batch, so
 * the Vector says both what must happen and what may happen at once. Article 71 governs the
 * batching, and it is a rule about WRITE SETS, not about ambition: two agents share a batch
 * when neither writes, or when their write scopes are disjoint. Reviewers, who write
 * nothing, are always parallel.
 *
 * Where the mode cap bites, the dropped stages are RETURNED, not discarded. A plan that
 * silently truncates reads as "this is everything", which is the single most expensive lie
 * a planner can tell.
 */

import { detectMode, matchRules, matchGates, selectAgents } from './router.mjs';
import { resolveContract } from './core.mjs';

/**
 * Stages these rules produce survive every cap, each with its own reason.
 *
 * One shared message was wrong for both: it told the framing stage that "the Principal must
 * be told what happened", which is the brief's job, not the frame's. A mandatory stage has
 * to say why IT is mandatory or the reader learns to skip the line.
 */
const MANDATORY_RULES = new Map([
  ['R-INTENT', 'without a done-condition nothing downstream can be checked'],
  ['R-REPORT', 'a campaign that reports nothing to the Principal has not delivered'],
]);

const MODE_FLOOR = ['direct', 'focused', 'standard', 'campaign'];

export const PHASES = ['frame', 'design', 'build', 'verify', 'release', 'deliver'];

const PHASE_INTENT = {
  frame: 'Establish what done means before anyone spends a token on getting there.',
  design: 'Decide the shape. Cheap to change here, expensive to change after build.',
  build: 'Implement exactly what design specified, and nothing adjacent that looked untidy.',
  verify: 'Produce evidence of the matching kind. A claim without one is UNKNOWN.',
  release: 'Establish the rollback path, then move. Never the other way round.',
  deliver: 'One brief for the Principal, and what the Archives keep from this campaign.',
};

/**
 * Batch a phase's stages. Greedy, and deliberately conservative: a stage whose write scope
 * is unknown is treated as colliding with every other writer, because guessing wrong here
 * means two agents editing one file in parallel and one of them losing.
 */
export const batch = (stages, maxWidth) => {
  const batches = [];
  for (const s of stages) {
    const target = batches.find((b) => {
      if (b.length >= maxWidth) return false;
      if (!s.writes) return true; // readers never collide
      return b.every((o) => !o.writes);
    });
    if (target) target.push(s);
    else batches.push([s]);
  }
  return batches;
};

/**
 * Compose the Vector.
 *
 * `memory` is the workspace's learned performance data; absent, every agent gets the
 * neutral prior and the plan is the cold-start plan. Passing it is what makes the tenth
 * campaign staffed better than the first.
 */
export const composeVector = (request, org, { memory = {}, mode: modeOverride = null, bias = {} } = {}) => {
  const { routing, constitution } = org;
  const decided = detectMode(request, routing, modeOverride);
  const rules = matchRules(request, routing);
  const gates = matchGates(request, constitution.gates);

  // A request that crosses a human gate is not a "focused, one place" change, whatever its
  // wording suggests. Found by planning "add rate limiting to the public api and deploy it":
  // it came back FOCUSED, and the cap then trimmed the security review and the release
  // stage off a request that says "public" and "deploy". The floor is the fix.
  if (!modeOverride && gates.length && MODE_FLOOR.indexOf(decided.mode) < MODE_FLOOR.indexOf('standard')) {
    decided.mode = 'standard';
    decided.why = `${decided.why}; raised to standard because ${gates.map((g) => g.id).join(', ')} fires`;
  }
  const modeSpec = routing.modes[decided.mode];

  if (decided.mode === 'direct') {
    return {
      request,
      mode: decided.mode,
      modeWhy: decided.why,
      intent: 'Answer directly. No division convened.',
      rules: rules.filter((r) => r.always),
      gates,
      stages: [],
      batches: [],
      dropped: [],
      staffed: [],
      considered: [],
      note: routing.modes.direct.note,
    };
  }

  const capsByPhase = new Map();
  for (const r of rules) {
    if (!capsByPhase.has(r.phase)) capsByPhase.set(r.phase, new Map());
    for (const c of r.capabilities || []) capsByPhase.get(r.phase).set(c, r.id);
  }

  const allCaps = [...capsByPhase.values()].flatMap((m) => [...m.keys()]);
  // Which phase each capability is being asked for in, so the router can weight the match
  // term by what that phase actually values. A capability asked for in two phases takes the
  // first — the earlier phase is the one whose wrong choice is paid for the longest.
  const phaseOf = {};
  for (const [phase, caps] of capsByPhase) for (const c of caps.keys()) if (!(c in phaseOf)) phaseOf[c] = phase;
  const { staffed, considered } = selectAgents(allCaps, org, memory, bias, phaseOf);
  const agentFor = new Map();
  for (const s of staffed) for (const c of s.capabilities) agentFor.set(c, s);

  // Build stages in phase order, so dependsOn only ever points backwards.
  let stages = [];
  let n = 0;
  for (const phase of PHASES) {
    const caps = capsByPhase.get(phase);
    if (!caps) continue;
    const prior = stages.map((s) => s.id);
    const inPhase = [];
    for (const [cap, ruleId] of caps) {
      const pick = agentFor.get(cap);
      if (!pick) continue;
      if (inPhase.some((s) => s.agent === pick.agent.name)) continue; // one stage per agent per phase
      n += 1;
      inPhase.push({
        id: `S${String(n).padStart(2, '0')}`,
        phase,
        intent: PHASE_INTENT[phase],
        capability: cap,
        rule: ruleId,
        division: pick.agent.division,
        agent: pick.agent.name,
        agentId: pick.agent.id,
        model: pick.agent.model,
        writes: Boolean(pick.agent.writes),
        owns: pick.agent.owns,
        score: pick.score,
        dependsOn: prior,
        gate: null,
        mandatory: MANDATORY_RULES.get(ruleId) || null,
      });
    }
    stages = stages.concat(inPhase);
  }

  // STRUCTURAL INVARIANT, not a keyword rule.
  //
  // Nothing in the request has to say "test" for a change that WRITES to need evidence
  // that it works. The first version of this planner produced a six-stage Vector that
  // edited two files and verified none of them, because no verify keyword happened to
  // appear in the sentence. Keyword rules describe what was asked; this describes what is
  // true regardless -- Article 108, gates are edges on the Vector, not decorations.
  // The test is for a CORRECTNESS check specifically, not for any verify-phase stage. An
  // accessibility audit sits in verify and answers a different question entirely; treating
  // its presence as verification let a writing Vector through with nothing checking whether
  // the change worked. Found by running the planner on "rename the label on the form".
  const verified = (s) => /review|test/.test(s.capability || '');
  for (const s of stages) {
    if (s.capability === 'security') s.mandatory = s.mandatory || 'a security review is not a nice-to-have once the request raised one';
  }
  if (stages.some((s) => s.writes) && !stages.some(verified)) {
    const forced = selectAgents(['review', 'test'], org, memory, bias);
    const prior = stages.map((s) => s.id);
    for (const pick of forced.staffed) {
      n += 1;
      stages.push({
        id: `S${String(n).padStart(2, '0')}`,
        phase: 'verify',
        intent: PHASE_INTENT.verify,
        capability: pick.capabilities.join('+'),
        rule: 'R-VERIFY-WRITES',
        division: pick.agent.division,
        agent: pick.agent.name,
        agentId: pick.agent.id,
        model: pick.agent.model,
        writes: Boolean(pick.agent.writes),
        owns: pick.agent.owns,
        score: pick.score,
        dependsOn: prior,
        gate: null,
        mandatory: 'the Vector writes; unverified writing is not done',
      });
    }
    // Deliver must still come last, or the brief is written before the evidence exists.
    stages.sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase));
  }

  // Mode caps. Trim from the END, so the frame is never the thing that gets cut, and say
  // exactly what was dropped -- silent truncation reads as complete coverage.
  // Gates attach BEFORE the cap runs, and a gated stage is mandatory.
  //
  // Attaching after the trim was a real hole: the cap could remove the exact stage the gate
  // was going to sit on, and the gate then vanished from a plan that still crossed it. A
  // gate that a cap can delete is not a gate.
  for (const g of gates) {
    const phase = g.id === 'GATE-RELEASE' || g.id === 'GATE-IRREVERSIBLE' ? 'release' : 'verify';
    const candidates = stages.filter((s) => s.phase === phase);
    const anchor = candidates.length ? candidates[candidates.length - 1] : stages[stages.length - 1];
    if (anchor) {
      anchor.gate = g.id;
      anchor.mandatory = `${g.id} attaches here; a cap may not remove a gated stage`;
    }
  }

  // A cap may not remove a mandatory stage. If the budget cannot cover verification, the
  // honest outcome is a smaller build, not the same build unverified.
  const dropped = [];
  const trim = (limit, count, why) => {
    while (count() > limit) {
      const idx = stages.map((s, i) => [s, i]).reverse().find(([s]) => !s.mandatory)?.[1];
      if (idx === undefined) break; // everything left is mandatory; report over-cap instead
      dropped.push({ ...stages[idx], why });
      stages.splice(idx, 1);
    }
  };
  trim(modeSpec.max_stages, () => stages.length, `${decided.mode} mode caps the Vector at ${modeSpec.max_stages} stages`);
  trim(modeSpec.max_agents, () => new Set(stages.map((s) => s.agent)).size, `${decided.mode} mode caps the roster at ${modeSpec.max_agents} agents`);

  // Reconcile: the invariant fires BEFORE the cap, so a cap that removed the last writer
  // can leave verification of nothing behind. Two stages of deep review on an empty diff is
  // the cheapest kind of waste, but it is still waste, and it makes the plan read wrong.
  if (!stages.some((s) => s.writes)) {
    for (const s of stages.filter((x) => x.rule === 'R-VERIFY-WRITES')) {
      dropped.push({ ...s, why: 'the cap removed every writing stage; there is nothing left to verify' });
    }
    stages = stages.filter((s) => s.rule !== 'R-VERIFY-WRITES');
  }

  // Renumber in execution order. Ids allocated during composition reflect the order the
  // planner discovered stages, which is not the order anyone runs them in.
  stages.sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase));
  const renamed = new Map(stages.map((s, i) => [s.id, `S${String(i + 1).padStart(2, '0')}`]));
  for (const s of stages) {
    s.id = renamed.get(s.id);
    s.dependsOn = s.dependsOn.map((d) => renamed.get(d)).filter(Boolean);
  }

  const batches = [];
  for (const phase of PHASES) {
    const inPhase = stages.filter((s) => s.phase === phase);
    if (!inPhase.length) continue;
    for (const b of batch(inPhase, Math.min(routing.parallelism.max_width, constitution.circuit_breakers.parallel_width))) {
      batches.push({ phase, stages: b.map((s) => s.id), parallel: b.length > 1 });
    }
  }

  return {
    request,
    mode: decided.mode,
    modeWhy: decided.why,
    intent: modeSpec.for,
    rules,
    gates,
    stages,
    batches,
    dropped,
    staffed,
    considered,
    sequential: batches.filter((b) => !b.parallel).length,
    // The contract each staffed agent owes AT THIS MODE. The rendered agent file always
    // carries the full contract, because at build time nobody knows what the next request
    // will be; the Vector knows, so it is the honest place to say "for this one, these
    // fields". A caller dispatching from the Vector reads this instead of the file's.
    contract: Object.fromEntries(
      staffed.map((s2) => {
        // `staffed` entries carry the agent OBJECT under `.agent`, not its name — checked
        // against selectAgents rather than guessed from the field name.
        const agent = typeof s2.agent === 'string' ? org.byName.get(s2.agent) : s2.agent;
        if (!agent || !agent.name) return [null, null];
        const r = resolveContract(agent, org.contracts, { mode: decided.mode });
        return [agent.name, { required: r.fields.map((f) => f.key), optional: r.optional.map((f) => f.key) }];
      }).filter(([, v]) => v),
    ),
    note: null,
  };
};

/** Render a Vector for a terminal. The only place plan output is formatted. */
export const renderVector = (v, org) => {
  const L = [];
  const div = (id) => org.constitution.divisions.find((d) => d.id === id)?.name ?? id;
  L.push(`\nCAMPAIGN VECTOR`);
  L.push(`request   ${v.request}`);
  L.push(`mode      ${v.mode.toUpperCase()} — ${v.intent}`);
  L.push(`selected  ${v.modeWhy}`);

  if (v.gates.length) {
    L.push(`\nGATES — the campaign stops here and waits for you`);
    for (const g of v.gates) L.push(`  ${g.id}  ${g.title}  (matched "${g.on}")\n      ${g.why}`);
  }

  if (!v.stages.length) {
    L.push(`\n${v.note || 'No stages. Answer directly.'}`);
    return L.join('\n');
  }

  L.push(`\nSTAGES  ${v.stages.length} across ${new Set(v.stages.map((s) => s.phase)).size} phases`);
  let phase = null;
  for (const b of v.batches) {
    if (b.phase !== phase) {
      phase = b.phase;
      L.push(`\n  ${phase.toUpperCase()}  ${PHASE_INTENT[phase]}`);
    }
    const tag = b.parallel ? `parallel x${b.stages.length}` : 'sequential';
    L.push(`    [${tag}]`);
    for (const id of b.stages) {
      const s = v.stages.find((x) => x.id === id);
      L.push(`      ${s.id}  ${s.agent.padEnd(24)} ${div(s.division).padEnd(20)} ${s.model.padEnd(9)} ${s.writes ? 'writes' : 'reads '}  score ${s.score}`);
      L.push(`            owns: ${s.owns}`);
      if (s.gate) L.push(`            GATE ${s.gate} — stop here`);
    }
  }

  if (v.dropped.length) {
    L.push(`\nDROPPED  ${v.dropped.length} stage(s) the cap removed — named, not hidden`);
    for (const d of v.dropped) L.push(`  ${d.agent} (${d.capability}) — ${d.why}`);
  }

  L.push(`\nRUNNERS-UP  who else could have taken each stage`);
  for (const c of v.considered.slice(0, 6)) {
    if (!c.runnersUp.length) continue;
    L.push(`  ${c.capability}: ${c.runnersUp.map((r) => `${r.agent.name} ${r.score}`).join(', ')}`);
  }
  return L.join('\n');
};
