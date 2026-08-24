# F.O.R.G.E. in a VS Code tab

Two ways in. Both open the same Console on loopback — the office, mission control, and
every session on the machine — inside an editor tab beside your code.

## The fast way — a task and one keystroke

Copy `.vscode/tasks.json` into any project (or into your user tasks) and:

- **⌘⇧B** → `F.O.R.G.E.: open the office` — starts the Console if it is not running and
  opens it in a VS Code tab.
- The server task keeps running in the terminal panel; the tab is a live view of it.

## The manual way — no files at all

1. Terminal: `node "$FORGE_HOME/scripts/forge.mjs" deck`
2. **⌘⇧P** → `Simple Browser: Show` → `http://127.0.0.1:7717`
3. Drag the tab wherever you want it — beside your code, or its own editor group.

`Simple Browser` ships with VS Code; nothing to install.

## Make it the view you land in

VS Code restores editor tabs, so once the Console tab is open in a workspace it comes back
with the window. To have the server come back too, add the task's
`"runOn": "folderOpen"` (already set in the bundled `tasks.json`) — VS Code will ask once
whether to allow automatic tasks in that folder.

## What you get in the tab

- **The office** — twelve rooms, every specialist at a desk; click a person to talk,
  click a room to work.
- **Mission control** (the elevator, or the `sessions live` pill) — every Claude Code
  session on this machine, what each is doing right now, which specialists each dispatched,
  turns and tokens. Read from the transcripts, so it is true even for sessions this Console
  never started.
- **Ask / Do** — Do spawns a real `claude` run in the chosen workspace and streams it into
  the thread.

## Why a web tab and not an extension

A VS Code extension is the obvious answer and the wrong one for now: it would need a
publishing pipeline, a separate release cadence, and a rewrite of a UI that already works
in every browser. `Simple Browser` gives the same tab for zero new moving parts. If the
Console ever needs editor-native powers — opening a diff, revealing a file in the
explorer — that is the moment an extension earns its keep, and not before.
