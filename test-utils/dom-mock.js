/* Shared headless test bootstrap for Living Kingdom Sandbox
   ใช้: const { createTestSandbox, run, getCurrentSchemaVersion } = require('./test-utils/dom-mock');
   โหลด script.js เข้า Node vm พร้อม DOM mock ครบ — ห้าม copy mock ซ้ำใน harness ใหม่ */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, '..', 'script.js');
const SAVE_KEY = 'livingKingdomSandbox_save';

function createMockElement() {
  const children = [];
  const el = {
    addEventListener() {},
    removeEventListener() {},
    textContent: '',
    innerHTML: '',
    value: '',
    title: '',
    id: '',
    tagName: 'DIV',
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; }
    },
    querySelector(sel) {
      if (sel && sel.startsWith('#') && this.id === sel.slice(1)) return this;
      return createMockElement();
    },
    querySelectorAll() { return []; },
    getContext: () => ({
      clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
      moveTo() {}, lineTo() {}, closePath() {}, setLineDash() {}, setTransform() {},
      createRadialGradient() { return { addColorStop() {} }; },
      fillText() {}, strokeText() {},
      measureText: () => ({ width: 10 }),
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      putImageData() {}, drawImage() {}, save() {}, restore() {}, clip() {}
    }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 640, right: 1000, bottom: 640 }),
    parentElement: null,
    parentNode: null,
    files: null,
    click() {},
    focus() {},
    blur() {},
    style: {},
    dataset: {},
    appendChild(child) { children.push(child); child.parentElement = this; child.parentNode = this; return child; },
    removeChild(child) {
      const i = children.indexOf(child);
      if (i >= 0) children.splice(i, 1);
      child.parentElement = null;
      child.parentNode = null;
      return child;
    },
    remove() { if (this.parentElement) this.parentElement.removeChild(this); },
    setAttribute() {},
    getAttribute: () => null,
    className: ''
  };
  el.parentElement = { getBoundingClientRect: () => ({ width: 1000, height: 640 }) };
  el.parentNode = el.parentElement;
  return el;
}

function createTestSandbox(options = {}) {
  const { loadGame = true } = options;
  const storage = {};
  const els = {};
  const body = createMockElement();

  const sandbox = {
    console,
    Math: Object.create(Math),
    Date,
    JSON,
    performance: { now: () => Date.now() },
    Blob: class Blob { constructor(parts) { this._parts = parts; } },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: {
      getItem: k => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: k => { delete storage[k]; }
    },
    document: {
      getElementById: id => els[id] || (els[id] = createMockElement()),
      querySelector: sel => {
        if (typeof sel === 'string' && sel.startsWith('#')) {
          const id = sel.slice(1);
          return els[id] || (els[id] = createMockElement());
        }
        return createMockElement();
      },
      querySelectorAll: () => [],
      createElement: () => createMockElement(),
      body
    },
    requestAnimationFrame: () => {},
    confirm: () => true,
    alert: () => {},
    window: { innerWidth: 1024, addEventListener() {} },
    devicePixelRatio: 1,
    setTimeout: fn => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout() {}
  };

  vm.createContext(sandbox);
  if (loadGame) loadGameIntoSandbox(sandbox);
  sandbox.__storage = storage;
  sandbox.__els = els;
  return sandbox;
}

function loadGameIntoSandbox(sandbox) {
  vm.runInContext(fs.readFileSync(SCRIPT_PATH, 'utf8'), sandbox);
  return sandbox;
}

function seedRandom(sandbox, seed) {
  vm.runInContext(
    `(function(){ let s=${seed >>> 0}; Math.random=function(){ s=(1103515245*s+12345)>>>0; return s/4294967296; }; })()`,
    sandbox
  );
}

function run(sandbox, code) {
  return vm.runInContext(code, sandbox);
}

function runDays(sandbox, days) {
  return run(sandbox, `(function(){ for(let i=0;i<${days};i++) simulateDay(); return world.day; })()`);
}

function findNaN(root, maxDepth = 12) {
  const issues = [];
  const seen = new Set();
  const walk = (v, p, d) => {
    if (d > maxDepth) return;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) issues.push(p);
      return;
    }
    if (!v || typeof v !== 'object') return;
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`, d + 1));
    else for (const k in v) walk(v[k], `${p}.${k}`, d + 1);
  };
  walk(root, 'world', 0);
  return issues;
}

function assertNoNaN(world) {
  const issues = findNaN(world);
  if (issues.length) {
    const err = new Error('NaN/Infinity found: ' + issues.slice(0, 5).join(', '));
    err.issues = issues;
    throw err;
  }
  return issues;
}

function assertNoDanglingRefs(sandbox) {
  const bad = run(sandbox, `(function(){
    let n = 0;
    for (const f of world.factions) {
      if (f.rulerId != null) { const r = getAgent(f.rulerId); if (!r || !r.alive) n++; }
    }
    for (const s of world.settlements) {
      if (s.governorId != null) { const g = getAgent(s.governorId); if (!g || !g.alive) n++; }
      if (s.type !== 'camp' && !s.ownerOrganizationId) n++;
    }
    return n;
  })()`);
  if (bad > 0) {
    const err = new Error('dangling/null refs: ' + bad);
    err.count = bad;
    throw err;
  }
  return bad;
}

function getCurrentSchemaVersion(sandbox) {
  return run(sandbox, 'SAVE_SCHEMA_VERSION');
}

function saveLoadRoundtrip(sandbox, options = {}) {
  const { simDaysAfter = 0, slot = 'test-roundtrip' } = options;
  const schema = getCurrentSchemaVersion(sandbox);
  run(sandbox, `SaveSystem.saveToLocalStorage(${JSON.stringify(slot)}, true)`);
  const raw = sandbox.__storage[SAVE_KEY];
  if (!raw) throw new Error('save payload missing from storage');
  const payload = JSON.parse(raw);
  if (payload.schemaVersion !== schema) {
    throw new Error(`schema mismatch: expected ${schema}, got ${payload.schemaVersion}`);
  }
  const dayBefore = run(sandbox, 'world.day');
  const sb2 = createTestSandbox();
  run(sb2, `world = null; SaveSystem.loadFromPayload(${JSON.stringify(payload)});`);
  const dayAfter = run(sb2, 'world.day');
  if (dayAfter !== dayBefore) {
    throw new Error(`day mismatch after load: ${dayBefore} vs ${dayAfter}`);
  }
  if (simDaysAfter > 0) runDays(sb2, simDaysAfter);
  assertNoNaN(sb2.world);
  return { payload, schema, sandbox: sb2 };
}

function createTestReporter(title) {
  let failed = false;
  return {
    title,
    ok(m) { console.log('OK:', m); },
    fail(m) { console.log('FAIL:', m); failed = true; },
    get failed() { return failed; },
    finish(passMsg, failMsg) {
      console.log('');
      if (failed) {
        console.log(failMsg || '=== SOME TESTS FAILED ===');
        process.exit(1);
      }
      console.log(passMsg || '=== ALL TESTS PASSED ===');
      process.exit(0);
    }
  };
}

module.exports = {
  SCRIPT_PATH,
  SAVE_KEY,
  createMockElement,
  createTestSandbox,
  loadGameIntoSandbox,
  seedRandom,
  run,
  runDays,
  findNaN,
  assertNoNaN,
  assertNoDanglingRefs,
  getCurrentSchemaVersion,
  saveLoadRoundtrip,
  createTestReporter
};
