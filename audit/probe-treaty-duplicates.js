/* Phase 19.3 Prep — treaty duplicate / stale / orphan audit (audit only)
   รัน: node audit/probe-treaty-duplicates.js [days] [seed]
   ยืนยัน: (1) active duplicate คู่เดิม+type เดียวกัน
           (2) expired/broken ไม่ถูก prune
           (3) party faction ไม่มีจริง
           (4) ลงนามซ้ำก่อนฉบับเก่าหมดอายุ (peak dup ระหว่างรัน) */
'use strict';
const { boot } = require('./lib');

const DAYS = +(process.argv[2] || 3000);
const SEED = +(process.argv[3] || 42);
const S = boot(SEED);

const ANALYZE = `(function(){
  const w = world;
  const treaties = w.treaties || [];
  const factionIds = new Set(w.factions.map(f => f.id));
  const byStatus = {};
  const pairActive = {};   // key = sortedFactions:type → [treaty]
  let orphanParty = 0, missingHistory = 0;
  const orphanExamples = [];
  for (const t of treaties) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    if (!Array.isArray(t.history)) missingHistory++;
    const parties = t.factions || [];
    const badParty = parties.some(id => !factionIds.has(id));
    if (t.status === 'active' && badParty) { orphanParty++; if (orphanExamples.length < 10) orphanExamples.push({ id: t.id, type: t.type, factions: parties, startDay: t.startDay }); }
    if (t.status === 'active') {
      const key = [...parties].sort((a, b) => a - b).join('-') + ':' + t.type;
      (pairActive[key] = pairActive[key] || []).push(t);
    }
  }
  const dupGroups = Object.entries(pairActive).filter(([, ts]) => ts.length > 1);
  const dupExamples = dupGroups.slice(0, 10).map(([key, ts]) => ({
    key, count: ts.length,
    ids: ts.map(t => t.id),
    startDays: ts.map(t => t.startDay),
    endDays: ts.map(t => t.endDay)
  }));
  const dupActiveExtra = dupGroups.reduce((s, [, ts]) => s + (ts.length - 1), 0);
  return {
    day: w.day, total: treaties.length, byStatus,
    activePairsWithDup: dupGroups.length,
    maxDupPerPair: dupGroups.length ? Math.max(...dupGroups.map(([, ts]) => ts.length)) : 0,
    dupActiveExtra, orphanParty, missingHistory,
    dupExamples, orphanExamples
  };
})()`;

console.log('=== Treaty Duplicate / Stale Audit (seed ' + SEED + ') ===\n');
let peakDup = 0, peakSnap = null;
const checkpoints = [];
for (let d = 0; d < DAYS; d += 250) {
  S.simDays(250);
  const a = S.run(ANALYZE);
  checkpoints.push({ day: a.day, total: a.total, active: a.byStatus.active || 0, dupExtra: a.dupActiveExtra, maxDup: a.maxDupPerPair });
  if (a.dupActiveExtra > peakDup) { peakDup = a.dupActiveExtra; peakSnap = a; }
}
const final = S.run(ANALYZE);

console.log('— checkpoint (ทุก 250 วัน): day | total | active | dupExtra | maxDupPerPair —');
for (const c of checkpoints) console.log(`  ${String(c.day).padStart(5)} | ${String(c.total).padStart(4)} | ${String(c.active).padStart(3)} | ${String(c.dupExtra).padStart(3)} | ${c.maxDup}`);

console.log('\n== FINAL (day ' + final.day + ') ==');
console.log('total treaties (ไม่เคยถูกลบ):', final.total, '| byStatus:', JSON.stringify(final.byStatus));
console.log('active pairs with duplicate:', final.activePairsWithDup, '| extra active dup treaties:', final.dupActiveExtra, '| max per pair:', final.maxDupPerPair);
console.log('orphan active (party faction missing):', final.orphanParty);
console.log('treaties missing history array:', final.missingHistory);
if (final.dupExamples.length) { console.log('\ndup examples:'); for (const e of final.dupExamples) console.log('  ', JSON.stringify(e)); }
if (final.orphanExamples.length) { console.log('\norphan examples:'); for (const e of final.orphanExamples) console.log('  ', JSON.stringify(e)); }

console.log('\n== PEAK duplicate ระหว่างรัน ==');
console.log('peak extra-active-dup =', peakDup, peakSnap ? '(day ' + peakSnap.day + ', maxPerPair ' + peakSnap.maxDupPerPair + ')' : '');
if (peakSnap && peakSnap.dupExamples.length) console.log('peak dup example:', JSON.stringify(peakSnap.dupExamples[0]));

console.log('\n== CODE PATHS (อ้างอิง script.js) ==');
console.log('  setTreaty() :10095 — เรียก createTreaty ทุก type โดย "ไม่เช็ค active duplicate" ก่อนสร้าง');
console.log('  createTreaty() :10078 — push เข้า world.treaties เสมอ (ไม่มี dedupe)');
console.log('  updateTreaties() :10242 — พลิก status เป็น expired เท่านั้น "ไม่ลบออกจาก array"');
console.log('  breakTreaty() :10141 — พลิก status เป็น broken เท่านั้น (ไม่ลบ)');
console.log('  DiplomacySystem proposal :~10537 — trade เช็ค some(active) ก่อนเสนอ แต่ path อื่น/peace-stalemate ไม่เช็ค');
console.log('\nไม่มีจุดใดใน codebase ที่ filter world.treaties เพื่อ prune (grep ยืนยัน)');
