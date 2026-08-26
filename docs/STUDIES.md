# External studies — what was taken, what was refused, and why

Six repositories, freshly cloned and dissected at the Principal's direction, plus the final
sweep of the original design folder. Every verdict is also threaded in the Console's
**Repos to study** view. The standing rule: a mechanism comes in only if it survives the
constitution — zero dependencies, no resident services, no vendor keys, determinism where
determinism is claimed.

| Repo | Size at study | Verdict | What F.O.R.G.E. got |
|---|---|---|---|
| **OmniRoute** | 12,869 files | **Adapted** | Not the gateway (resident service + credentials + egress — three gates in one). The idea underneath: plans now show **rough cost before running**, computed from this workspace's own measured history. `forge plan` and the Plans view both carry it, and with no history they say so instead of inventing a number. |
| **hermes-agent** | 10,190 files | **Parity by convergence** | Its learning loop (skills from experience, self-nudged persistence, searchable past) maps onto the ledger, learn/evolve, the Archives and the close-the-ledger duty. One deliberate difference kept: Hermes creates skills autonomously; here Talent drafts and the Principal approves — RULE 006. |
| **caveman** | skill + proxy | **Adopted (the durable half)** | Token discipline is now contract law in all 64 agents: no preamble, no restating, artifacts by path, say it once — with the counterweight that compression never outranks precision. The proxy half (33.2% input cut) is a resident wrapper: refused on the same grounds as every gateway. Its own HONEST-NUMBERS doc — the skill costs ~1–1.5k input tokens per turn — is why the discipline lives in contracts that were already rendered, at zero added cost. |
| **morph-claude-code-plugin** | 47 files | **Rejected** | Paid compaction API whose own README calls its injection method "not fool proof". The goal it chases — context that survives compaction — F.O.R.G.E. already has free: the SessionStart briefing re-injects profile, overlay, reliability and unanswered mail from files, deterministically. |
| **codeburn** | 942 files | **Adopted (the insight, not the app)** | The transcripts already record provider-reported usage — a spend view built on estimates leaves the truth on disk. `forge spend` and the Spending view now show **measured** (from transcripts, cache reads listed apart) beside **attributed** (from the ledger), and name the gap: work that never closed its ledger. Verified against 108 real sessions. |
| **ruflo** | 5,632 files | **Rejected, kept as benchmark** | 314 MCP tools and three npm packages on the maximal bet; F.O.R.G.E. is the opposite bet — a router you can diff, zero dependencies, a constitution that fails the build. Every capability checked had a leaner equivalent already present. |

## The original design folder, final sweep

- **comms.md** (hybrid local-router + TOON wire protocol): the local Ollama switchboard is a
  resident service — refused. What it wanted — token-minimal structured agent messages and a
  "check memory before waking the expensive model" — exists as the output contracts, the
  token-discipline rules, and the Archives-first principle (P3).
- **interaction1.md** (interaction ideas): approvals-as-cards, health gauge, one-click
  corrections, explainability and proactive summaries are all in the Console — Home's
  Needs-You cards, the health check, `--correction`, the Plans view's who/why/pauses, and
  the What-happened digest.
- **frontend1.md / theme.md**: superseded by the shipped Console; the Industrial Sapphire
  language survives in the brand mark.
- **BOARD_MEMBERS-1.md**: absorbed earlier — it became the six-seat board, with its three
  defects deliberately fixed (exact ownership partition, composed contracts for all 64
  agents, personality that binds).

Cloned studies are disposable by design: the knowledge lands here and in the Console
threads; the clones themselves live in a session scratchpad and are not kept.

---

## n8n as the orchestrator — rejected, with one narrow use kept

**Rejected as an orchestrator.** n8n is a resident workflow-automation service, and using it
to drive campaigns would break three things at once:

- **A resident service.** Already rejected once, for OmniRoute's gateway, on the same grounds.
  Zero dependencies and zero resident processes is load-bearing here, not aesthetic: CI has no
  `npm install` step precisely so the day one creeps in is visible.
- **State outside the ledger.** Workflow state living in n8n means the single source of truth
  is split, and the moment it is split the learning stops being reversible — you can no longer
  throw away every conclusion and recompute from the events, because some of the events are
  somewhere else.
- **A thing to keep patched and running.** The project bet against that.

**Kept, narrowly: n8n as a doorbell.** Triggering F.O.R.G.E. from something genuinely external
— a GitHub webhook, a cron, a Slack command — is not orchestration logic, it is an event
source, and n8n is fine at it:

```
Webhook (PR opened) → Execute Command: forge plan "review PR #{{$json.number}}" → post the Vector
```

n8n never sees agent state, never writes the ledger, never makes a routing decision. It is a
doorbell, not a brain.

**And if you do not already run n8n, do not add it for this.** A cron entry or a GitHub Action
does the identical job with one less moving part and nothing new to secure. This is written
down as a decision rather than a task because the right amount of work here is usually zero.

## Shipping a demo `.forge/` — decided against

The question: should a fresh clone include an example learned state, so a new reader can see
what a matured installation looks like?

**No.** The cost is not the disk space, it is that a demo ledger is indistinguishable from a
real one at a glance, and the first thing anyone would do is read numbers off it. `forge
benchmark` on a fresh clone currently says *"the ledger is empty. This is honest rather than
useful: there is no starting number to invent."* Shipping a demo would replace that sentence
with a number, and the number would be fiction with a plausible shape — the exact failure
RULE 007 exists to prevent, committed deliberately.

If it is ever revisited, the constraints agreed here are: it lives at `examples/.forge-demo/`
and never at `.forge/`; `release-guard.yml` continues to refuse the real path; and a doctor
check asserts the demo contains no real workspace paths, timestamps or agent-authored content
from a private machine. Until someone wants it enough to build those guards, the empty state
is more honest than the illustrative one.
