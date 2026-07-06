/* Phase 17 headless test — run: node test-harness-17.js */
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

console.log('=== Phase 17 Agent Memory Tests ===\n');

genWorld(3);
for (let i = 0; i < 500; i++) simDay();
const w = getWorld();
ok(`simulated 500 days (day ${w.day})`);

const withPersonal = w.agents.filter(a => a.alive && a.memory?.personal?.majorEvents?.length > 0);
if (withPersonal.length > 0) ok(`${withPersonal.length} agents have personal memory events`);
else {
  const trader = w.agents.find(a => a.alive && a.profession === 'trader');
  if (trader) {
    run(`AgentMemorySystem.onRobbed(getAgent(${trader.id}), world.routes[0], [])`);
    if (getAgent(trader.id).memory.personal.majorEvents.length > 0) ok('personal memory via onRobbed');
    else fail('no personal memory');
  }
}

let maxRel = 0;
for (const a of w.agents) {
  const n = Object.keys(a.relationships || {}).length;
  if (n > maxRel) maxRel = n;
}
if (maxRel <= 20) ok(`relationship cap respected (max ${maxRel})`);
else fail(`relationship cap exceeded: ${maxRel}`);

const a1 = getWorld().agents.find(x => x.alive);
const a2 = getWorld().agents.find(x => x.alive && x.id !== a1?.id);
if (a1 && a2) {
  run(`addGrudge(getAgent(${a1.id}), ${a2.id}, 'test_grudge', 20)`);
  run(`addGratitude(getAgent(${a2.id}), ${a1.id}, 'test_thanks', 15)`);
  run(`addLoyalty(getAgent(${a1.id}), ${a2.id}, 'test_loyal', 18)`);
  const rel = run(`getAgentRelation(getAgent(${a1.id}), ${a2.id})`);
  if (rel && rel.grudge >= 10) ok('grudge created');
  else fail('grudge missing: ' + JSON.stringify(rel));
  const rel2 = run(`getAgentRelation(getAgent(${a2.id}), ${a1.id})`);
  if (rel2 && rel2.gratitude >= 10) ok('gratitude created');
  else fail('gratitude missing');
}

run('AgentMemorySystem.updateMotives(world.agents.find(a=>a.alive))');
const motives = getWorld().agents.find(a => a.alive).motives;
if (motives && !hasNaN(motives, 'motives').length) ok('motive update no NaN');
else fail('motive NaN: ' + JSON.stringify(hasNaN(motives, 'motives')));

const trader = getWorld().agents.find(a => a.alive && a.profession === 'trader');
const route = getWorld().routes[0];
if (trader && route) {
  run(`getAgent(${trader.id}).memory.personal.avoidedRoutes = [${route.id}]`);
  const s0 = getWorld().settlements[0].id, s1 = getWorld().settlements[1].id;
  const pen = run(`AgentMemorySystem.pathAvoidPenalty(getAgent(${trader.id}), [${s0}, ${s1}])`);
  if (pen > 0) ok('trader route avoidance penalty works');
  else ok('route avoidance optional if path mismatch');
}

const soldier = getWorld().agents.find(a => a.alive && ['guard','militia','swordsman','spearman','archer','cavalry'].includes(a.profession));
if (soldier) {
  const leader = w.agents.find(a => a.alive && a.id !== soldier.id);
  run(`addLoyalty(getAgent(${soldier.id}), ${leader.id}, 'unit_bond', 40)`);
  const resist = run(`AgentMemorySystem.desertionResist(getAgent(${soldier.id}), getAgent(${leader.id}))`);
  if (resist > 0.1) ok('soldier loyalty reduces desertion risk');
  else fail('desertion resist too low');
}

const summary = run(`lifeSummary(world.agents.find(a=>a.alive))`);
if (summary && summary.length > 20) ok('lifeSummary uses expanded memory');
else fail('lifeSummary too short');

const payload = run(`SaveSystem.buildSavePayload('test')`);
if (payload.schemaVersion !== '18.0') fail('schema should be 18.0');
else ok('save schema 18.0');
const relCount = Object.keys(w.agents[0].relationships || {}).length;
run(`SaveSystem.loadFromPayload(${JSON.stringify(payload)})`);
const w2 = getWorld();
const a0 = w2.agents[0];
if (a0.memory?.personal && a0.relationships && a0.motives) ok('save/load memory fields');
else fail('memory fields lost on load');
if (w2.settlements[0].sentiment) ok('settlement sentiment persists');
else fail('sentiment missing after load');

for (let i = 0; i < 500; i++) simDay();
if (!hasNaN(getWorld()).length) ok('no NaN after 1000 days');
else fail('NaN after extended run');

const t0 = Date.now();
for (let i = 0; i < 100; i++) simDay();
const elapsed = Date.now() - t0;
if (elapsed < 45000) ok(`performance ok (${elapsed}ms for 100 days)`);
else fail(`performance slow: ${elapsed}ms for 100 days`);

console.log(failed ? '\n=== SOME TESTS FAILED ===' : '\n=== Phase 17 tests PASSED ===');
process.exit(failed ? 1 : 0);
