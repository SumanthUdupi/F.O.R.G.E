# ADR-001 — The ledger is append-only, and memory is derived

**Status:** accepted.
**Enforced by:** `observe()` only appends; `derive()` is a pure function of the rows.

## The decision

Two files, and the difference between them is the whole design:

```
.forge/ledger.jsonl   what happened. Append-only. Never rewritten, never compacted.
.forge/memory.json    what it means. Derived. Deletable at any time and rebuilt.
```

## Why not just keep a running score

Because then the score is the only copy of the evidence, and a bug in the scoring model is
unrecoverable. You would discover that reliability had been computed wrong for a month and
have no way to recompute it — the inputs would have been folded away.

Keeping them separate means the learning is **reversible**: if the scoring model turns out to
be wrong, throw away every conclusion and recompute from the events, which are still exactly
what was observed. A system that learns by mutating its only copy of the evidence cannot do
that, and cannot be audited either.

`derive()` takes no clock and does no I/O for exactly this reason: replaying a ledger must
reproduce byte-identical memory, or a derivation is a story about the past rather than a
function of it.

## The consequence people find surprising

**A cache is allowed; a mutation is not.** `derivedMemory()` memoises the fold and invalidates
on the ledger's `size:mtime`. That is not a violation of this ADR — the cache is deletable at
any moment and its key proves it is current. The rule is that nothing may become the only copy
of something the ledger recorded.

Similarly, a spot-check does not edit the row it judged. It **appends a row about it**, with
`kind: 'spotcheck'`, which `derive()` counts into evidence accuracy and pointedly not into
reliability.

## What was rejected

**A database.** Zero dependencies is load-bearing; CI has no `npm install` step so the day one
creeps in is visible. JSONL is append-safe under concurrent writers by construction (line-based,
order-independent), which is most of what a database would have been bought for here.

**Compaction.** Rejected: the ledger's value is that it is complete. If size ever becomes a
real problem the answer is archival sharding by year with the archive still readable, not
discarding rows. See `docs/SCALING.md`.
