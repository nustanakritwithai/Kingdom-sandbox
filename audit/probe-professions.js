/* Phase 19 audit — profession collapse + settlement depopulation + death causes
   รัน: node audit/probe-professions.js [days] [seed]
   ติดตามทุก 500 วัน: histogram อาชีพ, ประชากรรายเมือง, สาเหตุการตายสะสม */
'use strict';
const { boot } = require('./lib');

const DAYS = +(process.argv[2] || 3000);
const SEED = +(process.argv[3] || 1);
const S = boot(SEED);

for (let d = 0; d < DAYS; d += 500) {
  S.simDays(500);
  console.log(JSON.stringify(S.run(`(function(){
    const profs = {};
    for (const a of world.agents) if (a.alive) profs[a.profession] = (profs[a.profession] || 0) + 1;
    const pops = {};
    for (const s of world.settlements) pops[s.name] = agentsAt(s.id).length;
    return { day: world.day, profs, pops };
  })()`)));
}

console.log('\n== สาเหตุการตายสะสม (เรียงมาก→น้อย) ==');
const dc = S.run('world.stats.deathCauses || {}');
const total = Object.values(dc).reduce((a, b) => a + b, 0);
for (const [k, v] of Object.entries(dc).sort((a, b) => b[1] - a[1])) {
  console.log(`${String(v).padStart(6)}  (${(v / total * 100).toFixed(1)}%)  ${k}`);
}
console.log(`รวมตาย ${total} | คาราวานเมือง: ส่ง ${S.run('world.stats.townCaravans')} หาย ${S.run('world.stats.townCaravansLost')} | ถูกปล้นรวม ${S.run('world.stats.caravansRobbed')}`);
