/* Phase 18.5 headless stability tests — run: node test-harness-185.js
   Adapted for schema 19.1 branch (no WorldIntegritySystem / BALANCE global) */
'use strict';
const {
  createTestSandbox, seedRandom, run, runDays, findNaN,
  getCurrentSchemaVersion, assertNoDanglingRefs, createTestReporter
} = require('./test-utils/dom-mock');

const { ok, fail, finish } = createTestReporter('Phase 18.5 World Stability Tests');
const sandbox = createTestSandbox();
const genWorld = (seed) => {
  if (seed != null) seedRandom(sandbox, seed);
  run(sandbox, seed != null ? `(function(){ generateWorld(); world.seed=${seed}; })()` : 'generateWorld()');
};

console.log('=== Phase 18.5 World Stability Tests ===\n');

const schema = getCurrentSchemaVersion(sandbox);
if (schema) ok('schema ' + schema);
else fail('schema missing');

if (run(sandbox, 'typeof defaultBalanceMetrics === "function" && defaultBalanceMetrics().liveness')) ok('liveness metrics config present');
else fail('liveness metrics missing');

const PERF_CEILING_MS = 25;

function assertWorldInvariants(label) {
  const r = run(sandbox, `(function() {
    const issues = [];
    const agentWarband = new Map();
    for (const wb of (world.warbands || [])) {
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
    const lv = world.balanceMetrics?.liveness;
    if (lv && typeof lv.armiesCreated !== 'number') issues.push('liveness_bad');
    const critical = issues.filter(x => !x.startsWith('landed_no_settle:'));
    return { issues: critical, soft: issues.length - critical.length, day: world.day };
  })()`);
  if (r.issues.length) fail(`${label}: ${r.issues.slice(0, 8).join(', ')}`);
  else ok(`${label} invariants (day ${r.day}${r.soft ? ', soft=' + r.soft : ''})`);
  return r;
}

genWorld(18501);
const cloneTest = run(sandbox, `(function() {
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

for (const seed of [18511, 18512, 18513]) {
  genWorld(seed);
  runDays(sandbox, 1000);
  const nan = findNaN(sandbox.world);
  if (nan.length) fail(`seed ${seed} 1000d NaN: ${nan.slice(0, 3).join(', ')}`);
  else ok(`seed ${seed} 1000 days no NaN`);
  assertWorldInvariants(`seed ${seed} 1000d`);
  run(sandbox, 'SovereigntySystem.validateNoGhostOwners()');
}

for (const seed of [18521, 18522]) {
  genWorld(seed);
  const t0 = Date.now();
  runDays(sandbox, 3000);
  const avgTick = (Date.now() - t0) / 3000;
  if (avgTick > PERF_CEILING_MS) fail(`seed ${seed} perf slow ${avgTick.toFixed(1)}ms/tick`);
  else ok(`seed ${seed} 3000 days perf ${avgTick.toFixed(1)}ms/tick`);
  assertWorldInvariants(`seed ${seed} 3000d`);
}

genWorld(18531);
runDays(sandbox, 1000);
const payload = run(sandbox, 'SaveSystem.buildSavePayload("test")');
if (payload.schemaVersion === schema) ok('save payload schema ' + schema);
else fail('save schema mismatch');
run(sandbox, `(function(p) { SaveSystem.loadFromPayload(p); })(${JSON.stringify(payload)})`);
runDays(sandbox, 500);
assertWorldInvariants('save/load + 500d');

genWorld(18532);
try {
  assertNoDanglingRefs(sandbox);
  ok('dangling ref check on fresh world');
} catch (e) {
  fail(e.message);
}

genWorld();
if (run(sandbox, 'typeof SovereigntySystem.validateNoGhostOwners === "function"')) ok('ghost owner validator exists');
else fail('SovereigntySystem.validateNoGhostOwners missing');

finish('\n=== ALL PHASE 18.5 TESTS PASSED ===', '\n=== SOME TESTS FAILED ===');
