<div align="center">

# F.O.R.G.E.

**F**oundry for **O**rganized **R**easoning, **G**overnance and **E**volution

*An agent organization for Claude Code. Six seats, twelve divisions, forty-six specialists.
No chief executive. No dependencies. No domain — it learns yours.*

</div>

---

```
                    ┌──────────────┐
                    │  PRINCIPAL   │   you. ultimate authority, last rung, never bypassed
                    └──────┬───────┘
                           │
        ┌──────────────────┴──────────────────┐
        │            THE BOARD  ×6            │   no CEO. the Chair convenes and records;
        │  Chair · Works · Ledger · Workforce │   it breaks no tie. deadlock escalates.
        │        Intent · Memory              │
        └──────────────────┬──────────────────┘
                           │ each seat owns a portfolio, exactly once
        ┌──────────────────┴──────────────────┐
        │          12 DIVISIONS               │   immutable. the system may not add,
        │  one manager each, 3–10 specialists │   remove, merge or rename one.
        └──────────────────┬──────────────────┘
                           │
        ┌──────────────────┴──────────────────┐
        │          46 SPECIALISTS             │   each owns one checkable responsibility
        │  each refuses something specific    │   and refuses something specific
        └─────────────────────────────────────┘
```

## Why not just one orchestrator agent

Because a single executive agent is what every multi-agent system becomes by default, and
it fails in three ways that are hard to see from inside:

- **It routes badly.** It has no portfolio, so it has no reason to prefer one specialist over another.
- **It cannot be audited.** Its reasoning is one undifferentiated stream. "Who decided this?" has no answer.
- **Its mistakes are invisible.** There is no second seat with standing to object.

Six accountable seats produce what one cannot: a decision has an **owner**, a bad decision
has a **dissenter on the record**, and a cross-portfolio call has a **procedure** instead of
a mood.

> **The launch page:** [readme.html](./readme.html) — open it locally or on Pages. What was
> studied, absorbed and refused from six external repos: [docs/STUDIES.md](./docs/STUDIES.md).

## Install

```bash
git clone https://github.com/SumanthUdupi/F.O.R.G.E.git
cd F.O.R.G.E
node scripts/forge.mjs doctor                     # the constitutional audit. must be clean.
node scripts/forge.mjs install --apply --hooks    # 64 agents + /forge skill + the two hooks
```

`--hooks` merges the routing gate and the session briefing into `~/.claude/settings.json` —
merge, never replace; atomic write; idempotent, so refreshing after `git pull` is the same
command. Restart your session afterwards and type `/forge`.

Node 18+. Nothing else — no `npm install`, no lockfile, no runtime dependency. `forge
doctor` runs on a machine that has never seen this repository before, which is the machine
where a constitutional violation matters most.

## Use

```bash
forge plan "add rate limiting to the public api and deploy it"
```

```
CAMPAIGN VECTOR
request   add rate limiting to the public api and deploy it
mode      STANDARD — Normal development across a few files.
selected  no scale signal; defaulted; raised to standard because GATE-RELEASE fires

GATES — the campaign stops here and waits for you
  GATE-RELEASE  Production release  (matched "deploy")
      The blast radius is other people.

STAGES  8 across 5 phases

  FRAME  Establish what done means before anyone spends a token on getting there.
    [sequential]
      S01  intent-analyst           Directorate          standard  reads   score 0.7082

  BUILD  Implement exactly what design specified, and nothing adjacent that looked untidy.
    [sequential]
      S02  backend-engineer         Engineering          standard  writes  score 0.7082

  VERIFY  Produce evidence of the matching kind. A claim without one is UNKNOWN.
    [parallel x3]
      S03  security-reviewer        Adversarial QA       deep      reads   score 0.6782
      S04  code-reviewer            Adversarial QA       deep      reads   score 0.81
      S05  test-engineer            Adversarial QA       standard  writes  score 0.7082

  RELEASE  Establish the rollback path, then move. Never the other way round.
    [sequential]
      S06  build-engineer           Release Operations   standard  writes  score 0.7082
            GATE GATE-RELEASE — stop here

  DELIVER  One brief for the Principal, and what the Archives keep from this campaign.
    [parallel x2]
      S07  decision-recorder        Directorate          lean      writes  score 0.7482
      S08  result-synthesizer       Principal Desk       standard  reads   score 0.84

RUNNERS-UP  who else could have taken each stage
  backend: integration-engineer 0.7082, refactor-surgeon 0.6498
  release: repository-steward 0.7082, observability-engineer 0.7082
  capture: knowledge-curator 0.7082, failure-archivist 0.7082
  report: approval-framer 0.7082, documentation-writer 0.7082
```

*Real output, with the per-stage `owns:` lines trimmed for width.*
**Deterministic and model-free.** Same request, same plan, every time. A wrong route is a
diff against `registry/routing.yaml`, not an argument with a model.

## Two rooms: the Console and the Ops deck

```bash
forge deck        # http://127.0.0.1:7717
```

**One surface, by the Principal's direction.** The Console — warm paper, plain words, one
decision per card, for someone who never wants to see a JSON key. The dense instrument
panel it replaced is gone; everything it showed lives here, one disclosure deeper instead
of all at once. Zero dependencies, loopback only.

| Console view | What it does |
|---|---|
| **Home** | **The Office** — your organization drawn as the place it is: twelve rooms around the board's hex table (no head chair), every specialist at a desk, live lamps per department, envelopes hanging at the door where mail waits, typing animation where a run is working, a flame over a streak-holder's desk, and a courier walking your message over when you send. Click a room to open the department, click a person to chat with them. Canvas 2D, zero dependencies, honest with reduced-motion. Below it: what needs your decision, with the Approve button. |
| **Chat** | Write to any seat, manager or specialist — and choose **Ask** (answers only, plan mode, cannot write) or **Do** (a live work order: the Console spawns Claude Code headlessly in the workspace, streams the run into the thread, and files the answer as a reply). Your auth, hooks and gates all apply, because it *is* Claude Code underneath. No runtime available? The message queues as mail and the next session delivers it — the thread reads the same either way. |
| **Ideas** | One textarea, straight to the Discovery Lab, answers threaded underneath. |
| **Repos to study** | Paste a GitHub link and what you want from it. The Lab reverse-engineers it and reports back before anything is copied in. |
| **Plans** | Type what you want; see who would work on it, in what order, where it pauses for you — and what it should roughly cost, estimated from this workspace's own measured history. No history, no number: an invented estimate is worse than none. |
| **The team** | The six seats and their departments with live status dots; every specialist opens to what it owns, what it refuses and its measured reliability. Below: the seven gates in plain words, the ten principles, and a one-button constitutional health check. Recognition is derived from real outcomes, so it can be earned and never granted. |
| **Spending** | Two labelled numbers: **measured** — provider-reported usage read from the session transcripts, cache reads listed apart — and **attributed** — what campaigns reported about themselves, by department, agent and campaign. The gap is named: work that never closed its ledger. |
| **Sessions** | Your real Claude Code sessions, read from the transcripts — when each started, turns, tokens, and a live badge on the active one. Places the organization has worked sit below, switchable; `?ws=` is validated against the registry. |

The mailbox is one append-only file with three lenses — a chat message, an idea and a repo
intake are the same row with a different `kind`. Unanswered mail rides the session
briefing, which means delivery is guaranteed by the same mechanism that already starts
every session, and an answered message is never re-delivered.

### It is not a second way to start work


The deck shows what the organization knows and lets you approve a proposal. It does not
dispatch agents — that belongs to the host runtime, and a second thing that can start work
is a second thing that can start work nobody asked for.

## It learns your workspace

The organization ships with **no domain**. There is no framework, vendor or product named
anywhere in the shipped configuration, and `forge doctor` fails if one leaks in. What makes
it *yours* is measured, not configured.

```bash
forge observe --agent backend-engineer --capability backend --outcome fail \
              --correction "bound every query result set"
forge learn
```

```
── what this workspace is ──────────────────────────────────
  stacks         typescript      EVIDENCE   tsconfig.json present
  testCommand    npm test        EVIDENCE   package.json scripts.test = vitest run
  indent         2               EVIDENCE   1,204 of 1,281 lines, across 40 files

── proposals — capped at 5, touching at most 3 agents ──────
  P1  [instruction]  append a standing instruction to backend-engineer
      because  5 corrections recorded against backend-engineer  (EVIDENCE)
  P2  [routing]      de-prefer backend-engineer for "backend" here
      because  scored 0.31 over 5 observations  (EVIDENCE)
      prefer instead: integration-engineer, refactor-surgeon

  Nothing was applied. `forge evolve --apply <id>` is the only way anything changes.
```

Routing then actually moves — `backend-engineer` drops from **0.708** to **0.111** and loses
the stage. That is a real number from the real scorer, not an illustration.

### What evolution may touch, and what it may not

| May write | May never write |
|---|---|
| `.forge/profile.yaml` — what this workspace is | `charter/` — the constitution |
| `.forge/memory.json` — who is good at what, measured | `registry/` — the shipped organization |
| `.forge/overlay.yaml` — approved deltas, per workspace | `scripts/` — including the learner itself |
| `.forge/proposals.json` — what it would like to change | `agents/`, `skills/` — build output |

Enforced in code and **tested by attacking it** — the suite plants a proposal against every
forbidden path, including `../../etc/passwd`, and asserts each is refused. A guardrail
nobody tried to break is a guardrail whose state nobody knows.

Every applied adaptation records its prior value in `.forge/applied.jsonl`. An improvement
you cannot withdraw is a commitment.

## What stops it doing something stupid

**Seven gates** hand control back to you: irreversible actions · production release · schema
migration · credentials · charter amendment · budget · anything leaving the machine.
Deliberately few — a gate that fires on everything is a gate nobody reads. `drop table
audit_log` fires one; `drop the trailing comma` does not, and there is a test for both.

**A Vector that writes must verify.** Not a keyword rule — a structural invariant. Nothing in
your request has to say "test" for a change that edits files to need evidence that it works.
The planner refuses to emit one.

**Every cap is reported.** When effort mode trims a plan, the dropped stages are named with
the reason. Silent truncation reads as complete coverage, which is the most expensive lie a
planner can tell. The frame and your brief can never be trimmed.

**Managers cannot write.** RULE 005 is structural in two places that must agree: no manager
or board seat holds `Edit`/`Write`, and the router excludes them from staffing. Doctor
checks both, and it greps the router source — because declaring the rule and then staffing a
manager anyway is exactly the drift it exists to catch.

## Verify it yourself

```bash
node scripts/forge.mjs doctor    # 12 constitutional rules + 6 hygiene checks
node --test tests/*.test.mjs     # 163 tests
```

```
  PASS  RULE-001  all twelve divisions present, none added, none renamed
  PASS  RULE-005  no board seat or manager holds a write tool, and the router staffs specialists only
  PASS  RULE-011  6 seats own 12 divisions, exactly once each
  PASS  RULE-012  the Chair convenes, records and escalates — it does not outrank a seat
  PASS  every_agent_resolves_a_contract  all 64 agents carry every constitutional field
  PASS  character_binds_behaviour  every agent refuses something specific
  PASS  no_domain_leaked_in  shipped configuration is domain-free
  HEALTHY — 0 failures, 0 warnings, 64 agents, 12 divisions
```

The doctor tests work by **breaking the organization** — each one plants the specific
violation its rule exists to catch and asserts the failure. Asserting that a healthy org
passes proves nothing; an empty function passes too.

## The design rule this repo is built around

> **A field declared in the registry and rendered nowhere is a comment, not a protocol.**

It is trivially easy to add a field to a config, believe it is in force, and never render it
into a single prompt. It parses. The audit sees it. The docs describe it. No agent was ever
told. `tests/render.test.mjs` asserts that every declared field — stance, refusal, team
knowledge, dissent trigger, every contract key, every gate, every principle, the escalation
ladder — reaches the built agent file. `CHARTER.md` is generated from the constitution and
asserted against it, so stale documentation fails CI instead of misleading a reader.

## Layout

```
charter/constitution.yaml   12 rules, 12 divisions, the board, 7 gates, the protocol
registry/roster.yaml        64 agents — each with what it owns and what it refuses
registry/routing.yaml       28 rules, 4 effort modes, the scoring weights
registry/contracts.yaml     output contracts, composed once, inherited by all 64
agents/*.md                 BUILD OUTPUT. edit the registry, run `forge build --apply`
scripts/                    yaml · core · router · vector · ledger · learn · doctor · render · deck
deck/                       the Console — the only surface
tests/                      163 tests, node:test, zero dependencies
```

## Commands

| | |
|---|---|
| `forge plan "<request>"` | compose the Campaign Vector |
| `forge board` | the six seats, their portfolios, what each objects to |
| `forge roster [division]` | who exists, what they own, what they refuse |
| `forge doctor` | the constitutional audit. non-zero exit on any violation |
| `forge observe` | record one outcome in this workspace's ledger |
| `forge memory` | who is good at what, measured |
| `forge learn` | read the workspace, propose adaptations. applies nothing |
| `forge evolve --apply <id>` | approve one. the only way anything changes |
| `forge build --apply` | regenerate `agents/` from the registry |
| `forge install --apply` | install into `~/.claude` |
| `forge deck` | the Console + Ops deck, on loopback |
| `forge inbox` / `forge reply` | mail from the Principal, and how the org answers it |
| `forge context` | the session briefing — silent when nothing is known |
| `forge spend` | measured spend (from transcripts) beside the attributed ledger |
| `forge inbox` | mail from the Principal waiting for an answer |
| `forge reply <id> --as <agent>` | answer it, as the agent that owns the question |

## Lineage

Built from a 169-article organizational constitution and a board specification. Three things
in that source were deliberately changed rather than copied:

1. **The chief executive is gone.** The source made one seat own "the entire organization",
   which makes every ownership question unanswerable. Ownership here is an exact partition,
   and doctor fails on an overlap or an orphan in either direction.
2. **Contracts are composed, not authored.** The source hand-writes an output contract for
   each of its six executives and gives none to the specialists — who emit most of the
   messages and are the ones whose output has to be machine-checkable. Here they are defined
   once by role and capability family, and all 64 agents inherit one.
3. **Personality has to bind.** "Calm", "disciplined", "curious" are adjectives no reader can
   act on. Every agent here declares what it **refuses**, every seat declares what it
   **objects to**, and doctor fails a stance that comes without one.

## License

MIT.
