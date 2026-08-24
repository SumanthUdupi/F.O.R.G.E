# Companions — CodeBurn and OmniRoute

Two external tools the Principal asked about, integrated the only way this organization
integrates anything: **detected and explained, never auto-wired.** The Console's Spending
view shows a live status row for each. F.O.R.G.E. runs identically with neither installed.

---

## CodeBurn — the spend deep-dive

**What it is.** A desktop/menu-bar/web dashboard over the same session transcripts
F.O.R.G.E.'s `forge spend` already reads. Same truth, richer lens: trends, forecasts,
model breakdowns, optimize findings, CSV export.

**Install (macOS):**

```bash
brew install codeburn        # CLI + menu bar app
codeburn menubar             # today's spend lives in the menu bar
npx codeburn web             # or the browser dashboard
```

Windows: Microsoft Store or the `.msi` from their releases. Linux: `.deb` / `.rpm` /
AppImage. All four surfaces read files already on your disk — nothing leaves the machine.

**How it meets the Console.** Spending → Companions shows whether it is installed, and
"Open menu bar app" launches it. Division of labour: the Console answers *"which
department and which campaign spent it"* (attribution comes from the ledger, which only
F.O.R.G.E. has); CodeBurn answers *"how is my overall burn trending across every tool"*.

---

## OmniRoute — the free-tier gateway, and how to set it up properly

**What it is.** A local gateway (`localhost:20128`) that aggregates ~42 providers' free
tiers behind one endpoint, with auto-fallback across four price tiers. The pitch is real:
requests that would have burned your Anthropic quota can be answered by other providers'
free models.

**Why F.O.R.G.E. did not embed it** — and won't: a resident service, provider credentials,
and egress to third parties are three constitutional gates in one. It also *changes which
model answers you*, which is a quality decision only the Principal may make. So it runs
beside the organization, wired by you, reversible in one line.

**Set it up:**

```bash
npm install -g omniroute     # boots on http://localhost:20128
omniroute                    # dashboard: http://localhost:20128/dashboard
```

**Wire Claude Code to it — the sidecar pattern, not the global switch:**

```bash
# An opt-in alias. Plain `claude` stays exactly as it is today.
alias claude-free='ANTHROPIC_BASE_URL="http://localhost:20128" \
                   ANTHROPIC_AUTH_TOKEN="<key from the OmniRoute dashboard>" claude'
```

Per their docs: Claude Code uses the gateway ROOT (no `/v1` suffix); OpenAI-style tools
use `http://localhost:20128/v1`.

**Read before you flip anything global:**

1. **It replaces, not supplements.** With `ANTHROPIC_BASE_URL` set, your Pro/Max
   subscription is out of the loop for that session — answers come from whatever tier the
   router lands on. `model: auto` on a free tier is not Opus. Use `claude-free` for bulk
   or low-stakes work; keep plain `claude` for anything that matters.
2. **Terms-of-service gray.** Parts of their own documentation ("stealth", WAF evasion)
   signal that some provider integrations lean on tolerance rather than permission. Free
   tiers move and break. Your account, your call — which is exactly why this is an alias
   in your shell and not a line F.O.R.G.E. writes into your settings.
3. **The Console tells you when it's live.** Spending → Companions probes port 20128 and
   flips the dot when the gateway answers.

**Where the organization already covers the same ground for free:** tier discipline
(overhead never runs deep), token-discipline contracts in all 64 agents, plans that carry
a cost estimate before running, and `forge spend`'s measured-vs-attributed gap.
