/* Phase 18.5 UI smoke test */
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '8951'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { await d.accept(); });

  await page.goto('http://127.0.0.1:8951/index.html', { waitUntil: 'networkidle0' });
  const overlay = await page.evaluate(() => document.getElementById('continueOverlay')?.classList.contains('hidden') === false);
  if (overlay) await page.evaluate(() => document.getElementById('btnNewWorldOverlay').click());
  await page.waitForFunction(() => world && world.settlements.length > 0, { timeout: 10000 });

  await page.evaluate(() => {
    document.getElementById('summaryModal')?.classList.remove('hidden');
    UI.renderWorldSummary();
  });
  const health = await page.$eval('#summaryBody', el => el.innerHTML.includes('World Health'));
  if (!health) throw new Error('World Health section missing');

  await page.evaluate(() => {
    WorldIntegritySystem.runCheck({ repair: true, reason: 'uitest' });
    document.getElementById('btnShowStuck')?.click();
    document.getElementById('btnShowSov')?.click();
  });

  await page.evaluate(() => {
    const org = world.organizations.find(o => o.sovereignty);
    if (org) { UI.selected = { kind: 'organization', id: org.id }; UI.inspectorDirty = true; UI.renderInspector(); }
  });

  await page.evaluate(() => SaveSystem.saveToLocalStorage('uitest185', true));
  const schema = await page.evaluate(() => SaveSystem.getSaveMeta()?.schemaVersion);
  if (schema !== '18.6') throw new Error('schema not 18.6: ' + schema);

  await page.evaluate(() => SandboxTools.activate('runIntegrityCheck', { classList: { add() {}, remove() {} } }));

  if (errors.length) throw new Error(errors.join('; '));
  console.log('Phase 18.5 UI smoke test PASSED');
  await browser.close();
  server.kill();
  process.exit(0);
})().catch(e => {
  console.error('UITEST FAILED:', e.message);
  process.exit(1);
});
