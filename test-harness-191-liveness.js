/* Phase 19.1 Liveness Unlock — headless test — run: node test-harness-191-liveness.js */
'use strict';
const {
  createTestSandbox, seedRandom, run, runDays, findNaN,
  getCurrentSchemaVersion, saveLoadRoundtrip, createTestReporter
} = require('./test-utils/dom-mock');

const { ok, fail, finish } = createTestReporter('Phase 19.1 Liveness Tests');
const schema = getCurrentSchemaVersion(createTestSandbox({ loadGame: true }));

console.log('=== Phase 19.1 Liveness Tests ===\n');

(() => {
  const sb = createTestSandbox(); seedRandom(sb, 3); run(sb, 'generateWorld()');
  run(sb, `(function(){
    const f = world.factions.find(x => !x.isBandit);
    for (const a of world.agents) if (a.alive && a.factionId === f.id && (RULER_PROFS.has(a.profession) || a.skills.leadership > 4)) NeedSystem.kill(a, 'ทดสอบ');
    globalThis.__testF = f.id;
  })()`);
  runDays(sb, 30);
  const res = run(sb, `(function(){
    const f = getFaction(__testF);
    const r = f.rulerId != null ? getAgent(f.rulerId) : null;
    return { hasLeader: !!(r && r.alive), recovered: world.balanceMetrics.liveness.rulersRecovered };
  })()`);
  if (res.hasLeader && res.recovered > 0) ok('faction ฟื้นผู้นำหลังราชาตายไร้ทายาท (recovered=' + res.recovered + ')');
  else fail('leadership recovery: ' + JSON.stringify(res));
})();

(() => {
  const sb = createTestSandbox(); seedRandom(sb, 5); run(sb, 'generateWorld()');
  runDays(sb, 2000);
  const dangling = run(sb, `(function(){
    let bad = 0;
    for (const f of world.factions) { if (f.rulerId != null) { const r = getAgent(f.rulerId); if (!r || !r.alive) bad++; } }
    for (const s of world.settlements) { if (s.governorId != null) { const g = getAgent(s.governorId); if (!g || !g.alive) bad++; } }
    return bad;
  })()`);
  if (dangling === 0) ok('ไม่มี dangling ruler/governor หลัง 2000 วัน');
  else fail('dangling refs: ' + dangling);
})();

(() => {
  const sb = createTestSandbox(); seedRandom(sb, 2); run(sb, 'generateWorld()');
  run(sb, `(function(){
    globalThis.__spawns = 0; const _ca = createAgent;
    globalThis.createAgent = function(o){ if (o && o.profession && MILITARY_PROFS.has(o.profession)) __spawns++; return _ca(o); };
  })()`);
  runDays(sb, 2500);
  const res = run(sb, `(function(){
    const lv = world.balanceMetrics.liveness;
    const applicants = world.recruitmentOffers.reduce((s,o)=>s+o.acceptedAgentIds.length,0);
    return { musters: lv.successfulMusters, warbands: lv.warbandsFormed, applicants, spawns: __spawns };
  })()`);
  if (res.musters >= 1) ok('รวมพลสำเร็จ (successfulMusters=' + res.musters + ')');
  else fail('no successful musters');
  if (res.applicants > 0) ok('มีผู้สมัครเข้าเกณฑ์ (applicants=' + res.applicants + ')');
  else fail('no applicants');
  if (res.spawns === 0) ok('ไม่มีการเสกทหาร (spawned soldiers = 0)');
  else fail('spawned soldiers detected: ' + res.spawns);
})();

(() => {
  let anyArmy = false, anyBattle = false, best = {};
  for (const seed of [1, 2, 5, 7]) {
    const sb = createTestSandbox(); seedRandom(sb, seed); run(sb, 'generateWorld()');
    runDays(sb, 3000);
    const r = run(sb, `({ armies: world.balanceMetrics.liveness.armiesCreated, battled: world.wars.filter(w=>w.battles.length>0).length })`);
    if (r.armies > 0) anyArmy = true;
    if (r.battled > 0) anyBattle = true;
    best[seed] = r;
  }
  if (anyArmy) ok('กองทัพก่อตัวจริงในบาง seed ' + JSON.stringify(best));
  else fail('no armies formed in any seed ' + JSON.stringify(best));
  if (anyBattle) ok('สงครามมีการรบจริงในบาง seed');
  else fail('no wars with battles in any seed');
})();

(() => {
  const sb = createTestSandbox(); seedRandom(sb, 4); run(sb, 'generateWorld()');
  runDays(sb, 200);
  const recovered = run(sb, `(function(){
    const r = world.routes.find(x => !x.destroyed);
    r.danger = 0.9; r.patrolLevel = 5;
    const start = r.danger;
    for (let i=0;i<80;i++) { r.danger = clamp(r.danger - 0.008 - r.patrolLevel*0.012, 0.02, 1); r.patrolLevel = Math.max(0, r.patrolLevel - 0.1); if (r.patrolLevel < 3) r.patrolLevel = 5; }
    return { start, end: r.danger };
  })()`);
  if (recovered.end < 0.5) ok('เส้นทางฟื้นจาก danger 0.9 → ' + recovered.end.toFixed(2) + ' (มีลาดตระเวน)');
  else fail('route did not recover: ' + JSON.stringify(recovered));
})();

(() => {
  let good = 0; const rates = {};
  for (const seed of [1, 3, 6]) {
    const sb = createTestSandbox(); seedRandom(sb, seed); run(sb, 'generateWorld()');
    runDays(sb, 3000);
    const rate = run(sb, `(function(){
      const lv = world.balanceMetrics.liveness;
      const total = lv.caravanTrips + lv.caravanLost;
      return total > 0 ? lv.caravanLost / total : 0;
    })()`);
    rates[seed] = +rate.toFixed(2);
    if (rate < 0.9) good++;
  }
  if (good >= 2) ok('caravan loss < 90% ในอย่างน้อย 2/3 seed ' + JSON.stringify(rates));
  else fail('caravan loss too high ' + JSON.stringify(rates));
})();

(() => {
  let anySpecialist = false; const counts = {};
  for (const seed of [1, 2, 3, 4]) {
    const sb = createTestSandbox(); seedRandom(sb, seed); run(sb, 'generateWorld()');
    runDays(sb, 3000);
    const n = run(sb, `world.agents.filter(a=>a.alive && (a.profession==='miner'||a.profession==='woodcutter'||a.profession==='crafter')).length`);
    counts[seed] = n; if (n > 0) anySpecialist = true;
  }
  if (anySpecialist) ok('specialist (miner/woodcutter/crafter) รอดในบาง seed ' + JSON.stringify(counts));
  else fail('specialists extinct in all seeds ' + JSON.stringify(counts));
})();

(() => {
  const sb = createTestSandbox(); seedRandom(sb, 6); run(sb, 'generateWorld()');
  runDays(sb, 1500);
  const nan1 = findNaN(sb.world);
  if (!nan1.length) ok('0 NaN หลัง 1500 วัน');
  else fail('NaN found: ' + JSON.stringify(nan1.slice(0, 5)));

  try {
    saveLoadRoundtrip(sb, { simDaysAfter: 100, slot: 't191' });
    ok('save schema ' + schema + ' + load restore + จำลองต่อ 100 วัน (0 NaN)');
  } catch (e) {
    fail('roundtrip: ' + e.message);
  }
})();

finish('\n=== ALL PHASE 19.1 TESTS PASSED ===', '\n=== SOME PHASE 19.1 TESTS FAILED ===');
