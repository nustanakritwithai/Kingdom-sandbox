/* Phase 19.3 Prep — save payload attribution (audit only)
   รัน: node audit/probe-save-attribution.js [seed] [maxDays]
   วัดว่า save payload โตเพราะหมวดไหน (bytes ต่อ section) ที่ day 500/3000/10000/25000
   ใช้ JSON.stringify ต่อ section (serializeWorld ก็คือ JSON.stringify(world)) */
'use strict';
const { boot } = require('./lib');

const SEED = +(process.argv[2] || 6);
const MAXDAYS = +(process.argv[3] || 25000);
const CHECKPOINTS = [500, 3000, 10000, 25000].filter(d => d <= MAXDAYS);

const S = boot(SEED);

const ATTRIB = `(function(){
  const w = world;
  const jb = v => { try { return JSON.stringify(v === undefined ? null : v).length; } catch { return 0; } };
  const arr = k => Array.isArray(w[k]) ? w[k] : [];
  const sections = [
    'agents','settlements','routes','units','armies','factions',
    'organizations','warbands','wars','battleReports','largeBattleRecords',
    'treaties','recruitmentOffers','militaryNeeds','musterPoints',
    'chronicle','events','scoutReports','eras','guilds','warehouses',
    'tradeContracts','supplyLines','armyCamps','headquarters','siegeAuthorities',
    'claims','captureCredits','vassalGrants','vassalContracts','legendaryWeapons',
    'activeBattlefields'
  ];
  const full = jb(SaveSystem.buildSavePayload('probe'));
  const rows = {};
  let accounted = 0;
  for (const s of sections) { const b = jb(w[s]); rows[s] = { bytes: b, count: arr(s).length }; accounted += b; }
  // เจาะลึก agent: memory / career / deeds / relationships
  const agentSub = { memory: 0, career: 0, deeds: 0, relationships: 0, base: 0 };
  for (const a of w.agents) {
    agentSub.memory += jb(a.memory); agentSub.career += jb(a.career);
    agentSub.deeds += jb(a.deeds); agentSub.relationships += jb(a.relationships);
  }
  rows.balanceMetrics = { bytes: jb(w.balanceMetrics), count: 1 };
  rows.laborMarket = { bytes: jb(w.laborMarket), count: 1 };
  return { day: w.day, pop: w.agents.filter(a=>a.alive).length, deadAgents: w.agents.filter(a=>!a.alive).length,
           fullPayloadBytes: full, worldBytes: jb(w), accounted, rows, agentSub };
})()`;

console.log('=== Save Payload Attribution (seed ' + SEED + ') ===\n');
let prev = 0;
const snaps = [];
for (const cp of CHECKPOINTS) {
  const target = cp - prev; prev = cp;
  S.simDays(target);
  const a = S.run(ATTRIB);
  snaps.push(a);
  console.log(`\n──────── day ${a.day} | pop ${a.pop} | dead-retained ${a.deadAgents} | full payload ${(a.fullPayloadBytes/1024).toFixed(1)} KB ────────`);
  const rows = Object.entries(a.rows).filter(([, v]) => v.bytes > 0).sort((x, y) => y[1].bytes - x[1].bytes);
  console.log('  Section              |     Bytes |   % | Count');
  for (const [name, v] of rows.slice(0, 16)) {
    const pct = (v.bytes / a.fullPayloadBytes * 100).toFixed(1);
    console.log('  ' + name.padEnd(20) + ' | ' + String(v.bytes).padStart(9) + ' | ' + pct.padStart(4) + ' | ' + v.count);
  }
  console.log('  agent sub-fields: memory ' + a.agentSub.memory + 'B, relationships ' + a.agentSub.relationships + 'B, career ' + a.agentSub.career + 'B, deeds ' + a.agentSub.deeds + 'B');
}

console.log('\n\n== GROWTH TREND (bytes ต่อ section) ==');
const allSections = new Set();
for (const s of snaps) for (const k of Object.keys(s.rows)) allSections.add(k);
const header = 'Section'.padEnd(20) + snaps.map(s => ('d' + s.day).padStart(10)).join('');
console.log(header);
for (const name of allSections) {
  const vals = snaps.map(s => (s.rows[name] || { bytes: 0 }).bytes);
  if (Math.max(...vals) < 200) continue;
  console.log(name.padEnd(20) + vals.map(v => String(v).padStart(10)).join(''));
}
console.log('\nfull payload'.padEnd(20) + snaps.map(s => String(s.fullPayloadBytes).padStart(10)).join(''));
