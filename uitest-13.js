/* Phase 13 UI smoke test — Save / Load / Export */
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '8903'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('http://127.0.0.1:8903/index.html', { waitUntil: 'networkidle0' });

  page.on('dialog', async d => { await d.accept(); });

  // Dismiss continue overlay if present (New World)
  const overlayVisible = await page.evaluate(() => {
    const ov = document.getElementById('continueOverlay');
    return ov && !ov.classList.contains('hidden');
  });
  if (overlayVisible) {
    await page.evaluate(() => document.getElementById('btnNewWorldOverlay').click());
    await page.waitForFunction(() => world && world.day >= 0, { timeout: 10000 });
  } else {
    await page.waitForFunction(() => typeof world !== 'undefined' && world.day >= 0, { timeout: 10000 });
  }

  // Advance a few days
  for (let i = 0; i < 5; i++) await page.evaluate(() => simulateDay());

  const dayBefore = await page.evaluate(() => world.day);

  // Open save panel and save
  await page.evaluate(() => {
    SaveSystem.togglePanel();
    SaveSystem.saveWorld(true);
  });

  const status = await page.$eval('#saveStatus', el => el.textContent);
  if (!status.includes('Saved') && !status.includes('Day')) throw new Error('Save status not updated: ' + status);

  // Export JSON (intercept download via evaluate)
  const exportJson = await page.evaluate(() => {
    const p = SaveSystem.buildSavePayload('export');
    return JSON.stringify(p);
  });
  const parsed = JSON.parse(exportJson);
  if (parsed.schemaVersion !== '13.0') throw new Error('Export schema wrong');
  if (parsed.gameId !== 'living-kingdom-sandbox') throw new Error('Export gameId wrong');

  // Export chronicle
  const md = await page.evaluate(() => SaveSystem.buildChronicleMarkdown());
  if (!md.includes('ตำนานแห่ง') || md.length < 100) throw new Error('Chronicle export failed');

  // Reset
  await page.evaluate(() => generateWorld());
  await page.waitForFunction(() => world.day === 0, { timeout: 5000 });

  // Load from saved payload (bypass confirm in test)
  await page.evaluate(() => {
    const meta = SaveSystem.getSaveMeta();
    SaveSystem.loadFromPayload(meta);
  });
  await page.waitForFunction(d => world.day >= d, { timeout: 5000 }, dayBefore);

  const dayAfter = await page.evaluate(() => world.day);
  if (dayAfter !== dayBefore) throw new Error(`Load day mismatch ${dayAfter} vs ${dayBefore}`);

  // Import JSON via loadFromPayload
  await page.evaluate((json) => {
    SaveSystem.loadFromPayload(JSON.parse(json));
  }, exportJson);
  const dayImport = await page.evaluate(() => world.day);
  if (dayImport !== dayBefore) throw new Error('Import load failed');

  if (errors.length) throw new Error('JS errors: ' + errors.join('; '));
  console.log('Phase 13 UI smoke test PASSED');
  await browser.close();
  server.kill();
})().catch(e => { console.error('UI test FAILED:', e.message); process.exit(1); });
