# ADR-000 — No chief executive

**Status:** accepted, and structurally enforced.
**Enforced by:** `chair_does_not_override` (RULE-012), `board_partition_is_exact` (RULE-011).

## The decision

Six board seats own the twelve divisions in an exact partition. The Chair convenes, sequences
and records. **The Chair breaks no tie.** A deadlocked board escalates to the Principal.

## Why, when every organization chart has a boss at the top

Two reasons, and only the second is the load-bearing one.

**The weak reason** — a single decider is a single point of routing failure. True, and not
very interesting; you could mitigate it with a good decider.

**The real reason** — *a single decider cannot be audited against itself.* If one seat breaks
every tie, then every contested decision has the same author, and the record of why it went
that way is the record of what that seat prefers. There is no counterfactual in the file. With
no tie-breaker, a deadlock has to be written down as a deadlock, with both positions and both
sets of evidence, and handed to the human — so the moment of genuine disagreement is preserved
instead of resolved into a preference.

A deadlock is information about the decision. Breaking it destroys that information cheaply
and permanently.

## What was rejected

**A chief executive seat.** Rejected as above. `chair_does_not_override` checks three separate
things because this is the rule most likely to erode back: the Chair may hold no more divisions
than any other seat, `chair_authority` must actually disclaim tie-breaking in its own words, and
the board contract must give *every* seat a `POSITION` field — a board where one seat votes is
not a board.

**A rotating chair.** Rejected: it makes the tie-break arbitrary rather than absent, which is
worse — it looks principled and is not.

**Majority vote among seats.** Rejected: six seats with unequal portfolios do not have equal
standing on every question, and a majority of the uninvolved outvoting the accountable seat is
how organizations produce decisions nobody owns.

## The cost, stated plainly

Deadlocks reach the human. That is friction by design, and it will occasionally be annoying on
a decision that did not deserve it. The alternative is a system that resolves everything and
teaches you nothing about where it was uncertain.
