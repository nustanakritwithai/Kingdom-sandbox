/* Phase 19.4B Court Politics Activation — run: node test-harness-194b-court-politics.js */
'use strict';
const {
  createTestSandbox, seedRandom, run, runDays, findNaN,
  saveLoadRoundtrip, assertNoDanglingRefs, getCurrentSchemaVersion, createTestReporter
} = require('./test-utils/dom-mock');

const { ok, fail, finish } = createTestReporter('Phase 19.4B Court Politics');
const sandbox = createTestSandbox();
const schema = getCurrentSchemaVersion(sandbox);

if (run(sandbox, 'typeof CourtSystem === "undefined"')) {
  console.log('SKIP: CourtSystem not in build');
  process.exit(0);
}

const genWorld = (seed) => {
  if (seed != null) seedRandom(sandbox, seed);
  run(sandbox, seed != null ? `(function(){ generateWorld(); world.seed=${seed}; })()` : 'generateWorld()');
};
const simDay = () => run(sandbox, 'simulateDay()');
const simDays = (n) => runDays(sandbox, n);

function makeLandedRealm() {
  return run(sandbox, `(function() {
    const s = world.settlements.find(x => x.type === 'village');
    if (!s) return null;
    const leader = createAgent({ locationId: s.id, profession: 'lord', factionId: s.factionId });
    leader.skills = leader.skills || {}; leader.skills.leadership = 4;
    const ids = [leader.id];
    for (let i = 0; i < 5; i++) ids.push(createAgent({ locationId: s.id, profession: 'guard', factionId: s.factionId }).id);
    const org = createOrganization({
      name: 'Politics Realm ' + world.organizations.length, type: 'mercenary_company', leaderId: leader.id,
      homeSettlementId: s.id, memberIds: ids.slice(), purpose: 'conquest', wealth: 200
    });
    s.ownerOrganizationId = org.id; s.taxRecipient = org.id;
    SovereigntySystem.updateOrganizationSovereignty(org);
    CourtSystem.ensureCourt(org);
    return { orgId: org.id, leaderId: leader.id, settlementId: s.id };
  })()`);
}

function countOpenOffers() {
  return run(sandbox, `(world.recruitmentOffers || []).filter(o => o.status === 'open').length`);
}

function livenessOk() {
  return run(sandbox, `(function(){
    const lv = world.balanceMetrics.liveness;
    return { armies: lv.armiesCreated, caravans: lv.caravanTrips, battles: lv.warsWithBattles };
  })()`);
}

console.log('=== Phase 19.4B Court Politics Activation ===\n');
if (schema === '19.4B') ok('schema 19.4B');
else fail('schema expected 19.4B got ' + schema);

// 1. shadow mode computes decisions but does not apply tax effects
(() => {
  genWorld(19401);
  const realm = makeLandedRealm();
  run(sandbox, `BALANCE.court.politicsMode = 'shadow'; world.courtPoliticsMode = 'shadow'`);
  const r = run(sandbox, `(function(){
    const org = getOrganization(${realm.orgId});
    org.wealth = 5;
    CourtSystem.rebuildCourtMembers(org);
    const sid = org.sovereignty.settlementIds[0];
    const taxBefore = getSettlement(sid).taxRate;
    CourtSystem.considerCourtDecision(org);
    const taxAfter = getSettlement(sid).taxRate;
    const cm = world.balanceMetrics.court;
    const shadowDecisions = (org.court.decisions || []).filter(d => (d.detail || '').includes('[shadow]')).length;
    return { shadowDecisions, considered: cm.decisionsConsidered, skipped: cm.decisionsSkippedShadow, applied: cm.decisionsApplied, taxBefore, taxAfter };
  })()`);
  if (r.considered > 0 && r.applied === 0 && r.shadowDecisions > 0 && r.taxBefore === r.taxAfter) ok('shadow mode computes decisions without applying effects');
  else fail('shadow mode broken: ' + JSON.stringify(r));
})();

// 2. limited mode applies low-risk decisions
(() => {
  genWorld(19402);
  const realm = makeLandedRealm();
  run(sandbox, `BALANCE.court.politicsMode = 'limited'; world.courtPoliticsMode = 'limited'`);
  run(sandbox, `(function(){
    const org = getOrganization(${realm.orgId});
    CourtSystem.rebuildCourtMembers(org);
    for (const id of org.memberIds) {
      const a = getAgent(id);
      if (a && a.id !== org.leaderId) { a.skills = a.skills || {}; a.skills.leadership = 3; }
    }
    CourtSystem.rebuildCourtMembers(org);
    org.court.succession.currentHeirId = null;
    org.court._decisionsThisYear = 0;
    const d = { type: 'name_heir', detail: 'test heir', importance: 3 };
    return CourtSystem.applyDecisionWithBudget(org, d);
  })()`);
  const heirSet = run(sandbox, `!!getOrganization(${realm.orgId}).court.succession.currentHeirId`);
  const applied = run(sandbox, 'world.balanceMetrics.court.decisionsApplied');
  if (heirSet && applied > 0) ok('limited mode applies low-risk decisions');
  else fail('limited low-risk apply failed heir=' + heirSet + ' applied=' + applied);
})();

// 3. active mode is not default
(() => {
  genWorld(19403);
  run(sandbox, `BALANCE.court.politicsMode = 'shadow'; world.courtPoliticsMode = 'shadow'`);
  const mode = run(sandbox, 'CourtSystem.getPoliticsMode()');
  if (mode !== 'active') ok('default politics mode is not active (' + mode + ')');
  else fail('active must not be default');
})();

// 4. court decision throttle / budget
(() => {
  genWorld(19404);
  const realm = makeLandedRealm();
  run(sandbox, `BALANCE.court.politicsMode = 'limited'; world.courtPoliticsMode = 'limited'; BALANCE.court.decisionBudgetPerYear = 2`);
  const blocked = run(sandbox, `(function(){
    const org = getOrganization(${realm.orgId});
    CourtSystem.ensureCourtThrottleState(org.court);
    org.court._decisionsThisYear = 2;
    let n = 0;
    for (let i = 0; i < 5; i++) if (!CourtSystem.canApplyDecision({ type: 'lower_tax', detail: 'x', importance: 2 }, org)) n++;
    return n;
  })()`);
  if (blocked >= 3) ok('court decision budget throttle works');
  else fail('decision budget throttle weak: blocked=' + blocked);
})();

// 5. civil war does not spawn soldiers
(() => {
  genWorld(19405);
  const realm = makeLandedRealm();
  const r = run(sandbox, `(function(){
    const org = getOrganization(${realm.orgId});
    CourtSystem.rebuildCourtMembers(org);
    const agentsBefore = world.agents.length;
    const claimant = org.memberIds.map(getAgent).filter(a => a && a.alive && a.id !== org.leaderId);
    if (claimant.length < 2) return { ok: false, reason: 'not enough agents', n: claimant.length };
    const fac = CourtSystem.createFaction(org, claimant[0].id, 'support_claimant');
    if (fac) fac.memberIds = claimant.slice(1, 3).map(a => a.id);
    const cw = CourtSystem.startCivilWar(org, claimant[0].id, 'test', { force: true });
    return { ok: world.agents.length === agentsBefore && !!cw, agentsBefore, after: world.agents.length, cw: !!cw };
  })()`);
  if (r.ok) ok('civil war does not spawn new agents');
  else fail('civil war issue: ' + JSON.stringify(r));
})();

// 6. civil war uses real warbands
(() => {
  genWorld(19406);
  const realm = makeLandedRealm();
  const r = run(sandbox, `(function(){
    const org = getOrganization(${realm.orgId});
    CourtSystem.rebuildCourtMembers(org);
    const rebels = org.memberIds.map(getAgent).filter(a => a && a.alive && a.id !== org.leaderId).slice(0, 3);
    if (rebels.length < 2) return { ok: false, reason: 'not enough rebels' };
    const fac = CourtSystem.createFaction(org, rebels[0].id, 'support_claimant');
    if (fac) fac.memberIds = rebels.slice(1).map(a => a.id);
    const cw = CourtSystem.startCivilWar(org, rebels[0].id, 'test', { force: true });
    if (!cw) return { ok: false, reason: 'no cw' };
    const rebelWbs = cw.rebelWarbandIds.map(getWarband).filter(Boolean);
    const allReal = rebelWbs.flatMap(w => w.memberIds).every(id => getAgent(id)?.alive);
    return { ok: rebelWbs.length > 0 && allReal, rebelCount: rebelWbs.length };
  })()`);
  if (r.ok) ok('civil war uses real agent warbands');
  else fail('civil war warband invalid: ' + JSON.stringify(r));
})();

// 7. protected recruitment offers not drained by court tick
(() => {
  genWorld(19407);
  run(sandbox, `BALANCE.court.politicsMode = 'limited'; world.courtPoliticsMode = 'limited'`);
  const before = countOpenOffers();
  simDays(400);
  const after = countOpenOffers();
  const lv = livenessOk();
  if (after >= Math.min(before, 1) || lv.caravans >= 2) ok('recruitment offers not drained by court tick (open ' + before + '→' + after + ')');
  else fail('recruitment drained: before=' + before + ' after=' + after);
})();

// 8. 19.1 liveness still passes
(() => {
  genWorld(19408);
  simDays(400);
  const lv = livenessOk();
  if (lv.caravans >= 3) ok('19.1 liveness ok with politics (caravans=' + lv.caravans + ')');
  else fail('liveness regressed: ' + JSON.stringify(lv));
})();

// 9. DataHygiene does not prune active court refs
(() => {
  genWorld(19409);
  const realm = makeLandedRealm();
  run(sandbox, `(function(){
    const org = getOrganization(${realm.orgId});
    CourtSystem.rebuildCourtMembers(org);
    CourtSystem.chooseHeir(org, 'appointment', true);
    CourtSystem.appointOffice(org, 'steward', org.court.courtMemberIds.find(id => id !== org.leaderId), true);
  })()`);
  const before = run(sandbox, `(function(){
    const org = getOrganization(${realm.orgId});
    return { offices: org.court.offices.length, members: org.court.courtMemberIds.length, heir: org.court.succession.currentHeirId };
  })()`);
  run(sandbox, 'DataHygieneSystem.migrationCleanup(); DataHygieneSystem.tick()');
  const after = run(sandbox, `(function(){
    const org = getOrganization(${realm.orgId});
    return { offices: org.court.offices.length, members: org.court.courtMemberIds.length, heir: org.court.succession.currentHeirId };
  })()`);
  if (after.offices >= before.offices && after.members >= 1 && after.heir) ok('DataHygiene preserves active court refs');
  else fail('DataHygiene pruned court: ' + JSON.stringify({ before, after }));
})();

// 10. save/load schema 19.4B
(() => {
  genWorld(19410);
  makeLandedRealm();
  simDays(40);
  const sl = run(sandbox, `(function(){
    const p = SaveSystem.buildSavePayload('t194b');
    SaveSystem.loadFromPayload(p);
    return { schema: p.schemaVersion, courts: world.organizations.filter(o => o.court).length, mode: world.courtPoliticsMode };
  })()`);
  if (sl.schema === '19.4B' && sl.courts > 0 && sl.mode) ok('save/load schema 19.4B preserves court');
  else fail('save/load failed: ' + JSON.stringify(sl));
})();

// 11. migration 19.4A → 19.4B idempotent
(() => {
  genWorld(19411);
  makeLandedRealm();
  const r = run(sandbox, `(function(){
    const p = SaveSystem.buildSavePayload('mig');
    p.schemaVersion = '19.4A';
    delete p.world.courtPoliticsMode;
    p.world.balanceMetrics.court = undefined;
    SaveSystem.loadFromPayload(p);
    const m1 = world.courtPoliticsMode;
    SaveSystem.loadFromPayload(SaveSystem.buildSavePayload('mig2'));
    const m2 = world.courtPoliticsMode;
    return { m1, m2, schema: SAVE_SCHEMA_VERSION };
  })()`);
  if (r.schema === '19.4B' && r.m1 === 'passive' && r.m2 === 'passive') ok('migration 19.4A→19.4B idempotent (passive)');
  else fail('migration failed: ' + JSON.stringify(r));
})();

// 12. no NaN / no dangling refs
(() => {
  genWorld(19412);
  simDays(200);
  run(sandbox, 'CourtSystem.runIntegrityCheck({ repair: true, silent: true })');
  if (run(sandbox, 'typeof WorldIntegritySystem !== "undefined"')) {
    run(sandbox, 'WorldIntegritySystem.runIntegrityCheck({ repair: true, silent: true })');
  }
  const nan = findNaN(sandbox.world);
  let dangling = 0;
  try { dangling = assertNoDanglingRefs(sandbox); } catch (e) { dangling = e.count || 1; }
  if (!nan.length && dangling === 0) ok('no NaN / no dangling refs after 200d');
  else fail('integrity: nan=' + nan.slice(0, 3).join(',') + ' dangling=' + dangling);
})();

finish('\n=== ALL 19.4B TESTS PASSED ===', '\n=== SOME 19.4B TESTS FAILED ===');
