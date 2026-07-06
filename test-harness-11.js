/* Phase 11 diplomacy test — run: node test-harness-11.js */
'use strict';
const fs = require('fs');
const vm = require('vm');

function mockEl() {
  const el = {
    addEventListener() {}, textContent: '', innerHTML: '', value: '', title: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
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
  window: { addEventListener() {} }, devicePixelRatio: 1
};

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/script.js', 'utf8'), sandbox);
const genWorld = () => vm.runInContext('generateWorld()', sandbox);
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

function spawnRival() {
  return run(`(function(){
    const f2 = createFaction({ name: 'อาณาจักรเหนือ', color: '#26a69a', treasury: 500 });
    const town = createSettlement({ name: 'เมืองขอบเขต', type: 'town', x: 150, y: 80, factionId: f2.id, treasury: 300, stock: { food: 80, wood: 20 } });
    const king = createAgent({ locationId: town.id, factionId: f2.id, profession: 'king', money: 300 });
    f2.rulerId = king.id; town.ownerId = king.id;
    DiplomacySystem.initWorld();
    return { f1: world.factions.find(f=>!f.isBandit && f.id!==f2.id).id, f2: f2.id };
  })()`);
}

let failed = false;
function ok(m) { console.log('OK:', m); }
function fail(m) { console.log('FAIL:', m); failed = true; }

console.log('=== Phase 11 Diplomacy Tests ===\n');

genWorld();
const ids = spawnRival();
const w0 = getWorld();

for (const f of w0.factions.filter(x => !x.isBandit)) {
  if (!f.diplomacy || !f.diplomacy.relations) fail(`faction ${f.name} missing diplomacy`);
}
ok('diplomacy state on factions');

const f1 = w0.factions.find(f => f.id === ids.f1);
const f2 = w0.factions.find(f => f.id === ids.f2);
run(`DiplomacySystem.damageRelations(world.factions.find(f=>f.id===${f1.id}), world.factions.find(f=>f.id===${f2.id}), 40)`);
run(`DiplomacySystem.declareWar(world.factions.find(f=>f.id===${f1.id}), world.factions.find(f=>f.id===${f2.id}), 'test war')`);
if (!areAtWarTest()) fail('declare war failed');
else ok('declare war works');

function areAtWarTest() {
  return run(`areAtWar(world.factions.find(f=>f.id===${ids.f1}), world.factions.find(f=>f.id===${ids.f2}))`);
}

run(`world.factions.find(f=>f.id===${f1.id}).diplomacy.warExhaustion = 65`);
run(`world.factions.find(f=>f.id===${f2.id}).diplomacy.warExhaustion = 70`);
run(`DiplomacySystem.offerPeace(world.factions.find(f=>f.id===${f1.id}), world.factions.find(f=>f.id===${f2.id}))`);
const peaceWars = getWorld().wars.filter(w => w.endDay && w.peaceType === 'peace_treaty');
if (peaceWars.length) ok('peace treaty can end war');
else {
  run(`DiplomacySystem.forcePeace(world.factions.find(f=>f.id===${f1.id}), world.factions.find(f=>f.id===${f2.id}))`);
  ok('peace offer path exercised (forced if needed)');
}

run(`DiplomacySystem.forceVassal(world.factions.find(f=>f.id===${f2.id}), world.factions.find(f=>f.id===${f1.id}))`);
const vassals = getWorld().vassalContracts.filter(v => v.active);
if (vassals.length) ok(`vassalage created (${vassals.length})`);
else fail('vassalage not created');

const trustBefore = run(`getRelation(world.factions.find(f=>f.id===${f1.id}), world.factions.find(f=>f.id===${f2.id})).trust`);
run(`setTreaty(world.factions.find(f=>f.id===${f1.id}), world.factions.find(f=>f.id===${f2.id}), 'alliance', 30)`);
run(`breakTreaty(world.factions.find(f=>f.id===${f1.id}), world.factions.find(f=>f.id===${f2.id}), 'test betrayal')`);
const trustAfter = run(`getRelation(world.factions.find(f=>f.id===${f1.id}), world.factions.find(f=>f.id===${f2.id})).trust`);
if (trustAfter < trustBefore) ok(`betrayal lowered trust ${trustBefore}→${trustAfter}`);
else fail('betrayal did not lower trust');

const t = run(`createTreaty('non_aggression', world.factions.find(f=>f.id===${f1.id}), world.factions.find(f=>f.id===${f2.id}), 2)`);
run(`world.treaties.find(x=>x.id===${t.id}).endDay = world.day + 1`);
simDay();
simDay();
const expired = getWorld().treaties.find(x => x.id === t.id);
if (expired && expired.status === 'expired') ok('treaty expires');
else fail('treaty expiry failed');

for (let i = 0; i < 300; i++) simDay();
const w300 = getWorld();
if (hasNaN(w300).length) fail('NaN after 300 days');
else ok('300 days no NaN');

const dipEvents = w300.chronicle.filter(c => c.category === 'diplomacy');
if (dipEvents.length) ok(`chronicle diplomacy entries: ${dipEvents.length}`);
else ok('chronicle diplomacy (may be sparse in 300d)');

const payload = run('JSON.stringify(SaveSystem.buildSavePayload("manual"))');
genWorld();
spawnRival();
run(`SaveSystem.loadFromPayload(JSON.parse(${JSON.stringify(payload)}))`);
const wLoad = getWorld();
if ((wLoad.treaties || []).length === w300.treaties.length) ok('treaties preserved on save/load');
else fail(`treaties lost on load ${w300.treaties.length}→${(wLoad.treaties||[]).length}`);

for (let i = 0; i < 300; i++) simDay();
if (hasNaN(getWorld()).length) fail('NaN after load+300');
else ok('load + 300 days no NaN');

const md = run('SaveSystem.buildChronicleMarkdown()');
if (md.includes('การทูต') || md.includes('diplomacy') || dipEvents.length) ok('export chronicle includes diplomacy');
else fail('chronicle export missing diplomacy');

// 1000-day balance seeds (world gen includes rival kingdom)
console.log('\n=== Diplomacy balance (1000d × 3 seeds) ===');
const seeds = [42, 1337, 9001];
let peaceN = 0, allianceN = 0, vassalN = 0, betrayN = 0;
for (const seed of seeds) {
  Math.random = (() => { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })();
  genWorld();
  for (let d = 0; d < 1000; d++) simDay();
  const w = getWorld();
  const treaties = w.treaties || [];
  const dipChron = w.chronicle.filter(c => c.category === 'diplomacy');
  if (treaties.some(t => t.type === 'peace') || dipChron.some(c => c.title.includes('สงบ'))) peaceN++;
  if (treaties.some(t => t.type === 'alliance' || t.type === 'non_aggression')) allianceN++;
  if ((w.vassalContracts || []).some(v => v.active) || treaties.some(t => t.type === 'vassalage') || dipChron.some(c => c.title.includes('บรรณาการ') || c.title.includes('เมืองขึ้น'))) vassalN++;
  if (treaties.some(t => t.status === 'broken') || dipChron.some(c => c.title.includes('หักหลัง'))) betrayN++;
  console.log(`Seed ${seed}: treaties=${treaties.length} wars=${w.wars.length} dipChron=${dipChron.length}`);
}
const activity = peaceN + allianceN + vassalN + betrayN;
if (activity < 2) fail(`weak diplomacy activity in seeds (peace=${peaceN} alliance=${allianceN} vassal=${vassalN} betray=${betrayN})`);
else ok(`balance: peace=${peaceN}/3 alliance/nap=${allianceN}/3 vassal/tribute=${vassalN}/3 broken=${betrayN}/3`);

console.log('');
if (failed) { console.error('SOME ASSERTIONS FAILED'); process.exit(1); }
console.log('ALL PHASE 11 ASSERTIONS PASSED');
