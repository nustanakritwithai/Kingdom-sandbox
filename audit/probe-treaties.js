/* Phase 19 audit — treaty accumulation / duplicate active trade treaties
   รัน: node audit/probe-treaties.js [days]
   ยืนยัน: (1) world.treaties โตไม่หยุด ไม่มี prune
           (2) trade treaty ซ้ำคู่เดิมแบบ active พร้อมกันได้ (script.js:9411 ไม่เช็คสัญญาเดิม) */
'use strict';
const { boot } = require('./lib');

const DAYS = +(process.argv[2] || 3000);
const S = boot(42);

const checkpoints = [];
for (let d = 0; d < DAYS; d += 500) {
  S.simDays(500);
  checkpoints.push(S.run(`(function(){
    const byStatus = {};
    for (const t of world.treaties) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    // นับ trade treaty ที่ active ซ้ำคู่ faction เดียวกัน
    const pairCount = {};
    for (const t of world.treaties) {
      if (t.status !== 'active' || t.type !== 'trade') continue;
      const key = t.factions.slice().sort().join('-');
      pairCount[key] = (pairCount[key] || 0) + 1;
    }
    const dupPairs = Object.entries(pairCount).filter(([, n]) => n > 1);
    return { day: world.day, total: world.treaties.length, byStatus, dupActiveTradePairs: dupPairs };
  })()`));
}

for (const c of checkpoints) console.log(JSON.stringify(c));

const last = checkpoints[checkpoints.length - 1];
console.log('\n== สรุป ==');
console.log(`หลัง ${last.day} วัน: treaties สะสม ${last.total} รายการ (ไม่เคยถูกลบ) — สถานะ: ${JSON.stringify(last.byStatus)}`);
console.log(last.dupActiveTradePairs.length
  ? `พบ trade treaty active ซ้ำคู่เดิมพร้อมกัน: ${JSON.stringify(last.dupActiveTradePairs)}`
  : 'ขณะจบรัน ไม่มีคู่ active ซ้ำ (แต่เกิดชั่วคราวระหว่างรันได้ — ดู checkpoint ด้านบน)');
