/* Phase 19 audit — UI smoke test ผ่าน Chromium จริง
   รัน: node audit/uismoke.js [path-to-playwright-core-module]
   ต้องมี playwright-core (npm i playwright-core) และ Chromium
   (ตั้ง CHROMIUM_PATH หรือใช้ /opt/pw-browsers/chromium/chrome-linux/chrome)
   ทำ: โหลดหน้า, ปิด overlay, sim ~60 วัน x20, เปิดทุก panel, วนทุก heatmap,
       คลิกเลือก entity — เก็บ console error / pageerror ทั้งหมด */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const pwPath = process.argv[2] || 'playwright-core';
const { chromium } = require(pwPath);

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = '/opt/pw-browsers';
  if (fs.existsSync(base)) {
    for (const d of fs.readdirSync(base)) {
      const p = path.join(base, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
    const direct = path.join(base, 'chromium');
    if (fs.existsSync(direct)) {
      const p = path.join(direct, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
      return direct;
    }
  }
  return null;
}

(async () => {
  const port = 8931;
  const server = spawn('python3', ['-m', 'http.server', String(port)], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1000));

  const errors = [];
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() || undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });

  try {
    await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(1200);

    // ปิด continue overlay ถ้ามี
    const overlay = await page.$('#continueOverlay:not(.hidden)');
    if (overlay) {
      const newBtn = await page.$('#btnNewWorld, #continueNew, .co-new');
      if (newBtn) await newBtn.click();
      else await page.evaluate(() => document.getElementById('continueOverlay')?.classList.add('hidden'));
      await page.waitForTimeout(500);
    }

    // เร่ง x20 แล้วปล่อย ~60 วัน
    for (const sel of ['.speed-btn[data-speed="20"]', '#speed20', 'button[data-speed="20"]']) {
      const b = await page.$(sel); if (b) { await b.click(); break; }
    }
    await page.waitForTimeout(4000);
    const day = await page.evaluate(() => (typeof world !== 'undefined' && world) ? world.day : -1);
    console.log(`sim เดินถึง day ${day} ${day > 20 ? '✓' : '✗ (ช้าผิดปกติหรือไม่เดิน)'}`);

    // เปิดทุก panel toggle ที่หาเจอ
    const panelButtons = await page.$$eval('header button, .toolbar button, nav button', bs =>
      bs.map(b => b.id || b.textContent.trim()).filter(Boolean));
    console.log(`ปุ่มบน toolbar/nav: ${panelButtons.length} ปุ่ม`);
    for (const id of ['btnTools', 'btnMarket', 'btnObserver', 'btnChronicle', 'btnDiplomacy', 'btnSavePanel']) {
      const b = await page.$('#' + id);
      if (b) { await b.click(); await page.waitForTimeout(400); await b.click(); await page.waitForTimeout(150); }
    }

    // detail pages (Phase 18.4)
    for (const v of await page.$$('[data-view]')) { await v.click(); await page.waitForTimeout(400); }
    const mapBtn = await page.$('[data-view="map"]');
    if (mapBtn) await mapBtn.click();

    // วนทุก heatmap
    const heatmapValues = await page.$eval('#heatmapSelect', el => [...el.options].map(o => o.value)).catch(() => []);
    console.log(`heatmap modes: ${heatmapValues.join(', ')}`);
    for (const v of heatmapValues) {
      await page.selectOption('#heatmapSelect', v);
      await page.waitForTimeout(300);
    }

    // คลิกกลางแผนที่หลายจุดให้ inspector ทำงาน
    const canvas = await page.$('#mapCanvas');
    const box = await canvas.boundingBox();
    for (const [fx, fy] of [[0.5, 0.45], [0.43, 0.2], [0.6, 0.8], [0.25, 0.5]]) {
      await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
      await page.waitForTimeout(250);
    }

    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(__dirname, 'uismoke-screenshot.png') });
  } catch (e) {
    errors.push(`fatal: ${e.message}`);
  }

  await browser.close();
  server.kill();

  console.log(`\n== ผล UI smoke: error ${errors.length} รายการ ==`);
  const uniq = [...new Set(errors)];
  for (const e of uniq.slice(0, 20)) console.log('  ' + e.slice(0, 300));
  process.exit(errors.length ? 1 : 0);
})();
