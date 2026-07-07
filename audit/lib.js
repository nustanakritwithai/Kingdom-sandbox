/* Phase 19 audit — shared headless sandbox loader
   ใช้: const { boot } = require('./lib'); const S = boot(seed);
   โหลด script.js เข้า Node vm พร้อม DOM mock ครบ + RNG แบบ deterministic (LCG)
   ไม่แก้ไขไฟล์เกมใดๆ — อ่านอย่างเดียว */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function mockEl() {
  const el = {
    addEventListener() {}, textContent: '', innerHTML: '', value: '', title: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return mockEl(); },
    querySelectorAll() { return []; },
    getContext: () => new Proxy({}, {
      get: (t, k) =>
        k === 'measureText' ? () => ({ width: 10 })
        : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) })
        : k === 'createRadialGradient' ? () => ({ addColorStop() {} })
        : () => {}
    }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 640 }),
    parentElement: null, files: null, click() {}, style: {}, dataset: {},
    appendChild() {}, removeChild() {}, remove() {}, focus() {}, blur() {}
  };
  el.parentElement = { getBoundingClientRect: () => ({ width: 1000, height: 640 }) };
  return el;
}

/* สร้าง sandbox ใหม่ (แยก world ต่อ instance) */
function boot(seed) {
  const storage = {};
  const els = {};
  const sandbox = {
    console, Math: Object.create(Math), Date, JSON,
    performance: { now: () => Date.now() },
    Blob: class Blob { constructor(parts) { this._parts = parts; } },
    URL: { createObjectURL: () => 'blob:audit', revokeObjectURL() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: {
      getItem: k => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: k => { delete storage[k]; }
    },
    document: {
      getElementById: id => els[id] || (els[id] = mockEl()),
      querySelectorAll: () => [],
      createElement: () => mockEl(),
      body: mockEl()
    },
    requestAnimationFrame: () => {},
    confirm: () => true, alert: () => {},
    window: { innerWidth: 1024, addEventListener() {} },
    devicePixelRatio: 1,
    setTimeout: fn => { fn(); return 0; },
    clearTimeout() {}
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8'), sandbox);

  const api = {
    sandbox, storage,
    run: code => vm.runInContext(code, sandbox),
    seedRandom(s) {
      vm.runInContext(
        `(function(){ let s=${s >>> 0}; Math.random = function(){ s=(1103515245*s+12345)>>>0; return s/4294967296; }; })()`,
        sandbox
      );
    },
    genWorld() { return vm.runInContext('generateWorld()', sandbox); },
    simDay() { return vm.runInContext('simulateDay()', sandbox); },
    simDays(n) { return vm.runInContext(`(function(){ for(let i=0;i<${n};i++) simulateDay(); return world.day; })()`, sandbox); }
  };
  if (seed !== undefined) { api.seedRandom(seed); api.genWorld(); }
  return api;
}

/* หา NaN/Infinity ทุกที่ใน world (จำกัดความลึกกัน cycle) */
const NAN_SNIPPET = `(function(){
  let count = 0; const paths = [];
  const seen = new Set();
  const walk = (v, p, d) => {
    if (d > 8) return;
    if (typeof v === 'number') { if (!Number.isFinite(v)) { count++; if (paths.length < 10) paths.push(p); } return; }
    if (!v || typeof v !== 'object') return;
    if (seen.has(v)) return; seen.add(v);
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) walk(v[i], p + '[' + i + ']', d + 1); }
    else { for (const k in v) walk(v[k], p + '.' + k, d + 1); }
  };
  walk(world, 'world', 0);
  return { count, paths };
})()`;

/* ตรวจ dangling reference ระหว่าง entity */
const INTEGRITY_SNIPPET = `(function(){
  const issues = [];
  const sIds = new Set(world.settlements.map(s => s.id));
  const aIds = new Set(world.agents.map(a => a.id));
  const uIds = new Set(world.units.map(u => u.id));
  const fIds = new Set(world.factions.map(f => f.id));
  const arIds = new Set(world.armies.map(a => a.id));
  for (const a of world.agents) {
    if (!a.alive) continue;
    if (a.locationId != null && !sIds.has(a.locationId)) issues.push('agent ' + a.id + ' locationId dangling');
    if (a.homeId != null && !sIds.has(a.homeId)) issues.push('agent ' + a.id + ' homeId dangling');
    if (a.unitId != null && !uIds.has(a.unitId)) issues.push('agent ' + a.id + ' unitId dangling');
    if (a.factionId != null && !fIds.has(a.factionId)) issues.push('agent ' + a.id + ' factionId dangling');
  }
  for (const u of world.units) {
    for (const mid of u.memberIds || []) {
      const m = world.agents.find(x => x.id === mid);
      if (!m) issues.push('unit ' + u.id + ' member ' + mid + ' missing');
    }
    if (u.armyId != null && !arIds.has(u.armyId)) issues.push('unit ' + u.id + ' armyId dangling');
    if (u.factionId != null && !fIds.has(u.factionId)) issues.push('unit ' + u.id + ' factionId dangling');
  }
  for (const s of world.settlements) {
    if (s.factionId != null && !fIds.has(s.factionId)) issues.push('settlement ' + s.id + ' factionId dangling');
    if (s.governorId != null && s.governorId !== 0) {
      const g = world.agents.find(x => x.id === s.governorId);
      if (!g) issues.push('settlement ' + s.id + ' governorId missing agent');
      else if (!g.alive) issues.push('settlement ' + s.id + ' governor dead');
    }
    if (s.garrisonUnitId != null && !uIds.has(s.garrisonUnitId)) issues.push('settlement ' + s.id + ' garrisonUnitId dangling');
  }
  for (const f of world.factions) {
    if (f.rulerId != null) {
      const r = world.agents.find(x => x.id === f.rulerId);
      if (!r) issues.push('faction ' + f.id + ' rulerId missing agent');
      else if (!r.alive) issues.push('faction ' + f.id + ' ruler dead');
    }
  }
  const ghost = (typeof SovereigntySystem !== 'undefined' && SovereigntySystem.validateNoGhostOwners)
    ? SovereigntySystem.validateNoGhostOwners() : null;
  return { issues: issues.slice(0, 30), total: issues.length, ghost };
})()`;

module.exports = { boot, mockEl, NAN_SNIPPET, INTEGRITY_SNIPPET };
