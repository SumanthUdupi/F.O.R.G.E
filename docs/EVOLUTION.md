# How F.O.R.G.E. learns a workspace

The organization ships with no domain. Nothing in `charter/` or `registry/` names a
framework, a vendor or a product, and `forge doctor` fails if one leaks in. What makes an
installation *yours* is measured from use, not configured up front.

This document is the contract for that: what is observed, what is derived, what may be
proposed, and — most importantly — what can never be touched.

---

## The two files, and why they are separate

```
.forge/ledger.jsonl    what happened.   append-only, never rewritten, never compacted
.forge/memory.json     what it means.   derived, deletable, rebuilt from the ledger
```

Keeping the record apart from the conclusion is what makes the learning reversible. If the
scoring model turns out to be wrong, deleting `memory.json` throws away every conclusion and
the next command recomputes from events that are still exactly what was observed. A system
that learns by mutating its only copy of the evidence cannot do that, and cannot be audited
either.

Derivation is a pure function of the rows — same ledger, same memory, no clock, no I/O.
There is a test for it, because a derivation that depends on when it ran is not a derivation.

## Attribution is mandatory

```bash
forge observe --agent backend-engineer --capability backend --outcome fail \
              --correction "bound every query result set"
```

An observation missing `agent`, `capability` or `outcome` is **refused**, not stored as
`unknown`. A ledger full of unattributable rows looks like data and teaches nothing; it is
the specific failure this validation exists to prevent.

`blocked` is not counted against an agent. Being unable to proceed because a gate fired is
not an agent's failure, and scoring it as one teaches the organization to route around the
agents that correctly stop.

## Reliability is smoothed, so luck is not mistaken for skill

```
reliability = (score + 0.7 × 4) / (n + 4)
```

The neutral prior is `0.7`, worth four observations. Three successes give `0.81`, not `1.0`.
An agent has to build a record before the number moves much, which is the difference between
measurement and superstition.

Per-capability rates are tracked separately, and a run of consecutive failures on one class
penalises that class only — an engineer who keeps failing at migrations is not thereby worse
at everything.

## It changes who gets staffed

This is the whole claim, and it is checkable in about thirty seconds:

```bash
forge plan "add an api endpoint"          # backend-engineer, score 0.708
for i in 1 2 3 4 5; do
  forge observe --agent backend-engineer --capability backend --outcome fail
done
forge plan "add an api endpoint"          # integration-engineer — backend-engineer is now 0.111
```

No model was involved in that decision. The score is arithmetic over the ledger.

## What may be proposed

`forge learn` reads the workspace and the ledger and writes proposals. It applies nothing.

| Kind | Triggered by | Proposes |
|---|---|---|
| `instruction` | two or more corrections against one agent | a standing instruction for this workspace |
| `routing` | reliability below 0.55 over four or more observations | de-preferring that agent for its worst class, naming who instead |
| `talent` | a capability requested three times that nobody holds | drafting a candidate specialist |
| `profile` | read from the workspace itself | pinning the verification command, the house indentation |

**Capped at five proposals touching at most three agents per run.** Not because more would
be wrong, but because a review queue nobody reads approves everything — and an evolution
layer whose proposals are rubber-stamped has quietly become a self-modification layer.

Every proposal carries the observation that produced it and a grade. A recommendation with
no traceable observation behind it is the organization guessing.

## What can never be touched

| May write | May never write |
|---|---|
| `.forge/profile.yaml` | `charter/` — the constitution |
| `.forge/memory.json` | `registry/` — the shipped organization |
| `.forge/overlay.yaml` | `scripts/` — including the learner itself |
| `.forge/proposals.json` | `agents/`, `skills/` — build output |

Enforced by `isForbidden()` in `scripts/learn.mjs`, checked by prefix after resolution, and
covering absolute paths and `..` traversal. The test suite plants a proposal against every
forbidden path — including `../../etc/passwd` and `.forge/../registry/roster.yaml` — and
asserts each is refused. A guardrail nobody tried to break is a guardrail whose state nobody
knows.

`applyProposal` also asserts that the only directory created is `.forge/`.

## Approval and withdrawal

```bash
forge evolve                  # review
forge evolve --apply P2       # approve one
forge overlay                 # what is currently in force here
```

Applying records the **prior value** in `.forge/applied.jsonl`. Deleting the block from
`.forge/overlay.yaml` withdraws the adaptation. Article 38: training is reversible, and so is
every other adaptation — an improvement you cannot withdraw is a commitment.

## What the agents actually see

Every generated agent is told, in its own prompt:

> If `.forge/profile.yaml` or `.forge/overlay.yaml` exists in the working directory, read it
> first. It outranks your general instinct and is outranked only by the Principal speaking now.

There is a test asserting that line reaches all 64 agent files — because an adaptation that
is stored and never read is worse than none, since everyone believes it is in force.

## Deliberate limits

- **Nothing is applied automatically.** Article 86: self-improvement is not self-modification.
- **A quiet workspace produces no proposals.** Not every run should produce a change.
- **The organization cannot recruit itself.** A talent gap becomes a *draft*, and the Principal decides.
- **The divisions cannot change.** RULE 001 is checked before anything else runs.
