/**
 * E2E for the office-only Console: real clicks on the real page in real Chrome.
 *
 * The sidebar is gone, so the harness walks the office the way the Principal does — the
 * legend chips (the keyboard path the canvas mirrors), the drawers, the composers. Every
 * step ends in an observable: a DOM assertion here, and for anything that writes, a row
 * the server can be asked for afterwards.
 */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const v = fn(); if (v) return v; } catch { /* keep waiting */ }
    await wait(120);
  }
  throw new Error('timed out');
};
const q = (sel) => document.querySelector(sel);
const qa = (sel) => [...document.querySelectorAll(sel)];
const click = (sel) => { const el = typeof sel === 'string' ? q(sel) : sel; if (!el) throw new Error(`no element ${sel}`); el.click(); };
const type = (sel, text) => { const el = q(sel); if (!el) throw new Error(`no element ${sel}`); el.focus(); el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); };

const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, why: e.message }); }
};

(async () => {
  const STAMP = `e2e-${Date.now().toString(36)}`;

  await step('the office is alive: canvas painted, legend built, HUD counting', async () => {
    await until(() => q('#office') && q('#office').width > 0);
    await until(() => qa('.legendchip').length >= 14, 12000); // 12 rooms + desk + board + elevator
    await until(() => !q('#hud-needs').textContent.includes('·'));
  });

  await step('your desk: approvals and the quick ask live at reception', async () => {
    click('[data-open="reception"]');
    await until(() => q('#quickask'));
    if (!q('[data-approve]') && !document.body.textContent.includes('Nothing needs you')) throw new Error('neither approvals nor the empty state rendered');
  });

  await step('click a person, write to them, send, see the bubble', async () => {
    click('[data-room="DIV-QAA"]');
    await until(() => q('[data-person="qa-manager"]'));
    click('[data-person="qa-manager"]');
    await until(() => q('#chatbody'));
    type('#chatbody', `Office probe ${STAMP}`);
    click('#chatsend');
    await until(() => qa('.msg.mine').some((m) => m.textContent.includes(STAMP)), 10000);
  });

  await step('a draft survives closing the drawer and coming back', async () => {
    type('#chatbody', `draft ${STAMP}`);
    click('#drawerclose');
    await until(() => q('#drawer').getAttribute('aria-hidden') === 'true');
    click('[data-room="DIV-QAA"]');
    await until(() => q('[data-person="qa-manager"]'));
    click('[data-person="qa-manager"]');
    await until(() => q('#chatbody'));
    if (!q('#chatbody').value.includes(`draft ${STAMP}`)) throw new Error('draft lost crossing drawers');
  });

  await step('the Discovery Lab holds ideas and repos, and takes both', async () => {
    click('[data-room="DIV-DSC"]');
    await until(() => q('#ideabody') && q('#repourl'));
    type('#ideabody', `E2E idea ${STAMP}`);
    click('#ideasend');
    await until(() => document.body.textContent.includes(`E2E idea ${STAMP}`));
    type('#repourl', 'https://github.com/example/probe');
    type('#repogoal', `E2E repo ${STAMP}`);
    click('#reposend');
    await until(() => document.body.textContent.includes(`E2E repo ${STAMP}`));
  });

  await step('the Directorate composes a plan with phases and cost', async () => {
    click('[data-room="DIV-DIR"]');
    await until(() => q('#planreq'));
    type('#planreq', 'add an api endpoint for invoices');
    click('#plango');
    await until(() => document.body.textContent.includes('CHECK IT'), 10000);
  });

  await step('the board table carries the gates and a working health check', async () => {
    click('[data-open="board"]');
    await until(() => q('#healthcheck'));
    if (!document.body.textContent.includes('Production release')) throw new Error('the gates are not on the table');
    click('#healthcheck');
    await until(() => q('#healthout').textContent.includes('checks passed'), 10000);
  });

  await step('the Treasury shows both spending truths', async () => {
    click('[data-room="DIV-TRS"]');
    await until(() => document.body.textContent.includes('attributed'));
  });

  await step('the elevator lists Claude Code sessions, honestly empty here', async () => {
    click('[data-open="sessions"]');
    await until(() => document.body.textContent.includes('CLAUDE CODE SESSIONS'));
  });

  await step('escape closes the drawer and the floor remains', async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await until(() => q('#drawer').getAttribute('aria-hidden') === 'true');
    if (!(q('#office').width > 0)) throw new Error('the floor vanished');
  });

  const failed = results.filter((r) => !r.ok);
  const report = document.createElement('pre');
  report.id = 'e2e-report';
  report.textContent = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.why ? ` — ${r.why}` : ''}`).join('\n');
  document.body.appendChild(report);
  document.title = failed.length ? `E2E:FAIL:${failed.length}` : `E2E:PASS:${results.length}`;
})();
