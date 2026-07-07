/* Phase 19.3 Prep — muster / recruitment / militaryNeeds growth + staleness audit (audit only)
   รัน: node audit/probe-muster-growth.js [days] [seed]
   ตรวจว่า record เหล่านี้สะสม/ค้าง/orphan แค่ไหน และมี prune หรือไม่ */
'use strict';
const { boot } = require('./lib');

const DAYS = +(process.argv[2] || 5000);
const SEED = +(process.argv[3] || 7);
const STALE = 60; // วันหลัง targetDay/expiresDay ถือว่าค้างนาน
const S = boot(SEED);

const ANALYZE = `(function(){
  const w = world, day = w.day;
  const sIds = new Set(w.settlements.map(s => s.id));
  const oIds = new Set((w.organizations || []).map(o => o.id));
  const fIds = new Set(w.factions.map(f => f.id));
  const aAlive = id => { const a = w.agents.find(x => x.id === id); return a && a.alive; };

  // ── musterPoints ──
  const mps = w.musterPoints || [];
  const mp = { total: mps.length, byStatus: {}, orphanNoOrg: 0, orphanNoSettlement: 0, noAgents: 0, stalePending: 0, oldestStale: 0 };
  for (const m of mps) {
    mp.byStatus[m.status] = (mp.byStatus[m.status] || 0) + 1;
    if (m.organizationId != null && !oIds.has(m.organizationId)) mp.orphanNoOrg++;
    if (m.settlementId != null && !sIds.has(m.settlementId)) mp.orphanNoSettlement++;
    if ((m.arrivedAgentIds || []).length === 0 && (m.expectedAgentIds || []).length === 0) mp.noAgents++;
    const age = day - (m.targetDay || day);
    if (m.status === 'pending' && age > ${STALE}) mp.stalePending++;
    if (m.status !== 'complete') mp.oldestStale = Math.max(mp.oldestStale, age);
  }

  // ── recruitmentOffers ──
  const offers = w.recruitmentOffers || [];
  const ro = { total: offers.length, byStatus: {}, noAcceptedAndClosed: 0, invalidAccepted: 0, invalidTarget: 0, laborOffers: 0, repeatedFailByOrgType: {} };
  for (const o of offers) {
    ro.byStatus[o.status] = (ro.byStatus[o.status] || 0) + 1;
    if ((o.type || '').startsWith('labor_offer_')) ro.laborOffers++;
    const invalidAcc = (o.acceptedAgentIds || []).filter(id => !aAlive(id)).length;
    if (invalidAcc > 0) ro.invalidAccepted++;
    if ((o.status === 'failed' || o.status === 'filled') && (o.acceptedAgentIds || []).length === 0) ro.noAcceptedAndClosed++;
    if (o.targetSettlementId != null && !sIds.has(o.targetSettlementId)) ro.invalidTarget++;
    if (o.status === 'failed') { const k = (o.organizationId || '?') + ':' + o.type; ro.repeatedFailByOrgType[k] = (ro.repeatedFailByOrgType[k] || 0) + 1; }
  }
  const worstFail = Object.entries(ro.repeatedFailByOrgType).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // ── militaryNeeds ──
  const needs = w.militaryNeeds || [];
  const mn = { total: needs.length, byStatus: {}, noSubOffers: 0, noAssembled: 0, invalidRef: 0, stuck: 0, oldest: 0 };
  for (const n of needs) {
    mn.byStatus[n.status] = (mn.byStatus[n.status] || 0) + 1;
    if ((n.subOfferIds || []).length === 0) mn.noSubOffers++;
    if ((n.assembledWarbandIds || []).length === 0) mn.noAssembled++;
    if ((n.factionId != null && !fIds.has(n.factionId)) || (n.organizationId != null && !oIds.has(n.organizationId))) mn.invalidRef++;
    const age = day - (n.createdDay || day);
    if (n.status === 'active' && age > ${STALE}) mn.stuck++;
    mn.oldest = Math.max(mn.oldest, age);
  }

  return { day, mp, ro, worstFail, mn };
})()`;

console.log('=== Muster / Recruitment / MilitaryNeeds Growth (seed ' + SEED + ') ===\n');
const checkpoints = [];
for (let d = 0; d < DAYS; d += 500) {
  S.simDays(500);
  const a = S.run(ANALYZE);
  checkpoints.push(a);
  console.log(`day ${String(a.day).padStart(5)} | musters ${String(a.mp.total).padStart(4)} (${JSON.stringify(a.mp.byStatus)}) | offers ${String(a.ro.total).padStart(4)} (${JSON.stringify(a.ro.byStatus)}) | needs ${a.mn.total}`);
}
const f = checkpoints[checkpoints.length - 1];

console.log('\n== FINAL (day ' + f.day + ') ==');
console.log('musterPoints: total', f.mp.total, '| byStatus', JSON.stringify(f.mp.byStatus));
console.log('  orphan(no org)', f.mp.orphanNoOrg, '| orphan(no settlement)', f.mp.orphanNoSettlement, '| noAgents', f.mp.noAgents, '| stalePending>', f.mp.stalePending, '| oldestStale(days past target)', f.mp.oldestStale);
console.log('recruitmentOffers: total', f.ro.total, '| byStatus', JSON.stringify(f.ro.byStatus));
console.log('  closed w/ 0 accepted', f.ro.noAcceptedAndClosed, '| invalidAccepted', f.ro.invalidAccepted, '| invalidTarget', f.ro.invalidTarget, '| laborOffers', f.ro.laborOffers);
console.log('  repeated-fail by org:type (top):', JSON.stringify(f.worstFail));
console.log('militaryNeeds: total', f.mn.total, '| byStatus', JSON.stringify(f.mn.byStatus));
console.log('  noSubOffers', f.mn.noSubOffers, '| noAssembled', f.mn.noAssembled, '| invalidRef', f.mn.invalidRef, '| stuck-active>', f.mn.stuck, '| oldest(days)', f.mn.oldest);

console.log('\n== CODE PATHS ==');
console.log('  world.musterPoints — ไม่มี prune เลย (grep: ไม่มี filter/splice) → สะสมถาวร');
console.log('  cleanupOrphans() :3261 — recruitmentOffers filter ทิ้งเฉพาะ expired/cancelled; failed/filled/labor สะสมค้าง');
console.log('  militaryNeeds prune :9761 — filter เก็บ active หรืออายุ < 90 วัน (มี prune แล้ว)');
