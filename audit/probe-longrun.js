/* Phase 19 audit — long-run stability + systems liveness
   รัน: node audit/probe-longrun.js [seeds] [days]
   ค่าเริ่มต้น: 8 seeds × 3000 วัน, สุ่มตัวอย่างทุก 250 วัน
   ผลลัพธ์: JSON ต่อ seed ลง stdout (บรรทัดละ seed) + สรุปท้าย */
'use strict';
const { boot, NAN_SNIPPET, INTEGRITY_SNIPPET } = require('./lib');

const SEEDS = +(process.argv[2] || 8);
const DAYS = +(process.argv[3] || 3000);
const SAMPLE_EVERY = 250;

const results = [];

for (let seed = 1; seed <= SEEDS; seed++) {
  const S = boot(seed);

  // นับเหตุการณ์สะสมด้วยการห่อฟังก์ชันใน sandbox (ไม่แตะไฟล์เกม)
  S.run(`
    globalThis.__audit = { battles: 0, armiesRaised: 0, unitsCreated: {}, warsStarted: 0, warsEnded: 0, errors: [] };
    (function(){
      const _battle = MilitarySystem.battle.bind(MilitarySystem);
      MilitarySystem.battle = function(...args){ __audit.battles++; return _battle(...args); };
      const _ca = createArmy; createArmy = function(...a){ __audit.armiesRaised++; return _ca(...a); };
      const _cu = createUnit; createUnit = function(o){ const k=(o&&o.kind)||'?'; __audit.unitsCreated[k]=(__audit.unitsCreated[k]||0)+1; return _cu(o); };
      const _sw = startWar; startWar = function(...a){ __audit.warsStarted++; return _sw(...a); };
      const _ew = endWar; endWar = function(...a){ __audit.warsEnded++; return _ew(...a); };
    })();
  `);

  const samples = [];
  let crashed = null;
  const t0 = Date.now();

  for (let block = 0; block < DAYS / SAMPLE_EVERY; block++) {
    const bt0 = Date.now();
    try {
      S.simDays(SAMPLE_EVERY);
    } catch (e) {
      crashed = `day~${block * SAMPLE_EVERY}: ${e.message}`;
      break;
    }
    const bt1 = Date.now();
    samples.push(S.run(`(function(){
      const w = world;
      const priceSat = (function(){
        let lo = 0, hi = 0, tot = 0;
        for (const s of w.settlements) if (s.type !== 'camp') for (const g in s.prices) {
          tot++;
          const base = BASE_PRICE[g] || 1;
          if (s.prices[g] <= base * 0.3 * 1.001) lo++;
          if (s.prices[g] >= base * 6 * 0.999) hi++;
        }
        return { lo, hi, tot };
      })();
      return {
        day: w.day,
        pop: w.agents.filter(a => a.alive).length,
        money: Math.round(w.agents.reduce((s,a)=>s+(a.money||0),0) + w.settlements.reduce((s,x)=>s+(x.treasury||0),0) + w.factions.reduce((s,f)=>s+(f.treasury||0),0)),
        arrays: {
          agents: w.agents.length, treaties: w.treaties.length, events: w.events.length,
          chronicle: w.chronicle.length, wars: w.wars.length, units: w.units.length,
          armies: w.armies.length, orgs: w.organizations.length, warbands: w.warbands.length,
          offers: w.recruitmentOffers.length, battleReports: w.battleReports.length,
          scoutReports: w.scoutReports.length, supplyLines: w.supplyLines.length,
          claims: w.claims.length, captureCredits: w.captureCredits.length,
          largeBattles: w.largeBattleRecords.length, activeBattlefields: w.activeBattlefields.length,
          guilds: w.guilds.length, warehouses: w.warehouses.length, contracts: w.tradeContracts.length,
          musterPoints: w.musterPoints.length, headquarters: w.headquarters.length,
          vassalGrants: w.vassalGrants.length, eras: w.eras.length, factions: w.factions.length,
          settlements: w.settlements.length
        },
        priceSat,
        msBlock: ${bt1 - bt0}
      };
    })()`));
  }

  const final = crashed ? null : S.run(`(function(){
    const w = world;
    const profs = {}; for (const a of w.agents) if (a.alive) profs[a.profession] = (profs[a.profession]||0)+1;
    const tTypes = {}; let tActive = 0;
    for (const t of w.treaties) { tTypes[t.type]=(tTypes[t.type]||0)+1; if (!t.ended) tActive++; }
    const wars = w.wars.map(x => ({ start: x.startDay, end: x.endDay, battles: x.battles.length, cas: x.casualties }));
    return { audit: __audit, stats: w.stats, profs, tTypes, tActive, wars,
             chronicleCats: w.chronicle.reduce((m,e)=>{ m[e.category]=(m[e.category]||0)+1; return m; }, {}) };
  })()`);

  const nan = crashed ? null : S.run(NAN_SNIPPET);
  const integ = crashed ? null : S.run(INTEGRITY_SNIPPET);

  const rec = { seed, days: DAYS, crashed, totalSec: +((Date.now() - t0) / 1000).toFixed(1), nan, integrity: integ, final, samples };
  results.push(rec);
  console.log(JSON.stringify(rec));
  console.error(`seed ${seed}/${SEEDS} done in ${rec.totalSec}s ${crashed ? 'CRASH: ' + crashed : ''}`);
}

/* สรุปรวม */
const summary = {
  seeds: SEEDS, days: DAYS,
  crashes: results.filter(r => r.crashed).map(r => ({ seed: r.seed, at: r.crashed })),
  nanTotal: results.reduce((s, r) => s + (r.nan ? r.nan.count : 0), 0),
  integrityIssues: results.reduce((s, r) => s + (r.integrity ? r.integrity.total : 0), 0),
  popFinal: results.map(r => r.samples.length ? r.samples[r.samples.length - 1].pop : null),
  treatiesFinal: results.map(r => r.samples.length ? r.samples[r.samples.length - 1].arrays.treaties : null),
  battlesTotal: results.map(r => r.final ? r.final.audit.battles : null),
  armiesRaised: results.map(r => r.final ? r.final.audit.armiesRaised : null),
  msPerDayFirstBlock: results.map(r => r.samples[0] ? +(r.samples[0].msBlock / SAMPLE_EVERY).toFixed(2) : null),
  msPerDayLastBlock: results.map(r => r.samples.length ? +(r.samples[r.samples.length - 1].msBlock / SAMPLE_EVERY).toFixed(2) : null)
};
console.error('SUMMARY ' + JSON.stringify(summary, null, 1));
