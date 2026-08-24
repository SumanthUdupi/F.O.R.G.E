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
