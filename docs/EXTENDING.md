# Extending F.O.R.G.E.

Everything is configuration. You will not write JavaScript to add a specialist, a routing
rule or a gate — and `forge doctor` will tell you, specifically, when what you wrote is
unconstitutional.

The one rule to internalise: **`agents/*.md` is build output.** Editing one works exactly
until the next build and then silently does not.

```bash
# the loop, every time
$EDITOR registry/roster.yaml
node scripts/forge.mjs doctor          # will it be legal?
node scripts/forge.mjs build --apply   # regenerate every agent file
node --test tests/*.test.mjs
node scripts/forge.mjs bench-routing   # did this change an existing route?
```

Or skip the editor entirely — the scaffolder does the same thing and refuses the mistakes:

```bash
forge new-agent --division DIV-ENG --name cache-engineer \
  --owns "What is cached, for how long, and what makes it wrong." \
  --capabilities caching,performance --stance "..." --refuses "..." [--apply]
```

It prints the `routing.yaml` stub you also need, refuses a `owns` that overlaps an existing
specialist by more than 60% (RULE 004), and refuses a division already at the RULE 003
ceiling of 10. See `docs/examples/add-a-specialist.md` for the full twenty-minute walkthrough.

### Does the manager know?

Yes, and it is worth saying exactly why, because for most of this repo's life the answer was
**no** while the documentation said otherwise.

Manager prompts are **composed** at build time from every specialist in the division — open
`agents/engineering-manager.md` after a build and the new agent is in its team table with its
`owns` and capabilities verbatim. There is no separate registration step.

That was not true until 2026-08-26. `grep -c backend-engineer agents/engineering-manager.md`
returned **0**: no manager prompt named a single specialist, and this document told people it
did. Routing still worked — staffing happens in the deterministic router, not in the manager's
head — but a manager reasoning about its own division was doing it blind.
`tests/render.test.mjs` now asserts that every manager names every specialist in its division,
so the claim above cannot quietly become false again.

The failure mode people worry about — "I added an agent and the manager never uses it" — has
three real causes, and none of them is the manager's memory:

1. **You edited `agents/*.md` instead of `roster.yaml`.** The next build overwrote it.
2. **You skipped the routing rule.** The agent exists and no request phrasing reaches it.
   `doctor` warns "capability supplied but never asked for" — treat it as a hard stop.
3. **Reliability starts at the neutral prior** (0.7 over 4 observations), so a stronger
   incumbent out-scores a newcomer for the first few campaigns. That is RULE 007 working, not
   a bug. Confirm the route exists with `forge plan "<a request that should reach it>"`.

---

## Add a specialist

```yaml
  - id: AGT-ENG-007
    name: cache-engineer
    division: DIV-ENG
    role: specialist
    specialization: Caching layers and invalidation
    owns: What is cached, for how long, and what makes it wrong.
    model: standard
    writes: true
    tools: [Read, Grep, Glob, Bash, Edit, Write]
    capabilities: [backend, performance]
    stance: Treats invalidation as the design, not as an afterthought.
    refuses: To add a cache with no stated invalidation trigger and no measured hit rate.
```

Doctor will refuse it if:

- the division would exceed **ten** specialists (RULE 003);
- `owns` overlaps another specialist in the same division by 60% or more (RULE 004) — and it
  compares meaning, not words, so renaming a noun does not evade it;
- there is no `stance`, or a `stance` with no `refuses` — a trait that cannot make an agent
  decline something is decoration;
- a `capability` is listed that no routing rule ever asks for, and it is not declared in
  `governance_capabilities`. An agent nobody can route to is not on the roster in any useful
  sense.

## Add a routing rule

```yaml
  - id: R-CACHING
    when_any: [cache, caching, invalidation, ttl, memoize]
    capabilities: [performance]
    phase: verify
    why: A cache is a correctness problem wearing a performance costume.
```

`why` is required. An unexplained rule gets deleted by the next person to read the file.

Rules name **capabilities**, never agents. Adding a specialist should not mean editing every
rule that could have used it.

## Add a gate

```yaml
  - id: GATE-CUSTOMER-DATA
    title: Anything touching customer records
    matches: [customer record, pii, personal data, gdpr]
    why: The consequence of being wrong here lands on someone who is not in this repository.
```

Then add a test in `tests/planning.test.mjs` proving it fires on the phrasing you mean and
**stays silent** on a phrasing you do not. Both directions. A gate that fires on everything
is a gate nobody reads, and the false-positive test is the one that keeps it useful.

## Add a contract field

Add it to `registry/contracts.yaml` under `base`, a role, or a capability family. It is
inherited by every agent that matches, printed into their prompt by the next build, and
asserted present by `tests/render.test.mjs`.

## Move a division to a different seat

Edit `board.portfolios` in `charter/constitution.yaml`. Doctor checks the partition in both
directions: an orphaned division has no accountable seat, and a division owned twice has two,
which in practice is also none.

You cannot give the Chair the widest portfolio. RULE 012 fails, because at that point you
have a chief executive with extra steps.

## Change divisions

You cannot, and neither can the organization. RULE 001 pins the twelve by id. Changing them
means editing `charter/constitution.yaml` *and* the `CANONICAL_DIVISIONS` list in
`scripts/doctor.mjs` — deliberately two places, so it cannot happen as a side effect of
anything.

## Retarget the model tiers

```yaml
  tier_models:
    lean: haiku
    standard: sonnet
    deep: opus
```

Two lines move the whole roster to another provider. Article 140: the organization names
capability classes; the runtime binds them.

## What doctor checks

| | |
|---|---|
| 12 constitutional rules | each named in `constitution.yaml`, each implemented under that exact name |
| build is in sync | a roster agent with no file, or a file with no roster entry — a ghost agent stays dispatchable |
| every capability reachable | supplied but never asked for, and not declared as governance-only |
| conflicts symmetric | naming real rules, with a stated resolution |
| contracts resolve | all 64 carry every constitutional field |
| character binds | every agent refuses something; every seat names what it objects to |
| channels declared | every bypass of a board seat has a stated reason |
| no domain leaked | no vendor, framework or product name in the shipped configuration |

`forge doctor` **exits non-zero** on a violation, and CI runs it on three platforms. Reporting
a violation and exiting zero would make it a report, and reports get skimmed.
