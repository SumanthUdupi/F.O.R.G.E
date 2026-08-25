/**
 * Turn the registry into agents the host runtime can actually dispatch.
 *
 * `agents/*.md` is BUILD OUTPUT. Hand-editing one works exactly until the next build, and
 * then silently does not, which is a bad afternoon. Everything an agent is told comes from
 * `registry/` and `charter/`, so that changing behaviour means changing configuration and
 * `forge doctor` gets a chance to object first.
 *
 * WHAT GOES INTO THE PROMPT, AND WHY EACH PART IS THERE
 *
 * Anything declared in the registry and rendered nowhere is a comment. This repo's own
 * audit exists because that failure is easy and invisible: a field is added, everyone
 * believes it is in force, and no prompt has ever contained it. So every field the registry
 * carries -- stance, refuses, knows, dissents_when, the resolved contract, the gates, the
 * ladder -- is emitted below, and `doctor` cross-checks the built files against the roster.
 */

import fs from 'node:fs';
import path from 'node:path';
import { paths, resolveContract } from './core.mjs';

const wrap = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** YAML frontmatter the host reads to register the subagent. */
const frontmatter = (a, org) => {
  const model = org.roster.meta.tier_models[a.model] || a.model;
  // The description is what a router reads to decide. Lead with the responsibility, not
  // with the job title -- "owns X" is selectable, "is a senior engineer" is not.
  const desc = `${wrap(a.owns)} ${wrap(a.specialization)}.`;
  return [
    '---',
    `name: ${a.name}`,
    `description: ${JSON.stringify(desc)}`,
    `tools: ${(a.tools || []).join(', ')}`,
    `model: ${model}`,
    '---',
  ].join('\n');
};

const contractBlock = (a, org) => {
  const c = resolveContract(a, org.contracts);
  const L = ['## Your output contract', '', 'Every field, every time. An omitted field is a protocol violation; `none` is an answer.', '', '```'];
  for (const f of c.fields) L.push(`${f.key}:${f.values ? `  [${f.values.join(' | ')}]` : ''}`);
  L.push('```', '');
  L.push('Field notes:', '');
  for (const f of c.fields) if (f.note) L.push(`- **${f.key}** — ${wrap(f.note)}`);
  if (c.optional.length) {
    L.push('', 'State these when they apply, and write `none` when they do not:', '');
    for (const f of c.optional) L.push(`- **${f.key}**${f.note ? ` — ${wrap(f.note)}` : ''}`);
  }
  L.push('', '## Rules that bind you', '');
  for (const r of c.rules) L.push(`- ${wrap(r)}`);
  return L.join('\n');
};

export const agentMarkdown = (a, org) => {
  const division = org.constitution.divisions.find((d) => d.id === a.division);
  const seatId = org.seatOf.get(a.division);
  const seat = org.roster.board.find((b) => b.id === seatId);
  const L = [];

  L.push(frontmatter(a, org));
  L.push('');
  L.push(`# ${a.name}`);
  L.push('');
  const isSeat = a.role === 'board';
  L.push(`**${a.id}** · ${a.role} · **${division.name}** (${division.code}) · ${isSeat ? `holds the seat of **${seat.seat}**` : `reports to **${seat.seat}**`} · tier \`${a.model}\``);
  L.push('');
  L.push(`> ${wrap(a.owns)}`);
  L.push('');

  L.push('## Where you sit');
  L.push('');
  L.push(`Your division: **${division.name}** — ${wrap(division.mission)}`);
  L.push(`Its authority: ${wrap(division.authority)}${division.may_halt ? '  **This division may halt a campaign.**' : ''}`);
  L.push('');
  if (isSeat) {
    const owns = org.constitution.board.portfolios.find((pf) => pf.seat === a.id).owns
      .map((d) => org.constitution.divisions.find((x) => x.id === d).name)
      .join(', ');
    L.push(`There is no chief executive. You are one of ${org.constitution.board.seats} seats, and your portfolio is **${owns}**. You propose inside it; outside it you may object and nothing else.`);
    if (a.id === org.constitution.board.chair) {
      L.push('');
      L.push(`You hold the Chair. ${wrap(org.constitution.board.chair_authority)}`);
    }
  } else {
    L.push(`There is no chief executive above you. The apex is a board of ${org.constitution.board.seats}, and the seat accountable for your division is **${seat.seat}**.`);
  }
  L.push('');
  L.push('Escalate in this order, and only to the next rung:');
  L.push('');
  L.push(org.constitution.escalation_ladder.map((r, i) => `${i + 1}. ${r}`).join('\n'));
  L.push('');
  L.push('Skip straight to the Principal only for:');
  L.push('');
  for (const e of org.constitution.escalate_immediately) L.push(`- ${e}`);
  L.push('');

  L.push('## How you work');
  L.push('');
  L.push(wrap(a.stance));
  L.push('');
  L.push('**You refuse:** ' + wrap(a.refuses));
  if (a.knows) {
    L.push('');
    L.push(`**You are the meta-specialist for this division.** You do not perform the task — you know ${wrap(a.knows)}, and you deploy the right specialist. Assigning yourself the work is the failure RULE 005 exists to prevent.`);
  }
  if (a.dissents_when) {
    L.push('');
    L.push('**You object when:** ' + wrap(a.dissents_when));
    L.push('');
    L.push('A board only outperforms a single executive if its seats actually object. An objection with no remedy attached is an opinion, so name what would change your position.');
  }
  if (a.knows_reference) {
    // A reference the Principal handed the organization. It is rendered because a field
    // declared in the registry and printed nowhere is a comment — the defect this repo's
    // render tests exist to make impossible.
    L.push('');
    L.push(`**Reference you were given:** ${wrap(a.knows_reference)}`);
  }
  if (a.limitations?.length) {
    L.push('');
    L.push('**Outside your remit:**');
    L.push('');
    for (const l of a.limitations) L.push(`- ${wrap(l)}`);
  }
  L.push('');

  L.push('## Non-negotiable, for every agent here');
  L.push('');
  for (const p of org.constitution.board.principles) L.push(`- **${p.name}** — ${wrap(p.behaviour)}`);
  L.push('');

  L.push('## Gates — stop and hand it to the Principal');
  L.push('');
  L.push('These are the loudest thing this organization does. Crossing one without approval is the single failure that cannot be walked back.');
  L.push('');
  for (const g of org.constitution.gates) L.push(`- **${g.title}** — ${wrap(g.why)}`);
  L.push('');

  L.push(contractBlock(a, org));
  L.push('');
  L.push('## What this workspace has taught the organization');
  L.push('');
  L.push('If `.forge/profile.yaml` or `.forge/overlay.yaml` exists in the working directory, read it first. It is what F.O.R.G.E. has learned about *this* codebase — its stack, its verification command, its house style, and any standing correction the Principal has approved. It outranks your general instinct and is outranked only by the Principal speaking now.');
  L.push('');
  L.push('Nothing in this file names a framework, a vendor or a product. That is deliberate: the organization ships with no domain and learns one. If you find yourself needing domain knowledge that is not in the profile, that is an `OPEN_QUESTIONS` entry, not a guess.');
  L.push('');
  return `${L.join('\n')}\n`;
};

/** The entry-point skill the Principal invokes. */
export const skillMarkdown = (org) => {
  const seats = org.roster.board
    .map((b) => {
      const owns = org.constitution.board.portfolios.find((p) => p.seat === b.id).owns
        .map((d) => org.constitution.divisions.find((x) => x.id === d).name)
        .join(', ');
      return `| **${b.seat}** | ${owns} | ${wrap(b.owns)} |`;
    })
    .join('\n');

  return `---
name: forge
description: "Convene F.O.R.G.E. — a six-seat board, twelve divisions and ${org.all.length - 18} specialists that plans, builds, verifies and reports as one organization, and learns this workspace as it goes. Use for anything larger than a single-file edit."
---

# F.O.R.G.E.

**${org.constitution.meta.expands_to}.**

${wrap(org.constitution.meta.premise)}

North star: **${org.constitution.meta.north_star}**

## The first thing you do

\`\`\`bash
node "$FORGE_HOME/scripts/forge.mjs" plan "<the Principal's request, verbatim>"
\`\`\`

That prints the Campaign Vector: effort mode, which rules fired, the stages, what runs in
parallel, which gates the request crosses, who was staffed and who lost. It is
deterministic and model-free — running it twice gives the same answer, so a wrong route is
a diff against \`registry/routing.yaml\` rather than an argument.

Do not route from memory. The registry is the source of truth and it changes.

## There is no chief executive

| Seat | Divisions owned | Accountable for |
|---|---|---|
${seats}

The Chair convenes, sequences and records. **The Chair breaks no tie.** A deadlocked board
escalates to you, because a deadlock is information about the decision, not an obstacle to it.

## The pipeline, and its gates

1. **Frame** — restate the request as a done-condition. If you cannot write one, that is the blocker.
2. **Design** — decide the shape. Cheap here, expensive after build.
3. **Build** — implement what design specified, and nothing adjacent that looked untidy.
4. **Verify** — evidence of the matching kind. **A Vector that writes and does not verify is refused by the planner.**
5. **Release** — rollback path first, then move.
6. **Deliver** — one brief for the Principal, and what the Archives keep.

**${org.constitution.gates.length} gates stop and wait for a human:** ${org.constitution.gates.map((g) => g.title).join(' · ')}.

## Learning this workspace

\`\`\`bash
node "$FORGE_HOME/scripts/forge.mjs" learn      # read the workspace and the ledger, propose adaptations
node "$FORGE_HOME/scripts/forge.mjs" evolve     # review the proposals
node "$FORGE_HOME/scripts/forge.mjs" evolve --apply P1
\`\`\`

The organization proposes; **you approve**. It may write \`.forge/\` in the workspace and
nothing else — the constitution, the roster and the scripts are outside what evolution may
touch, and that is enforced in code, not promised in a comment.

## Close the ledger — a campaign that reports nothing never happened

The organization only learns from what reaches the ledger. When a campaign ends — a
one-specialist campaign included — record each specialist's outcome with a token estimate:

\`\`\`bash
node "$FORGE_HOME/scripts/forge.mjs" observe --agent <name> --capability <capability> \\
     --outcome ok|partial|fail|blocked --tokens <estimate> --campaign <short-id>
\`\`\`

- A rough token figure attributed to the right agent beats a precise one attributed to
  nobody. Estimate from the work's share of the session.
- A correction from the Principal goes in \`--correction "..."\` on the agent it corrects;
  two of those become a standing-instruction proposal.
- \`blocked\` is recorded too — it is not the agent's failure, and the scorer knows that.

This feeds routing, Spending and Recognition in the Console. Skipping it starves all three.

## Non-negotiable

${org.constitution.board.principles.map((p) => `- **${p.name}** — ${wrap(p.behaviour)}`).join('\n')}
`;
};

/** Write everything. Returns the list of paths written. */
export const build = (org, { apply = false } = {}) => {
  const written = [];
  const files = new Map();
  for (const a of org.all) files.set(path.join(paths.agents, `${a.name}.md`), agentMarkdown(a, org));
  files.set(path.join(paths.skill, 'SKILL.md'), skillMarkdown(org));

  if (!apply) return { written: [...files.keys()], applied: false };

  fs.mkdirSync(paths.agents, { recursive: true });
  fs.mkdirSync(paths.skill, { recursive: true });
  // Remove agents the roster no longer declares. A ghost agent stays dispatchable, which is
  // worse than a missing one: it answers, and nobody knows where the answer came from.
  const expected = new Set([...org.all.map((a) => `${a.name}.md`)]);
  for (const f of fs.existsSync(paths.agents) ? fs.readdirSync(paths.agents) : []) {
    if (f.endsWith('.md') && !expected.has(f)) fs.rmSync(path.join(paths.agents, f));
  }
  for (const [p, body] of files) {
    fs.writeFileSync(p, body);
    written.push(p);
  }
  return { written, applied: true };
};
