/* Phase 19 audit — ทำไมสงครามไม่มีการรบ (wars end with 0 battles)
   รัน: node audit/probe-war.js
   วิธี: จำลอง seed 1 จนสงครามแรกเริ่ม (≈day 1035) แล้ว trace pipeline ระดมพล
   ทุกวันตลอดช่วงสงคราม: recruitment offers, muster points, warbands, armies, battles */
'use strict';
const { boot } = require('./lib');

const S = boot(1);
S.run(`
  globalThis.__audit = { battles: 0, armiesRaised: 0, callToArms: 0, offersPosted: 0, offersNull: 0 };
  (function(){
    const _battle = MilitarySystem.battle.bind(MilitarySystem);
    MilitarySystem.battle = function(...a){ __audit.battles++; return _battle(...a); };
    const _ca = createArmy; createArmy = function(...a){ __audit.armiesRaised++; return _ca(...a); };
    const _rc = OrganizationSystem.raiseCallToArms.bind(OrganizationSystem);
    OrganizationSystem.raiseCallToArms = function(...a){ __audit.callToArms++; return _rc(...a); };
    const _po = OrganizationSystem.postRecruitmentOffer.bind(OrganizationSystem);
    OrganizationSystem.postRecruitmentOffer = function(...a){ const r = _po(...a); if (r) __audit.offersPosted++; else __audit.offersNull++; return r; };
  })();
`);

// เดินจนสงครามแรกเริ่ม
let warStart = null;
for (let d = 0; d < 2500; d++) {
  S.simDay();
  warStart = S.run('(world.wars.find(w=>!w.endDay)||{}).startDay ?? null');
  if (warStart !== null) break;
}
if (warStart === null) { console.log('ไม่มีสงครามเกิดใน 2500 วัน'); process.exit(0); }
console.log(`สงครามแรกเริ่ม day ${warStart}`);

// trace ระหว่างสงคราม
const trace = [];
for (let d = 0; d < 160; d++) {
  S.simDay();
  const snap = S.run(`(function(){
    const w = world.wars[world.wars.length - 1];
    const offers = world.recruitmentOffers.map(o => ({ type: o.type, st: o.status, acc: o.acceptedAgentIds.length, need: o.quantityNeeded, sid: o.settlementId }));
    const conscription = offers.filter(o => o.type === 'royal_conscription');
    const openBySettlement = {};
    for (const o of world.recruitmentOffers) if (o.status === 'open') openBySettlement[o.settlementId] = (openBySettlement[o.settlementId]||0)+1;
    const wbs = world.warbands.map(x => ({ type: x.type, n: warbandMembers(x).length, st: x.status, trav: !!x.travel }));
    const mps = world.musterPoints.map(m => ({ st: m.status, exp: m.expectedAgentIds.length, arr: m.arrivedAgentIds.length }));
    return {
      day: world.day, warEnded: !!w.endDay, battles: w.battles.length,
      audit: { ...__audit },
      conscription, openBySettlement,
      warbands: wbs.filter(x => x.type === 'royal_army'),
      armies: world.armies.length,
      musterPoints: mps.filter(m => m.st !== 'complete').slice(-4)
    };
  })()`);
  trace.push(snap);
  if (snap.warEnded) break;
}

// พิมพ์เฉพาะวันที่มีความเคลื่อนไหว
let prev = '';
for (const t of trace) {
  const line = JSON.stringify({ c: t.conscription, wb: t.warbands, mp: t.musterPoints, armies: t.armies, audit: t.audit });
  if (line !== prev) console.log(`day ${t.day}: ${line}`);
  prev = line;
}
const last = trace[trace.length - 1];
console.log(`\n== จบ: day ${last.day} warEnded=${last.warEnded} battles=${last.battles} ==`);
console.log(`callToArms=${last.audit.callToArms} offersPosted=${last.audit.offersPosted} offersNull(เพดานเต็ม)=${last.audit.offersNull} armiesRaised=${last.audit.armiesRaised} battleCalls=${last.audit.battles}`);

// วัดคะแนน evaluateJoinOffer ของ offer conscription ล่าสุด (ถ้ามี)
console.log('\n== ตัวอย่างคะแนน evaluateJoinOffer ของ royal_conscription ==');
console.log(S.run(`(function(){
  const offer = world.recruitmentOffers.filter(o => o.type === 'royal_conscription').pop();
  if (!offer) return 'ไม่มี offer conscription เกิดเลย';
  const agents = agentsAt(offer.settlementId).filter(a => a.alive && !a.unitId && !a.travel);
  const scores = agents.map(a => ({ prof: a.profession, money: Math.round(a.money), score: +OrganizationSystem.evaluateJoinOffer(a, { ...offer, status: 'open' }).toFixed(1) }));
  scores.sort((x, y) => y.score - x.score);
  return JSON.stringify({ settlement: offer.settlementId, candidates: agents.length, top10: scores.slice(0, 10), passing12: scores.filter(s => s.score >= 12).length }, null, 1);
})()`));
