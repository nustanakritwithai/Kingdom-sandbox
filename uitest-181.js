/* Phase 18.1 UI smoke test — combat inspector / observer / save */
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '8919'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { await d.accept(); });

  await page.goto('http://127.0.0.1:8919/index.html', { waitUntil: 'networkidle0' });
  const overlay = await page.evaluate(() => {
    const ov = document.getElementById('continueOverlay');
    return ov && !ov.classList.contains('hidden');
  });
  if (overlay) await page.evaluate(() => document.getElementById('btnNewWorldOverlay').click());
  await page.waitForFunction(() => world && world.day >= 0, { timeout: 10000 });

  await page.evaluate(() => {
    for (let i = 0; i < 30; i++) simulateDay();
    let ag = world.agents.find(a => a.alive);
    if (!ag) return;
    TextCombatCore.applyInjury(ag, 'minor_cut', 3);
    ag.duelRecord = { wins: 2, losses: 1, kills: 1 };
    TextCombatCore.ensureAgent(ag);
    UI.selected = { kind: 'agent', id: ag.id };
    UI.inspectorDirty = true;
    UI.renderInspector();
  });
  const agentInsp = await page.$eval('#inspectorBody', el =>
    el.innerHTML.includes('Combat Body') && el.innerHTML.includes('Derived Combat'));
  if (!agentInsp) throw new Error('Agent inspector missing combat body/derived combat');

  const hasInjury = await page.$eval('#inspectorBody', el =>
    el.innerHTML.includes('Injuries') && el.innerHTML.includes('Duel Record'));
  if (!hasInjury) throw new Error('Agent inspector missing injury/duel section');

  await page.evaluate(() => {
    const u = world.units.find(x => unitMembers(x).length >= 2);
    if (u) {
      u.formation = 'spear_line';
      TextCombatCore.updateUnitComposition(u);
      UI.selected = { kind: 'unit', id: u.id };
      UI.inspectorDirty = true;
      UI.renderInspector();
    }
  });
  const unitInsp = await page.$eval('#inspectorBody', el =>
    el.innerHTML.includes('Composition') && el.innerHTML.includes('Formation'));
  if (!unitInsp) throw new Error('Unit inspector missing composition/formation');

  await page.evaluate(() => {
    ObserverSystem.observerOpen = true;
    document.getElementById('observerPanel')?.classList.remove('hidden');
    ObserverSystem.rankingTab = 'combat';
    ObserverSystem.renderPanel();
  });
  await page.waitForFunction(() => {
    const html = document.getElementById('observerBody')?.innerHTML || '';
    return html.includes('Duelists') || html.includes('Legendary') || html.includes('Battles');
  }, { timeout: 8000 });

  await page.evaluate(() => {
    const search = document.getElementById('globalSearch');
    if (search) {
      search.value = 'veteran';
      search.dispatchEvent(new Event('input'));
    }
  });
  await page.waitForFunction(() => {
    const box = document.getElementById('searchResults');
    return (box?.innerHTML || '').length > 5;
  }, { timeout: 3000 }).catch(() => {});

  const saved = await page.evaluate(() => {
    SaveSystem.saveToLocalStorage('uitest181', true);
    return (world.battleReports || []).length + (world.legendaryWeapons || []).length;
  });
  await page.evaluate(() => { world.battleReports = []; });
  await page.evaluate(() => SaveSystem.loadWorld());
  const loaded = await page.evaluate(() => Array.isArray(world.battleReports));
  if (!loaded) throw new Error('Combat save/load smoke failed');

  await page.evaluate(() => Renderer.draw());

  if (errors.length) throw new Error('JS errors: ' + errors.join('; '));
  console.log('Phase 18.1 UI smoke test PASSED');
  await browser.close();
  server.kill();
})().catch(e => { console.error('UI test FAILED:', e.message); process.exit(1); });
