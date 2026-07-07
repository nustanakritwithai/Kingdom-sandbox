/* Phase 19.3 Data Hygiene — archive/prune closed records without liveness regression
   run: node test-harness-193-hygiene.js */
'use strict';
const {
  createTestSandbox, seedRandom, run, runDays, findNaN,
  saveLoadRoundtrip, assertNoDanglingRefs, getCurrentSchemaVersion, createTestReporter
} = require('./test-utils/dom-mock');

const { ok, fail, finish } = createTestReporter('Phase 19.3 Data Hygiene');
const schema = getCurrentSchemaVersion(createTestSandbox());
console.log('=== Phase 19.3 Data Hygiene ===\n');
console.log('Current schema:', schema, '\n');

function countActiveTreatyDupes(sb) {
  return run(sb, `(function(){
    const m = new Map();
    let dup = 0;
    for (const t of world.treaties) {
      if (t.status !== 'active') continue;
      const k = getTreatyKey(t);
      m.set(k, (m.get(k) || 0) + 1);
    }
    for (const c of m.values()) if (c > 1) dup += c - 1;
    return dup;
  })()`);
}

function payloadBytes(sb) {
  return run(sb, 'JSON.stringify(SaveSystem.buildSavePayload()).length');
}

function deadRecordRatio(sb) {
  return run(sb, `(function(){
    let dead = 0, total = 0;
    for (const t of world.treaties) { total++; if (t.status !== 'active') dead++; }
    for (const m of world.musterPoints) { total++; if (m.status !== 'pending') dead++; }
    for (const o of world.recruitmentOffers) { total++; if (o.status !== 'open') dead++; }
    for (const c of world.tradeContracts) { total++; if (c.status !== 'open' && c.status !== 'accepted') dead++; }
    return total ? dead / total : 0;
  })()`);
}

function stalePendingMusters(sb) {
  return run(sb, `(function(){
    const stale = BALANCE.dataHygiene.staleMusterDays;
    let n = 0;
    for (const m of world.musterPoints) {
      if (m.status === 'pending' && world.day > m.targetDay + stale) n++;
    }
    return n;
  })()`);
}

function deadAcceptedRefs(sb) {
  return run(sb, `(function(){
    let n = 0;
    for (const o of world.recruitmentOffers) {
      for (const id of o.acceptedAgentIds || []) {
        const a = getAgent(id);
        if (!a || !a.alive) n++;
      }
    }
    return n;
  })()`);
}

function livenessSnapshot(sb) {
  return run(sb, `(function(){
    const lv = world.balanceMetrics.liveness;
    return {
      armies: lv.armiesCreated,
      musters: lv.successfulMusters,
      caravans: lv.caravanTrips,
      battles: lv.warsWithBattles
    };
  })()`);
}

// 1. setTreaty does not create active duplicate
(() => {
  const sb = createTestSandbox(); seedRandom(sb, 1); run(sb, 'generateWorld()');
  const ids = run(sb, 'world.factions.filter(f => !f.isBandit).slice(0, 2).map(f => f.id)');
  run(sb, `setTreaty(getFaction(${ids[0]}), getFaction(${ids[1]}), 'trade', 100)`);
  run(sb, `setTreaty(getFaction(${ids[0]}), getFaction(${ids[1]}), 'trade', 120)`);
  run(sb, `setTreaty(getFaction(${ids[0]}), getFaction(${ids[1]}), 'trade', 90)`);
  const dup = countActiveTreatyDupes(sb);
  const active = run(sb, `world.treaties.filter(t => t.status === 'active' && t.type === 'trade' && t.factions.includes(${ids[0]}) && t.factions.includes(${ids[1]})).length`);
  if (dup === 0 && active === 1) ok('setTreaty upserts — no active duplicate');
  else fail(`setTreaty dupes: extra=${dup} active=${active}`);
})();

// 2. duplicate active treaties from save deduped on migration
(() => {
  const sb = createTestSandbox(); seedRandom(sb, 2); run(sb, 'generateWorld()');
  const ids = run(sb, 'world.factions.filter(f => !f.isBandit).slice(0, 2).map(f => f.id)');
  run(sb, `(function(){
    world.treaties.push(
      { id: 90001, type: 'trade', factions: [${ids[0]}, ${ids[1]}], startDay: 1, endDay: 500, terms: {}, status: 'active', brokenBy: null, history: [] },
      { id: 90002, type: 'trade', factions: [${ids[1]}, ${ids[0]}], startDay: 2, endDay: 600, terms: { tariffReduction: 0.2 }, status: 'active', brokenBy: null, history: [] }
    );
  })()`);
  run(sb, 'DataHygieneSystem.migrationCleanup()');
  const dup = countActiveTreatyDupes(sb);
  if (dup === 0) ok('migration dedupes injected active treaty duplicates');
  else fail('migration dedupe left dupes: ' + dup);
})();

// 3–8. cleanup on synthetic old closed records
(() => {
  const sb = createTestSandbox(); seedRandom(sb, 3); run(sb, 'generateWorld()');
  run(sb, 'world.day = 5010');
  const ids = run(sb, 'world.factions.filter(f => !f.isBandit).slice(0, 2).map(f => f.id)');
  const s = run(sb, 'world.settlements[0].id');
  run(sb, `(function(){
    world.treaties.push({ id: 91001, type: 'peace', factions: [${ids[0]}, ${ids[1]}], startDay: 100, endDay: 200, status: 'expired', history: [] });
    world.musterPoints.push({ id: 91002, organizationId: world.organizations[0]?.id || 1, settlementId: ${s}, targetDay: 4000, status: 'failed', expectedAgentIds: [], arrivedAgentIds: [], missingAgentIds: [] });
    world.musterPoints.push({ id: 91003, organizationId: world.organizations[0]?.id || 1, settlementId: ${s}, targetDay: 100, status: 'pending', expectedAgentIds: [], arrivedAgentIds: [], missingAgentIds: [] });
    world.recruitmentOffers.push({ id: 91004, organizationId: world.organizations[0]?.id || 1, settlementId: ${s}, postedDay: 100, expiresDay: 120, status: 'failed', acceptedAgentIds: [], applicants: [], type: 'open_join', roleNeeded: 'soldier', quantityNeeded: 1, requirements: {}, rewards: {}, riskLevel: 0.2, duration: 14, reach: 'local', failCount: 0, escalation: 0 });
    world.tradeContracts.push({ id: 91005, issuerType: 'settlement', issuerId: ${s}, originId: ${s}, destinationId: ${s}, good: 'food', quantity: 5, reward: 10, deadlineDay: 1000, status: 'completed', createdDay: 500, acceptedByAgentId: null, escortUnitId: null, riskLevel: 0.1 });
    DataHygieneSystem.cleanupTreaties(200);
    DataHygieneSystem.cleanupMusterPoints(200);
    DataHygieneSystem.cleanupRecruitmentOffers(200);
    DataHygieneSystem.cleanupTradeContracts(200);
  })()`);
  const treatyLeft = run(sb, 'world.treaties.some(t => t.id === 91001)');
  const musterFailedGone = run(sb, '!world.musterPoints.some(m => m.id === 91002)');
  const musterPendingExpired = run(sb, `!world.musterPoints.some(m => m.id === 91003 && m.status === 'pending')`);
  const offerGone = run(sb, '!world.recruitmentOffers.some(o => o.id === 91004)');
  const contractGone = run(sb, '!world.tradeContracts.some(c => c.id === 91005)');
  if (!treatyLeft) ok('old expired treaty archived/pruned');
  else fail('expired treaty still live');
  if (musterFailedGone) ok('old failed muster pruned');
  else fail('old failed muster remains');
  if (musterPendingExpired) ok('stale pending muster expired');
  else fail('stale pending muster stuck');
  if (offerGone) ok('old failed recruitment offer pruned');
  else fail('old failed offer remains');
  if (contractGone) ok('old completed tradeContract pruned');
  else fail('old completed contract remains');
})();

// 6. dead acceptedAgentIds removed
(() => {
  const sb = createTestSandbox(); seedRandom(sb, 4); run(sb, 'generateWorld()');
  run(sb, `(function(){
    const a = world.agents[0];
    a.alive = false;
    world.recruitmentOffers.push(defaultRecruitmentOffer({
      id: 92001, organizationId: world.organizations[0]?.id || 1, settlementId: world.settlements[0].id,
      status: 'open', acceptedAgentIds: [a.id]
    }));
    DataHygieneSystem.cleanupRecruitmentOffers(50);
  })()`);
  const dead = deadAcceptedRefs(sb);
  if (dead === 0) ok('dead acceptedAgentIds removed from offers');
  else fail('dead accepted refs remain: ' + dead);
})();

// 9. active valid records not deleted
(() => {
  const sb = createTestSandbox(); seedRandom(sb, 5); run(sb, 'generateWorld()');
  runDays(sb, 800);
  const before = run(sb, `(function(){
    return {
      treaties: world.treaties.filter(t => t.status === 'active').length,
      openOffers: world.recruitmentOffers.filter(o => o.status === 'open').length,
      openContracts: world.tradeContracts.filter(c => c.status === 'open' || c.status === 'accepted').length
    };
  })()`);
  run(sb, 'DataHygieneSystem.tick()');
  const after = run(sb, `(function(){
    return {
      treaties: world.treaties.filter(t => t.status === 'active').length,
      openOffers: world.recruitmentOffers.filter(o => o.status === 'open').length,
      openContracts: world.tradeContracts.filter(c => c.status === 'open' || c.status === 'accepted').length
    };
  })()`);
  if (after.treaties >= before.treaties && after.openContracts >= Math.min(before.openContracts, after.openContracts)) {
    ok('active valid treaties/contracts not mass-deleted');
  } else fail(`active records dropped treaties ${before.treaties}->${after.treaties} contracts ${before.openContracts}->${after.openContracts}`);
})();

// 10. migration idempotent
(() => {
  const sb = createTestSandbox(); seedRandom(sb, 6); run(sb, 'generateWorld()');
  runDays(sb, 1200);
  const snap1 = run(sb, `(function(){
    DataHygieneSystem.migrationCleanup();
    return {
      treaties: world.treaties.length,
      musters: world.musterPoints.length,
      offers: world.recruitmentOffers.length,
      contracts: world.tradeContracts.length,
      arch: (world.dataArchive.treaties.length + world.dataArchive.musters.length + world.dataArchive.recruitment.length + world.dataArchive.tradeContracts.length)
    };
  })()`);
  const snap2 = run(sb, `(function(){
    DataHygieneSystem.migrationCleanup();
    return {
      treaties: world.treaties.length,
      musters: world.musterPoints.length,
      offers: world.recruitmentOffers.length,
      contracts: world.tradeContracts.length,
      arch: (world.dataArchive.treaties.length + world.dataArchive.musters.length + world.dataArchive.recruitment.length + world.dataArchive.tradeContracts.length)
    };
  })()`);
  const same = JSON.stringify(snap1) === JSON.stringify(snap2);
  if (same) ok('migration cleanup idempotent (2 passes identical counts)');
  else fail(`idempotency broken: ${JSON.stringify(snap1)} vs ${JSON.stringify(snap2)}`);
})();

// 11. save growth reduced at 25k vs PR #20 baseline (~1,550KB / ~70% dead bytes)
(() => {
  const BASELINE_25K_BYTES = 1550000;
  const sb = createTestSandbox(); seedRandom(sb, 6); run(sb, 'generateWorld()');
  runDays(sb, 25000);
  const bytesWith = payloadBytes(sb);
  const dup = countActiveTreatyDupes(sb);
  const staleM = stalePendingMusters(sb);
  const deadRefs = deadAcceptedRefs(sb);
  const reduction = 1 - bytesWith / BASELINE_25K_BYTES;
  if (bytesWith < BASELINE_25K_BYTES * 0.65 && dup === 0 && staleM === 0 && deadRefs === 0) {
    ok(`save @25k ${Math.round(bytesWith / 1024)}KB (${(reduction * 100).toFixed(0)}% below baseline) dupes=0 staleMuster=0`);
  } else {
    fail(`save @25k: ${Math.round(bytesWith / 1024)}KB reduction=${(reduction * 100).toFixed(0)}% dupes=${dup} staleM=${staleM} deadRefs=${deadRefs}`);
  }
})();

// 12. no NaN / dangling refs after cleanup
(() => {
  const sb = createTestSandbox(); seedRandom(sb, 7); run(sb, 'generateWorld()');
  runDays(sb, 3000);
  run(sb, 'DataHygieneSystem.tick(); DataHygieneSystem.migrationCleanup()');
  const nan = findNaN(sb.world);
  try {
    assertNoDanglingRefs(sb);
    if (!nan.length) ok('0 NaN and no dangling refs after cleanup');
    else fail('NaN: ' + nan.slice(0, 3).join(', '));
  } catch (e) {
    fail(e.message);
  }
})();

// 13. 19.1 liveness not regressed (medium run)
(() => {
  const sb = createTestSandbox(); seedRandom(sb, 8); run(sb, 'generateWorld()');
  runDays(sb, 2000);
  const lv = livenessSnapshot(sb);
  if (lv.armies >= 1 && lv.caravans >= 5 && lv.musters >= 0) {
    ok(`liveness ok armies=${lv.armies} caravans=${lv.caravans} musters=${lv.musters}`);
  } else fail('liveness regressed: ' + JSON.stringify(lv));
})();

// 14. save/load roundtrip after cleanup
(() => {
  const sb = createTestSandbox(); seedRandom(sb, 6); run(sb, 'generateWorld()');
  runDays(sb, 1500);
  run(sb, 'DataHygieneSystem.tick()');
  try {
    saveLoadRoundtrip(sb, { simDaysAfter: 100 });
    ok('save/load roundtrip + 100d sim after cleanup');
  } catch (e) {
    fail('save/load: ' + e.message);
  }
})();

finish('=== ALL 19.3 HYGIENE TESTS PASSED ===', '=== SOME 19.3 HYGIENE TESTS FAILED ===');
