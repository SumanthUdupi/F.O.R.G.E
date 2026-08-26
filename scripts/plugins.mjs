/**
 * Extension points — three of them, each with a hard boundary.
 *
 * An organization that cannot be extended gets forked, and a fork stops receiving the
 * constitutional checks that make it trustworthy. So there are supported seams. Each one is
 * shaped by the same question: what is the worst a bad plugin could do?
 *
 *   VALIDATORS  ~/.claude/forge-validators/*.mjs   run during doctor; may FAIL the audit
 *   HOOKS       ~/.claude/forge-hooks/*.json        run AFTER a decision; cannot change it
 *   EXPORTERS   ~/.claude/forge-exporters/*.mjs     read the ledger; produce a file or a string
 *
 * THE BOUNDARY THAT MATTERS: a hook runs after the decision and its return value is
 * discarded. It can notify Slack, write a file, emit a metric. It cannot veto a gate, alter a
 * route, or approve a proposal. If a plugin could change a decision, the audit trail would
 * name F.O.R.G.E. for a choice something else made — and every guarantee in the constitution
 * would be a guarantee about code that was not necessarily what ran.
 *
 * Validators are the exception, deliberately: they may only make doctor STRICTER. A team rule
 * ("no circular imports", "all queries go through the ORM") is exactly the kind of thing that
 * should be able to fail a build, and a validator that could make doctor pass something it
 * would otherwise fail is not offered at all.
 *
 * Everything here is OPT-IN by presence. No directory, no plugins, no behaviour change — and
 * `forge doctor` reports what it loaded, because a check running from an unlisted file is
 * worse than no check.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = (kind, root = path.join(os.homedir(), '.claude')) => path.join(root, `forge-${kind}`);

const listFiles = (kind, ext, root) => {
  const d = dir(kind, root);
  if (!fs.existsSync(d)) return [];
  try {
    return fs.readdirSync(d).filter((f) => f.endsWith(ext)).sort().map((f) => path.join(d, f));
  } catch {
    return [];
  }
};

// ───────────────────────────────────────────────────────────────────────── validators

/**
 * Load custom doctor checks.
 *
 * Each file default-exports `{ name, check(org) -> { ok, notes } }` — the exact shape the
 * built-in checks use, so a team validator is not a second-class citizen.
 *
 * A validator that THROWS is reported as a failed validator rather than crashing doctor. The
 * distinction matters: "your check is broken" and "your organization is broken" are different
 * problems and must not look the same.
 */
export const loadValidators = async ({ root } = {}) => {
  const out = [];
  for (const file of listFiles('validators', '.mjs', root)) {
    try {
      const mod = await import(`file://${file}`);
      const v = mod.default || mod;
      if (typeof v.check !== 'function') {
        out.push({ file, name: path.basename(file), broken: 'exports no check(org) function' });
        continue;
      }
      out.push({ file, name: v.name || path.basename(file, '.mjs'), check: v.check });
    } catch (e) {
      out.push({ file, name: path.basename(file), broken: e.message });
    }
  }
  return out;
};

export const runValidators = async (org, { root } = {}) => {
  const loaded = await loadValidators({ root });
  const results = [];
  for (const v of loaded) {
    if (v.broken) {
      results.push({ name: v.name, ok: true, notes: [{ level: 'warn', text: `custom validator is broken and was skipped: ${v.broken}` }] });
      continue;
    }
    try {
      const r = await v.check(org);
      // A validator may only make doctor stricter. Coercing its verdict to boolean here means
      // a validator cannot return something truthy-but-odd and accidentally pass.
      results.push({ name: v.name, ok: r.ok === true, notes: Array.isArray(r.notes) ? r.notes : [] });
    } catch (e) {
      results.push({ name: v.name, ok: true, notes: [{ level: 'warn', text: `custom validator threw and was skipped: ${e.message}` }] });
    }
  }
  return results;
};

// ─────────────────────────────────────────────────────────────────────────────── hooks

export const HOOK_EVENTS = ['campaign_complete', 'gate_fired', 'proposal_generated', 'spotcheck_failed', 'breaker_tripped'];

/**
 * Load declarative hooks. Each file is JSON:
 *   { "name": "slack-notifier", "on": ["gate_fired"], "command": "curl -X POST $SLACK_WEBHOOK -d @-" }
 *
 * The event payload is written to the command's STDIN as JSON. Not as an argument: an
 * argument containing a campaign id or a request string is one shell metacharacter away from
 * being executed, and the payload is not always something the organization controls.
 */
export const loadHooks = ({ root } = {}) => {
  const out = [];
  for (const file of listFiles('hooks', '.json', root)) {
    try {
      const h = JSON.parse(fs.readFileSync(file, 'utf8'));
      const events = [].concat(h.on || []);
      const unknown = events.filter((e) => !HOOK_EVENTS.includes(e));
      if (!h.command) { out.push({ file, name: h.name || path.basename(file), broken: 'no command' }); continue; }
      if (!events.length) { out.push({ file, name: h.name || path.basename(file), broken: 'no events in `on`' }); continue; }
      if (unknown.length) { out.push({ file, name: h.name || path.basename(file), broken: `unknown event(s): ${unknown.join(', ')}` }); continue; }
      out.push({ file, name: h.name || path.basename(file, '.json'), on: events, command: h.command, timeout: Number(h.timeout || 10) });
    } catch (e) {
      out.push({ file, name: path.basename(file), broken: `unreadable: ${e.message}` });
    }
  }
  return out;
};

/**
 * Fire the hooks registered for one event.
 *
 * Every failure mode here is swallowed on purpose. A notifier that cannot reach Slack must
 * never fail the campaign it was notifying about — the hook is a side effect of a decision
 * that has already been made, and letting it change the outcome would make it an orchestrator.
 * The return value reports what ran so a caller can SAY so; nothing reads it to decide anything.
 */
export const fireHooks = async (event, payload, { root, exec = null } = {}) => {
  const hooks = loadHooks({ root }).filter((h) => !h.broken && h.on.includes(event));
  const fired = [];
  for (const h of hooks) {
    try {
      if (exec) await exec(h, payload);
      else {
        const { spawn } = await import('node:child_process');
        await new Promise((resolve) => {
          const p = spawn(h.command, { shell: true, stdio: ['pipe', 'ignore', 'ignore'] });
          const t = setTimeout(() => { try { p.kill(); } catch { /* already gone */ } resolve(); }, h.timeout * 1000);
          p.on('close', () => { clearTimeout(t); resolve(); });
          p.on('error', () => { clearTimeout(t); resolve(); });
          try { p.stdin.end(JSON.stringify({ event, ...payload })); } catch { /* the process died first */ }
        });
      }
      fired.push({ name: h.name, ok: true });
    } catch (e) {
      fired.push({ name: h.name, ok: false, why: e.message });
    }
  }
  return fired;
};

// ─────────────────────────────────────────────────────────────────────────── exporters

/**
 * Load exporters. Each default-exports `{ name, format(data) -> string }`.
 *
 * Deliberately pure: an exporter returns a STRING and the caller decides what to do with it.
 * An exporter that could POST to an endpoint itself would be egress from inside a read
 * command, and egress is one of the seven gates. Handing back a string keeps the decision to
 * send it where it belongs — with the human running the command.
 */
export const loadExporters = async ({ root } = {}) => {
  const out = [];
  for (const file of listFiles('exporters', '.mjs', root)) {
    try {
      const mod = await import(`file://${file}`);
      const e = mod.default || mod;
      if (typeof e.format !== 'function') { out.push({ file, name: path.basename(file), broken: 'exports no format(data) function' }); continue; }
      out.push({ file, name: e.name || path.basename(file, '.mjs'), format: e.format });
    } catch (e) {
      out.push({ file, name: path.basename(file), broken: e.message });
    }
  }
  return out;
};

export const pluginSummary = async ({ root } = {}) => ({
  validators: await loadValidators({ root }),
  hooks: loadHooks({ root }),
  exporters: await loadExporters({ root }),
});
