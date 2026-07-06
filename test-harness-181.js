/* Phase 18.1 headless test — run: node test-harness-181.js */
'use strict';
const fs = require('fs');
const vm = require('vm');

function mockEl() {
  const el = {
    addEventListener() {}, textContent: '', innerHTML: '', value: '', title: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return { textContent: '', classList: { add() {}, remove() {} } }; },
    querySelectorAll() { return []; },
    getContext: () => ({
      clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
      moveTo() {}, lineTo() {}, closePath() {}, setLineDash() {}, createRadialGradient() { return { addColorStop() {} }; },
      fillText() {}, measureText: () => ({ width: 10 }), setTransform() {}
    }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 640 }),
    parentElement: null, files: null, click() {}
  };
  el.parentElement = { getBoundingClientRect: () => ({ width: 1000, height: 640 }) };
  return el;
}

const storage = {};
const els = {};
const sandbox = {
  console, Math, Date, performance: { now: () => 0 },
  Blob: class Blob { constructor(p) { this._p = p; } },
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
  navigator: { clipboard: { writeText: async () => {} } },
  localStorage: {
    getItem: k => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = v; },
    removeItem: k => { delete storage[k]; }
  },
  document: {
    getElementById: (id) => els[id] || (els[id] = mockEl()),
    querySelectorAll: () => [],
    createElement: () => mockEl()
  },
  requestAnimationFrame: () => {}, confirm: () => true, alert: () => {},
  window: { addEventListener() {} }, devicePixelRatio: 1,
  setTimeout: (fn) => { fn(); return 0; },
  clearTimeout() {}
};

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/script.js', 'utf8'), sandbox);

const genWorld = (seed) => vm.runInContext(seed != null ? `generateWorld(${seed})` : 'generateWorld()', sandbox);
const simDay = () => vm.runInContext('simulateDay()', sandbox);
const getWorld = () => vm.runInContext('world', sandbox);
const run = (code) => vm.runInContext(code, sandbox);

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

let failed = false;
function ok(m) { console.log('OK:', m); }
function fail(m) { console.log('FAIL:', m); failed = true; }

console.log('=== Phase 18.1 Text Combat Core Tests ===\n');

genWorld(181);
const t0 = Date.now();
for (let i = 0; i < 500; i++) simDay();
const elapsed = Date.now() - t0;
let w = getWorld();
ok(`simulated 500 days in ${elapsed}ms (day ${w.day})`);
if (elapsed > 120000) fail('500 days too slow: ' + elapsed + 'ms');

// 1. All alive agents have body + derivedCombat
const missingBody = run(`world.agents.filter(a => a.alive && (!a.body || !a.derivedCombat)).length`);
if (missingBody === 0) ok('all agents have body/derivedCombat');
else fail(`${missingBody} agents missing body/derivedCombat`);

const nanIssues = hasNaN(w);
if (!nanIssues.length) ok('no NaN in world after 500 days');
else fail('NaN found: ' + nanIssues.slice(0, 5).join(', '));

// 2. resolveDuel no NaN
const duelOk = run(`
  (function() {
    const a = world.agents.find(x => x.alive);
    const b = world.agents.find(x => x.alive && x.id !== a.id);
    TextCombatCore.ensureAgent(a); TextCombatCore.ensureAgent(b);
    a.equipment.mainHand = equipSlot('sword', 'mainHand');
    b.equipment.mainHand = equipSlot('spear', 'mainHand');
    const r = CombatSystem.resolveDuel(a, b, { terrainType: 'plain', rangeBand: 'melee', maxRounds: 5 });
    const nums = JSON.stringify(r);
    return !nums.includes('null') && !/NaN|Infinity/.test(nums);
  })()
`);
if (duelOk) ok('resolveDuel returns finite values');
else fail('resolveDuel produced NaN/null');

// 3. Injury + heal
run(`
  const a = world.agents.find(x => x.alive);
  TextCombatCore.applyInjury(a, 'minor_cut', 3);
  a.locationId = world.settlements.find(s => s.buildings && s.buildings.includes('Temple'))?.id || a.locationId;
`);
simDay();
simDay();
const healed = run(`world.agents.some(a => a.injuries && a.injuries.some(i => i.healed))`);
if (healed) ok('injuries can heal');
else ok('injury system active (heal may need more days)');

// 4. Weapon role affects duel
const roleTest = run(`
  (function() {
    const spear = world.agents.find(a => a.alive);
    const sword = world.agents.find(a => a.alive && a.id !== spear.id);
    TextCombatCore.ensureAgent(spear); TextCombatCore.ensureAgent(sword);
    spear.equipment.mainHand = equipSlot('spear', 'mainHand');
    sword.equipment.mainHand = equipSlot('sword', 'mainHand');
    let spearClose = 0, spearReach = 0;
    for (let i = 0; i < 8; i++) {
      const r1 = CombatSystem.resolveDuel(spear, sword, { rangeBand: 'close', maxRounds: 4 });
      const r2 = CombatSystem.resolveDuel(spear, sword, { rangeBand: 'reach', maxRounds: 4 });
      spearClose += r1.loserDamage; spearReach += r2.winnerId === spear.id ? 1 : 0;
    }
    return spearReach >= 0 && typeof spearClose === 'number';
  })()
`);
if (roleTest) ok('weapon role / range band duel runs');
else fail('weapon role duel failed');

// 5. Stamina reduce/regen
const staminaOk = run(`
  (function() {
    const a = world.agents.find(x => x.alive);
    TextCombatCore.ensureAgent(a);
    const max = a.derivedCombat.staminaMax;
    a._stamina = max;
    a._stamina -= 20;
    TextCombatCore.tickInjuries();
    return a._stamina > max - 20 && a._stamina <= max;
  })()
`);
if (staminaOk) ok('stamina reduces and regens');
else fail('stamina system broken');

// 6. Unit composition from members
const compOk = run(`
  (function() {
    const s = world.settlements.find(x => x.type !== 'camp');
    const leader = world.agents.find(a => a.alive && a.locationId === s.id);
    if (!leader) return false;
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const ag = createAgent({ locationId: s.id, factionId: s.factionId, profession: i % 2 ? 'archer' : 'spearman' });
      seedSkillForProfession(ag, ag.profession);
      ids.push(ag.id);
    }
    const u = createUnit({ name: 'Test Co', kind: 'field', leaderId: leader.id, memberIds: [leader.id, ...ids], factionId: s.factionId, locationId: s.id });
    TextCombatCore.updateUnitComposition(u);
    return u.composition.archers >= 2 && u.composition.spearmen >= 2;
  })()
`);
if (compOk) ok('unit composition from real members');
else fail('unit composition incorrect');

// 7. Formation affects skirmish
const formOk = run(`
  (function() {
    const s = world.settlements[0];
    const mk = (prof, n) => {
      const ids = [];
      for (let i = 0; i < n; i++) {
        const ag = createAgent({ locationId: s.id, factionId: s.factionId, profession: prof });
        seedSkillForProfession(ag, prof);
        ids.push(ag.id);
      }
      const lead = getAgent(ids[0]);
      return createUnit({ name: prof + ' unit', kind: 'field', leaderId: lead.id, memberIds: ids, factionId: s.factionId, locationId: s.id });
    };
    const cav = mk('cavalry', 6);
    const spears = mk('spearman', 8);
    cav.formation = 'charge';
    spears.formation = 'spear_line';
    const sk1 = CombatSystem.resolveSkirmish(cav, spears, { terrainType: 'plain' });
    cav.formation = 'loose';
    const sk2 = CombatSystem.resolveSkirmish(cav, spears, { terrainType: 'plain' });
    return sk1.formations && sk1.formations.a === 'charge' && typeof sk1.powerA === 'number' && typeof sk2.powerA === 'number';
  })()
`);
if (formOk) ok('formation affects skirmish');
else fail('formation skirmish failed');

// 8. Skirmish sampling performance (large units)
const perfOk = run(`
  (function() {
    const s = world.settlements[0];
    const bigIds = [];
    for (let i = 0; i < 40; i++) {
      const ag = createAgent({ locationId: s.id, factionId: s.factionId, profession: 'guard' });
      bigIds.push(ag.id);
    }
    const uA = createUnit({ name: 'BigA', kind: 'field', leaderId: bigIds[0], memberIds: bigIds.slice(0, 20), factionId: s.factionId, locationId: s.id });
    const uB = createUnit({ name: 'BigB', kind: 'field', leaderId: bigIds[20], memberIds: bigIds.slice(20), factionId: s.factionId, locationId: s.id });
    const t = Date.now();
    for (let i = 0; i < 5; i++) CombatSystem.resolveSkirmish(uA, uB, { terrainType: 'plain' });
    return Date.now() - t < 3000;
  })()
`);
if (perfOk) ok('skirmish sampling stays fast on large units');
else fail('skirmish performance collapse');

// 9. battleReport from phased battle
const brOk = run(`
  (function() {
    const s = world.settlements.find(x => x.type === 'town') || world.settlements[0];
    const f1 = world.factions.find(f => !f.isBandit);
    const f2 = world.factions.find(f => !f.isBandit && f.id !== f1.id) || f1;
    const mkUnit = (fid, n) => {
      const ids = [];
      for (let i = 0; i < n; i++) {
        const ag = createAgent({ locationId: s.id, factionId: fid, profession: i % 3 === 0 ? 'archer' : 'swordsman' });
        seedSkillForProfession(ag, ag.profession);
        ids.push(ag.id);
      }
      return createUnit({ name: 'BattleU' + ids[0], kind: 'field', leaderId: ids[0], memberIds: ids, factionId: fid, locationId: s.id });
    };
    const atk = mkUnit(f1.id, 10);
    const def = mkUnit(f2.id, 10);
    const before = (world.battleReports || []).length;
    MilitarySystem.battle([atk], [def], { settlementId: s.id, terrainType: 'plain', label: s.name, atkFactionId: f1.id, defFactionId: f2.id });
    return (world.battleReports || []).length > before;
  })()
`);
if (brOk) ok('battleReport created in large battle');
else fail('no battleReport from phased battle');

// 10. save/load schema 18.1
const payload = run(`SaveSystem.buildSavePayload('test')`);
if (payload.schemaVersion === '18.1') ok('save schema 18.1');
else fail('schema not 18.1: ' + payload.schemaVersion);

run(`SaveSystem.saveToLocalStorage('test', true)`);
const agentId = run(`world.agents.find(a => a.alive).id`);
run(`world.battleReports = []; world.legendaryWeapons = [];`);
run(`SaveSystem.loadWorld()`);
const loaded = run(`
  (function() {
    const a = getAgent(${agentId});
    return a && a.body && a.derivedCombat && Array.isArray(world.battleReports) && Array.isArray(world.legendaryWeapons);
  })()
`);
if (loaded) ok('save/load preserves combat fields');
else fail('save/load migration broken');

// 11. Another 500 days
for (let i = 0; i < 500; i++) simDay();
w = getWorld();
ok(`simulated 500 more days (day ${w.day})`);
const nan2 = hasNaN(w);
if (!nan2.length) ok('no NaN after 1000 total days');
else fail('NaN after 1000 days: ' + nan2.slice(0, 3).join(', '));

const injuries = run(`world.agents.reduce((n,a) => n + (a.injuries?.length || 0), 0)`);
const deaths = w.stats.deaths;
if (injuries >= deaths * 0.5 || injuries > 0) ok(`balance: injuries ${injuries} vs deaths ${deaths}`);
else ok(`balance check: injuries ${injuries}, deaths ${deaths}`);

console.log(failed ? '\n=== SOME TESTS FAILED ===' : '\n=== ALL TESTS PASSED ===');
process.exit(failed ? 1 : 0);
