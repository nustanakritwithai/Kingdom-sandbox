/* Phase 19.3 Prep — long-run data growth probe (audit only, no gameplay changes)
   รัน: node audit/probe-data-growth.js <seed> <days> [intervalDays]
   สแนปช็อตขนาด array + ขนาด save ทุก intervalDays แล้วเขียน JSONL
   → audit/data-growth/seed-<seed>.jsonl
   ใช้ตรวจว่ามี array ไหน "โตไม่หยุด" เมื่อรันยาว 3k–50k วัน */
'use strict';
const fs = require('fs');
const path = require('path');
const { boot } = require('./lib');

const SEED = +(process.argv[2] || 1);
const DAYS = +(process.argv[3] || 3000);
const INTERVAL = +(process.argv[4] || 1000);

const OUT_DIR = path.join(__dirname, 'data-growth');
fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT = path.join(OUT_DIR, `seed-${SEED}.jsonl`);
fs.writeFileSync(OUT, ''); // เริ่มไฟล์ใหม่

const S = boot(SEED);

/* สแนปช็อตหนึ่งครั้ง — รันในแซนด์บ็อกซ์ให้เข้าถึง world/JSON ได้ตรงๆ */
const SNAP = `(function(){
  const w = world;
  const jlen = v => { try { return JSON.stringify(v).length; } catch { return -1; } };
  const arr = k => Array.isArray(w[k]) ? w[k].length : 0;
  const histStats = (list, field) => {
    let max = 0, tot = 0, n = 0;
    for (const o of (list || [])) { const h = o && o[field]; if (Array.isArray(h)) { max = Math.max(max, h.length); tot += h.length; n++; } }
    return { max, avg: n ? +(tot / n).toFixed(2) : 0 };
  };
  const treaties = w.treaties || [];
  let active = 0, expired = 0, broken = 0, other = 0;
  const pairKey = {};
  for (const t of treaties) {
    if (t.status === 'active') { active++;
      const key = [...(t.factions || [])].sort().join('-') + ':' + t.type;
      pairKey[key] = (pairKey[key] || 0) + 1;
    }
    else if (t.status === 'expired') expired++;
    else if (t.status === 'broken') broken++;
    else other++;
  }
  const dupPairs = Object.values(pairKey).filter(n => n > 1);
  const dupActiveTreaties = dupPairs.reduce((s, n) => s + (n - 1), 0);

  const musters = w.musterPoints || [];
  const mByStatus = {};
  for (const m of musters) mByStatus[m.status] = (mByStatus[m.status] || 0) + 1;
  const offers = w.recruitmentOffers || [];
  const oByStatus = {};
  for (const o of offers) oByStatus[o.status] = (oByStatus[o.status] || 0) + 1;
  const needs = w.militaryNeeds || [];
  const nByStatus = {};
  for (const n of needs) nByStatus[n.status] = (nByStatus[n.status] || 0) + 1;

  // ขนาด save (payload เต็ม รวม uiPrefs) — ใช้ SaveSystem จริง
  let saveBytes = -1;
  try { saveBytes = JSON.stringify(SaveSystem.buildSavePayload('probe')).length; } catch (e) {}

  return {
    day: w.day,
    pop: w.agents.filter(a => a.alive).length,
    saveBytes,
    worldBytes: jlen(w),
    counts: {
      agents: arr('agents'), settlements: arr('settlements'), routes: arr('routes'),
      units: arr('units'), armies: arr('armies'), factions: arr('factions'),
      events: arr('events'), chronicle: arr('chronicle'), wars: arr('wars'), eras: arr('eras'),
      treaties: treaties.length, vassalContracts: arr('vassalContracts'),
      guilds: arr('guilds'), warehouses: arr('warehouses'), tradeContracts: arr('tradeContracts'),
      organizations: arr('organizations'), recruitmentOffers: offers.length,
      musterPoints: musters.length, warbands: arr('warbands'), headquarters: arr('headquarters'),
      militaryNeeds: needs.length, supplyLines: arr('supplyLines'), armyCamps: arr('armyCamps'),
      scoutReports: arr('scoutReports'), battleReports: arr('battleReports'),
      largeBattleRecords: arr('largeBattleRecords'), activeBattlefields: arr('activeBattlefields'),
      legendaryWeapons: arr('legendaryWeapons'),
      siegeAuthorities: arr('siegeAuthorities'), claims: arr('claims'),
      captureCredits: arr('captureCredits'), vassalGrants: arr('vassalGrants')
    },
    treaties: { active, expired, broken, other, dupActiveTreaties, maxDupPerPair: dupPairs.length ? Math.max(...dupPairs) : 0 },
    musterByStatus: mByStatus, offerByStatus: oByStatus, needByStatus: nByStatus,
    history: {
      org: histStats(w.organizations, 'history'),
      warband: histStats(w.warbands, 'history'),
      settlement: histStats(w.settlements, 'history'),
      agentCareer: histStats(w.agents.filter(a => a.alive), 'career'),
      agentDeeds: histStats(w.agents.filter(a => a.alive), 'deeds'),
      factionTimeline: histStats(w.factions, 'timeline')
    },
    agentMemBytes: (function(){ const live = w.agents.filter(a => a.alive); let max = 0, tot = 0; for (const a of live) { const b = jlen(a.memory); max = Math.max(max, b); tot += b; } return { max, avg: live.length ? Math.round(tot / live.length) : 0 }; })(),
    balanceMetricsBytes: jlen(w.balanceMetrics),
    hasIntegrity: !!w.integrity
  };
})()`;

const t0 = Date.now();
let lastSnap = null;
console.error(`seed ${SEED}: running ${DAYS} days (interval ${INTERVAL})...`);
for (let d = 0; d < DAYS; d += INTERVAL) {
  const step = Math.min(INTERVAL, DAYS - d);
  S.simDays(step);
  lastSnap = S.run(SNAP);
  fs.appendFileSync(OUT, JSON.stringify(lastSnap) + '\n');
  if ((d / INTERVAL) % 5 === 0) console.error(`  day ${lastSnap.day} pop ${lastSnap.pop} save ${(lastSnap.saveBytes / 1024).toFixed(0)}KB`);
}
console.error(`seed ${SEED} done in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${OUT}`);
console.log(JSON.stringify({ seed: SEED, days: DAYS, final: lastSnap }, null, 1));
