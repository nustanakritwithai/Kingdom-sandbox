/* Phase 18.5 save/load soak — run: node test-harness-185-save.js */
'use strict';
const {
  createTestSandbox, run, runDays, getCurrentSchemaVersion, createTestReporter
} = require('./test-utils/dom-mock');

const { ok, fail, finish } = createTestReporter('Phase 18.5 Save/Load Soak');
const sandbox = createTestSandbox();
const schema = getCurrentSchemaVersion(sandbox);

console.log('=== Phase 18.5 Save/Load Soak ===\n');

run(sandbox, 'generateWorld()');
runDays(sandbox, 3000);

const payload = run(sandbox, 'SaveSystem.buildSavePayload("soak")');
const size = JSON.stringify(payload).length;
if (size < 8000000) ok(`save size ${(size / 1024).toFixed(0)} KB reasonable`);
else fail(`save too large: ${size}`);

if (payload.schemaVersion === schema) ok('payload schema ' + schema);
else fail('schema mismatch: ' + payload.schemaVersion);

run(sandbox, `(function(p){ SaveSystem.loadFromPayload(p); })(${JSON.stringify(payload)})`);
runDays(sandbox, 500);

const check = run(sandbox, `(function() {
  SovereigntySystem.validateNoGhostOwners();
  const issues = [];
  for (const s of world.settlements) {
    if (s.type !== 'camp' && !s.ownerOrganizationId) issues.push('owner');
  }
  const clones = new Set();
  for (const wb of world.warbands) {
    for (const id of wb.memberIds) {
      if (!getAgent(id)?.alive) continue;
      if (clones.has(id)) issues.push('clone');
      clones.add(id);
    }
  }
  let dangling = 0;
  for (const f of world.factions) {
    if (f.rulerId != null) { const r = getAgent(f.rulerId); if (!r || !r.alive) dangling++; }
  }
  if (dangling) issues.push('dangling_ruler:' + dangling);
  return { issues, day: world.day, schema: SAVE_SCHEMA_VERSION };
})()`);

if (check.schema === schema) ok('loaded schema ' + check.schema);
else fail('loaded schema ' + check.schema);

if (!check.issues.length) ok(`post-load integrity day ${check.day}`);
else fail('broken refs: ' + check.issues.join(','));

finish('\nPASSED', '\nFAILED');
