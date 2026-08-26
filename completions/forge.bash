# F.O.R.G.E. completion for bash.
#
#   source /path/to/F.O.R.G.E/completions/forge.bash
#
# Agent, division and capability names come from `forge roster --json`, which is why that
# flag exists — a completion script that hardcoded 69 agent names would be wrong the first
# time somebody ran `forge new-agent`. Cached for 60s so tab-completion never waits on a
# process spawn twice in a row.

_forge_cache=""
_forge_cache_at=0

_forge_roster_json() {
  local now; now=$(date +%s)
  if [ -z "$_forge_cache" ] || [ $((now - _forge_cache_at)) -gt 60 ]; then
    _forge_cache=$(node "${FORGE_HOME:-$HOME/F.O.R.G.E}/scripts/forge.mjs" roster --json 2>/dev/null)
    _forge_cache_at=$now
  fi
  printf '%s' "$_forge_cache"
}

_forge_names() { _forge_roster_json | grep -o '"name": "[^"]*"' | cut -d'"' -f4; }
_forge_divisions() { _forge_roster_json | grep -o '"id": "DIV-[^"]*"' | cut -d'"' -f4; }
_forge_capabilities() { _forge_roster_json | grep -o '"capabilities": \[[^]]*\]' | grep -o '"[a-z-]*"' | tr -d '"' | sort -u; }

_forge() {
  local cur prev cmd
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"
  cmd="${COMP_WORDS[1]}"

  local commands="plan checklist verify handoff benchmark bench-routing explain new-agent board roster doctor build install charter deck context inbox reply observe audit burn ab-test learn evolve memory spend overlay instruction plugins export decide postmortem patterns compare help"

  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=($(compgen -W "$commands" -- "$cur"))
    return
  fi

  case "$prev" in
    --agent|--as|--applies-to) COMPREPLY=($(compgen -W "$(_forge_names)" -- "$cur")); return ;;
    --division) COMPREPLY=($(compgen -W "$(_forge_divisions)" -- "$cur")); return ;;
    --capability) COMPREPLY=($(compgen -W "$(_forge_capabilities)" -- "$cur")); return ;;
    --outcome) COMPREPLY=($(compgen -W "ok partial fail blocked" -- "$cur")); return ;;
    --status) COMPREPLY=($(compgen -W "SUCCESS FAILED BLOCKED" -- "$cur")); return ;;
    --mode) COMPREPLY=($(compgen -W "direct focused standard campaign" -- "$cur")); return ;;
    --grade) COMPREPLY=($(compgen -W "EVIDENCE INFERENCE UNKNOWN" -- "$cur")); return ;;
    --arm) COMPREPLY=($(compgen -W "with-forge without-forge" -- "$cur")); return ;;
    --by) COMPREPLY=($(compgen -W "capability agent campaign outcome" -- "$cur")); return ;;
    --model) COMPREPLY=($(compgen -W "lean standard deep" -- "$cur")); return ;;
  esac

  case "$cmd" in
    plan)        COMPREPLY=($(compgen -W "--mode --with-policy --json" -- "$cur")) ;;
    checklist)   COMPREPLY=($(compgen -W "--from --mark --status --evidence --strict --force" -- "$cur")) ;;
    verify)      COMPREPLY=($(compgen -W "--campaign --record --all" -- "$cur")) ;;
    observe)     COMPREPLY=($(compgen -W "--agent --capability --outcome --tokens --campaign --correction --grade --artifacts --raw --trace --hypothesis --task" -- "$cur")) ;;
    explain)     COMPREPLY=($(compgen -W "--all $(_forge_names)" -- "$cur")) ;;
    new-agent)   COMPREPLY=($(compgen -W "--division --name --owns --capabilities --specialization --stance --refuses --model --writes --apply" -- "$cur")) ;;
    roster)      COMPREPLY=($(compgen -W "--json $(_forge_divisions)" -- "$cur")) ;;
    burn)        COMPREPLY=($(compgen -W "--by --top" -- "$cur")) ;;
    ab-test)     COMPREPLY=($(compgen -W "--record --arm --minutes --tokens --satisfaction --tests-passed --note" -- "$cur")) ;;
    instruction) COMPREPLY=($(compgen -W "--add --applies-to --expires" -- "$cur")) ;;
    evolve)      COMPREPLY=($(compgen -W "--apply" -- "$cur")) ;;
    build|charter|install) COMPREPLY=($(compgen -W "--apply --hooks --force" -- "$cur")) ;;
    export)      COMPREPLY=($(compgen -W "--format" -- "$cur")) ;;
    decide)      COMPREPLY=($(compgen -W "--why --for --against --contested --minority --rejected --campaign --stage --grade --last" -- "$cur")) ;;
    postmortem)  COMPREPLY=($(compgen -W "--campaign" -- "$cur")) ;;
    patterns)    COMPREPLY=($(compgen -W "--min" -- "$cur")) ;;
    compare)     COMPREPLY=($(compgen -W "--proposal --prefer --avoid" -- "$cur")) ;;
    deck)        COMPREPLY=($(compgen -W "--port --vscode" -- "$cur")) ;;
    *)           COMPREPLY=() ;;
  esac
}
complete -F _forge forge
