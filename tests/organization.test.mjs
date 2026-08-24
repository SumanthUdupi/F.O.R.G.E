/**
 * The organization loads, cross-references, and refuses to be incoherent.
 *
 * These assert the SHAPE the constitution fixes. If one fails, the shipped organization
 * violates its own charter, which is a different kind of bug from a broken function: every
 * downstream command was written assuming this graph is whole.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { load, resolveContract } from '../scripts/core.mjs';

const org = load();

describe('the constitutional shape', () => {
  test('twelve divisions, six seats, exactly partitioned', () => {
    assert.equal(org.constitution.divisions.length, 12);
    assert.equal(org.roster.board.length, 6);
    const owned = org.constitution.board.portfolios.flatMap((p) => p.owns);
    assert.equal(owned.length, 12, 'a division is owned twice or not at all');
    assert.equal(new Set(owned).size, 12);
  });

  test('there is no chief executive: the Chair does not hold the widest portfolio', () => {
    const chair = org.constitution.board.portfolios.find((p) => p.seat === org.constitution.board.chair);
    const widest = Math.max(...org.constitution.board.portfolios.map((p) => p.owns.length));
    assert.ok(chair.owns.length < widest, 'the Chair owns the most divisions, which makes it a CEO');
  });

  test('one manager per division, and 3 to 10 specialists', () => {
    for (const d of org.constitution.divisions) {
      const staff = org.byDivision.get(d.id);
      assert.equal(staff.filter((a) => a.role === 'manager').length, 1, `${d.id} manager count`);
      const n = staff.filter((a) => a.role === 'specialist').length;
      assert.ok(n >= 3 && n <= 10, `${d.id} holds ${n} specialists`);
    }
  });

  test('no board seat or manager can write', () => {
    // RULE 005 is only real if it is structural. A manager holding Edit will eventually use it.
    for (const a of org.all.filter((x) => x.role !== 'specialist')) {
      assert.ok(!a.writes, `${a.name} declares writes`);
      for (const t of a.tools || []) assert.ok(!['Edit', 'Write', 'NotebookEdit'].includes(t), `${a.name} holds ${t}`);
    }
  });

  test('every agent refuses something, and every seat names what it objects to', () => {
    for (const a of org.all) {
      assert.ok(a.stance, `${a.name} has no stance`);
      assert.ok(a.refuses && a.refuses.length > 20, `${a.name} refuses nothing actionable`);
      if (a.role === 'board') assert.ok(a.dissents_when, `${a.name} objects to nothing`);
      if (a.role === 'manager') assert.ok(a.knows, `${a.name} declares no team knowledge`);
    }
  });
});

describe('contracts resolve for everyone, not just the board', () => {
  test('all 64 agents carry every constitutionally required field', () => {
    const need = org.constitution.protocol.required.map((f) => f.toUpperCase());
    for (const a of org.all) {
      const keys = resolveContract(a, org.contracts).fields.map((f) => f.key);
      for (const k of need) assert.ok(keys.includes(k), `${a.name} is missing ${k}`);
    }
  });

  test('a reviewer is told to write nothing; a builder is told to declare its write scope', () => {
    const rev = resolveContract(org.byName.get('code-reviewer'), org.contracts);
    assert.ok(rev.rules.some((r) => /write nothing/i.test(r)));
    const build = resolveContract(org.byName.get('backend-engineer'), org.contracts);
    assert.ok(build.fields.some((f) => f.key === 'WRITE_SCOPE'));
  });

  test('a field claimed by two families appears once, not twice', () => {
    for (const a of org.all) {
      const keys = resolveContract(a, org.contracts).fields.map((f) => f.key);
      assert.equal(new Set(keys).size, keys.length, `${a.name} has a duplicated contract field`);
    }
  });
});

describe('nothing domain-specific shipped', () => {
  test('the roster names no vendor, product or framework', () => {
    // The organization ships with no domain and learns one. A leaked product name makes it
    // subtly wrong for everyone who is not that customer.
    const body = JSON.stringify(org.roster).toLowerCase();
    for (const m of ['frappe', 'erpnext', 'exponent', 'doctype', 'django', 'rails', 'salesforce']) {
      assert.ok(!body.includes(m), `roster mentions ${m}`);
    }
  });
});
