/**
 * The constitutional audit.
 *
 * Every rule in `charter/constitution.yaml` names a check, and every check is implemented
 * here under exactly that name. `core.load()` refuses to start if a rule names a check that
 * does not exist, so the two files cannot drift apart -- which is the failure this pairing
 * is built to prevent. A rule with no enforcement is a comment with a serial number.
 *
 * Doctor FAILS the process. It is wired into CI and into `forge install`, so a constitution
 * violation cannot reach a machine. Reporting a violation and exiting zero would make this
 * a report, and reports get skimmed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, paths, ui, resolveContract } from './core.mjs';

const CANONICAL_DIVISIONS = [
  'DIV-DIR', 'DIV-WFH', 'DIV-TAL', 'DIV-TRS', 'DIV-DSC', 'DIV-PRD',
  'DIV-IFD', 'DIV-ENG', 'DIV-QAA', 'DIV-REL', 'DIV-PDK', 'DIV-ARC',
];

/** Normalise an `owns` sentence so RULE 004 compares meaning rather than punctuation. */
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

/**
 * Each check returns { ok, notes: [{level, text}] }.
 * `level` is 'pass' | 'warn' | 'fail'. Only 'fail' sets a non-zero exit.
 */
export const CHECKS = {
  /** RULE 001 — the skeleton is exactly twelve, in the canonical order, unrenamed. */
  divisions_are_immutable(org) {
    const notes = [];
    const ids = org.constitution.divisions.map((d) => d.id);
    let ok = true;
    if (ids.length !== 12) {
      ok = false;
      notes.push({ level: 'fail', text: `${ids.length} divisions declared; the constitution fixes the number at 12` });
    }
    for (const c of CANONICAL_DIVISIONS) {
      if (!ids.includes(c)) {
        ok = false;
        notes.push({ level: 'fail', text: `${c} is missing — a division cannot be removed` });
      }
    }
    for (const id of ids) {
      if (!CANONICAL_DIVISIONS.includes(id)) {
        ok = false;
        notes.push({ level: 'fail', text: `${id} is not a constitutional division — a division cannot be created` });
      }
    }
    if (ok) notes.push({ level: 'pass', text: 'all twelve divisions present, none added, none renamed' });
    return { ok, notes };
  },

  /** RULE 002 — exactly one manager each. Zero is unroutable; two is an argument. */
  one_manager_per_division(org) {
    const notes = [];
    let ok = true;
    for (const d of org.constitution.divisions) {
      const mgrs = (org.byDivision.get(d.id) || []).filter((a) => a.role === 'manager');
      if (mgrs.length !== 1) {
        ok = false;
        notes.push({ level: 'fail', text: `${d.id} has ${mgrs.length} managers` });
      }
    }
    if (ok) notes.push({ level: 'pass', text: 'twelve divisions, twelve managers' });
    return { ok, notes };
  },

  /** RULE 003 — three to ten specialists. Under three is a person; over ten is a crowd. */
  specialist_band(org) {
    const notes = [];
    let ok = true;
    for (const d of org.constitution.divisions) {
      const n = (org.byDivision.get(d.id) || []).filter((a) => a.role === 'specialist').length;
      if (n < 3 || n > 10) {
        ok = false;
        notes.push({ level: 'fail', text: `${d.id} holds ${n} specialists; the band is 3 to 10` });
      }
    }
    if (ok) notes.push({ level: 'pass', text: 'every division inside the 3–10 band' });
    return { ok, notes };
  },

  /**
   * RULE 004 — no two specialists in one division own the same thing.
   *
   * Compared on the `owns` sentence, because that is the field a human would use to decide
   * which of two agents to call. Two agents whose responsibilities read the same will be
   * routed to interchangeably, and then neither has a measurable record.
   */
  specialists_are_distinct(org) {
    const notes = [];
    let ok = true;
    for (const d of org.constitution.divisions) {
      const specs = (org.byDivision.get(d.id) || []).filter((a) => a.role === 'specialist');
      for (let i = 0; i < specs.length; i += 1) {
        for (let j = i + 1; j < specs.length; j += 1) {
          const sim = jaccard(ownsKey(specs[i].owns), ownsKey(specs[j].owns));
          if (sim >= 0.6) {
            ok = false;
            notes.push({ level: 'fail', text: `${specs[i].name} and ${specs[j].name} own the same ground (${(sim * 100) | 0}% overlap)` });
          } else if (sim >= 0.45) {
            notes.push({ level: 'warn', text: `${specs[i].name} and ${specs[j].name} overlap at ${(sim * 100) | 0}% — worth a second look` });
          }
        }
      }
    }
    if (ok && !notes.length) notes.push({ level: 'pass', text: 'no two specialists in a division claim the same responsibility' });
    else if (ok) notes.push({ level: 'pass', text: 'no responsibility collision above the failure threshold' });
    return { ok, notes };
  },

  /**
   * RULE 005 — a manager routes; it does not perform.
   *
   * Enforced structurally, in two places that must agree: a manager may not hold write
   * tools, and the router excludes managers from staffing. Declaring the rule and then
   * staffing a manager anyway is exactly the drift this check exists to catch.
   */
  managers_route_not_perform(org) {
    const notes = [];
    let ok = true;
    const WRITE_TOOLS = ['Edit', 'Write', 'NotebookEdit'];
    for (const a of org.all.filter((x) => x.role === 'manager' || x.role === 'board')) {
      const bad = (a.tools || []).filter((t) => WRITE_TOOLS.includes(t));
      if (bad.length) {
        ok = false;
        notes.push({ level: 'fail', text: `${a.name} holds ${bad.join(', ')} — a ${a.role} that writes is a specialist with a title` });
      }
      if (a.writes) {
        ok = false;
        notes.push({ level: 'fail', text: `${a.name} declares writes: true` });
      }
    }
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'router.mjs'), 'utf8');
    if (!src.includes("a.role === 'specialist'")) {
      ok = false;
      notes.push({ level: 'fail', text: 'the router no longer filters staffing to specialists; the rule is declared and not enforced' });
    }
    if (ok) notes.push({ level: 'pass', text: 'no board seat or manager holds a write tool, and the router staffs specialists only' });
    return { ok, notes };
  },

  /**
   * RULE 011 — six seats, twelve divisions, an exact partition.
   *
   * Both directions matter and only one of them is obvious. An orphaned division has no
   * accountable seat; a division owned twice has two, which in practice is also none.
   * The specification this organization was built from said the chief executive "owns the
   * entire organization", which makes every ownership question unanswerable -- that is the
   * failure this check exists to make impossible.
   */
  board_partition_is_exact(org) {
    const notes = [];
    let ok = true;
    const seats = org.roster.board.map((b) => b.id);
    if (seats.length !== org.constitution.board.seats) {
      ok = false;
      notes.push({ level: 'fail', text: `${seats.length} seats on the roster; the constitution fixes the board at ${org.constitution.board.seats}` });
    }
    const owned = new Map();
    for (const pf of org.constitution.board.portfolios) {
      for (const d of pf.owns) {
        if (owned.has(d)) {
          ok = false;
          notes.push({ level: 'fail', text: `${d} is owned by ${owned.get(d)} and ${pf.seat}` });
        }
        owned.set(d, pf.seat);
      }
    }
    for (const d of org.constitution.divisions) {
      if (!owned.has(d.id)) {
        ok = false;
        notes.push({ level: 'fail', text: `${d.id} has no owning seat` });
      }
    }
    for (const seat of seats) {
      if (!org.constitution.board.portfolios.some((p) => p.seat === seat)) {
        ok = false;
        notes.push({ level: 'fail', text: `${seat} sits on the board owning nothing` });
      }
    }
    if (ok) notes.push({ level: 'pass', text: `${seats.length} seats own ${owned.size} divisions, exactly once each` });
    return { ok, notes };
  },

  /**
   * RULE 012 — the Chair convenes and records; it does not decide.
   *
   * Checked three ways, because the rule is the one most likely to erode back into a chief
   * executive: the Chair may hold no more divisions than any other seat, the constitution's
   * chair_authority must actually disclaim tie-breaking, and the board contract must give
   * every seat a POSITION field -- a board where only one seat votes is not a board.
   */
  chair_does_not_override(org) {
    const notes = [];
    let ok = true;
    const chairId = org.constitution.board.chair;
    const chair = org.constitution.board.portfolios.find((p) => p.seat === chairId);
    if (!chair) {
      return { ok: false, notes: [{ level: 'fail', text: `chair ${chairId} holds no portfolio` }] };
    }
    const widest = Math.max(...org.constitution.board.portfolios.map((p) => p.owns.length));
    if (chair.owns.length >= widest && org.constitution.board.portfolios.length > 1 && chair.owns.length > 1) {
      ok = false;
      notes.push({ level: 'fail', text: `the Chair owns ${chair.owns.length} divisions, the widest portfolio — that is a chief executive` });
    }
    const authority = String(org.constitution.board.chair_authority || '').toLowerCase();
    if (!/does not|no tie|breaks no|escalat/.test(authority)) {
      ok = false;
      notes.push({ level: 'fail', text: 'chair_authority does not disclaim deciding alone' });
    }
    const position = (org.contracts.by_role.board?.fields || []).find((f) => f.key === 'POSITION');
    if (!position) {
      ok = false;
      notes.push({ level: 'fail', text: 'the board contract has no POSITION field; only a voting board is a board' });
    }
    if (ok) notes.push({ level: 'pass', text: 'the Chair convenes, records and escalates — it does not outrank a seat' });
    return { ok, notes };
  },

  /** RULE 006 — the gates exist, are reachable from the matcher, and none is empty. */
  gated_actions_require_principal(org) {
    const notes = [];
    let ok = true;
    if (!org.constitution.gates?.length) {
      return { ok: false, notes: [{ level: 'fail', text: 'no gates declared; every action would be autonomous' }] };
    }
    for (const g of org.constitution.gates) {
      if (!g.matches?.length) {
        ok = false;
        notes.push({ level: 'fail', text: `${g.id} matches nothing, so it can never fire` });
      }
      if (!g.why) {
        ok = false;
        notes.push({ level: 'fail', text: `${g.id} states no reason; an unexplained gate gets clicked through` });
      }
    }
    if (ok) notes.push({ level: 'pass', text: `${org.constitution.gates.length} gates, each with a trigger and a stated reason` });
    return { ok, notes };
  },

  /** RULE 007 — the grades exist and are carried in the required protocol fields. */
  evidence_grades_declared(org) {
    const p = org.constitution.protocol;
    const notes = [];
    let ok = true;
    for (const g of ['EVIDENCE', 'INFERENCE', 'UNKNOWN']) {
      if (!p.evidence_values?.includes(g)) {
        ok = false;
        notes.push({ level: 'fail', text: `grade ${g} is not declared` });
      }
    }
    if (!p.required.includes('evidence_grade')) {
      ok = false;
      notes.push({ level: 'fail', text: 'evidence_grade is optional; an ungraded claim reads as fact' });
    }
    if (ok) notes.push({ level: 'pass', text: 'three grades declared, and required in every handoff' });
    return { ok, notes };
  },

  /** RULE 008 — there is a field for the question, or the model will guess instead. */
  protocol_carries_questions(org) {
    const p = org.constitution.protocol;
    const has = p.when_applicable?.includes('open_questions');
    return {
      ok: Boolean(has),
      notes: [
        has
          ? { level: 'pass', text: 'open_questions is part of the protocol' }
          : { level: 'fail', text: 'no open_questions field; RULE 008 has nowhere to put the question' },
      ],
    };
  },

  /** RULE 009 — the fields that make an action reconstructible are all present. */
  audit_fields_present(org) {
    const p = org.constitution.protocol;
    const all = [...p.required, ...(p.when_applicable || [])];
    const need = ['status', 'summary', 'evidence_grade', 'artifacts', 'files_changed', 'alternatives_rejected', 'cost'];
    const missing = need.filter((f) => !all.includes(f));
    return {
      ok: missing.length === 0,
      notes: missing.length
        ? missing.map((f) => ({ level: 'fail', text: `protocol has no "${f}"; RULE 009 cannot be answered without it` }))
        : [{ level: 'pass', text: 'who, why, on what evidence, at what cost, and what was rejected — all recordable' }],
    };
  },

  /** RULE 010 — somebody owns extraction, and somebody owns the failure record. */
  retirement_requires_extraction(org) {
    const notes = [];
    const extractor = org.all.find((a) => (a.capabilities || []).includes('capture'));
    const archivist = org.all.find((a) => a.name === 'failure-archivist');
    let ok = true;
    if (!extractor) {
      ok = false;
      notes.push({ level: 'fail', text: 'no agent holds "capture"; retiring an agent would discard what it learned' });
    }
    if (!archivist) {
      ok = false;
      notes.push({ level: 'fail', text: 'no failure archivist; failed attempts would be repeated at full price' });
    }
    const economist = org.all.find((a) => a.name === 'retirement-economist');
    if (!economist) notes.push({ level: 'warn', text: 'no retirement economist; retirement would be decided on usage alone' });
    if (ok) notes.push({ level: 'pass', text: 'extraction and failure memory both owned before anything retires' });
    return { ok, notes };
  },
};

/** Checks that are not constitutional rules, but catch the ways this repo has broken before. */
export const HYGIENE = {
  generated_agents_match_the_roster(org) {
    if (!fs.existsSync(paths.agents)) return { ok: true, notes: [{ level: 'warn', text: 'agents/ not built yet — run `forge build --apply`' }] };
    const onDisk = fs.readdirSync(paths.agents).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
    const expected = org.all.map((a) => a.name);
    const missing = expected.filter((n) => !onDisk.includes(n));
    const extra = onDisk.filter((n) => !expected.includes(n));
    const notes = [
      ...missing.map((n) => ({ level: 'fail', text: `${n} is in the roster and not on disk — the build is stale` })),
      ...extra.map((n) => ({ level: 'fail', text: `${n}.md is on disk and not in the roster — a ghost agent stays routable` })),
    ];
    if (!notes.length) notes.push({ level: 'pass', text: `${onDisk.length} generated agents match the roster exactly` });
    return { ok: !notes.some((n) => n.level === 'fail'), notes };
  },

  every_capability_is_reachable(org) {
    const supplied = new Set(org.all.filter((a) => a.role === 'specialist').flatMap((a) => a.capabilities || []));
    const asked = new Set(org.routing.rules.flatMap((r) => r.capabilities || []));
    // Some capabilities are reachable only from the governance commands, never from a
    // campaign plan. That is a legitimate design, so it has to be DECLARED -- otherwise
    // "no rule asks for this" is indistinguishable from an agent nobody can ever call.
    const governance = new Set(org.routing.governance_capabilities || []);
    const unreachable = [...supplied].filter((c) => !asked.has(c) && !governance.has(c));
    const notes = unreachable.map((c) => ({
      level: 'warn',
      text: `capability "${c}" is supplied but no routing rule ever asks for it — its holders are unreachable by plan`,
    }));
    if (!notes.length) notes.push({ level: 'pass', text: 'every declared capability is reachable from some routing rule' });
    return { ok: true, notes };
  },

  conflicts_are_symmetric(org) {
    const notes = [];
    let ok = true;
    const ids = new Set(org.routing.rules.map((r) => r.id));
    for (const c of org.routing.conflicts || []) {
      for (const r of c.between) {
        if (!ids.has(r)) {
          ok = false;
          notes.push({ level: 'fail', text: `conflict names unknown rule ${r}` });
        }
      }
      if (!c.resolve) {
        ok = false;
        notes.push({ level: 'fail', text: `conflict ${c.between.join(' / ')} declares no resolution` });
      }
    }
    if (ok) notes.push({ level: 'pass', text: 'every declared conflict names real rules and a resolution' });
    return { ok, notes };
  },

  every_agent_resolves_a_contract(org) {
    const notes = [];
    let ok = true;
    const need = org.constitution.protocol.required.map((f) => f.toUpperCase());
    for (const a of org.all) {
      const c = resolveContract(a, org.contracts);
      const keys = c.fields.map((f) => f.key);
      const missing = need.filter((k) => !keys.includes(k));
      if (missing.length) {
        ok = false;
        notes.push({ level: 'fail', text: `${a.name} resolves a contract missing ${missing.join(', ')}` });
      }
      if (!c.families.length) {
        ok = false;
        notes.push({ level: 'fail', text: `${a.name} joins no capability family — its contract is the bare minimum` });
      }
    }
    if (ok) notes.push({ level: 'pass', text: `all ${org.all.length} agents resolve a contract carrying every constitutional field` });
    return { ok, notes };
  },

  character_binds_behaviour(org) {
    // A stance that cannot make an agent decline something is decoration. The source
    // specification is full of adjectives -- "calm", "disciplined", "curious" -- that no
    // reader could act on, so this check requires the sentence that has consequences.
    const notes = [];
    let ok = true;
    for (const a of org.all) {
      if (!a.refuses) {
        ok = false;
        notes.push({ level: 'fail', text: `${a.name} has a stance and refuses nothing` });
      } else if (String(a.refuses).trim().length < 25) {
        notes.push({ level: 'warn', text: `${a.name}'s refusal is too short to constrain anything` });
      }
      if (a.role === 'board' && !a.dissents_when) {
        ok = false;
        notes.push({ level: 'fail', text: `${a.name} sits on the board and declares nothing it would object to` });
      }
      if (a.role === 'manager' && !a.knows) {
        ok = false;
        notes.push({ level: 'fail', text: `${a.name} is a manager with no declared team knowledge — RULE 005 is unmeasurable` });
      }
    }
    if (ok && !notes.length) notes.push({ level: 'pass', text: 'every agent refuses something specific; every seat names what it would object to' });
    else if (ok) notes.push({ level: 'pass', text: 'character binds behaviour, with notes' });
    return { ok, notes };
  },

  direct_channels_are_declared(org) {
    const notes = [];
    let ok = true;
    const ids = new Set(org.constitution.divisions.map((d) => d.id));
    for (const c of org.constitution.board.direct_channels || []) {
      for (const d of c.between) {
        if (!ids.has(d)) {
          ok = false;
          notes.push({ level: 'fail', text: `direct channel names unknown division ${d}` });
        }
      }
      if (!c.why) {
        ok = false;
        notes.push({ level: 'fail', text: `channel ${c.between.join(' <-> ')} states no reason to bypass the seat` });
      }
    }
    if (ok) notes.push({ level: 'pass', text: `${(org.constitution.board.direct_channels || []).length} declared channels, each with a reason` });
    return { ok, notes };
  },

  no_domain_leaked_in(org) {
    // F.O.R.G.E. ships with no domain (see constitution meta.domain). A vendor, product or
    // framework name in the shipped configuration would make the organization subtly wrong
    // for everyone who is not that customer -- and the leak is always accidental, which is
    // exactly why it needs a check rather than a promise.
    const CORPUS = ['charter/constitution.yaml', 'registry/roster.yaml', 'registry/routing.yaml', 'registry/contracts.yaml'];
    const marker = ['frappe', 'erpnext', 'exponent', 'doctype', 'bench --site', 'salesforce', 'shopify'];
    const notes = [];
    let ok = true;
    for (const rel of CORPUS) {
      const body = fs.readFileSync(path.join(ROOT, rel), 'utf8').toLowerCase();
      for (const m of marker) {
        if (body.includes(m)) {
          ok = false;
          notes.push({ level: 'fail', text: `${rel} mentions "${m}" — the shipped organization must carry no domain` });
        }
      }
    }
    if (ok) notes.push({ level: 'pass', text: 'shipped configuration is domain-free; the domain is learned per workspace' });
    return { ok, notes };
  },
};

/** Run everything. Returns { ok, failures, warnings, lines }. */
export const runDoctor = (org) => {
  const lines = [ui.head('FORGE DOCTOR — constitutional audit')];
  let failures = 0;
  let warnings = 0;

  lines.push(ui.rule('the ten rules'));
  for (const rule of org.constitution.rules) {
    const res = CHECKS[rule.check](org);
    for (const n of res.notes) {
      if (n.level === 'fail') failures += 1;
      if (n.level === 'warn') warnings += 1;
      lines.push(`${ui[n.level](`${rule.id}  ${n.text}`)}`);
    }
  }

  lines.push(ui.rule('hygiene'));
  for (const [name, fn] of Object.entries(HYGIENE)) {
    const res = fn(org);
    for (const n of res.notes) {
      if (n.level === 'fail') failures += 1;
      if (n.level === 'warn') warnings += 1;
      lines.push(`${ui[n.level](`${name}  ${n.text}`)}`);
    }
  }

  lines.push(ui.rule());
  lines.push(
    failures
      ? `  UNCONSTITUTIONAL — ${failures} failure(s), ${warnings} warning(s)`
      : `  HEALTHY — 0 failures, ${warnings} warning(s), ${org.all.length} agents, ${org.constitution.divisions.length} divisions`,
  );
  return { ok: failures === 0, failures, warnings, lines };
};
