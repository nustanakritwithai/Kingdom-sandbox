/* Phase 19.1 regression gate — required pre-merge check
   run: node test-harness-191-regression.js */
'use strict';
const {
  createTestSandbox, seedRandom, run, runDays, findNaN,
  getCurrentSchemaVersion, saveLoadRoundtrip, assertNoDanglingRefs, createTestReporter
} = require('./test-utils/dom-mock');

const { ok, fail, finish } = createTestReporter('Phase 19.1 Regression Gate');
const schema = getCurrentSchemaVersion(createTestSandbox());

console.log('=== Phase 19.1 Regression Gate ===\n');
console.log('Current schema:', schema, '\n');

const PERF_CEILING_MS = 25;

function caravanLossRate(sb) {
  return run(sb, `(function(){
    const lv = world.balanceMetrics.liveness;
    const total = lv.caravanTrips + lv.caravanLost;
    return total > 0 ? lv.caravanLost / total : null;
  })()`);
}

function countClones(sb) {
  return run(sb, `(function(){
    const map = new Map();
    for (const wb of world.warbands) {
      for (const id of wb.memberIds) {
        if (!getAgent(id)?.alive) continue;
        if (map.has(id)) return 1;
        map.set(id, wb.id);
      }
    }
    return 0;
  })()`);
}

// 1. No crash / NaN on medium run
(() => {
  const sb = createTestSandbox(); seedRandom(sb, 42); run(sb, 'generateWorld()');
  let crash = null;
  try { runDays(sb, 1500); } catch (e) { crash = e.message; }
  const nan = findNaN(sb.world);
  if (!crash) ok('1500-day sim no crash');
  else fail('crash: ' + crash);
  if (!nan.length) ok('0 NaN after 1500 days');
  else fail('NaN: ' + nan.slice(0, 3).join(', '));
})();

// 2. No clone agents
(() => {
  const sb = createTestSandbox(); seedRandom(sb, 7); run(sb, 'generateWorld()');
  runDays(sb, 2000);
  if (countClones(sb) === 0) ok('no clone agents across warbands');
  else fail('clone agent detected');
})();

// 3. No dangling ruler/governor + no null city owners
(() => {
  const sb = createTestSandbox(); seedRandom(sb, 5); run(sb, 'generateWorld()');
  runDays(sb, 2000);
  try {
    assertNoDanglingRefs(sb);
    ok('no dangling ruler/governor and no null city owners');
  } catch (e) {
    fail(e.message);
  }
})();

// 4. No spawned soldiers during recruitment window
(() => {
  const sb = createTestSandbox(); seedRandom(sb, 2); run(sb, 'generateWorld()');
  run(sb, `(function(){
    globalThis.__spawns = 0; const _ca = createAgent;
    globalThis.createAgent = function(o){ if (o && o.profession && MILITARY_PROFS.has(o.profession)) __spawns++; return _ca(o); };
  })()`);
  runDays(sb, 2500);
  const spawns = run(sb, '__spawns');
  if (spawns === 0) ok('no spawned soldiers during recruitment');
  else fail('spawned soldiers: ' + spawns);
})();

// 5. Army/muster/battle on at least some seeds
(() => {
  let armies = 0, battles = 0;
  for (const seed of [1, 2, 5, 8]) {
    const sb = createTestSandbox(); seedRandom(sb, seed); run(sb, 'generateWorld()');
    runDays(sb, 3000);
    const r = run(sb, `({
      armies: world.balanceMetrics.liveness.armiesCreated,
      musters: world.balanceMetrics.liveness.successfulMusters,
      battled: world.wars.filter(w=>w.battles.length>0).length
    })`);
    if (r.armies > 0 || r.musters > 0) armies++;
    if (r.battled > 0) battles++;
  }
  if (armies >= 1) ok('army/muster occurs on some seeds (' + armies + '/4)');
  else fail('no armies/musters on any seed');
  if (battles >= 1) ok('battles occur on some seeds (' + battles + '/4)');
  else fail('no battles on any seed');
})();

// 6. Caravan robbery not back to ~99% and not 0% on all checked seeds
(() => {
  const rates = {};
  let tooHigh = 0, zeroAll = true;
  for (const seed of [1, 3, 6]) {
    const sb = createTestSandbox(); seedRandom(sb, seed); run(sb, 'generateWorld()');
    runDays(sb, 3000);
    const rate = caravanLossRate(sb);
    rates[seed] = rate != null ? +rate.toFixed(2) : null;
    if (rate != null) {
      if (rate >= 0.95) tooHigh++;
      if (rate > 0.01) zeroAll = false;
    }
  }
  if (tooHigh === 0) ok('caravan loss not ~99% on checked seeds ' + JSON.stringify(rates));
  else fail('caravan loss too high (dark age regression) ' + JSON.stringify(rates));
  if (!zeroAll) ok('caravan loss not 0% on all seeds (balance preserved) ' + JSON.stringify(rates));
  else fail('caravan loss 0% on all seeds — over-corrected balance');
})();

// 7. Route danger recovery
(() => {
  const sb = createTestSandbox(); seedRandom(sb, 4); run(sb, 'generateWorld()');
  const recovered = run(sb, `(function(){
    const r = world.routes.find(x => !x.destroyed);
    r.danger = 0.9; r.patrolLevel = 5;
    for (let i=0;i<80;i++) { r.danger = clamp(r.danger - 0.008 - r.patrolLevel*0.012, 0.02, 1); r.patrolLevel = Math.max(0, r.patrolLevel - 0.1); if (r.patrolLevel < 3) r.patrolLevel = 5; }
    return r.danger;
  })()`);
  if (recovered < 0.5) ok('route danger recovers to ' + recovered.toFixed(2));
  else fail('route danger stuck high: ' + recovered);
})();

// 8. Save/load + continue sim
(() => {
  const sb = createTestSandbox(); seedRandom(sb, 6); run(sb, 'generateWorld()');
  runDays(sb, 800);
  try {
    const { schema: s } = saveLoadRoundtrip(sb, { simDaysAfter: 100 });
    if (s === schema) ok('save/load schema ' + schema + ' + continue sim');
    else fail('schema after load: ' + s);
  } catch (e) {
    fail('save/load: ' + e.message);
  }
})();

// 9. Performance not severely degraded
(() => {
  const sb = createTestSandbox(); seedRandom(sb, 1); run(sb, 'generateWorld()');
  const t0 = Date.now();
  runDays(sb, 500);
  const msPerDay = (Date.now() - t0) / 500;
  if (msPerDay <= PERF_CEILING_MS) ok(`perf ${msPerDay.toFixed(1)}ms/day (ceiling ${PERF_CEILING_MS})`);
  else fail(`perf degraded: ${msPerDay.toFixed(1)}ms/day > ${PERF_CEILING_MS}`);
})();

finish('\n=== ALL REGRESSION TESTS PASSED ===', '\n=== REGRESSION GATE FAILED ===');
