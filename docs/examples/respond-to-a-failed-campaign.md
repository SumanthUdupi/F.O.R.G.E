# Responding to a failed campaign

A campaign went wrong. The goal is not to assign blame — it is to leave the Archives
measurably different, or explain why not (P10).

## 1. Record what actually happened, including the failure

```bash
forge observe --agent backend-engineer --capability backend --outcome fail \
  --tokens 24000 --campaign C-0812 \
  --correction "shipped without a rollback path; the deploy could not be withdrawn"
```

Record it as `fail`. A failure logged as `partial` is the thing this organization exists to
stop, and it poisons routing for every later campaign — the scorer cannot un-learn a lie.

`blocked` is different and is recorded too: it is not the agent's failure and the scorer knows
it, so a blocked stage never moves reliability.

## 2. Check what was actually claimed

```bash
forge verify --campaign C-0812
```

This re-checks every EVIDENCE claim that named a file or a command. A claim that said a file
changed and the file does not exist is `contradicted` — that is a different and more serious
problem than the task failing, because it means the record is wrong rather than the work.

```bash
forge verify --campaign C-0812 --record
```

Writes the verdicts back. They move `evidence.accuracy` and never reliability, so being
audited is never mistaken for doing work.

## 3. Check the campaign actually closed

```bash
forge checklist C-0812 --strict
```

Non-zero exit means an item was never given a terminal status — the campaign did not fail, it
was abandoned partway and reported as if it had finished. That is RULE 014, and it is the most
common failure mode in multi-agent systems.

## 4. Find out whether it is a pattern

```bash
forge benchmark --regression   # is this agent getting worse, or was this one bad day?
forge burn --by campaign       # what did the failure cost?
forge audit                    # is one agent carrying too much of everything?
```

One failure is noise. Two corrections on the same agent become a standing-instruction proposal
automatically:

```bash
forge learn      # reads the ledger; proposes; applies nothing
forge evolve     # ranked by measured impact — the share of work each change touches
forge evolve --apply P1
```

## 5. What you should NOT do

**Do not edit the agent's prompt in `agents/`.** It is build output and the next
`forge build --apply` overwrites it with no warning. Standing instructions belong in the
overlay, which is what `forge evolve --apply` writes and what deleting the entry withdraws.

**Do not delete the failing rows.** The ledger is append-only. A history you curate is a
history you cannot audit, and the failure record is what stops the next campaign paying to
rediscover this.
