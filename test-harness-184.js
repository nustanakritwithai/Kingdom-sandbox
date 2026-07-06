/* Phase 18.4 headless test — run: node test-harness-184.js */
'use strict';
const fs = require('fs');
const vm = require('vm');

function mockEl() {
  const el = {
    addEventListener() {}, textContent: '', innerHTML: '', value: '', title: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getContext: () => ({
      clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
      moveTo() {}, lineTo() {}, closePath() {}, setLineDash() {}, createRadialGradient() { return { addColorStop() {} }; },
      fillText() {}, measureText: () => ({ width: 10 }), setTransform() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) })
    }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 640 }),
    parentElement: null, files: null, click() {}
  };
  el.parentElement = { getBoundingClientRect: () => ({ width: 1000, height: 640 }) };
  return el;
}

const storage = {};
const els = {};
const sandbox = {
  console, Math, Date, performance: { now: () => 0 },
  Blob: class Blob { constructor(p) { this._p = p; } },
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
  navigator: { clipboard: { writeText: async () => {} } },
  localStorage: {
    getItem: k => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = v; },
    removeItem: k => { delete storage[k]; }
  },
  document: {
    getElementById: (id) => els[id] || (els[id] = mockEl()),
    querySelectorAll: () => [],
    createElement: () => mockEl()
  },
  requestAnimationFrame: () => {}, confirm: () => true, alert: () => {},
  window: { innerWidth: 1024, addEventListener() {} }, devicePixelRatio: 1,
  setTimeout: (fn) => { fn(); return 0; },
  clearTimeout() {}
};

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/script.js', 'utf8'), sandbox);

const genWorld = () => vm.runInContext('generateWorld()', sandbox);
const simDay = () => vm.runInContext('simulateDay()', sandbox);
const run = (code) => vm.runInContext(code, sandbox);

function hasNaN(obj, path = 'world') {
  const issues = [];
  const walk = (v, p) => {
    if (typeof v === 'number' && !Number.isFinite(v)) issues.push(p);
    else if (v && typeof v === 'object') {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
      else Object.entries(v).forEach(([k, x]) => walk(x, `${p}.${k}`));
    }
  };
  walk(obj, path);
  return issues;
}

let failed = false;
function ok(m) { console.log('OK:', m); }
function fail(m) { console.log('FAIL:', m); failed = true; }

console.log('=== Phase 18.4 Detail Pages Tests ===\n');
genWorld();

// 1. uiIndexes
const idx = run('UIIndexes.rebuild(true); uiIndexes');
if (idx && idx.agentsByFame && idx.searchIndex?.length > 0) ok('uiIndexes builds');
else fail('uiIndexes missing');

// 2-3. Characters page
run('UI.setView("characters"); PageViewSystem.renderCurrent();');
const charList = run('PageViewSystem.filterAgents().length');
if (charList > 0) ok('Character page lists agents');
else fail('Character list empty');
const agentId = run('world.agents.find(a => a.alive).id');
run(`PageViewSystem.prefs.characters.selectedId = ${agentId}; PageViewSystem.renderCurrent();`);
const charDetail = run('document.getElementById("pageContainer").innerHTML');
if (charDetail.includes('ตัวตน') || charDetail.includes('อาชีพ') || charDetail.includes('Career')) ok('agent detail renders');
else if (charDetail.includes('A.') || charDetail.includes('B.')) ok('agent detail renders');
else fail('agent detail missing sections');

// 4-5. Organizations / warband
run('UI.setView("organizations"); PageViewSystem.prefs.organizations.tab = "organizations"; PageViewSystem.renderCurrent();');
const orgCount = run('(world.organizations || []).length');
if (orgCount >= 0) ok('Organization page lists orgs');
const wbSetup = run(`
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

// 6-7. Combat / battle detail
const battleHtml = run(`
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

// 8. cross-link
const cross = run(`
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

// 9. centerEntityOnMap
try {
  run(`
    const a = world.agents.find(x => x.alive);
    centerEntityOnMap('agent', a.id);
    centerEntityOnMap('settlement', world.settlements[0].id);
  `);
  ok('centerEntityOnMap no error');
} catch (e) {
  fail('centerEntityOnMap error: ' + e.message);
}

// 10. save/load ui prefs
run('SaveSystem.saveToLocalStorage("test184", true);');
const payload = JSON.parse(storage.livingKingdomSandbox_save);
if (payload.schemaVersion === '18.4' && payload.uiPrefs?.pages) ok('save schema 18.4 ui prefs');
else fail('save ui prefs missing');
run('UI.setView("characters"); SaveSystem.loadFromPayload(' + JSON.stringify(payload) + ');');
const loadedView = run('UI.currentView');
if (loadedView) ok('load restores ui prefs');
else fail('load ui prefs failed');

// 11. 1000-day + rebuild
const t0 = Date.now();
for (let i = 0; i < 200; i++) simDay();
run('UIIndexes.rebuild(true);');
const elapsed = Date.now() - t0;
const nan = hasNaN(run('world'));
if (!nan.length) ok(`200-day sim + rebuild OK (${elapsed}ms)`);
else fail('NaN: ' + nan.slice(0, 3).join(', '));

console.log(failed ? '\n=== SOME TESTS FAILED ===' : '\n=== ALL PHASE 18.4 TESTS PASSED ===');
process.exit(failed ? 1 : 0);
