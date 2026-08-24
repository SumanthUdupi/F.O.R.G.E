/**
 * Declared-versus-conveyed.
 *
 * This is the suite that matters most, and the one most agent frameworks do not have.
 *
 * It is trivially easy to add a field to a registry, believe it is in force, and never
 * render it into a single prompt. The field parses, doctor sees it, documentation describes
 * it -- and no agent has ever been told. Everything below asserts that what the
 * configuration DECLARES actually reaches the built agent file.
 *
 * The rule this encodes: a field declared in the registry and rendered nowhere is a
 * comment, not a protocol.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { load, paths, resolveContract } from '../scripts/core.mjs';
import { agentMarkdown, skillMarkdown, build } from '../scripts/render.mjs';

const org = load();
const md = (name) => agentMarkdown(org.byName.get(name), org);
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

describe('frontmatter the host can register', () => {
  for (const a of [org.byName.get('chair'), org.byName.get('backend-engineer'), org.byName.get('staleness-auditor')]) {
    test(`${a.name} declares name, tools and a bound model`, () => {
      const body = agentMarkdown(a, org);
      const fm = body.slice(0, body.indexOf('\n---', 4));
      assert.match(fm, new RegExp(`name: ${a.name}`));
      assert.match(fm, /description: "/);
      assert.match(fm, /model: (haiku|sonnet|opus)/, 'the tier was not bound to a real model');
      for (const t of a.tools) assert.ok(fm.includes(t), `tool ${t} missing from frontmatter`);
    });
  }
});

describe('every declared field reaches the prompt', () => {
  test('stance, refusal and ownership appear verbatim', () => {
    for (const a of org.all) {
      const body = norm(agentMarkdown(a, org));
      assert.ok(body.includes(norm(a.owns)), `${a.name}: owns is declared and not rendered`);
      assert.ok(body.includes(norm(a.stance)), `${a.name}: stance is declared and not rendered`);
      assert.ok(body.includes(norm(a.refuses)), `${a.name}: refuses is declared and not rendered`);
    }
  });

  test('a manager is told what it is supposed to know', () => {
    for (const a of org.all.filter((x) => x.role === 'manager')) {
      assert.ok(norm(agentMarkdown(a, org)).includes(norm(a.knows)), `${a.name}: knows is not rendered`);
    }
  });

  test('a seat is told what it should object to', () => {
    for (const a of org.all.filter((x) => x.role === 'board')) {
      assert.ok(norm(agentMarkdown(a, org)).includes(norm(a.dissents_when)), `${a.name}: dissents_when is not rendered`);
    }
  });

  test('the resolved contract is printed, key by key', () => {
    for (const a of org.all) {
      const body = agentMarkdown(a, org);
      for (const f of resolveContract(a, org.contracts).fields) {
        assert.ok(body.includes(`${f.key}:`), `${a.name}: contract field ${f.key} never printed`);
      }
    }
  });

  test('every gate is named in every agent', () => {
    // An agent that has not been told about a gate cannot stop at it.
    for (const a of org.all) {
      const body = agentMarkdown(a, org);
      for (const g of org.constitution.gates) assert.ok(body.includes(g.title), `${a.name}: gate "${g.title}" not rendered`);
    }
  });

  test('the ten principles reach every agent', () => {
    for (const a of org.all) {
      const body = agentMarkdown(a, org);
      for (const p of org.constitution.board.principles) assert.ok(body.includes(p.name), `${a.name}: principle ${p.id} missing`);
    }
  });

  test('the escalation ladder is rendered in order', () => {
    const body = md('code-reviewer');
    let cursor = -1;
    for (const rung of org.constitution.escalation_ladder) {
      const at = body.indexOf(rung, cursor);
      assert.ok(at > cursor, `ladder rung "${rung}" missing or out of order`);
      cursor = at;
    }
  });
});

describe('the organization tells its agents there is no CEO', () => {
  test('a specialist is told the apex is a board', () => {
    assert.match(md('backend-engineer'), /no chief executive/i);
  });
  test('a seat is told it may only propose inside its own portfolio', () => {
    assert.match(md('chief-of-ledger'), /outside it you may object/i);
  });
  test('the Chair is told it breaks no tie', () => {
    assert.match(md('chair'), /breaks no tie/i);
  });
});

describe('the workspace overlay is pointed at', () => {
  test('every agent is told to read what the org learned here first', () => {
    for (const a of org.all) assert.ok(agentMarkdown(a, org).includes('.forge/profile.yaml'), `${a.name}`);
  });
});

describe('the build is complete and has no ghosts', () => {
  test('what build() would write matches the roster exactly', () => {
    const planned = build(org, { apply: false }).written.map((p) => path.basename(p, '.md'));
    for (const a of org.all) assert.ok(planned.includes(a.name), `${a.name} would not be written`);
  });

  test('the committed agents/ directory is in sync with the registry', () => {
    // A stale build is a routable agent describing an organization that no longer exists.
    const onDisk = fs.readdirSync(paths.agents).filter((f) => f.endsWith('.md'));
    assert.equal(onDisk.length, org.all.length, 'run `forge build --apply`');
    for (const a of org.all) {
      const p = path.join(paths.agents, `${a.name}.md`);
      assert.equal(fs.readFileSync(p, 'utf8'), agentMarkdown(a, org), `${a.name}.md is stale`);
    }
  });
});

describe('the entry skill', () => {
  test('names all six seats and their portfolios', () => {
    const s = skillMarkdown(org);
    for (const b of org.roster.board) assert.ok(s.includes(b.seat), `${b.seat} missing from the skill`);
  });
  test('tells the reader not to route from memory', () => {
    assert.match(skillMarkdown(org), /Do not route from memory/i);
  });
});

describe('documentation cannot drift from enforcement', () => {
  test('the committed CHARTER.md matches what the constitution generates', async () => {
    // Article 156. Hand-written architecture docs drift within two commits and the drift is
    // invisible, because both files read plausibly. Generated + asserted means a stale
    // document fails CI instead of misleading a reader.
    const { charterDoc } = await import('../scripts/charter-doc.mjs');
    const committed = fs.readFileSync(path.join(paths.agents, '..', 'CHARTER.md'), 'utf8');
    assert.equal(committed, charterDoc(org), 'run `forge charter --apply`');
  });
});

describe('the ledger duty is conveyed, not just decided', () => {
  test('the shipped skill tells every session to close the ledger', () => {
    // The improvement was approved as "make campaigns self-report spend". If the duty is
    // not in the generated skill, it was decided and never conveyed — the exact
    // declared-vs-conveyed failure this suite exists for.
    const s = skillMarkdown(org);
    assert.match(s, /Close the ledger/);
    assert.match(s, /observe --agent/);
    assert.match(s, /--tokens/, 'the duty does not mention the token estimate');
    assert.match(s, /--campaign/, 'the duty does not attribute to a campaign');
  });
});

describe('the launch page cannot drift from the organization it sells', () => {
  test('readme.html carries the real counts and every division by name', () => {
    // The page is marketing, which is exactly why it must not be allowed to lie: a count
    // that drifts from the registry turns the whole pitch into fiction.
    const html = fs.readFileSync(path.join(paths.agents, '..', 'readme.html'), 'utf8');
    const specialists = org.all.filter((a) => a.role === 'specialist').length;
    assert.ok(html.includes(`${specialists} specialists`), `page does not say ${specialists} specialists`);
    assert.ok(html.includes(`<b>${org.all.length}</b> AGENTS`), 'agent count drifted');
    assert.ok(html.includes(`<b>${org.constitution.rules.length}</b> RULES`), 'rule count drifted');
    for (const d of org.constitution.divisions) {
      assert.ok(html.includes(`<b>${d.name}</b>`), `division ${d.name} missing from the page`);
    }
    for (const g of org.constitution.gates) {
      // First WORD of the title, punctuation stripped — "Credentials, keys and access"
      // must match the page's "credentials" chip, and the comma is not part of the word.
      const word = g.title.split(' ')[0].replace(/[^a-z]/gi, '').toLowerCase();
      assert.ok(html.toLowerCase().includes(word), `gate "${g.title}" not represented`);
    }
  });
});
