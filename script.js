/* ═══════════════════════════════════════════════════════════════════════════
   LIVING KINGDOM SANDBOX
   WorldBox-style AI economy / war / governance simulator.
   ผู้เล่นเป็น observer เท่านั้น — ทุกอย่างขับเคลื่อนด้วย AI ของตัวละคร
   ─────────────────────────────────────────────────────────────────────────
   SECTIONS:
     1. UTILS
     2. CONFIG & STATIC DATA
     3. WORLD STATE & EVENT SYSTEM
     4. NAME GENERATOR
     5. WORLD GENERATION
     6. ROUTE GRAPH / PATHFINDING / TRAVEL
     7. ECONOMY SYSTEM  (stock / demand / price / production)
     8. NEED SYSTEM     (hunger / energy / health / morale)
     9. AGENT AI        (utility scoring: งาน อาชีพ การย้าย)
    10. WORK SYSTEM     (ทำงานจริง สกิลโต เครื่องมือเสื่อม)
    11. TRADER SYSTEM   (คาราวาน กำไร เส้นทาง)
    12. BANDIT SYSTEM   (ปล้นคาราวาน ปล้นหมู่บ้าน)
    13. MILITARY SYSTEM (unit / army / recruitment / battle / capture)
    14. GOVERNANCE      (ภาษี เจ้าเมือง อาคาร governor กบฏ faction)
    15. SIMULATION TICK
    16. RENDERER        (canvas + heatmaps)
    17. UI              (toolbar / inspector / sandbox tools)
    18. INIT
   ═══════════════════════════════════════════════════════════════════════ */

'use strict';

/* ═══════════════════════════ 1. UTILS ═══════════════════════════ */

function rand(min, max) { return min + Math.random() * (max - min); }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function chance(p) { return Math.random() < p; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }
function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
function sum(arr, fn) { let s = 0; for (const v of arr) s += fn ? fn(v) : v; return s; }
function fmt(n, d = 0) { return (+n).toFixed(d); }

/* ═══════════════════ 2. CONFIG & STATIC DATA ═══════════════════ */

const MAP_W = 1000, MAP_H = 640;

const GOODS = ['food', 'wood', 'ore', 'tools', 'weapons', 'bows', 'arrows', 'horses'];

const BASE_PRICE = {
  food: 10, wood: 8, ore: 15, tools: 35,
  weapons: 60, bows: 45, arrows: 4, horses: 120
};

// สีตามอาชีพ (ตาม GDD 4.2)
const PROF_COLOR = {
  farmer: '#5dbb63', woodcutter: '#a5754a', miner: '#9e9e9e', crafter: '#26c6da',
  trader: '#ffd54f', bandit: '#ef5350', guard: '#42a5f5', militia: '#42a5f5',
  swordsman: '#607d8b', spearman: '#42a5f5', archer: '#2e7d32', cavalry: '#ffa726',
  captain: '#ab47bc', commander: '#ab47bc', mayor: '#ab47bc', lord: '#ab47bc',
  king: '#ab47bc', unemployed: '#eceff1', migrant: '#eceff1', refugee: '#eceff1'
};

const MILITARY_PROFS = new Set(['guard', 'militia', 'swordsman', 'spearman', 'archer', 'cavalry', 'captain', 'commander']);
const RULER_PROFS = new Set(['mayor', 'lord', 'king']);
const WORKER_PROFS = ['farmer', 'woodcutter', 'miner', 'crafter'];

// อาคารที่สร้างได้ (ใช้ทรัพยากรจริง)
const BUILDINGS = {
  Market:     { cost: { gold: 150, wood: 30 },          effect: 'เพิ่มปริมาณการค้า' },
  Granary:    { cost: { gold: 100, wood: 40 },          effect: 'เพิ่มคลังอาหาร ลดของเสีย' },
  Warehouse:  { cost: { gold: 120, wood: 50 },          effect: 'เพิ่มความจุคลังสินค้า' },
  Blacksmith: { cost: { gold: 200, wood: 20, ore: 30 }, effect: 'ผลิต tools/weapons เร็วขึ้น' },
  Wall:       { cost: { gold: 250, wood: 60, ore: 40 }, effect: 'เพิ่มการป้องกัน' },
  Watchtower: { cost: { gold: 120, wood: 40 },          effect: 'ลดการปล้นแบบไม่ทันตั้งตัว' },
  Barracks:   { cost: { gold: 220, wood: 50, ore: 20 }, effect: 'ฝึกทหาร เพิ่ม recruitment' },
  Temple:     { cost: { gold: 180, wood: 30 },          effect: 'เพิ่ม loyalty และ morale' }
};

const SETTLEMENT_RADIUS = { village: 9, town: 16, fort: 12, castle: 20, camp: 10 };

/* ═════════════ 3. WORLD STATE & EVENT SYSTEM ═════════════ */

let world = null;
let nextId = 1;
function uid() { return nextId++; }

const EventSystem = {
  add(category, text) {
    world.events.push({ day: world.day, category, text });
    if (world.events.length > 600) world.events.splice(0, world.events.length - 600);
    UI.logDirty = true;
  }
};

/* ═══════════════════ 4. NAME GENERATOR ═══════════════════ */

const NAME_FIRST = ['อรุณ', 'กวิน', 'ธาดา', 'นคร', 'ปกรณ์', 'สิงห์', 'เมฆ', 'คีรี', 'วายุ', 'ตะวัน',
  'ภูผา', 'ชัย', 'ราม', 'อินทร์', 'เพชร', 'ทอง', 'ศิลา', 'ป่าน', 'ข้าว', 'ฟ้า',
  'มั่น', 'แกร่ง', 'หาญ', 'เดช', 'ฤทธิ์', 'ดารา', 'บุญ', 'คำ', 'แสง', 'จันทร์'];
const NAME_LAST = ['ศรีทอง', 'ป่าเหนือ', 'หินผา', 'ท่าน้ำ', 'ทุ่งกว้าง', 'ดงลึก', 'ภูสูง', 'นาคราช',
  'เหล็กกล้า', 'ไม้งาม', 'สายลม', 'ธารทอง', 'ดินดำ', 'เขาแก้ว', 'ห้วยขวาง'];

function genName() { return pick(NAME_FIRST) + ' ' + pick(NAME_LAST); }

/* ═══════════════════ 5. WORLD GENERATION ═══════════════════ */

function newStock(init) {
  const s = {};
  for (const g of GOODS) s[g] = 0;
  return Object.assign(s, init || {});
}

function createSettlement(opt) {
  const s = {
    id: uid(),
    name: opt.name,
    type: opt.type,                      // village | town | fort | castle | camp
    x: opt.x, y: opt.y,
    factionId: opt.factionId || null,
    ownerId: opt.ownerId || null,        // agent เจ้าของ
    governorId: null,
    prosperity: 50, loyalty: opt.type === 'camp' ? 100 : 70,
    unrest: 5, crime: 5, security: 30,
    taxRate: 0.10, treasury: opt.treasury != null ? opt.treasury : 200,
    stock: newStock(opt.stock),
    demand: newStock(),
    prices: Object.assign({}, BASE_PRICE),
    buildings: opt.buildings ? opt.buildings.slice() : [],
    garrisonUnitId: null,
    warDemand: 0,                        // ความต้องการอาวุธ/แร่เพื่อสงคราม
    drought: 0, plague: 0,
    siege: null,                         // { armyId, days }
    raidedRecently: 0,
    lastCapturedDay: -999,
    // ศักยภาพการผลิตพื้นฐานของพื้นที่
    prodPotential: opt.prod || { food: 0, wood: 0, ore: 0 },
    history: []
  };
  world.settlements.push(s);
  return s;
}

function createRoute(aId, bId, quality) {
  const a = getSettlement(aId), b = getSettlement(bId);
  const r = {
    id: uid(), a: aId, b: bId,
    distance: dist(a, b),
    danger: rand(0.05, 0.2),
    traffic: 0,
    roadQuality: quality != null ? quality : rand(0.4, 0.8),
    patrolLevel: 0,
    destroyed: false
  };
  world.routes.push(r);
  return r;
}

function createFaction(opt) {
  const f = {
    id: uid(),
    name: opt.name,
    color: opt.color,
    rulerId: opt.rulerId || null,
    isBandit: !!opt.isBandit,
    treasury: opt.treasury || 0,
    warState: false,
    enemies: [], allies: [],
    vassalIds: []
  };
  world.factions.push(f);
  return f;
}

const DEFAULT_SKILLS = () => ({
  farming: 0, woodcutting: 0, mining: 0, trading: 0, crafting: 0,
  sword: 0, spear: 0, archery: 0, riding: 0, fighting: 0,
  tactics: 0, leadership: 0, logistics: 0, governance: 0, diplomacy: 0
});

function createAgent(opt) {
  const a = {
    id: uid(),
    name: opt.name || genName(),
    age: randInt(16, 55),
    locationId: opt.locationId,
    homeId: opt.locationId,
    factionId: opt.factionId || null,
    unitId: null,
    profession: opt.profession || 'unemployed',
    rank: 'commoner',
    reputation: 0,
    alive: true,
    stats: { hunger: rand(60, 95), energy: rand(60, 100), health: 100, morale: rand(50, 75), wealth: 0 },
    money: opt.money != null ? opt.money : randInt(10, 40),
    inventory: Object.assign({ food: randInt(1, 4), wood: 0, ore: 0, tools: 0, weapon: 0, bow: 0, horse: 0, cart: 0 }, opt.inventory || {}),
    durability: { tools: 0, weapon: 0, cart: 0 },   // ความทนทานคงเหลือของไอเทมที่ถืออยู่
    skills: Object.assign(DEFAULT_SKILLS(), opt.skills || {}),
    traits: {
      bravery: rand(0.15, 0.9), greed: rand(0.15, 0.9), loyalty: rand(0.2, 0.95),
      ambition: rand(0.1, 0.95), riskTolerance: rand(0.1, 0.9), discipline: rand(0.2, 0.9)
    },
    memory: { battlesWon: 0, battlesLost: 0, survivedBattles: 0, citiesVisited: [], daysHungry: 0, raidsDone: 0 },
    // governor attributes (ใช้เมื่อได้เป็นผู้ปกครอง)
    gov: null,
    travel: null,        // { path:[ids], seg, progress, purpose }
    cargo: null,         // สำหรับพ่อค้า { good, qty, buyCost, destId }
    currentGoal: 'ตั้งตัว',
    currentThought: 'วันนี้จะทำอะไรดี...',
    // สำหรับ render
    _jitterA: Math.random() * Math.PI * 2,
    _jitterR: rand(0.3, 1)
  };
  world.agents.push(a);
  return a;
}

function createUnit(opt) {
  const u = {
    id: uid(),
    name: opt.name,
    kind: opt.kind,                 // guard | warband | rebel | field
    leaderId: opt.leaderId,
    memberIds: opt.memberIds ? opt.memberIds.slice() : [],
    factionId: opt.factionId || null,
    locationId: opt.locationId,
    travel: null,
    objective: opt.objective || { type: 'idle' },
    morale: 65, cohesion: 70, fatigue: 0,
    supply: { food: opt.food || 20, arrows: 20, weapons: 5 },
    battleHistory: [],
    armyId: null
  };
  world.units.push(u);
  for (const id of u.memberIds) { const m = getAgent(id); if (m) m.unitId = u.id; }
  return u;
}

function createArmy(opt) {
  const ar = {
    id: uid(),
    name: opt.name,
    commanderId: opt.commanderId,
    factionId: opt.factionId,
    unitIds: opt.unitIds.slice(),
    objective: opt.objective || { type: 'idle' },
    supply: { food: opt.food || 200, arrows: 100, weapons: 30, horses: 5 },
    morale: 70, reputation: 0,
    locationId: opt.locationId,
    travel: null
  };
  world.armies.push(ar);
  for (const uId of ar.unitIds) { const u = getUnit(uId); if (u) u.armyId = ar.id; }
  return ar;
}

/* ── lookup helpers ── */
function getSettlement(id) { return world.settlements.find(s => s.id === id); }
function getAgent(id) { return world.agents.find(a => a.id === id); }
function getUnit(id) { return world.units.find(u => u.id === id); }
function getArmy(id) { return world.armies.find(a => a.id === id); }
function getFaction(id) { return world.factions.find(f => f.id === id); }
function getRoute(aId, bId) {
  return world.routes.find(r => !r.destroyed && ((r.a === aId && r.b === bId) || (r.a === bId && r.b === aId)));
}
function agentsAt(settlementId) { return world.agents.filter(a => a.alive && a.locationId === settlementId && !a.travel); }
function populationOf(s) { return agentsAt(s.id).length; }
function unitMembers(u) { return u.memberIds.map(getAgent).filter(a => a && a.alive); }
function marketSettlements() { return world.settlements.filter(s => s.type !== 'camp'); }

/* ── สร้างโลก ── */
function generateWorld() {
  nextId = 1;
  world = {
    day: 0,
    settlements: [], routes: [], agents: [], units: [], armies: [], factions: [],
    events: [],
    stats: { deaths: 0, battles: 0, raids: 0, caravansRobbed: 0 }
  };

  // ── Factions ──
  const kingdom = createFaction({ name: 'ราชอาณาจักรสุวรรณ', color: '#42a5f5', treasury: 1500 });
  const banditF = createFaction({ name: 'พวกโจรป่าแดง', color: '#ef5350', isBandit: true, treasury: 50 });

  // ── Settlements: 1 castle, 2 towns, 1 fort, 4 villages, 1 bandit camp ──
  const castle = createSettlement({
    name: 'ปราสาทสุวรรณ', type: 'castle', x: 500, y: 300, factionId: kingdom.id,
    treasury: 1200, stock: { food: 260, wood: 100, ore: 60, tools: 25, weapons: 40, bows: 12, arrows: 200, horses: 10 },
    buildings: ['Wall', 'Barracks', 'Armory'], prod: { food: 1, wood: 0, ore: 0 }
  });
  const townN = createSettlement({
    name: 'เมืองเหนือ', type: 'town', x: 430, y: 110, factionId: kingdom.id,
    treasury: 700, stock: { food: 150, wood: 80, ore: 45, tools: 18, weapons: 10, bows: 5, arrows: 60, horses: 4 },
    buildings: ['Market'], prod: { food: 1, wood: 0.5, ore: 0 }
  });
  const townS = createSettlement({
    name: 'เมืองท่าใต้', type: 'town', x: 590, y: 520, factionId: kingdom.id,
    treasury: 700, stock: { food: 170, wood: 70, ore: 35, tools: 15, weapons: 8, bows: 4, arrows: 50, horses: 5 },
    buildings: ['Market'], prod: { food: 1.2, wood: 0.3, ore: 0 }
  });
  const fort = createSettlement({
    name: 'ป้อมตะวันตก', type: 'fort', x: 240, y: 330, factionId: kingdom.id,
    treasury: 350, stock: { food: 90, wood: 40, ore: 20, tools: 6, weapons: 22, bows: 6, arrows: 120 },
    buildings: ['Watchtower'], prod: { food: 0.3, wood: 0.5, ore: 0.3 }
  });
  const vFarm1 = createSettlement({
    name: 'บ้านทุ่งข้าว', type: 'village', x: 310, y: 150, factionId: kingdom.id,
    treasury: 160, stock: { food: 120, wood: 20 }, prod: { food: 3, wood: 0.5, ore: 0 }
  });
  const vFarm2 = createSettlement({
    name: 'บ้านนาทอง', type: 'village', x: 700, y: 420, factionId: kingdom.id,
    treasury: 160, stock: { food: 130, wood: 15 }, prod: { food: 3, wood: 0.3, ore: 0 }
  });
  const vWood = createSettlement({
    name: 'บ้านดงไม้', type: 'village', x: 780, y: 180, factionId: kingdom.id,
    treasury: 140, stock: { food: 60, wood: 80 }, prod: { food: 1, wood: 3, ore: 0 }
  });
  const vMine = createSettlement({
    name: 'บ้านเหมืองผา', type: 'village', x: 160, y: 520, factionId: kingdom.id,
    treasury: 140, stock: { food: 50, ore: 60, wood: 15 }, prod: { food: 0.6, wood: 0.5, ore: 3 }
  });
  const camp = createSettlement({
    name: 'ค่ายโจรป่าแดง', type: 'camp', x: 880, y: 560, factionId: banditF.id,
    treasury: 60, stock: { food: 40, weapons: 8 }, prod: { food: 0.4, wood: 0.3, ore: 0 }
  });

  // ── Routes (8-12 เส้น) ──
  createRoute(castle.id, townN.id, 0.8);
  createRoute(castle.id, townS.id, 0.8);
  createRoute(castle.id, fort.id, 0.7);
  createRoute(townN.id, vFarm1.id, 0.6);
  createRoute(townN.id, vWood.id, 0.5);
  createRoute(townS.id, vFarm2.id, 0.6);
  createRoute(fort.id, vMine.id, 0.5);
  createRoute(fort.id, vFarm1.id, 0.45);
  createRoute(townS.id, vMine.id, 0.4);
  createRoute(vWood.id, vFarm2.id, 0.4);
  createRoute(vFarm2.id, camp.id, 0.3);
  createRoute(castle.id, vFarm2.id, 0.55);

  // ── Agents ──
  // ราชา
  const king = createAgent({
    locationId: castle.id, factionId: kingdom.id, profession: 'king', money: 800,
    skills: { governance: 8, leadership: 9, tactics: 6, diplomacy: 7, sword: 5 }
  });
  king.rank = 'king'; king.reputation = 60;
  kingdom.rulerId = king.id;
  castle.ownerId = king.id;
  for (const s of [townN, townS, fort, vFarm1, vFarm2, vWood, vMine]) s.ownerId = king.id;

  // เจ้าเมือง
  for (const t of [townN, townS]) {
    const mayor = createAgent({
      locationId: t.id, factionId: kingdom.id, profession: 'mayor', money: 300,
      skills: { governance: rand(3, 6), leadership: rand(2, 5), trading: rand(1, 4) }
    });
    mayor.rank = 'mayor';
    t.governorId = mayor.id;
    mayor.gov = makeGovAttrs();
  }
  // ผู้บัญชาการป้อม
  const fortCmd = createAgent({
    locationId: fort.id, factionId: kingdom.id, profession: 'captain', money: 150,
    skills: { leadership: rand(4, 7), tactics: rand(3, 6), sword: rand(3, 6) },
    inventory: { weapon: 1 }
  });
  fortCmd.rank = 'captain';
  fort.governorId = fortCmd.id;
  fortCmd.gov = makeGovAttrs();

  // ประชากรตามชนิดถิ่นฐาน
  const spawnPlan = [
    [vFarm1, { farmer: 8, woodcutter: 1, unemployed: 2 }],
    [vFarm2, { farmer: 8, woodcutter: 1, unemployed: 2 }],
    [vWood, { woodcutter: 7, farmer: 2, unemployed: 1 }],
    [vMine, { miner: 7, farmer: 1, unemployed: 2 }],
    [townN, { crafter: 3, trader: 2, farmer: 2, guard: 3, unemployed: 3 }],
    [townS, { crafter: 3, trader: 2, farmer: 2, guard: 3, unemployed: 3 }],
    [fort, { guard: 5, swordsman: 2, archer: 2 }],
    [castle, { guard: 5, swordsman: 3, archer: 2, cavalry: 1, crafter: 2, trader: 1 }]
  ];
  for (const [s, plan] of spawnPlan) {
    for (const [prof, n] of Object.entries(plan)) {
      for (let i = 0; i < n; i++) {
        const ag = createAgent({ locationId: s.id, factionId: kingdom.id, profession: prof });
        seedSkillForProfession(ag, prof);
      }
    }
  }
  // โจรตั้งต้น
  for (let i = 0; i < 6; i++) {
    const b = createAgent({
      locationId: camp.id, factionId: banditF.id, profession: 'bandit', money: randInt(5, 25),
      skills: { fighting: rand(1, 4), sword: rand(0, 3) }, inventory: { weapon: chance(0.6) ? 1 : 0 }
    });
    b.traits.loyalty = rand(0.1, 0.4);
    b.traits.riskTolerance = rand(0.6, 0.95);
  }
  const banditChief = createAgent({
    locationId: camp.id, factionId: banditF.id, profession: 'bandit', money: 80,
    skills: { fighting: 5, leadership: 4, tactics: 2, sword: 4 }, inventory: { weapon: 1 }
  });
  banditChief.rank = 'chief'; banditChief.reputation = 15;
  banditF.rulerId = banditChief.id;
  camp.ownerId = banditChief.id;

  // จัด garrison เริ่มต้นให้ fort/castle/towns
  for (const s of [fort, castle, townN, townS]) ensureGarrison(s);

  EventSystem.add('system', `🌍 โลกใหม่ถือกำเนิด — ${world.agents.length} ชีวิตใน ${world.settlements.length} ถิ่นฐาน ภายใต้${kingdom.name}`);
}

function makeGovAttrs() {
  return {
    loyalty: rand(0.5, 0.95), ambition: rand(0.1, 0.9), corruption: rand(0, 0.5),
    competence: rand(0.3, 0.9), localSupport: rand(0.3, 0.7)
  };
}

function seedSkillForProfession(ag, prof) {
  const map = {
    farmer: 'farming', woodcutter: 'woodcutting', miner: 'mining', crafter: 'crafting',
    trader: 'trading', guard: 'fighting', swordsman: 'sword', archer: 'archery',
    spearman: 'spear', cavalry: 'riding', bandit: 'fighting'
  };
  const sk = map[prof];
  if (sk) ag.skills[sk] = rand(1, 4);
  if (prof === 'trader') { ag.money = randInt(80, 200); ag.inventory.cart = chance(0.5) ? 1 : 0; ag.durability.cart = ag.inventory.cart ? 60 : 0; }
  if (MILITARY_PROFS.has(prof)) {
    ag.inventory.weapon = 1; ag.durability.weapon = randInt(30, 60);
    if (prof === 'archer') ag.inventory.bow = 1;
    if (prof === 'cavalry') ag.inventory.horse = 1;
  }
  if (['farmer', 'woodcutter', 'miner'].includes(prof) && chance(0.6)) {
    ag.inventory.tools = 1; ag.durability.tools = randInt(20, 50);
  }
}

/* ═══════════ 6. ROUTE GRAPH / PATHFINDING / TRAVEL ═══════════ */

// Dijkstra บนกราฟ settlement — weight = ระยะ × สภาพถนน (+ ความอันตรายถ้า avoidDanger)
function findPath(fromId, toId, avoidDanger) {
  if (fromId === toId) return [fromId];
  const distMap = new Map(), prev = new Map(), visited = new Set();
  distMap.set(fromId, 0);
  while (true) {
    let cur = null, best = Infinity;
    for (const [id, d] of distMap) if (!visited.has(id) && d < best) { best = d; cur = id; }
    if (cur == null) return null;
    if (cur === toId) break;
    visited.add(cur);
    for (const r of world.routes) {
      if (r.destroyed) continue;
      let nb = null;
      if (r.a === cur) nb = r.b; else if (r.b === cur) nb = r.a;
      if (nb == null || visited.has(nb)) continue;
      let w = r.distance * (1.6 - r.roadQuality * 0.6);
      if (avoidDanger) w *= (1 + r.danger * 3);
      const nd = best + w;
      if (nd < (distMap.get(nb) ?? Infinity)) { distMap.set(nb, nd); prev.set(nb, cur); }
    }
  }
  const path = [toId];
  let c = toId;
  while (c !== fromId) { c = prev.get(c); path.unshift(c); }
  return path;
}

function startTravel(entity, toId, purpose, avoidDanger) {
  const path = findPath(entity.locationId, toId, avoidDanger);
  if (!path || path.length < 2) return false;
  entity.travel = { path, seg: 0, progress: 0, purpose: purpose || 'move' };
  return true;
}

// คำนวณตำแหน่ง x,y ของผู้เดินทาง
function travelPos(entity) {
  const t = entity.travel;
  const a = getSettlement(t.path[t.seg]), b = getSettlement(t.path[t.seg + 1]);
  if (!a || !b) return { x: 0, y: 0 };
  const r = getRoute(a.id, b.id);
  const frac = r ? clamp(t.progress / r.distance, 0, 1) : 1;
  return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
}

// เดินทาง 1 วัน — คืนค่า true เมื่อถึงปลายทาง
function advanceTravel(entity, speed) {
  const t = entity.travel;
  if (!t) return false;
  let moved = speed;
  while (moved > 0 && t.seg < t.path.length - 1) {
    const aId = t.path[t.seg], bId = t.path[t.seg + 1];
    const r = getRoute(aId, bId);
    if (!r) { // ถนนถูกทำลายระหว่างทาง — หาทางใหม่หรือย้อนกลับ
      entity.locationId = aId; entity.travel = null; return false;
    }
    r.traffic += 0.5;
    const remain = r.distance - t.progress;
    const step = moved * (0.6 + r.roadQuality * 0.6);
    if (step >= remain) {
      moved -= remain / (0.6 + r.roadQuality * 0.6);
      t.seg++; t.progress = 0;
      entity.locationId = bId;
    } else {
      t.progress += step; moved = 0;
    }
  }
  if (t.seg >= t.path.length - 1) {
    entity.locationId = t.path[t.path.length - 1];
    entity.travel = null;
    return true;
  }
  return false;
}

// ซื้อเสบียงก่อนออกเดินทาง — กันอดตายกลางทาง
function buyProvisions(a, s, want) {
  if (!s || s.type === 'camp') return;
  const need = Math.max(0, (want || 4) - a.inventory.food);
  if (need <= 0) return;
  const got = EconomySystem.buyFromSettlement(a, s, 'food', need);
  a.inventory.food += got;
}

function agentSpeed(a) {
  let sp = 80;
  if (a.inventory.horse > 0) sp += 50;
  if (a.cargo && a.inventory.cart > 0) sp -= 8;
  else if (a.cargo) sp -= 15;
  if (a.stats.energy < 30) sp *= 0.7;
  return sp;
}

/* ═══════════════════ 7. ECONOMY SYSTEM ═══════════════════ */

const EconomySystem = {
  // 7.1 ผลิตทรัพยากรระดับ settlement (จากคนทำงาน — ดู WorkSystem) + demand + price
  updateDemandAndPrices(s) {
    const pop = populationOf(s);
    const garrison = s.garrisonUnitId ? unitMembers(getUnit(s.garrisonUnitId)).length : 0;

    // ── demand ──
    s.demand.food = Math.round(pop * 2 + garrison * 2.5 + (s.type === 'castle' ? 40 : 0));
    s.demand.wood = Math.round(pop * 0.5 + (s.type !== 'village' ? 15 : 5) + s.warDemand * 0.3);
    s.demand.ore = Math.round(pop * 0.25 + (s.type === 'castle' ? 20 : 4) + s.warDemand * 0.8);
    s.demand.tools = Math.round(pop * 0.3 + 4);
    s.demand.weapons = Math.round(garrison * 0.6 + 3 + s.warDemand);
    s.demand.bows = Math.round(garrison * 0.2 + 1 + s.warDemand * 0.3);
    s.demand.arrows = Math.round(garrison * 3 + 10 + s.warDemand * 2);
    s.demand.horses = Math.round((s.type === 'castle' ? 8 : 2) + s.warDemand * 0.2);

    // ── ราคา: base × scarcity × dangerMod × taxMod (เพดาน 0.3–6 เท่า) ──
    const dangerMod = 1 + this.localDanger(s) * 0.35;
    const taxMod = 1 + s.taxRate * 0.8;
    for (const g of GOODS) {
      const scarcity = clamp(s.demand[g] / Math.max(s.stock[g], 1), 0.25, 6);
      let p = BASE_PRICE[g] * Math.pow(scarcity, 0.75) * dangerMod * taxMod;
      if (s.siege) p *= 1.6;
      s.prices[g] = clamp(p, BASE_PRICE[g] * 0.3, BASE_PRICE[g] * 6);
    }
  },

  localDanger(s) {
    let d = s.crime / 100;
    let n = 1;
    for (const r of world.routes) {
      if (r.destroyed) continue;
      if (r.a === s.id || r.b === s.id) { d += r.danger; n++; }
    }
    return clamp(d / n, 0, 1);
  },

  // ความจุคลัง — เกินแล้วของล้นเสียเปล่า (ผลักดันให้ขายออก)
  storageCap(s, good) {
    let cap = { village: 400, town: 700, fort: 400, castle: 1000, camp: 200 }[s.type] || 400;
    if (good === 'food' && s.buildings.includes('Granary')) cap *= 1.8;
    if (good !== 'food' && s.buildings.includes('Warehouse')) cap *= 1.8;
    return good === 'food' ? cap : cap * 0.5;
  },

  // การเน่าเสีย + การบริโภคพื้นฐานของเมือง (ที่ไม่ใช่ agent กินเอง)
  decayStock(s) {
    const granary = s.buildings.includes('Granary');
    s.stock.food = Math.max(0, s.stock.food - s.stock.food * (granary ? 0.004 : 0.012));
    if (s.siege) s.stock.food = Math.max(0, s.stock.food - 4); // การล้อมตัดเสบียง
    for (const g of GOODS) s.stock[g] = Math.min(s.stock[g], this.storageCap(s, g));
  },

  // จำนวนคนทำอาชีพเดียวกันในถิ่นฐาน — ใช้คิดผลตอบแทนลดหลั่น (ที่ดิน/หน้างานจำกัด)
  crowding(s, prof) {
    const n = agentsAt(s.id).filter(a => a.profession === prof).length;
    const ideal = { farmer: 8, woodcutter: 6, miner: 6, crafter: 5 }[prof] || 6;
    return clamp(ideal / Math.max(n, 1), 0.2, 1);
  },

  // agent ซื้อสินค้าจากคลังเมือง → เงินเข้าคลังเมือง
  buyFromSettlement(agent, s, good, qty) {
    qty = Math.min(qty, Math.floor(s.stock[good]));
    if (qty <= 0) return 0;
    const price = s.prices[good];
    const affordable = Math.floor(agent.money / price);
    qty = Math.min(qty, affordable);
    if (qty <= 0) return 0;
    const cost = qty * price;
    agent.money -= cost;
    s.treasury += cost;
    s.stock[good] -= qty;
    return qty;
  },

  // agent ขายสินค้าให้เมือง → เมืองจ่ายจากคลัง (ราคารับซื้อ 85% หัก market tax)
  sellToSettlement(agent, s, good, qty) {
    qty = Math.min(qty, agent.inventory[good] || (agent.cargo && agent.cargo.good === good ? agent.cargo.qty : 0));
    if (qty <= 0) return 0;
    const unitPrice = s.prices[good] * 0.85;
    const maxAffordable = Math.floor(s.treasury / unitPrice);
    qty = Math.min(qty, maxAffordable);
    if (qty <= 0) return 0;
    const gross = qty * unitPrice;
    const tax = gross * s.taxRate;
    agent.money += gross - tax;
    s.treasury -= gross - tax;  // ภาษีหักไว้ในคลังเมืองเลย
    s.stock[good] += qty;
    return qty;
  }
};

/* ═══════════════════ 8. NEED SYSTEM ═══════════════════ */

const NeedSystem = {
  update(a) {
    const s = getSettlement(a.locationId);

    // ── hunger ──
    a.stats.hunger -= a.travel ? 14 : 11;

    // กินจาก inventory
    if (a.stats.hunger < 75 && a.inventory.food >= 1) {
      a.inventory.food -= 1;
      a.stats.hunger = clamp(a.stats.hunger + 38, 0, 100);
    }
    // ซื้ออาหาร (ถ้าอยู่ในถิ่นฐานที่มีตลาด)
    if (a.stats.hunger < 55 && !a.travel && s && s.type !== 'camp') {
      const want = a.stats.hunger < 30 ? 3 : 2;
      const got = EconomySystem.buyFromSettlement(a, s, 'food', want);
      if (got > 0) {
        a.inventory.food += got - 1;
        a.stats.hunger = clamp(a.stats.hunger + 38, 0, 100);
      }
    }
    // ระหว่างเดินทาง: แวะซื้อเสบียงจากถิ่นฐานหลังสุดที่ผ่าน (ราคาแพงกว่าปกติ)
    if (a.stats.hunger < 45 && a.travel && a.inventory.food <= 0 && s && s.type !== 'camp' && s.stock.food >= 1) {
      const price = s.prices.food * 1.2;
      if (a.money >= price) {
        a.money -= price; s.treasury += price; s.stock.food -= 1;
        a.stats.hunger = clamp(a.stats.hunger + 38, 0, 100);
      }
    }
    // หาของป่า/ล่าสัตว์ระหว่างเดินทางเมื่อไม่มีทั้งอาหารและเงิน (โจรชำนาญกว่า)
    if (a.stats.hunger < 40 && a.travel && a.inventory.food <= 0) {
      const forageChance = a.profession === 'bandit' ? 0.75 : 0.55;
      if (chance(forageChance)) a.stats.hunger = clamp(a.stats.hunger + 24, 0, 100);
    }
    // โจรกินจากคลังค่าย
    if (a.stats.hunger < 55 && !a.travel && s && s.type === 'camp' && s.stock.food >= 1) {
      s.stock.food -= 1;
      a.stats.hunger = clamp(a.stats.hunger + 38, 0, 100);
    }

    // ── ผลของความหิว ──
    if (a.stats.hunger <= 0) {
      a.stats.hunger = 0;
      a.stats.health -= 12;
      a.memory.daysHungry++;
      a.currentThought = 'ข้ากำลังจะอดตาย...';
    } else if (a.stats.hunger < 25) {
      a.stats.morale -= 5;
      a.memory.daysHungry++;
    } else if (a.stats.hunger > 60) {
      a.stats.health = clamp(a.stats.health + 2, 0, 100);
      a.memory.daysHungry = 0;
    }

    // ── energy ──
    a.stats.energy = clamp(a.stats.energy + (a.travel ? -10 : 12), 0, 100);

    // ── โรคระบาด ──
    if (s && s.plague > 0 && chance(0.06 * s.plague)) {
      a.stats.health -= randInt(10, 25);
      a.currentThought = 'ข้ารู้สึกไม่สบาย... โรคร้ายกำลังระบาด';
    }

    // ── morale ปรับเข้าหาค่ากลาง ──
    a.stats.morale = clamp(a.stats.morale + (a.stats.morale < 50 ? 0.5 : -0.3), 0, 100);
    if (a.money > 100) a.stats.morale = clamp(a.stats.morale + 0.5, 0, 100);

    // ── ตาย ──
    if (a.stats.health <= 0) this.kill(a, a.stats.hunger <= 0 ? 'อดอาหารตาย' : 'เสียชีวิต');
  },

  kill(a, causeText) {
    if (!a.alive) return;
    a.alive = false;
    a.deathDay = world.day;
    a.deathCause = causeText;
    world.stats.deaths++;
    world.stats.deathCauses = world.stats.deathCauses || {};
    const key = `${causeText}:${a.profession}${a.travel ? '(เดินทาง)' : ''}${a.unitId ? '(หน่วย)' : ''}`;
    world.stats.deathCauses[key] = (world.stats.deathCauses[key] || 0) + 1;
    // ออกจากหน่วย
    if (a.unitId) {
      const u = getUnit(a.unitId);
      if (u) u.memberIds = u.memberIds.filter(id => id !== a.id);
    }
    // ทรัพย์ตกเป็นของถิ่นฐานที่อยู่
    const s = getSettlement(a.locationId);
    if (s) {
      s.treasury += a.money;
      s.stock.food += a.inventory.food || 0;
    }
    if (RULER_PROFS.has(a.profession) || a.rank === 'king') {
      EventSystem.add('politics', `⚰ ${a.name} (${a.profession}) ${causeText} — อำนาจสั่นคลอน`);
      handleRulerDeath(a);
    } else if (chance(0.35)) {
      EventSystem.add('life', `⚰ ${a.name} (${a.profession}) ${causeText}ที่${s ? s.name : 'กลางทาง'}`);
    }
  }
};

/* ═══════════════════ 9. AGENT AI (Utility) ═══════════════════ */

const AgentAI = {
  decide(a) {
    if (!a.alive || a.travel) return;
    if (a.unitId) { this.soldierThought(a); return; }        // ทหารในหน่วย — หน่วยตัดสินใจแทน
    if (RULER_PROFS.has(a.profession)) {
      // ผู้ปกครองตัดสินใจใน GovernanceSystem — แต่ถ้าเมืองอดอยากจนตัวเองจะตาย ก็หนี
      const home = getSettlement(a.locationId);
      if (home && home.stock.food < 3 && a.stats.hunger < 30 && a.inventory.food <= 0) {
        const refuge = this.bestMigrationTarget(a, home);
        if (refuge) {
          if (home.governorId === a.id) home.governorId = null;
          a.currentThought = `${home.name}ไม่เหลืออะไรแล้ว ข้าต้องหนีเอาชีวิตรอด`;
          EventSystem.add('politics', `🏃 ผู้ปกครอง ${a.name} ทิ้ง${home.name}ที่อดอยาก หนีไป${refuge.name}`);
          a.profession = 'migrant'; a.rank = 'commoner';
          startTravel(a, refuge.id, 'flee');
        }
      }
      return;
    }
    const s = getSettlement(a.locationId);
    if (!s) return;

    // ── สร้างตัวเลือกพร้อม utility score ──
    const options = [];
    const hungerUrgency = (100 - a.stats.hunger) / 100;      // 0..1
    const poor = a.money < 25;

    // พักผ่อน
    if (a.stats.energy < 20) options.push({ act: 'rest', score: 40 });

    // งานผลิตในถิ่นฐานนี้ (ผลตอบแทนลดลงเมื่อคนแน่นเกิน — ที่ดินจำกัด)
    if (s.type !== 'camp') {
      const foodPay = s.prices.food * (1.5 + a.skills.farming * 0.25) * s.prodPotential.food * 0.45 * EconomySystem.crowding(s, 'farmer');
      const woodPay = s.prices.wood * (1.2 + a.skills.woodcutting * 0.25) * s.prodPotential.wood * 0.45 * EconomySystem.crowding(s, 'woodcutter');
      const orePay = s.prices.ore * (1 + a.skills.mining * 0.25) * s.prodPotential.ore * 0.45 * EconomySystem.crowding(s, 'miner');
      if (s.prodPotential.food > 0) options.push({ act: 'work', prof: 'farmer', score: foodPay + hungerUrgency * 25 + (a.profession === 'farmer' ? 8 : 0) });
      if (s.prodPotential.wood > 0.4) options.push({ act: 'work', prof: 'woodcutter', score: woodPay + (a.profession === 'woodcutter' ? 8 : 0) });
      if (s.prodPotential.ore > 0.4) options.push({ act: 'work', prof: 'miner', score: orePay + (a.profession === 'miner' ? 8 : 0) });
      // งานช่าง (เมือง/ปราสาทที่มีวัตถุดิบ)
      if ((s.type === 'town' || s.type === 'castle') && s.stock.wood >= 1 && s.stock.ore >= 1) {
        const craftPay = s.prices.tools * 0.35 * (1 + a.skills.crafting * 0.3) + s.warDemand * 2;
        options.push({ act: 'work', prof: 'crafter', score: craftPay + (a.profession === 'crafter' ? 8 : 0) });
      }
      // เป็นพ่อค้า (ต้องมีทุน) — พ่อค้าอยู่ที่ไหนก็ค้าได้ คนอาชีพอื่นเริ่มจากเมืองตลาด
      if (a.money > 40 && (a.profession === 'trader' || s.type === 'town' || s.type === 'castle')) {
        options.push({ act: 'trade', score: 20 + a.skills.trading * 6 + a.traits.greed * 20 - hungerUrgency * 10 + (a.profession === 'trader' ? 15 : 0) });
      }
    }

    // ย้ายเมือง — ถ้าที่นี่แย่
    const localBadness = (s.prices.food / BASE_PRICE.food - 1) * 18 + s.unrest * 0.25 + s.crime * 0.3 + (s.siege ? 40 : 0);
    if (localBadness > 12 || (poor && hungerUrgency > 0.5)) {
      const best = this.bestMigrationTarget(a, s);
      if (best) options.push({ act: 'migrate', target: best.id, targetName: best.name, score: localBadness + hungerUrgency * 20 - 12 });
    }

    // เป็นโจร — ทางเลือกสุดท้ายของคนสิ้นหวัง (หรือคนโลภกล้าเสี่ยง)
    if (s.type !== 'camp' && !MILITARY_PROFS.has(a.profession)) {
      const desperation = hungerUrgency * 25 + (poor ? 12 : 0) + a.memory.daysHungry * 5;
      const banditScore = desperation + a.traits.greed * 15 + a.traits.riskTolerance * 15 - a.traits.loyalty * 35 - 48;
      if (banditScore > 0) options.push({ act: 'bandit', score: banditScore });
    }
    // โจรอยู่ค่าย: ปล้นตาม BanditSystem (หน่วย) — โจรเดี่ยวขโมยเล็กน้อย
    if (a.profession === 'bandit' && s.type !== 'camp') {
      options.push({ act: 'returnCamp', score: 30 });
    }

    // ซื้อเครื่องมือถ้าเป็นคนงานและไม่มี
    if (WORKER_PROFS.includes(a.profession) && a.profession !== 'crafter' && a.inventory.tools <= 0 &&
        s.stock.tools >= 1 && a.money > s.prices.tools) {
      options.push({ act: 'buyTools', score: 30 });
    }

    if (options.length === 0) options.push({ act: 'rest', score: 5 });

    // ── เลือกตัวเลือกคะแนนสูงสุด (สุ่มเล็กน้อยให้โลกไม่แข็งทื่อ) ──
    for (const o of options) o.score += rand(-4, 4);
    options.sort((x, y) => y.score - x.score);
    const choice = options[0];
    this.execute(a, s, choice);
  },

  execute(a, s, choice) {
    switch (choice.act) {
      case 'rest':
        a.currentGoal = 'พักผ่อน';
        a.currentThought = a.stats.energy < 25 ? 'ข้าเหนื่อยเหลือเกิน ขอพักก่อน' : 'วันนี้ขอพักสักหน่อย';
        a.stats.energy = clamp(a.stats.energy + 25, 0, 100);
        break;
      case 'work':
        if (a.profession !== choice.prof && !MILITARY_PROFS.has(a.profession)) {
          if (a.profession !== 'unemployed' && chance(0.5)) {
            EventSystem.add('life', `👤 ${a.name} เปลี่ยนอาชีพจาก ${a.profession} เป็น ${choice.prof} ที่${s.name}`);
          }
          a.profession = choice.prof;
        }
        WorkSystem.work(a, s);
        break;
      case 'trade':
        a.profession = 'trader';
        TraderSystem.planTrade(a, s);
        break;
      case 'migrate': {
        a.profession = a.profession === 'unemployed' ? 'migrant' : a.profession;
        a.currentGoal = `ย้ายไป${choice.targetName}`;
        a.currentThought = `${s.name}อยู่ยาก อาหารแพง ข้าจะไป${choice.targetName}`;
        buyProvisions(a, s, 4);
        if (startTravel(a, choice.target, 'migrate', a.traits.bravery < 0.4)) {
          if (chance(0.25)) EventSystem.add('life', `🚶 ${a.name} ย้ายออกจาก${s.name} มุ่งหน้า${choice.targetName}`);
        }
        break;
      }
      case 'bandit': {
        a.profession = 'bandit';
        a.factionId = world.factions.find(f => f.isBandit)?.id || a.factionId;
        const camp = world.settlements.find(x => x.type === 'camp');
        // ขโมยเสบียงจากคลังเมืองก่อนหนี — ของจริงหาย crime เพิ่ม
        const stolen = Math.min(5, Math.floor(s.stock.food));
        s.stock.food -= stolen;
        a.inventory.food += stolen;
        s.crime = clamp(s.crime + 4, 0, 100);
        a.currentGoal = 'เข้าร่วมค่ายโจร';
        a.currentThought = 'ข้าหมดหนทางแล้ว... เป็นโจรยังดีกว่าอดตาย';
        EventSystem.add('bandit', `🗡 ${a.name} สิ้นหวัง ขโมยเสบียงจาก${s.name}แล้วหนีไปเข้าค่ายโจร`);
        if (camp) startTravel(a, camp.id, 'bandit');
        break;
      }
      case 'returnCamp': {
        const camp = world.settlements.find(x => x.type === 'camp' && x.factionId === a.factionId) ||
                     world.settlements.find(x => x.type === 'camp');
        if (camp) startTravel(a, camp.id, 'bandit');
        break;
      }
      case 'buyTools': {
        const got = EconomySystem.buyFromSettlement(a, s, 'tools', 1);
        if (got > 0) {
          a.inventory.tools += got;
          a.durability.tools = 50;
          a.currentThought = 'ได้เครื่องมือใหม่ ทำงานได้ไวขึ้นแน่';
        }
        break;
      }
    }
  },

  bestMigrationTarget(a, from) {
    let best = null, bestScore = -Infinity;
    for (const s of marketSettlements()) {
      if (s.id === from.id || s.siege) continue;
      const path = findPath(from.id, s.id);
      if (!path) continue;
      // เมืองแน่นเกินศักยภาพ → ไม่น่าไป
      const capacity = (s.prodPotential.food + s.prodPotential.wood + s.prodPotential.ore) * 8 + (s.type === 'town' ? 15 : s.type === 'castle' ? 12 : 5);
      const congestion = Math.max(0, populationOf(s) - capacity) * 1.5;
      const score = -(s.prices.food / BASE_PRICE.food) * 15 - s.unrest * 0.2 - s.crime * 0.25
        + s.prosperity * 0.2 + (s.prodPotential.food + s.prodPotential.wood + s.prodPotential.ore) * 4
        - path.length * 5 - congestion;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  },

  soldierThought(a) {
    const u = getUnit(a.unitId);
    if (!u) { a.unitId = null; return; }
    if (u.supply.food < unitMembers(u).length) a.currentThought = 'เสบียงหน่วยใกล้หมด... ข้าเริ่มไม่แน่ใจ';
    else if (u.objective.type === 'raid' || u.objective.type === 'attack') a.currentThought = 'ศึกกำลังจะมาถึง ขอให้ข้ารอด';
    else a.currentThought = 'รับใช้หน่วยไปวันๆ อย่างน้อยก็มีข้าวกิน';
  }
};

/* ═══════════════════ 10. WORK SYSTEM ═══════════════════ */

const WorkSystem = {
  work(a, s) {
    if (a.stats.energy < 10) { a.currentThought = 'หมดแรง ทำงานไม่ไหว'; return; }
    a.stats.energy -= 18;
    const hungerPenalty = a.stats.hunger < 30 ? 0.5 : a.stats.hunger < 55 ? 0.8 : 1;
    const toolBonus = (a.inventory.tools > 0 && a.durability.tools > 0) ? 1.5 : 1;

    let good = null, amount = 0, skill = null;
    switch (a.profession) {
      case 'farmer':
        skill = 'farming';
        amount = s.prodPotential.food * (1 + a.skills.farming * 0.15) * toolBonus * hungerPenalty * EconomySystem.crowding(s, 'farmer');
        if (s.drought > 0) amount *= 0.3;
        good = 'food';
        break;
      case 'woodcutter':
        skill = 'woodcutting';
        amount = s.prodPotential.wood * (1 + a.skills.woodcutting * 0.15) * toolBonus * hungerPenalty * EconomySystem.crowding(s, 'woodcutter');
        good = 'wood';
        break;
      case 'miner':
        skill = 'mining';
        amount = s.prodPotential.ore * (1 + a.skills.mining * 0.15) * toolBonus * hungerPenalty * EconomySystem.crowding(s, 'miner');
        good = 'ore';
        break;
      case 'crafter': {
        skill = 'crafting';
        // ใช้วัตถุดิบจริง: 1 wood + 1 ore → tools หรือ weapons (ตาม demand)
        if (s.stock.wood >= 1 && s.stock.ore >= 1) {
          s.stock.wood -= 1; s.stock.ore -= 1;
          const makeWeapon = (s.warDemand > 0 || s.prices.weapons / BASE_PRICE.weapons > s.prices.tools / BASE_PRICE.tools) &&
                             s.buildings.includes('Blacksmith') || s.warDemand > 2;
          good = makeWeapon ? 'weapons' : 'tools';
          amount = (0.5 + a.skills.crafting * 0.1) * hungerPenalty * (s.buildings.includes('Blacksmith') ? 1.5 : 1);
        } else {
          a.currentThought = 'ไม่มีไม้กับแร่ให้ผลิต... ต้องรอพ่อค้าขนมา';
          return;
        }
        break;
      }
      default:
        return;
    }

    if (good && amount > 0) {
      // ชาวนาได้ส่วนแบ่งผลผลิตเป็นอาหารติดตัว (ค่าแรงในรูปสิ่งของ)
      if (good === 'food') {
        const share = Math.min(amount * 0.3, 1.5);
        a.inventory.food += share;
        amount -= share;
      }
      // ผลผลิตเข้าคลังเมือง คนงานได้ค่าแรงจากคลังเมือง
      s.stock[good] += amount;
      const wage = Math.min(amount * s.prices[good] * 0.45, s.treasury);
      a.money += wage;
      s.treasury -= wage;
      a.skills[skill] = Math.min(10, a.skills[skill] + 0.035);
      a.currentGoal = `ทำงาน (${a.profession})`;
      a.currentThought = wage > 1
        ? `ทำงานได้ ${good} ${fmt(amount, 1)} หน่วย ได้ค่าแรง ${fmt(wage)} ทอง`
        : `เมืองไม่มีเงินจ่ายค่าแรง... แบบนี้อยู่ไม่ได้`;
      if (wage < 0.5) a.stats.morale -= 3;

      // เครื่องมือเสื่อม → สร้าง demand ให้เศรษฐกิจ
      if (toolBonus > 1) {
        a.durability.tools -= 1;
        if (a.durability.tools <= 0) {
          a.inventory.tools = 0;
          a.currentThought = 'เครื่องมือข้าพังแล้ว ต้องซื้อใหม่';
        }
      }
    }
  }
};

/* ═══════════════════ 11. TRADER SYSTEM ═══════════════════ */

const TraderSystem = {
  planTrade(a, s) {
    if (a.cargo) return; // มีสินค้าค้างอยู่ระหว่างทางแล้ว
    let best = null, bestProfit = 12; // ต้องคุ้มขั้นต่ำ

    for (const g of GOODS) {
      const buyPrice = s.prices[g];
      const avail = Math.floor(s.stock[g]);
      if (avail < 2) continue;
      const capacity = 8 + (a.inventory.cart > 0 ? 14 : 0) + (a.inventory.horse > 0 ? 4 : 0);
      const qty = Math.min(avail, capacity, Math.floor(a.money / buyPrice));
      if (qty < 2) continue;

      for (const d of marketSettlements()) {
        if (d.id === s.id || d.siege) continue;
        const path = findPath(s.id, d.id, a.traits.riskTolerance < 0.35);
        if (!path) continue;
        const sellPrice = d.prices[g];
        // ความเสี่ยงตามเส้นทาง
        let risk = 0;
        for (let i = 0; i < path.length - 1; i++) {
          const r = getRoute(path[i], path[i + 1]);
          if (r) risk += r.danger;
        }
        const travelCost = path.length * 3;
        const expected = (sellPrice * 0.85 * (1 - d.taxRate) - buyPrice) * qty
          - travelCost
          - risk * qty * buyPrice * (1.2 - a.traits.riskTolerance);
        if (expected > bestProfit) { bestProfit = expected; best = { good: g, qty, destId: d.id, destName: d.name, buyPrice }; }
      }
    }

    if (best) {
      buyProvisions(a, s, 5);
      const bought = EconomySystem.buyFromSettlement(a, s, best.good, best.qty);
      if (bought > 0) {
        a.cargo = { good: best.good, qty: bought, buyCost: best.buyPrice * bought, destId: best.destId };
        a.currentGoal = `ขน${best.good}ไปขายที่${best.destName}`;
        a.currentThought = `${best.good}ที่${best.destName}ราคาดี คาดกำไร ~${fmt(bestProfit)} ทอง`;
        startTravel(a, best.destId, 'trade', a.traits.riskTolerance < 0.35);
        if (best.good === 'food' && bought >= 6 && chance(0.4)) {
          EventSystem.add('trade', `🐪 พ่อค้า ${a.name} ขนอาหาร ${bought} หน่วยจาก${s.name}ไป${best.destName}`);
        }
      }
    } else {
      a.currentGoal = 'รอโอกาสค้าขาย';
      a.currentThought = 'ยังไม่มีเส้นทางไหนคุ้มค่าพอ รอราคาขยับก่อน';
    }
  },

  onArrive(a) {
    const s = getSettlement(a.locationId);
    if (!a.cargo || !s) return;
    if (s.id !== a.cargo.destId && s.type !== 'camp') {
      // แวะกลางทาง — ขายเลยถ้าราคาดีพอ ไม่งั้นเติมเสบียงแล้วเดินต่อ
      if (s.prices[a.cargo.good] * 0.85 > (a.cargo.buyCost / a.cargo.qty) * 1.3) { /* ขายที่นี่เลย */ }
      else { buyProvisions(a, s, 4); startTravel(a, a.cargo.destId, 'trade'); return; }
    }
    const sold = EconomySystem.sellToSettlement(a, s, a.cargo.good, a.cargo.qty);
    if (sold > 0) {
      const revenue = sold * s.prices[a.cargo.good] * 0.85 * (1 - s.taxRate);
      const profit = revenue - a.cargo.buyCost * (sold / a.cargo.qty);
      a.skills.trading = Math.min(10, a.skills.trading + 0.06);
      a.stats.morale = clamp(a.stats.morale + (profit > 0 ? 4 : -4), 0, 100);
      a.currentThought = profit > 0 ? `ขายได้กำไร ${fmt(profit)} ทอง — การค้าคือชีวิต` : `ขาดทุน ${fmt(-profit)} ทอง... คำนวณพลาด`;
      a.cargo.qty -= sold;
    }
    if (a.cargo.qty <= 0) a.cargo = null;
    else if (sold === 0) {
      // เมืองไม่มีเงินซื้อ — เก็บของไว้ ลองเมืองอื่น
      const alt = marketSettlements().filter(x => x.id !== s.id && x.treasury > 100);
      if (alt.length) { buyProvisions(a, s, 4); a.cargo.destId = pick(alt).id; startTravel(a, a.cargo.destId, 'trade'); }
    }
  }
};

/* ═══════════════════ 12. BANDIT SYSTEM ═══════════════════ */

const BanditSystem = {
  update() {
    for (const camp of world.settlements.filter(s => s.type === 'camp')) {
      const banditsHere = agentsAt(camp.id).filter(a => a.profession === 'bandit' && !a.unitId);
      // ── ตั้ง warband ใหม่เมื่อมีโจรว่างพอ ──
      if (banditsHere.length >= 2 && chance(0.5)) {
        const leader = banditsHere.reduce((m, b) => (b.skills.leadership + b.skills.fighting > m.skills.leadership + m.skills.fighting ? b : m), banditsHere[0]);
        const members = banditsHere.slice(0, Math.min(banditsHere.length, 3 + Math.floor(leader.skills.leadership * 1.5)));
        const u = createUnit({
          name: `กองโจรของ${leader.name.split(' ')[0]}`, kind: 'warband',
          leaderId: leader.id, memberIds: members.map(m => m.id),
          factionId: camp.factionId, locationId: camp.id, food: Math.min(20, camp.stock.food)
        });
        camp.stock.food = Math.max(0, camp.stock.food - u.supply.food);
        this.pickTarget(u, camp);
      }
    }

    // ── warband ที่มีอยู่ทำภารกิจ ──
    for (const u of world.units.filter(u => u.kind === 'warband')) {
      if (unitMembers(u).length === 0) continue;
      if (u.travel) continue;
      const camp = world.settlements.find(s => s.type === 'camp' && s.factionId === u.factionId) ||
                   world.settlements.find(s => s.type === 'camp');

      if (u.objective.type === 'ambush' && u.locationId === u.objective.atId) {
        // ดักปล้นอยู่ — ปล้นคาราวานที่ผ่านเส้นทางติดกับจุดนี้ (จัดการใน interceptCaravans)
        u.objective.daysWaiting = (u.objective.daysWaiting || 0) + 1;
        const r = world.routes.find(x => x.id === u.objective.routeId);
        if (r) r.danger = clamp(r.danger + 0.02, 0, 1);
        if (u.objective.daysWaiting > 6 || u.supply.food < unitMembers(u).length) {
          u.objective = { type: 'return' };
          if (camp) { u.travel = null; startTravel(u, camp.id, 'return'); }
        }
      } else if (u.objective.type === 'raid' && u.locationId === u.objective.targetId) {
        MilitarySystem.resolveRaid(u, getSettlement(u.objective.targetId));
        u.objective = { type: 'return' };
        if (camp) startTravel(u, camp.id, 'return');
      } else if (u.objective.type === 'return' || u.objective.type === 'idle') {
        if (camp && u.locationId === camp.id) {
          // ถึงค่าย — ฝาก loot แล้วสลายหรือออกปล้นรอบใหม่
          this.depositLoot(u, camp);
          if (chance(0.3) || u.morale < 35) this.disband(u);
          else this.pickTarget(u, camp);
        } else if (camp) startTravel(u, camp.id, 'return');
      }
    }
  },

  pickTarget(u, camp) {
    const members = unitMembers(u);
    const power = MilitarySystem.unitPower(u);
    let best = null, bestScore = 3;

    // ตัวเลือก 1: ดักปล้นเส้นทางที่คาราวานพลุกพล่าน ยามน้อย
    for (const r of world.routes) {
      if (r.destroyed) continue;
      const score = r.traffic * 4 - r.patrolLevel * 8 + r.danger * 5;
      if (score > bestScore) { bestScore = score; best = { type: 'ambush', routeId: r.id, atId: chance(0.5) ? r.a : r.b }; }
    }
    // ตัวเลือก 2: ปล้นหมู่บ้านที่ป้องกันอ่อน
    for (const s of world.settlements) {
      if (s.type === 'camp' || s.factionId === u.factionId) continue;
      const garrisonPower = s.garrisonUnitId ? MilitarySystem.unitPower(getUnit(s.garrisonUnitId)) : 0;
      const wallMod = s.buildings.includes('Wall') ? 2 : 1;
      const lootValue = s.stock.food * 0.5 + s.treasury * 0.1 + s.stock.weapons * 2;
      const score = lootValue / 8 - (garrisonPower * wallMod) / Math.max(power, 1) * 20 - (s.type !== 'village' ? 15 : 0);
      if (score > bestScore) { bestScore = score; best = { type: 'raid', targetId: s.id }; }
    }

    if (best) {
      u.objective = best;
      const destId = best.type === 'ambush' ? best.atId : best.targetId;
      startTravel(u, destId, best.type);
      const leader = getAgent(u.leaderId);
      if (best.type === 'raid' && chance(0.6)) {
        EventSystem.add('bandit', `🗡 ${u.name} (${members.length} คน) ออกจากค่าย มุ่งปล้น${getSettlement(best.targetId).name}`);
      }
      if (leader) leader.currentThought = best.type === 'ambush' ? 'เส้นทางนั้นคาราวานเพียบ ยามก็ไม่มี... ได้การละ' : 'หมู่บ้านนั้นอ่อนแอ คลังก็อู้ฟู่';
    } else {
      u.objective = { type: 'idle' };
    }
  },

  // ตรวจว่าคาราวาน (พ่อค้าเดินทาง) โดนดักปล้นไหม — เรียกตอนพ่อค้าเคลื่อนที่
  interceptCaravan(trader) {
    if (!trader.travel || !trader.cargo) return false;
    const t = trader.travel;
    const aId = t.path[t.seg], bId = t.path[t.seg + 1];
    const r = getRoute(aId, bId);
    if (!r) return false;

    // 1) โดน warband ที่ดักเส้นทางนี้อยู่
    const ambusher = world.units.find(u => u.kind === 'warband' && !u.travel &&
      u.objective.type === 'ambush' && u.objective.routeId === r.id && unitMembers(u).length > 0);
    // 2) หรือความเสี่ยงทั่วไปของเส้นทาง
    const guardsPower = trader.inventory.weapon > 0 ? 6 : 0;
    const baseRisk = clamp(r.danger - r.patrolLevel * 0.06, 0.01, 0.9);

    if (ambusher || chance(baseRisk * 0.22)) {
      const robbers = ambusher ? unitMembers(ambusher).length : randInt(2, 4);
      const stolenQty = trader.cargo.qty;
      const stolenGold = Math.floor(trader.money * rand(0.4, 0.8));
      // ยาม/อาวุธพ่อค้าอาจสู้รอด
      if (guardsPower > 0 && chance(0.3)) {
        EventSystem.add('bandit', `⚔ พ่อค้า ${trader.name} สู้กับโจรบนเส้นทางและรอดมาได้!`);
        trader.skills.fighting += 0.1;
        return false;
      }
      trader.money -= stolenGold;
      const good = trader.cargo.good;
      trader.cargo = null;
      trader.stats.morale -= 15;
      trader.stats.health -= randInt(0, 25);
      trader.currentThought = 'โดนปล้นเรียบ... ข้าเกลียดเส้นทางนี้';
      world.stats.caravansRobbed++;
      r.danger = clamp(r.danger + 0.08, 0, 1);
      if (ambusher) {
        ambusher.supply.food += good === 'food' ? stolenQty : 0;
        ambusher.lootGold = (ambusher.lootGold || 0) + stolenGold;
        ambusher.lootGoods = ambusher.lootGoods || newStock();
        ambusher.lootGoods[good] += good === 'food' ? 0 : stolenQty;
        ambusher.morale = clamp(ambusher.morale + 8, 0, 100);
        for (const m of unitMembers(ambusher)) { m.skills.fighting += 0.05; m.memory.raidsDone++; }
      }
      EventSystem.add('bandit', `🔥 คาราวานของ ${trader.name} ถูกปล้นกลางทาง! เสีย ${good} ${stolenQty} หน่วยและทอง ${stolenGold}`);
      if (trader.stats.health <= 0) NeedSystem.kill(trader, 'ถูกโจรฆ่าตาย');
      return true;
    }
    return false;
  },

  depositLoot(u, camp) {
    if (u.lootGold) {
      camp.treasury += u.lootGold * 0.5;
      const members = unitMembers(u);
      const share = (u.lootGold * 0.5) / Math.max(members.length, 1);
      for (const m of members) m.money += share;
      u.lootGold = 0;
    }
    if (u.lootGoods) {
      for (const g of GOODS) { camp.stock[g] += u.lootGoods[g] || 0; }
      u.lootGoods = null;
    }
    camp.stock.food += Math.max(0, u.supply.food - 10);
    u.supply.food = Math.min(u.supply.food, 10);
  },

  disband(u) {
    for (const m of unitMembers(u)) m.unitId = null;
    world.units = world.units.filter(x => x.id !== u.id);
  }
};

/* ═══════════════════ 13. MILITARY SYSTEM ═══════════════════ */

const MilitarySystem = {
  /* ── พลังรบของหน่วย (สูตรตาม GDD 14.1 แบบย่อ) ── */
  unitPower(u) {
    if (!u) return 0;
    const members = unitMembers(u);
    if (members.length === 0) return 0;
    let power = 0;
    for (const m of members) {
      const combat = 8 + (m.skills.fighting + m.skills.sword + m.skills.archery * 0.8 + m.skills.spear + m.skills.riding * 0.6) * 1.6;
      const equip = (m.inventory.weapon > 0 ? 1.35 : 1) * (m.inventory.bow > 0 ? 1.15 : 1) * (m.inventory.horse > 0 ? 1.25 : 1);
      power += combat * equip * (0.5 + m.stats.morale / 150) * (0.6 + m.stats.health / 250);
    }
    const leader = getAgent(u.leaderId);
    const tacticsMod = leader ? 1 + leader.skills.tactics * 0.05 : 1;
    const moraleMod = 0.6 + u.morale / 160;
    const fatigueMod = 1 - u.fatigue / 250;
    const supplyMod = u.supply.food >= members.length ? 1 : 0.7;
    return power * tacticsMod * moraleMod * fatigueMod * supplyMod;
  },

  armyPower(ar) {
    let p = 0;
    for (const uId of ar.unitIds) p += this.unitPower(getUnit(uId));
    return p * (0.7 + ar.morale / 200);
  },

  /* ── command capacity (GDD 13.2) ── */
  commandCapacity(a) {
    return Math.floor(3 + a.skills.leadership * 1.5 + a.skills.tactics * 0.5 + a.reputation * 0.08);
  },

  /* ── การรบ: attackerPower vs defenderPower ── */
  battle(attackerUnits, defenderUnits, context) {
    world.stats.battles++;
    const atkPower = sum(attackerUnits, u => this.unitPower(u)) * rand(0.8, 1.2);
    const defPower = (sum(defenderUnits, u => this.unitPower(u)) + (context.defenseBonus || 0)) * rand(0.8, 1.2);
    const attackerWins = atkPower > defPower;
    const ratio = clamp(Math.min(atkPower, defPower) / Math.max(atkPower, defPower, 1), 0.1, 1);

    const applyCasualties = (units, lossRate, won) => {
      let dead = 0, fled = 0;
      for (const u of units) {
        const members = unitMembers(u);
        for (const m of members) {
          if (chance(lossRate)) {
            if (chance(0.65)) { NeedSystem.kill(m, 'ตายในสนามรบ'); dead++; }
            else { // หนีทัพ
              m.unitId = null;
              u.memberIds = u.memberIds.filter(id => id !== m.id);
              m.profession = 'refugee';
              m.stats.morale = 20;
              fled++;
            }
          } else {
            m.memory.survivedBattles++;
            if (won) { m.memory.battlesWon++; m.skills.fighting = Math.min(10, m.skills.fighting + 0.15); m.stats.morale = clamp(m.stats.morale + 6, 0, 100); }
            else { m.memory.battlesLost++; m.stats.morale = clamp(m.stats.morale - 10, 0, 100); }
          }
        }
        u.morale = clamp(u.morale + (won ? 10 : -18), 5, 100);
        u.fatigue = clamp(u.fatigue + 25, 0, 100);
        u.battleHistory.push({ day: world.day, won, vs: context.label });
        const leader = getAgent(u.leaderId);
        if (leader && leader.alive && won) {
          leader.skills.tactics = Math.min(10, leader.skills.tactics + 0.2);
          leader.skills.leadership = Math.min(10, leader.skills.leadership + 0.12);
          leader.reputation += 4;
          this.checkPromotion(leader);
        }
      }
      return { dead, fled };
    };

    const loserRate = 0.25 + (1 - ratio) * 0.2;
    const winnerRate = 0.08 + ratio * 0.1;
    const atkResult = applyCasualties(attackerUnits, attackerWins ? winnerRate : loserRate, attackerWins);
    const defResult = applyCasualties(defenderUnits, attackerWins ? loserRate : winnerRate, !attackerWins);

    return { attackerWins, atkPower, defPower, atkResult, defResult };
  },

  checkPromotion(a) {
    if (a.rank === 'commoner' && a.memory.battlesWon >= 2 && a.skills.leadership >= 2) {
      a.rank = 'veteran';
    } else if (a.rank === 'veteran' && a.memory.battlesWon >= 4 && a.skills.leadership >= 3.5) {
      a.rank = 'captain'; a.profession = MILITARY_PROFS.has(a.profession) ? 'captain' : a.profession;
      EventSystem.add('war', `⭐ ${a.name} ได้เลื่อนขั้นเป็นนายกอง (captain) หลังชนะศึก ${a.memory.battlesWon} ครั้ง`);
    } else if (a.rank === 'captain' && a.memory.battlesWon >= 7 && a.skills.leadership >= 5) {
      a.rank = 'commander'; a.profession = 'commander';
      EventSystem.add('war', `⭐⭐ ${a.name} ได้เลื่อนขั้นเป็นแม่ทัพ (commander) ชื่อเสียงเลื่องลือ`);
    }
  },

  /* ── โจร/กบฏปล้นถิ่นฐาน ── */
  resolveRaid(u, s) {
    if (!s) return;
    world.stats.raids++;
    const garrison = s.garrisonUnitId ? getUnit(s.garrisonUnitId) : null;
    const defUnits = garrison ? [garrison] : [];
    const defenseBonus = (s.buildings.includes('Wall') ? 40 : 0) + (s.buildings.includes('Watchtower') ? 15 : 0) + s.security * 0.4;
    const result = this.battle([u], defUnits, { defenseBonus, label: s.name });

    if (result.attackerWins) {
      // ปล้นของจริงจากคลัง
      const stolenFood = Math.min(s.stock.food, randInt(15, 40));
      const stolenGold = Math.min(s.treasury, randInt(30, 120));
      const stolenWeapons = Math.min(s.stock.weapons, randInt(0, 4));
      s.stock.food -= stolenFood; s.treasury -= stolenGold; s.stock.weapons -= stolenWeapons;
      u.supply.food += stolenFood;
      u.lootGold = (u.lootGold || 0) + stolenGold;
      u.lootGoods = u.lootGoods || newStock();
      u.lootGoods.weapons += stolenWeapons;
      s.raidedRecently = 5;
      s.prosperity = clamp(s.prosperity - 8, 0, 100);
      s.loyalty = clamp(s.loyalty - 6, 0, 100);
      s.security = clamp(s.security - 10, 0, 100);
      s.unrest = clamp(s.unrest + 8, 0, 100);
      for (const m of unitMembers(u)) m.memory.raidsDone++;
      EventSystem.add('bandit', `🔥 ${u.name} ปล้น${s.name}สำเร็จ! ได้อาหาร ${stolenFood} ทอง ${stolenGold} — ชาวบ้านหวาดกลัว`);
      s.history.push(`Day ${world.day}: ถูก${u.name}ปล้น`);
    } else {
      EventSystem.add('war', `🛡 ${s.name} ป้องกันการปล้นของ${u.name}ได้ (ตาย ${result.atkResult.dead + result.defResult.dead} คน)`);
      s.security = clamp(s.security + 5, 0, 100);
      u.morale -= 15;
    }
  },

  /* ── กองทัพโจมตีเพื่อยึดครอง ── */
  resolveCapture(attUnits, attFaction, commander, s) {
    const garrison = s.garrisonUnitId ? getUnit(s.garrisonUnitId) : null;
    const defUnits = garrison ? [garrison] : [];
    const defenseBonus = (s.buildings.includes('Wall') ? 60 : 0) + s.security * 0.5 +
      (s.type === 'fort' ? 50 : s.type === 'castle' ? 90 : 0);
    // เมือง unrest สูง loyalty ต่ำ อาจเปิดประตู
    const gatesOpen = s.unrest > 65 && s.loyalty < 30 && chance(0.5);
    const result = gatesOpen ? { attackerWins: true, atkResult: { dead: 0 }, defResult: { dead: 0 } }
      : this.battle(attUnits, defUnits, { defenseBonus, label: s.name });

    if (result.attackerWins) {
      const oldFaction = getFaction(s.factionId);
      s.factionId = attFaction.id;
      s.ownerId = attFaction.rulerId || commander.id;
      s.governorId = commander.id;
      commander.gov = commander.gov || makeGovAttrs();
      s.loyalty = 30; s.unrest = clamp(s.unrest + 10, 0, 100);
      s.lastCapturedDay = world.day;
      // ปล้นคลังบางส่วน
      const lootGold = Math.floor(s.treasury * 0.4);
      s.treasury -= lootGold;
      attFaction.treasury += lootGold;
      // garrison เดิมสลาย
      if (garrison) {
        for (const m of unitMembers(garrison)) { m.unitId = null; m.profession = 'unemployed'; }
        world.units = world.units.filter(x => x.id !== garrison.id);
        s.garrisonUnitId = null;
      }
      if (gatesOpen) EventSystem.add('war', `🏳 ประชาชน${s.name}เปิดประตูเมืองให้${attFaction.name} — เมืองเปลี่ยนมือโดยไม่เสียเลือด`);
      else EventSystem.add('war', `⚔ ${attFaction.name} ยึด${s.name}ได้! ${commander.name} ขึ้นปกครอง (ปล้นคลัง ${lootGold} ทอง)`);
      s.history.push(`Day ${world.day}: ถูก${attFaction.name}ยึดครอง`);
      // ผู้ยึดกลายเป็น lord ถ้ายังไม่ใช่
      if (!RULER_PROFS.has(commander.profession)) {
        commander.profession = 'lord'; commander.rank = 'lord';
        EventSystem.add('politics', `👑 ${commander.name} สถาปนาตนเป็นเจ้าเมือง${s.name}`);
      }
      if (oldFaction && !oldFaction.isBandit) checkFactionCollapse(oldFaction);
      return true;
    } else {
      EventSystem.add('war', `🛡 ${s.name} ต้านการบุกของ${attFaction.name}ไว้ได้ (ตายรวม ${result.atkResult.dead + result.defResult.dead})`);
      return false;
    }
  },

  /* ── garrison / recruitment / หน่วยรายวัน ── */
  updateUnits() {
    for (const u of world.units.slice()) {
      const members = unitMembers(u);
      if (members.length === 0) {
        if (u.kind === 'guard') { const s = world.settlements.find(x => x.garrisonUnitId === u.id); if (s) s.garrisonUnitId = null; }
        world.units = world.units.filter(x => x.id !== u.id);
        continue;
      }
      // เดินทาง
      if (u.travel) {
        const arrived = advanceTravel(u, 65);
        u.fatigue = clamp(u.fatigue + 6, 0, 100);
        for (const m of members) { m.locationId = u.locationId; m.travel = null; }
        if (!arrived) { for (const m of members) m.travel = u.travel; }
        else { for (const m of members) m.travel = null; }
      } else {
        u.fatigue = clamp(u.fatigue - 8, 0, 100);
      }

      // กินเสบียงหน่วย
      const need = members.length;
      if (u.supply.food >= need) {
        u.supply.food -= need;
        for (const m of members) m.stats.hunger = clamp(m.stats.hunger + 20, 0, 100);
      } else {
        u.morale = clamp(u.morale - 6, 0, 100);
        // ทหารหิว — อาจหนีทัพ
        for (const m of members) {
          if (m.stats.hunger < 20 && chance(0.15 + (1 - m.traits.discipline) * 0.2)) {
            m.unitId = null;
            u.memberIds = u.memberIds.filter(id => id !== m.id);
            m.profession = 'unemployed';
            m.currentThought = 'ไม่มีข้าวกิน ไม่มีเงินเดือน... ข้าขอลาก่อน';
            if (chance(0.4)) EventSystem.add('war', `🏃 ทหาร ${m.name} หนีทัพจาก${u.name}เพราะอดอยาก`);
          }
        }
      }

      // command capacity เกิน → cohesion/morale ตก
      const leader = getAgent(u.leaderId);
      if (leader && leader.alive) {
        const cap = this.commandCapacity(leader);
        if (members.length > cap) { u.cohesion = clamp(u.cohesion - 4, 0, 100); u.morale = clamp(u.morale - 2, 0, 100); }
        else u.cohesion = clamp(u.cohesion + 2, 0, 100);
      } else if (members.length > 0) {
        // ผู้นำตาย — เลือกผู้นำใหม่
        const newLeader = members.reduce((m, x) => x.skills.leadership > m.skills.leadership ? x : m, members[0]);
        u.leaderId = newLeader.id;
      }
    }
  },

  // ผู้นำที่มี leadership สูงและอิสระ อาจตั้งหน่วยรบอิสระ (เส้นทางขุนศึก)
  freeCompanyCheck() {
    // ยิ่งโจรชุกยิ่งมีคนลุกขึ้นมาตั้งกองปราบ
    const banditCount = world.agents.filter(a => a.alive && a.profession === 'bandit').length;
    if (!chance(0.06 + Math.min(banditCount * 0.006, 0.2))) return;
    const candidates = world.agents.filter(a => a.alive && !a.unitId && !a.travel &&
      a.skills.leadership >= 3 && MILITARY_PROFS.has(a.profession) && !RULER_PROFS.has(a.profession) &&
      a.traits.ambition > 0.6);
    if (!candidates.length) return;
    const leader = pick(candidates);
    const s = getSettlement(leader.locationId);
    if (!s || s.type === 'camp') return;
    const recruits = this.recruit(leader, s, Math.min(5, this.commandCapacity(leader)));
    if (recruits.length >= 2) {
      const u = createUnit({
        name: `กองอิสระของ${leader.name.split(' ')[0]}`, kind: 'field',
        leaderId: leader.id, memberIds: [leader.id, ...recruits.map(r => r.id)],
        factionId: leader.factionId, locationId: s.id, food: 25
      });
      leader.unitId = u.id;
      u.objective = { type: 'huntBandits' };
      EventSystem.add('war', `⚔ ${leader.name} รวบรวมคน ${recruits.length + 1} คนตั้ง${u.name} ออกปราบโจร`);
    }
  },

  /* ── recruitment ตาม GDD 13.5 — ชวนคนจน หิว กล้า เข้าหน่วย ── */
  recruit(leader, s, maxCount) {
    const recruits = [];
    const candidates = agentsAt(s.id).filter(a =>
      a.id !== leader.id && !a.unitId && !RULER_PROFS.has(a.profession) && a.profession !== 'trader');
    for (const c of candidates) {
      if (recruits.length >= maxCount) break;
      const desperation = (100 - c.stats.hunger) * 0.3 + (c.money < 20 ? 20 : 0);
      const willingness = desperation + c.traits.bravery * 25 + leader.reputation * 0.5
        - c.traits.riskTolerance * -10 - (WORKER_PROFS.includes(c.profession) ? 15 : 0);
      if (willingness > 35 && chance(0.6)) {
        recruits.push(c);
        c.profession = MILITARY_PROFS.has(c.profession) ? c.profession : 'militia';
        c.currentThought = `${leader.name}เสนออาหารและค่าจ้าง... ดีกว่าอดตาย ข้าจะตามไป`;
      }
    }
    return recruits;
  },

  // หน่วยอิสระ (field) ล่าโจร
  updateFieldUnits() {
    for (const u of world.units.filter(u => u.kind === 'field' && !u.travel)) {
      const members = unitMembers(u);
      if (!members.length) continue;
      if (u.objective.type === 'huntBandits') {
        // หา warband ที่ไม่เดินทางอยู่ หรือบุกค่ายโจร
        const target = world.units.find(w => w.kind === 'warband' && !w.travel && w.locationId === u.locationId && unitMembers(w).length > 0);
        if (target) {
          const result = this.battle([u], [target], { label: target.name });
          if (result.attackerWins) {
            EventSystem.add('war', `⚔ ${u.name} ปราบ${target.name}สำเร็จ!`);
            const leader = getAgent(u.leaderId);
            if (leader) leader.reputation += 6;
            u.supply.food += target.supply.food; target.supply.food = 0;
          } else {
            EventSystem.add('bandit', `🗡 ${target.name} ตีโต้${u.name}แตกพ่าย`);
          }
        } else {
          const wb = world.units.filter(w => w.kind === 'warband' && unitMembers(w).length > 0 && !w.travel);
          if (wb.length && chance(0.5)) startTravel(u, pick(wb).locationId, 'hunt');
          else {
            const camp = world.settlements.find(x => x.type === 'camp');
            if (camp && chance(0.2) && this.unitPower(u) > 80) { u.objective = { type: 'raid', targetId: camp.id }; startTravel(u, camp.id, 'attackCamp'); }
            else if (chance(0.3)) { // เดินลาดตระเวน
              const routes = world.routes.filter(r => !r.destroyed && (r.a === u.locationId || r.b === u.locationId));
              if (routes.length) { const r = pick(routes); r.patrolLevel = clamp(r.patrolLevel + 1, 0, 5); r.danger = clamp(r.danger - 0.05, 0.02, 1); startTravel(u, r.a === u.locationId ? r.b : r.a, 'patrol'); }
            }
          }
        }
        // เสบียงหมด → กลับเมืองเติม / สลาย
        if (u.supply.food < members.length * 2) {
          const s = getSettlement(u.locationId);
          if (s && s.type !== 'camp') {
            const bought = Math.min(Math.floor(s.stock.food * 0.2), members.length * 6);
            const leader = getAgent(u.leaderId);
            if (leader && leader.money > bought * s.prices.food) {
              leader.money -= bought * s.prices.food; s.treasury += bought * s.prices.food;
              s.stock.food -= bought; u.supply.food += bought;
            } else if (u.morale < 40 || chance(0.3)) {
              BanditSystem.disband(u);
              EventSystem.add('war', `💨 ${u.name} สลายตัวเพราะขาดเสบียง`);
            }
          }
        }
      } else if (u.objective.type === 'raid' && u.locationId === u.objective.targetId) {
        const camp = getSettlement(u.objective.targetId);
        // โจมตีค่ายโจร: สู้กับโจรทุกคนในค่าย
        const defenders = world.units.filter(w => w.factionId === camp.factionId && w.locationId === camp.id);
        const looseBandits = agentsAt(camp.id).filter(a => a.profession === 'bandit' && !a.unitId);
        let tempUnit = null;
        if (looseBandits.length) {
          tempUnit = createUnit({ name: 'โจรป้องกันค่าย', kind: 'warband', leaderId: looseBandits[0].id, memberIds: looseBandits.map(b => b.id), factionId: camp.factionId, locationId: camp.id, food: 10 });
          defenders.push(tempUnit);
        }
        const result = this.battle([u], defenders, { defenseBonus: 15, label: camp.name });
        if (result.attackerWins) {
          EventSystem.add('war', `🔥 ${u.name} บุกทำลาย${camp.name}! โจรแตกกระเจิง`);
          camp.stock.food = Math.floor(camp.stock.food * 0.3);
          camp.treasury = Math.floor(camp.treasury * 0.2);
          const leader = getAgent(u.leaderId);
          if (leader) { leader.reputation += 12; this.checkPromotion(leader); }
        }
        if (tempUnit && world.units.includes(tempUnit)) BanditSystem.disband(tempUnit);
        u.objective = { type: 'huntBandits' };
      }
    }
  },

  /* ── กองทัพ (army) เดินทัพและทำสงคราม ── */
  updateArmies() {
    for (const ar of world.armies.slice()) {
      const units = ar.unitIds.map(getUnit).filter(u => u && unitMembers(u).length > 0);
      ar.unitIds = units.map(u => u.id);
      if (units.length === 0) { world.armies = world.armies.filter(x => x.id !== ar.id); continue; }

      // ซิงก์ตำแหน่งหน่วยกับกองทัพ
      if (ar.travel) {
        const arrived = advanceTravel(ar, 55);
        for (const u of units) { u.locationId = ar.locationId; u.travel = arrived ? null : ar.travel; for (const m of unitMembers(u)) { m.locationId = ar.locationId; m.travel = u.travel; } }
      }

      // เสบียงกองทัพ
      const totalMen = sum(units, u => unitMembers(u).length);
      const commander = getAgent(ar.commanderId);
      const logisticsMod = commander ? 1 - commander.skills.logistics * 0.04 : 1;
      const foodNeed = Math.ceil(totalMen * logisticsMod);
      if (ar.supply.food >= foodNeed) {
        ar.supply.food -= foodNeed;
        for (const u of units) { u.supply.food = Math.max(u.supply.food, 3); for (const m of unitMembers(u)) m.stats.hunger = clamp(m.stats.hunger + 20, 0, 100); }
        if (commander) commander.skills.logistics = Math.min(10, commander.skills.logistics + 0.01);
      } else {
        ar.morale = clamp(ar.morale - 5, 0, 100);
        for (const u of units) u.morale = clamp(u.morale - 4, 0, 100);
      }

      if (ar.travel) continue;

      // ถึงเป้าหมาย?
      if (ar.objective.type === 'attack' && ar.locationId === ar.objective.targetId) {
        const target = getSettlement(ar.objective.targetId);
        const faction = getFaction(ar.factionId);
        if (target && faction && target.factionId !== ar.factionId) {
          // ล้อมก่อนถ้าเมืองแข็ง
          if ((target.type === 'castle' || target.buildings.includes('Wall')) && !target.siege && chance(0.6)) {
            target.siege = { armyId: ar.id, days: 0 };
            EventSystem.add('war', `🏰 กองทัพ${faction.name}เริ่มล้อม${target.name} — เสบียงเข้าออกไม่ได้`);
            continue;
          }
          const captured = this.resolveCapture(units, faction, commander || getAgent(units[0].leaderId), target);
          target.siege = null;
          if (captured) {
            // จบภารกิจ กองทัพพักในเมือง
            ar.objective = { type: 'idle' };
            const f = getFaction(ar.factionId);
            if (f) { f.warState = false; }
          } else {
            ar.morale = clamp(ar.morale - 15, 0, 100);
            if (ar.morale < 30) { this.disbandArmy(ar); continue; }
          }
        } else ar.objective = { type: 'idle' };
      } else if (ar.objective.type === 'idle') {
        // กองทัพว่าง — เติมเสบียงจากเมืองตัวเอง แล้วสลายถ้าสงครามจบ
        const f = getFaction(ar.factionId);
        if (!f || !f.warState) { this.disbandArmy(ar); }
      }
    }

    // การล้อม: เมืองที่ถูกล้อม
    for (const s of world.settlements) {
      if (!s.siege) continue;
      const ar = getArmy(s.siege.armyId);
      if (!ar || ar.locationId !== s.id) { s.siege = null; continue; }
      s.siege.days++;
      s.loyalty = clamp(s.loyalty - 2, 0, 100);
      s.unrest = clamp(s.unrest + 3, 0, 100);
      ar.supply.food -= 2; // ผู้ล้อมก็เปลืองเสบียง
      const garrison = s.garrisonUnitId ? getUnit(s.garrisonUnitId) : null;
      if (garrison) garrison.morale = clamp(garrison.morale - 3, 0, 100);
      // เมืองยอมแพ้เมื่ออาหารหมดหรือ morale garrison ต่ำ
      if (s.stock.food <= 5 || (garrison && garrison.morale < 20) || s.siege.days > 12 || chance(0.05 * s.siege.days)) {
        const faction = getFaction(ar.factionId);
        const commander = getAgent(ar.commanderId);
        EventSystem.add('war', `🏳 ${s.name} ยอมจำนนหลังถูกล้อม ${s.siege.days} วัน`);
        s.siege = null;
        if (faction && commander) this.resolveCapture(ar.unitIds.map(getUnit).filter(Boolean), faction, commander, s);
        ar.objective = { type: 'idle' };
      } else if (ar.supply.food <= 0 || ar.morale < 25) {
        EventSystem.add('war', `💨 กองทัพที่ล้อม${s.name}ถอยทัพเพราะขาดเสบียง`);
        s.siege = null;
        this.disbandArmy(ar);
      }
    }
  },

  disbandArmy(ar) {
    for (const uId of ar.unitIds) {
      const u = getUnit(uId);
      if (!u) continue;
      u.armyId = null;
      if (u.kind === 'field') u.objective = { type: 'huntBandits' };
    }
    world.armies = world.armies.filter(x => x.id !== ar.id);
  }
};

/* ── garrison: สร้าง/เติมหน่วยประจำถิ่นฐาน ── */
function ensureGarrison(s) {
  if (s.type === 'camp') return;
  let u = s.garrisonUnitId ? getUnit(s.garrisonUnitId) : null;
  const soldiers = agentsAt(s.id).filter(a => MILITARY_PROFS.has(a.profession) && !a.unitId && !RULER_PROFS.has(a.profession));
  if (!u && soldiers.length > 0) {
    const leader = soldiers.reduce((m, x) => x.skills.leadership > m.skills.leadership ? x : m, soldiers[0]);
    u = createUnit({
      name: `กองรักษาการณ์${s.name}`, kind: 'guard',
      leaderId: leader.id, memberIds: soldiers.map(x => x.id),
      factionId: s.factionId, locationId: s.id, food: 15
    });
    s.garrisonUnitId = u.id;
  } else if (u) {
    for (const sol of soldiers) {
      if (!u.memberIds.includes(sol.id)) { u.memberIds.push(sol.id); sol.unitId = u.id; }
    }
    u.factionId = s.factionId;
  }
}

/* ═══════════════ 14. GOVERNANCE / FACTION SYSTEM ═══════════════ */

const GovernanceSystem = {
  updateSettlement(s) {
    if (s.type === 'camp') { this.updateCamp(s); return; }
    const pop = populationOf(s);
    const garrison = s.garrisonUnitId ? getUnit(s.garrisonUnitId) : null;
    const garrisonSize = garrison ? unitMembers(garrison).length : 0;

    /* ── 1. เก็บภาษีรายหัว ── */
    let taxIncome = 0;
    for (const a of agentsAt(s.id)) {
      if (RULER_PROFS.has(a.profession)) continue;
      const tax = Math.min(a.money * s.taxRate * 0.15, a.money);
      a.money -= tax;
      taxIncome += tax;
      if (s.taxRate > 0.25) a.stats.morale = clamp(a.stats.morale - 1, 0, 100);
    }
    s.treasury += taxIncome;

    /* ── 2. จ่ายค่าจ้าง + เสบียง garrison ── */
    if (garrison && garrisonSize >= 3) {
      // garrison ลาดตระเวนเส้นทางรอบเมือง — ลดอันตราย
      for (const r of world.routes) {
        if (r.destroyed || (r.a !== s.id && r.b !== s.id)) continue;
        r.patrolLevel = Math.min(5, r.patrolLevel + garrisonSize * 0.08);
        r.danger = clamp(r.danger - 0.01 - garrisonSize * 0.002, 0.02, 1);
      }
    }
    if (garrison) {
      const wageNeed = garrisonSize * 2;
      const foodNeed = Math.max(0, garrisonSize * 1.2 - garrison.supply.food);
      if (s.treasury >= wageNeed) {
        s.treasury -= wageNeed;
        for (const m of unitMembers(garrison)) m.money += 2;
      } else {
        garrison.morale = clamp(garrison.morale - 4, 0, 100);
        if (garrison.morale < 25 && chance(0.2)) {
          // ทหารไม่ได้ค่าจ้าง — ปล้นชาวบ้านหรือหนีทัพ
          if (chance(0.5)) {
            s.crime = clamp(s.crime + 10, 0, 100);
            s.loyalty = clamp(s.loyalty - 5, 0, 100);
            EventSystem.add('war', `😠 ทหารรักษาการณ์${s.name}ไม่ได้ค่าจ้าง เริ่มรีดไถชาวบ้าน`);
          }
        }
      }
      const foodTake = Math.min(foodNeed, s.stock.food);
      s.stock.food -= foodTake;
      garrison.supply.food += foodTake;
    }

    /* ── 3. governor/mayor ตัดสินใจ ── */
    const gov = s.governorId ? getAgent(s.governorId) : (s.ownerId ? getAgent(s.ownerId) : null);
    if (gov && gov.alive && gov.locationId === s.id) {
      this.governorDecisions(gov, s, garrison, garrisonSize);
      gov.skills.governance = Math.min(10, gov.skills.governance + 0.01);
      // เงินเดือนผู้ปกครองจากคลังเมือง
      const stipend = Math.min(s.treasury * 0.02, 8);
      s.treasury -= stipend;
      gov.money += stipend;
    } else if (!gov || !gov.alive) {
      this.appointGovernor(s);
    }

    /* ── 4. ส่งภาษีให้ faction (ผ่าน governor ที่อาจโกง) ── */
    const faction = getFaction(s.factionId);
    if (faction && !faction.isBandit && s.treasury > 150) {
      let tribute = (s.treasury - 150) * 0.15;
      if (gov && gov.gov) {
        const skim = tribute * gov.gov.corruption * 0.6;
        gov.money += skim;
        tribute -= skim;
      }
      s.treasury -= tribute;
      faction.treasury += tribute;
    }

    /* ── 5. loyalty / unrest / crime / security / prosperity ── */
    const foodPriceRatio = s.prices.food / BASE_PRICE.food;
    let dLoyalty = 0;
    dLoyalty += s.taxRate < 0.12 ? 0.6 : s.taxRate > 0.25 ? -1.2 : 0;
    dLoyalty += foodPriceRatio > 2.5 ? -1.5 : foodPriceRatio < 1.3 ? 0.5 : 0;
    dLoyalty += s.raidedRecently > 0 ? -1 : 0.2;
    dLoyalty += s.buildings.includes('Temple') ? 0.4 : 0;
    if (world.day - s.lastCapturedDay < 15) dLoyalty -= 0.5;
    s.loyalty = clamp(s.loyalty + dLoyalty, 0, 100);

    let dUnrest = 0;
    dUnrest += foodPriceRatio > 2.5 ? 1.5 : foodPriceRatio > 1.8 ? 0.6 : -0.8;
    dUnrest += s.taxRate > 0.25 ? 1 : 0;
    dUnrest += s.crime > 50 ? 0.5 : 0;
    dUnrest += (s.loyalty < 30) ? 0.5 : 0;
    const hungryCount = agentsAt(s.id).filter(a => a.stats.hunger < 25).length;
    dUnrest += hungryCount * 0.3;
    s.unrest = clamp(s.unrest + dUnrest, 0, 100);

    s.security = clamp(30 + garrisonSize * 6 + (s.buildings.includes('Wall') ? 15 : 0) + (s.buildings.includes('Watchtower') ? 8 : 0) - s.crime * 0.3, 0, 100);
    s.crime = clamp(s.crime + (s.security < 30 ? 1 : -1) + (hungryCount > 3 ? 1.5 : 0) + (s.unrest > 60 ? 0.8 : 0), 0, 100);
    s.prosperity = clamp(s.prosperity + (s.treasury > 400 ? 0.4 : s.treasury < 80 ? -0.5 : 0) + (foodPriceRatio < 1.5 ? 0.3 : -0.3) - (s.raidedRecently > 0 ? 0.5 : 0), 0, 100);

    if (s.raidedRecently > 0) s.raidedRecently--;
    if (s.drought > 0) { s.drought--; if (s.drought === 0) EventSystem.add('system', `🌧 ฝนกลับมาตกที่${s.name} ภัยแล้งสิ้นสุด`); }
    if (s.plague > 0) { s.plague -= 0.1; if (s.plague <= 0) { s.plague = 0; EventSystem.add('system', `💚 โรคระบาดที่${s.name}สงบลง`); } }

    /* ── 6. rebellion check ── */
    this.rebellionCheck(s);
  },

  governorDecisions(gov, s, garrison, garrisonSize) {
    /* ตั้งภาษีตามสถานการณ์ */
    if (s.unrest > 55 && s.taxRate > 0.08) {
      s.taxRate = Math.max(0.05, s.taxRate - 0.02);
      gov.currentThought = 'ประชาชนเริ่มไม่พอใจ ข้าต้องลดภาษีก่อนจะสายเกินไป';
    } else if (s.treasury < 100 && s.taxRate < 0.3) {
      s.taxRate = Math.min(0.3, s.taxRate + 0.02);
      gov.currentThought = 'คลังใกล้หมด จำเป็นต้องขึ้นภาษี... หวังว่าชาวบ้านจะเข้าใจ';
      if (s.taxRate >= 0.2 && chance(0.3)) EventSystem.add('politics', `📜 ${gov.name} ขึ้นภาษี${s.name}เป็น ${fmt(s.taxRate * 100)}%`);
    } else if (s.treasury > 600 && s.taxRate > 0.1 && s.unrest > 25) {
      s.taxRate = Math.max(0.08, s.taxRate - 0.01);
    }

    /* จ้างทหารเพิ่มเมื่ออันตราย */
    const threat = EconomySystem.localDanger(s) * 100 + s.crime * 0.5 + (s.raidedRecently > 0 ? 30 : 0);
    const wantGarrison = Math.ceil(threat / 15) + (s.type === 'fort' || s.type === 'castle' ? 5 : 1);
    if (garrisonSize < wantGarrison && s.treasury > 120) {
      const candidates = agentsAt(s.id).filter(a => !a.unitId && (a.profession === 'unemployed' || a.profession === 'militia' || a.profession === 'refugee') && a.stats.hunger > 20);
      const hired = candidates.slice(0, Math.min(2, wantGarrison - garrisonSize));
      for (const h of hired) {
        h.profession = 'guard';
        h.money += 10; s.treasury -= 10;
        if (s.stock.weapons >= 1) { s.stock.weapons -= 1; h.inventory.weapon = 1; h.durability.weapon = 50; }
        h.currentThought = 'ได้งานเป็นยามเมือง มีข้าวกินมีเงินเดือนแล้ว';
      }
      if (hired.length) ensureGarrison(s);
    }

    /* ซื้ออาหารสำรองเมื่อใกล้ขาด (สร้าง demand ให้พ่อค้า) */
    if (s.stock.food < s.demand.food * 0.4) {
      s.warDemand = s.warDemand; // ราคาอาหารจะสูงเองจาก scarcity → ดึงพ่อค้าเข้ามา
      if (chance(0.15)) EventSystem.add('economy', `🍞 ${s.name} ขาดแคลนอาหาร ราคาพุ่งเป็น ${fmt(s.prices.food, 1)} — พ่อค้าเริ่มสนใจ`);
    }

    /* สร้างอาคาร */
    if (s.treasury > 350 && chance(0.15)) {
      const wants = [];
      if (!s.buildings.includes('Granary') && s.prodPotential.food > 1) wants.push('Granary');
      if (!s.buildings.includes('Market') && s.type === 'town') wants.push('Market');
      if (!s.buildings.includes('Wall') && (s.raidedRecently > 0 || threat > 40)) wants.push('Wall');
      if (!s.buildings.includes('Watchtower') && threat > 25) wants.push('Watchtower');
      if (!s.buildings.includes('Blacksmith') && (s.type === 'town' || s.type === 'castle')) wants.push('Blacksmith');
      if (!s.buildings.includes('Barracks') && (s.type === 'castle' || s.type === 'fort')) wants.push('Barracks');
      if (!s.buildings.includes('Temple') && s.unrest > 40) wants.push('Temple');
      for (const b of wants) {
        const cost = BUILDINGS[b].cost;
        if (s.treasury >= (cost.gold || 0) && s.stock.wood >= (cost.wood || 0) && s.stock.ore >= (cost.ore || 0)) {
          s.treasury -= cost.gold || 0;
          s.stock.wood -= cost.wood || 0;
          s.stock.ore -= cost.ore || 0;
          s.buildings.push(b);
          EventSystem.add('politics', `🏗 ${s.name} สร้าง ${b} สำเร็จ (${BUILDINGS[b].effect})`);
          s.history.push(`Day ${world.day}: สร้าง ${b}`);
          break;
        }
      }
    }

    /* governor อิสระ/กบฏ: ambition สูง loyalty ต่ำ กองกำลังพร้อม */
    if (gov.gov && s.governorId === gov.id && s.ownerId !== gov.id) {
      const faction = getFaction(s.factionId);
      if (faction && faction.rulerId !== gov.id) {
        gov.gov.loyalty = clamp(gov.gov.loyalty + (s.prosperity > 60 ? 0.002 : -0.003) - gov.gov.ambition * 0.002, 0, 1);
        const militaryReady = garrisonSize >= 5;
        if (gov.gov.loyalty < 0.25 && gov.gov.ambition > 0.6 && militaryReady && s.treasury > 300 && chance(0.08)) {
          this.declareIndependence(gov, s, faction);
        }
      }
    }
  },

  declareIndependence(gov, s, oldFaction) {
    const newF = createFaction({
      name: `แคว้น${s.name.replace('เมือง', '').replace('บ้าน', '').replace('ป้อม', '')}ของ${gov.name.split(' ')[0]}`,
      color: pick(['#ff7043', '#9ccc65', '#7e57c2', '#26a69a', '#ec407a']),
      rulerId: gov.id, treasury: s.treasury * 0.3
    });
    s.treasury *= 0.7;
    s.factionId = newF.id;
    s.ownerId = gov.id;
    gov.profession = 'lord'; gov.rank = 'warlord';
    gov.factionId = newF.id;
    for (const a of agentsAt(s.id)) a.factionId = newF.id;
    const garrison = s.garrisonUnitId ? getUnit(s.garrisonUnitId) : null;
    if (garrison) garrison.factionId = newF.id;
    oldFaction.enemies.push(newF.id);
    newF.enemies.push(oldFaction.id);
    oldFaction.warState = true; newF.warState = true;
    EventSystem.add('politics', `🔥👑 ${gov.name} ประกาศแยก${s.name}เป็นอิสระจาก${oldFaction.name}! ตั้ง${newF.name} — สงครามกลางเมืองปะทุ`);
    s.history.push(`Day ${world.day}: ประกาศเอกราช`);
  },

  appointGovernor(s) {
    const faction = getFaction(s.factionId);
    if (!faction || faction.isBandit) return;
    const candidates = agentsAt(s.id).filter(a => a.alive && !a.unitId &&
      (a.skills.governance > 1 || a.skills.leadership > 2 || a.traits.ambition > 0.7));
    if (!candidates.length) return;
    const best = candidates.reduce((m, x) => (x.skills.governance + x.skills.leadership > m.skills.governance + m.skills.leadership) ? x : m, candidates[0]);
    s.governorId = best.id;
    best.gov = best.gov || makeGovAttrs();
    if (!RULER_PROFS.has(best.profession)) best.profession = 'mayor';
    EventSystem.add('politics', `📜 ${best.name} ได้รับแต่งตั้งเป็นผู้ปกครอง${s.name}`);
  },

  rebellionCheck(s) {
    if (s.unrest < 70 || s.loyalty > 30 || !chance(0.12)) return;
    const rebels = agentsAt(s.id).filter(a => !a.unitId && !RULER_PROFS.has(a.profession) &&
      (a.stats.hunger < 45 || a.money < 15 || a.stats.morale < 35));
    if (rebels.length < 4) return;
    const leader = rebels.reduce((m, x) => (x.skills.leadership + x.traits.ambition * 3) > (m.skills.leadership + m.traits.ambition * 3) ? x : m, rebels[0]);
    const members = rebels.slice(0, Math.min(rebels.length, 4 + Math.floor(leader.skills.leadership * 2)));
    const u = createUnit({
      name: `กองกบฏแห่ง${s.name}`, kind: 'rebel',
      leaderId: leader.id, memberIds: members.map(m => m.id),
      factionId: null, locationId: s.id, food: 15
    });
    for (const m of members) m.profession = 'militia';
    EventSystem.add('politics', `🔥 ประชาชน${s.name}ลุกฮือ! ${leader.name} นำกบฏ ${members.length} คน บุกยึดเมือง`);
    world.stats.raids++;

    // สู้กับ garrison ทันที
    const garrison = s.garrisonUnitId ? getUnit(s.garrisonUnitId) : null;
    const result = MilitarySystem.battle([u], garrison ? [garrison] : [], { defenseBonus: s.security * 0.3, label: s.name });
    if (result.attackerWins) {
      const newF = createFaction({
        name: `สาธารณรัฐ${s.name.replace('เมือง', '').replace('บ้าน', '')}`,
        color: pick(['#ff5722', '#8bc34a', '#673ab7', '#009688']),
        rulerId: leader.id, treasury: s.treasury * 0.4
      });
      const oldFaction = getFaction(s.factionId);
      if (oldFaction) { oldFaction.enemies.push(newF.id); newF.enemies.push(oldFaction.id); oldFaction.warState = true; }
      s.factionId = newF.id;
      s.ownerId = leader.id;
      s.governorId = leader.id;
      leader.profession = 'lord'; leader.rank = 'rebel_lord';
      leader.gov = makeGovAttrs();
      leader.factionId = newF.id;
      s.unrest = 30; s.loyalty = 55; s.taxRate = 0.06;
      if (garrison) {
        for (const m of unitMembers(garrison)) { m.unitId = null; m.profession = 'unemployed'; }
        world.units = world.units.filter(x => x.id !== garrison.id);
        s.garrisonUnitId = null;
      }
      // กบฏกลายเป็น garrison ใหม่
      u.kind = 'guard'; u.factionId = newF.id; s.garrisonUnitId = u.id;
      for (const m of unitMembers(u)) { m.factionId = newF.id; m.profession = 'guard'; }
      EventSystem.add('politics', `👑 กบฏยึด${s.name}สำเร็จ! ${leader.name} สถาปนา${newF.name}`);
      s.history.push(`Day ${world.day}: กบฏยึดเมือง ตั้ง${newF.name}`);
    } else {
      EventSystem.add('war', `🛡 กบฏที่${s.name}ถูกปราบ (ตาย ${result.atkResult.dead} คน) — ความไม่พอใจยังคุกรุ่น`);
      s.unrest = clamp(s.unrest - 15, 0, 100);
      BanditSystem.disband(u);
    }
  },

  updateCamp(s) {
    // ค่ายโจรผลิตอาหารเล็กน้อย (ล่าสัตว์)
    const bandits = agentsAt(s.id).filter(a => a.profession === 'bandit');
    s.stock.food += bandits.length * 0.5 * Math.max(s.prodPotential.food, 0.3) * 3;
    // ค่ายอดอยาก → โจรบางคนทิ้งค่ายกลับตัวเป็นคนธรรมดา
    if (s.stock.food < bandits.length && bandits.length > 0) {
      for (const b of bandits) {
        if (b.unitId || b.stats.hunger > 40 || !chance(0.25)) continue;
        const target = marketSettlements().filter(x => findPath(s.id, x.id));
        if (target.length) {
          b.profession = 'migrant';
          b.currentThought = 'ค่ายโจรไม่มีจะกินแล้ว... ข้าขอกลับไปเริ่มต้นใหม่';
          startTravel(b, pick(target).id, 'migrate');
          if (chance(0.3)) EventSystem.add('life', `🚶 โจร ${b.name} ทิ้งค่ายที่อดอยาก กลับตัวไปหางานทำ`);
        }
      }
    }
  },

  /* ── faction-level: ราชาตัดสินใจ ── */
  updateFactions() {
    for (const f of world.factions) {
      const settlements = world.settlements.filter(s => s.factionId === f.id);
      if (settlements.length === 0 && !f.isBandit) continue;
      const ruler = getAgent(f.rulerId);
      if (!ruler || !ruler.alive) continue;

      // ราชาแต่งตั้ง governor ให้เมืองที่ไม่มี
      if (settlements.length > 1) {
        for (const s of settlements) {
          const gov = s.governorId ? getAgent(s.governorId) : null;
          if ((!gov || !gov.alive) && s.type !== 'camp') this.appointGovernor(s);
        }
      }

      // สงคราม: ถ้ามีศัตรูและมีกำลัง → ยกทัพ
      if (f.warState && f.enemies.length && !f.isBandit && chance(0.1) && world.armies.filter(a => a.factionId === f.id).length === 0) {
        this.raiseArmy(f, ruler);
      }

      // faction ช่วยเมืองที่อาหารขาดจากคลังกลาง
      if (!f.isBandit && f.treasury > 300) {
        const starving = settlements.find(s => s.stock.food < 15 && s.type !== 'camp');
        if (starving && chance(0.3)) {
          const aid = Math.min(150, f.treasury * 0.3);
          f.treasury -= aid;
          starving.treasury += aid;
          EventSystem.add('politics', `💰 ${f.name} ส่งเงินช่วยเหลือ ${fmt(aid)} ทองให้${starving.name}ซื้ออาหาร`);
        }
      }
    }
  },

  raiseArmy(f, ruler) {
    const enemyF = getFaction(f.enemies[f.enemies.length - 1]);
    if (!enemyF) { f.warState = false; f.enemies = []; return; }
    const enemySettlements = world.settlements.filter(s => s.factionId === enemyF.id);
    if (!enemySettlements.length) {
      f.enemies = f.enemies.filter(e => e !== enemyF.id);
      if (!f.enemies.length) f.warState = false;
      return;
    }
    // รวมหน่วย guard จากถิ่นฐานของตัวเอง (เหลือขั้นต่ำไว้เฝ้า)
    const myUnits = [];
    const capital = world.settlements.find(s => s.factionId === f.id && (s.type === 'castle' || s.type === 'town'));
    if (!capital) return;
    for (const s of world.settlements.filter(s => s.factionId === f.id)) {
      const g = s.garrisonUnitId ? getUnit(s.garrisonUnitId) : null;
      if (g && unitMembers(g).length >= 4) {
        // แยกครึ่งหนึ่งไปรบ
        const members = unitMembers(g);
        const taking = members.slice(0, Math.floor(members.length * 0.6));
        for (const m of taking) g.memberIds = g.memberIds.filter(id => id !== m.id);
        const fieldLeader = taking.reduce((m, x) => x.skills.leadership > m.skills.leadership ? x : m, taking[0]);
        const nu = createUnit({
          name: `กองรบจาก${s.name}`, kind: 'field',
          leaderId: fieldLeader.id, memberIds: taking.map(m => m.id),
          factionId: f.id, locationId: s.id, food: 30
        });
        myUnits.push(nu);
      }
    }
    if (!myUnits.length) return;
    // commander = คนที่ leadership สูงสุดใน faction
    const commander = world.agents.filter(a => a.alive && a.factionId === f.id && (MILITARY_PROFS.has(a.profession) || RULER_PROFS.has(a.profession)))
      .reduce((m, x) => (x.skills.leadership + x.skills.tactics) > (m.skills.leadership + m.skills.tactics) ? x : m, ruler);
    const target = enemySettlements.reduce((m, x) => {
      const gm = m.garrisonUnitId ? MilitarySystem.unitPower(getUnit(m.garrisonUnitId)) : 0;
      const gx = x.garrisonUnitId ? MilitarySystem.unitPower(getUnit(x.garrisonUnitId)) : 0;
      return gx < gm ? x : m;
    }, enemySettlements[0]);
    const foodBought = Math.min(capital.stock.food * 0.4, 250);
    capital.stock.food -= foodBought;
    const ar = createArmy({
      name: `กองทัพ${f.name}`, commanderId: commander.id, factionId: f.id,
      unitIds: myUnits.map(u => u.id), locationId: myUnits[0].locationId,
      objective: { type: 'attack', targetId: target.id }, food: foodBought
    });
    // รวมพลที่จุดเดียวแล้วเดิน
    for (const u of myUnits) { u.locationId = ar.locationId; for (const m of unitMembers(u)) m.locationId = ar.locationId; }
    startTravel(ar, target.id, 'war');
    const totalMen = sum(myUnits, u => unitMembers(u).length);
    EventSystem.add('war', `⚔🔥 ${f.name} ยกทัพ ${totalMen} นาย นำโดย ${commander.name} มุ่งโจมตี${target.name}!`);
    // ปราสาทเตรียมสงคราม → demand อาวุธพุ่ง
    if (capital) capital.warDemand = Math.min(10, capital.warDemand + 4);
  }
};

/* ── ผู้ปกครองตาย: จัดการสืบทอด/ล่มสลาย ── */
function handleRulerDeath(dead) {
  for (const f of world.factions) {
    if (f.rulerId !== dead.id) continue;
    const settlements = world.settlements.filter(s => s.factionId === f.id);
    const heirs = world.agents.filter(a => a.alive && a.factionId === f.id &&
      (RULER_PROFS.has(a.profession) || a.skills.leadership > 4));
    if (heirs.length) {
      const heir = heirs.reduce((m, x) => (x.skills.governance + x.skills.leadership + x.reputation * 0.1) >
        (m.skills.governance + m.skills.leadership + m.reputation * 0.1) ? x : m, heirs[0]);
      f.rulerId = heir.id;
      heir.profession = settlements.length > 2 ? 'king' : 'lord';
      heir.rank = heir.profession;
      for (const s of settlements) if (s.ownerId === dead.id) s.ownerId = heir.id;
      EventSystem.add('politics', `👑 ${heir.name} สืบทอดอำนาจปกครอง${f.name}ต่อจาก${dead.name}`);
    } else {
      EventSystem.add('politics', `💀 ${f.name} ไร้ผู้สืบทอด — อาณาจักรระส่ำระสาย`);
      for (const s of settlements) { s.unrest = clamp(s.unrest + 25, 0, 100); s.loyalty = clamp(s.loyalty - 20, 0, 100); }
    }
  }
  for (const s of world.settlements) {
    if (s.governorId === dead.id) s.governorId = null;
    if (s.ownerId === dead.id && s.factionId) {
      const f = getFaction(s.factionId);
      if (f && f.rulerId && f.rulerId !== dead.id) s.ownerId = f.rulerId;
    }
  }
}

function checkFactionCollapse(f) {
  const remaining = world.settlements.filter(s => s.factionId === f.id);
  if (remaining.length === 0) {
    EventSystem.add('politics', `🏴 ${f.name} ล่มสลาย — สิ้นชื่อจากหน้าประวัติศาสตร์`);
    f.warState = false;
    for (const other of world.factions) other.enemies = other.enemies.filter(e => e !== f.id);
  }
}

/* ═══════════════════ 15. SIMULATION TICK ═══════════════════ */

function simulateDay() {
  world.day++;

  /* 1-2. Settlement ผลิต (ธรรมชาติเล็กน้อย) + decay */
  for (const s of world.settlements) {
    EconomySystem.decayStock(s);
    // ผลผลิตพื้นฐานเล็กน้อย (นอกเหนือจากคนทำงาน) — ธรรมชาติให้เปล่า
    if (s.drought <= 0) s.stock.food += s.prodPotential.food * 0.8;
  }

  /* 3-4. Agents: needs */
  for (const a of world.agents) if (a.alive) NeedSystem.update(a);

  /* 5. ราคา */
  for (const s of world.settlements) EconomySystem.updateDemandAndPrices(s);

  /* 6-8. Agent AI + งาน + พ่อค้า */
  for (const a of world.agents) {
    if (!a.alive) continue;
    if (a.travel && !a.unitId) {
      const arrived = advanceTravel(a, agentSpeed(a));
      if (a.cargo) BanditSystem.interceptCaravan(a);
      if (arrived) {
        if (!a.memory.citiesVisited.includes(a.locationId)) a.memory.citiesVisited.push(a.locationId);
        if (a.cargo) TraderSystem.onArrive(a);
        else if (a.travel === null && a.profession === 'migrant') { a.profession = 'unemployed'; a.homeId = a.locationId; }
      }
      continue;
    }
    AgentAI.decide(a);
  }

  /* 10. Bandits */
  BanditSystem.update();

  /* 11. Military: units, field units, armies */
  MilitarySystem.updateUnits();
  MilitarySystem.updateFieldUnits();
  MilitarySystem.freeCompanyCheck();
  MilitarySystem.updateArmies();

  /* 12-17. Governance + factions */
  for (const s of world.settlements) GovernanceSystem.updateSettlement(s);
  GovernanceSystem.updateFactions();

  // เติม garrison จากทหารว่าง
  for (const s of world.settlements) ensureGarrison(s);

  /* route dynamics */
  for (const r of world.routes) {
    r.traffic *= 0.9;
    r.danger = clamp(r.danger - 0.005 - r.patrolLevel * 0.01, 0.02, 1);
    r.patrolLevel = Math.max(0, r.patrolLevel - 0.1);
  }

  /* เก็บกวาด agent ตาย */
  if (world.day % 10 === 0) {
    world.agents = world.agents.filter(a => a.alive || world.day - (a.deathDay || 0) < 3);
  }

  /* การเติบโตของประชากร: ถิ่นฐานที่อาหารพอและสงบ มีเด็กโตเป็นผู้ใหญ่/ผู้อพยพจากนอกแผนที่ */
  for (const s of marketSettlements()) {
    const pop = populationOf(s);
    if (pop < 1) continue;
    const capacity = (s.prodPotential.food + s.prodPotential.wood + s.prodPotential.ore) * 8 + (s.type === 'town' ? 15 : s.type === 'castle' ? 12 : 5);
    if (pop > capacity * 1.3) continue;   // เมืองแน่นเกิน — ไม่มีที่ทำกินให้คนรุ่นใหม่
    const foodOk = s.stock.food > s.demand.food * 0.6;
    const growthChance = foodOk && s.unrest < 50 ? pop * 0.006 * (s.prosperity / 60) : 0;
    if (chance(clamp(growthChance, 0, 0.25))) {
      const child = createAgent({ locationId: s.id, factionId: s.factionId, profession: 'unemployed', money: randInt(3, 15) });
      child.age = 16;
      if (chance(0.15)) EventSystem.add('life', `👶 คนหนุ่มสาวรุ่นใหม่เติบโตขึ้นที่${s.name}`);
    }
  }
  /* ผู้อพยพจากนอกแผนที่ */
  if (chance(0.03)) {
    const s = pick(marketSettlements());
    EventSystem.add('life', `👶 มีผู้อพยพหน้าใหม่มาถึง${s.name}`);
    createAgent({ locationId: s.id, factionId: s.factionId, profession: 'unemployed' });
  }

  /* ── เหตุการณ์ธรรมชาติสุ่ม — ให้โลกผันผวนและเกิดเรื่องเล่าเอง ── */
  if (chance(0.008)) {
    const s = pick(world.settlements.filter(x => x.prodPotential.food > 1));
    if (s && s.drought <= 0) {
      s.drought = randInt(8, 18);
      EventSystem.add('disaster', `☀ ภัยแล้งเกิดขึ้นเองที่${s.name} — ผลผลิตอาหารจะตกต่ำ ${s.drought} วัน`);
    }
  }
  if (chance(0.006)) {
    const s = pick(marketSettlements());
    const bonus = randInt(40, 100);
    s.stock.food += bonus;
    EventSystem.add('economy', `🌾 ${s.name} เก็บเกี่ยวได้ผลดีเป็นพิเศษ ได้อาหารเพิ่ม ${bonus} หน่วย`);
  }
  if (chance(0.005)) {
    const camp = world.settlements.find(x => x.type === 'camp');
    if (camp) {
      const n = randInt(2, 4);
      for (let i = 0; i < n; i++) {
        const b = createAgent({ locationId: camp.id, factionId: camp.factionId, profession: 'bandit', inventory: { weapon: chance(0.5) ? 1 : 0 } });
        b.skills.fighting = rand(1, 3);
      }
      EventSystem.add('bandit', `🗡 กลุ่มโจรพเนจร ${n} คนจากแดนไกลเข้าร่วม${camp.name}`);
    }
  }

  /* สรุปสถานการณ์ทุก 15 วัน */
  if (world.day % 15 === 0) {
    const alive = world.agents.filter(a => a.alive).length;
    const avgFood = sum(marketSettlements(), s => s.prices.food) / marketSettlements().length;
    EventSystem.add('system', `📊 Day ${world.day}: ประชากร ${alive} | ราคาอาหารเฉลี่ย ${fmt(avgFood, 1)} | ศึก ${world.stats.battles} | ปล้น ${world.stats.raids + world.stats.caravansRobbed} | ตาย ${world.stats.deaths}`);
  }

  UI.inspectorDirty = true;
}

/* ═══════════════════ 16. RENDERER ═══════════════════ */

const Renderer = {
  canvas: null, ctx: null, w: 0, h: 0, scaleX: 1, scaleY: 1,

  init() {
    this.canvas = document.getElementById('mapCanvas');
    this.ctx = this.canvas.getContext('2d');
    const resize = () => {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      this.canvas.width = rect.width * devicePixelRatio;
      this.canvas.height = rect.height * devicePixelRatio;
      this.w = rect.width; this.h = rect.height;
      this.scaleX = rect.width / MAP_W;
      this.scaleY = rect.height / MAP_H;
      this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    };
    window.addEventListener('resize', resize);
    resize();
  },

  sx(x) { return x * this.scaleX; },
  sy(y) { return y * this.scaleY; },

  settlementStatusColor(s) {
    if (s.siege) return '#111111';
    if (s.type === 'camp') return '#4a1f1f';
    if (s.raidedRecently > 0 || s.unrest > 70 || s.stock.food < 10) return '#c62828';   // วิกฤต
    if (s.unrest > 40 || s.prices.food > BASE_PRICE.food * 2.2) return '#f9a825';       // เริ่มมีปัญหา
    if (s.prosperity > 65) return '#2e7d32';                                            // มั่งคั่ง
    return '#37474f';                                                                    // ปกติ
  },

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    // พื้นหลัง
    ctx.fillStyle = '#141b14';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.02)';
    for (let gx = 0; gx < this.w; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, this.h); ctx.stroke(); }
    for (let gy = 0; gy < this.h; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(this.w, gy); ctx.stroke(); }

    // heatmap
    if (UI.heatmapMode !== 'none') this.drawHeatmap(ctx);

    // routes
    for (const r of world.routes) {
      if (r.destroyed) continue;
      const a = getSettlement(r.a), b = getSettlement(r.b);
      if (!a || !b) continue;
      const dangerT = clamp(r.danger, 0, 1);
      ctx.strokeStyle = `rgba(${Math.round(120 + dangerT * 135)},${Math.round(140 - dangerT * 80)},${Math.round(120 - dangerT * 60)},0.5)`;
      ctx.lineWidth = 1 + r.roadQuality * 2 + Math.min(r.traffic * 0.15, 2);
      ctx.setLineDash(r.roadQuality < 0.45 ? [5, 5] : []);
      ctx.beginPath();
      ctx.moveTo(this.sx(a.x), this.sy(a.y));
      ctx.lineTo(this.sx(b.x), this.sy(b.y));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // settlements
    for (const s of world.settlements) this.drawSettlement(ctx, s);

    // agents (จุดรอบถิ่นฐาน + ผู้เดินทาง)
    this.drawAgents(ctx);

    // units/armies เดินทาง (จุดใหญ่)
    this.drawMilitaryDots(ctx);

    // selection ring
    if (UI.selected) this.drawSelection(ctx);
  },

  drawSettlement(ctx, s) {
    const x = this.sx(s.x), y = this.sy(s.y);
    const r = SETTLEMENT_RADIUS[s.type] * Math.min(this.scaleX, this.scaleY) * 1.4;
    const faction = getFaction(s.factionId);
    const borderColor = faction ? faction.color : '#78909c';
    const fillColor = this.settlementStatusColor(s);

    ctx.fillStyle = fillColor;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = s.type === 'castle' ? 3.5 : 2.5;

    if (s.type === 'village' || s.type === 'town') {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    } else if (s.type === 'fort' || s.type === 'castle') {
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.strokeRect(x - r, y - r, r * 2, r * 2);
      if (s.type === 'castle') { // ธงเมืองหลวง
        ctx.strokeStyle = '#ab47bc'; ctx.lineWidth = 1.5;
        ctx.strokeRect(x - r - 4, y - r - 4, r * 2 + 8, r * 2 + 8);
      }
    } else if (s.type === 'camp') {
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.lineTo(x - r, y + r);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }

    // สัญลักษณ์ถูกล้อม
    if (s.siege) {
      ctx.strokeStyle = '#ef5350'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(x, y, r + 8, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }

    // ชื่อ
    ctx.fillStyle = 'rgba(215,224,234,0.85)';
    ctx.font = `${s.type === 'castle' ? 12 : 10.5}px "Segoe UI", "Noto Sans Thai", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(s.name, x, y + r + 12);
    ctx.fillStyle = 'rgba(132,150,168,0.8)';
    ctx.font = '9px sans-serif';
    ctx.fillText(`👥${populationOf(s)} 🍞${Math.floor(s.stock.food)}`, x, y + r + 23);
  },

  drawAgents(ctx) {
    const rMin = Math.min(this.scaleX, this.scaleY);
    for (const a of world.agents) {
      if (!a.alive) continue;
      let px, py;
      if (a.travel && !a.unitId) {
        const p = travelPos(a);
        px = this.sx(p.x); py = this.sy(p.y);
      } else if (!a.unitId) {
        const s = getSettlement(a.locationId);
        if (!s) continue;
        const base = SETTLEMENT_RADIUS[s.type] * 1.4;
        const orbitR = (base + 5 + a._jitterR * 14) * rMin * 1.2;
        px = this.sx(s.x) + Math.cos(a._jitterA + world.day * 0.02 * (a.id % 3 + 1)) * orbitR;
        py = this.sy(s.y) + Math.sin(a._jitterA + world.day * 0.02 * (a.id % 3 + 1)) * orbitR * 0.8;
      } else continue; // ทหารในหน่วยวาดรวมเป็นจุดหน่วย

      const color = PROF_COLOR[a.profession] || '#eceff1';
      const size = (a.cargo ? 4 : RULER_PROFS.has(a.profession) ? 4.5 : 2.5) * rMin * 1.3;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
      // คาราวานมีขอบ
      if (a.cargo) { ctx.strokeStyle = '#fff8e1'; ctx.lineWidth = 1; ctx.stroke(); }
      a._px = px; a._py = py; // เก็บไว้ให้ click picking
    }
  },

  drawMilitaryDots(ctx) {
    const rMin = Math.min(this.scaleX, this.scaleY);
    for (const u of world.units) {
      const members = unitMembers(u);
      if (!members.length) continue;
      let px, py;
      if (u.travel) { const p = travelPos(u); px = this.sx(p.x); py = this.sy(p.y); }
      else {
        const s = getSettlement(u.locationId);
        if (!s) continue;
        // guard วางชิดมุมล่างซ้ายของถิ่นฐาน หน่วยอื่นลอยมุมบนขวา
        const base = SETTLEMENT_RADIUS[s.type] * 1.4 + 6;
        const off = u.kind === 'guard' ? -base : base + 6;
        px = this.sx(s.x) + off * rMin; py = this.sy(s.y) - Math.abs(off) * rMin;
      }
      const size = (4 + Math.sqrt(members.length) * 2) * rMin;
      const color = u.kind === 'warband' ? '#ef5350' : u.kind === 'rebel' ? '#ff7043' : '#42a5f5';
      ctx.fillStyle = color;
      ctx.strokeStyle = u.armyId ? '#ffd54f' : 'rgba(255,255,255,0.6)';
      ctx.lineWidth = u.armyId ? 2.5 : 1.2;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(members.length, px, py + 2.5);
      u._px = px; u._py = py;
    }
  },

  drawHeatmap(ctx) {
    const mode = UI.heatmapMode;
    for (const s of world.settlements) {
      let v = 0, color = '255,0,0';
      const pop = agentsAt(s.id);
      switch (mode) {
        case 'hunger': {
          const avg = pop.length ? sum(pop, a => a.stats.hunger) / pop.length : 100;
          v = clamp((100 - avg) / 70, 0, 1); color = '255,60,40'; break;
        }
        case 'wealth': {
          const avg = pop.length ? sum(pop, a => a.money) / pop.length : 0;
          v = clamp(avg / 120, 0, 1); color = '255,215,80'; break;
        }
        case 'danger':
          v = clamp(EconomySystem.localDanger(s) * 1.6, 0, 1); color = '255,40,40'; break;
        case 'trade': {
          let t = 0;
          for (const r of world.routes) if (!r.destroyed && (r.a === s.id || r.b === s.id)) t += r.traffic;
          v = clamp(t / 12, 0, 1); color = '80,220,230'; break;
        }
        case 'foodprice':
          v = clamp((s.prices.food / BASE_PRICE.food - 0.5) / 4, 0, 1); color = '255,150,40'; break;
        case 'loyalty':
          v = clamp(s.loyalty / 100, 0, 1); color = '100,180,255'; break;
        case 'unrest':
          v = clamp(s.unrest / 80, 0, 1); color = '255,60,120'; break;
        case 'faction': {
          const f = getFaction(s.factionId);
          if (f) {
            const hex = f.color.replace('#', '');
            color = `${parseInt(hex.substr(0, 2), 16)},${parseInt(hex.substr(2, 2), 16)},${parseInt(hex.substr(4, 2), 16)}`;
            v = 0.7;
          }
          break;
        }
      }
      if (v <= 0.03) continue;
      const x = this.sx(s.x), y = this.sy(s.y);
      const radius = (50 + v * 40) * Math.min(this.scaleX, this.scaleY) * 1.6;
      const grad = ctx.createRadialGradient(x, y, 5, x, y, radius);
      grad.addColorStop(0, `rgba(${color},${0.4 * v + 0.12})`);
      grad.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  drawSelection(ctx) {
    const sel = UI.selected;
    let x, y, r = 14;
    if (sel.kind === 'settlement') {
      const s = getSettlement(sel.id); if (!s) return;
      x = this.sx(s.x); y = this.sy(s.y);
      r = SETTLEMENT_RADIUS[s.type] * Math.min(this.scaleX, this.scaleY) * 1.4 + 7;
    } else if (sel.kind === 'agent') {
      const a = getAgent(sel.id); if (!a || !a.alive) { UI.selected = null; return; }
      if (a.unitId) { const u = getUnit(a.unitId); if (u) { x = u._px; y = u._py; } }
      else { x = a._px; y = a._py; }
      r = 8;
    } else if (sel.kind === 'unit') {
      const u = getUnit(sel.id); if (!u) { UI.selected = null; return; }
      x = u._px; y = u._py; r = 14;
    } else if (sel.kind === 'army') {
      const ar = getArmy(sel.id); if (!ar) { UI.selected = null; return; }
      const u = ar.unitIds.map(getUnit).find(Boolean);
      if (u) { x = u._px; y = u._py; }
      r = 18;
    }
    if (x == null) return;
    const pulse = 1 + Math.sin(performance.now() / 250) * 0.15;
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(x, y, r * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  },

  // แปลง client coords → map coords
  toMap(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (clientX - rect.left) / this.scaleX, y: (clientY - rect.top) / this.scaleY };
  },

  pickAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left, py = clientY - rect.top;
    // 1) units (จุดใหญ่ ชัดสุด) — ข้าม garrison ที่ซ้อนกับถิ่นฐาน (ดูผ่าน settlement inspector แทน)
    for (const u of world.units) {
      if (u._px == null || !unitMembers(u).length || u.kind === 'guard') continue;
      const d = Math.hypot(px - u._px, py - u._py);
      if (d < 14) {
        if (u.armyId) return { kind: 'army', id: u.armyId };
        return { kind: 'unit', id: u.id };
      }
    }
    // 2) agents
    let bestA = null, bestD = 10;
    for (const a of world.agents) {
      if (!a.alive || a._px == null || a.unitId) continue;
      const d = Math.hypot(px - a._px, py - a._py);
      if (d < bestD) { bestD = d; bestA = a; }
    }
    if (bestA) return { kind: 'agent', id: bestA.id };
    // 3) settlements
    for (const s of world.settlements) {
      const d = Math.hypot(px - this.sx(s.x), py - this.sy(s.y));
      if (d < SETTLEMENT_RADIUS[s.type] * Math.min(this.scaleX, this.scaleY) * 1.4 + 8) {
        return { kind: 'settlement', id: s.id };
      }
    }
    return null;
  }
};

/* ═══════════════════ 17. UI ═══════════════════ */

const UI = {
  paused: false,
  speed: 1,
  heatmapMode: 'none',
  selected: null,
  armedTool: null,
  roadPickFirst: null,
  logDirty: true,
  inspectorDirty: true,
  _lastTickTime: 0,

  init() {
    // ── toolbar ──
    document.getElementById('btnPause').addEventListener('click', () => {
      this.paused = !this.paused;
      document.getElementById('btnPause').textContent = this.paused ? '▶ Resume' : '⏸ Pause';
    });
    document.getElementById('btnStep').addEventListener('click', () => { simulateDay(); });
    document.getElementById('btnReset').addEventListener('click', () => {
      if (confirm('สร้างโลกใหม่ทั้งหมด?')) { generateWorld(); this.selected = null; this.logDirty = true; }
    });
    for (const btn of document.querySelectorAll('.speed-btn')) {
      btn.addEventListener('click', () => {
        this.speed = +btn.dataset.speed;
        document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    }
    document.getElementById('heatmapSelect').addEventListener('change', e => { this.heatmapMode = e.target.value; });
    document.getElementById('btnTools').addEventListener('click', () => {
      document.getElementById('toolPanel').classList.toggle('hidden');
    });

    // ── sandbox tools ──
    for (const btn of document.querySelectorAll('.tool-btn')) {
      btn.addEventListener('click', () => SandboxTools.activate(btn.dataset.tool, btn));
    }

    // ── map interaction ──
    const canvas = document.getElementById('mapCanvas');
    canvas.addEventListener('click', e => {
      if (this.armedTool) { SandboxTools.applyAt(e.clientX, e.clientY); return; }
      this.selected = Renderer.pickAt(e.clientX, e.clientY);
      this.inspectorDirty = true;
    });
    canvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      SandboxTools.disarm();
    });
  },

  loop(ts) {
    const interval = { 1: 900, 5: 180, 20: 45 }[this.speed] || 900;
    if (!this.paused && ts - this._lastTickTime >= interval) {
      this._lastTickTime = ts;
      simulateDay();
    }
    Renderer.draw();
    document.getElementById('dayCounter').textContent = `Day ${world.day}`;
    if (this.logDirty) { this.renderLog(); this.logDirty = false; }
    if (this.inspectorDirty) { this.renderInspector(); this.inspectorDirty = false; }
    requestAnimationFrame(t => this.loop(t));
  },

  renderLog() {
    const el = document.getElementById('eventLog');
    const html = world.events.slice(-250).map(ev =>
      `<div class="log-entry ev-${ev.category}"><span class="log-day">Day ${ev.day}</span>${ev.text}</div>`
    ).join('');
    el.innerHTML = html;
    if (document.getElementById('logAutoScroll').checked) el.scrollTop = el.scrollHeight;
  },

  /* ── Inspector rendering ── */
  renderInspector() {
    const title = document.getElementById('inspectorTitle');
    const body = document.getElementById('inspectorBody');
    const sel = this.selected;

    if (!sel) {
      title.textContent = 'Inspector — ภาพรวมโลก';
      body.innerHTML = this.worldSummaryHTML();
      return;
    }
    if (sel.kind === 'agent') {
      const a = getAgent(sel.id);
      if (!a || !a.alive) { this.selected = null; this.renderInspector(); return; }
      title.textContent = `👤 ${a.name}`;
      body.innerHTML = this.agentHTML(a);
    } else if (sel.kind === 'settlement') {
      const s = getSettlement(sel.id);
      if (!s) { this.selected = null; return; }
      title.textContent = `${{ village: '🏡', town: '🏘', fort: '🏰', castle: '👑', camp: '⛺' }[s.type]} ${s.name}`;
      body.innerHTML = this.settlementHTML(s);
    } else if (sel.kind === 'unit') {
      const u = getUnit(sel.id);
      if (!u) { this.selected = null; return; }
      title.textContent = `⚔ ${u.name}`;
      body.innerHTML = this.unitHTML(u);
    } else if (sel.kind === 'army') {
      const ar = getArmy(sel.id);
      if (!ar) { this.selected = null; return; }
      title.textContent = `🚩 ${ar.name}`;
      body.innerHTML = this.armyHTML(ar);
    }
    // ทำ links คลิกได้
    for (const link of body.querySelectorAll('[data-sel-kind]')) {
      link.addEventListener('click', () => {
        this.selected = { kind: link.dataset.selKind, id: +link.dataset.selId };
        this.inspectorDirty = true;
      });
    }
  },

  kv(k, v, cls) { return `<div class="kv"><span class="k">${k}</span><span class="v ${cls || ''}">${v}</span></div>`; },
  bar(v, color) { return `<div class="bar"><i style="width:${clamp(v, 0, 100)}%;background:${color}"></i></div>`; },
  link(kind, id, text) { return `<span class="insp-link" data-sel-kind="${kind}" data-sel-id="${id}">${text}</span>`; },

  worldSummaryHTML() {
    const alive = world.agents.filter(a => a.alive);
    const profCount = {};
    for (const a of alive) profCount[a.profession] = (profCount[a.profession] || 0) + 1;
    const avgFood = sum(marketSettlements(), s => s.prices.food) / Math.max(marketSettlements().length, 1);
    let html = `<p class="hint">คลิกตัวละคร เมือง คาราวาน หรือกองกำลังบนแผนที่เพื่อดูข้อมูล</p>`;
    html += `<div class="insp-section"><h4>สถานะโลก</h4>`;
    html += this.kv('วัน', world.day);
    html += this.kv('ประชากร', alive.length);
    html += this.kv('ราคาอาหารเฉลี่ย', fmt(avgFood, 1), avgFood > 20 ? 'bad' : 'good');
    html += this.kv('ศึกทั้งหมด', world.stats.battles);
    html += this.kv('การปล้น', world.stats.raids + world.stats.caravansRobbed);
    html += this.kv('ผู้เสียชีวิต', world.stats.deaths, 'bad');
    html += `</div>`;
    html += `<div class="insp-section"><h4>ฝ่าย (Factions)</h4>`;
    for (const f of world.factions) {
      const n = world.settlements.filter(s => s.factionId === f.id).length;
      if (n === 0 && !f.isBandit) continue;
      const ruler = getAgent(f.rulerId);
      html += this.kv(`<span style="color:${f.color}">■</span> ${f.name}${f.warState ? ' ⚔' : ''}`,
        `${n} ถิ่นฐาน${ruler ? ' · ' + this.link('agent', ruler.id, ruler.name.split(' ')[0]) : ''}`);
    }
    html += `</div>`;
    html += `<div class="insp-section"><h4>อาชีพ</h4>`;
    for (const [p, n] of Object.entries(profCount).sort((a, b) => b[1] - a[1])) html += this.kv(p, n);
    html += `</div>`;
    return html;
  },

  agentHTML(a) {
    const s = getSettlement(a.locationId);
    const f = getFaction(a.factionId);
    const u = a.unitId ? getUnit(a.unitId) : null;
    let html = `<div class="thought">💭 "${a.currentThought}"</div>`;
    html += `<div class="insp-section"><h4>ข้อมูลทั่วไป</h4>`;
    html += this.kv('อาชีพ', `<span style="color:${PROF_COLOR[a.profession] || '#fff'}">${a.profession}</span> (${a.rank})`);
    html += this.kv('อายุ', a.age);
    html += this.kv('ฝ่าย', f ? f.name : '—');
    html += this.kv('อยู่ที่', s ? this.link('settlement', s.id, s.name) : 'ระหว่างเดินทาง');
    html += this.kv('เป้าหมาย', a.currentGoal);
    if (u) html += this.kv('สังกัดหน่วย', this.link('unit', u.id, u.name));
    html += this.kv('ชื่อเสียง', fmt(a.reputation));
    html += `</div>`;
    html += `<div class="insp-section"><h4>สถานะ</h4>`;
    html += this.kv('Hunger', fmt(a.stats.hunger), a.stats.hunger < 30 ? 'bad' : 'good') + this.bar(a.stats.hunger, a.stats.hunger < 30 ? '#ef5350' : '#5dbb63');
    html += this.kv('Health', fmt(a.stats.health)) + this.bar(a.stats.health, '#42a5f5');
    html += this.kv('Energy', fmt(a.stats.energy)) + this.bar(a.stats.energy, '#26c6da');
    html += this.kv('Morale', fmt(a.stats.morale)) + this.bar(a.stats.morale, '#ab47bc');
    html += this.kv('เงิน', fmt(a.money, 1) + ' ทอง', a.money < 15 ? 'bad' : 'good');
    html += `</div>`;
    html += `<div class="insp-section"><h4>Inventory</h4>`;
    for (const [k, v] of Object.entries(a.inventory)) if (v > 0) html += this.kv(k, fmt(v) + (a.durability[k] ? ` (ทน ${fmt(a.durability[k])})` : ''));
    if (a.cargo) html += this.kv('สินค้าคาราวาน', `${a.cargo.good} × ${a.cargo.qty}`, 'warn');
    html += `</div>`;
    html += `<div class="insp-section"><h4>Skills (>0)</h4>`;
    for (const [k, v] of Object.entries(a.skills)) if (v >= 0.1) html += this.kv(k, fmt(v, 1));
    html += `</div>`;
    html += `<div class="insp-section"><h4>Traits</h4>`;
    for (const [k, v] of Object.entries(a.traits)) html += this.kv(k, fmt(v, 2));
    html += `</div>`;
    html += `<div class="insp-section"><h4>ประวัติ</h4>`;
    html += this.kv('ศึกที่ชนะ/แพ้', `${a.memory.battlesWon}/${a.memory.battlesLost}`);
    html += this.kv('รอดจากศึก', a.memory.survivedBattles);
    html += this.kv('เมืองที่เคยไป', a.memory.citiesVisited.length);
    if (a.memory.raidsDone) html += this.kv('เคยปล้น', a.memory.raidsDone + ' ครั้ง', 'bad');
    html += `</div>`;
    return html;
  },

  settlementHTML(s) {
    const f = getFaction(s.factionId);
    const owner = s.ownerId ? getAgent(s.ownerId) : null;
    const gov = s.governorId ? getAgent(s.governorId) : null;
    const garrison = s.garrisonUnitId ? getUnit(s.garrisonUnitId) : null;
    let html = '';
    if (s.siege) html += `<div class="thought" style="border-color:#ef5350">⚠ เมืองกำลังถูกล้อม! (วันที่ ${s.siege.days})</div>`;
    html += `<div class="insp-section"><h4>การปกครอง</h4>`;
    html += this.kv('ประเภท', s.type);
    html += this.kv('ฝ่าย', f ? `<span style="color:${f.color}">■</span> ${f.name}` : '—');
    html += this.kv('เจ้าของ', owner && owner.alive ? this.link('agent', owner.id, owner.name) : '—');
    html += this.kv('ผู้ปกครอง', gov && gov.alive ? this.link('agent', gov.id, gov.name) : '—');
    if (gov && gov.gov) {
      html += this.kv('· loyalty ของ governor', fmt(gov.gov.loyalty, 2), gov.gov.loyalty < 0.4 ? 'bad' : '');
      html += this.kv('· ambition', fmt(gov.gov.ambition, 2), gov.gov.ambition > 0.7 ? 'warn' : '');
      html += this.kv('· corruption', fmt(gov.gov.corruption, 2), gov.gov.corruption > 0.35 ? 'bad' : '');
    }
    html += this.kv('อัตราภาษี', fmt(s.taxRate * 100) + '%', s.taxRate > 0.22 ? 'bad' : '');
    html += this.kv('คลังเมือง', fmt(s.treasury) + ' ทอง');
    html += `</div>`;
    html += `<div class="insp-section"><h4>สังคม</h4>`;
    html += this.kv('ประชากร', populationOf(s));
    html += this.kv('Prosperity', fmt(s.prosperity)) + this.bar(s.prosperity, '#5dbb63');
    html += this.kv('Loyalty', fmt(s.loyalty), s.loyalty < 35 ? 'bad' : '') + this.bar(s.loyalty, '#42a5f5');
    html += this.kv('Unrest', fmt(s.unrest), s.unrest > 55 ? 'bad' : '') + this.bar(s.unrest, '#ef5350');
    html += this.kv('Crime', fmt(s.crime)) + this.bar(s.crime, '#ff8a65');
    html += this.kv('Security', fmt(s.security)) + this.bar(s.security, '#26c6da');
    if (s.drought > 0) html += this.kv('☀ ภัยแล้ง', `อีก ${s.drought} วัน`, 'bad');
    if (s.plague > 0) html += this.kv('☠ โรคระบาด', `ระดับ ${fmt(s.plague, 1)}`, 'bad');
    html += `</div>`;
    html += `<div class="insp-section"><h4>คลัง / ราคา (stock · demand · price)</h4>`;
    for (const g of GOODS) {
      const priceRatio = s.prices[g] / BASE_PRICE[g];
      html += this.kv(g, `${fmt(s.stock[g])} · ${fmt(s.demand[g])} · <b>${fmt(s.prices[g], 1)}</b>`,
        priceRatio > 2 ? 'bad' : priceRatio < 0.8 ? 'good' : '');
    }
    if (s.warDemand > 0) html += this.kv('⚔ War Demand', fmt(s.warDemand), 'warn');
    html += `</div>`;
    html += `<div class="insp-section"><h4>อาคาร</h4>`;
    html += s.buildings.length ? s.buildings.map(b => `<div class="kv"><span class="k">${b}</span><span class="v">${(BUILDINGS[b] || {}).effect || ''}</span></div>`).join('') : '<div class="kv"><span class="k">— ไม่มี —</span></div>';
    html += `</div>`;
    html += `<div class="insp-section"><h4>Garrison</h4>`;
    if (garrison && unitMembers(garrison).length) {
      html += this.kv('หน่วย', this.link('unit', garrison.id, garrison.name));
      html += this.kv('กำลังพล', unitMembers(garrison).length);
      html += this.kv('Morale', fmt(garrison.morale), garrison.morale < 35 ? 'bad' : '');
    } else html += `<div class="kv"><span class="k">— ไม่มีทหารประจำการ —</span></div>`;
    html += `</div>`;
    if (s.history.length) {
      html += `<div class="insp-section"><h4>ประวัติเมือง</h4>`;
      html += s.history.slice(-6).map(h => `<div class="kv"><span class="k">${h}</span></div>`).join('');
      html += `</div>`;
    }
    return html;
  },

  unitHTML(u) {
    const leader = getAgent(u.leaderId);
    const f = getFaction(u.factionId);
    const members = unitMembers(u);
    const s = getSettlement(u.locationId);
    const comp = {};
    for (const m of members) comp[m.profession] = (comp[m.profession] || 0) + 1;
    let html = `<div class="insp-section"><h4>ข้อมูลหน่วย</h4>`;
    html += this.kv('ประเภท', u.kind);
    html += this.kv('ผู้นำ', leader ? this.link('agent', leader.id, leader.name) : '—');
    html += this.kv('ฝ่าย', f ? f.name : 'อิสระ/กบฏ');
    html += this.kv('กำลังพล', members.length);
    if (leader) html += this.kv('Command Capacity', MilitarySystem.commandCapacity(leader), members.length > MilitarySystem.commandCapacity(leader) ? 'bad' : 'good');
    html += this.kv('ตำแหน่ง', u.travel ? 'กำลังเดินทาง' : (s ? this.link('settlement', s.id, s.name) : '—'));
    html += this.kv('ภารกิจ', u.objective.type);
    html += this.kv('พลังรบ', fmt(MilitarySystem.unitPower(u)));
    html += `</div>`;
    html += `<div class="insp-section"><h4>สภาพหน่วย</h4>`;
    html += this.kv('Morale', fmt(u.morale)) + this.bar(u.morale, '#ab47bc');
    html += this.kv('Cohesion', fmt(u.cohesion)) + this.bar(u.cohesion, '#42a5f5');
    html += this.kv('Fatigue', fmt(u.fatigue), u.fatigue > 60 ? 'bad' : '') + this.bar(u.fatigue, '#ff8a65');
    html += `</div>`;
    html += `<div class="insp-section"><h4>เสบียง</h4>`;
    html += this.kv('food', fmt(u.supply.food), u.supply.food < members.length ? 'bad' : '');
    html += this.kv('arrows', fmt(u.supply.arrows));
    html += this.kv('weapons', fmt(u.supply.weapons));
    if (u.lootGold) html += this.kv('ทองที่ปล้นมา', fmt(u.lootGold), 'warn');
    html += `</div>`;
    html += `<div class="insp-section"><h4>องค์ประกอบ</h4>`;
    for (const [p, n] of Object.entries(comp)) html += this.kv(p, n);
    html += `</div>`;
    if (u.battleHistory.length) {
      html += `<div class="insp-section"><h4>ประวัติการรบ</h4>`;
      html += u.battleHistory.slice(-5).map(b => `<div class="kv"><span class="k">Day ${b.day} vs ${b.vs}</span><span class="v ${b.won ? 'good' : 'bad'}">${b.won ? 'ชนะ' : 'แพ้'}</span></div>`).join('');
      html += `</div>`;
    }
    return html;
  },

  armyHTML(ar) {
    const commander = getAgent(ar.commanderId);
    const f = getFaction(ar.factionId);
    const units = ar.unitIds.map(getUnit).filter(Boolean);
    const totalMen = sum(units, u => unitMembers(u).length);
    let html = `<div class="insp-section"><h4>กองทัพ</h4>`;
    html += this.kv('แม่ทัพ', commander ? this.link('agent', commander.id, commander.name) : '—');
    html += this.kv('ฝ่าย', f ? f.name : '—');
    html += this.kv('กำลังพลรวม', totalMen);
    html += this.kv('จำนวนหน่วย', units.length);
    html += this.kv('ภารกิจ', ar.objective.type === 'attack' ? `บุก${(getSettlement(ar.objective.targetId) || {}).name || ''}` : ar.objective.type);
    html += this.kv('พลังรบ', fmt(MilitarySystem.armyPower(ar)));
    html += this.kv('Morale', fmt(ar.morale)) + this.bar(ar.morale, '#ab47bc');
    html += `</div>`;
    html += `<div class="insp-section"><h4>เสบียงกองทัพ</h4>`;
    for (const [k, v] of Object.entries(ar.supply)) html += this.kv(k, fmt(v), k === 'food' && v < totalMen * 3 ? 'bad' : '');
    html += `</div>`;
    html += `<div class="insp-section"><h4>หน่วยในสังกัด</h4>`;
    for (const u of units) html += this.kv(this.link('unit', u.id, u.name), unitMembers(u).length + ' นาย');
    html += `</div>`;
    return html;
  }
};

/* ── Sandbox Tools ── */
const SandboxTools = {
  needsTarget: new Set(['buildRoad', 'destroyRoad', 'addVillage', 'addTown', 'addFort', 'giveWealth', 'foodShortage', 'drought', 'plague']),

  activate(tool, btn) {
    // เครื่องมือกดแล้วทำทันที
    const instant = {
      addPeople: () => {
        const s = pick(marketSettlements());
        for (let i = 0; i < 10; i++) createAgent({ locationId: s.id, factionId: s.factionId, profession: 'unemployed' });
        EventSystem.add('system', `✨ [Sandbox] ผู้อพยพ 10 คนปรากฏตัวที่${s.name}`);
      },
      addTrader: () => {
        const s = pick(world.settlements.filter(x => x.type === 'town' || x.type === 'castle'));
        const t = createAgent({ locationId: s.id, factionId: s.factionId, profession: 'trader', money: 200 });
        t.inventory.cart = 1; t.durability.cart = 80; t.skills.trading = 3;
        EventSystem.add('system', `✨ [Sandbox] พ่อค้า ${t.name} เริ่มกิจการที่${s.name}`);
      },
      addBandits: () => {
        const camp = world.settlements.find(x => x.type === 'camp');
        if (!camp) return;
        for (let i = 0; i < 5; i++) {
          const b = createAgent({ locationId: camp.id, factionId: camp.factionId, profession: 'bandit', inventory: { weapon: 1 } });
          b.skills.fighting = rand(1, 4);
          b.traits.loyalty = rand(0.1, 0.3);
        }
        EventSystem.add('system', `✨ [Sandbox] โจร 5 คนเข้าร่วม${camp.name} — เส้นทางการค้าอันตรายขึ้น`);
      },
      warDemand: () => {
        const castle = world.settlements.find(x => x.type === 'castle');
        if (castle) {
          castle.warDemand = Math.min(10, castle.warDemand + 5);
          EventSystem.add('economy', `⚔ [Sandbox] ${castle.name} ประกาศซื้ออาวุธและแร่จำนวนมาก — เตรียมสงคราม!`);
        }
      },
      spawnRebels: () => {
        const s = pick(marketSettlements().filter(x => x.type !== 'castle'));
        s.unrest = 85; s.loyalty = 15;
        EventSystem.add('politics', `🔥 [Sandbox] ความไม่พอใจใน${s.name}ปะทุถึงขีดสุด — กบฏใกล้ระเบิด`);
      },
      improveRoads: () => {
        for (const r of world.routes) { r.danger = clamp(r.danger * 0.4, 0.02, 1); r.patrolLevel = Math.min(5, r.patrolLevel + 2); }
        EventSystem.add('system', `🛡 [Sandbox] ทุกเส้นทางได้รับการลาดตระเวน ความอันตรายลดลงมาก`);
      },
      createWar: () => {
        const kingdoms = world.factions.filter(f => !f.isBandit && world.settlements.some(s => s.factionId === f.id));
        if (kingdoms.length >= 2) {
          const [f1, f2] = [kingdoms[0], kingdoms[1]];
          f1.enemies.push(f2.id); f2.enemies.push(f1.id);
          f1.warState = true; f2.warState = true;
          EventSystem.add('war', `💥 [Sandbox] ${f1.name} ประกาศสงครามกับ ${f2.name}!`);
        } else if (kingdoms.length === 1) {
          // มีอาณาจักรเดียว → บังคับเมืองหนึ่งแยกตัวแล้วเปิดสงคราม
          const f = kingdoms[0];
          const towns = world.settlements.filter(s => s.factionId === f.id && s.type === 'town');
          if (towns.length) {
            const s = pick(towns);
            let gov = s.governorId ? getAgent(s.governorId) : null;
            if (!gov || !gov.alive) { GovernanceSystem.appointGovernor(s); gov = s.governorId ? getAgent(s.governorId) : null; }
            if (gov) {
              gov.gov = gov.gov || makeGovAttrs();
              gov.gov.loyalty = 0.05; gov.gov.ambition = 0.95;
              GovernanceSystem.declareIndependence(gov, s, f);
            }
          }
        }
      }
    };

    if (instant[tool]) { instant[tool](); return; }

    // เครื่องมือที่ต้องเลือกเป้าหมายบนแผนที่
    if (this.needsTarget.has(tool)) {
      this.disarm();
      UI.armedTool = tool;
      this.roadPickFirst = null;
      btn.classList.add('armed');
      document.getElementById('toolHint').textContent = ' — คลิกเป้าหมายบนแผนที่';
    }
  },

  applyAt(clientX, clientY) {
    const tool = UI.armedTool;
    const mapPos = Renderer.toMap(clientX, clientY);
    const picked = Renderer.pickAt(clientX, clientY);
    const pickedSettlement = picked && picked.kind === 'settlement' ? getSettlement(picked.id) : null;

    switch (tool) {
      case 'foodShortage':
        if (pickedSettlement) {
          pickedSettlement.stock.food = Math.floor(pickedSettlement.stock.food * 0.1);
          EventSystem.add('disaster', `🍞 [Sandbox] คลังอาหารของ${pickedSettlement.name}หายไปเกือบหมด — วิกฤตอาหารเริ่มขึ้น`);
          this.disarm();
        }
        break;
      case 'drought':
        if (pickedSettlement) {
          pickedSettlement.drought = 20;
          EventSystem.add('disaster', `☀ [Sandbox] ภัยแล้งครั้งใหญ่ที่${pickedSettlement.name} — ผลผลิตอาหารจะลดฮวบ 20 วัน`);
          this.disarm();
        }
        break;
      case 'plague':
        if (pickedSettlement) {
          pickedSettlement.plague = 1;
          EventSystem.add('disaster', `☠ [Sandbox] โรคระบาดอุบัติที่${pickedSettlement.name} — ประชาชนล้มป่วย`);
          this.disarm();
        }
        break;
      case 'giveWealth':
        if (pickedSettlement) {
          pickedSettlement.treasury += 1000;
          EventSystem.add('economy', `💰 [Sandbox] ${pickedSettlement.name} ได้รับทองวิเศษ 1000 — เศรษฐกิจคึกคัก`);
          this.disarm();
        }
        break;
      case 'buildRoad':
      case 'destroyRoad':
        if (pickedSettlement) {
          if (!this.roadPickFirst) {
            this.roadPickFirst = pickedSettlement.id;
            document.getElementById('toolHint').textContent = ` — เลือกแล้ว: ${pickedSettlement.name} คลิกอีกเมือง`;
          } else if (this.roadPickFirst !== pickedSettlement.id) {
            const existing = getRoute(this.roadPickFirst, pickedSettlement.id);
            if (tool === 'buildRoad') {
              if (existing) { existing.roadQuality = Math.min(1, existing.roadQuality + 0.3); EventSystem.add('system', `🛤 [Sandbox] ปรับปรุงถนนสู่${pickedSettlement.name}`); }
              else { createRoute(this.roadPickFirst, pickedSettlement.id, 0.7); EventSystem.add('system', `🛤 [Sandbox] สร้างถนนใหม่ระหว่าง${getSettlement(this.roadPickFirst).name}กับ${pickedSettlement.name}`); }
            } else if (existing) {
              existing.destroyed = true;
              EventSystem.add('disaster', `✖ [Sandbox] ถนนระหว่าง${getSettlement(this.roadPickFirst).name}กับ${pickedSettlement.name}ถูกทำลาย — การค้าชะงัก`);
            }
            this.disarm();
          }
        }
        break;
      case 'addVillage':
      case 'addTown':
      case 'addFort': {
        const typeMap = { addVillage: 'village', addTown: 'town', addFort: 'fort' };
        const type = typeMap[tool];
        const kingdom = world.factions.find(f => !f.isBandit);
        const s = createSettlement({
          name: type === 'village' ? `บ้านใหม่${randInt(1, 99)}` : type === 'town' ? `เมืองใหม่${randInt(1, 99)}` : `ป้อมใหม่${randInt(1, 99)}`,
          type, x: clamp(mapPos.x, 30, MAP_W - 30), y: clamp(mapPos.y, 30, MAP_H - 30),
          factionId: kingdom ? kingdom.id : null,
          ownerId: kingdom ? kingdom.rulerId : null,
          treasury: 200,
          stock: type === 'village' ? { food: 60, wood: 10 } : { food: 80, wood: 30, ore: 15, tools: 5, weapons: 5 },
          prod: type === 'village' ? { food: rand(1.5, 3), wood: rand(0.3, 2), ore: rand(0, 1.5) } : { food: 1, wood: 0.4, ore: 0.2 }
        });
        // เชื่อมถนนกับถิ่นฐานใกล้สุด
        const nearest = world.settlements.filter(x => x.id !== s.id)
          .reduce((m, x) => dist(x, s) < dist(m, s) ? x : m);
        createRoute(s.id, nearest.id, 0.5);
        // ประชากรตั้งต้น
        for (let i = 0; i < (type === 'village' ? 6 : 10); i++) {
          createAgent({ locationId: s.id, factionId: s.factionId, profession: type === 'fort' ? 'guard' : 'unemployed' });
        }
        EventSystem.add('system', `✨ [Sandbox] ${s.name} ถือกำเนิดขึ้นบนแผนที่ เชื่อมถนนกับ${nearest.name}`);
        this.disarm();
        break;
      }
    }
  },

  disarm() {
    UI.armedTool = null;
    this.roadPickFirst = null;
    document.getElementById('toolHint').textContent = '';
    document.querySelectorAll('.tool-btn.armed').forEach(b => b.classList.remove('armed'));
  }
};

/* ═══════════════════ 18. INIT ═══════════════════ */

generateWorld();
Renderer.init();
UI.init();
requestAnimationFrame(t => UI.loop(t));
