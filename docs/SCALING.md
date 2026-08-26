# Scaling

What breaks first, at what size, and what to do about it. Written from measurement where
measurement exists and marked UNKNOWN where it does not — a scaling guide that guesses is
worse than none, because it gets planned against.

_Measured against `~/F.O.R.G.E` at 69 agents, 12 divisions, a 126-row ledger._

---

## The three axes

Growth happens along three axes and they fail differently:

| Axis | Today | Where it is designed to go | What breaks first |
|---|---|---|---|
| **Roster** | 69 agents, 51 specialists | ~200 | RULE 003's 3–10 band forces new divisions, and divisions are immutable |
| **Ledger** | 126 rows | 100k+ | the derivation, which is O(rows) — mitigated, see below |
| **Campaign** | ≤14 stages | unchanged | attention, not compute |

---

## Roster: the constitutional ceiling is real

`RULE-003` holds every division at 3–10 specialists, and `RULE-001` makes the twelve
divisions immutable. That is a hard ceiling of **120 specialists**, and it is a feature: a
thirteenth division would need a constitutional amendment, which is a gate, which means a
human decides rather than a roster quietly sprawling.

**The failure that arrives before the ceiling is `owns` collision.** At 51 specialists the
RULE 004 similarity check already refuses new entries that overlap an existing one by >60%.
As the roster fills, that check refuses more often, and the refusal is correct — it means the
capability is already owned and the work belongs to an existing specialist.

```bash
forge new-agent --division DIV-ENG --name ... --owns "..."   # refuses on overlap, with the clash named
forge audit                                                  # names divisions at the floor or near the ceiling
```

**What we know:** load + cross-reference at 69 agents is imperceptible; `core.load()` runs
several times a second in the test suite. **UNKNOWN:** the shape of the curve past ~200. The
index below removes the one obviously superlinear path, but nobody has run it at that size.

## Ledger: the derivation is the hot path, and it is cached

`derive()` folds every row on every call, and it used to be called on every CLI invocation
including the per-turn routing path. At 126 rows that is free. At 100k it would not be.

**Mitigated:** `derivedMemory()` memoises the fold and invalidates on the ledger's
`size:mtime` — a `stat`, not a read. Two layers, because the callers have opposite lifetimes:
an in-process `Map` for the long-lived Console, and `.forge/.memory-cache.json` for the CLI,
which exits after every command.

The cache is provably safe to delete at any moment. Deleting it forces a recompute, which is
the same reversibility `memory.json` already has.

**Still unmitigated at very large sizes:** the first cold read after an append is still O(rows).
If a ledger reaches the point where that read is felt, shard it by year:

```
.forge/ledger.2025.jsonl
.forge/ledger.2026.jsonl
```

and derive over the live year plus a stored index of the archived ones. **This is not built.**
It is written down because the shape of the fix matters more than having it early, and at 126
rows building it now would be complexity ahead of its second case (P9).

## Routing: indexed, and the index is proven behaviour-neutral

`selectAgents()` filtered the whole roster per capability — O(roster × capabilities). It now
takes `org.byCapability`, built once during `load()`.

The important property is not the speed, it is that **the rankings are identical**. There is a
test that runs both paths over every capability and asserts the staffed set, the scores and
the runners-up all match, so this is a pure performance change and can be verified as one
rather than trusted as one.

## Parallel width, and why it is not adaptive

`circuit_breakers.parallel_width: 6` is a fixed number. A tempting improvement is to scale it
by remaining budget. It is deliberately not built: parallel width is a governance limit about
how much work can be in flight without a human able to follow it, not a throughput knob.
Scaling it by budget would mean a well-funded campaign gets less oversight, which is exactly
backwards.

If throughput becomes the constraint, raise the number in the constitution — a visible,
reviewable, one-line amendment — rather than making it depend on something invisible.

## Prompt size: bounded, with a check

Every agent file is build output composed from the roster plus the resolved contract, so **one
line added to `contracts.yaml`'s base block lands in all 69 files at once** and is paid on
every dispatch forever. Two checks bound this:

- `agent_prompt_size_bounded` — 12000 bytes per rendered prompt (largest today: ~9.2KB)
- `contract_field_count_bounded` — 20 required fields per resolved contract (heaviest: 17)

Both are preventive: nothing violates them today. They exist because `EXTENDING.md` actively
encourages adding contract fields, so the growth path is documented, not hypothetical.

## Contract weight scales with the request

`by_mode` in `contracts.yaml` reduces the required-field set for `direct` and `focused`
requests (17 → 3 and → 4 respectively) while leaving `standard` and `campaign` untouched.
Trimmed fields become optional rather than forbidden, so nothing is lost — the cost is matched
to the stakes rather than the rigour being reduced.

## What to watch, in order

```bash
forge audit                  # a division nobody uses, a capability with no depth, load imbalance
forge burn --by capability   # where the tokens actually go
forge benchmark --regression # who is getting worse before they cross the floor
wc -l .forge/ledger.jsonl    # the one number that predicts the next bottleneck
```

## The honest summary

Nothing here has been run at the sizes it is designed for. The superlinear paths have been
removed and the growth traps have checks, but **every number in the "designed to go" column is
an intention, not a measurement.** The first person to run this against a 10k-row ledger will
learn more than this page contains, and should replace this paragraph with what they found.
