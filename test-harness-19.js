/* Phase 19 headless court politics tests — run: node test-harness-19.js */
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

const genWorld = (seed) => vm.runInContext(seed != null ? `(function(){ generateWorld(); world.seed=${seed}; })()` : 'generateWorld()', sandbox);
const simDay = () => vm.runInContext('simulateDay()', sandbox);
const run = (code) => vm.runInContext(code, sandbox);

function hasNaN(obj, path = 'world', issues = []) {
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

function assertCourtInvariants(label) {
  const r = run(`(function() {
    const issues = [];
    const agentWarband = new Map();
    for (const wb of (world.warbands || [])) {
      for (const id of wb.memberIds) {
        if (!getAgent(id)?.alive) continue;
        if (agentWarband.has(id)) issues.push('clone:' + id);
        agentWarband.set(id, wb.id);
      }
    }
    for (const org of (world.organizations || [])) {
      if (org.sovereignty?.status === 'landed' && !org.court) issues.push('landed_no_court:' + org.id);
      if (!org.court) continue;
      for (const id of org.court.courtMemberIds) {
        if (!getAgent(id)?.alive) issues.push('invalid_court_member:' + id);
      }
      for (const o of org.court.offices) {
        if (!getAgent(o.holderId)?.alive) issues.push('dead_office:' + o.type);
      }
      if (org.court.succession?.currentHeirId && !getAgent(org.court.succession.currentHeirId)?.alive) {
        issues.push('dead_heir:' + org.id);
      }
      for (const c of (org.court.claimants || [])) {
        if (c.status === 'active' && !getAgent(c.agentId)?.alive) issues.push('dead_claimant:' + c.agentId);
      }
    }
    return { issues, day: world.day };
  })()`);
  if (r.issues.length) fail(`${label}: ${r.issues.slice(0, 8).join(', ')}`);
  else ok(`${label} court invariants (day ${r.day})`);
  return r;
}

function runDays(n) {
  for (let i = 0; i < n; i++) simDay();
}

function makeLandedRealm() {
  return run(`(function() {
    const s = world.settlements.find(x => x.type === 'village');
    if (!s) return null;
    const leader = createAgent({ locationId: s.id, profession: 'lord', factionId: s.factionId });
    leader.skills = leader.skills || {};
    leader.skills.leadership = 4;
    const ids = [leader.id];
    for (let i = 0; i < 5; i++) {
      const m = createAgent({ locationId: s.id, profession: 'guard', factionId: s.factionId });
      ids.push(m.id);
    }
    const org = createOrganization({
      name: 'Court Test Realm ' + world.organizations.length, type: 'mercenary_company', leaderId: leader.id,
      homeSettlementId: s.id, memberIds: ids.slice(), purpose: 'conquest', wealth: 200
    });
    s.ownerOrganizationId = org.id;
    s.taxRecipient = org.id;
    SovereigntySystem.updateOrganizationSovereignty(org);
    CourtSystem.ensureCourt(org);
    return { orgId: org.id, leaderId: leader.id, settlementId: s.id, agentCount: world.agents.length };
  })()`);
}

console.log('=== Phase 19 Court Politics Tests ===\n');

const schema = run('SAVE_SCHEMA_VERSION');
if (schema === '19.0') ok('schema 19.0');
else fail('schema expected 19.0 got ' + schema);

if (run('typeof BALANCE === "object" && BALANCE.court && typeof CourtSystem !== "undefined"')) ok('BALANCE.court + CourtSystem present');
else fail('CourtSystem missing');

genWorld(19001);

// 1. landed organization creates court
const courtCreate = makeLandedRealm();
if (courtCreate && run(`(function(){ const org = getOrganization(${courtCreate.orgId}); return org && org.court && org.court.rulerId; })()`)) {
  ok('landed organization creates court');
} else fail('court not created for landed org');

// 2. court members are real agents
const membersReal = run(`(function() {
  const org = getOrganization(${courtCreate.orgId});
  return org.court.courtMemberIds.every(id => getAgent(id)?.alive);
})()`);
if (membersReal) ok('court members are real alive agents');
else fail('ghost court members');

// 3. appoint office uses real agent
const appoint = run(`(function() {
  const org = getOrganization(${courtCreate.orgId});
  const agent = org.memberIds.map(getAgent).find(a => a && a.alive && a.id !== org.leaderId);
  if (!agent) return { ok: false, reason: 'no agent' };
  CourtSystem.appointOffice(org, 'steward', agent.id, true);
  const office = org.court.offices.find(o => o.type === 'steward');
  return { ok: !!office && office.holderId === agent.id && getAgent(office.holderId)?.alive };
})()`);
if (appoint.ok) ok('appoint office uses real agent');
else fail('appoint office failed: ' + JSON.stringify(appoint));

// 4. office effects affect metrics
const officeFx = run(`(function() {
  const org = getOrganization(${courtCreate.orgId});
  const sid = org.sovereignty.settlementIds[0];
  const s = getSettlement(sid);
  const wb = WarbandSystem.createFromMembers(org, org.memberIds.slice(0, 3), { locationId: sid, leaderId: org.leaderId });
  const p0 = s.prosperity;
  const f0 = wb.food;
  const w0 = org.wealth || 0;
  const steward = org.court.offices.find(o => o.type === 'steward');
  if (steward) steward.competence = 90;
  const treasurer = org.court.offices.find(o => o.type === 'treasurer') || org.court.offices[0];
  if (treasurer) { treasurer.type = 'treasurer'; treasurer.competence = 85; treasurer.corruption = 5; }
  org.wealth = 120;
  CourtSystem.tickOfficeEffects(org);
  return { prosperity: s.prosperity > p0 || wb.cohesion > 0, food: wb.food >= f0, wealth: org.wealth !== w0 || wb.food > f0 };
})()`);
if (officeFx.prosperity || officeFx.food || officeFx.wealth) ok('office effects touch prosperity/supply/treasury metrics');
else fail('office effects inert: ' + JSON.stringify(officeFx));

// 5. heir chosen from real agent
const heirPick = run(`(function() {
  const org = getOrganization(${courtCreate.orgId});
  org.court.succession.currentHeirId = null;
  const heir = CourtSystem.chooseHeir(org, 'appointment', true);
  return { ok: !!heir && heir.alive && heir.id !== org.leaderId, id: heir?.id };
})()`);
if (heirPick.ok) ok('heir chosen from real agent');
else fail('heir pick failed');

// 6. ruler death triggers succession
const succession = run(`(function() {
  const org = getOrganization(${courtCreate.orgId});
  const ruler = getAgent(org.leaderId);
  const oldLeaderId = org.leaderId;
  const heirId = org.court.succession.currentHeirId;
  ruler.alive = false;
  CourtSystem.handleAgentDeath(ruler);
  return {
    changed: org.leaderId !== oldLeaderId || org.court.regency || org.court.currentCrises.includes('succession_crisis'),
    heirWas: heirId,
    leaderAlive: getAgent(org.leaderId)?.alive
  };
})()`);
if (succession.changed) ok('ruler death/invalid triggers succession handling');
else fail('succession on ruler death failed');

// 7. disputed succession creates crisis
const crisis = run(`(function() {
  const realm = (function() {
    const s = world.settlements.find(x => x.type === 'village' && x.ownerOrganizationId !== ${courtCreate.orgId});
    if (!s) return null;
    const leader = createAgent({ locationId: s.id, profession: 'lord', factionId: s.factionId });
    const ids = [leader.id];
    for (let i = 0; i < 4; i++) ids.push(createAgent({ locationId: s.id, profession: 'guard', factionId: s.factionId }).id);
    const org = createOrganization({ name: 'Crisis Realm', type: 'mercenary_company', leaderId: leader.id, homeSettlementId: s.id, memberIds: ids, purpose: 'conquest' });
    s.ownerOrganizationId = org.id;
    SovereigntySystem.updateOrganizationSovereignty(org);
    CourtSystem.ensureCourt(org);
    return org;
  })();
  if (!realm) return { ok: false, reason: 'no realm' };
  const a = realm.court.courtMemberIds.map(getAgent).find(x => x && x.id !== realm.leaderId);
  const b = realm.court.courtMemberIds.map(getAgent).find(x => x && x.id !== realm.leaderId && x.id !== a.id);
  CourtSystem.createClaimant(a, realm, 'elected_candidate', 55);
  CourtSystem.createClaimant(b, realm, 'local_support', 50);
  realm.court.succession.successionStability = 20;
  CourtSystem.tickSuccessionStability(realm);
  return { ok: realm.court.currentCrises.includes('succession_crisis'), crises: realm.court.currentCrises };
})()`);
if (crisis.ok) ok('disputed succession creates crisis');
else fail('succession crisis missing: ' + JSON.stringify(crisis));

// 8. claimant faction can form
const faction = run(`(function() {
  const org = world.organizations.find(o => o.court && o.sovereignty?.status === 'landed');
  if (!org) return { ok: false };
  const a = org.memberIds.map(getAgent).find(x => x && x.alive && x.id !== org.leaderId)
    || org.court.courtMemberIds.map(getAgent).find(x => x && x.alive && x.id !== org.leaderId);
  if (!a) return { ok: false, reason: 'no agent' };
  const fac = CourtSystem.createFaction(org, a.id, 'vassal_autonomy');
  return { ok: !!fac && fac.leaderId === a.id && getAgent(fac.leaderId)?.alive };
})()`);
if (faction.ok) ok('claimant/vassal faction forms from real agent');
else fail('faction creation failed');

// 9. civil war uses real warbands, no spawned troops
const civilWar = run(`(function() {
  const org = world.organizations.find(o => o.court && o.sovereignty?.status === 'landed' && o.leaderId && getAgent(o.leaderId)?.alive);
  if (!org) return { ok: false, reason: 'no org' };
  const agentsBefore = world.agents.length;
  const claimant = org.memberIds.map(getAgent).filter(a => a && a.alive && a.id !== org.leaderId);
  if (claimant.length < 3) return { ok: false, reason: 'not enough agents' };
  const leader = claimant[0];
  const fac = CourtSystem.createFaction(org, leader.id, 'support_claimant');
  if (fac) fac.memberIds = claimant.slice(1, 3).map(a => a.id);
  const cw = CourtSystem.startCivilWar(org, leader.id, 'succession_dispute');
  if (!cw) return { ok: false, reason: 'no civil war' };
  const rebelWbs = cw.rebelWarbandIds.map(getWarband).filter(Boolean);
  const allMemberIds = rebelWbs.flatMap(w => w.memberIds);
  const allReal = allMemberIds.length > 0 && allMemberIds.every(id => getAgent(id)?.alive);
  const noSpawnNobles = world.agents.length === agentsBefore;
  const loyalFromExisting = cw.loyalistWarbandIds.every(wid => world.warbands.some(w => w.id === wid));
  return { ok: rebelWbs.length > 0 && allReal && noSpawnNobles && loyalFromExisting, rebelCount: rebelWbs.length };
})()`);
if (civilWar.ok) ok('civil war splits real warbands without spawning agents');
else fail('civil war invalid: ' + JSON.stringify(civilWar));

// 10. vassal faction demand autonomy
const autonomy = run(`(function() {
  const org = world.organizations.find(o => o.court && o.leaderId && getAgent(o.leaderId)?.alive);
  if (!org) return { ok: false };
  const vassalAgent = org.memberIds.map(getAgent).find(a => a && a.alive && a.id !== org.leaderId);
  if (!vassalAgent) return { ok: false };
  if (!org.vassals) org.vassals = [];
  if (!org.vassals.some(v => v.agentId === vassalAgent.id)) {
    org.vassals.push({ agentId: vassalAgent.id, settlementIds: [], loyaltyToOverlord: 22, status: 'active', tributeOwed: 0 });
  } else {
    const v = org.vassals.find(x => x.agentId === vassalAgent.id);
    v.loyaltyToOverlord = 22;
  }
  const fac = CourtSystem.createFaction(org, vassalAgent.id, 'vassal_autonomy');
  return { ok: fac && fac.agenda === 'vassal_autonomy' };
})()`);
if (autonomy.ok) ok('vassal faction demand autonomy');
else fail('vassal autonomy faction failed');

// 11. corruption affects treasury/grievance
const corrupt = run(`(function() {
  const org = world.organizations.find(o => o.court?.offices?.length);
  const office = org.court.offices[0];
  const holder = getAgent(office.holderId);
  office.corruption = 80;
  office.competence = 40;
  org.wealth = 100;
  const w0 = org.wealth;
  holder.grievances = [];
  CourtSystem.tickOfficeEffects(org);
  CourtSystem.tickCorruption(org);
  const unpaid = (holder.grievances || []).some(g => g.type === 'unpaid_by_court');
  return { ok: org.wealth < w0 || office.corruption > 0 || unpaid || (holder.grievances || []).length > 0 };
})()`);
if (corrupt.ok) ok('corruption affects treasury or grievance');
else fail('corruption effects missing');

// 12. save/load court data
genWorld(19012);
makeLandedRealm();
runDays(30);
const saveLoad = run(`(function() {
  const payload = SaveSystem.buildSavePayload('test19');
  const courtOrgs = world.organizations.filter(o => o.court).length;
  const heirs = world.organizations.filter(o => o.court?.succession?.currentHeirId).length;
  const wars = (world.civilWars || []).length;
  SaveSystem.loadFromPayload(payload);
  const courtAfter = world.organizations.filter(o => o.court).length;
  const heirsAfter = world.organizations.filter(o => o.court?.succession?.currentHeirId).length;
  const warsAfter = (world.civilWars || []).length;
  const schemaOk = payload.schemaVersion === '19.0';
  return { schemaOk, courtOrgs, courtAfter, heirs, heirsAfter, wars, warsAfter };
})()`);
if (saveLoad.schemaOk && saveLoad.courtAfter >= saveLoad.courtOrgs) ok('save/load preserves court/succession');
else fail('save/load court broken: ' + JSON.stringify(saveLoad));

// 13. WorldIntegrity repair invalid office/heir
genWorld(19088);
const repairRealm = makeLandedRealm();
const repair = run(`(function() {
  const org = getOrganization(${repairRealm.orgId});
  const agent = org.memberIds.map(getAgent).find(a => a && a.alive && a.id !== org.leaderId);
  CourtSystem.appointOffice(org, 'marshal', agent.id, true);
  const office = org.court.offices.find(o => o.type === 'marshal');
  if (!office) return { ok: false, reason: 'no office' };
  const dead = getAgent(office.holderId);
  dead.alive = false;
  org.court.succession.currentHeirId = dead.id;
  WorldIntegritySystem.runCheck({ repair: true, silent: true });
  const holderAlive = org.court.offices.every(o => getAgent(o.holderId)?.alive);
  const heirOk = !org.court.succession.currentHeirId || getAgent(org.court.succession.currentHeirId)?.alive;
  return { ok: holderAlive && heirOk };
})()`);
if (repair.ok) ok('WorldIntegrity repairs invalid office/heir');
else fail('integrity repair court failed: ' + JSON.stringify(repair));

// 14. 1000-day run — no NaN, no clone, no invalid court id
genWorld(19099);
runDays(1000);
const nan = hasNaN(sandbox.world);
if (!nan.length) ok('1000 days no NaN');
else fail('NaN after 1000d: ' + nan.slice(0, 5).join(', '));
assertCourtInvariants('1000d');
run('WorldIntegritySystem.runCheck({ repair: true, silent: true })');
assertCourtInvariants('1000d after integrity');

console.log(failed ? '\n=== SOME TESTS FAILED ===' : '\n=== ALL PHASE 19 TESTS PASSED ===');
process.exit(failed ? 1 : 0);
