/* Phase 18.4B UI smoke test */
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '8950'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { await d.accept(); });

  await page.goto('http://127.0.0.1:8950/index.html', { waitUntil: 'networkidle0' });
  const overlay = await page.evaluate(() => document.getElementById('continueOverlay')?.classList.contains('hidden') === false);
  if (overlay) await page.evaluate(() => document.getElementById('btnNewWorldOverlay').click());
  await page.waitForFunction(() => world && world.settlements.length > 0, { timeout: 10000 });

  await page.evaluate(() => {
    const s = world.settlements.find(x => x.type === 'village');
    const leader = createAgent({ locationId: s.id, profession: 'guard', factionId: s.factionId });
    leader.skills.leadership = 4;
    leader.traits.ambition = 0.75;
    leader.stats.wealth = 60;
    const wb = SovereigntySystem.foundWarbandFromAgent(leader, 'hunt_bandits');
    if (!wb) throw new Error('warband not founded');
    UI.selected = { kind: 'warband', id: wb.id };
    UI.inspectorDirty = true;
    UI.renderInspector();
  });
  const wbInsp = await page.$eval('#inspectorBody', el =>
    el.innerHTML.includes('Political Authority') && el.innerHTML.includes('Can capture'));
  if (!wbInsp) throw new Error('Warband political authority missing');

  await page.evaluate(() => {
    const org = world.organizations.find(o => o.sovereignty);
    if (org) {
      UI.selected = { kind: 'organization', id: org.id };
      UI.inspectorDirty = true;
      UI.renderInspector();
    }
  });
  const orgInsp = await page.$eval('#inspectorBody', el => el.innerHTML.includes('Sovereignty') || el.innerHTML.includes('landed'));
  if (!orgInsp) throw new Error('Organization sovereignty missing');

  await page.evaluate(() => {
    const s = world.settlements.find(x => x.type === 'town' || x.type === 'village');
    UI.selected = { kind: 'settlement', id: s.id };
    UI.inspectorDirty = true;
    UI.renderInspector();
  });
  const setInsp = await page.$eval('#inspectorBody', el => el.innerHTML.includes('Owner Organization') || el.innerHTML.includes('Local Lord'));
  if (!setInsp) throw new Error('Settlement ownership missing');

  await page.evaluate(() => SaveSystem.saveToLocalStorage('uitest184b', true));
  const schema = await page.evaluate(() => SaveSystem.getSaveMeta()?.schemaVersion);
  if (schema !== '18.6' && schema !== '18.5') throw new Error('schema not 18.6: ' + schema);

  if (errors.length) throw new Error(errors.join('; '));
  console.log('Phase 18.4B UI smoke test PASSED');
  await browser.close();
  server.kill();
  process.exit(0);
})().catch(e => {
  console.error('UITEST FAILED:', e.message);
  process.exit(1);
});
