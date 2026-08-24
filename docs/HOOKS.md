# The two hooks

F.O.R.G.E. engages automatically through two hooks in `~/.claude/settings.json`. `forge
install` ships the skill and the agents; the hooks are host configuration, recorded here so
a new machine can be wired without archaeology.

Set `FORGE_HOME` in the same file's `env` block, pointing at this repository.

## UserPromptSubmit — the routing gate

Injected into every prompt. One `echo` of a fixed JSON payload whose `additionalContext` is:

> ROUTING GATE (F.O.R.G.E.): unless this is a lookup, a direct question, or a single-file
> edit, invoke the forge skill BEFORE any other tool call, and state the one-line Routing
> declaration. Do not route from memory — run: node "$FORGE_HOME/scripts/forge.mjs" plan
> "\<request\>". It composes the Campaign Vector deterministically from the registry: which
> of the twelve divisions run, in what order, what batches in parallel, and which gates the
> request crosses. There is no chief executive — six board seats own the divisions between
> them, and a deadlock escalates to the Principal rather than being broken by a chair.
> Seven gates stop and wait for the Principal: irreversible actions, production release,
> schema migration, credentials, charter amendment, budget, anything leaving the machine.
> A change that writes must verify — evidence of the matching kind, never a claim of done.
> Every claim carries EVIDENCE, INFERENCE or UNKNOWN. An ungraded claim reads as
> fabricated. When a campaign ends, CLOSE THE LEDGER: record each specialist with node
> "$FORGE_HOME/scripts/forge.mjs" observe --agent \<n\> --capability \<c\> --outcome
> ok|partial|fail|blocked --tokens \<estimate\> --campaign \<id\> — a campaign that reports
> nothing never happened, and Spending, Recognition and routing all starve without it.
> Answer trivial requests directly: convening the organization for a typo costs more than
> the typo.

The ledger clause is what makes the organization self-reporting: every session is told, on
every prompt, that closing the ledger is part of finishing. Spending and Recognition in the
Console, and the routing scorer itself, are all fed by exactly those rows.

## SessionStart — the workspace briefing

```
node "$FORGE_HOME/scripts/forge.mjs" context 2>/dev/null | \
  jq -Rs 'if . == "" then empty else {hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:.},suppressOutput:true} end' \
  2>/dev/null || true
```

`forge context` prints the graded profile, approved adaptations, notable measured
reliability, and any unanswered mail from the Principal — and prints **nothing** for a
workspace the organization knows nothing about, so the `empty` branch matters: a fresh
repository costs zero tokens.

## Rules that kept this from going wrong

- Merge into `settings.json`, never replace it; write beside and rename, so a crash cannot
  leave a half-written file — which silently disables every setting in it.
- Parse the output back before the rename.
- The hook payload is `JSON.stringify`'d twice (once as payload, once for the shell), so
  the quoting is correct by construction rather than by hand-escaping.
