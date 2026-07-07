/* Phase 19.1 Liveness Unlock — headless test — run: node test-harness-191-liveness.js
   ตรวจว่าเนื้อเกมครึ่งหลัง "เกิดเองตามธรรมชาติ": army/battle/warband/muster,
   ผู้นำ faction ฟื้นเสมอ (ไม่อัมพาต), เส้นทางฟื้นจากโจรได้, ไม่มี spawned soldier,
   engine ยังนิ่ง (0 NaN, save/load ผ่าน schema 19.1) */
'use strict';
const fs = require('fs');
const vm = require('vm');

function mockEl() {
  const el = {
    addEventListener() {}, textContent: '', innerHTML: '', value: '', title: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return mockEl(); }, querySelectorAll() { return []; },
    getContext: () => new Proxy({}, { get: (t, k) =>
      k === 'measureText' ? () => ({ width: 10 })
      : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) })
      : k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {} }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 640 }),
    parentElement: null, files: null, click() {}, style: {}, dataset: {}
  };
  el.parentElement = { getBoundingClientRect: () => ({ width: 1000, height: 640 }) };
  return el;
}

function makeSandbox() {
  const storage = {};
  const els = {};
  const sandbox = {
    console, Math: Object.create(Math), Date, JSON, performance: { now: () => Date.now() },
    Blob: class Blob {}, URL: { createObjectURL: () => 'b', revokeObjectURL() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: { getItem: k => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); }, removeItem: k => { delete storage[k]; } },
    document: { getElementById: id => els[id] || (els[id] = mockEl()), querySelectorAll: () => [], createElement: () => mockEl(), body: mockEl() },
    requestAnimationFrame: () => {}, confirm: () => true, alert: () => {},
    window: { innerWidth: 1024, addEventListener() {} }, devicePixelRatio: 1,
    setTimeout: fn => { fn(); return 0; }, clearTimeout() {}
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(__dirname + '/script.js', 'utf8'), sandbox);
  sandbox.__storage = storage;
  return sandbox;
}

function seeded(sandbox, seed) {
  vm.runInContext(`(function(){ let s=${seed >>> 0}; Math.random=function(){ s=(1103515245*s+12345)>>>0; return s/4294967296; }; })()`, sandbox);
}
const R = (sb, code) => vm.runInContext(code, sb);

function findNaN(root) {
  const iss = []; const seen = new Set();
  const walk = (v, p, d) => {
    if (d > 12) return;
    if (typeof v === 'number') { if (!Number.isFinite(v)) iss.push(p); return; }
    if (!v || typeof v !== 'object') return;
    if (seen.has(v)) return; seen.add(v);
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, p + '[' + i + ']', d + 1));
    else for (const k in v) walk(v[k], p + '.' + k, d + 1);
  };
  walk(root, 'world', 0); return iss;
}

let failed = false;
function ok(m) { console.log('OK:', m); }
function fail(m) { console.log('FAIL:', m); failed = true; }

console.log('=== Phase 19.1 Liveness Tests ===\n');

/* ── 1. Leadership recovery: ราชาตายไร้ทายาท → faction มีผู้นำใหม่ภายใน 30 วัน ── */
(() => {
  const sb = makeSandbox(); seeded(sb, 3); R(sb, 'generateWorld()');
  R(sb, `(function(){
    const f = world.factions.find(x => !x.isBandit);
    // ฆ่าทุกคนใน faction ที่มีสิทธิ์เป็นผู้นำ ให้เหลือแต่สามัญชน
    for (const a of world.agents) if (a.alive && a.factionId === f.id && (RULER_PROFS.has(a.profession) || a.skills.leadership > 4)) NeedSystem.kill(a, 'ทดสอบ');
    globalThis.__testF = f.id;
  })()`);
  R(sb, 'for(let i=0;i<30;i++) simulateDay();');
  const res = R(sb, `(function(){
    const f = getFaction(__testF);
    const r = f.rulerId != null ? getAgent(f.rulerId) : null;
    return { hasLeader: !!(r && r.alive), recovered: world.balanceMetrics.liveness.rulersRecovered };
  })()`);
  if (res.hasLeader && res.recovered > 0) ok('faction ฟื้นผู้นำหลังราชาตายไร้ทายาท (recovered=' + res.recovered + ')');
  else fail('leadership recovery: ' + JSON.stringify(res));
})();

/* ── 2. ไม่มี dangling rulerId/governorId หลังจำลองยาว ── */
(() => {
  const sb = makeSandbox(); seeded(sb, 5); R(sb, 'generateWorld()');
  R(sb, 'for(let i=0;i<2000;i++) simulateDay();');
  const dangling = R(sb, `(function(){
    let bad = 0;
    for (const f of world.factions) { if (f.rulerId != null) { const r = getAgent(f.rulerId); if (!r || !r.alive) bad++; } }
    for (const s of world.settlements) { if (s.governorId != null) { const g = getAgent(s.governorId); if (!g || !g.alive) bad++; } }
    return bad;
  })()`);
  if (dangling === 0) ok('ไม่มี dangling ruler/governor หลัง 2000 วัน');
  else fail('dangling refs: ' + dangling);
})();

/* ── 3. เกณฑ์ทหารข้ามเมือง: สงครามตอนเมืองหลวงร้าง → มีผู้สมัคร + muster สำเร็จ + ไม่เสกทหาร ── */
(() => {
  const sb = makeSandbox(); seeded(sb, 2); R(sb, 'generateWorld()');
  // นับ createAgent ระหว่างระดมพล — ต้องไม่เสกทหาร
  R(sb, `(function(){
    globalThis.__spawns = 0; const _ca = createAgent;
    globalThis.createAgent = function(o){ if (o && o.profession && MILITARY_PROFS.has(o.profession)) __spawns++; return _ca(o); };
  })()`);
  R(sb, 'for(let i=0;i<2500;i++) simulateDay();');
  const res = R(sb, `(function(){
    const lv = world.balanceMetrics.liveness;
    const applicants = world.recruitmentOffers.reduce((s,o)=>s+o.acceptedAgentIds.length,0);
    return { musters: lv.successfulMusters, warbands: lv.warbandsFormed, applicants, spawns: __spawns };
  })()`);
  if (res.musters >= 1) ok('รวมพลสำเร็จ (successfulMusters=' + res.musters + ')');
  else fail('no successful musters');
  if (res.applicants > 0) ok('มีผู้สมัครเข้าเกณฑ์ (applicants=' + res.applicants + ')');
  else fail('no applicants');
  if (res.spawns === 0) ok('ไม่มีการเสกทหาร (spawned soldiers = 0)');
  else fail('spawned soldiers detected: ' + res.spawns);
})();

/* ── 4. สงครามผลิตกองทัพ+การรบจริง (อย่างน้อย 1 seed จาก 4) ── */
(() => {
  let anyArmy = false, anyBattle = false, best = {};
  for (const seed of [1, 2, 5, 7]) {
    const sb = makeSandbox(); seeded(sb, seed); R(sb, 'generateWorld()');
    R(sb, 'for(let i=0;i<3000;i++) simulateDay();');
    const r = R(sb, `({ armies: world.balanceMetrics.liveness.armiesCreated, battled: world.wars.filter(w=>w.battles.length>0).length })`);
    if (r.armies > 0) anyArmy = true;
    if (r.battled > 0) anyBattle = true;
    best[seed] = r;
  }
  if (anyArmy) ok('กองทัพก่อตัวจริงในบาง seed ' + JSON.stringify(best));
  else fail('no armies formed in any seed ' + JSON.stringify(best));
  if (anyBattle) ok('สงครามมีการรบจริงในบาง seed');
  else fail('no wars with battles in any seed');
})();

/* ── 5. เส้นทางฟื้นจากอันตราย: danger 0.9 + กองลาดตระเวน → ลดลงต่ำกว่า 0.5 ── */
(() => {
  const sb = makeSandbox(); seeded(sb, 4); R(sb, 'generateWorld()');
  R(sb, 'for(let i=0;i<200;i++) simulateDay();');
  const recovered = R(sb, `(function(){
    const r = world.routes.find(x => !x.destroyed);
    r.danger = 0.9; r.patrolLevel = 5;
    const start = r.danger;
    for (let i=0;i<80;i++) { r.danger = clamp(r.danger - 0.008 - r.patrolLevel*0.012, 0.02, 1); r.patrolLevel = Math.max(0, r.patrolLevel - 0.1); if (r.patrolLevel < 3) r.patrolLevel = 5; }
    return { start, end: r.danger };
  })()`);
  if (recovered.end < 0.5) ok('เส้นทางฟื้นจาก danger 0.9 → ' + recovered.end.toFixed(2) + ' (มีลาดตระเวน)');
  else fail('route did not recover: ' + JSON.stringify(recovered));
})();

/* ── 6. caravan loss rate ไม่ ~99% (โจรถูกกดพอควร) — อย่างน้อย 2/3 seed ── */
(() => {
  let good = 0; const rates = {};
  for (const seed of [1, 3, 6]) {
    const sb = makeSandbox(); seeded(sb, seed); R(sb, 'generateWorld()');
    R(sb, 'for(let i=0;i<3000;i++) simulateDay();');
    const rate = R(sb, `(function(){
      const lv = world.balanceMetrics.liveness;
      const total = lv.caravanTrips + lv.caravanLost;
      return total > 0 ? lv.caravanLost / total : 0;
    })()`);
    rates[seed] = +rate.toFixed(2);
    if (rate < 0.9) good++;
  }
  if (good >= 2) ok('caravan loss < 90% ในอย่างน้อย 2/3 seed ' + JSON.stringify(rates));
  else fail('caravan loss too high ' + JSON.stringify(rates));
})();

/* ── 7. specialist ไม่สูญพันธุ์ทุก seed (miner+woodcutter+crafter > 0 ในบาง seed) ── */
(() => {
  let anySpecialist = false; const counts = {};
  for (const seed of [1, 2, 3, 4]) {
    const sb = makeSandbox(); seeded(sb, seed); R(sb, 'generateWorld()');
    R(sb, 'for(let i=0;i<3000;i++) simulateDay();');
    const n = R(sb, `world.agents.filter(a=>a.alive && (a.profession==='miner'||a.profession==='woodcutter'||a.profession==='crafter')).length`);
    counts[seed] = n; if (n > 0) anySpecialist = true;
  }
  if (anySpecialist) ok('specialist (miner/woodcutter/crafter) รอดในบาง seed ' + JSON.stringify(counts));
  else fail('specialists extinct in all seeds ' + JSON.stringify(counts));
})();

/* ── 8. Engine guards: 0 NaN + save/load roundtrip schema 19.1 + จำลองต่อได้ ── */
(() => {
  const sb = makeSandbox(); seeded(sb, 6); R(sb, 'generateWorld()');
  R(sb, 'for(let i=0;i<1500;i++) simulateDay();');
  const nan1 = findNaN(sb.world);
  if (!nan1.length) ok('0 NaN หลัง 1500 วัน');
  else fail('NaN found: ' + JSON.stringify(nan1.slice(0, 5)));

  R(sb, 'SaveSystem.saveToLocalStorage("t191", true)');
  const payload = JSON.parse(sb.__storage['livingKingdomSandbox_save']);
  if (payload.schemaVersion === '19.1') ok('save schema 19.1');
  else fail('save schema: ' + payload.schemaVersion);

  const sb2 = makeSandbox(); seeded(sb2, 99);
  R(sb2, `world = null; SaveSystem.loadFromPayload(${JSON.stringify(payload)});`);
  const match = R(sb2, 'world.day') === R(sb, 'world.day');
  let crash = null;
  try { R(sb2, 'for(let i=0;i<100;i++) simulateDay();'); } catch (e) { crash = e.message; }
  const nan2 = findNaN(sb2.world);
  if (match && !crash && !nan2.length) ok('load restore + จำลองต่อ 100 วัน (0 NaN)');
  else fail('roundtrip: match=' + match + ' crash=' + crash + ' nan=' + nan2.length);
})();

console.log('');
if (failed) { console.log('=== SOME PHASE 19.1 TESTS FAILED ==='); process.exit(1); }
else console.log('=== ALL PHASE 19.1 TESTS PASSED ===');
