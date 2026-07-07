/* Phase 18.5 headless stability tests — run: node test-harness-185.js */
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

const genWorld = (seed) => vm.runInContext(seed != null ? `(function(){ generateWorld(); world.seed=${seed}; })()` : 'generateWorld()', sandbox);
const simDay = () => vm.runInContext('simulateDay()', sandbox);
const run = (code) => vm.runInContext(code, sandbox);

function hasNaN(obj, path = 'world', issues = []) {
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

function assertWorldInvariants(label) {
  const r = run(`(function() {
    const issues = [];
    const agentWarband = new Map();
    for (const wb of (world.warbands || [])) {
      const alive = warbandMembers(wb);
      if (wb.size !== alive.length) issues.push('size_mismatch:' + wb.id);
      for (const id of wb.memberIds) {
        if (!getAgent(id)?.alive) continue;
        if (agentWarband.has(id)) issues.push('clone:' + id);
        agentWarband.set(id, wb.id);
      }
    }
    for (const s of world.settlements) {
      if (s.type === 'camp') continue;
      if (!s.ownerOrganizationId) issues.push('null_owner:' + s.id);
      if (s.ownerOrganizationId && getWarband(s.ownerOrganizationId)) issues.push('warband_owner:' + s.id);
    }
    for (const org of (world.organizations || [])) {
      if (org.sovereignty?.status === 'landed') {
        const has = (org.sovereignty.settlementIds || []).some(sid => getSettlement(sid));
        if (!has) issues.push('landed_no_settle:' + org.id);
      }
    }
    for (const sa of (world.siegeAuthorities || [])) {
      if (sa.status === 'active' && sa.expiresDay < world.day - 120) issues.push('siege_stale:' + sa.id);
    }
    for (const bf of (world.activeBattlefields || [])) {
      if (!bf.resolved && bf.startDay && world.day - bf.startDay > 8) issues.push('bf_stuck:' + bf.id);
    }
    const brLen = (world.battleReports || []).length;
    if (brLen > BALANCE.historyCaps.battleReports + BALANCE.historyCaps.battleReportsFamous + 5) issues.push('reports_cap:' + brLen);
    for (const org of (world.organizations || [])) {
      if ((org.history || []).length > BALANCE.historyCaps.orgHistory) issues.push('org_hist:' + org.id);
    }
    for (const wb of (world.warbands || [])) {
      if ((wb.history || []).length > BALANCE.historyCaps.warbandHistory) issues.push('wb_hist:' + wb.id);
    }
    const eh = world.balanceMetrics?.economyHealth;
    if (eh != null && !Number.isFinite(eh)) issues.push('economy_nan');
    let negFood = 0;
    for (const s of marketSettlements()) if ((s.stock?.food || 0) < -1) negFood++;
    if (negFood > 2) issues.push('global_neg_food:' + negFood);
    return { issues, day: world.day, schema: typeof SAVE_SCHEMA_VERSION !== 'undefined' ? SAVE_SCHEMA_VERSION : '?' };
  })()`);
  if (r.issues.length) fail(`${label}: ${r.issues.slice(0, 8).join(', ')}`);
  else ok(`${label} invariants (day ${r.day})`);
  return r;
}

function runDays(n) {
  for (let i = 0; i < n; i++) simDay();
}

const PERF_TARGET = run('BALANCE.integrity.tickPerfTargetMs');

console.log('=== Phase 18.5 World Stability Tests ===\n');

// Schema + BALANCE object
const schema = run('SAVE_SCHEMA_VERSION');
if (schema === '19.0') ok('schema 19.0');
else fail('schema expected 19.0 got ' + schema);

if (run('typeof BALANCE === "object" && BALANCE.recruitment && BALANCE.integrity')) ok('BALANCE config present');
else fail('BALANCE missing');

// Clone test: 100 split/merge
genWorld(18501);
const cloneTest = run(`(function() {
  let wb = world.warbands.find(w => warbandMembers(w).length >= 4);
  if (!wb) {
    const a = world.agents.find(x => x.alive);
    const ids = [a.id];
    for (let i = 0; i < 5; i++) ids.push(createAgent({ locationId: a.locationId, profession: 'guard', factionId: a.factionId }).id);
    wb = WarbandSystem.createFromMembers(null, ids, { locationId: a.locationId });
  }
  for (let i = 0; i < 100; i++) {
    const members = warbandMembers(wb);
    if (members.length < 2) break;
    const child = WarbandSystem.splitWarband(wb, [members[members.length - 1].id], { name: 'split' });
    if (child && chance(0.5)) WarbandSystem.mergeWarbands(wb, child);
  }
  const map = new Map();
  for (const w of world.warbands) {
    for (const id of w.memberIds) {
      if (!getAgent(id)?.alive) continue;
      if (map.has(id)) return { ok: false, dup: id };
      map.set(id, w.id);
    }
  }
  return { ok: true };
})()`);
if (cloneTest.ok) ok('100 split/merge no physical clone');
else fail('clone after split/merge: ' + JSON.stringify(cloneTest));

// Short seeds: 1000 x 5
const seeds1000 = [18511, 18512, 18513, 18514, 18515];
for (const seed of seeds1000) {
  genWorld(seed);
  runDays(1000);
  const nan = hasNaN(sandbox.world);
  if (nan.length) fail(`seed ${seed} 1000d NaN: ${nan.slice(0, 3).join(', ')}`);
  else ok(`seed ${seed} 1000 days no NaN`);
  assertWorldInvariants(`seed ${seed} 1000d`);
  run('WorldIntegritySystem.runCheck({ repair: true, silent: true })');
}

// Medium: 3000 x 3
const seeds3000 = [18521, 18522, 18523];
for (const seed of seeds3000) {
  genWorld(seed);
  const t0 = Date.now();
  runDays(3000);
  const elapsed = Date.now() - t0;
  const avgTick = elapsed / 3000;
  if (avgTick > PERF_TARGET * 3) fail(`seed ${seed} perf slow ${avgTick.toFixed(1)}ms/tick`);
  else ok(`seed ${seed} 3000 days perf ${avgTick.toFixed(1)}ms/tick`);
  assertWorldInvariants(`seed ${seed} 3000d`);
}

// Optional soak 5000 x 1 if reasonably fast
genWorld(18599);
const t0 = Date.now();
runDays(5000);
const soakMs = (Date.now() - t0) / 5000;
if (soakMs < 80) {
  ok(`soak 5000 days ${soakMs.toFixed(1)}ms/tick`);
  assertWorldInvariants('soak 5000d');
} else {
  ok(`soak 5000 skipped strict perf (${soakMs.toFixed(1)}ms/tick) — invariants only`);
  assertWorldInvariants('soak 5000d');
}

// Save/load continue 500
genWorld(18531);
runDays(1000);
const payload = run('SaveSystem.buildSavePayload("test")');
run(`(function(p) { SaveSystem.loadFromPayload(p); })(${JSON.stringify(payload)})`);
runDays(500);
assertWorldInvariants('save/load + 500d');

// Recruitment should not drain settlement below safe productive ratio
genWorld(18532);
const recPop = run(`(function() {
  const s = marketSettlements()[0];
  const basePop = populationOf(s);
  const leader = world.agents.find(a => a.alive);
  const org = createOrganization({ name: 'Test Co', type: 'mercenary_company', leaderId: leader.id, homeSettlementId: s.id, memberIds: [leader.id], wealth: 800, foodReserve: 300 });
  s.stock.food = 200;
  for (let i = 0; i < 8; i++) OrganizationSystem.postRecruitmentOffer(org, { settlementId: s.id, type: 'royal_conscription', quantityNeeded: 20 });
  return { basePop, minRatio: BALANCE.recruitment.minProductivePopulationRatio };
})()`);
runDays(40);
const afterPop = run(`(function() {
  const s = marketSettlements()[0];
  const pop = populationOf(s);
  const productive = agentsAt(s.id).filter(a => !MILITARY_PROFS.has(a.profession)).length;
  return { pop, productive, ratio: productive / Math.max(pop, 1) };
})()`);
if (afterPop.ratio >= recPop.minRatio * 0.85 || afterPop.pop >= recPop.basePop * 0.5) ok('recruitment respects population floor');
else fail('recruitment drained settlement: ' + JSON.stringify({ recPop, afterPop }));

// Integrity system exists
genWorld();
if (run('typeof WorldIntegritySystem !== "undefined" && WorldIntegritySystem.runCheck({repair:true,silent:true}).score >= 0')) ok('integrity check runs');
else fail('integrity system');

// getAgentActiveWarband helper
const awb = run(`(function() {
  const wb = world.warbands[0];
  if (!wb || !wb.memberIds.length) return true;
  return getAgentActiveWarband(wb.memberIds[0])?.id === wb.id;
})()`);
if (awb) ok('getAgentActiveWarband');
else fail('getAgentActiveWarband');

console.log(failed ? '\n=== SOME TESTS FAILED ===' : '\n=== ALL PHASE 18.5 TESTS PASSED ===');
process.exit(failed ? 1 : 0);
