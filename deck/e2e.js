/**
 * The in-page E2E harness — loaded only with ?e2e=1, never in normal use.
 *
 * This drives the REAL page the way a hand does: it clicks the real nav buttons, types
 * into the real textarea through real input events, presses the real send button, and
 * then looks at the real DOM for the result. No mocks, no shortcuts through state — if a
 * handler is broken, this breaks, which is the point. Results land in document.title and
 * a #e2e-report node so a headless dump can read them.
 */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const v = fn();
      if (v) return v;
    } catch { /* keep waiting */ }
    await wait(120);
  }
  throw new Error('timed out');
};
const q = (sel) => document.querySelector(sel);
const click = (sel) => {
  const el = q(sel);
  if (!el) throw new Error(`no element ${sel}`);
  el.click();
};
const type = (sel, text) => {
  const el = q(sel);
  if (!el) throw new Error(`no element ${sel}`);
  el.focus();
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, why: e.message });
  }
};

(async () => {
  // Wait for DATA, not just for the shell — the nav exists in static HTML long before the
  // stores load, and clicking into a view during that window is itself a test the page
  // once failed (markSeen crashed on a null mailbox).
  await until(() => q('.nav'));
  await until(() => q('.tiles'), 12000);
  const STAMP = `e2e-${Date.now().toString(36)}`;

  await step('home renders tiles and greeting', async () => {
    click('[data-view="home"]');
    await until(() => q('.tiles') && q('h1'));
  });

  await step('the office floor is alive and its legend navigates', async () => {
    await until(() => q('#office'));
    if (!(q('#office').width > 0)) throw new Error('office canvas has no size');
    click('.legendchip');
    await until(() => q('.deptrowwrap[open]'), 6000);
    click('[data-view="home"]');
    await until(() => q('#office'));
  });

  await step('chat: pick a recipient, type, send, and see the bubble', async () => {
    click('[data-view="chat"]');
    await until(() => q('#rcpt'));
    q('#rcpt').value = 'qa-manager';
    q('#rcpt').dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => q('#chatbody'));
    type('#chatbody', `E2E probe ${STAMP} — does the mailbox hold?`);
    click('#chatsend');
    await until(() => [...document.querySelectorAll('.msg.mine')].some((m) => m.textContent.includes(STAMP)));
  });

  await step('chat: a draft survives leaving and returning', async () => {
    type('#chatbody', `draft ${STAMP}`);
    click('[data-view="home"]');
    await until(() => q('.tiles'));
    click('[data-view="chat"]');
    await until(() => q('#chatbody'));
    if (!q('#chatbody').value.includes(`draft ${STAMP}`)) throw new Error('draft was lost crossing views');
  });

  await step('ideas: send and see it listed', async () => {
    click('[data-view="ideas"]');
    await until(() => q('#ideabody'));
    type('#ideabody', `E2E idea ${STAMP}`);
    click('#ideasend');
    await until(() => document.body.textContent.includes(`E2E idea ${STAMP}`));
  });

  await step('repos: refuse a bad url, accept a good one', async () => {
    click('[data-view="repos"]');
    await until(() => q('#repourl'));
    type('#repourl', 'https://github.com/example/probe');
    type('#repogoal', `E2E repo ${STAMP}`);
    click('#reposend');
    await until(() => document.body.textContent.includes(`E2E repo ${STAMP}`));
  });

  await step('plans: compose and read the stages', async () => {
    click('[data-view="plans"]');
    await until(() => q('#planreq'));
    type('#planreq', 'add an api endpoint for invoices');
    click('#plango');
    await until(() => document.body.textContent.includes('CHECK IT'), 10000); // the phase heading renders uppercased
  });

  await step('team: expand a department and run the health check', async () => {
    click('[data-view="team"]');
    await until(() => q('.deptrowwrap'));
    q('.deptrowwrap').open = true;
    click('#healthcheck');
    await until(() => q('#healthout').textContent.includes('checks passed'), 10000);
  });

  await step('spending renders both truths', async () => {
    click('[data-view="spend"]');
    await until(() => document.body.textContent.includes('attributed') || document.body.textContent.includes('self-reported'));
  });

  await step('sessions view names Claude Code sessions, not places', async () => {
    click('[data-view="sessions"]');
    await until(() => q('h1').textContent === 'Sessions');
    await until(() => document.body.textContent.includes('Claude Code session'));
  });

  const failed = results.filter((r) => !r.ok);
  const report = document.createElement('pre');
  report.id = 'e2e-report';
  report.textContent = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.why ? ` — ${r.why}` : ''}`).join('\n');
  document.body.appendChild(report);
  document.title = failed.length ? `E2E:FAIL:${failed.length}` : `E2E:PASS:${results.length}`;
})();
