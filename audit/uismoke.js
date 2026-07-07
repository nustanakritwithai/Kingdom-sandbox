/* Phase 19 audit — UI smoke test ผ่าน Chromium จริง
   รัน: node audit/uismoke.js
   ต้องมี playwright-core หรือ puppeteer + Chromium */
'use strict';
const path = require('path');
const { getBrowserLauncher, startStaticServer } = require('../test-utils/ui-launch');

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const launcher = await getBrowserLauncher();
  if (!launcher) {
    console.log('SKIP UI audit/uismoke.js: playwright-core/puppeteer not installed');
    process.exit(0);
  }

  const port = 8931;
  const root = path.join(__dirname, '..');
  const server = startStaticServer(port, root);
  await new Promise(r => setTimeout(r, 1000));

  const errors = [];
  let browser;
  try {
    browser = await launcher.launch();
    const page = await launcher.newPage(browser);
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });

    await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'load', timeout: 20000 });
    await sleep(1200);

    const overlay = await page.$('#continueOverlay:not(.hidden)');
    if (overlay) {
      const newBtn = await page.$('#btnNewWorld, #continueNew, .co-new, #btnNewWorldOverlay');
      if (newBtn) await newBtn.click();
      else await page.evaluate(() => document.getElementById('continueOverlay')?.classList.add('hidden'));
      await sleep(500);
    }

    for (const sel of ['.speed-btn[data-speed="20"]', '#speed20', 'button[data-speed="20"]']) {
      const b = await page.$(sel); if (b) { await b.click(); break; }
    }
    await sleep(4000);
    const day = await page.evaluate(() => (typeof world !== 'undefined' && world) ? world.day : -1);
    console.log(`sim เดินถึง day ${day} ${day > 20 ? '✓' : '✗ (ช้าผิดปกติหรือไม่เดิน)'}`);

    for (const id of ['btnTools', 'btnMarket', 'btnObserver', 'btnChronicle', 'btnDiplomacy', 'btnSavePanel']) {
      const b = await page.$('#' + id);
      if (b) { await b.click(); await sleep(400); await b.click(); await sleep(150); }
    }

    for (const v of await page.$$('[data-view]')) { await v.click(); await sleep(400); }
    const mapBtn = await page.$('[data-view="map"]');
    if (mapBtn) await mapBtn.click();

    const heatmapValues = await page.$eval('#heatmapSelect', el => [...el.options].map(o => o.value)).catch(() => []);
    console.log(`heatmap modes: ${heatmapValues.join(', ')}`);
    for (const v of heatmapValues) {
      await page.evaluate(val => {
        const el = document.getElementById('heatmapSelect');
        if (el) { el.value = val; el.dispatchEvent(new Event('change')); }
      }, v);
      await sleep(300);
    }

    const canvas = await page.$('#mapCanvas');
    const box = await canvas.boundingBox();
    if (box) {
      for (const [fx, fy] of [[0.5, 0.45], [0.43, 0.2], [0.6, 0.8], [0.25, 0.5]]) {
        await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
        await sleep(250);
      }
    }

    await sleep(1500);
    await page.screenshot({ path: path.join(__dirname, 'uismoke-screenshot.png') });
  } catch (e) {
    if (/Executable doesn't exist|browser.*not found|Could not find Chrome/i.test(e.message)) {
      console.log('SKIP UI audit/uismoke.js: browser not available — ' + e.message);
      process.exit(0);
    }
    errors.push(`fatal: ${e.message}`);
  } finally {
    if (browser) await launcher.close(browser);
    server.kill();
  }

  console.log(`\n== ผล UI smoke: error ${errors.length} รายการ ==`);
  const uniq = [...new Set(errors)];
  for (const e of uniq.slice(0, 20)) console.log('  ' + e.slice(0, 300));
  process.exit(errors.length ? 1 : 0);
})();
