/* Phase 19 UI smoke test — run: node uitest-19.js */
'use strict';
const { withBrowserTest } = require('./test-utils/ui-launch');
const { createTestSandbox, run, createTestReporter } = require('./test-utils/dom-mock');

const sb = createTestSandbox();
if (run(sb, 'typeof CourtSystem === "undefined"')) {
  console.log('SKIP UI uitest-19.js: CourtSystem not in this build');
  process.exit(0);
}

(async () => {
  const result = await withBrowserTest(8952, __dirname, async (page) => {
    await page.goto('http://127.0.0.1:8952/index.html', { waitUntil: 'networkidle0', timeout: 20000 });
    const overlay = await page.evaluate(() => document.getElementById('continueOverlay')?.classList.contains('hidden') === false);
    if (overlay) await page.evaluate(() => document.getElementById('btnNewWorldOverlay')?.click());
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

    const schema = await page.evaluate(() => SAVE_SCHEMA_VERSION);
    await page.evaluate(() => SaveSystem.saveToLocalStorage('uitest19', true));
    const savedSchema = await page.evaluate(() => SaveSystem.getSaveMeta()?.schemaVersion);
    if (savedSchema !== schema) throw new Error('schema mismatch: expected ' + schema + ' got ' + savedSchema);

    const loaded = await page.evaluate(() => {
      const p = SaveSystem.buildSavePayload('uitest19');
      SaveSystem.loadFromPayload(p);
      return p.schemaVersion;
    });
    if (loaded !== schema) throw new Error('save/load schema broken');
  });

  if (result.status === 'SKIP') {
    console.log('SKIP UI uitest-19.js:', result.reason);
    process.exit(0);
  }
  if (result.status === 'FAIL') throw new Error(result.reason);
  console.log('Phase 19 UI smoke test PASSED');
  process.exit(0);
})().catch(e => {
  console.error('UITEST FAILED:', e.message);
  process.exit(1);
});
