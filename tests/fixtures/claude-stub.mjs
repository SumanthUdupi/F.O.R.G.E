#!/usr/bin/env node
// A stand-in for `claude -p` speaking just enough stream-json for the runner. A node
// script, not shell — the first version was bash and Windows CI could not spawn it.
const args = process.argv.slice(2);
let mode = 'unknown';
for (let i = 0; i < args.length; i += 1) if (args[i] === '--permission-mode') mode = args[i + 1];
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
out({ type: 'system', subtype: 'init', session_id: 'stub-session-123' });
out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] } });
setTimeout(() => {
  out({ type: 'assistant', message: { content: [{ type: 'text', text: `Stub answer in ${mode} mode.` }] } });
  out({ type: 'result', subtype: 'success', num_turns: 2, total_cost_usd: 0.01, duration_ms: 150, result: `Stub answer in ${mode} mode.` });
}, 100);
