/* Phase 18.3 UI smoke test */
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '8930'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { await d.accept(); });

  await page.goto('http://127.0.0.1:8930/index.html', { waitUntil: 'networkidle0' });
  const overlay = await page.evaluate(() => {
    const ov = document.getElementById('continueOverlay');
    return ov && !ov.classList.contains('hidden');
  });
  if (overlay) await page.evaluate(() => document.getElementById('btnNewWorldOverlay').click());
  await page.waitForFunction(() => world && world.settlements.length > 0, { timeout: 10000 });

  await page.evaluate(() => {
    if (typeof SandboxTools !== 'undefined') SandboxTools.activate('createRecruitmentOffer', { classList: { add() {}, remove() {} } });
  });
  await page.evaluate(() => {
    const s = world.settlements.find(x => x.type === 'town') || world.settlements[0];
    const before = world.agents.length;
    const org = createOrganization({ name: 'UI Test Co', type: 'mercenary_company', homeSettlementId: s.id, memberIds: [] });
    OrganizationSystem.postRecruitmentOffer(org, { settlementId: s.id, quantityNeeded: 4 });
    return { before, after: world.agents.length, offers: world.recruitmentOffers.length };
  });
  const noSpawn = await page.evaluate(() => {
    const offer = world.recruitmentOffers.find(o => o.status === 'open');
    return { offers: world.recruitmentOffers.length, hasOffer: !!offer };
  });
  if (!noSpawn.hasOffer) throw new Error('Recruitment offer not created');

  await page.evaluate(() => {
    ObserverSystem.observerOpen = true;
    document.getElementById('observerPanel')?.classList.remove('hidden');
    ObserverSystem.rankingTab = 'organizations';
    ObserverSystem.renderPanel();
  });
  await page.waitForFunction(() => {
    const html = document.getElementById('observerBody')?.innerHTML || '';
    return html.includes('Organizations') || html.includes('องค์กร') || html.includes('mercenary');
  }, { timeout: 8000 });

  await page.evaluate(() => {
    ObserverSystem.rankingTab = 'warbands';
    ObserverSystem.renderPanel();
  });
  const warTab = await page.$eval('#observerBody', el => el.innerHTML.includes('Warbands') || el.innerHTML.includes('warband'));
  if (!warTab) throw new Error('Warbands tab failed');

  await page.evaluate(() => {
    const s = world.settlements[0];
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(createAgent({ locationId: s.id, profession: 'guard', factionId: s.factionId }).id);
    const org = createOrganization({ name: 'WB Test', type: 'militia_company', homeSettlementId: s.id, memberIds: [] });
    const wb = WarbandSystem.createFromMembers(org, ids, { locationId: s.id });
    UI.selected = { kind: 'warband', id: wb.id };
    UI.inspectorDirty = true;
    UI.renderInspector();
    Renderer.draw();
  });
  const insp = await page.$eval('#inspectorBody', el =>
    el.innerHTML.includes('Warband') && el.innerHTML.includes('Real size'));
  if (!insp) throw new Error('Warband inspector missing fields');

  await page.evaluate(() => {
    if (typeof SandboxTools !== 'undefined') SandboxTools.activate('spawnWarbandFromAgents', { classList: { add() {}, remove() {} } });
    SandboxTools.activate('forceWarbandMarch', { classList: { add() {}, remove() {} } });
  });

  await page.evaluate(() => SaveSystem.saveToLocalStorage('uitest183', true));
  const dayBefore = await page.evaluate(() => world.day);
  await page.evaluate(() => {
    const p = SaveSystem.getSaveMeta();
    SaveSystem.loadFromPayload(p);
  });
  const loaded = await page.evaluate(() => ({
    schema: '18.3',
    orgs: (world.organizations || []).length,
    day: world.day
  }));
  if (loaded.day !== dayBefore) throw new Error('Save/load day mismatch');

  if (errors.length) throw new Error('JS errors: ' + errors.join('; '));
  console.log('Phase 18.3 UI smoke test PASSED');
  await browser.close();
  server.kill();
})().catch(e => { console.error('UI test FAILED:', e.message); process.exit(1); });
