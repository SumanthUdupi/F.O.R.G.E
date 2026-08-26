# Maturity

This page exists because the rest of the repository is persuasive, and persuasive is not the
same as proven. Every other document here describes what F.O.R.G.E. does. This one describes
how much reason there is to believe it.

**Updated by hand. If the date below is stale, treat every number on this page as stale too.**

_Last updated: 2026-08-26._

---

## The numbers, as measured

| | |
|---|---|
| First commit | 2026-08-24 |
| Age | **2 days** |
| Ledger rows in this repo's own `.forge/` | 126, spanning 2026-08-24 → 2026-08-26 |
| Tests | 181, all passing |
| CI | 9 jobs — 3 OS × 3 Node versions |
| Dependencies | 0 |
| Real campaigns run by someone other than the author | **0** |
| Workspaces other than the author's it has run in | **unknown — not measured** |

To reproduce the ledger figure in any workspace:

```bash
wc -l .forge/ledger.jsonl
head -1 .forge/ledger.jsonl && tail -1 .forge/ledger.jsonl   # the date range
```

## What those numbers do and do not support

**Supported.** The mechanical layer works and is checked: routing is deterministic and
replayed against a golden set, the constitution is audited by `doctor` on every build and in
CI on three operating systems, the evolution layer physically cannot write outside `.forge/`,
and 181 tests pass. Those are claims about code, and code is what tests can settle.

**Not supported.** That any of it produces better outcomes than working without it. There is
no measurement of that, and the honest reason is that the only measurement that would count —
the same real task done twice, once routed and once not — has not been run. `forge ab-test`
exists so it can be, and it has not been.

Also unsupported: that it holds up under a large ledger (the largest observed is 126 rows
against a design target of 100k), that it survives a roster much beyond 69 agents, or that
anyone other than the author can pick it up from the docs alone.

## What "battle-tested" would require, stated in advance

Naming the bar before the evidence arrives is the only way the bar means anything. This
project may use the word when **all** of the following are true, and not before:

1. **90 days** of continuous use, not 90 days since the first commit.
2. **250+ ledger rows** produced by real campaigns, in **at least 3 distinct workspaces**.
3. **10 paired A/B comparisons** logged via `forge ab-test` — the same real task with and
   without routing, with the result reported whichever way it falls. "No measurable
   difference on small tasks" is a finding, not a failure, and would be published as one.
4. **At least one person other than the author** having run a campaign end to end without
   the author present.
5. **A recorded incident** — something the organization got wrong in real use, with the
   correction that followed. A system with no failure record has not been used hard enough
   to have one.

None of the five is currently met.

## Why this page exists at all

The repository's own first principle is that every claim carries EVIDENCE, INFERENCE or
UNKNOWN, and that an ungraded claim reads as fabricated. A README that says "181 tests · CI
on 3 OS" next to a governance pitch invites a reader to grade the whole thing EVIDENCE, when
only the left half has earned it. Writing the maturity down is the same discipline the
organization applies to its agents, applied to itself.

The single most valuable thing that could happen to this project is not another feature. It
is two weeks of real work run through it, and an honest record of what broke.
