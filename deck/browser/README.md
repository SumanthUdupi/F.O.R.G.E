# Browser tests for the Console

Two layers, testing different things. Neither replaces the other.

| | `deck/e2e.js` | `deck/browser/console.spec.mjs` |
|---|---|---|
| Runs | in-page, via `?e2e=1` | Playwright, headless Chromium |
| Cost | free, no install | needs a browser on the machine |
| Catches | wiring, state, API shape | rendering, layering, real click targets |
| In CI | yes | no — see below |

## Why both

`e2e.js` asserts that the Console's parts are wired up. It cannot see pixels, and two real
defects shipped past it precisely there:

1. The theme toggle was **visible, enabled, and unclickable** — the drawer is `position:
   fixed` full height and covered it. Every property assertion passed. Playwright reported
   "drawer intercepts pointer events", which is the only way to find that.
2. Dark mode reached the HUD and the drawer and **not the canvas office floor**, because a
   `<canvas>` has no elements to compute styles for. It is one bitmap that knows only what it
   is told, and `office.js` was still hardcoding a light palette.

A property assertion is not a visibility assertion, and neither is a substring check on
served HTML.

## Running it

Playwright is NOT a dependency of this repo and never will be — zero dependencies is
load-bearing, and CI has no `npm install` step so the day one creeps in is visible. Point the
spec at any Playwright already on the machine:

```bash
forge deck --port 7801 &
PLAYWRIGHT=/path/to/node_modules/playwright node deck/browser/console.spec.mjs
```

It skips with a clear message rather than failing when Playwright is absent, so this is safe
to leave in a repo where most people will never run it.

## Why it is not in CI

Adding it would mean installing a browser in the pipeline, which is a dependency wearing a
different hat. The tradeoff taken here: CI proves the organization is constitutional and the
logic is correct on 3 OS × 3 Node; the browser layer is run by hand when the Console changes.
If the Console starts changing weekly, revisit this — the reasoning, not the conclusion, is
what should carry forward.
