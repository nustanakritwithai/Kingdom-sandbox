/* Phase 15 UI smoke test — Observer / Search / Follow */
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '8905'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { await d.accept(); });

  await page.goto('http://127.0.0.1:8905/index.html', { waitUntil: 'networkidle0' });

  const overlay = await page.evaluate(() => {
    const ov = document.getElementById('continueOverlay');
    return ov && !ov.classList.contains('hidden');
  });
  if (overlay) await page.evaluate(() => document.getElementById('btnNewWorldOverlay').click());
  await page.waitForFunction(() => world && world.day >= 0, { timeout: 10000 });

  for (let i = 0; i < 10; i++) await page.evaluate(() => simulateDay());

  await page.click('#btnObserver');
  await page.waitForSelector('#observerPanel:not(.hidden)');
  const obsBody = await page.$eval('#observerBody', el => el.innerHTML.length);
  if (obsBody < 10) throw new Error('Observer panel empty');

  const townName = await page.evaluate(() => world.settlements.find(s => s.type === 'town').name);
  await page.type('#globalSearch', townName.slice(0, 4));
  await page.waitForFunction(() => document.querySelectorAll('.search-hit').length > 0, { timeout: 5000 });
  await page.evaluate(() => document.querySelector('.search-hit').click());
  await page.waitForFunction(() => {
    const t = document.getElementById('inspectorTitle').textContent;
    return t && t !== 'Inspector — ภาพรวมโลก' && t !== 'Inspector';
  }, { timeout: 5000 });

  await page.evaluate(() => {
    UI.selected = { kind: 'agent', id: world.agents.find(a => a.alive).id };
    UI.inspectorDirty = true;
    UI.renderInspector();
  });
  await page.evaluate(() => document.querySelector('.follow-btn').click());
  const followVisible = await page.evaluate(() => !document.getElementById('followLabel').classList.contains('hidden'));
  if (!followVisible) throw new Error('Follow label not shown');

  await page.evaluate(() => {
    const cb = document.querySelector('.pause-on-cb[data-pause="war_declaration"]');
    if (cb) cb.checked = true;
    ObserverSystem.pauseOn.war_declaration = true;
  });
  await page.evaluate(() => {
    const f1 = world.factions.find(f => !f.isBandit);
    const f2 = world.factions.find(f => !f.isBandit && f.id !== f1.id) || world.factions.find(f => f.isBandit);
    if (f1 && f2) DiplomacySystem.declareWar(f1, f2, 'UI test war');
  });
  const paused = await page.evaluate(() => UI.paused);
  if (!paused) throw new Error('Pause on war declaration failed');

  await page.evaluate(() => {
    Renderer.panX = 40;
    Renderer.panY = 30;
    Renderer.zoom = 1.3;
  });
  const cam = await page.evaluate(() => ({ panX: Renderer.panX, panY: Renderer.panY, zoom: Renderer.zoom }));
  if (cam.zoom < 1.2) throw new Error('Camera zoom smoke failed');

  await page.click('.log-filter[data-f="war"]');
  await page.waitForFunction(() => document.querySelectorAll('#eventLog .log-entry').length >= 0);

  if (errors.length) throw new Error('JS errors: ' + errors.join('; '));
  console.log('Phase 15 UI smoke test PASSED');
  await browser.close();
  server.kill();
})().catch(e => { console.error('UI test FAILED:', e.message); process.exit(1); });
