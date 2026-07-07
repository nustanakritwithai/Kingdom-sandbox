/* Phase 19 audit — shared headless sandbox loader (uses test-utils/dom-mock) */
'use strict';
const {
  createTestSandbox, seedRandom, run, runDays, createMockElement
} = require('../test-utils/dom-mock');

function boot(seed) {
  const sandbox = createTestSandbox();
  const api = {
    sandbox,
    storage: sandbox.__storage,
    run: code => run(sandbox, code),
    seedRandom: s => seedRandom(sandbox, s),
    genWorld() { return run(sandbox, 'generateWorld()'); },
    simDay() { return run(sandbox, 'simulateDay()'); },
    simDays(n) { return runDays(sandbox, n); }
  };
  if (seed !== undefined) { api.seedRandom(seed); api.genWorld(); }
  return api;
}

const NAN_SNIPPET = `(function(){
  let count = 0; const paths = [];
  const seen = new Set();
  const walk = (v, p, d) => {
    if (d > 8) return;
    if (typeof v === 'number') { if (!Number.isFinite(v)) { count++; if (paths.length < 10) paths.push(p); } return; }
    if (!v || typeof v !== 'object') return;
    if (seen.has(v)) return; seen.add(v);
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) walk(v[i], p + '[' + i + ']', d + 1); }
    else { for (const k in v) walk(v[k], p + '.' + k, d + 1); }
  };
  walk(world, 'world', 0);
  return { count, paths };
})()`;

const INTEGRITY_SNIPPET = `(function(){
  const issues = [];
  const sIds = new Set(world.settlements.map(s => s.id));
  const aIds = new Set(world.agents.map(a => a.id));
  const uIds = new Set(world.units.map(u => u.id));
  const fIds = new Set(world.factions.map(f => f.id));
  const arIds = new Set(world.armies.map(a => a.id));
  for (const a of world.agents) {
    if (!a.alive) continue;
    if (a.locationId != null && !sIds.has(a.locationId)) issues.push('agent ' + a.id + ' locationId dangling');
    if (a.homeId != null && !sIds.has(a.homeId)) issues.push('agent ' + a.id + ' homeId dangling');
    if (a.unitId != null && !uIds.has(a.unitId)) issues.push('agent ' + a.id + ' unitId dangling');
    if (a.factionId != null && !fIds.has(a.factionId)) issues.push('agent ' + a.id + ' factionId dangling');
  }
  for (const u of world.units) {
    for (const mid of u.memberIds || []) {
      const m = world.agents.find(x => x.id === mid);
      if (!m) issues.push('unit ' + u.id + ' member ' + mid + ' missing');
    }
    if (u.armyId != null && !arIds.has(u.armyId)) issues.push('unit ' + u.id + ' armyId dangling');
    if (u.factionId != null && !fIds.has(u.factionId)) issues.push('unit ' + u.id + ' factionId dangling');
  }
  for (const s of world.settlements) {
    if (s.factionId != null && !fIds.has(s.factionId)) issues.push('settlement ' + s.id + ' factionId dangling');
    if (s.governorId != null && s.governorId !== 0) {
      const g = world.agents.find(x => x.id === s.governorId);
      if (!g) issues.push('settlement ' + s.id + ' governorId missing agent');
      else if (!g.alive) issues.push('settlement ' + s.id + ' governor dead');
    }
    if (s.garrisonUnitId != null && !uIds.has(s.garrisonUnitId)) issues.push('settlement ' + s.id + ' garrisonUnitId dangling');
  }
  for (const f of world.factions) {
    if (f.rulerId != null) {
      const r = world.agents.find(x => x.id === f.rulerId);
      if (!r) issues.push('faction ' + f.id + ' rulerId missing agent');
      else if (!r.alive) issues.push('faction ' + f.id + ' ruler dead');
    }
  }
  const ghost = (typeof SovereigntySystem !== 'undefined' && SovereigntySystem.validateNoGhostOwners)
    ? SovereigntySystem.validateNoGhostOwners() : null;
  return { issues: issues.slice(0, 30), total: issues.length, ghost };
})()`;

module.exports = { boot, mockEl: createMockElement, NAN_SNIPPET, INTEGRITY_SNIPPET };
