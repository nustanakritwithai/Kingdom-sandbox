/* Phase 19 audit — save/load roundtrip + schema migration + ขนาด payload
   รัน: node audit/probe-saveload.js
   ตรวจ: (1) save→load→sim ต่อ 100 วันไม่ crash/NaN
         (2) payload เก่า (schema 18.2 สังเคราะห์) migrate ได้
         (3) ขนาด payload เทียบ localStorage quota (~5MB) */
'use strict';
const { boot, NAN_SNIPPET } = require('./lib');

// ── 1. roundtrip ──
const S = boot(7);
S.simDays(1500);
const before = S.run('({ day: world.day, pop: world.agents.filter(a=>a.alive).length, treasurySum: Math.round(world.settlements.reduce((s,x)=>s+x.treasury,0)) })');
S.run('SaveSystem.saveToLocalStorage("audit", true)');
const payloadStr = S.storage['livingKingdomSandbox_save'];
console.log(`save payload: ${(payloadStr.length / 1024).toFixed(1)} KB (day ${before.day}, pop ${before.pop}) — quota localStorage ~5120 KB`);

const payload = JSON.parse(payloadStr);
console.log(`schemaVersion: ${payload.schemaVersion}`);

// โหลดใน sandbox ใหม่ (จำลองเปิด browser ใหม่)
const S2 = boot();
S2.seedRandom(99);
S2.run(`world = null; SaveSystem.loadFromPayload(${JSON.stringify(payloadStr)} && ${JSON.stringify(payload)});`);
const after = S2.run('({ day: world.day, pop: world.agents.filter(a=>a.alive).length, treasurySum: Math.round(world.settlements.reduce((s,x)=>s+x.treasury,0)) })');
console.log('roundtrip:', JSON.stringify(before), '→', JSON.stringify(after),
  before.day === after.day && before.pop === after.pop ? '✓ ตรงกัน' : '✗ ไม่ตรง');

let crash = null;
try { S2.simDays(100); } catch (e) { crash = e.message; }
const nan = S2.run(NAN_SNIPPET);
console.log(`sim ต่อ 100 วันหลัง load: ${crash ? 'CRASH: ' + crash : '✓ ไม่ crash'} | NaN: ${nan.count}${nan.count ? ' ' + JSON.stringify(nan.paths) : ''}`);

// ── 2. migrate payload schema เก่า ──
// สังเคราะห์: ตัด field ยุค 18.3+ ออกจาก world แล้วแปะ schemaVersion เก่า
const oldPayload = JSON.parse(payloadStr);
oldPayload.schemaVersion = '18.2';
for (const k of ['organizations', 'warbands', 'recruitmentOffers', 'musterPoints', 'headquarters',
                 'siegeAuthorities', 'claims', 'captureCredits', 'vassalGrants', 'largeBattleRecords', 'activeBattlefields']) {
  delete oldPayload.world[k];
}
for (const a of oldPayload.world.agents) { delete a.memberships; delete a.body; delete a.injuries; }
const S3 = boot();
S3.seedRandom(123);
let migrateErr = null;
try {
  S3.run(`world = null; SaveSystem.loadFromPayload(${JSON.stringify(oldPayload)});`);
  S3.simDays(50);
} catch (e) { migrateErr = e.message; }
const migOk = migrateErr ? null : S3.run('({ orgs: Array.isArray(world.organizations), wbs: Array.isArray(world.warbands), day: world.day })');
console.log(`migrate schema 18.2→ปัจจุบัน + sim 50 วัน: ${migrateErr ? 'CRASH: ' + migrateErr : '✓ ' + JSON.stringify(migOk)}`);

// ── 3. ขนาด payload โตตามเวลา ──
const S4 = boot(11);
for (const d of [500, 1500, 3000]) {
  S4.simDays(d === 500 ? 500 : 1500);
  S4.run('SaveSystem.saveToLocalStorage("audit", true)');
  console.log(`day ${d}: payload ${(S4.storage['livingKingdomSandbox_save'].length / 1024).toFixed(1)} KB`);
}
