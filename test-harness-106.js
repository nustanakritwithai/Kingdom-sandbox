/* Phase 10.6 headless test — run: node test-harness-106.js */
'use strict';
const fs = require('fs');
const vm = require('vm');

function mockEl() {
  const el = {
    addEventListener() {}, textContent: '', innerHTML: '', value: 'none',
    classList: { add() {}, remove() {}, toggle() {} },
    getContext: () => ({
      clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
      moveTo() {}, lineTo() {}, closePath() {}, setLineDash() {}, createRadialGradient() { return { addColorStop() {} }; },
      fillText() {}, measureText: () => ({ width: 10 }), setTransform() {}
    }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 640 }),
    parentElement: null
  };
  el.parentElement = { getBoundingClientRect: () => ({ width: 1000, height: 640 }) };
  return el;
}

const els = {};
const sandbox = {
  console, Math, Date, performance: { now: () => 0 },
  document: { getElementById: (id) => els[id] || (els[id] = mockEl()), querySelectorAll: () => [] },
  requestAnimationFrame: () => {}, confirm: () => true, alert: () => {},
  window: { addEventListener() {} }, devicePixelRatio: 1
};

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/script.js', 'utf8'), sandbox);
const genWorld = () => vm.runInContext('generateWorld()', sandbox);
const simDay = () => vm.runInContext('simulateDay()', sandbox);
const getWorld = () => vm.runInContext('world', sandbox);

function hasNaN(obj, path = 'world') {
  const issues = [];
  const walk = (v, p) => {
    if (typeof v === 'number' && !Number.isFinite(v)) issues.push(p);
    else if (v && typeof v === 'object') {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
      else Object.entries(v).forEach(([k, x]) => walk(x, `${p}.${k}`));
    }
  };
  walk(obj, path);
  return issues;
}

function validateCaravanSlots(w) {
  const bad = [];
  for (const s of w.settlements) {
    if (s.townCaravanId) {
      const ag = w.agents.find(a => a.id === s.townCaravanId);
      if (!ag || !ag.alive || !ag.isTownCaravan || (!ag.cargo && !ag.travel)) {
        bad.push(`${s.name}:townCaravanId→${s.townCaravanId}`);
      }
    }
    if (s.emergencyCaravanId) {
      const ag = w.agents.find(a => a.id === s.emergencyCaravanId);
      if (!ag || !ag.alive || !ag.isEmergencyCaravan || (!ag.cargo && !ag.travel)) {
        bad.push(`${s.name}:emergencyCaravanId→${s.emergencyCaravanId}`);
      }
    }
  }
  return bad;
}

function testLocalFoodConsumption() {
  genWorld();
  const w = getWorld();
  const s = w.settlements.find(x => x.type === 'town');
  const agents = w.agents.filter(a => a.alive && a.locationId === s.id);
  const pop = agents.length;
  s.stock.food = Math.max(20, pop * 3);
  const exportable = vm.runInContext(`SettlementMetrics.exportableFood(world.settlements.find(s=>s.id===${s.id}))`, sandbox);
  const agent = agents[0];
  agent.money = 200;
  agent.stats.hunger = 30;
  const before = s.stock.food;
  const got = vm.runInContext(`EconomySystem.buyFoodForLocalConsumption(world.agents.find(a=>a.id===${agent.id}), world.settlements.find(s=>s.id===${s.id}), 2)`, sandbox);
  return { exportable, got, stockDropped: before - s.stock.food };
}

function testMatchup() {
  return vm.runInContext('CombatSystem.testCavalryVsArcher()', sandbox);
}

function runSeed(seed, days = 1000) {
  Math.random = (() => { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })();
  genWorld();
  const w0 = getWorld();
  const routeTrack = {};
  for (const r of w0.routes) {
    routeTrack[r.id] = { maxThreat: r.threat || r.danger, maxPatrol: r.patrolLevel || 0, maxBounty: r.bounty || 0, maxRecentRaids: r.recentRaids || 0, losses: 0 };
  }

  for (let d = 0; d < days; d++) {
    simDay();
    const w = getWorld();
    for (const r of w.routes) {
      const t = routeTrack[r.id];
      if (!t) continue;
      t.maxThreat = Math.max(t.maxThreat, r.threat || r.danger);
      t.maxPatrol = Math.max(t.maxPatrol, r.patrolLevel || 0);
      t.maxBounty = Math.max(t.maxBounty, r.bounty || 0);
      t.maxRecentRaids = Math.max(t.maxRecentRaids, r.recentRaids || 0);
      t.losses = Math.max(t.losses, r.caravanLosses || 0);
      t.lifetimeBounty = r.lifetimeBounty || 0;
      t.nowThreat = r.threat || r.danger;
      t.nowPatrol = r.patrolLevel || 0;
      t.nowRecentRaids = r.recentRaids || 0;
    }
  }

  const w = getWorld();
  const caravanBad = validateCaravanSlots(w);
  const routeRecovery = w.routes.map(r => {
    const t = routeTrack[r.id] || {};
    return {
      id: r.id,
      losses: t.losses || r.caravanLosses || 0,
      maxThreat: t.maxThreat || 0,
      now: t.nowThreat ?? (r.threat || r.danger),
      maxPatrol: t.maxPatrol || 0,
      lifetimeBounty: t.lifetimeBounty || r.lifetimeBounty || 0,
      maxRecentRaids: t.maxRecentRaids || 0,
      nowRecentRaids: t.nowRecentRaids ?? r.recentRaids
    };
  }).filter(x => x.losses >= 2 || x.maxRecentRaids >= 3);

  return {
    seed, alive: w.agents.filter(a => a.alive).length, caravanBad,
    stats: { ...w.stats },
    routeRecovery,
    nan: hasNaN(w)
  };
}

// Unit tests
const local = testLocalFoodConsumption();
const matchup = testMatchup();
let failed = false;

console.log('=== Phase 10.6 Unit Tests ===');
if (local.got > 0) console.log(`OK: local food consumption bought ${local.got} (exportable was ${local.exportable})`);
else { console.log(`FAIL: local food consumption — got ${local.got}, exportable ${local.exportable}`); failed = true; }

if (matchup.withMatch > matchup.withoutMatch && matchup.withMatch > matchup.closeNoBonus) {
  console.log(`OK: cavalry vs archer matchup open=${matchup.withMatch.toFixed(2)} > wrong=${matchup.withoutMatch.toFixed(2)}, close=${matchup.closeNoBonus.toFixed(2)}`);
} else {
  console.log(`FAIL: matchup cavalry vs archer — with=${matchup.withMatch} without=${matchup.withoutMatch} close=${matchup.closeNoBonus}`);
  failed = true;
}

console.log('\n=== Phase 10.6 Simulation (1000 days × 5 seeds) ===\n');
const seeds = [42, 1337, 9001, 24680, 31415];
const results = seeds.map(s => runSeed(s, 1000));

let caravanClean = 0, townCaravanActivity = 0, routeRecovered = 0, townReplaced = 0;
for (const r of results) {
  const ok = [], bad = [];
  if (r.nan.length) bad.push(`NaN: ${r.nan.slice(0, 2).join(',')}`);
  else ok.push('no NaN');
  if (r.caravanBad.length === 0) { ok.push('caravan slots clean'); caravanClean++; }
  else bad.push(`stale slots: ${r.caravanBad.join('; ')}`);
  if ((r.stats.townCaravansLost || 0) > 0 || (r.stats.townCaravansReplaced || 0) > 0 || (r.stats.townCaravans || 0) > 2) {
    ok.push(`town caravan cycle (lost=${r.stats.townCaravansLost || 0} replaced=${r.stats.townCaravansReplaced || 0})`);
    townCaravanActivity++;
  }
  if ((r.stats.townCaravansReplaced || 0) > 0) townReplaced++;
  if ((r.stats.localRations || 0) > 0) ok.push(`local rations=${Math.floor(r.stats.localRations)}`);
  if ((r.stats.emergencyCaravans || 0) > 0 || (r.stats.emergencyFallbacks || 0) > 0) ok.push('emergency relief');
  const recovered = r.routeRecovery.filter(x =>
    (x.maxThreat > 0.12 && x.now < x.maxThreat * 0.9) ||
    x.maxPatrol > 0.4 ||
    x.lifetimeBounty > 10 ||
    (x.maxRecentRaids >= 3 && x.nowRecentRaids < x.maxRecentRaids * 0.6)
  );
  if (recovered.length) { ok.push(`route recovery on ${recovered.length} hot routes`); routeRecovered++; }

  console.log(`Seed ${r.seed}: alive=${r.alive} caravans lost=${r.stats.townCaravansLost || 0} localRations=${r.stats.localRations || 0}`);
  console.log(`  OK: ${ok.join(' | ')}`);
  if (bad.length) { console.log(`  FAIL: ${bad.join(' | ')}`); failed = true; }
  console.log('');
}

if (caravanClean < 5) { console.log(`FAIL: caravan slots not clean in all seeds (${caravanClean}/5)`); failed = true; }
else console.log('Caravan slot integrity: 5/5 seeds clean.');

if (townCaravanActivity < 1) { console.log('FAIL: no town caravan loss/replace cycle observed'); failed = true; }
else console.log(`Town caravan activity in ${townCaravanActivity}/5 seeds.`);

if (townReplaced < 1) { console.log('WARN: no town caravan replacement observed (loss without respawn within 90d)'); }
else console.log(`Town caravan replaced in ${townReplaced}/5 seeds.`);

if (routeRecovered < 1) { console.log('FAIL: no route recovery on heavily raided routes'); failed = true; }
else console.log(`Route recovery in ${routeRecovered}/5 seeds.`);

if (failed) { console.error('\nSOME ASSERTIONS FAILED'); process.exit(1); }
console.log('\nALL PHASE 10.6 ASSERTIONS PASSED');
