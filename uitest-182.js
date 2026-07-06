/* Phase 18.2 UI smoke test */
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '8920'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { await d.accept(); });

  await page.goto('http://127.0.0.1:8920/index.html', { waitUntil: 'networkidle0' });
  const overlay = await page.evaluate(() => {
    const ov = document.getElementById('continueOverlay');
    return ov && !ov.classList.contains('hidden');
  });
  if (overlay) await page.evaluate(() => document.getElementById('btnNewWorldOverlay').click());
  await page.waitForFunction(() => world && world.day >= 0, { timeout: 10000 });

  await page.evaluate(() => {
    if (typeof LargeBattlefieldSystem !== 'undefined') LargeBattlefieldSystem.forceLargeBattle(100, 90);
  });

  await page.evaluate(() => {
    ObserverSystem.observerOpen = true;
    document.getElementById('observerPanel')?.classList.remove('hidden');
    ObserverSystem.rankingTab = 'largebattles';
    ObserverSystem.renderPanel();
  });
  await page.waitForFunction(() => {
    const html = document.getElementById('observerBody')?.innerHTML || '';
    return html.includes('Large Battles') || html.includes('ศึก');
  }, { timeout: 8000 });

  const obsOk = await page.$eval('#observerBody', el =>
    el.innerHTML.includes('Large Battles') || el.innerHTML.includes('Formations'));
  if (!obsOk) throw new Error('Large Battles observer tab failed');

  await page.evaluate(() => {
    const u = world.units.find(x => unitMembers(x).length > 5);
    if (!u) return;
    UI.selected = { kind: 'unit', id: u.id };
    UI.inspectorDirty = true;
    UI.renderInspector();
  });
  const unitInsp = await page.$eval('#inspectorBody', el =>
    el.innerHTML.includes('Formation') && (el.innerHTML.includes('Morale') || el.innerHTML.includes('Composition')));
  if (!unitInsp) throw new Error('Unit inspector missing battlefield fields');

  await page.evaluate(() => {
    if (typeof LargeBattlefieldSystem !== 'undefined') LargeBattlefieldSystem.forceLargeBattle(80, 70);
    SaveSystem.saveToLocalStorage('uitest182', true);
  });
  await page.evaluate(() => { world.battleReports = []; });
  await page.evaluate(() => SaveSystem.loadWorld());
  const loaded = await page.evaluate(() => (world.battleReports || []).length > 0);
  if (!loaded) throw new Error('Save/load battle reports failed');

  await page.evaluate(() => Renderer.draw());

  if (errors.length) throw new Error('JS errors: ' + errors.join('; '));
  console.log('Phase 18.2 UI smoke test PASSED');
  await browser.close();
  server.kill();
})().catch(e => { console.error('UI test FAILED:', e.message); process.exit(1); });
