/* Phase 19.4B — court politics long-run probe
   run: node audit/probe-court-politics.js [days] [seedsPerMode]
   default: 3000 days, 4 seeds per mode (passive/shadow/limited), optional active 1000d × 2 */
'use strict';
const { boot, NAN_SNIPPET, INTEGRITY_SNIPPET } = require('./lib');

const DAYS = +(process.argv[2] || 3000);
const SEEDS = +(process.argv[3] || 4);
const MODES = [
  { mode: 'passive', days: DAYS, seeds: SEEDS },
  { mode: 'shadow', days: DAYS, seeds: SEEDS },
  { mode: 'limited', days: DAYS, seeds: SEEDS },
  { mode: 'active', days: Math.min(1000, DAYS), seeds: 2, optional: true }
];

const results = [];

for (const spec of MODES) {
  for (let seed = 1; seed <= spec.seeds; seed++) {
    const S = boot(10000 + seed);
    S.run(`BALANCE.court.politicsMode = '${spec.mode}'; world.courtPoliticsMode = '${spec.mode}';`);
    let crashed = null;
    const t0 = Date.now();
    try {
      S.simDays(spec.days);
    } catch (e) {
      crashed = e.message;
    }
    const snap = crashed ? null : S.run(`(function(){
      const w = world;
      const cm = w.balanceMetrics?.court || {};
      const lv = w.balanceMetrics?.liveness || {};
      const openOffers = (w.recruitmentOffers || []).filter(o => o.status === 'open').length;
      const realms = (w.organizations || []).filter(o => o.court).length;
      const crises = (w.organizations || []).filter(o => (o.court?.currentCrises || []).length).length;
      const claimants = (w.courtClaimants || []).filter(c => c.status === 'active').length;
      const civilWars = (w.civilWars || []).filter(c => c.status === 'active').length;
      const archiveCourt = (w.dataArchive?.court || []).length;
      return {
        day: w.day, pop: w.agents.filter(a => a.alive).length,
        realms, crises, claimants, civilWars, openOffers,
        decisionsConsidered: cm.decisionsConsidered || 0,
        decisionsApplied: cm.decisionsApplied || 0,
        decisionsSkippedShadow: cm.decisionsSkippedShadow || 0,
        civilWarsTriggered: cm.civilWarsTriggered || 0,
        civilWarsBlocked: cm.civilWarsBlockedByThrottle || 0,
        recruitmentFromCourt: cm.recruitmentOffersFromCourt || 0,
        recruitmentBlocked: cm.recruitmentOffersBlocked || 0,
        courtArchive: archiveCourt,
        caravans: lv.caravanTrips || 0,
        armies: lv.armiesCreated || 0,
        battles: lv.warsWithBattles || 0,
        saveKB: Math.round(JSON.stringify(w).length / 1024)
      };
    })()`);
    const nan = crashed ? { count: -1 } : S.run(NAN_SNIPPET);
    const integrity = crashed ? { issues: ['crashed'] } : S.run(INTEGRITY_SNIPPET);
    const row = {
      mode: spec.mode, seed, days: spec.days, ms: Date.now() - t0, crashed,
      nan: nan.count, integrityIssues: (integrity.issues || []).length,
      ...(snap || {})
    };
    results.push(row);
    console.log(JSON.stringify(row));
  }
}

const byMode = {};
for (const r of results) {
  if (!byMode[r.mode]) byMode[r.mode] = [];
  byMode[r.mode].push(r);
}

console.log('\n=== COURT POLITICS PROBE SUMMARY ===');
for (const [mode, rows] of Object.entries(byMode)) {
  const ok = rows.filter(r => !r.crashed && r.nan === 0 && r.integrityIssues === 0);
  const livenessOk = rows.filter(r => (r.caravans || 0) >= 3);
  const avgApplied = rows.reduce((s, r) => s + (r.decisionsApplied || 0), 0) / rows.length;
  console.log(`${mode}: ${ok.length}/${rows.length} clean · liveness ${livenessOk.length}/${rows.length} · avg decisions applied ${avgApplied.toFixed(1)}`);
}

const shadowOk = (byMode.shadow || []).every(r => !r.crashed && (r.caravans || 0) >= 3);
const limitedOk = (byMode.limited || []).every(r => !r.crashed && (r.caravans || 0) >= 3);
const activeRows = byMode.active || [];
const activeOk = !activeRows.length || activeRows.every(r => !r.crashed);

if (!shadowOk || !limitedOk) process.exit(1);
if (activeRows.length && !activeOk) {
  console.log('active mode experimental — failures noted but not failing probe');
}
process.exit(0);
