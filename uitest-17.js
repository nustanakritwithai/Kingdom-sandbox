/* Phase 17 UI smoke test — Agent memory / relationships */
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '8917'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { await d.accept(); });

  await page.goto('http://127.0.0.1:8917/index.html', { waitUntil: 'networkidle0' });
  const overlay = await page.evaluate(() => {
    const ov = document.getElementById('continueOverlay');
    return ov && !ov.classList.contains('hidden');
  });
  if (overlay) await page.evaluate(() => document.getElementById('btnNewWorldOverlay').click());
  await page.waitForFunction(() => world && world.day >= 0, { timeout: 10000 });

  for (let i = 0; i < 20; i++) await page.evaluate(() => simulateDay());

  await page.evaluate(() => {
    const a = world.agents.find(x => x.alive);
    const b = world.agents.find(x => x.alive && x.id !== a.id);
    addGrudge(a, b.id, 'uitest', 25);
    addLoyalty(a, b.id, 'uitest', 20);
    AgentMemorySystem.updateMotives(a);
    const s = world.settlements.find(x => x.type === 'town');
    AgentMemorySystem.noteSettlementHero(s, a.id, 15, 'UITest hero');
    AgentMemorySystem.noteSettlementVillain(s, b.id, 12, 'UITest villain');
    UI.selected = { kind: 'agent', id: a.id };
    UI.inspectorDirty = true;
    UI.renderInspector();
  });

  await page.waitForFunction(() => document.getElementById('inspectorBody').innerHTML.includes('Core Motives'), { timeout: 5000 });
  const hasRel = await page.$eval('#inspectorBody', el => el.innerHTML.includes('Relationships') || el.innerHTML.includes('Grudges'));
  if (!hasRel) throw new Error('Agent inspector missing relationships');

  await page.evaluate(() => {
    const cb = document.getElementById('showRelLines');
    if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
    UI.showRelationLines = true;
  });

  await page.evaluate(() => {
    const link = document.querySelector('#inspectorBody .insp-link');
    if (link) link.click();
  });
  await page.waitForFunction(() => {
    const t = document.getElementById('inspectorTitle').textContent;
    return t && t.startsWith('👤');
  }, { timeout: 5000 });

  await page.evaluate(() => {
    const s = world.settlements.find(x => x.type === 'town');
    UI.selected = { kind: 'settlement', id: s.id };
    UI.inspectorDirty = true;
    UI.renderInspector();
  });
  const sentMem = await page.$eval('#inspectorBody', el => el.innerHTML.includes('Citizen Memory') || el.innerHTML.includes('Hero'));
  if (!sentMem) throw new Error('Settlement inspector missing sentiment');

  await page.click('#btnObserver');
  await page.waitForSelector('#observerPanel:not(.hidden)');
  await page.click('.obs-tab[data-tab="personalities"]');
  await page.waitForFunction(() => document.getElementById('observerBody').innerHTML.length > 30, { timeout: 5000 });

  await page.evaluate(() => SaveSystem.saveToLocalStorage('test', true));
  const before = await page.evaluate(() => {
    const a = world.agents.find(x => x.alive);
    return { grudges: a.memory.personal.grudges.length, rels: Object.keys(a.relationships).length };
  });
  await page.evaluate(() => {
    const a = world.agents.find(x => x.alive);
    a.memory.personal.grudges = [];
    a.relationships = {};
  });
  await page.evaluate(() => SaveSystem.loadWorld());
  const after = await page.evaluate(() => {
    const a = world.agents.find(x => x.alive);
    return { grudges: a.memory.personal.grudges.length, rels: Object.keys(a.relationships).length };
  });
  if (before.grudges > 0 && after.grudges < before.grudges) throw new Error('Memory lost after load');

  if (errors.length) throw new Error('JS errors: ' + errors.join('; '));
  console.log('Phase 17 UI smoke test PASSED');
  await browser.close();
  server.kill();
})().catch(e => { console.error('UI test FAILED:', e.message); process.exit(1); });
