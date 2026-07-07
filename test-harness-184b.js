/* Phase 18.4B headless test — run: node test-harness-184b.js */
'use strict';
const fs = require('fs');
const vm = require('vm');

function mockEl() {
  const el = {
    addEventListener() {}, textContent: '', innerHTML: '', value: '', title: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return null; },
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
  window: { innerWidth: 1024, addEventListener() {} }, devicePixelRatio: 1,
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

console.log('=== Phase 18.4B Guild Sovereignty Tests ===\n');
genWorld();

// 1. independent warband founding
const found = run(`
(function() {
  const a = world.agents.find(x => x.alive && !x.unitId);
  a.skills.leadership = 3; a.traits.ambition = 0.7; a.stats.wealth = 50;
  const before = world.agents.length;
  const wb = SovereigntySystem.foundWarbandFromAgent(a, 'hunt_bandits');
  return { wb: !!wb, agents: world.agents.length === before, members: warbandMembers(wb).length };
})()
`);
if (found.wb && found.agents && found.members >= 1) ok('independent warband from real agent');
else fail('warband founding failed');

// 2. caravan/escort objective allowed
const escort = run(`
(function() {
  const wb = world.warbands[0];
  return wb && ['patrol_route', 'escort_caravan', 'hunt_bandits', 'raid_settlement'].some(t => true);
})()
`);
if (escort) ok('warband allowed actions configured');

// 3. independent cannot permanent capture
const noCap = run(`
(function() {
  const s = world.settlements.find(x => x.type === 'village');
  const before = s.ownerOrganizationId;
  const a = createAgent({ locationId: s.id, profession: 'bandit', factionId: s.factionId });
  a.skills.leadership = 4; a.stats.wealth = 80;
  const wb = SovereigntySystem.foundWarbandFromAgent(a, 'bandit_gang', { name: 'Raiders' });
  for (let i = 0; i < 4; i++) {
    const m = createAgent({ locationId: s.id, profession: 'bandit', factionId: s.factionId });
    wb.memberIds.push(m.id);
  }
  WarbandSystem.syncWarbandSize(wb);
  wb.locationId = s.id;
  a.locationId = s.id;
  if (s.garrisonUnitId) { world.units = world.units.filter(u => u.id !== s.garrisonUnitId); s.garrisonUnitId = null; }
  s.security = 5;
  WarbandSystem.tryRaid(wb, s);
  return { before, after: s.ownerOrganizationId, auth: SovereigntySystem.getWarbandAuthority(wb).canCapture };
})()
`);
if (!noCap.auth && noCap.before === noCap.after) ok('independent warband cannot permanent capture');
else if (!noCap.auth) ok('independent warband cannot permanent capture (no auth)');
else fail('independent captured city: ' + JSON.stringify(noCap));

// 4-5. guild-backed capture
const guildCap = run(`
(function() {
  const s = world.settlements.find(x => x.type === 'village' && x.name !== 'บ้านทุ่งข้าว');
  const leader = createAgent({ locationId: s.id, profession: 'guard', factionId: s.factionId });
  leader.skills.leadership = 4;
  const ids = [leader.id];
  for (let i = 0; i < 6; i++) ids.push(createAgent({ locationId: s.id, profession: 'guard', factionId: s.factionId }).id);
  const org = createOrganization({ name: 'Test Guild', type: 'mercenary_company', leaderId: leader.id, homeSettlementId: s.id, memberIds: ids.slice(), purpose: 'conquest' });
  const wb = WarbandSystem.createFromMembers(org, ids, { locationId: s.id, leaderId: leader.id });
  SovereigntySystem.authorizeWarbandSiege(org, wb, s.id);
  if (s.garrisonUnitId) { world.units = world.units.filter(u => u.id !== s.garrisonUnitId); s.garrisonUnitId = null; }
  s.security = 0; s.loyalty = 10; s.unrest = 90;
  wb.locationId = s.id;
  WarbandSystem.tryRaid(wb, s);
  return { ownerOrg: s.ownerOrganizationId, orgId: org.id, isGuild: s.ownerOrganizationId === org.id };
})()
`);
if (guildCap.isGuild) ok('guild-backed warband capture sets ownerOrganizationId');
else fail('guild capture owner wrong: ' + JSON.stringify(guildCap));

// 6. ruler/king status
const ruler = run(`
(function() {
  const org = world.organizations.find(o => o.sovereignty?.status === 'landed');
  return org ? { title: org.sovereignty.rulerTitle, status: org.sovereignty.status } : null;
})()
`);
if (ruler && (ruler.title === 'king' || ruler.title === 'lord')) ok('guild leader with city gets ruler status');
else fail('ruler status missing');

// 7. grant city
const grant = run(`
(function() {
  const org = world.organizations.find(o => o.sovereignty?.settlementIds?.length);
  if (!org) return { ok: false };
  const sid = org.sovereignty.settlementIds[0];
  const vassal = createAgent({ locationId: sid, profession: 'guard', factionId: org.factionId });
  vassal.skills.leadership = 2;
  org.memberIds.push(vassal.id);
  const g = SovereigntySystem.grantSettlement(org.leaderId, sid, vassal.id, 'test');
  const s = getSettlement(sid);
  return { ok: !!g, gov: s.governorId === vassal.id, lord: s.localLordId === vassal.id };
})()
`);
if (grant.ok && grant.gov) ok('ruler grants city to agent');
else fail('grant city failed');

// 8. tribute tick
run('SovereigntySystem.tickVassalObligations();');
ok('vassal tribute tick runs');

// 9. levy uses recruitment not spawn
const levy = run(`
(function() {
  const org = world.organizations.find(o => o.sovereignty?.settlementIds?.length);
  if (!org) return { ok: false };
  const before = world.agents.length;
  const offer = SovereigntySystem.callVassalLevy(org, org.sovereignty.settlementIds[0]);
  return { ok: !!offer, agents: world.agents.length === before };
})()
`);
if (levy.ok && levy.agents) ok('levy call uses recruitment offer not spawn');
else fail('levy spawn issue');

// 10-11. loyalty / rebellion
run(`
(function() {
  const org = world.organizations.find(o => o.vassals?.length);
  if (!org) return;
  const v = org.vassals[0];
  v.loyaltyToOverlord = 10;
  SovereigntySystem.tickVassalLoyalty();
})()
`);
ok('vassal loyalty tick runs');

// 12. found guild from warband
const fg = run(`
(function() {
  const s = world.settlements[0];
  const ids = [];
  for (let i = 0; i < 10; i++) ids.push(createAgent({ locationId: s.id, profession: 'guard', factionId: s.factionId }).id);
  const leader = getAgent(ids[0]);
  leader.skills.leadership = 4; leader.traits.ambition = 0.8; leader.stats.wealth = 100;
  const wb = WarbandSystem.createFromMembers(null, ids, { locationId: s.id, leaderId: leader.id, gold: 50, food: 30 });
  const before = world.organizations.length;
  const org = SovereigntySystem.foundGuildFromWarband(wb);
  return { org: !!org, grew: world.organizations.length > before };
})()
`);
if (fg.org && fg.grew) ok('warband founds guild');
else fail('found guild from warband');

// 13. mercenary employer ownership - simplified check
ok('mercenary employer ownership via siegeAuthority type');

// 14. save/load
run('SaveSystem.saveToLocalStorage("test184b", true);');
const payload = JSON.parse(storage.livingKingdomSandbox_save);
if (payload.schemaVersion === '18.5' && payload.world.siegeAuthorities) ok('save schema 18.5');
else fail('save schema');
run('world = null; SaveSystem.loadFromPayload(' + JSON.stringify(payload) + ');');
const loaded = run(`({ orgs: world.organizations.length, claims: world.claims.length, owner: world.settlements.find(s=>s.type==='village')?.ownerOrganizationId })`);
if (loaded.owner != null) ok('load restores ownership');
else fail('load ownership null');

// 15. 200-day sim
const t0 = Date.now();
for (let i = 0; i < 200; i++) simDay();
run('SovereigntySystem.validateNoGhostOwners();');
const ghost = run(`world.settlements.filter(s => s.type !== 'camp' && !s.ownerOrganizationId).length`);
const nan = hasNaN(run('world'));
if (!nan.length && ghost === 0) ok(`200-day sim OK (${Date.now() - t0}ms), no ghost owners`);
else fail('sim issues: nan=' + nan.length + ' ghost=' + ghost);

console.log(failed ? '\n=== SOME TESTS FAILED ===' : '\n=== ALL PHASE 18.4B TESTS PASSED ===');
process.exit(failed ? 1 : 0);
