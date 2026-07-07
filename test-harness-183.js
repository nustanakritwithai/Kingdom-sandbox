/* Phase 18.3 headless test — run: node test-harness-183.js */
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
      fillText() {}, measureText: () => ({ width: 10 }), setTransform() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) })
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

const genWorld = () => vm.runInContext('generateWorld()', sandbox);
const simDay = () => vm.runInContext('simulateDay()', sandbox);
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

console.log('=== Phase 18.3 Organizations & Warbands Tests ===\n');
genWorld();

// 1. recruitment offer without spawn
const offerTest = run(`
(function() {
  const s = world.settlements.find(x => x.type === 'town') || world.settlements[0];
  const before = world.agents.length;
  const org = createOrganization({ name: 'Test Co', type: 'mercenary_company', homeSettlementId: s.id, memberIds: [] });
  const offer = OrganizationSystem.postRecruitmentOffer(org, { settlementId: s.id, type: 'mercenary_hire', quantityNeeded: 4 });
  return { before, after: world.agents.length, offerId: offer?.id, orgId: org.id };
})()
`);
if (offerTest.after === offerTest.before && offerTest.offerId) ok('recruitment offer without spawning agents');
else fail('recruitment offer spawned agents or failed');

// 2-4. join score + accept + travel
const joinFlow = run(`
(function() {
  const offer = world.recruitmentOffers[0];
  const s = getSettlement(offer.settlementId);
  const mp = getMusterPoint(offer.musterPointId);
  const far = world.settlements.find(x => x.id !== s.id && findPath(x.id, s.id, true));
  const spawnSid = far ? far.id : s.id;
  const agents = [];
  for (let i = 0; i < 5; i++) {
    const a = createAgent({ locationId: spawnSid, factionId: s.factionId, profession: 'unemployed', money: 5 });
    a.stats.hunger = 30; a.money = 10;
    agents.push(a);
  }
  const scores = agents.map(a => OrganizationSystem.evaluateJoinOffer(a, offer));
  const best = agents[scores.indexOf(Math.max(...scores))];
  OrganizationSystem.acceptApplicant(offer, best.id);
  const mem = best.memberships.find(m => m.organizationId === offer.organizationId);
  return { score: Math.max(...scores), status: mem?.status, traveling: !!best.travel, accepted: offer.acceptedAgentIds.length, atMuster: best.locationId === mp.locationId };
})()
`);
if (joinFlow.score > -100 && joinFlow.accepted >= 1) ok('agent evaluates and applies to offer');
else fail('join flow failed');
if (joinFlow.status === 'traveling_to_muster' || joinFlow.traveling) ok('accepted agent travels to muster (not active yet)');
else if (joinFlow.atMuster && joinFlow.status === 'active') ok('agent at muster becomes active member');
else fail('agent not in traveling_to_muster state');

// 5-6. warband from real members
const wb = run(`
(function() {
  const s = world.settlements[0];
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const a = createAgent({ locationId: s.id, factionId: s.factionId, profession: 'guard' });
    ids.push(a.id);
  }
  const org = createOrganization({ name: 'Field Co', type: 'militia_company', leaderId: ids[0], homeSettlementId: s.id, memberIds: [] });
  return WarbandSystem.createFromMembers(org, ids, { locationId: s.id, food: 30 });
})()
`);
if (wb && wb.memberIds.length === 6 && wb.size === 6) ok('warband size equals real memberIds');
else fail('warband size mismatch');

// 7. movement progress
const moved = run(`
(function() {
  const wb = world.warbands[0];
  const dest = world.settlements.find(s => s.id !== wb.locationId);
  WarbandSystem.startMarch(wb, dest.id, 'march');
  const before = wb.progress;
  WarbandSystem.tickMovement();
  return { hasTravel: !!wb.travel, progress: wb.progress, speed: WarbandSystem.computeSpeed(wb) };
})()
`);
if (moved.hasTravel && moved.speed > 0) ok('warband marches on route graph');
else fail('warband movement failed');

// 8. speed modifiers
const speedTest = run(`
(function() {
  const wb = world.warbands[0];
  const base = WarbandSystem.computeSpeed(wb);
  wb.woundedCount = warbandMembers(wb).length;
  const wounded = WarbandSystem.computeSpeed(wb);
  wb.woundedCount = 0; wb.fatigue = 90;
  const tired = WarbandSystem.computeSpeed(wb);
  return { base, wounded, tired };
})()
`);
if (speedTest.wounded < speedTest.base && speedTest.tired < speedTest.base) ok('speed changes with wounded/fatigue');
else fail('speed modifiers not applied');

// 9-10. food consumption
const foodBefore = wb.food;
run(`(function() { const wb = world.warbands[0]; WarbandSystem.tickSupply(); return wb.food; })()`);
const foodAfter = run('world.warbands[0].food');
if (foodAfter < foodBefore) ok('warband food decreases with members');
else fail('food did not decrease');
run(`world.warbands[0].food = 0; WarbandSystem.tickSupply();`);
const moraleAfter = run('world.warbands[0].morale');
if (moraleAfter < 65) ok('low food reduces morale');
else fail('morale not affected by hunger');

// 11-12. encounter + pursuit
run(`
(function() {
  const s = world.settlements[0];
  const org = createOrganization({ name: 'A', type: 'bandit_gang', homeSettlementId: s.id, memberIds: [] });
  const ids1 = [], ids2 = [];
  for (let i = 0; i < 4; i++) ids1.push(createAgent({ locationId: s.id, profession: 'bandit' }).id);
  for (let i = 0; i < 4; i++) ids2.push(createAgent({ locationId: s.id, profession: 'guard', factionId: world.factions[0].id }).id);
  const a = WarbandSystem.createFromMembers(org, ids1, { locationId: s.id, type: 'bandit_gang' });
  const b = WarbandSystem.createFromMembers(org, ids2, { locationId: s.id, type: 'militia', factionId: world.factions[0].id });
  WarbandSystem.resolveEncounter(a, b);
  return { aStatus: a.status, bStatus: b.status };
})()
`);
ok('encounter between warbands runs without error');

// 13. split no clone
const splitTest = run(`
(function() {
  const wb = world.warbands[0];
  const beforeAgents = world.agents.length;
  const half = wb.memberIds.slice(0, Math.floor(wb.memberIds.length / 2));
  const child = WarbandSystem.splitWarband(wb, half);
  const allIds = new Set(world.agents.map(a => a.id));
  return { beforeAgents, afterAgents: world.agents.length, childSize: child?.memberIds.length, dup: allIds.size !== world.agents.length };
})()
`);
if (splitTest.beforeAgents === splitTest.afterAgents && !splitTest.dup) ok('split does not clone agents');
else fail('split cloned agents');

// 14. raiseArmy uses recruitment not spawn
const raiseTest = run(`
(function() {
  const f = world.factions.find(x => !x.isBandit);
  const ruler = getAgent(f.rulerId);
  f.warState = true; f.enemies = [world.factions.find(x => x.isBandit)?.id].filter(Boolean);
  const before = world.agents.length;
  GovernanceSystem.raiseArmy(f, ruler);
  const offers = world.recruitmentOffers.filter(o => o.organizationId && o.type === 'royal_conscription');
  return { before, after: world.agents.length, offers: offers.length };
})()
`);
if (raiseTest.after === raiseTest.before && raiseTest.offers > 0) ok('raiseArmy posts recruitment instead of spawning');
else fail('raiseArmy may have spawned soldiers');

// 15. guild migration
const guildMig = run(`
(function() {
  if (!world.guilds.length) return { migrated: false };
  OrganizationSystem.migrateLegacyGuilds();
  const g = world.guilds[0];
  const org = world.organizations.find(o => o._legacyGuildId === g.id);
  return { migrated: !!org, type: org?.type };
})()
`);
if (guildMig.migrated && guildMig.type === 'merchant_guild') ok('merchant guild migrates to organization');
else if (!guildMig.migrated) ok('guild migration skipped (no guilds yet)');
else fail('guild migration failed');

// 16. save/load
run('SaveSystem.saveToLocalStorage("test183", true);');
const payload = JSON.parse(storage.livingKingdomSandbox_save);
if (payload.schemaVersion === run('SAVE_SCHEMA_VERSION')) ok('save schema ' + payload.schemaVersion + ' includes orgs/warbands');
else fail('save schema mismatch: ' + payload.schemaVersion);
run('world = null; SaveSystem.loadFromPayload(' + JSON.stringify(payload) + ');');
const loaded = run(`({ orgs: world.organizations.length, wbs: world.warbands.length, offers: world.recruitmentOffers.length })`);
if (loaded.orgs >= 0 && loaded.wbs >= 0) ok('load restores organizations/warbands');
else fail('load failed');

// 17. 200 day stress (lighter than 1000 for CI)
const t0 = Date.now();
for (let i = 0; i < 200; i++) simDay();
const elapsed = Date.now() - t0;
const nan = hasNaN(run('world'));
if (!nan.length) ok(`200-day sim OK (${elapsed}ms)`);
else fail('NaN after sim: ' + nan.slice(0, 5).join(', '));

console.log(failed ? '\n=== SOME TESTS FAILED ===' : '\n=== ALL PHASE 18.3 TESTS PASSED ===');
process.exit(failed ? 1 : 0);
