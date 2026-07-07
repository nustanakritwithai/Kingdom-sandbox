/* Phase 19 UI smoke test — run: node uitest-19.js */
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '8952'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { await d.accept(); });

  await page.goto('http://127.0.0.1:8952/index.html', { waitUntil: 'networkidle0' });
  const overlay = await page.evaluate(() => document.getElementById('continueOverlay')?.classList.contains('hidden') === false);
  if (overlay) await page.evaluate(() => document.getElementById('btnNewWorldOverlay').click());
  await page.waitForFunction(() => world && world.settlements.length > 0, { timeout: 10000 });

  await page.evaluate(() => {
    let org = world.organizations.find(o => o.sovereignty?.status === 'landed');
    if (!org) org = world.organizations[0];
    const s = world.settlements.find(x => x.type === 'village');
    if (s && org) {
      s.ownerOrganizationId = org.id;
      s.taxRecipient = org.id;
      SovereigntySystem.updateOrganizationSovereignty(org);
    }
    CourtSystem.ensureCourt(org);
    PageViewSystem.prefs.organizations.tab = 'organizations';
    PageViewSystem.prefs.organizations.selectedId = org.id;
    UI.setView('organizations');
    PageViewSystem.renderCurrent();
  });

  const orgCourt = await page.evaluate(() => document.getElementById('pageContainer')?.innerHTML.includes('สำนัก'));
  if (!orgCourt) throw new Error('Organization Court section missing');

  await page.evaluate(() => {
    const org = world.organizations.find(o => o.court);
    let agentId = org?.court?.courtMemberIds?.find(id => id !== org.leaderId);
    if (!agentId) agentId = org?.memberIds?.find(id => id !== org?.leaderId);
    if (!agentId) agentId = world.agents.find(a => a.alive)?.id;
    PageViewSystem.prefs.characters.selectedId = agentId;
    UI.setView('characters');
    PageViewSystem.renderCurrent();
  });
  const politics = await page.evaluate(() => document.getElementById('pageContainer')?.innerHTML.includes('Politics'));
  if (!politics) throw new Error('Character Politics section missing');

  await page.evaluate(() => {
    document.getElementById('summaryModal')?.classList.remove('hidden');
    UI.renderWorldSummary();
  });
  const courtSummary = await page.$eval('#summaryBody', el => el.innerHTML.includes('Court Politics'));
  if (!courtSummary) throw new Error('World Summary court stability missing');

  await page.evaluate(() => {
    SandboxTools.activate('nameHeir', { classList: { add() {}, remove() {} } });
    SandboxTools.activate('triggerSuccessionCrisis', { classList: { add() {}, remove() {} } });
    SandboxTools.activate('openUnstableCourt', { classList: { add() {}, remove() {} } });
  });

  await page.evaluate(() => {
    const org = world.organizations.find(o => o.court);
    const memberId = org?.court?.courtMemberIds?.find(id => id !== org.leaderId);
    if (memberId && typeof openEntityDetail === 'function') openEntityDetail('agent', memberId);
  });

  await page.evaluate(() => SaveSystem.saveToLocalStorage('uitest19', true));
  const schema = await page.evaluate(() => SaveSystem.getSaveMeta()?.schemaVersion);
  if (schema !== '19.0') throw new Error('schema not 19.0: ' + schema);

  const payload = await page.evaluate(() => {
    const p = SaveSystem.buildSavePayload('uitest19');
    SaveSystem.loadFromPayload(p);
    return p.schemaVersion;
  });
  if (payload !== '19.0') throw new Error('save/load schema broken');

  if (errors.length) throw new Error(errors.join('; '));
  console.log('Phase 19 UI smoke test PASSED');
  await browser.close();
  server.kill();
  process.exit(0);
})().catch(e => {
  console.error('UITEST FAILED:', e.message);
  process.exit(1);
});
