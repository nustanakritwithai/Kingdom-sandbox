/* Phase 18 UI smoke test — Campaign warfare / supply lines */
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '8918'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { await d.accept(); });

  await page.goto('http://127.0.0.1:8918/index.html', { waitUntil: 'networkidle0' });
  const overlay = await page.evaluate(() => {
    const ov = document.getElementById('continueOverlay');
    return ov && !ov.classList.contains('hidden');
  });
  if (overlay) await page.evaluate(() => document.getElementById('btnNewWorldOverlay').click());
  await page.waitForFunction(() => world && world.day >= 0, { timeout: 10000 });

  await page.evaluate(() => {
    const ks = world.factions.filter(f => !f.isBandit);
    if (ks.length >= 2) DiplomacySystem.declareWar(ks[0], ks[1], 'uitest');
    const cap = world.settlements.find(s => s.factionId === ks[0].id && (s.type === 'castle' || s.type === 'town'));
    const tgt = world.settlements.find(s => s.factionId === ks[1].id && s.type !== 'camp');
    const cmd = world.agents.find(a => a.alive && a.factionId === ks[0].id);
    if (cap && tgt && cmd) {
      const u = createUnit({ name: 'UI Unit', kind: 'field', leaderId: cmd.id, memberIds: [cmd.id], factionId: ks[0].id, locationId: cap.id, food: 30 });
      const ar = createArmy({ name: 'UI Army', commanderId: cmd.id, factionId: ks[0].id, unitIds: [u.id], locationId: cap.id, objective: { type: 'attack', targetId: tgt.id }, food: 80, baseSettlementId: cap.id });
      CampaignWarfareSystem.createSupplyLine(ar, cap.id, tgt.id);
      CampaignWarfareSystem.spawnScoutUnit(ar);
    }
  });

  await page.evaluate(() => {
    ObserverSystem.observerOpen = true;
    document.getElementById('observerPanel')?.classList.remove('hidden');
    ObserverSystem.rankingTab = 'campaigns';
    ObserverSystem.renderPanel();
  });
  await page.waitForFunction(() => {
    const html = document.getElementById('observerBody')?.innerHTML || '';
    return html.length > 20;
  }, { timeout: 8000 });

  await page.evaluate(() => {
    const ar = world.armies[0];
    if (!ar) return;
    UI.selected = { kind: 'army', id: ar.id };
    UI.inspectorDirty = true;
    UI.renderInspector();
  });
  const armyInsp = await page.$eval('#inspectorBody', el => el.innerHTML.includes('Supply Line') || el.innerHTML.includes('Strategy') || el.innerHTML.includes('War Goal'));
  if (!armyInsp) throw new Error('Army inspector missing campaign data');

  await page.evaluate(() => {
    const ar = world.armies[0];
    const sl = ar?.supplyLineId ? CampaignWarfareSystem.getSupplyLine(ar.supplyLineId) : null;
    if (sl) CampaignWarfareSystem.cutSupplyLine(sl, '[UITest] cut');
    Renderer.draw();
  });

  const savedLines = await page.evaluate(() => {
    SaveSystem.saveToLocalStorage('uitest', true);
    return world.supplyLines.length;
  });
  await page.evaluate(() => { world.supplyLines = []; world.scoutReports = []; });
  await page.evaluate(() => SaveSystem.loadWorld());
  const loaded = await page.evaluate(() => world.supplyLines.length);
  if (savedLines > 0 && loaded < savedLines) throw new Error('Campaign data lost after load');

  await page.evaluate(() => Renderer.draw());

  if (errors.length) throw new Error('JS errors: ' + errors.join('; '));
  console.log('Phase 18 UI smoke test PASSED');
  await browser.close();
  server.kill();
})().catch(e => { console.error('UI test FAILED:', e.message); process.exit(1); });
