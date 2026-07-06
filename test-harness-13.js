/* Phase 13 headless test — run: node test-harness-13.js */
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

function snapshot(w) {
  return {
    day: w.day,
    settlements: w.settlements.length,
    routes: w.routes.length,
    factions: w.factions.length,
    agentsAlive: w.agents.filter(a => a.alive).length,
    chronicle: w.chronicle.length,
    events: w.events.length,
    wars: w.wars.length,
    seed: w.seed,
    worldName: w.worldName
  };
}

function validateCaravanSlots(w) {
  const bad = [];
  for (const s of w.settlements) {
    if (s.townCaravanId) {
      const ag = w.agents.find(a => a.id === s.townCaravanId);
      if (!ag || !ag.alive || !ag.isTownCaravan || (!ag.cargo && !ag.travel)) bad.push(s.name);
    }
  }
  return bad;
}

let failed = false;
function ok(msg) { console.log('OK:', msg); }
function fail(msg) { console.log('FAIL:', msg); failed = true; }

console.log('=== Phase 13 Save/Load Tests ===\n');

// --- Migration test ---
const oldSave = {
  schemaVersion: '0.1',
  gameId: 'living-kingdom-sandbox',
  day: 42,
  nextId: 200,
  worldName: 'โลกเก่า',
  seed: 999,
  world: {
    day: 42,
    settlements: [{ id: 1, name: 'เมืองทดสอบ', type: 'town', x: 100, y: 100, factionId: 1,
      stock: { food: 50 }, demand: {}, prices: {}, buildings: [], history: [] }],
    routes: [{ id: 10, a: 1, b: 1, distance: 0, danger: 0.1, traffic: 0, roadQuality: 0.5, destroyed: false }],
    agents: [{ id: 5, name: 'ทดสอบ', alive: true, profession: 'farmer', locationId: 1, factionId: 1,
      stats: { hunger: 80 }, money: 10, inventory: { food: 2 } }],
    units: [], armies: [], factions: [{ id: 1, name: 'ฝ่ายทดสอบ', color: '#fff', timeline: [] }],
    events: [], chronicle: [], wars: [], eras: [], stats: { deaths: 1 }
  }
};
try {
  run(`SaveSystem.loadFromPayload(${JSON.stringify(oldSave)})`);
  const w = getWorld();
  if (w.agents[0].combatStats && w.agents[0].equipment && w.routes[0].threat != null) ok('migration fills combatStats/equipment/route fields');
  else fail('migration missing defaults');
} catch (e) {
  fail('migration threw: ' + e.message);
}

// --- Round-trip 300 + 300 days ---
genWorld();
for (let i = 0; i < 300; i++) simDay();
const w1 = getWorld();
const snap1 = snapshot(w1);
const dayBefore = w1.day;
const agentSample = w1.agents.find(a => a.alive);
const equipBefore = agentSample ? JSON.stringify(agentSample.equipment) : null;
const combatBefore = agentSample ? JSON.stringify(agentSample.combatStats) : null;

const payload = run('JSON.stringify(SaveSystem.buildSavePayload("manual"))');
if (!payload.includes('"schemaVersion":"13.1"') && !payload.includes('"schemaVersion":"13.0"')) fail('export missing schemaVersion 13.x');
else ok('save JSON has schemaVersion 13.x');

run(`SaveSystem.saveToLocalStorage('manual')`);
if (!storage['livingKingdomSandbox_save']) fail('localStorage save missing');
else ok('localStorage save written');

genWorld();
if (getWorld().day !== 0) fail('new world should be day 0');

run(`SaveSystem.loadFromPayload(JSON.parse(${JSON.stringify(payload)}))`);
const w2 = getWorld();
if (w2.day !== dayBefore) fail(`day after load ${w2.day} !== ${dayBefore}`);
else ok(`day restored to ${w2.day}`);

if (w2.chronicle.length !== snap1.chronicle) fail('chronicle lost on load');
else ok(`chronicle preserved (${w2.chronicle.length} entries)`);

const snap2 = snapshot(w2);
for (const k of ['settlements', 'routes', 'factions']) {
  if (snap2[k] !== snap1[k]) fail(`${k} count changed ${snap1[k]} -> ${snap2[k]}`);
}
ok('settlements/routes/factions counts preserved');

const ag2 = w2.agents.find(a => a.id === agentSample?.id);
if (ag2 && equipBefore && JSON.stringify(ag2.equipment) !== equipBefore) fail('equipment changed on load');
else if (ag2) ok('equipment preserved');
if (ag2 && combatBefore && JSON.stringify(ag2.combatStats) !== combatBefore) fail('combatStats changed on load');
else if (ag2) ok('combatStats preserved');

const caravanBad = validateCaravanSlots(w2);
if (caravanBad.length) fail('stale townCaravanId after load: ' + caravanBad.join(','));
else ok('caravan slots clean after load');

for (let i = 0; i < 300; i++) simDay();
const w3 = getWorld();
if (w3.day !== dayBefore + 300) fail(`day after +300 sim ${w3.day} expected ${dayBefore + 300}`);
else ok(`day continued to ${w3.day}`);

const nan = hasNaN(w3);
if (nan.length) fail('NaN after continue: ' + nan.slice(0, 3).join(','));
else ok('no NaN after 600 total days');

const md = run('SaveSystem.buildChronicleMarkdown()');
if (!md || md.length < 200 || !md.includes('ตำนานแห่ง')) fail('chronicle export empty or invalid');
else ok(`chronicle export ${md.length} chars`);

const summary = run('SaveSystem.buildSummaryText()');
if (!summary.includes('Day')) fail('summary text invalid');
else ok('summary text built');

// autosave tick
run('SaveSystem._lastAutoDay = -1');
const dayNow = w3.day;
run(`world.day = ${Math.ceil((dayNow + 1) / 50) * 50}`);
simDay();
if (storage['livingKingdomSandbox_save']) ok('autosave path exercised');
else fail('autosave did not write');

console.log('');
if (failed) { console.error('SOME ASSERTIONS FAILED'); process.exit(1); }
console.log('ALL PHASE 13 ASSERTIONS PASSED');
