/* Phase 11 UI smoke test — Diplomacy */
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '8904'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { await d.accept(); });

  await page.goto('http://127.0.0.1:8904/index.html', { waitUntil: 'networkidle0' });

  const overlay = await page.evaluate(() => {
    const ov = document.getElementById('continueOverlay');
    return ov && !ov.classList.contains('hidden');
  });
  if (overlay) await page.evaluate(() => document.getElementById('btnNewWorldOverlay').click());
  await page.waitForFunction(() => world && world.day >= 0, { timeout: 10000 });

  await page.evaluate(() => {
    const f2 = createFaction({ name: 'อาณาจักรทดสอบ', color: '#26a69a', treasury: 400 });
    const town = createSettlement({ name: 'เมืองทดสอบ', type: 'town', x: 120, y: 90, factionId: f2.id, treasury: 200, stock: { food: 50 } });
    const k = createAgent({ locationId: town.id, factionId: f2.id, profession: 'king' });
    f2.rulerId = k.id;
    DiplomacySystem.initWorld();
    DiplomacySystem.forceAlliance(world.factions.find(f => !f.isBandit && f.id !== f2.id), f2);
  });

  await page.click('#btnDiplomacy');
  await page.waitForSelector('#diplomacyPanel:not(.hidden)');
  const dipHtml = await page.$eval('#diplomacyBody', el => el.innerHTML);
  if (!dipHtml.includes('อาณาจักร') && !dipHtml.includes('alliance')) throw new Error('Diplomacy panel empty');

  const fId = await page.evaluate(() => world.factions.find(f => !f.isBandit).id);
  await page.evaluate((id) => {
    UI.selected = { kind: 'faction', id };
    UI.inspectorDirty = true;
    UI.renderInspector();
  }, fId);
  const insp = await page.$eval('#inspectorBody', el => el.innerHTML);
  if (!insp.includes('War Exhaustion') && !insp.includes('Diplomatic')) throw new Error('Faction inspector missing diplomacy');

  await page.evaluate(() => SandboxTools.activate('breakTreaty', { classList: { add() {} } }));
  await page.evaluate(() => {
    const payload = SaveSystem.buildSavePayload('export');
    localStorage.setItem('livingKingdomSandbox_save', JSON.stringify(payload));
  });
  await page.evaluate(() => generateWorld());
  await page.evaluate(() => SaveSystem.loadFromPayload(JSON.parse(localStorage.getItem('livingKingdomSandbox_save'))));

  const treaties = await page.evaluate(() => (world.treaties || []).length);
  if (treaties < 1) throw new Error('Treaties lost after save/load');

  if (errors.length) throw new Error('JS errors: ' + errors.join('; '));
  console.log('Phase 11 UI smoke test PASSED');
  await browser.close();
  server.kill();
})().catch(e => { console.error('UI test FAILED:', e.message); process.exit(1); });
