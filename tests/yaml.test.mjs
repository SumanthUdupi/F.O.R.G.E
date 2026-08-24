/**
 * The reader's tests.
 *
 * The properties under test are mostly about REFUSING. A parser that quietly drops a
 * construct turns a registry field into a comment: present in the file, absent from the
 * parse, rendered nowhere, and believed by everyone. Every unsupported construct here must
 * throw with a line number rather than return something plausible.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parse, YamlError } from '../scripts/yaml.mjs';

describe('scalars', () => {
  test('types are recognised, and quoting wins', () => {
    const y = parse('a: 1\nb: 1.5\nc: true\nd: null\ne: ~\nf: "1"\ng: plain text\n');
    assert.deepEqual(y, { a: 1, b: 1.5, c: true, d: null, e: null, f: '1', g: 'plain text' });
  });

  test('a trailing comment is stripped, but a # inside quotes is not', () => {
    assert.deepEqual(parse('a: value # note\nb: "has # inside"\n'), { a: 'value', b: 'has # inside' });
  });

  test('a colon inside a value does not split the key', () => {
    assert.equal(parse('note: it fails: loudly\n').note, 'it fails: loudly');
  });
});

describe('structure', () => {
  test('nested maps', () => {
    assert.deepEqual(parse('a:\n  b:\n    c: 1\n'), { a: { b: { c: 1 } } });
  });

  test('a list of maps, which the roster depends on entirely', () => {
    const y = parse('items:\n  - id: one\n    n: 1\n  - id: two\n    n: 2\n');
    assert.deepEqual(y.items, [{ id: 'one', n: 1 }, { id: 'two', n: 2 }]);
  });

  test('a nested list inside a list item', () => {
    const y = parse('x:\n  - id: a\n    tags: [p, q]\n');
    assert.deepEqual(y.x[0].tags, ['p', 'q']);
  });

  test('folded blocks join, literal blocks keep their newlines', () => {
    const y = parse('a: >\n  one\n  two\nb: |\n  one\n  two\n');
    assert.equal(y.a, 'one two');
    assert.equal(y.b, 'one\ntwo');
  });

  test('a key with nothing under it is an empty map, not null', () => {
    // null and {} read the same at a glance and behave differently everywhere downstream.
    assert.deepEqual(parse('a:\nb: 1\n').a, {});
  });
});

describe('it refuses rather than guesses', () => {
  const rejects = (src, why) => {
    assert.throws(() => parse(src), YamlError, why);
  };

  test('anchors and aliases', () => rejects('a: &x 1\n'));
  test('flow maps', () => rejects('a: {b: 1}\n'));
  test('tabs', () => rejects('a:\n\tb: 1\n'));
  test('odd indentation', () => rejects('a:\n   b: 1\n'));
  test('duplicate keys', () => rejects('a: 1\na: 2\n'));
  test('an unterminated quote', () => rejects('a: "open\n'));
  test('an inline list that does not close on its line', () => rejects('a: [1,\n'));
  test('a document that does not start at column 0', () => rejects('  a: 1\n'));

  test('the error names the line', () => {
    try {
      parse('a: 1\nb: 2\n\ta: 3\n');
      assert.fail('did not throw');
    } catch (e) {
      assert.match(e.message, /line 3/);
    }
  });
});
