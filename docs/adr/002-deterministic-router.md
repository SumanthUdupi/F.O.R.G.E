# ADR-002 — The router is deterministic and model-free

**Status:** accepted.
**Verified by:** `tests/benchmarks/routing-golden.yaml`, replayed in CI.

## The decision

`forge plan "<request>"` is a pure function of the request text, the roster and
`registry/routing.yaml`. No model call. Running it twice gives the same Campaign Vector.

## Why not ask a model which agents to convene

A model-routed plan has two properties that make it unarguable:

1. **It has to be re-run to be explained.** You cannot look at the decision and see why; you
   can only ask again and hope the second answer resembles the first.
2. **The second answer often does not resemble the first.** So a disagreement about a route
   becomes a disagreement about a sample, and there is nothing to fix.

With a deterministic router, a wrong route is a **diff against `routing.yaml`**. The rules
that fired are printed in the output. Someone who thinks the plan is wrong can point at the
line that produced it, change that line, and re-run to see exactly what changed. The argument
converges because it is about a file.

## What adapts, and what does not

The **rules** are the Principal's and are stable. The **weights** are the organization's:
per-agent reliability comes from measured outcomes, and the score multiplies capability match
by that reliability. So the shape of a plan is auditable while the choice of specialist inside
a capability improves with use.

This is why the golden set exists. Because routing has no model call, a frozen set of requests
with expected capabilities and gates is a **real regression test** rather than a sampling
exercise, and it catches "I edited contracts.yaml and production release stopped escalating"
before a release rather than during one.

## The negative assertions matter as much as the positive ones

`expect_no_gate` is not a footnote. A gate that fires on everything is a gate people learn to
click through, and a suite that only checks that gates fire cannot catch a gate becoming noise.

## What was rejected

**Model-assisted routing with a deterministic fallback.** Rejected: two routers means the
explanation depends on which one ran, which loses the property this decision exists to buy.

**Fuzzy/embedding matching on request text.** Rejected for the same reason — it is a model call
wearing a maths costume, and "why did this match" becomes unanswerable.
