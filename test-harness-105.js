/* Phase 10.5 headless stability test — run: node test-harness-105.js */
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
  document: {
    getElementById: (id) => els[id] || (els[id] = mockEl()),
    querySelectorAll: () => []
  },
  requestAnimationFrame: () => {},
  confirm: () => true,
  alert: () => {},
  window: { addEventListener() {} },
  devicePixelRatio: 1
};

const code = fs.readFileSync(__dirname + '/script.js', 'utf8');
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const genWorld = () => vm.runInContext('generateWorld()', sandbox);
const simDay = () => vm.runInContext('simulateDay()', sandbox);

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

function runSeed(seed, days = 1000) {
  Math.random = (() => { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })();
  genWorld();
  const w = vm.runInContext('world', sandbox);
  for (let d = 0; d < days; d++) simDay();

  const alive = w.agents.filter(a => a.alive);
  const pops = w.settlements.filter(s => s.type !== 'camp').map(s => ({
    name: s.name, pop: w.agents.filter(a => a.alive && a.locationId === s.id && !a.travel).length,
    food: s.stock.food, crowding: s.crowding
  }));
  const maxPop = Math.max(...pops.map(p => p.pop), 1);
  const totalPop = pops.reduce((s, p) => s + p.pop, 0);
  const maxShare = maxPop / Math.max(totalPop, 1);
  const traders = alive.filter(a => a.profession === 'trader' || a.isTownCaravan).length;
  const squads = w.units.filter(u => u.kind === 'field').length;
  const nan = hasNaN(w);

  return { seed, days, alive: alive.length, maxShare, traders, squads, nan, pops, stats: { ...w.stats } };
}

const seeds = [42, 1337, 9001, 24680, 31415];
const results = seeds.map(s => runSeed(s, 1000));
let failed = false;
let traderSeeds = 0, bountySeeds = 0;

console.log('=== Phase 10.5 Headless Test (1000 days x 5 seeds) ===\n');
for (const r of results) {
  const ok = [];
  const bad = [];
  if (r.nan.length) bad.push(`NaN at ${r.nan.slice(0, 3).join(', ')}`);
  else ok.push('no NaN');
  if (r.maxShare < 0.65) ok.push(`pop spread OK (max ${(r.maxShare * 100).toFixed(0)}%)`);
  else bad.push(`food city attractor: max share ${(r.maxShare * 100).toFixed(0)}%`);
  if (r.traders >= 1 || (r.stats.traderSpawns || 0) + (r.stats.townCaravans || 0) > 0 || r.stats.caravansRobbed > 0) {
    ok.push(`trade active (traders=${r.traders}, caravans robbed=${r.stats.caravansRobbed})`);
    traderSeeds++;
  }
  if (r.stats.caravansRobbed > 0 || r.stats.bountiesPosted > 0) {
    ok.push('bandit/trade cycle');
    if (r.stats.bountiesPosted > 0) bountySeeds++;
  }
  if (r.stats.gearBought > 0) ok.push(`gear=${r.stats.gearBought}`);
  else bad.push('no gear upgrades');
  console.log(`Seed ${r.seed}: alive=${r.alive} squads=${r.squads} gear=${r.stats.gearBought || 0} bounties=${r.stats.bountiesPosted || 0}`);
  console.log(`  OK: ${ok.join(' | ')}`);
  if (bad.length) { console.log(`  FAIL: ${bad.join(' | ')}`); failed = true; }
  console.log(`  Pop: ${r.pops.map(p => `${p.name}:${p.pop}(c${p.crowding.toFixed(1)})`).join(', ')}`);
  console.log('');
}

const anySquad = results.some(r => r.squads >= 1 || (r.stats.squadsFormed || 0) >= 1);
if (!anySquad) { console.log('WARN: no squads formed in any seed'); failed = true; }
else console.log('Squads formed in at least one seed.');

if (traderSeeds < 5) { console.log(`FAIL: trade activity in only ${traderSeeds}/5 seeds`); failed = true; }
else console.log(`Trade/caravan activity confirmed in all ${traderSeeds} seeds.`);

if (bountySeeds < 1) { console.log('FAIL: no bounties posted in any seed'); failed = true; }
else console.log(`Bounties posted in ${bountySeeds}/5 seeds.`);

if (failed) { console.error('\nSOME ASSERTIONS FAILED'); process.exit(1); }
console.log('\nALL CORE ASSERTIONS PASSED');
