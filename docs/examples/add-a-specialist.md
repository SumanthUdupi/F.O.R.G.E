# Adding a specialist

Twenty minutes, including the two steps people skip.

## 1. Ask whether you should

```bash
forge roster DIV-ENG          # who already covers this?
forge audit                   # is this division near the RULE 003 ceiling of 10?
```

The most common outcome of this step is **not adding an agent**. If an existing specialist's
`owns` already covers the work, extending that agent is cheaper and routing between two agents
with overlapping ownership is a coin flip. The scaffolder will refuse a >60% overlap anyway;
finding out here is faster.

## 2. Scaffold it

```bash
forge new-agent \
  --division DIV-ENG \
  --name cache-engineer \
  --specialization "Caching layers and invalidation" \
  --owns "What is cached, for how long, and what makes it wrong." \
  --capabilities caching,performance \
  --stance "Treats invalidation as the design, not an afterthought." \
  --refuses "To add a cache with no stated invalidation trigger and no measured hit rate." \
  --model standard --writes true
```

Without `--apply` this prints and writes nothing — read the block first. It refuses outright if:

- `owns` overlaps an existing specialist by more than 60% (RULE 004)
- the division already holds 10 specialists (RULE 003)
- a stance is given with no `refuses` — a stance that cannot make an agent decline is decoration

Re-run with `--apply` to append it to `registry/roster.yaml`.

## 3. The step everyone skips: routing

The scaffolder prints the `routing.yaml` stub because **an agent with no routing rule is
unreachable by any plan.** It exists, it is constitutional, and no request phrasing ever gets
to it.

```yaml
  - id: R-CACHING
    when_any: [cache, caching, invalidation, ttl, memoize]   # words a REQUEST would use
    capabilities: [caching]
    phase: verify
    why: A cache is a correctness problem wearing a performance costume.
```

`doctor` warns "capability supplied but never asked for". Treat that warning as a hard stop.

## 4. Verify, build, prove

```bash
forge doctor                      # refuses if owns/capability/stance rules are broken
forge build --apply               # regenerates the agent AND its manager's team table
node --test tests/*.test.mjs
forge bench-routing               # did adding this change any existing route?
forge plan "invalidate the user cache after writes"   # should now list cache-engineer
```

That last command is the real test. If the agent does not appear, step 3 is wrong.

## Why the manager already knows

Manager prompts are **composed** from the roster at build time — open
`agents/engineering-manager.md` after the build and the new specialist is in its team table
with its `owns` and capabilities verbatim. There is no separate registration step.

This was not always true. For the life of the repo up to 2026-08-26 no manager prompt named a
single specialist, while `docs/EXTENDING.md` claimed they did. It was found by grepping for one.
`tests/render.test.mjs` now asserts every manager names every specialist in its division, so
the promise cannot quietly become false again.

## Why it might not get picked immediately

Reliability starts at the neutral prior (0.7 over 4 observations), so a stronger incumbent in
the same division out-scores a newcomer for the first few campaigns. **This is intended** —
RULE 007, do not assume competence — and it corrects itself as observations accrue.
