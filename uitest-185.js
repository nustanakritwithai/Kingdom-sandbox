/* Phase 18.5 UI smoke test — run: node uitest-185.js */
'use strict';
const { withBrowserTest } = require('./test-utils/ui-launch');

(async () => {
  const result = await withBrowserTest(8951, __dirname, async (page) => {
    await page.goto('http://127.0.0.1:8951/index.html', { waitUntil: 'networkidle0', timeout: 20000 });
    const overlay = await page.evaluate(() => document.getElementById('continueOverlay')?.classList.contains('hidden') === false);
    if (overlay) await page.evaluate(() => document.getElementById('btnNewWorldOverlay')?.click());
    await page.waitForFunction(() => world && world.settlements.length > 0, { timeout: 10000 });

    await page.evaluate(() => {
      ObserverSystem.renderMiniDashboard();
      document.getElementById('summaryModal')?.classList.remove('hidden');
      UI.renderWorldSummary();
    });
    const health = await page.$eval('#miniDashboard', el => el.innerHTML.includes('caravan') || el.innerHTML.includes('armies'));
    if (!health) throw new Error('Observer liveness dashboard missing (caravan/armies)');

    await page.evaluate(() => {
      if (typeof SovereigntySystem !== 'undefined') SovereigntySystem.validateNoGhostOwners();
      document.getElementById('btnShowStuck')?.click();
      document.getElementById('btnShowSov')?.click();
    });

    await page.evaluate(() => {
      const org = world.organizations.find(o => o.sovereignty);
      if (org) { UI.selected = { kind: 'organization', id: org.id }; UI.inspectorDirty = true; UI.renderInspector(); }
    });

    const schema = await page.evaluate(() => SAVE_SCHEMA_VERSION);
    await page.evaluate(() => SaveSystem.saveToLocalStorage('uitest185', true));
    const savedSchema = await page.evaluate(() => SaveSystem.getSaveMeta()?.schemaVersion);
    if (savedSchema !== schema) throw new Error('schema not ' + schema + ': ' + savedSchema);

    await page.evaluate(() => {
      if (typeof SandboxTools !== 'undefined' && SandboxTools.activate) {
        SandboxTools.activate('runIntegrityCheck', { classList: { add() {}, remove() {} } });
      }
    });
  });

  if (result.status === 'SKIP') {
    console.log('SKIP UI uitest-185.js:', result.reason);
    process.exit(0);
  }
  if (result.status === 'FAIL') throw new Error(result.reason);
  console.log('Phase 18.5 UI smoke test PASSED');
  process.exit(0);
})().catch(e => {
  console.error('UITEST FAILED:', e.message);
  process.exit(1);
});
