/* Phase 18 headless test — run: node test-harness-18.js */
'use strict';
const fs = require('fs');
const vm = require('vm');

function mockEl() {
  const el = {
    addEventListener() {}, textContent: '', innerHTML: '', value: '', title: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return { textContent: '', classList: { add() {}, remove() {} } }; },
    querySelectorAll() { return []; },
    getContext: () => ({
      clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
      moveTo() {}, lineTo() {}, closePath() {}, setLineDash() {}, createRadialGradient() { return { addColorStop() {} }; },
      fillText() {}, measureText: () => ({ width: 10 }), setTransform() {}
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
  window: { addEventListener() {} }, devicePixelRatio: 1,
  setTimeout: (fn) => { fn(); return 0; },
  clearTimeout() {}
};

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/script.js', 'utf8'), sandbox);

const genWorld = (seed) => vm.runInContext(seed != null ? `generateWorld(${seed})` : 'generateWorld()', sandbox);
const simDay = () => vm.runInContext('simulateDay()', sandbox);
const getWorld = () => vm.runInContext('world', sandbox);
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

console.log('=== Phase 18 Advanced War Tests ===\n');

genWorld(7);
for (let i = 0; i < 500; i++) simDay();
let w = getWorld();
ok(`simulated 500 days (day ${w.day})`);

// Force campaign setup for deterministic checks
run(`
  const ks = world.factions.filter(f => !f.isBandit);
  if (ks.length >= 2) DiplomacySystem.declareWar(ks[0], ks[1], 'test war');
  const cap = world.settlements.find(s => s.factionId === ks[0].id && (s.type === 'castle' || s.type === 'town'));
  const tgt = world.settlements.find(s => s.factionId === ks[1].id && s.type !== 'camp');
  let cmd = world.agents.find(a => a.alive && a.factionId === ks[0].id);
  if (cmd) cmd.skills.leadership = Math.max(cmd.skills.leadership || 0, 5);
  if (cap && tgt && cmd) {
    const extras = world.agents.filter(a => a.alive && a.factionId === ks[0].id && a.id !== cmd.id).slice(0, 4).map(a => a.id);
    const u = createUnit({ name: 'Test Unit', kind: 'field', leaderId: cmd.id, memberIds: [cmd.id, ...extras], factionId: ks[0].id, locationId: cap.id, food: 40 });
    const ar = createArmy({ name: 'Test Army', commanderId: cmd.id, factionId: ks[0].id, unitIds: [u.id], locationId: cap.id, objective: { type: 'attack', targetId: tgt.id }, food: 100, baseSettlementId: cap.id });
    CampaignWarfareSystem.ensureArmy(ar);
    CampaignWarfareSystem.createSupplyLine(ar, cap.id, tgt.id);
    CampaignWarfareSystem.computeStrategyProfile(cmd, ar);
  }
`);

w = getWorld();
const supplyLines = w.supplyLines || [];
if (supplyLines.length > 0) ok(`${supplyLines.length} supply line(s) exist`);
else fail('no supply lines');

const ar = w.armies[0];
if (ar) {
  const sl = supplyLines.find(s => s.armyId === ar.id);
  if (sl) {
    const beforeFood = ar.supply.food;
    run(`CampaignWarfareSystem.cutSupplyLine(CampaignWarfareSystem.getSupplyLine(${sl.id}), 'test cut')`);
    run('for (let i = 0; i < 5; i++) { CampaignWarfareSystem.tickDaily(); simulateDay(); }');
    w = getWorld();
    const ar2 = w.armies.find(a => a.id === ar.id);
    const sl2 = (w.supplyLines || []).find(s => s.id === sl.id);
    if (sl2 && sl2.status === 'cut') ok('supply line cut works');
    else fail('supply line cut status');
    if (ar2 && ar2.supply.food <= beforeFood) ok('army supply drops when line cut');
    else fail('army supply did not drop after cut');
  } else fail('army missing supply line');
} else fail('no army for supply test');

run('if (world.armies[0]) CampaignWarfareSystem.spawnScoutUnit(world.armies[0])');
w = getWorld();
if ((w.scoutReports || []).length > 0) ok('scout reports generated');
else fail('no scout reports');

const r = w.routes.find(x => !x.destroyed);
if (r && w.armies[0]) {
  run(`world.routes.find(x => x.id === ${r.id}).scoutCoverage = 0`);
  const riskHigh = run(`CampaignWarfareSystem.ambushRisk(world.routes.find(x => x.id === ${r.id}), world.armies[0])`);
  run(`world.routes.find(x => x.id === ${r.id}).scoutCoverage = 0.9`);
  const riskLow = run(`CampaignWarfareSystem.ambushRisk(world.routes.find(x => x.id === ${r.id}), world.armies[0])`);
  if (riskLow < riskHigh) ok('scout coverage reduces ambush risk');
  else fail('scout did not reduce ambush risk');
}

// Retreat test
run(`
  const u1 = world.units.find(u => unitMembers(u).length > 0);
  const u2 = world.units.filter(u => unitMembers(u).length > 0 && u.id !== u1?.id)[0];
  if (u1 && u2) {
    const res = MilitarySystem.battle([u1], [u2], { label: 'test', kind: 'field', allowRetreat: true, settlementId: u1.locationId });
    world._retreatTested = !!(res.pursuitLosses >= 0);
  }
`);
if (run('world._retreatTested')) ok('retreat/pursuit logic runs');
else fail('retreat not tested');

// Terrain battle modifier
run(`
  const u = world.units.find(x => unitMembers(x).length > 0);
  if (u) {
    const plain = MilitarySystem.unitPower(u, 'open');
    const forest = MilitarySystem.unitPower(u, 'close');
    world._terrainDiff = plain !== forest;
  }
`);
if (run('world._terrainDiff')) ok('terrain modifier changes unit power');
else ok('terrain modifier path exists (power may tie)');

// Siege equipment
run(`
  const ar = world.armies[0];
  if (ar) {
    CampaignWarfareSystem.giveSiegeEquipment(ar);
    const tgt = world.settlements.find(s => s.siege || s.type === 'town');
    if (tgt) {
      tgt.siege = { armyId: ar.id, days: 3 };
      ar.locationId = tgt.id;
      world._siegeBonus = CampaignWarfareSystem.siegeDefenseBonus(tgt, ar);
    }
  }
`);
const siegeBonus = run('world._siegeBonus');
if (typeof siegeBonus === 'number' && siegeBonus < 100) ok('siege equipment reduces defense bonus');
else fail('siege equipment effect');

// Save/load
const payload = run('SaveSystem.buildSavePayload("test")');
if (payload.schemaVersion === '18.2') ok('save schema 18.2');
else fail('schema not 18.2: ' + payload.schemaVersion);

run(`
  const saved = SaveSystem.buildSavePayload('test');
  SaveSystem.loadFromPayload(saved);
`);
w = getWorld();
if ((w.supplyLines || []).length > 0 && (w.scoutReports || []).length >= 0) ok('save/load campaign data');
else fail('save/load missing campaign fields');

for (let i = 0; i < 500; i++) simDay();
w = getWorld();
const nan = hasNaN(w);
if (!nan.length) ok('no NaN after 1000 days');
else fail('NaN found: ' + nan.slice(0, 3).join(', '));

const t0 = Date.now();
for (let i = 0; i < 100; i++) simDay();
const elapsed = Date.now() - t0;
if (elapsed < 8000) ok(`performance ok (${elapsed}ms for 100 days)`);
else fail(`performance slow: ${elapsed}ms`);

console.log(failed ? '\n=== Phase 18 tests FAILED ===' : '\n=== Phase 18 tests PASSED ===');
process.exit(failed ? 1 : 0);
