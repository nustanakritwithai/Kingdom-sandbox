/* Phase 12 UI smoke test — Market / Guilds panel */
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '8912'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { await d.accept(); });

  await page.goto('http://127.0.0.1:8912/index.html', { waitUntil: 'networkidle0' });

  const overlay = await page.evaluate(() => {
    const ov = document.getElementById('continueOverlay');
    return ov && !ov.classList.contains('hidden');
  });
  if (overlay) await page.evaluate(() => document.getElementById('btnNewWorldOverlay').click());
  await page.waitForFunction(() => world && world.day >= 0, { timeout: 10000 });

  for (let i = 0; i < 30; i++) await page.evaluate(() => simulateDay());

  await page.click('#btnMarket');
  await page.waitForSelector('#marketPanel:not(.hidden)');
  const mktBody = await page.$eval('#marketPanelBody', el => el.innerHTML.length);
  if (mktBody < 20) throw new Error('Market panel empty');

  await page.evaluate(() => {
    const town = world.settlements.find(s => s.type === 'town');
    if (town) {
      town.marketRole.isMarketHub = true;
      town.marketRole.hubLevel = 2;
      town.marketRole.tradeInfluence = 80;
    }
    MarketTradeSystem.renderMarketPanel();
  });
  await page.waitForFunction(() => document.querySelectorAll('#marketPanelBody .obs-row').length > 0, { timeout: 5000 });
  await page.evaluate(() => document.querySelector('#marketPanelBody .obs-row').click());

  await page.click('#btnObserver');
  await page.waitForSelector('#observerPanel:not(.hidden)');
  await page.click('.obs-tab[data-tab="market"]');
  await page.waitForFunction(() => document.getElementById('observerBody').innerHTML.includes('Market Hubs'), { timeout: 5000 });
  await page.click('.obs-tab[data-tab="guild"]');
  await page.click('.obs-tab[data-tab="contracts"]');

  await page.click('#btnTools');
  await page.waitForSelector('#toolPanel:not(.hidden)');
  const town = await page.evaluate(() => world.settlements.find(s => s.type === 'town'));
  await page.evaluate((tid) => {
    const s = world.settlements.find(x => x.id === tid);
    if (!s) return;
    MarketTradeSystem.ensureSettlementMarket(s);
    s.marketRole.isMarketHub = true;
    s.marketRole.hubLevel = 3;
    if (!s.buildings.includes('Market')) s.buildings.push('Market');
    createWarehouse({ settlementId: s.id, ownerType: 'settlement', ownerId: s.id, capacity: 150 });
    for (let i = 0; i < 3; i++) {
      const t = createAgent({ locationId: s.id, factionId: s.factionId, profession: 'trader', money: 200 });
      t.memory.tradeProfit = 200;
    }
    MarketTradeSystem.trySpawnGuild(s);
    MarketTradeSystem.renderMarketPanel();
  }, town.id);

  await page.click('#btnMarket');
  await page.waitForSelector('#marketPanel:not(.hidden)');

  await page.evaluate(() => SaveSystem.saveToLocalStorage('test', true));
  const before = await page.evaluate(() => ({
    guilds: (world.guilds || []).length,
    contracts: (world.tradeContracts || []).length,
    hubs: world.settlements.filter(s => s.marketRole?.isMarketHub).length
  }));
  await page.evaluate(() => {
    world.guilds = [];
    world.tradeContracts = [];
    world.settlements.forEach(s => { if (s.marketRole) s.marketRole.isMarketHub = false; });
  });
  await page.evaluate(() => SaveSystem.loadWorld());
  const after = await page.evaluate(() => ({
    guilds: (world.guilds || []).length,
    contracts: (world.tradeContracts || []).length,
    hubs: world.settlements.filter(s => s.marketRole?.isMarketHub).length
  }));
  if (after.guilds < before.guilds && before.guilds > 0) throw new Error('Guild data lost after load');
  if (after.hubs < before.hubs && before.hubs > 0) throw new Error('Hub data lost after load');

  if (errors.length) throw new Error('JS errors: ' + errors.join('; '));
  console.log('Phase 12 UI smoke test PASSED');
  await browser.close();
  server.kill();
})().catch(e => { console.error('UI test FAILED:', e.message); process.exit(1); });
