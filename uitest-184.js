/* Phase 18.4 UI smoke test */
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '8940'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { await d.accept(); });

  await page.goto('http://127.0.0.1:8940/index.html', { waitUntil: 'networkidle0' });
  const overlay = await page.evaluate(() => {
    const ov = document.getElementById('continueOverlay');
    return ov && !ov.classList.contains('hidden');
  });
  if (overlay) await page.evaluate(() => document.getElementById('btnNewWorldOverlay').click());
  await page.waitForFunction(() => world && world.settlements.length > 0, { timeout: 10000 });

  await page.click('#btnCharacters');
  await page.waitForFunction(() => UI.currentView === 'characters' && document.getElementById('pageContainer').innerHTML.length > 100, { timeout: 8000 });
  const charPage = await page.$eval('#pageContainer', el => el.innerHTML.includes('Characters') || el.innerHTML.includes('ตัวตน'));
  if (!charPage) throw new Error('Characters page failed');

  await page.evaluate(() => {
    const a = world.agents.find(x => x.alive);
    PageViewSystem.prefs.characters.selectedId = a.id;
    PageViewSystem.renderCurrent();
  });
  const charDetail = await page.$eval('#pageContainer', el =>
    el.innerHTML.includes('อาชีพ') || el.innerHTML.includes('สมาชิกภาพ') || el.innerHTML.includes('B.'));
  if (!charDetail) throw new Error('Character detail missing');

  await page.click('#btnOrganizationsPage');
  await page.waitForFunction(() => UI.currentView === 'organizations', { timeout: 5000 });
  await page.evaluate(() => {
    const s = world.settlements[0];
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(createAgent({ locationId: s.id, profession: 'guard', factionId: s.factionId }).id);
    const org = createOrganization({ name: 'UI WB', type: 'militia_company', homeSettlementId: s.id, memberIds: [] });
    const wb = WarbandSystem.createFromMembers(org, ids, { locationId: s.id });
    PageViewSystem.prefs.organizations.tab = 'warbands';
    PageViewSystem.prefs.organizations.selectedId = 'wb:' + wb.id;
    PageViewSystem.renderCurrent();
  });
  const wbDetail = await page.$eval('#pageContainer', el =>
    el.innerHTML.includes('เสบียง') || el.innerHTML.includes('การเคลื่อนที่') || el.innerHTML.includes('องค์ประกอบ'));
  if (!wbDetail) throw new Error('Warband detail missing');

  await page.click('#btnCombat');
  await page.waitForFunction(() => UI.currentView === 'combat', { timeout: 5000 });
  await page.evaluate(() => {
    const u1 = world.units.find(u => unitMembers(u).length >= 2);
    const u2 = world.units.find(u => u.id !== u1?.id && unitMembers(u).length >= 2);
    if (u1 && u2) MilitarySystem.battle([u1], [u2], { settlementId: world.settlements[0].id, label: 'UI', terrain: 'plain', title: 'UI Battle' });
    const br = world.battleReports.slice(-1)[0];
    if (br) { PageViewSystem.prefs.combat.selectedId = br.id; PageViewSystem.renderCurrent(); }
  });
  const combatDetail = await page.$eval('#pageContainer', el =>
    el.innerHTML.includes('ภาพรวม') || el.innerHTML.includes('Phase') || el.innerHTML.includes('battle-grid'));
  if (!combatDetail) throw new Error('Battle detail missing');

  await page.evaluate(() => {
    const btn = document.querySelector('[data-page-action="map"]');
    if (btn) btn.click();
  });
  await page.waitForFunction(() => UI.currentView === 'map', { timeout: 5000 });

  await page.setViewport({ width: 390, height: 844 });
  await page.click('#btnCharacters');
  await page.waitForFunction(() => UI.currentView === 'characters', { timeout: 5000 });
  const mobile = await page.$eval('#pageContainer', el => el.querySelector('.mobile-stack') != null || el.innerHTML.length > 50);
  if (!mobile) throw new Error('Mobile viewport failed');

  await page.evaluate(() => SaveSystem.saveToLocalStorage('uitest184', true));
  await page.evaluate(() => {
    const p = SaveSystem.getSaveMeta();
    SaveSystem.loadFromPayload(p);
  });
  const schema = await page.evaluate(() => SaveSystem.getSaveMeta()?.schemaVersion);
  if (schema !== '18.4') throw new Error('Save schema not 18.4');

  if (errors.length) throw new Error('JS errors: ' + errors.join('; '));
  console.log('Phase 18.4 UI smoke test PASSED');
  await browser.close();
  server.kill();
  process.exit(0);
})().catch(e => {
  console.error('UITEST FAILED:', e.message);
  process.exit(1);
});
