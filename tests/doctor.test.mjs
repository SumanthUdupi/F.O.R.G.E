/**
 * Doctor's tests, and they work by BREAKING the organization.
 *
 * A check that has never seen a violation is a check whose state nobody knows. Asserting
 * that a healthy org passes proves almost nothing -- an empty function passes too. So every
 * test here plants the specific violation its rule exists to catch and asserts the failure,
 * then asserts the unmodified organization is clean.
 *
 * Each check gets a deep-cloned organization so a planted violation cannot leak sideways.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../scripts/core.mjs';
import { CHECKS, HYGIENE, runDoctor } from '../scripts/doctor.mjs';

const base = load();
/** A mutable deep copy. `load()` freezes the top level, and every test needs to vandalise it. */
const clone = () => {
  const o = JSON.parse(JSON.stringify({ constitution: base.constitution, roster: base.roster, routing: base.routing, contracts: base.contracts }));
  const all = [...o.roster.board, ...o.roster.agents];
  o.all = all;
  o.byId = new Map(all.map((a) => [a.id, a]));
  o.byName = new Map(all.map((a) => [a.name, a]));
  o.byDivision = new Map(o.constitution.divisions.map((d) => [d.id, all.filter((a) => a.division === d.id)]));
  o.seatOf = new Map(o.constitution.board.portfolios.flatMap((p) => p.owns.map((d) => [d, p.seat])));
  return o;
};
const fails = (check, o) => !CHECKS[check](o).ok;

describe('the shipped organization is constitutional', () => {
  test('every rule and every hygiene check passes', () => {
    const r = runDoctor(base);
    assert.ok(r.ok, r.lines.filter((l) => l.includes('FAIL')).join('\n'));
  });

  test('doctor exits non-zero on a violation, or it is a report and not a gate', () => {
    const o = clone();
    o.constitution.divisions.pop();
    assert.ok(!runDoctor(o).ok);
  });
});

describe('RULE 001 — divisions are immutable', () => {
  test('removing one fails', () => {
    const o = clone();
    o.constitution.divisions = o.constitution.divisions.filter((d) => d.id !== 'DIV-QAA');
    assert.ok(fails('divisions_are_immutable', o));
  });
  test('inventing one fails', () => {
    const o = clone();
    o.constitution.divisions.push({ id: 'DIV-NEW', name: 'Growth', code: 'GRW' });
    assert.ok(fails('divisions_are_immutable', o));
  });
  test('renaming the id fails', () => {
    const o = clone();
    o.constitution.divisions[0].id = 'DIV-BOSS';
    assert.ok(fails('divisions_are_immutable', o));
  });
});

describe('RULE 002 / 003 — one manager, three to ten specialists', () => {
  test('a second manager fails', () => {
    const o = clone();
    o.byDivision.get('DIV-ENG').push({ ...o.byName.get('engineering-manager'), id: 'X', name: 'x' });
    assert.ok(fails('one_manager_per_division', o));
  });
  test('two specialists fails', () => {
    const o = clone();
    o.byDivision.set('DIV-ENG', o.byDivision.get('DIV-ENG').slice(0, 3));
    assert.ok(fails('specialist_band', o));
  });
  test('eleven specialists fails', () => {
    const o = clone();
    const one = o.byName.get('backend-engineer');
    const padded = [...o.byDivision.get('DIV-ENG')];
    while (padded.filter((a) => a.role === 'specialist').length <= 10) padded.push({ ...one, id: `X${padded.length}` });
    o.byDivision.set('DIV-ENG', padded);
    assert.ok(fails('specialist_band', o));
  });
});

describe('RULE 004 — two specialists may not own the same ground', () => {
  test('a near-duplicate responsibility fails', () => {
    const o = clone();
    o.byName.get('frontend-engineer').owns = o.byName.get('backend-engineer').owns;
    o.byDivision.set('DIV-ENG', o.byDivision.get('DIV-ENG'));
    assert.ok(fails('specialists_are_distinct', o));
  });
  test('a reworded duplicate is still caught', () => {
    // Word-for-word matching would be trivially evaded by anyone renaming a field.
    const o = clone();
    o.byName.get('frontend-engineer').owns = 'Handlers, jobs, transitions and the queries that sit behind them.';
    assert.ok(fails('specialists_are_distinct', o));
  });
  test('two genuinely different responsibilities pass', () => {
    assert.ok(CHECKS.specialists_are_distinct(clone()).ok);
  });
});

describe('RULE 005 — managers route, they do not perform', () => {
  test('a manager holding Edit fails', () => {
    const o = clone();
    o.byName.get('qa-manager').tools.push('Edit');
    assert.ok(fails('managers_route_not_perform', o));
  });
  test('a board seat holding Write fails', () => {
    const o = clone();
    o.byName.get('chief-of-works').tools.push('Write');
    assert.ok(fails('managers_route_not_perform', o));
  });
});

describe('RULE 011 / 012 — the board is a board', () => {
  test('a division owned by two seats fails', () => {
    const o = clone();
    o.constitution.board.portfolios[0].owns.push('DIV-ENG');
    assert.ok(fails('board_partition_is_exact', o));
  });
  test('an orphaned division fails', () => {
    const o = clone();
    o.constitution.board.portfolios.find((p) => p.seat === 'BRD-LDG').owns = [];
    assert.ok(fails('board_partition_is_exact', o));
  });
  test('a Chair that owns everything is a CEO, and fails', () => {
    const o = clone();
    o.constitution.board.portfolios.find((p) => p.seat === 'BRD-CHR').owns = o.constitution.divisions.map((d) => d.id);
    assert.ok(fails('chair_does_not_override', o));
  });
  test('a chair authority that no longer disclaims deciding alone fails', () => {
    const o = clone();
    o.constitution.board.chair_authority = 'The Chair has the final word on all matters.';
    assert.ok(fails('chair_does_not_override', o));
  });
  test('removing POSITION from the board contract fails — a board that cannot vote is not one', () => {
    const o = clone();
    o.contracts.by_role.board.fields = o.contracts.by_role.board.fields.filter((f) => f.key !== 'POSITION');
    assert.ok(fails('chair_does_not_override', o));
  });
});

describe('RULE 007 / 008 / 009 — the protocol carries what audit needs', () => {
  test('dropping evidence_grade from required fails', () => {
    const o = clone();
    o.constitution.protocol.required = o.constitution.protocol.required.filter((f) => f !== 'evidence_grade');
    assert.ok(fails('evidence_grades_declared', o));
  });
  test('dropping open_questions fails', () => {
    const o = clone();
    o.constitution.protocol.when_applicable = o.constitution.protocol.when_applicable.filter((f) => f !== 'open_questions');
    assert.ok(fails('protocol_carries_questions', o));
  });
  test('dropping alternatives_rejected fails — dissent becomes unrecordable', () => {
    const o = clone();
    o.constitution.protocol.when_applicable = o.constitution.protocol.when_applicable.filter((f) => f !== 'alternatives_rejected');
    assert.ok(fails('audit_fields_present', o));
  });
});

describe('hygiene', () => {
  test('a stance with no refusal fails', () => {
    const o = clone();
    delete o.byName.get('code-reviewer').refuses;
    assert.ok(!HYGIENE.character_binds_behaviour(o).ok);
  });
  test('a seat that objects to nothing fails', () => {
    const o = clone();
    delete o.byName.get('chief-of-ledger').dissents_when;
    assert.ok(!HYGIENE.character_binds_behaviour(o).ok);
  });
  test('a domain name leaking into the shipped registry fails', () => {
    // Checked against the files on disk, so this asserts the real repository, not a clone.
    assert.ok(HYGIENE.no_domain_leaked_in(base).ok);
  });
  test('an asymmetric or dangling conflict fails', () => {
    const o = clone();
    o.routing.conflicts.push({ between: ['R-REVIEW', 'R-DOES-NOT-EXIST'], resolve: 'x' });
    assert.ok(!HYGIENE.conflicts_are_symmetric(o).ok);
  });
});
