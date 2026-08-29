/**
 * The manifest and the CLI must not drift apart.
 *
 * Every command the extension contributes has to exist in the dispatcher, or the palette
 * offers something that errors when clicked. This runs without a VS Code host, which is the
 * point — it is a check that can live in ordinary CI.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const cli = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'forge.mjs'), 'utf8');
const dispatcher = new Set([...cli.matchAll(/^  case '([a-z][a-z-]*)':/gm)].map((m) => m[1]));

const contributed = manifest.contributes.commands.map((c) => c.command);
assert.ok(contributed.length >= 5, 'the extension contributes almost nothing');

for (const id of contributed) {
  const sub = id.replace(/^forge\./, '');
  // `deck` is spawned rather than run-and-shown, but it is still a CLI subcommand.
  assert.ok(dispatcher.has(sub), `the palette offers "${id}" and the CLI has no "${sub}" command`);
}

// The extension must not reimplement anything: it may shell out and render, nothing else.
const ext = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
for (const f of ['resolveContract', 'composeVector', 'runDoctor', 'selectAgents']) {
  assert.ok(!ext.includes(f), `extension.js calls ${f} — a second implementation eventually disagrees with the first`);
}
assert.ok(ext.includes('127.0.0.1'), 'the webview must point at loopback, never a bound interface');

console.log(`ok — ${contributed.length} commands, all present in the CLI, no logic reimplemented`);
