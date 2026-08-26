# F.O.R.G.E. completion for zsh.
#
#   fpath=(/path/to/F.O.R.G.E/completions $fpath); autoload -U compinit && compinit
#
# Like the bash version, names come from `forge roster --json` rather than being baked in,
# so a scaffolded agent is completable the moment it exists.
#compdef forge

_forge_names() { node "${FORGE_HOME:-$HOME/F.O.R.G.E}/scripts/forge.mjs" roster --json 2>/dev/null | grep -o '"name": "[^"]*"' | cut -d'"' -f4 }
_forge_divisions() { node "${FORGE_HOME:-$HOME/F.O.R.G.E}/scripts/forge.mjs" roster --json 2>/dev/null | grep -o '"id": "DIV-[^"]*"' | cut -d'"' -f4 }

_forge() {
  local -a commands
  commands=(
    'plan:compose the Campaign Vector'
    'checklist:what was asked against what was delivered (RULE 014)'
    'verify:re-check EVIDENCE claims against their artifacts (RULE 013)'
    'handoff:the prior agent output block, verbatim'
    'benchmark:reliability leaderboard and regressions'
    'bench-routing:replay the golden routing set'
    'explain:one agent prompt, or the whole system reference'
    'new-agent:scaffold a specialist'
    'board:the six seats and their portfolios'
    'roster:who exists, what they own, what they refuse'
    'doctor:the constitutional audit'
    'audit:semantic health — balance, not structure'
    'burn:where the tokens actually went'
    'ab-test:routed against unrouted'
    'build:regenerate agents and the skill'
    'install:install into ~/.claude'
    'charter:regenerate CHARTER.md'
    'deck:open the Console'
    'context:the session briefing'
    'inbox:messages waiting on you'
    'reply:answer one, as the agent that owns it'
    'observe:record one outcome'
    'learn:read the ledger and propose'
    'evolve:review and approve proposals'
    'instruction:standing instructions, with optional expiry'
    'memory:who is good at what'
    'spend:measured against attributed'
    'overlay:what is in force in this workspace'
    'plugins:validators, hooks and exporters'
    'export:render the ledger through an exporter'
    'decide:record a decision, with the position that lost (P6)'
    'postmortem:what a campaign cost and got wrong'
    'patterns:agent sequences that keep recurring, and whether they work'
    'compare:what a routing proposal would actually change'
    'help:the command surface'
  )
  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi
  case "$words[CURRENT-1]" in
    --agent|--as|--applies-to) compadd $(_forge_names); return ;;
    --division) compadd $(_forge_divisions); return ;;
    --outcome) compadd ok partial fail blocked; return ;;
    --status) compadd SUCCESS FAILED BLOCKED; return ;;
    --mode) compadd direct focused standard campaign; return ;;
    --grade) compadd EVIDENCE INFERENCE UNKNOWN; return ;;
    --arm) compadd with-forge without-forge; return ;;
    --by) compadd capability agent campaign outcome; return ;;
    --model) compadd lean standard deep; return ;;
  esac
  case "$words[2]" in
    explain) compadd --all $(_forge_names) ;;
    roster) compadd --json $(_forge_divisions) ;;
  esac
}
_forge "$@"
