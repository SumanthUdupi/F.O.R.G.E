/**
 * The Command Deck — a local operations view for the organization.
 *
 * WHY NODE'S STDLIB AND NOT A FRAMEWORK
 *
 * The deck is the first thing a new reader opens and the thing they open most often. If it
 * needs `npm install` it is unavailable exactly when it is most useful: on a fresh clone, on
 * a locked-down machine, in a container that has no registry access. So the server is
 * `node:http`, the page is three hand-written files, and `forge deck` works on any machine
 * that can run the CLI at all.
 *
 * It is also read-mostly by design. The deck shows what the organization knows and lets the
 * Principal approve a proposal; it does not dispatch agents. Dispatch belongs to the host
 * runtime, and a second thing that can start work is a second thing that can start work
 * nobody asked for.
 *
 * BINDING
 *
 * 127.0.0.1 only, never 0.0.0.0. The deck reads the ledger, the profile and the roster --
 * all of which describe the Principal's private workspace -- and there is no authentication
 * because there is no remote. Exposing it on a LAN would publish that with no way to say no.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { load, ROOT, resolveContract } from './core.mjs';
import { composeVector } from './vector.mjs';
import { readLedger, derive, files } from './ledger.mjs';
import { profileWorkspace, loadOverlay, propose, applyProposal } from './learn.mjs';
import { runDoctor } from './doctor.mjs';

const DECK = path.join(ROOT, 'deck');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

/**
 * The organization, shaped for the browser.
 *
 * Assembled server-side rather than shipping the raw registry, because the browser should
 * never have to re-implement the seat/division/agent join -- two implementations of one
 * relationship is two chances for the deck to describe an organization that does not exist.
 */
export const orgPayload = (org) => ({
  meta: org.constitution.meta,
  chair: org.constitution.board.chair,
  chairAuthority: org.constitution.board.chair_authority,
  principles: org.constitution.board.principles,
  gates: org.constitution.gates,
  ladder: org.constitution.escalation_ladder,
  escalateNow: org.constitution.escalate_immediately,
  rules: org.constitution.rules,
  resolution: org.constitution.board.resolution,
  channels: (org.constitution.board.direct_channels || []).map((c) => ({
    between: c.between.map((d) => org.constitution.divisions.find((x) => x.id === d).name),
    why: c.why,
  })),
  tiers: org.roster.meta.tiers,
  seats: org.roster.board.map((b) => ({
    id: b.id,
    name: b.name,
    seat: b.seat,
    owns: b.owns,
    model: b.model,
    stance: b.stance,
    refuses: b.refuses,
    dissentsWhen: b.dissents_when,
    isChair: b.id === org.constitution.board.chair,
    divisions: org.constitution.board.portfolios.find((p) => p.seat === b.id).owns,
  })),
  divisions: org.constitution.divisions.map((d) => ({
    id: d.id,
    name: d.name,
    code: d.code,
    mission: d.mission,
    authority: d.authority,
    mayHalt: Boolean(d.may_halt),
    seat: org.seatOf.get(d.id),
    manager: (org.byDivision.get(d.id).find((a) => a.role === 'manager') || {}).name,
    agents: org.byDivision.get(d.id).map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      model: a.model,
      writes: Boolean(a.writes),
      owns: a.owns,
      stance: a.stance,
      refuses: a.refuses,
      knows: a.knows || null,
      capabilities: a.capabilities || [],
      contract: resolveContract(a, org.contracts).fields.map((f) => f.key),
    })),
  })),
});

/**
 * Everything that changes. Kept separate from the org payload so the browser can poll one
 * and cache the other -- the constitution does not move while you are watching it.
 */
export const statePayload = (org, cwd = process.cwd()) => {
  const rows = readLedger(cwd);
  const d = derive(rows);
  const profile = profileWorkspace(cwd);
  const overlay = loadOverlay(cwd);
  const f = files(cwd);
  let proposals = [];
  if (fs.existsSync(f.proposals)) {
    try {
      proposals = JSON.parse(fs.readFileSync(f.proposals, 'utf8'));
    } catch {
      proposals = [];
    }
  }

  // Division status is derived from the ledger, not stored. A status field that has to be
  // written by whoever finishes a task is a status field that is wrong whenever something
  // crashes -- deriving it means it can only ever be stale, never lying.
  const recent = rows.slice(-40);
  const status = {};
  for (const div of org.constitution.divisions) {
    const names = new Set(org.byDivision.get(div.id).map((a) => a.name));
    const mine = recent.filter((r) => names.has(r.agent));
    const last = mine[mine.length - 1];
    status[div.id] = {
      state: !last ? 'idle' : last.outcome === 'fail' ? 'failing' : last.outcome === 'blocked' ? 'blocked' : 'active',
      observations: mine.length,
      lastAgent: last?.agent ?? null,
      lastAt: last?.at ?? null,
    };
  }

  return {
    workspace: path.basename(cwd),
    cwd,
    observations: d.observations,
    memory: d.memory,
    corrections: d.corrections.slice(-12).reverse(),
    feed: rows.slice(-60).reverse(),
    profile,
    proposals,
    overlay: overlay.adaptations || [],
    status,
    health: (() => {
      const r = runDoctor(org);
      return { ok: r.ok, failures: r.failures, warnings: r.warnings };
    })(),
  };
};

const json = (res, body, code = 200) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': MIME['.json'], 'content-length': Buffer.byteLength(s), 'cache-control': 'no-store' });
  res.end(s);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      // A local tool still refuses an unbounded body. There is no request the deck accepts
      // that is anywhere near this size, so anything larger is a bug or an attack.
      if (raw.length > 64_000) reject(new Error('request body too large'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
  });

/** Serve one static file from deck/, and nothing outside it. */
const serveStatic = (urlPath, res) => {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  const full = path.join(DECK, rel);
  // Resolve first, then check the prefix. Checking the raw string lets "..%2f" through on
  // some clients; checking the resolved path cannot be fooled by encoding.
  if (!path.resolve(full).startsWith(path.resolve(DECK))) {
    res.writeHead(403).end('outside the deck directory');
    return;
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404).end('not found');
    return;
  }
  const body = fs.readFileSync(full);
  res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
};

export const createDeck = ({ cwd = process.cwd() } = {}) => {
  const org = load();
  const clients = new Set();

  // Push on change rather than making the browser poll. fs.watch is best-effort across
  // platforms, so the client also refreshes on a slow timer -- the stream is an optimisation,
  // never the only path, because a missed event would freeze the deck silently.
  const dir = files(cwd).dir;
  let watcher = null;
  const startWatch = () => {
    if (!fs.existsSync(dir)) return;
    try {
      watcher = fs.watch(dir, { persistent: false }, () => {
        for (const c of clients) c.write('event: dirty\ndata: {}\n\n');
      });
    } catch {
      watcher = null; // unsupported platform; the timer covers it
    }
  };
  startWatch();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    try {
      if (p === '/api/org') return json(res, orgPayload(org));
      if (p === '/api/state') return json(res, statePayload(org, cwd));

      if (p === '/api/doctor') {
        const r = runDoctor(org);
        return json(res, { ok: r.ok, failures: r.failures, warnings: r.warnings, lines: r.lines });
      }

      if (p === '/api/plan' && req.method === 'POST') {
        const body = await readBody(req);
        const request = String(body.request || '').slice(0, 2000);
        if (!request.trim()) return json(res, { error: 'a plan needs a request' }, 400);
        const memory = derive(readLedger(cwd)).memory;
        const mode = ['direct', 'focused', 'standard', 'campaign'].includes(body.mode) ? body.mode : null;
        return json(res, composeVector(request, org, { memory, mode }));
      }

      if (p === '/api/learn' && req.method === 'POST') {
        const rows = readLedger(cwd);
        const profile = profileWorkspace(cwd);
        const result = propose(org, { rows, profile });
        const f = files(cwd);
        fs.mkdirSync(f.dir, { recursive: true });
        fs.writeFileSync(f.proposals, `${JSON.stringify(result.proposals, null, 2)}\n`);
        return json(res, result);
      }

      if (p === '/api/approve' && req.method === 'POST') {
        // The single write the deck performs, and it is the one the Principal exists for.
        const body = await readBody(req);
        const f = files(cwd);
        if (!fs.existsSync(f.proposals)) return json(res, { error: 'no proposals; run learn first' }, 400);
        const proposals = JSON.parse(fs.readFileSync(f.proposals, 'utf8'));
        const proposal = proposals.find((x) => x.id === body.id);
        if (!proposal) return json(res, { error: `no proposal ${body.id}` }, 404);
        if (proposal.refused) return json(res, { error: proposal.refused }, 400);
        applyProposal(proposal, cwd);
        return json(res, { applied: proposal.id });
      }

      if (p === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write('retry: 2000\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return undefined;
      }

      if (p.startsWith('/api/')) return json(res, { error: 'no such endpoint' }, 404);
      return serveStatic(p, res);
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  });

  const close = () => {
    if (watcher) watcher.close();
    for (const c of clients) c.end();
    clients.clear();
    server.close();
  };

  return { server, close, org };
};

/** Start it. Loopback only — see the note at the top of this file. */
export const startDeck = ({ port = 7717, cwd = process.cwd() } = {}) =>
  new Promise((resolve, reject) => {
    const deck = createDeck({ cwd });
    deck.server.once('error', reject);
    deck.server.listen(port, '127.0.0.1', () => resolve({ ...deck, port: deck.server.address().port }));
  });
