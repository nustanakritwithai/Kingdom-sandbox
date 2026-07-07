/* Phase 18.5 save/load soak — run: node test-harness-185-save.js */
'use strict';
const fs = require('fs');
const vm = require('vm');

function mockEl() {
  const el = {
    addEventListener() {}, textContent: '', innerHTML: '', value: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return null; }, querySelectorAll: () => [],
    getContext: () => ({
      clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
      moveTo() {}, lineTo() {}, closePath() {}, fillText() {}, measureText: () => ({ width: 10 }),
      setTransform() {}, createRadialGradient() { return { addColorStop() {} }; },
      getImageData: () => ({ data: new Uint8ClampedArray(4) })
    }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 640 }),
    parentElement: { getBoundingClientRect: () => ({ width: 1000, height: 640 }) }
  };
  return el;
}

const els = {};
const sandbox = {
  console, Math, Date, performance: { now: () => 0 },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { getElementById: (id) => els[id] || (els[id] = mockEl()), querySelectorAll: () => [], createElement: mockEl },
  requestAnimationFrame: () => {}, confirm: () => true, alert: () => {},
  window: { innerWidth: 1024, addEventListener() {} }, devicePixelRatio: 1,
  Blob: class Blob {}, URL: { createObjectURL: () => '', revokeObjectURL() {} },
  navigator: { clipboard: { writeText: async () => {} } },
  setTimeout: (fn) => { fn(); return 0; }, clearTimeout() {}
};

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/script.js', 'utf8'), sandbox);

const run = (c) => vm.runInContext(c, sandbox);
let failed = false;
const ok = (m) => console.log('OK:', m);
const fail = (m) => { console.log('FAIL:', m); failed = true; };

console.log('=== Phase 18.5 Save/Load Soak ===\n');

run('generateWorld()');
for (let i = 0; i < 3000; i++) run('simulateDay()');

const payload = run('SaveSystem.buildSavePayload("soak")');
const size = JSON.stringify(payload).length;
if (size < 8000000) ok(`save size ${(size / 1024).toFixed(0)} KB reasonable`);
else fail(`save too large: ${size}`);

run(`(function(p){ SaveSystem.loadFromPayload(p); })(${JSON.stringify(payload)})`);
for (let i = 0; i < 500; i++) run('simulateDay()');

const check = run(`(function() {
  WorldIntegritySystem.runCheck({ repair: true, silent: true });
  const issues = [];
  for (const s of world.settlements) {
    if (s.type !== 'camp' && !s.ownerOrganizationId) issues.push('owner');
  }
  const clones = new Set();
  for (const wb of world.warbands) {
    for (const id of wb.memberIds) {
      if (!getAgent(id)?.alive) continue;
      if (clones.has(id)) issues.push('clone');
      clones.add(id);
    }
  }
  return { score: world.integrity.score, issues, day: world.day, schema: SAVE_SCHEMA_VERSION };
})()`);

if (check.schema === '18.6') ok('loaded schema 18.6');
else fail('schema ' + check.schema);

if (!check.issues.length) ok(`post-load integrity score ${check.score} day ${check.day}`);
else fail('broken refs: ' + check.issues.join(','));

console.log(failed ? '\nFAILED' : '\nPASSED');
process.exit(failed ? 1 : 0);
