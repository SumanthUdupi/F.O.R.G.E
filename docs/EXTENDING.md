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
node scripts/forge.mjs build --apply   # regenerate the 64 agent files
node --test tests/
```

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
