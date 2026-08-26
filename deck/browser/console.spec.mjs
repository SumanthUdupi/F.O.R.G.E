/**
 * Console rendering checks — the things only a real browser can answer.
 *
 * Every assertion here exists because a property-level check said "fine" about something that
 * was not. Run it by hand against a live deck:
 *
 *   forge deck --port 7801 &
 *   PLAYWRIGHT=/path/to/node_modules/playwright node deck/browser/console.spec.mjs
 *
 * Skips cleanly when Playwright is not on the machine. It is not a dependency of this repo.
 */

const URL_BASE = process.env.CONSOLE_URL || 'http://127.0.0.1:7801';
const PW = process.env.PLAYWRIGHT;

let chromium;
try {
  ({ chromium } = await import(PW ? `${PW}/index.mjs` : 'playwright'));
} catch {
  console.log('\n  SKIPPED — no Playwright on this machine.');
  console.log('  PLAYWRIGHT=/path/to/node_modules/playwright node deck/browser/console.spec.mjs\n');
  process.exit(0);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

try {
  await page.goto(`${URL_BASE}/console.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  // Sample the CANVAS BITMAP, not a CSS property. The canvas is the surface CSS cannot reach.
  const floorPixel = () => page.evaluate(() => {
    const c = document.querySelector('#office');
    const d = c.getContext('2d').getImageData(Math.round(c.width * 0.5), Math.round(c.height * 0.42), 1, 1).data;
    return `${d[0]},${d[1]},${d[2]}`;
  });

  const lightBody = await bodyBg();
  const lightFloor = await floorPixel();

  // 1. Inventory renders with real height, not merely with a node in the DOM.
  await page.click('#hud-inventory');
  await page.waitForTimeout(900);
  const inv = await page.evaluate(() => {
    const d = document.querySelector('#drawerbody');
    return { h: Math.round(d.getBoundingClientRect().height), rows: d.querySelectorAll('.invrow').length, tabs: d.querySelectorAll('.invtab').length };
  });
  check('inventory renders with real height', inv.h > 200, `${inv.h}px, ${inv.rows} rows, ${inv.tabs} tabs`);
  check('inventory has all four tabs', inv.tabs === 4);

  // 2. Every tab renders something — rows, or an honest empty state.
  for (const t of ['skills', 'connectors', 'divisions', 'agents']) {
    await page.click(`[data-invtab="${t}"]`);
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => ({ rows: document.querySelectorAll('#drawerbody .invrow').length, empty: !!document.querySelector('#drawerbody .empty') }));
    check(`tab "${t}" renders`, r.rows > 0 || r.empty, r.rows ? `${r.rows} rows` : 'empty state');
  }

  // 3. THE LAYERING BUG. The toggle must be clickable WITH A DRAWER OPEN — it was not, and
  //    every property assertion said it was visible and enabled while the drawer covered it.
  const reachable = await page.evaluate(() => {
    const b = document.querySelector('#theme-toggle').getBoundingClientRect();
    const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return top && top.closest('#theme-toggle') !== null;
  });
  check('theme toggle is reachable while a drawer is open', reachable, reachable ? '' : 'something is on top of it');

  // 4. The ground actually changes, in the DOM and on the canvas.
  await page.click('#theme-toggle');
  await page.waitForTimeout(700);
  const darkBody = await bodyBg();
  const darkFloor = await floorPixel();
  check('body ground changes with the theme', darkBody !== lightBody, `${lightBody} → ${darkBody}`);
  check('the CANVAS floor changes too', darkFloor !== lightFloor, `${lightFloor} → ${darkFloor}`);

  // 5. The choice survives a reload, and no flash of the wrong ground.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  check('the theme choice survives a reload', (await bodyBg()) === darkBody);

  // 6. And it goes back.
  await page.click('#theme-toggle');
  await page.waitForTimeout(500);
  check('the toggle works in both directions', (await bodyBg()) === lightBody);

  check('no JavaScript errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n  ${results.length - failed.length} passed · ${failed.length} failed\n`);
process.exit(failed.length ? 1 : 0);
