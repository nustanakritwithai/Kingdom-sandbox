/* Phase 15 headless test — run: node test-harness-15.js */
'use strict';
const fs = require('fs');
const vm = require('vm');

function mockEl() {
  const el = {
    addEventListener() {}, textContent: '', innerHTML: '', value: '', title: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return { textContent: '', classList: { add() {}, remove() {} } }; },
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

let failed = false;
function ok(m) { console.log('OK:', m); }
function fail(m) { console.log('FAIL:', m); failed = true; }

console.log('=== Phase 15 Observer UX Tests ===\n');

genWorld();
for (let i = 0; i < 500; i++) simDay();
const w = getWorld();
ok(`simulated 500 days (day ${w.day})`);

const nan = hasNaN(w);
if (nan.length) fail('NaN found: ' + nan.slice(0, 5).join(', '));
else ok('no NaN in world state');

let rankings;
try {
  rankings = run('ObserverSystem.computeRankings()');
} catch (e) {
  fail('computeRankings threw: ' + e.message);
}
if (rankings) {
  if (!Array.isArray(rankings.famousAgents)) fail('missing famousAgents');
  else ok('rankings.famousAgents');
  if (!Array.isArray(rankings.activeWars)) fail('missing activeWars');
  else ok('rankings.activeWars');
  if (!Array.isArray(rankings.dangerousRoutes)) fail('missing dangerousRoutes');
  else ok('rankings.dangerousRoutes');
}

const agent = w.agents.find(a => a.alive);
const settlement = w.settlements[0];
const faction = w.factions.find(f => !f.isBandit);
if (!agent || !settlement || !faction) fail('missing test entities');
else {
  const s1 = run(`ObserverSystem.search(${JSON.stringify(agent.name)})`);
  const s2 = run(`ObserverSystem.search(${JSON.stringify(settlement.name)})`);
  const s3 = run(`ObserverSystem.search(${JSON.stringify(faction.name)})`);
  if (!s1.some(r => r.kind === 'agent' && r.id === agent.id)) fail('search agent failed');
  else ok('search finds agent by full name');
  if (!s2.some(r => r.kind === 'settlement' && r.id === settlement.id)) fail('search settlement failed');
  else ok('search finds settlement by full name');
  if (!s3.some(r => r.kind === 'faction' && r.id === faction.id)) fail('search faction failed');
  else ok('search finds faction by full name');
}

run(`ObserverSystem.startFollow('agent', ${agent.id})`);
const validBefore = run('ObserverSystem.isFollowValid()');
if (!validBefore) fail('follow target should be valid');
else ok('follow target valid');

run(`getAgent(${agent.id}).alive = false`);
const validAfter = run('ObserverSystem.isFollowValid()');
if (validAfter) fail('follow should be invalid after death');
else ok('follow invalid after target death');

const pausedBefore = run('UI.paused');
run(`ObserverSystem.pauseOn.war_declaration = true`);
run(`ObserverSystem.onMajorEvent('war_declaration', 'test war', { factions: [${faction.id}] })`);
if (!run('UI.paused')) fail('pause on major event did not pause');
else ok('pause on major event works');
run(`UI.paused = ${pausedBefore}`);

const prefs = run(`ObserverSystem.getPrefs()`);
prefs.follow = { kind: 'settlement', id: settlement.id };
prefs.rankingTab = 'military';
prefs.panX = 12;
prefs.panY = -8;
prefs.zoom = 1.4;
run(`ObserverSystem.applyPrefs(${JSON.stringify(prefs)})`);
const applied = run('ObserverSystem.getPrefs()');
if (applied.rankingTab !== 'military') fail('prefs rankingTab not applied');
else ok('observer prefs apply rankingTab');
if (Math.abs(applied.panX - 12) > 0.01) fail('prefs panX not applied');
else ok('observer prefs apply pan/zoom');
if (!run('ObserverSystem.isFollowValid()')) fail('follow settlement not valid after apply');
else ok('follow after prefs load');

const badPrefs = run(`({ follow: { kind: 'agent', id: 999999 }, pauseOn: ObserverSystem.defaultPauseOn() })`);
run(`ObserverSystem.applyPrefs(${JSON.stringify(badPrefs)})`);
if (run('ObserverSystem.follow')) fail('invalid follow should clear');
else ok('safe fallback when follow target missing after load');

const currentSchema = run('SAVE_SCHEMA_VERSION');
const payload = run(`SaveSystem.buildSavePayload('test')`);
if (payload.schemaVersion !== currentSchema) fail('schema should be ' + currentSchema);
else ok('save schema ' + currentSchema + ' with observer prefs');
if (!payload.uiPrefs.observer) fail('observer prefs missing in save');
else ok('observer prefs in save payload');

run(`SaveSystem.loadFromPayload(${JSON.stringify(payload)})`);
const reloaded = run('ObserverSystem.getPrefs()');
if (reloaded.rankingTab !== 'military') fail('observer prefs lost on save/load');
else ok('save/load observer prefs roundtrip');

const nan2 = hasNaN(getWorld());
if (nan2.length) fail('NaN after save/load');
else ok('no NaN after save/load');

console.log(failed ? '\n=== SOME TESTS FAILED ===' : '\n=== Phase 15 tests PASSED ===');
process.exit(failed ? 1 : 0);
