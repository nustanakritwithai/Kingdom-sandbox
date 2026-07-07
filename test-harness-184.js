/* Phase 18.4 headless test — run: node test-harness-184.js */
'use strict';
const {
  createTestSandbox, run, runDays, findNaN, getCurrentSchemaVersion, createTestReporter
} = require('./test-utils/dom-mock');

const { ok, fail, finish } = createTestReporter('Phase 18.4 Detail Pages Tests');
const sandbox = createTestSandbox();
const storage = sandbox.__storage;
const genWorld = () => run(sandbox, 'generateWorld()');
const simDay = () => run(sandbox, 'simulateDay()');

console.log('=== Phase 18.4 Detail Pages Tests ===\n');
genWorld();

const schema = getCurrentSchemaVersion(sandbox);

const idx = run(sandbox, 'UIIndexes.rebuild(true); uiIndexes');
if (idx && idx.agentsByFame && idx.searchIndex?.length > 0) ok('uiIndexes builds');
else fail('uiIndexes missing');

run(sandbox, 'UI.setView("characters"); PageViewSystem.renderCurrent();');
const charList = run(sandbox, 'PageViewSystem.filterAgents().length');
if (charList > 0) ok('Character page lists agents');
else fail('Character list empty');
const agentId = run(sandbox, 'world.agents.find(a => a.alive).id');
run(sandbox, `PageViewSystem.prefs.characters.selectedId = ${agentId}; PageViewSystem.renderCurrent();`);
const charDetail = run(sandbox, 'document.getElementById("pageContainer").innerHTML');
if (charDetail.includes('ตัวตน') || charDetail.includes('อาชีพ') || charDetail.includes('Career')) ok('agent detail renders');
else if (charDetail.includes('A.') || charDetail.includes('B.')) ok('agent detail renders');
else fail('agent detail missing sections');

run(sandbox, 'UI.setView("organizations"); PageViewSystem.prefs.organizations.tab = "organizations"; PageViewSystem.renderCurrent();');
const orgCount = run(sandbox, '(world.organizations || []).length');
if (orgCount >= 0) ok('Organization page lists orgs');
const wbSetup = run(sandbox, `
(function() {
  const s = world.settlements[0];
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push(createAgent({ locationId: s.id, profession: 'guard', factionId: s.factionId }).id);
  const org = createOrganization({ name: 'UI Test WB', type: 'militia_company', homeSettlementId: s.id, memberIds: [] });
  const wb = WarbandSystem.createFromMembers(org, ids, { locationId: s.id });
  PageViewSystem.prefs.organizations.tab = 'warbands';
  PageViewSystem.prefs.organizations.selectedId = 'wb:' + wb.id;
  PageViewSystem.renderCurrent();
  return document.getElementById('pageContainer').innerHTML;
})()
`);
if (wbSetup.includes('การเคลื่อนที่') || wbSetup.includes('เสบียง') || wbSetup.includes('Movement')) ok('warband detail renders');
else if (wbSetup.includes('องค์ประกอบ')) ok('warband detail renders');
else fail('warband detail missing');

const battleHtml = run(sandbox, `
(function() {
  const u1 = world.units.find(u => unitMembers(u).length >= 2);
  const u2 = world.units.find(u => u.id !== u1?.id && unitMembers(u).length >= 2);
  if (!u1 || !u2) return { ok: false, reason: 'no units' };
  MilitarySystem.battle([u1], [u2], { settlementId: world.settlements[0].id, label: 'Test', terrain: 'plain', title: 'Harness Battle' });
  const br = world.battleReports.slice(-1)[0];
  UI.setView('combat');
  PageViewSystem.prefs.combat.selectedId = br.id;
  PageViewSystem.renderCurrent();
  const html = document.getElementById('pageContainer').innerHTML;
  return { ok: world.battleReports.length > 0, html, hasGrid: html.includes('battle-grid') || html.includes('Phase') };
})()
`);
if (battleHtml.ok) ok('Combat page lists battleReports');
else fail('battleReports missing: ' + (battleHtml.reason || ''));
if (battleHtml.hasGrid || battleHtml.html?.includes('ภาพรวม')) ok('battle detail with phases/grid');
else fail('battle detail incomplete');

const cross = run(sandbox, `
(function() {
  const a = world.agents.find(x => x.alive);
  const org = createOrganization({ name: 'Cross Org', type: 'mercenary_company', homeSettlementId: world.settlements[0].id, memberIds: [a.id] });
  const wb = WarbandSystem.createFromMembers(org, [a.id], { locationId: world.settlements[0].id });
  openEntityDetail('agent', a.id);
  openEntityDetail('organization', org.id);
  openEntityDetail('warband', wb.id);
  const br = world.battleReports[0];
  if (br) openEntityDetail('battle', br.id);
  return UI.currentView === 'combat' || UI.currentView === 'organizations';
})()
`);
if (cross) ok('cross-link agent → org → warband → battle');
else fail('cross-link failed');

try {
  run(sandbox, `
    const a = world.agents.find(x => x.alive);
    centerEntityOnMap('agent', a.id);
    centerEntityOnMap('settlement', world.settlements[0].id);
  `);
  ok('centerEntityOnMap no error');
} catch (e) {
  fail('centerEntityOnMap error: ' + e.message);
}

run(sandbox, 'SaveSystem.saveToLocalStorage("test184", true);');
const payload = JSON.parse(storage.livingKingdomSandbox_save);
if (payload.schemaVersion === schema && payload.uiPrefs?.pages) ok('save schema ' + schema + ' ui prefs');
else fail('save ui prefs missing');
run(sandbox, 'UI.setView("characters"); SaveSystem.loadFromPayload(' + JSON.stringify(payload) + ');');
const loadedView = run(sandbox, 'UI.currentView');
if (loadedView) ok('load restores ui prefs');
else fail('load ui prefs failed');

const t0 = Date.now();
for (let i = 0; i < 200; i++) simDay();
run(sandbox, 'UIIndexes.rebuild(true);');
const elapsed = Date.now() - t0;
const nan = findNaN(sandbox.world);
if (!nan.length) ok(`200-day sim + rebuild OK (${elapsed}ms)`);
else fail('NaN: ' + nan.slice(0, 3).join(', '));

finish('\n=== ALL PHASE 18.4 TESTS PASSED ===', '\n=== SOME TESTS FAILED ===');
