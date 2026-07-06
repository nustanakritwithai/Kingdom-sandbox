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
   Phase 10.5: Simulation Stability + Ambition + Combat Depth
   Phase 10.6: Logistics Cleanup + Local Consumption Fix
   Phase 13: Save / Load / Export World
   Phase 11: Diplomacy / Treaty / Vassal Negotiation
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

/* ── Phase 10.5: Equipment & combat definitions ── */
const WEAPON_DEFS = {
  sword:  { price: 60,  attack: 12, defense: 4,  accuracy: 0.75, durability: 80,  prof: 'swordsman' },
  spear:  { price: 45,  attack: 10, defense: 6,  accuracy: 0.7,  durability: 70,  prof: 'spearman', antiCavalry: 1.35 },
  axe:    { price: 50,  attack: 14, defense: 2,  accuracy: 0.65, durability: 65,  prof: 'swordsman' },
  bow:    { price: 45,  attack: 11, defense: 0,  accuracy: 0.8,  durability: 55,  prof: 'archer', ranged: true },
  shield: { price: 35,  attack: 2,  defense: 10, accuracy: 0,   durability: 90,  prof: null, antiRanged: 0.65 }
};
const ARMOR_DEFS = {
  cloth:     { price: 25,  armor: 4,  dodge: 0.05, fatigue: 1.0,  durability: 40 },
  leather:   { price: 55,  armor: 10, dodge: 0.08, fatigue: 1.1,  durability: 60 },
  chainmail: { price: 120, armor: 18, dodge: 0.03, fatigue: 1.25, durability: 90 },
  plate:     { price: 200, armor: 28, dodge: 0.01, fatigue: 1.45, durability: 120 }
};
const MOUNT_DEFS = {
  horse: { price: 120, attack: 4, speed: 50, charge: 1.3, durability: 70, prof: 'cavalry' }
};
const TOOL_DEF = { price: 35, workBonus: 1.5, durability: 50 };
const CART_DEF = { price: 80, capacity: 14, durability: 70 };

const MIGRATION_COOLDOWN_DAYS = 12;
const FORM_SQUAD_LEADERSHIP = 2.8;
const FORM_SQUAD_FIGHTING = 2.2;
const FORM_SQUAD_MONEY = 55;

function defaultCombatStats() {
  return {
    strength: rand(4, 8), agility: rand(4, 8), endurance: rand(4, 8), perception: rand(4, 8),
    intelligence: rand(4, 8), charisma: rand(4, 8), discipline: rand(4, 8), courage: rand(4, 8)
  };
}

function emptyEquipment() {
  return { mainHand: null, offHand: null, ranged: null, armor: null, mount: null, tool: null };
}

function equipSlot(type, slot) {
  if (!type) return null;
  const d = WEAPON_DEFS[type] || ARMOR_DEFS[type] || MOUNT_DEFS[type] || (type === 'tool' ? TOOL_DEF : null);
  if (!d) return null;
  return { type, slot, durability: d.durability || 50, maxDurability: d.durability || 50 };
}

function syncLegacyInventory(a) {
  if (!a.equipment) a.equipment = emptyEquipment();
  if (a.inventory.weapon > 0 && !a.equipment.mainHand) {
    a.equipment.mainHand = equipSlot('sword', 'mainHand');
    a.inventory.weapon = 0;
  }
  if (a.inventory.bow > 0 && !a.equipment.ranged) {
    a.equipment.ranged = equipSlot('bow', 'ranged');
    a.inventory.bow = 0;
  }
  if (a.inventory.horse > 0 && !a.equipment.mount) {
    a.equipment.mount = equipSlot('horse', 'mount');
    a.inventory.horse = 0;
  }
  if (a.inventory.tools > 0 && !a.equipment.tool) {
    a.equipment.tool = equipSlot('tool', 'tool');
    a.inventory.tools = 0;
  }
}

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

/* ═══════════ 3.5 CHRONICLE / LEGENDS / WAR HISTORY (Phase 10) ═══════════
   Chronicle    = บันทึกเฉพาะเหตุการณ์สำคัญ (แยกจาก event log รายวัน)
   Deeds/Fame   = วีรกรรมและชื่อเสียงของตัวละคร → notable agent / legend
   War objects  = ประวัติสงครามพร้อม summary อัตโนมัติ
   ═══════════════════════════════════════════════════════════════════════ */

const Chronicle = {
  // category: war | rebellion | settlement | legend | trade | disaster | faction | era
  add(opt) {
    const e = {
      id: uid(), day: world.day,
      category: opt.category,
      importance: opt.importance || 2,      // 1-5
      title: opt.title,
      description: opt.description || '',
      agents: opt.agents || [],             // agent ids ที่เกี่ยวข้อง
      settlements: opt.settlements || [],
      factions: opt.factions || []
    };
    world.chronicle.push(e);
    if (world.chronicle.length > 500) world.chronicle.splice(0, world.chronicle.length - 500);
    UI.chronicleDirty = true;
    return e;
  }
};

/* ── วีรกรรม + ชื่อเสียง — ตัวละครกลายเป็น notable agent เมื่อ fame ถึงเกณฑ์ ── */
function addDeed(a, text, fame, title) {
  if (!a || !a.alive) return;
  a.deeds.push({ day: world.day, text });
  if (a.deeds.length > 15) a.deeds.shift();
  a.fame = (a.fame || 0) + fame;
  a.legacyScore = (a.legacyScore || 0) + fame;
  if (title && fame >= (a._titleFame || 0)) { a.title = title; a._titleFame = fame; }
  if (a.fame >= 20 && !a.notable) {
    a.notable = true;
    Chronicle.add({
      category: 'legend', importance: 3,
      title: `⭐ ${a.name} เริ่มเป็นที่เลื่องลือในแผ่นดิน`,
      description: text, agents: [a.id]
    });
  }
}

function factionTimeline(f, text) {
  if (!f) return;
  f.timeline.push({ day: world.day, text });
  if (f.timeline.length > 40) f.timeline.shift();
}

function settlementHistory(s, text) {
  if (!s) return;
  s.history.push(`Day ${world.day}: ${text}`);
  if (s.history.length > 40) s.history.shift();
}

/* ── ตั้งชื่อศึกอัตโนมัติจากสถานที่ + ชนิด + ขนาด ── */
function battleName(kind, label, totalMen) {
  const big = totalMen >= 12 ? 'ครั้งใหญ่' : '';
  switch (kind) {
    case 'raid': return `การปล้น${label}${big}`;
    case 'capture': return `ยุทธการ${label}`;
    case 'siege': return `การล้อม${label}`;
    case 'rebellion': return `การลุกฮือแห่ง${label}`;
    default: return `ศึก${label}${big}`;
  }
}

/* ── War Chronicle ── */
function activeWarBetween(fAId, fBId) {
  return world.wars.find(w => !w.endDay &&
    ((w.attackerId === fAId && w.defenderId === fBId) || (w.attackerId === fBId && w.defenderId === fAId)));
}

function startWar(attackerF, defenderF, cause) {
  if (!attackerF || !defenderF || attackerF.id === defenderF.id) return null;
  let w = activeWarBetween(attackerF.id, defenderF.id);
  if (w) return w;
  w = {
    id: uid(),
    name: `สงคราม${attackerF.name.replace('ราชอาณาจักร', '')}–${defenderF.name.replace('ราชอาณาจักร', '')}`,
    attackerId: attackerF.id, defenderId: defenderF.id,
    startDay: world.day, endDay: null, cause: cause || '',
    battles: [], captured: [], casualties: 0,
    winner: null, summary: null
  };
  world.wars.push(w);
  attackerF.warState = true; defenderF.warState = true;
  if (!attackerF.enemies.includes(defenderF.id)) attackerF.enemies.push(defenderF.id);
  if (!defenderF.enemies.includes(attackerF.id)) defenderF.enemies.push(attackerF.id);
  if (typeof DiplomacySystem !== 'undefined') DiplomacySystem.onWarDeclared(attackerF, defenderF, cause);
  factionTimeline(attackerF, `ประกาศสงครามกับ${defenderF.name}`);
  factionTimeline(defenderF, `ถูก${attackerF.name}ประกาศสงคราม`);
  Chronicle.add({
    category: 'war', importance: 5,
    title: `⚔ สงครามปะทุ: ${attackerF.name} vs ${defenderF.name}`,
    description: cause || 'ความขัดแย้งบานปลายเป็นสงครามเต็มรูปแบบ',
    factions: [attackerF.id, defenderF.id]
  });
  return w;
}

function endWar(w, winnerId, reason, peaceOpts) {
  if (!w || w.endDay) return;
  w.endDay = world.day;
  w.winner = winnerId;
  w.peaceType = peaceOpts?.peaceType || null;
  const att = getFaction(w.attackerId), def = getFaction(w.defenderId);
  const winF = winnerId ? getFaction(winnerId) : null;
  const days = Math.max(1, w.endDay - w.startDay);
  const capturedNames = w.captured.map(c => c.name).join(' และ ');
  let endNote = '';
  if (w.peaceType === 'peace_treaty') endNote = ' จบด้วยสนธิสัญญาสันติภาพ';
  else if (w.peaceType === 'surrender' && winF) endNote = ` ฝ่าย${winF.id === att?.id ? def?.name : att?.name}ยอมจำนน`;
  else if (w.peaceType === 'vassalage' && winF) {
    const loser = winF.id === att?.id ? def : att;
    endNote = loser ? ` ฝ่าย${loser.name}กลายเป็นเมืองขึ้นของ${winF.name}` : '';
  }
  w.summary = `สงครามระหว่าง${att ? att.name : 'ฝ่ายที่สูญสิ้น'}กับ${def ? def.name : 'ฝ่ายที่สูญสิ้น'}กินเวลา ${days} วัน`
    + (w.battles.length ? ` มีศึกสำคัญ ${w.battles.length} ครั้ง` : '')
    + (w.casualties ? ` สูญเสียรวม ${w.casualties} ชีวิต` : '')
    + (winF ? ` จบลงด้วยชัยชนะของ${winF.name}` + (capturedNames ? ` หลังยึด${capturedNames}ได้สำเร็จ` : '')
            : ' จบลงโดยไม่มีผู้ชนะเด็ดขาด')
    + endNote
    + (reason ? ` (${reason})` : '');
  for (const [f, other] of [[att, def], [def, att]]) {
    if (!f) continue;
    f.enemies = f.enemies.filter(e => e !== (other ? other.id : -1));
    if (!f.enemies.length) f.warState = false;
    factionTimeline(f, `สงครามกับ${other ? other.name : 'ศัตรู'}สิ้นสุด${winnerId === f.id ? ' — ได้รับชัยชนะ' : winnerId ? ' — พ่ายแพ้' : ''}`);
  }
  if (typeof DiplomacySystem !== 'undefined') DiplomacySystem.onWarEnded(w, winnerId, reason, peaceOpts);
  Chronicle.add({
    category: 'war', importance: 5,
    title: `🕊 สงครามสิ้นสุด: ${att ? att.name : '?'} vs ${def ? def.name : '?'}`,
    description: w.summary,
    factions: [w.attackerId, w.defenderId]
  });
  EventSystem.add('war', `🕊 ${w.summary}`);
}

/* ── สรุปชีวิตตัวละครเป็นภาษาไทยสั้นๆ ── */
function lifeSummary(a) {
  const birthplace = getSettlement(a.birthplaceId);
  const first = a.career[0];
  const profTH = {
    farmer: 'ชาวนา', woodcutter: 'คนตัดไม้', miner: 'คนงานเหมือง', crafter: 'ช่างฝีมือ',
    trader: 'พ่อค้า', guard: 'ยาม', bandit: 'โจร', militia: 'ทหารบ้าน', swordsman: 'นักดาบ',
    spearman: 'พลหอก', archer: 'นักธนู', cavalry: 'ทหารม้า', captain: 'นายกอง',
    commander: 'แม่ทัพ', mayor: 'เจ้าเมือง', lord: 'ขุนนาง', king: 'ราชา',
    unemployed: 'คนว่างงาน', migrant: 'ผู้อพยพ', refugee: 'ผู้ลี้ภัย'
  };
  let txt = `เริ่มชีวิตเป็น${profTH[first.profession] || first.profession}ที่${birthplace ? birthplace.name : 'แดนไกล'}`;
  const changes = a.career.length - 1;
  if (changes >= 2) txt += ` ผ่านมาแล้ว ${changes} อาชีพ`;
  if (a.memory.citiesVisited.length >= 2) txt += ` เดินทางผ่าน ${a.memory.citiesVisited.length} ถิ่นฐาน`;
  const totalBattles = a.memory.battlesWon + a.memory.battlesLost;
  if (totalBattles > 0) txt += ` ผ่านศึกมา ${totalBattles} ครั้ง (ชนะ ${a.memory.battlesWon})`;
  if (a.memory.raidsDone >= 3) txt += ` เคยร่วมปล้นถึง ${a.memory.raidsDone} ครั้ง`;
  if (a.memory.tradeProfit >= 200) txt += ` ทำกำไรจากการค้ารวม ${fmt(a.memory.tradeProfit)} ทอง`;
  if (a.deeds.length) {
    const lastDeed = a.deeds[a.deeds.length - 1];
    txt += ` วีรกรรมล่าสุด: ${lastDeed.text}`;
  }
  if (a.alive) {
    const now = profTH[a.profession] || a.profession;
    txt += ` ปัจจุบันเป็น${now}${a.title ? `ฉายา "${a.title}"` : ''}`;
  }
  return txt;
}

// บันทึกศึกเข้า war object (ถ้ามีสงครามระหว่างสอง faction นี้)
function recordWarBattle(atkFactionId, defFactionId, name, dead, attackerWon) {
  const w = atkFactionId && defFactionId ? activeWarBetween(atkFactionId, defFactionId) : null;
  if (!w) return;
  w.battles.push({ day: world.day, name, dead, attackerWon });
  w.casualties += dead;
}

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
    foundedDay: world.day,
    timesRaided: 0, timesCaptured: 0,
    pastRulers: [],                      // ชื่อผู้ปกครองในอดีต
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
    history: [],
    // ── Phase 10.5: migration & logistics ──
    housingCapacity: opt.housingCapacity != null ? opt.housingCapacity : ({ village: 18, town: 35, fort: 22, castle: 28, camp: 12 }[opt.type] || 15),
    jobSlots: opt.jobSlots != null ? opt.jobSlots : ({ village: 14, town: 28, fort: 16, castle: 22, camp: 8 }[opt.type] || 12),
    crowding: 0,
    foodPerCapita: 0,
    foodReserveTargetDays: opt.foodReserveTargetDays != null ? opt.foodReserveTargetDays : 4,
    maxFoodExportRatio: opt.maxFoodExportRatio != null ? opt.maxFoodExportRatio : 0.5,
    recentInbound: 0,
    townCaravanId: null,
    emergencyCaravanId: null,
    caravanSubsidy: 0
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
    destroyed: false,
    // ── Phase 10.5: route security ──
    threat: 0,
    recentRaids: 0,
    caravanLosses: 0,
    bounty: 0,
    patrolMissionId: null,
    priceGapFood: 0
  };
  world.routes.push(r);
  return r;
}

function createFaction(opt) {
  const personalities = ['balanced', 'aggressive', 'trader', 'defensive', 'opportunist', 'honorable'];
  const f = {
    id: uid(),
    name: opt.name,
    color: opt.color,
    rulerId: opt.rulerId || null,
    isBandit: !!opt.isBandit,
    treasury: opt.treasury || 0,
    warState: false,
    enemies: [], allies: [],
    vassalIds: [],
    foundedDay: world.day,
    timeline: [],
    diplomacy: {
      relations: {},
      warExhaustion: 0,
      diplomaticPersonality: opt.diplomaticPersonality || pick(personalities),
      diplomaticMemory: []
    }
  };
  world.factions.push(f);
  f.timeline.push({ day: world.day, text: `ก่อตั้ง${f.name}` });
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
    // ── Phase 10: legend/history ──
    fame: 0, legacyScore: 0,
    title: null, notable: false,
    deeds: [],                                    // [{day, text}]
    career: [{ day: world.day, profession: opt.profession || 'unemployed' }],
    birthplaceId: opt.locationId,
    stats: { hunger: rand(60, 95), energy: rand(60, 100), health: 100, morale: rand(50, 75), wealth: 0 },
    money: opt.money != null ? opt.money : randInt(10, 40),
    inventory: Object.assign({ food: randInt(1, 4), wood: 0, ore: 0, tools: 0, weapon: 0, bow: 0, horse: 0, cart: 0 }, opt.inventory || {}),
    durability: { tools: 0, weapon: 0, cart: 0 },   // legacy — sync กับ equipment
    equipment: opt.equipment || emptyEquipment(),
    combatStats: Object.assign(defaultCombatStats(), opt.combatStats || {}),
    derivedStats: null,
    // ── Phase 10.5: ambition & wealth progression ──
    ambitionPlan: opt.ambitionPlan || 'survive',
    savingGoal: opt.savingGoal || 0,
    nextPurchase: opt.nextPurchase || null,
    lastMigrationDay: -99,
    isTownCaravan: !!opt.isTownCaravan,
    caravanOwnerId: opt.caravanOwnerId || null,
    isEmergencyCaravan: !!opt.isEmergencyCaravan,
    emergencyDestId: opt.emergencyDestId || null,
    emergencyDonorId: opt.emergencyDonorId || null,
    wantedLevel: 0,
    skills: Object.assign(DEFAULT_SKILLS(), opt.skills || {}),
    traits: {
      bravery: rand(0.15, 0.9), greed: rand(0.15, 0.9), loyalty: rand(0.2, 0.95),
      ambition: rand(0.1, 0.95), riskTolerance: rand(0.1, 0.9), discipline: rand(0.2, 0.9)
    },
    memory: { battlesWon: 0, battlesLost: 0, survivedBattles: 0, citiesVisited: [], daysHungry: 0, raidsDone: 0, tradeProfit: 0 },
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
    armyId: null,
    // ── Phase 10.5 ──
    recentVictories: 0,
    equipmentPower: 0,
    combatPower: 0
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
    seed: ((Date.now() ^ (Math.random() * 0x7fffffff | 0)) >>> 0),
    worldName: 'ราชอาณาจักรสุวรรณ',
    _createdAt: new Date().toISOString(),
    settlements: [], routes: [], agents: [], units: [], armies: [], factions: [],
    events: [],
    chronicle: [], wars: [], eras: [],
    treaties: [], vassalContracts: [],
    stats: { deaths: 0, battles: 0, raids: 0, caravansRobbed: 0, squadsFormed: 0, gearBought: 0, bountiesPosted: 0, traderSpawns: 0, townCaravans: 0, townCaravansLost: 0, townCaravansReplaced: 0, localRations: 0, emergencyCaravans: 0, emergencyFallbacks: 0 }
  };

  // ── Factions ──
  const kingdom = createFaction({ name: 'ราชอาณาจักรสุวรรณ', color: '#42a5f5', treasury: 1500 });
  world.worldName = kingdom.name;
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

  // ── Phase 11: rival kingdom for diplomacy ──
  const northK = createFaction({ name: 'อาณาจักรเหนือ', color: '#26a69a', treasury: 650, diplomaticPersonality: 'trader' });
  const northTown = createSettlement({
    name: 'เมืองชายแดนเหนือ', type: 'town', x: 200, y: 90, factionId: northK.id,
    treasury: 450, stock: { food: 100, wood: 50, ore: 25, tools: 10 },
    buildings: ['Market'], prod: { food: 1, wood: 0.4, ore: 0.2 }
  });
  const northVillage = createSettlement({
    name: 'บ้านหนาวเหนือ', type: 'village', x: 120, y: 160, factionId: northK.id,
    treasury: 120, stock: { food: 90, wood: 25 }, prod: { food: 2.5, wood: 0.5, ore: 0 }
  });
  const northKing = createAgent({
    locationId: northTown.id, factionId: northK.id, profession: 'king', money: 400,
    skills: { governance: 6, leadership: 7, diplomacy: 6, tactics: 4 }
  });
  northKing.rank = 'king';
  northK.rulerId = northKing.id;
  northTown.ownerId = northKing.id;
  northVillage.ownerId = northKing.id;
  for (let i = 0; i < 6; i++) {
    const ag = createAgent({ locationId: northVillage.id, factionId: northK.id, profession: i < 4 ? 'farmer' : 'guard' });
    seedSkillForProfession(ag, ag.profession);
  }
  createRoute(townN.id, northTown.id, 0.55);
  createRoute(fort.id, northTown.id, 0.45);
  createRoute(northTown.id, northVillage.id, 0.5);

  // จัด garrison เริ่มต้นให้ fort/castle/towns
  for (const s of [fort, castle, townN, townS, northTown]) ensureGarrison(s);

  EventSystem.add('system', `🌍 โลกใหม่ถือกำเนิด — ${world.agents.length} ชีวิตใน ${world.settlements.length} ถิ่นฐาน ภายใต้${kingdom.name}`);
  DiplomacySystem.initWorld();
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
  syncLegacyInventory(ag);
  if (prof === 'trader') { ag.money = randInt(80, 200); ag._hasCart = chance(0.5); if (ag._hasCart) ag._cartDurability = CART_DEF.durability; }
  if (prof === 'swordsman') ag.equipment.mainHand = equipSlot('sword', 'mainHand');
  if (prof === 'spearman') ag.equipment.mainHand = equipSlot('spear', 'mainHand');
  if (prof === 'archer') ag.equipment.ranged = equipSlot('bow', 'ranged');
  if (prof === 'cavalry') { ag.equipment.mount = equipSlot('horse', 'mount'); ag.equipment.mainHand = equipSlot('sword', 'mainHand'); }
  if (prof === 'guard' || prof === 'bandit') ag.equipment.mainHand = equipSlot(chance(0.5) ? 'spear' : 'sword', 'mainHand');
  if (MILITARY_PROFS.has(prof) && chance(0.3)) ag.equipment.offHand = equipSlot('shield', 'offHand');
  if (['farmer', 'woodcutter', 'miner'].includes(prof) && chance(0.6)) {
    ag.equipment.tool = equipSlot('tool', 'tool');
  }
  AmbitionSystem.planFor(ag);
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
    if (!r) { // ถนนถูกทำลายระหว่างทาง
      entity.locationId = aId;
      if (entity.alive !== undefined && (entity.isTownCaravan || entity.isEmergencyCaravan)) {
        clearTownCaravan(entity, 'lost');
        if (entity.cargo) entity.cargo = null;
      }
      entity.travel = null;
      return false;
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
  const forExport = a.cargo || a.isTownCaravan || a.isEmergencyCaravan || (a.profession === 'trader' && a.cargo);
  const got = forExport
    ? EconomySystem.buyFoodForExport(a, s, need)
    : EconomySystem.buyFoodForLocalConsumption(a, s, need);
  a.inventory.food += got;
}

/* ── Phase 10.6: town/emergency caravan slot cleanup ── */
function clearTownCaravan(agent, reason) {
  if (!agent) return;
  const wasTown = agent.isTownCaravan && agent.caravanOwnerId;
  const wasEmergency = agent.isEmergencyCaravan;

  if (wasTown) {
    const owner = getSettlement(agent.caravanOwnerId);
    if (owner && owner.townCaravanId === agent.id) {
      owner.townCaravanId = null;
      if (reason === 'robbed' || reason === 'lost' || reason === 'death') {
        EventSystem.add('trade', `🚨 คาราวานเมือง${owner.name}สูญหาย (${reason === 'robbed' ? 'ถูกปล้น' : reason === 'death' ? 'ผู้ขนตาย' : 'สูญหาย'})`);
        world.stats.townCaravansLost = (world.stats.townCaravansLost || 0) + 1;
        owner._lastTownCaravanLostDay = world.day;
      } else if (reason === 'delivered') {
        if (owner) owner.stock.food += Math.floor((agent.cargo?.qty || 0) * 0.1);
      } else if (reason === 'replaced') {
        EventSystem.add('trade', `🐪 ${owner.name} จัดคาราวานเมืองใหม่แทนที่เดิม`);
        world.stats.townCaravansReplaced = (world.stats.townCaravansReplaced || 0) + 1;
      }
    }
    agent.isTownCaravan = false;
    agent.caravanOwnerId = null;
  }

  if (wasEmergency) {
    const needy = agent.emergencyDestId ? getSettlement(agent.emergencyDestId) : null;
    if (needy && needy.emergencyCaravanId === agent.id) needy.emergencyCaravanId = null;
    agent.isEmergencyCaravan = false;
    agent.emergencyDestId = null;
    agent.emergencyDonorId = null;
  }
}

function agentSpeed(a) {
  syncLegacyInventory(a);
  let sp = 80;
  if (a.equipment && a.equipment.mount) sp += MOUNT_DEFS.horse.speed;
  else if (a.inventory.horse > 0) sp += 50;
  if (a.cargo && (a.inventory.cart > 0 || a._hasCart)) sp -= 8;
  else if (a.cargo) sp -= 15;
  if (a.stats.energy < 30) sp *= 0.7;
  const ds = CombatSystem.deriveStats(a);
  sp += ds.agility * 0.5;
  return sp;
}

/* ═══════════ 6.5 PHASE 10.5 SYSTEMS ═══════════ */

const SettlementMetrics = {
  update(s) {
    const pop = populationOf(s);
    s.crowding = pop / Math.max(s.housingCapacity, 1);
    s.foodPerCapita = pop > 0 ? s.stock.food / pop : s.stock.food;
    if (s.recentInbound > 0) s.recentInbound = Math.max(0, s.recentInbound - 0.15);
  },

  exportableFood(s) {
    const pop = populationOf(s);
    const reserve = pop * s.foodReserveTargetDays;
    const surplus = Math.max(0, s.stock.food - reserve);
    const maxExport = s.stock.food * s.maxFoodExportRatio;
    return Math.floor(Math.min(surplus, maxExport));
  },

  expectedWage(s, prof) {
    const base = s.prices[({ farmer: 'food', woodcutter: 'wood', miner: 'ore', crafter: 'tools' }[prof] || 'food')] || 10;
    const crowdWage = base * EconomySystem.crowding(s, prof);
    return crowdWage * clamp(1 - (s.crowding - 1) * 0.35, 0.45, 1.2);
  },

  migrationScore(a, from, to, path) {
    if (!to || to.id === from.id || to.siege) return -Infinity;
    const pop = populationOf(to);
    const foodAvail = to.foodPerCapita / 3;
    const foodPricePenalty = (to.prices.food / BASE_PRICE.food - 1) * 12;
    const expectedWage = (SettlementMetrics.expectedWage(to, 'farmer') + SettlementMetrics.expectedWage(to, 'woodcutter')) / 2;
    const safety = (to.security + (100 - to.crime)) / 200;
    const jobOpp = clamp((to.jobSlots - pop * 0.6) / Math.max(to.jobSlots, 1), -0.5, 1);
    const crowdingPenalty = Math.max(0, to.crowding - 0.85) * 35;
    const housingPressure = Math.max(0, pop - to.housingCapacity) * 2.2;
    const recentMigrationPenalty = to.recentInbound * 4;
    let travelDanger = 0;
    if (path) {
      for (let i = 0; i < path.length - 1; i++) {
        const r = getRoute(path[i], path[i + 1]);
        if (r) travelDanger += (r.threat || r.danger) * 8;
      }
    }
    const cooldownPenalty = (world.day - a.lastMigrationDay < MIGRATION_COOLDOWN_DAYS) ? 40 : 0;
    return foodAvail * 18 + expectedWage * 0.4 + safety * 22 + jobOpp * 15
      - foodPricePenalty - crowdingPenalty - housingPressure - recentMigrationPenalty
      - travelDanger - path.length * 4 - cooldownPenalty + to.prosperity * 0.15;
  }
};

const CombatSystem = {
  deriveStats(a) {
    syncLegacyInventory(a);
    const c = a.combatStats;
    const sk = a.skills;
    const eq = a.equipment || emptyEquipment();
    let attack = c.strength * 1.2 + sk.fighting * 2 + sk.sword * 1.5 + sk.spear * 1.2 + sk.archery * 1.3;
    let defense = c.endurance * 0.8 + c.discipline * 0.5;
    let armor = 0, dodge = c.agility * 0.02, accuracy = 0.55 + c.perception * 0.03 + sk.archery * 0.04;
    let initiative = c.agility * 0.6 + c.perception * 0.4;
    let moraleResistance = c.courage * 0.08 + c.discipline * 0.06;
    let carryingCapacity = 8 + c.strength * 0.8;
    let fatigueMod = 1;
    const slots = ['mainHand', 'offHand', 'ranged', 'armor', 'mount'];
    for (const slot of slots) {
      const item = eq[slot];
      if (!item || item.durability <= 0) continue;
      const ratio = item.durability / Math.max(item.maxDurability, 1);
      const t = item.type;
      if (WEAPON_DEFS[t]) {
        attack += WEAPON_DEFS[t].attack * ratio;
        defense += WEAPON_DEFS[t].defense * ratio;
        if (WEAPON_DEFS[t].accuracy) accuracy += WEAPON_DEFS[t].accuracy * 0.15 * ratio;
      }
      if (ARMOR_DEFS[t]) {
        armor += ARMOR_DEFS[t].armor * ratio;
        dodge += ARMOR_DEFS[t].dodge * ratio;
        fatigueMod *= ARMOR_DEFS[t].fatigue;
      }
      if (MOUNT_DEFS[t]) {
        attack += MOUNT_DEFS[t].attack * ratio;
        initiative += 3 * ratio;
      }
    }
    const commandBonus = sk.leadership * 1.5 + sk.tactics * 0.8 + c.charisma * 0.3 + a.reputation * 0.05;
    a.derivedStats = {
      attack, defense, armor, dodge: clamp(dodge, 0, 0.45), accuracy: clamp(accuracy, 0.3, 0.95),
      initiative, moraleResistance, carryingCapacity, commandBonus, fatigueMod
    };
    return a.derivedStats;
  },

  agentPower(a, terrain) {
    if (!a || !a.alive) return 0;
    const ds = this.deriveStats(a);
    const morale = 0.5 + a.stats.morale / 150;
    const health = 0.55 + a.stats.health / 220;
    const fatigue = clamp(1 - (100 - a.stats.energy) / 200, 0.5, 1);
    let p = (ds.attack + ds.defense * 0.6 + ds.armor * 0.4) * morale * health * fatigue;
    const mh = a.equipment?.mainHand?.type;
    const rg = a.equipment?.ranged?.type;
    const mt = a.equipment?.mount?.type;
    if (terrain === 'open' && mt) p *= 1.2;
    if (terrain === 'close' && mh === 'sword') p *= 1.15;
    if (terrain === 'range' && rg === 'bow') p *= 1.25;
    return p;
  },

  matchupMod(attacker, defender, terrain) {
    let mod = 1;
    const aMH = attacker.equipment?.mainHand?.type;
    const aRG = attacker.equipment?.ranged?.type;
    const aMT = attacker.equipment?.mount?.type;
    const dMH = defender.equipment?.mainHand?.type;
    const dMT = defender.equipment?.mount?.type;
    const dOH = defender.equipment?.offHand?.type;
    if (aMH === 'spear' && dMT) mod *= 1.25;
    if (aMT && (defender.equipment?.ranged?.type === 'bow' || defender.profession === 'archer') && terrain === 'open') mod *= 1.2;
    if (aRG === 'bow' && terrain === 'range') mod *= 1.2;
    if (aRG === 'bow' && dOH === 'shield') mod *= 0.75;
    if (dMH === 'sword' && terrain === 'close') mod *= 0.9;
    return mod;
  },

  applyBattleWear(units, won) {
    for (const u of units) {
      for (const m of unitMembers(u)) {
        const ds = this.deriveStats(m);
        const wear = won ? rand(2, 8) : rand(5, 15);
        for (const slot of Object.keys(m.equipment || {})) {
          const item = m.equipment[slot];
          if (item) {
            item.durability = Math.max(0, item.durability - wear * (slot === 'armor' ? 1.3 : 1));
            if (item.durability <= 0) m.equipment[slot] = null;
          }
        }
        if (!won && chance(0.12)) {
          m.stats.health -= randInt(5, 20);
          m.stats.morale = clamp(m.stats.morale - 8, 0, 100);
        }
        if (won) m.skills.fighting = Math.min(10, m.skills.fighting + 0.08);
        m.derivedStats = null;
      }
    }
  },

  inferProfession(a) {
    syncLegacyInventory(a);
    const eq = a.equipment;
    if (eq.ranged?.type === 'bow' && eq.ranged.durability > 0) return 'archer';
    if (eq.mount?.type === 'horse' && eq.mount.durability > 0) return 'cavalry';
    if (eq.mainHand?.type === 'spear') return 'spearman';
    if (eq.mainHand?.type === 'sword' || eq.mainHand?.type === 'axe') return 'swordsman';
    if (MILITARY_PROFS.has(a.profession)) return a.profession;
    return a.profession;
  },

  // สำหรับทดสอบ matchup cavalry vs archer
  testCavalryVsArcher() {
    const cav = { equipment: { mount: { type: 'horse', durability: 70, maxDurability: 70 } }, profession: 'cavalry', combatStats: defaultCombatStats(), skills: DEFAULT_SKILLS(), stats: { morale: 70, health: 100, energy: 80 }, alive: true };
    const archMH = { equipment: { ranged: { type: 'bow', durability: 50, maxDurability: 50 } }, profession: 'archer', combatStats: defaultCombatStats(), skills: DEFAULT_SKILLS(), stats: { morale: 70, health: 100, energy: 80 }, alive: true };
    const archWrong = { equipment: { mainHand: { type: 'sword', durability: 50, maxDurability: 50 } }, profession: 'cavalry', combatStats: defaultCombatStats(), skills: DEFAULT_SKILLS(), stats: { morale: 70, health: 100, energy: 80 }, alive: true };
    const withMatch = this.matchupMod(cav, archMH, 'open');
    const withoutMatch = this.matchupMod(cav, archWrong, 'open');
    const closeNoBonus = this.matchupMod(cav, archMH, 'close');
    return { withMatch, withoutMatch, closeNoBonus, diff: withMatch - withoutMatch };
  }
};

const AmbitionSystem = {
  planFor(a) {
    if (RULER_PROFS.has(a.profession) || a.unitId || a.travel) return;
    if (a.profession === 'trader' || a.isTownCaravan) {
      a.ambitionPlan = a.money > 200 ? 'caravan_company' : a.inventory.cart > 0 || a._hasCart ? 'expand_trade' : 'buy_cart';
      a.nextPurchase = a.ambitionPlan === 'buy_cart' ? 'cart' : (a.money > 150 ? 'hire_guard' : null);
      a.savingGoal = a.ambitionPlan === 'buy_cart' ? CART_DEF.price : (a.ambitionPlan === 'caravan_company' ? 250 : 120);
    } else if (MILITARY_PROFS.has(a.profession) || a.skills.fighting > 3) {
      a.ambitionPlan = a.skills.leadership > 3 ? 'form_squad' : 'buy_weapon';
      a.nextPurchase = a.equipment?.mainHand ? (a.equipment?.armor ? 'recruit' : 'armor') : 'sword';
      a.savingGoal = a.ambitionPlan === 'form_squad' ? FORM_SQUAD_MONEY : (WEAPON_DEFS[a.nextPurchase]?.price || ARMOR_DEFS.leather.price);
    } else if (WORKER_PROFS.includes(a.profession)) {
      a.ambitionPlan = 'buy_tool';
      a.nextPurchase = 'tool';
      a.savingGoal = TOOL_DEF.price;
    } else if (a.traits.ambition > 0.7 && a.skills.leadership > 2.5) {
      a.ambitionPlan = 'rise_leader';
      a.savingGoal = FORM_SQUAD_MONEY;
      a.nextPurchase = 'sword';
    } else {
      a.ambitionPlan = 'survive';
      a.savingGoal = Math.max(40, a.savingGoal);
    }
  },

  tryPurchase(a, s) {
    if (!s || s.type === 'camp' || !a.nextPurchase || a.money < (a.savingGoal || 999)) return false;
    syncLegacyInventory(a);
    const item = a.nextPurchase;
    let bought = false;

    const buyWeapon = (type, slot) => {
      const def = WEAPON_DEFS[type];
      if (!def || a.money < def.price || s.stock.weapons < 1 && type !== 'shield') return false;
      if (s.stock.weapons >= 1) s.stock.weapons -= 1;
      else if (s.treasury < def.price * 0.5) return false;
      a.money -= def.price;
      s.treasury += def.price;
      a.equipment[slot] = equipSlot(type, slot);
      return true;
    };

    switch (item) {
      case 'tool':
        if (s.stock.tools >= 1 && a.money >= s.prices.tools) {
          const got = EconomySystem.buyFromSettlement(a, s, 'tools', 1);
          if (got) { a.equipment.tool = equipSlot('tool', 'tool'); bought = true; }
        }
        break;
      case 'cart':
        if (a.money >= CART_DEF.price) {
          a.money -= CART_DEF.price; s.treasury += CART_DEF.price;
          a._hasCart = true; a._cartDurability = CART_DEF.durability; bought = true;
        }
        break;
      case 'sword': bought = buyWeapon('sword', 'mainHand'); break;
      case 'spear': bought = buyWeapon('spear', 'mainHand'); break;
      case 'bow': bought = buyWeapon('bow', 'ranged'); break;
      case 'shield': bought = buyWeapon('shield', 'offHand'); break;
      case 'armor':
        for (const tier of ['leather', 'chainmail', 'cloth']) {
          if (a.money >= ARMOR_DEFS[tier].price && s.treasury >= ARMOR_DEFS[tier].price * 0.3) {
            a.money -= ARMOR_DEFS[tier].price; s.treasury += ARMOR_DEFS[tier].price;
            a.equipment.armor = equipSlot(tier, 'armor');
            bought = true; break;
          }
        }
        break;
      case 'horse':
        if (s.stock.horses >= 1 && a.money >= s.prices.horses) {
          const got = EconomySystem.buyFromSettlement(a, s, 'horses', 1);
          if (got) { a.equipment.mount = equipSlot('horse', 'mount'); bought = true; }
        }
        break;
    }

    if (bought) {
      world.stats.gearBought = (world.stats.gearBought || 0) + 1;
      const prof = CombatSystem.inferProfession(a);
      if (MILITARY_PROFS.has(prof) && !RULER_PROFS.has(a.profession)) a.profession = prof;
      EventSystem.add('life', `🛒 ${a.name} ซื้อ${item} — กำลังเตรียมตัวสู่${a.ambitionPlan}`);
      a.nextPurchase = null;
      a.savingGoal = 0;
      AmbitionSystem.planFor(a);
    }
    return bought;
  },

  considerFormingUnit(a, s) {
    if (a.unitId || a.travel || RULER_PROFS.has(a.profession)) return;
    const localThreat = EconomySystem.localDanger(s) + s.crime / 100;
    const canLead = a.skills.leadership >= FORM_SQUAD_LEADERSHIP && a.skills.fighting >= FORM_SQUAD_FIGHTING
      && a.money >= FORM_SQUAD_MONEY && (a.traits.ambition > 0.55 || localThreat > 0.35);
    if (!canLead || !chance(0.12 + localThreat * 0.2 + a.traits.ambition * 0.08)) return;

    const recruits = MilitarySystem.recruit(a, s, Math.min(5, MilitarySystem.commandCapacity(a)));
    if (recruits.length < 1) return;

    const objectives = ['hunt_bandits', 'patrol_route', 'escort_caravan', 'defend_town'];
    let obj = 'hunt_bandits';
    if (localThreat < 0.2 && a.traits.ambition > 0.75) obj = pick(['capture_fort', 'capture_weak_town', 'raid_bandit_camp']);
    else if (s.stock.food < s.demand.food * 0.5) obj = 'escort_caravan';

    const u = createUnit({
      name: `กอง${a.name.split(' ')[0]}`, kind: 'field',
      leaderId: a.id, memberIds: [a.id, ...recruits.map(r => r.id)],
      factionId: a.factionId, locationId: s.id, food: 20,
      objective: { type: obj }
    });
    a.unitId = u.id;
    world.stats.squadsFormed = (world.stats.squadsFormed || 0) + 1;
    EventSystem.add('war', `⚔ ${a.name} ตั้ง${u.name} (${recruits.length + 1} คน) — ภารกิจ: ${obj}`);
    addDeed(a, `ก่อตั้ง${u.name}ด้วยกำลังพล ${recruits.length + 1} นาย`, 10, `ผู้ก่อตั้ง${u.name}`);
    return u;
  }
};

const LogisticsSystem = {
  updateSettlement(s) {
    if (s.type === 'camp') return;
    LogisticsSystem.validateCaravanSlots(s);
    const pop = populationOf(s);
    const daysFood = pop > 0 ? s.stock.food / Math.max(pop * 2, 1) : 99;
    const exportable = SettlementMetrics.exportableFood(s);

    // Town caravan when food low elsewhere but we have surplus
    if (exportable >= 8 && daysFood > s.foodReserveTargetDays + 1) {
      const hungry = marketSettlements().filter(x => x.id !== s.id && x.stock.food < x.demand.food * 0.35 && findPath(s.id, x.id));
      if (hungry.length && !s.townCaravanId) this.spawnTownCaravan(s, hungry[0]);
    }

    // Emergency relief
    if (s.stock.food < pop * 2 && s.treasury > 80) {
      const donor = marketSettlements().filter(x => x.id !== s.id && SettlementMetrics.exportableFood(x) > 15)
        .sort((a, b) => SettlementMetrics.exportableFood(b) - SettlementMetrics.exportableFood(a))[0];
      if (donor && chance(0.25)) this.spawnEmergencyRelief(donor, s);
    }

    // Subsidize trader hire
    if (s.stock.food < s.demand.food * 0.45 && s.treasury > 100 && chance(0.12)) {
      const subsidy = Math.min(60, s.treasury * 0.08);
      s.treasury -= subsidy;
      s.caravanSubsidy += subsidy;
      const trader = agentsAt(s.id).find(a => a.profession === 'trader' && !a.travel);
      if (trader) { trader.money += subsidy; EventSystem.add('economy', `💰 ${s.name} อุดหนุนพ่อค้า ${trader.name} ${fmt(subsidy)} ทองเพื่อนำเข้าอาหาร`); }
      else this.convertToTrader(s, subsidy);
    }
  },

  spawnTownCaravan(s, dest) {
    LogisticsSystem.validateCaravanSlots(s);
    if (s.townCaravanId) return;
    const isReplacement = s._lastTownCaravanLostDay && world.day - s._lastTownCaravanLostDay < 90;
    let carrier = agentsAt(s.id).find(a => (a.profession === 'trader' || a.profession === 'unemployed') && !a.travel && !a.unitId && !a.isTownCaravan && !a.isEmergencyCaravan);
    if (!carrier) {
      carrier = createAgent({ locationId: s.id, factionId: s.factionId, profession: 'trader', isTownCaravan: true, caravanOwnerId: s.id });
      seedSkillForProfession(carrier, 'trader');
    }
    carrier.isTownCaravan = true;
    carrier.caravanOwnerId = s.id;
    carrier.profession = 'trader';
    s.townCaravanId = carrier.id;
    const qty = Math.min(SettlementMetrics.exportableFood(s), 12 + Math.floor(s.treasury / 50));
    if (qty < 4) return;
    s.stock.food -= qty;
    carrier.cargo = { good: 'food', qty, buyCost: 0, destId: dest.id, subsidized: true };
    carrier.currentGoal = `คาราวานเมืองขนอาหารไป${dest.name}`;
    buyProvisions(carrier, s, 4);
    startTravel(carrier, dest.id, 'town_caravan');
    EventSystem.add('trade', isReplacement
      ? `🐪 ${s.name} จัดคาราวานเมืองใหม่ขนอาหาร ${qty} หน่วยไป${dest.name}`
      : `🐪 ${s.name} ส่งคาราวานเมืองขนอาหาร ${qty} หน่วยไป${dest.name}`);
    if (isReplacement) {
      world.stats.townCaravansReplaced = (world.stats.townCaravansReplaced || 0) + 1;
      s._lastTownCaravanLostDay = null;
    }
    world.stats.townCaravans = (world.stats.townCaravans || 0) + 1;
  },

  spawnEmergencyRelief(donor, needy) {
    const qty = Math.min(SettlementMetrics.exportableFood(donor), Math.ceil(populationOf(needy) * 2));
    if (qty < 6) return;
    const path = findPath(donor.id, needy.id);
    const collapsing = needy.stock.food <= 2 && needy.unrest > 75 && populationOf(needy) > 3;
    if (path && !collapsing && !needy.emergencyCaravanId) {
      this.spawnEmergencyCaravan(donor, needy, qty);
    } else {
      this.directEmergencyReliefFallback(donor, needy, qty, path ? 'เมืองล่มสลายหนัก' : 'ไม่มีเส้นทาง');
    }
  },

  spawnEmergencyCaravan(donor, needy, qty) {
    if (needy.emergencyCaravanId) return;
    let carrier = agentsAt(donor.id).find(a => !a.travel && !a.unitId && !a.isTownCaravan && !a.isEmergencyCaravan);
    if (!carrier) {
      carrier = createAgent({
        locationId: donor.id, factionId: donor.factionId, profession: 'trader',
        isEmergencyCaravan: true, emergencyDestId: needy.id, emergencyDonorId: donor.id
      });
      seedSkillForProfession(carrier, 'trader');
    }
    carrier.isEmergencyCaravan = true;
    carrier.emergencyDestId = needy.id;
    carrier.emergencyDonorId = donor.id;
    carrier.profession = 'trader';
    needy.emergencyCaravanId = carrier.id;
    donor.stock.food -= qty;
    carrier.cargo = { good: 'food', qty, buyCost: 0, destId: needy.id, emergency: true };
    carrier.currentGoal = `คาราวานช่วยเหลือฉุกเฉินไป${needy.name}`;
    buyProvisions(carrier, donor, 4);
    if (!startTravel(carrier, needy.id, 'emergency_relief')) {
      needy.emergencyCaravanId = null;
      carrier.isEmergencyCaravan = false;
      carrier.emergencyDestId = null;
      carrier.emergencyDonorId = null;
      donor.stock.food += qty;
      carrier.cargo = null;
      this.directEmergencyReliefFallback(donor, needy, qty, 'เดินทางล้มเหลว');
      return;
    }
    EventSystem.add('economy', `🆘 ${donor.name} ส่งคาราวานช่วยเหลือฉุกเฉิน ${qty} หน่วยอาหารมุ่งหน้า${needy.name}`);
    world.stats.emergencyCaravans = (world.stats.emergencyCaravans || 0) + 1;
  },

  directEmergencyReliefFallback(donor, needy, qty, cause) {
    if (qty < 6) return;
    donor.stock.food -= qty;
    const cost = Math.min(needy.treasury * 0.25, qty * needy.prices.food * 0.9);
    needy.treasury -= cost;
    donor.treasury += cost;
    needy.stock.food += qty;
    world.stats.emergencyFallbacks = (world.stats.emergencyFallbacks || 0) + 1;
    EventSystem.add('economy', `⚠️ [Emergency Fallback] ${donor.name} ส่งอาหารตรงถึง${needy.name} ${qty} หน่วย (${cause})`);
    settlementHistory(needy, `ได้รับความช่วยเหลือฉุกเฉินแบบ fallback จาก${donor.name} ${qty} หน่วย`);
  },

  validateCaravanSlots(s) {
    if (s.townCaravanId) {
      const ag = getAgent(s.townCaravanId);
      const stuck = !ag || !ag.alive || !ag.isTownCaravan || (!ag.cargo && !ag.travel);
      if (stuck) {
        if (ag) clearTownCaravan(ag, ag.alive ? 'cleanup' : 'death');
        else s.townCaravanId = null;
      }
    }
    if (s.emergencyCaravanId) {
      const ag = getAgent(s.emergencyCaravanId);
      const stuck = !ag || !ag.alive || !ag.isEmergencyCaravan || (!ag.cargo && !ag.travel);
      if (stuck) {
        if (ag) clearTownCaravan(ag, ag.alive ? 'cleanup' : 'death');
        else s.emergencyCaravanId = null;
      }
    }
  },

  onEmergencyCaravanArrive(carrier, needy) {
    if (!carrier.cargo || carrier.cargo.good !== 'food') return;
    const qty = carrier.cargo.qty;
    const donor = getSettlement(carrier.emergencyDonorId);
    const cost = Math.min(needy.treasury * 0.25, qty * needy.prices.food * 0.9);
    needy.treasury -= cost;
    if (donor) donor.treasury += cost;
    needy.stock.food += qty;
    carrier.cargo = null;
    clearTownCaravan(carrier, 'delivered');
    EventSystem.add('economy', `✅ คาราวานช่วยเหลือฉุกเฉินถึง${needy.name} — ส่งอาหาร ${qty} หน่วย`);
    settlementHistory(needy, `คาราวานช่วยเหลือฉุกเฉินจาก${donor ? donor.name : 'แดนไกล'}นำอาหาร ${qty} หน่วยมาถึง`);
  },

  convertToTrader(s, bonus) {
    const c = agentsAt(s.id).find(a => !a.unitId && !a.travel && !RULER_PROFS.has(a.profession)
      && (a.skills.trading > 1.5 || a.memory.tradeProfit > 50 || a.money > 60));
    if (!c || !chance(0.35)) return;
    c.profession = 'trader';
    c.money += bonus || 0;
    if (c.skills.trading < 1) c.skills.trading = 1;
    EventSystem.add('trade', `🐪 ${c.name} เปลี่ยนอาชีพเป็นพ่อค้าที่${s.name}${bonus ? ` (ได้อุดหนุน ${fmt(bonus)} ทอง)` : ''}`);
    world.stats.traderSpawns = (world.stats.traderSpawns || 0) + 1;
  },

  traderRespawn() {
    const traders = world.agents.filter(a => a.alive && (a.profession === 'trader' || a.isTownCaravan)).length;
    if (traders >= 8) return;
    for (const s of marketSettlements()) {
      if (s.type !== 'town' && s.type !== 'castle' && s.type !== 'village') continue;
      const localTraders = agentsAt(s.id).filter(a => a.profession === 'trader').length;
      if (localTraders > 0) continue;
      if (chance(s.stock.food < s.demand.food * 0.5 ? 0.12 : 0.05)) this.convertToTrader(s, 25);
    }
  },

  updatePriceGaps() {
    const mkts = marketSettlements();
    for (const r of world.routes) {
      if (r.destroyed) continue;
      const sa = getSettlement(r.a), sb = getSettlement(r.b);
      if (!sa || !sb) continue;
      r.priceGapFood = Math.abs(sa.prices.food - sb.prices.food) / BASE_PRICE.food;
      r.threat = clamp(r.danger * 0.6 + r.recentRaids * 0.08 + r.caravanLosses * 0.04 - r.patrolLevel * 0.05, 0, 1);
      r._peakThreat = Math.max(r._peakThreat || 0, r.threat);
      if (r.threat < (r._peakThreat || 0) * 0.7) r._peakThreat = r.threat; // reset peak after recovery
    }
  }
};

const RouteSecuritySystem = {
  update() {
    LogisticsSystem.updatePriceGaps();
    for (const r of world.routes) {
      if (r.destroyed) continue;
      if (r.recentRaids > 0) r.recentRaids = Math.max(0, r.recentRaids - 0.08);
      if (r.threat > 0.45 && r.bounty < 30) this.postBounty(r);
      if (r.caravanLosses >= 1 && r.bounty < 15) this.postBounty(r);
      if (r.threat > 0.55 && !r.patrolMissionId && chance(0.15)) this.sendPatrolMission(r);
    }
    this.bountyHunters();
  },

  postBounty(r) {
    const sa = getSettlement(r.a), sb = getSettlement(r.b);
    for (const s of [sa, sb]) {
      if (!s || s.type === 'camp' || s.treasury < 50) continue;
      if (r.bounty >= 25) continue;
      const offer = Math.min(40, Math.floor(s.treasury * 0.06) + r.caravanLosses * 5 + Math.floor((r.threat || r.danger) * 30));
      if (offer < 15) continue;
      s.treasury -= offer;
      r.bounty += offer;
      r.lifetimeBounty = (r.lifetimeBounty || 0) + offer;
      world.stats.bountiesPosted = (world.stats.bountiesPosted || 0) + 1;
      EventSystem.add('war', `💰 ${s.name} ตั้งค่าหัวโจร ${offer} ทองบนเส้นทางที่เชื่อม${sa.name}–${sb.name}`);
      break;
    }
  },

  sendPatrolMission(r) {
    const sa = getSettlement(r.a), sb = getSettlement(r.b);
    const s = (sa && sa.garrisonUnitId) ? sa : sb;
    if (!s || s.type === 'camp') return;
    const g = s.garrisonUnitId ? getUnit(s.garrisonUnitId) : null;
    if (!g || unitMembers(g).length < 3 || g.travel) return;
    const dest = r.a === s.id ? r.b : r.a;
    g.objective = { type: 'patrol_route', routeId: r.id };
    r.patrolMissionId = g.id;
    startTravel(g, dest, 'patrol');
    EventSystem.add('war', `🛡 กอง${g.name} ออกลาดตระเวนเส้นทางที่มีภัยคุกคามสูง`);
  },

  bountyHunters() {
    for (const r of world.routes) {
      if (r.bounty < 20) continue;
      const near = world.settlements.filter(s => {
        if (s.type === 'camp') return false;
        return getRoute(s.id, r.a) || getRoute(s.id, r.b);
      });
      for (const s of near) {
        const hunter = agentsAt(s.id).find(a => !a.unitId && !a.travel && a.skills.fighting > 2.5
          && a.skills.leadership > 2 && a.traits.bravery > 0.5);
        if (!hunter || !chance(0.06)) continue;
        const mates = MilitarySystem.recruit(hunter, s, 3);
        if (!mates.length) continue;
        const u = createUnit({
          name: `นักล่าเงินรางวัลของ${hunter.name.split(' ')[0]}`, kind: 'field',
          leaderId: hunter.id, memberIds: [hunter.id, ...mates.map(m => m.id)],
          factionId: hunter.factionId, locationId: s.id, food: 15,
          objective: { type: 'hunt_bandits', routeId: r.id, bounty: r.bounty }
        });
        hunter.unitId = u.id;
        EventSystem.add('war', `🎯 ${hunter.name} รับค่าหัว ${fmt(r.bounty)} ทอง ออกปราบโจรบนเส้นทาง`);
        r.bounty = Math.floor(r.bounty * 0.5);
        break;
      }
    }
  },

  onCaravanRobbed(r) {
    if (!r) return;
    r.caravanLosses++;
    r.recentRaids = clamp(r.recentRaids + 1, 0, 10);
    r.threat = clamp(r.threat + 0.12, 0, 1);
    r.danger = clamp(r.danger + 0.06, 0.02, 1);
    if (r.caravanLosses >= 1) this.postBounty(r);
  },

  onPatrolComplete(u, r) {
    if (!r) return;
    r.patrolLevel = clamp(r.patrolLevel + 1.5, 0, 6);
    r.threat = clamp(r.threat - 0.12, 0, 1);
    r.danger = clamp(r.danger - 0.08, 0.02, 1);
    r.patrolMissionId = null;
    u.objective = { type: 'idle' };
    EventSystem.add('war', `🛡 ${u.name} ลาดตระเวนเสร็จ — ความปลอดภัยบนเส้นทางดีขึ้น`);
  }
};

/* ═══════════════════ 7. ECONOMY SYSTEM ═══════════════════ */

const EconomySystem = {
  // 7.1 ผลิตทรัพยากรระดับ settlement (จากคนทำงาน — ดู WorkSystem) + demand + price
  updateDemandAndPrices(s) {
    SettlementMetrics.update(s);
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

    // ── ราคา: base × scarcity × dangerMod × taxMod × crowding (อาหารแพงเมื่อแออัด) ──
    const dangerMod = 1 + this.localDanger(s) * 0.35;
    const taxMod = 1 + s.taxRate * 0.8;
    const crowdFoodMod = 1 + Math.max(0, s.crowding - 0.9) * 0.45;
    for (const g of GOODS) {
      const scarcity = clamp(s.demand[g] / Math.max(s.stock[g], 1), 0.25, 6);
      let p = BASE_PRICE[g] * Math.pow(scarcity, 0.75) * dangerMod * taxMod;
      if (g === 'food') p *= crowdFoodMod;
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
    const jobCrowd = clamp(ideal / Math.max(n, 1), 0.2, 1);
    const housingCrowd = clamp(1 - Math.max(0, s.crowding - 1) * 0.25, 0.35, 1);
    return jobCrowd * housingCrowd;
  },

  // agent ซื้อสินค้าจากคลังเมือง → เงินเข้าคลังเมือง (non-food หรือ legacy)
  buyFromSettlement(agent, s, good, qty) {
    if (good === 'food') {
      if (agent.isTownCaravan || agent.isEmergencyCaravan || agent.cargo) return this.buyFoodForExport(agent, s, qty);
      if (!agent.travel && agent.locationId === s.id) return this.buyFoodForLocalConsumption(agent, s, qty);
      return this.buyFoodForExport(agent, s, qty);
    }
    return this._buyGood(agent, s, good, qty);
  },

  // อาหารสำหรับบริโภคในท้องถิ่น — ไม่จำกัด exportableFood แต่มี ration reserve
  localFoodRationCap(s, wantQty) {
    const pop = populationOf(s);
    const minReserve = Math.max(4, pop * 1.5);
    const available = Math.max(0, Math.floor(s.stock.food - minReserve));
    return Math.min(wantQty, available);
  },

  buyFoodForLocalConsumption(agent, s, qty) {
    if (!s || s.type === 'camp') return 0;
    if (agent.locationId !== s.id && !agent.travel) return 0;
    qty = this.localFoodRationCap(s, qty);
    const got = this._buyGood(agent, s, 'food', qty);
    if (got > 0) {
      world.stats.localRations = (world.stats.localRations || 0) + got;
      if (chance(0.08)) EventSystem.add('economy', `🍞 ${agent.name} ซื้ออาหารท้องถิ่นจาก${s.name} ${got} หน่วย (ration)`);
    }
    return got;
  },

  buyFoodForExport(agent, s, qty) {
    qty = Math.min(qty, SettlementMetrics.exportableFood(s));
    return this._buyGood(agent, s, 'food', qty);
  },

  _buyGood(agent, s, good, qty) {
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
    // ซื้ออาหารท้องถิ่น (ration path — ไม่ใช้ export cap)
    if (a.stats.hunger < 55 && !a.travel && s && s.type !== 'camp') {
      const want = a.stats.hunger < 30 ? 3 : 2;
      const got = EconomySystem.buyFoodForLocalConsumption(a, s, want);
      if (got > 0) {
        a.inventory.food += got - 1;
        a.stats.hunger = clamp(a.stats.hunger + 38, 0, 100);
      }
    }
    // ระหว่างเดินทาง: แวะซื้อเสบียง — ใช้ local ration ถ้าอยู่ที่เมืองชั่วคราว
    if (a.stats.hunger < 45 && a.travel && a.inventory.food <= 0 && s && s.type !== 'camp' && s.stock.food >= 1) {
      const got = EconomySystem.buyFoodForLocalConsumption(a, s, 1);
      if (got > 0) {
        a.stats.hunger = clamp(a.stats.hunger + 38, 0, 100);
      } else {
        const price = s.prices.food * 1.2;
        if (a.money >= price && EconomySystem.localFoodRationCap(s, 1) > 0) {
          a.money -= price; s.treasury += price; s.stock.food -= 1;
          a.stats.hunger = clamp(a.stats.hunger + 38, 0, 100);
          world.stats.localRations = (world.stats.localRations || 0) + 1;
        }
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
    if (a.cargo) { clearTownCaravan(a, 'death'); a.cargo = null; }
    else clearTownCaravan(a, 'death');
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
      Chronicle.add({
        category: 'faction', importance: 4,
        title: `⚰ ผู้ปกครอง ${a.name} สิ้นชีพ`,
        description: `${a.title ? a.title + ' ' : ''}${a.name} (${a.profession}) ${causeText}ที่${s ? s.name : 'กลางทาง'} เมื่ออายุ ${a.age} ปี`,
        agents: [a.id], factions: a.factionId ? [a.factionId] : []
      });
      const f = getFaction(a.factionId);
      if (f) factionTimeline(f, `ผู้ปกครอง ${a.name} เสียชีวิต (${causeText})`);
      handleRulerDeath(a);
    } else if (a.notable) {
      // ตำนานจบชีวิต — บันทึกลง chronicle พร้อมสรุปชีวิต
      EventSystem.add('life', `⚰ ${a.title ? a.title + ' ' : ''}${a.name} ${causeText}ที่${s ? s.name : 'กลางทาง'}`);
      Chronicle.add({
        category: 'legend', importance: 4,
        title: `⚰ ตำนาน ${a.name}${a.title ? ' "' + a.title + '"' : ''} จบชีวิตลง`,
        description: lifeSummary(a) + ` — ${causeText}เมื่ออายุ ${a.age} ปี`,
        agents: [a.id]
      });
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

    // ซื้อเครื่องมือ/อุปกรณ์ตาม ambition
    AmbitionSystem.planFor(a);
    if (a.money >= (a.savingGoal || 999) && a.nextPurchase) {
      options.push({ act: 'buyGear', score: 28 + a.traits.ambition * 15 });
    }
    if (WORKER_PROFS.includes(a.profession) && a.profession !== 'crafter' && !a.equipment?.tool) {
      options.push({ act: 'buyTools', score: 30 });
    }

    // ตั้งกองกำลังเอง
    if (!a.unitId && a.skills.leadership >= FORM_SQUAD_LEADERSHIP && a.skills.fighting >= FORM_SQUAD_FIGHTING
        && a.money >= FORM_SQUAD_MONEY && (a.traits.ambition > 0.55 || EconomySystem.localDanger(s) > 0.3)) {
      options.push({ act: 'formSquad', score: 18 + a.traits.ambition * 20 + a.skills.leadership * 3 });
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
        if (!a._wasTrader) { a._wasTrader = true; world.stats.traderSpawns = (world.stats.traderSpawns || 0) + 1; }
        TraderSystem.planTrade(a, s);
        break;
      case 'migrate': {
        a.profession = a.profession === 'unemployed' ? 'migrant' : a.profession;
        a.currentGoal = `ย้ายไป${choice.targetName}`;
        a.currentThought = `${s.name}อยู่ยาก อาหารแพง ข้าจะไป${choice.targetName}`;
        buyProvisions(a, s, 4);
        if (startTravel(a, choice.target, 'migrate', a.traits.bravery < 0.4)) {
          a.lastMigrationDay = world.day;
          const dest = getSettlement(choice.target);
          if (dest) dest.recentInbound += 1;
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
          a.equipment.tool = equipSlot('tool', 'tool');
          a.inventory.tools = 0;
          a.currentThought = 'ได้เครื่องมือใหม่ ทำงานได้ไวขึ้นแน่';
          EventSystem.add('life', `🛒 ${a.name} ซื้อเครื่องมือที่${s.name}`);
        }
        break;
      }
      case 'buyGear':
        AmbitionSystem.tryPurchase(a, s);
        break;
      case 'formSquad':
        AmbitionSystem.considerFormingUnit(a, s);
        break;
    }
  },

  bestMigrationTarget(a, from) {
    if (world.day - a.lastMigrationDay < MIGRATION_COOLDOWN_DAYS) return null;
    let best = null, bestScore = -Infinity;
    for (const s of marketSettlements()) {
      if (s.id === from.id || s.siege) continue;
      const path = findPath(from.id, s.id);
      if (!path) continue;
      const score = SettlementMetrics.migrationScore(a, from, s, path);
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return bestScore > 5 ? best : null;
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
    const toolBonus = (a.equipment?.tool && a.equipment.tool.durability > 0) ? TOOL_DEF.workBonus
      : ((a.inventory.tools > 0 && a.durability.tools > 0) ? 1.5 : 1);

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
        if (a.equipment?.tool) a.equipment.tool.durability -= 1;
        else a.durability.tools -= 1;
        if ((a.equipment?.tool?.durability || a.durability.tools) <= 0) {
          if (a.equipment) a.equipment.tool = null;
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
      let avail = Math.floor(s.stock[g]);
      if (g === 'food') avail = Math.min(avail, SettlementMetrics.exportableFood(s));
      if (avail < 2) continue;
      const ds = CombatSystem.deriveStats(a);
      const capacity = 8 + (a._hasCart || a.inventory.cart > 0 ? CART_DEF.capacity : 0) + (a.equipment?.mount ? 4 : 0) + ds.carryingCapacity * 0.3;
      const qty = Math.min(avail, capacity, Math.floor(a.money / buyPrice));
      if (qty < 2) continue;

      for (const d of marketSettlements()) {
        if (d.id === s.id || d.siege) continue;
        const path = findPath(s.id, d.id, a.traits.riskTolerance < 0.35);
        if (!path) continue;
        const sellPrice = d.prices[g];
        // ความเสี่ยงตามเส้นทาง
        let risk = 0, gapBonus = 0;
        for (let i = 0; i < path.length - 1; i++) {
          const r = getRoute(path[i], path[i + 1]);
          if (r) {
            risk += (r.threat || r.danger);
            if (g === 'food') gapBonus += (r.priceGapFood || 0) * 4;
          }
        }
        const travelCost = path.length * 3;
        const expected = (sellPrice * 0.85 * (1 - d.taxRate) - buyPrice) * qty
          - travelCost + gapBonus
          - risk * qty * buyPrice * (1.2 - a.traits.riskTolerance);
        if (expected > bestProfit) { bestProfit = expected; best = { good: g, qty, destId: d.id, destName: d.name, buyPrice }; }
      }
    }

    if (best) {
      buyProvisions(a, s, 5);
      const bought = best.good === 'food'
        ? EconomySystem.buyFoodForExport(a, s, best.qty)
        : EconomySystem.buyFromSettlement(a, s, best.good, best.qty);
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
    if (!s) return;

    // คาราวานช่วยเหลือฉุกเฉินถึงปลายทาง
    if (a.isEmergencyCaravan && a.cargo && s.id === a.cargo.destId) {
      LogisticsSystem.onEmergencyCaravanArrive(a, s);
      return;
    }

    if (!a.cargo) return;
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
      if (a.isTownCaravan) clearTownCaravan(a, 'delivered');
      a.stats.morale = clamp(a.stats.morale + (profit > 0 ? 4 : -4), 0, 100);
      a.currentThought = profit > 0 ? `ขายได้กำไร ${fmt(profit)} ทอง — การค้าคือชีวิต` : `ขาดทุน ${fmt(-profit)} ทอง... คำนวณพลาด`;
      a.cargo.qty -= sold;
      // สะสมกำไรการค้า → ตำนานพ่อค้า
      if (profit > 0) {
        a.memory.tradeProfit += profit;
        if (a.memory.tradeProfit >= 400 && !a._traderTitled) {
          a._traderTitled = true;
          const home = getSettlement(a.homeId) || s;
          addDeed(a, `ทำกำไรจากการค้าสะสมเกิน 400 ทอง`, 12, `พ่อค้าแห่ง${home.name}`);
          Chronicle.add({
            category: 'trade', importance: 3,
            title: `💰 ${a.name} กลายเป็นพ่อค้าผู้มั่งคั่ง`,
            description: `ค้าขายจนกำไรสะสมกว่า 400 ทอง ได้รับฉายา "พ่อค้าแห่ง${home.name}"`,
            agents: [a.id], settlements: [home.id]
          });
        }
      }
    }
    if (a.cargo && a.cargo.qty <= 0) { a.cargo = null; clearTownCaravan(a, 'cleanup'); }
    else if (sold === 0) {
      // เมืองไม่มีเงินซื้อ — เก็บของไว้ ลองเมืองอื่น
      const alt = marketSettlements().filter(x => x.id !== s.id && x.treasury > 100);
      if (alt.length) { buyProvisions(a, s, 4); a.cargo.destId = pick(alt).id; startTravel(a, a.cargo.destId, 'trade'); }
      else {
        clearTownCaravan(a, 'lost');
        a.cargo = null;
        EventSystem.add('trade', `🚨 ${a.name} ยอมแพ้เส้นทางค้า — ไม่มีเมืองไหนซื้อได้`);
      }
    }
  }
};

/* ═══════════════════ 12. BANDIT SYSTEM ═══════════════════ */

const BanditSystem = {
  update() {
    for (const camp of world.settlements.filter(s => s.type === 'camp')) {
      const banditsHere = agentsAt(camp.id).filter(a => a.profession === 'bandit' && !a.unitId);
      // ── ตั้ง warband ใหม่เมื่อมีโจรว่างพอ (จำกัดด้วย supply และ wantedLevel) ──
      const campWanted = camp._wantedLevel || 0;
      const supplyOk = camp.stock.food >= banditsHere.length * 1.5;
      if (banditsHere.length >= 2 && supplyOk && campWanted < 80 && chance(0.35 + banditsHere.length * 0.05)) {
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
    const guardsPower = trader.inventory.weapon > 0 || trader.equipment?.mainHand ? 8 : 0;
    const baseRisk = clamp((r.threat || r.danger) - r.patrolLevel * 0.06, 0.01, 0.9);

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
      if (trader.isTownCaravan || trader.isEmergencyCaravan) clearTownCaravan(trader, 'robbed');
      trader.cargo = null;
      trader.stats.morale -= 15;
      trader.stats.health -= randInt(0, 25);
      trader.currentThought = 'โดนปล้นเรียบ... ข้าเกลียดเส้นทางนี้';
      world.stats.caravansRobbed++;
      r.danger = clamp(r.danger + 0.08, 0, 1);
      RouteSecuritySystem.onCaravanRobbed(r);
      const camp = ambusher ? world.settlements.find(s => s.type === 'camp' && s.factionId === ambusher.factionId) : null;
      for (const m of ambusher ? unitMembers(ambusher) : []) {
        m.wantedLevel = (m.wantedLevel || 0) + 8;
        if (camp) camp._wantedLevel = (camp._wantedLevel || 0) + 5;
      }
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
  unitPower(u, terrain) {
    if (!u) return 0;
    const members = unitMembers(u);
    if (members.length === 0) return 0;
    terrain = terrain || 'field';
    let power = 0;
    for (const m of members) {
      let p = CombatSystem.agentPower(m, terrain);
      // matchup ภายในหน่วย — เฉลี่ยจาก leader
      power += p;
    }
    const leader = getAgent(u.leaderId);
    const tacticsMod = leader ? 1 + leader.skills.tactics * 0.06 + CombatSystem.deriveStats(leader).commandBonus * 0.04 : 1;
    const moraleMod = 0.6 + u.morale / 160;
    const fatigueMod = 1 - u.fatigue / 250;
    const supplyMod = u.supply.food >= members.length ? 1 : 0.65;
    u.combatPower = power * tacticsMod * moraleMod * fatigueMod * supplyMod;
    u.equipmentPower = sum(members, m => CombatSystem.deriveStats(m).attack);
    return u.combatPower;
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
    const terrain = context.terrain || (context.kind === 'raid' ? 'close' : 'field');
    let atkPower = 0, defPower = 0;
    for (const u of attackerUnits) atkPower += this.unitPower(u, terrain);
    for (const u of defenderUnits) {
      defPower += this.unitPower(u, terrain);
      // matchup: ใช้ leader ของแต่ละฝ่าย
      const atkLead = attackerUnits[0] ? getAgent(attackerUnits[0].leaderId) : null;
      const defLead = getAgent(u.leaderId);
      if (atkLead && defLead) {
        for (const m of unitMembers(u)) {
          defPower += CombatSystem.agentPower(m, terrain) * (CombatSystem.matchupMod(atkLead, m, terrain) - 1) * 0.15;
        }
      }
    }
    atkPower *= rand(0.82, 1.18);
    defPower = (defPower + (context.defenseBonus || 0)) * rand(0.82, 1.18);
    const attackerWins = atkPower > defPower;
    const ratio = clamp(Math.min(atkPower, defPower) / Math.max(atkPower, defPower, 1), 0.1, 1);
    const totalMen = sum(attackerUnits, u => unitMembers(u).length) + sum(defenderUnits, u => unitMembers(u).length);
    const bName = battleName(context.kind || 'field', context.label || '?', totalMen);

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
            // ผู้รอดจากศึกใหญ่หลายครั้ง → ตำนาน
            if (m.memory.survivedBattles === 5) {
              addDeed(m, `รอดชีวิตจากสนามรบมาแล้ว 5 ครั้ง รวมทั้ง${bName}`, 8, 'ผู้รอดจากศึกใหญ่');
            }
          }
        }
        u.morale = clamp(u.morale + (won ? 10 : -18), 5, 100);
        u.fatigue = clamp(u.fatigue + 25, 0, 100);
        u.battleHistory.push({ day: world.day, won, vs: context.label, name: bName });
        const leader = getAgent(u.leaderId);
        if (leader && leader.alive && won) {
          leader.skills.tactics = Math.min(10, leader.skills.tactics + 0.2);
          leader.skills.leadership = Math.min(10, leader.skills.leadership + 0.12);
          leader.reputation += 4;
          if (totalMen >= 8) addDeed(leader, `นำทัพชนะใน${bName}`, 6);
          this.checkPromotion(leader);
        }
      }
      return { dead, fled };
    };

    const loserRate = 0.25 + (1 - ratio) * 0.2;
    const winnerRate = 0.08 + ratio * 0.1;
    const atkResult = applyCasualties(attackerUnits, attackerWins ? winnerRate : loserRate, attackerWins);
    const defResult = applyCasualties(defenderUnits, attackerWins ? loserRate : winnerRate, !attackerWins);
    const totalDead = atkResult.dead + defResult.dead;

    CombatSystem.applyBattleWear(attackerUnits, attackerWins);
    CombatSystem.applyBattleWear(defenderUnits, !attackerWins);
    for (const u of attackerUnits) {
      if (attackerWins) u.recentVictories = (u.recentVictories || 0) + 1;
      const leader = getAgent(u.leaderId);
      if (leader && attackerWins) leader.fame = (leader.fame || 0) + 1;
    }

    // ── บันทึกประวัติศาสตร์: ศึกใหญ่ลง chronicle / ศึกในสงครามลง war object ──
    recordWarBattle(context.atkFactionId, context.defFactionId, bName, totalDead, attackerWins);
    if (totalMen >= 8) {
      const atkLeader = attackerUnits.length ? getAgent(attackerUnits[0].leaderId) : null;
      const defLeader = defenderUnits.length ? getAgent(defenderUnits[0].leaderId) : null;
      Chronicle.add({
        category: context.kind === 'rebellion' ? 'rebellion' : 'war',
        importance: totalMen >= 15 ? 4 : 3,
        title: `⚔ ${bName}`,
        description: `กำลังพลรวม ${totalMen} นาย ${attackerWins ? 'ฝ่ายบุกได้ชัย' : 'ฝ่ายรับป้องกันสำเร็จ'} เสียชีวิต ${totalDead} หนี ${atkResult.fled + defResult.fled}`,
        agents: [atkLeader, defLeader].filter(x => x).map(x => x.id),
        settlements: context.settlementId ? [context.settlementId] : [],
        factions: [context.atkFactionId, context.defFactionId].filter(x => x)
      });
    }

    return { attackerWins, atkPower, defPower, atkResult, defResult, name: bName, totalDead };
  },

  checkPromotion(a) {
    if (a.rank === 'commoner' && a.memory.battlesWon >= 2 && a.skills.leadership >= 2) {
      a.rank = 'veteran';
    } else if (a.rank === 'veteran' && a.memory.battlesWon >= 4 && a.skills.leadership >= 3.5) {
      a.rank = 'captain'; a.profession = MILITARY_PROFS.has(a.profession) ? 'captain' : a.profession;
      EventSystem.add('war', `⭐ ${a.name} ได้เลื่อนขั้นเป็นนายกอง (captain) หลังชนะศึก ${a.memory.battlesWon} ครั้ง`);
      addDeed(a, `เลื่อนขั้นเป็นนายกองหลังชนะศึก ${a.memory.battlesWon} ครั้ง`, 8);
    } else if (a.rank === 'captain' && a.memory.battlesWon >= 7 && a.skills.leadership >= 5) {
      a.rank = 'commander'; a.profession = 'commander';
      EventSystem.add('war', `⭐⭐ ${a.name} ได้เลื่อนขั้นเป็นแม่ทัพ (commander) ชื่อเสียงเลื่องลือ`);
      addDeed(a, `ก้าวขึ้นเป็นแม่ทัพผู้เกรียงไกร ผ่านศึกชนะ ${a.memory.battlesWon} ครั้ง`, 15, 'แม่ทัพผู้เกรียงไกร');
      Chronicle.add({
        category: 'legend', importance: 4,
        title: `⭐⭐ ${a.name} ก้าวขึ้นเป็นแม่ทัพ`,
        description: lifeSummary(a), agents: [a.id]
      });
    }
  },

  /* ── โจร/กบฏปล้นถิ่นฐาน ── */
  resolveRaid(u, s) {
    if (!s) return;
    world.stats.raids++;
    const garrison = s.garrisonUnitId ? getUnit(s.garrisonUnitId) : null;
    const defUnits = garrison ? [garrison] : [];
    const defenseBonus = (s.buildings.includes('Wall') ? 40 : 0) + (s.buildings.includes('Watchtower') ? 15 : 0) + s.security * 0.4;
    const result = this.battle([u], defUnits, {
      defenseBonus, label: s.name, kind: 'raid', settlementId: s.id,
      atkFactionId: u.factionId, defFactionId: s.factionId
    });

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
      s.timesRaided++;
      s.prosperity = clamp(s.prosperity - 8, 0, 100);
      s.loyalty = clamp(s.loyalty - 6, 0, 100);
      s.security = clamp(s.security - 10, 0, 100);
      s.unrest = clamp(s.unrest + 8, 0, 100);
      for (const m of unitMembers(u)) {
        m.memory.raidsDone++;
        if (m.memory.raidsDone === 5) addDeed(m, `ร่วมปล้นสำเร็จครบ 5 ครั้ง ล่าสุดที่${s.name}`, 8, 'นักปล้นเส้นทางป่า');
      }
      const raidLeader = getAgent(u.leaderId);
      if (raidLeader) addDeed(raidLeader, `นำ${u.name}ปล้น${s.name}สำเร็จ`, 5);
      EventSystem.add('bandit', `🔥 ${u.name} ปล้น${s.name}สำเร็จ! ได้อาหาร ${stolenFood} ทอง ${stolenGold} — ชาวบ้านหวาดกลัว`);
      settlementHistory(s, `ถูก${u.name}ปล้น (ครั้งที่ ${s.timesRaided})`);
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
      : this.battle(attUnits, defUnits, {
          defenseBonus, label: s.name, kind: 'capture', settlementId: s.id,
          atkFactionId: attFaction.id, defFactionId: s.factionId
        });

    if (result.attackerWins) {
      const oldFaction = getFaction(s.factionId);
      const oldOwner = s.ownerId ? getAgent(s.ownerId) : null;
      if (oldOwner) s.pastRulers.push(oldOwner.name);
      s.factionId = attFaction.id;
      s.ownerId = attFaction.rulerId || commander.id;
      s.governorId = commander.id;
      commander.gov = commander.gov || makeGovAttrs();
      s.loyalty = 30; s.unrest = clamp(s.unrest + 10, 0, 100);
      s.lastCapturedDay = world.day;
      s.timesCaptured++;
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
      settlementHistory(s, `ถูก${attFaction.name}ยึดครอง${gatesOpen ? ' (ประชาชนเปิดประตู)' : ''} — ${commander.name} ขึ้นปกครอง`);
      // ── ประวัติศาสตร์ ──
      addDeed(commander, `ยึด${s.name}ได้สำเร็จ`, 15, `ผู้ยึด${s.name}`);
      factionTimeline(attFaction, `ยึด${s.name}ได้`);
      if (oldFaction) factionTimeline(oldFaction, `เสีย${s.name}ให้${attFaction.name}`);
      const war = oldFaction ? activeWarBetween(attFaction.id, oldFaction.id) : null;
      if (war) war.captured.push({ day: world.day, id: s.id, name: s.name, byFactionId: attFaction.id });
      Chronicle.add({
        category: 'war', importance: 5,
        title: `🏰 ${s.name} เปลี่ยนมือ — ตกเป็นของ${attFaction.name}`,
        description: gatesOpen
          ? `ประชาชนที่สิ้นศรัทธาเปิดประตูเมืองให้ ${commander.name} เข้ายึดโดยไม่เสียเลือด`
          : `${commander.name} นำทัพบุกยึด${s.name}จาก${oldFaction ? oldFaction.name : 'เจ้าของเดิม'} ปล้นคลังไป ${lootGold} ทอง`,
        agents: [commander.id], settlements: [s.id],
        factions: [attFaction.id, oldFaction ? oldFaction.id : null].filter(x => x)
      });
      // ผู้ยึดกลายเป็น lord ถ้ายังไม่ใช่
      if (!RULER_PROFS.has(commander.profession)) {
        commander.profession = 'lord'; commander.rank = 'lord';
        EventSystem.add('politics', `👑 ${commander.name} สถาปนาตนเป็นเจ้าเมือง${s.name}`);
      }
      if (oldFaction && !oldFaction.isBandit) checkFactionCollapse(oldFaction);
      return true;
    } else {
      EventSystem.add('war', `🛡 ${s.name} ต้านการบุกของ${attFaction.name}ไว้ได้ (ตายรวม ${result.atkResult.dead + result.defResult.dead})`);
      settlementHistory(s, `ต้านการบุกของ${attFaction.name}ไว้ได้`);
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
        else {
          for (const m of members) m.travel = null;
          if (u.objective.type === 'patrol_route' && u.kind === 'guard') {
            const r = world.routes.find(x => x.id === u.objective.routeId);
            RouteSecuritySystem.onPatrolComplete(u, r);
          }
        }
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
    const banditCount = world.agents.filter(a => a.alive && a.profession === 'bandit').length;
    if (!chance(0.05 + Math.min(banditCount * 0.005, 0.18))) return;
    const candidates = world.agents.filter(a => a.alive && !a.unitId && !a.travel && !RULER_PROFS.has(a.profession) &&
      a.skills.leadership >= FORM_SQUAD_LEADERSHIP && a.skills.fighting >= FORM_SQUAD_FIGHTING - 0.5
      && a.money >= FORM_SQUAD_MONEY * 0.6 && (a.traits.ambition > 0.55 || banditCount > 6));
    if (!candidates.length) return;
    const leader = pick(candidates);
    const s = getSettlement(leader.locationId);
    if (!s || s.type === 'camp') return;
    AmbitionSystem.considerFormingUnit(leader, s);
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

  // หน่วยอิสระ (field) — ภารกิจ Phase 10.5
  updateFieldUnits() {
    for (const u of world.units.filter(u => u.kind === 'field' && !u.travel)) {
      const members = unitMembers(u);
      if (!members.length) continue;
      const obj = u.objective.type;
      const huntTypes = new Set(['huntBandits', 'hunt_bandits', 'raid_bandit_camp']);

      if (huntTypes.has(obj)) {
        const target = world.units.find(w => w.kind === 'warband' && !w.travel && w.locationId === u.locationId && unitMembers(w).length > 0);
        if (target) {
          const s = getSettlement(u.locationId);
          const result = this.battle([u], [target], { label: s ? s.name : target.name, kind: 'field', settlementId: s ? s.id : null });
          if (result.attackerWins) {
            EventSystem.add('war', `⚔ ${u.name} ปราบโจรสำเร็จ!`);
            const leader = getAgent(u.leaderId);
            if (leader) { leader.reputation += 6; leader.fame = (leader.fame || 0) + 2; }
            u.recentVictories = (u.recentVictories || 0) + 1;
            u.supply.food += target.supply.food; target.supply.food = 0;
            if (u.objective.bounty) {
              const share = Math.floor(u.objective.bounty / Math.max(members.length, 1));
              for (const m of members) m.money += share;
            }
            BanditSystem.disband(target);
          } else {
            EventSystem.add('bandit', `🗡 ${target.name} ตีโต้${u.name}แตกพ่าย`);
          }
        } else {
          const wb = world.units.filter(w => w.kind === 'warband' && unitMembers(w).length > 0 && !w.travel);
          if (wb.length && chance(0.5)) startTravel(u, pick(wb).locationId, 'hunt');
          else if (obj === 'raid_bandit_camp' || (chance(0.2) && this.unitPower(u) > 70)) {
            const camp = world.settlements.find(x => x.type === 'camp');
            if (camp) { u.objective = { type: 'raid', targetId: camp.id }; startTravel(u, camp.id, 'attackCamp'); }
          } else if (chance(0.3)) {
            const routes = world.routes.filter(r => !r.destroyed && (r.a === u.locationId || r.b === u.locationId));
            if (routes.length) {
              const r = pick(routes);
              u.objective = { type: 'patrol_route', routeId: r.id };
              startTravel(u, r.a === u.locationId ? r.b : r.a, 'patrol');
              EventSystem.add('war', `🛡 ${u.name} ออกลาดตระเวนเส้นทาง`);
            }
          }
        }
      } else if (obj === 'patrol_route') {
        const r = world.routes.find(x => x.id === u.objective.routeId);
        if (r) RouteSecuritySystem.onPatrolComplete(u, r);
      } else if (obj === 'escort_caravan') {
        const traders = world.agents.filter(a => a.alive && a.cargo && a.travel);
        if (traders.length && chance(0.4)) startTravel(u, traders[0].locationId, 'escort');
      } else if (obj === 'defend_town') {
        const s = getSettlement(u.locationId);
        if (s) s.security = clamp(s.security + 2, 0, 100);
      } else if (obj === 'capture_weak_town' || obj === 'capture_fort') {
        const leader = getAgent(u.leaderId);
        if (leader && this.unitPower(u) > 90 && leader.traits.ambition > 0.7 && chance(0.08)) {
          const targets = world.settlements.filter(x => x.type !== 'camp' && x.factionId !== u.factionId
            && (obj === 'capture_fort' ? x.type === 'fort' : (x.loyalty < 40 || x.security < 35))
            && findPath(u.locationId, x.id));
          if (targets.length) {
            const t = pick(targets);
            const f = getFaction(u.factionId) || createFaction({ name: `แคว้น${leader.name.split(' ')[0]}`, color: pick(['#7e57c2', '#26a69a']), rulerId: leader.id });
            if (this.resolveCapture([u], f, leader, t)) {
              EventSystem.add('war', `🏰 ${u.name} ยึด${t.name}ได้!`);
              u.objective = { type: 'defend_town' };
            }
          }
        }
      } else if (obj === 'huntBandits') {
        u.objective.type = 'hunt_bandits';
        continue;
      } else if (obj === 'raid' && u.locationId === u.objective.targetId) {
        const camp = getSettlement(u.objective.targetId);
        const defenders = world.units.filter(w => w.factionId === camp.factionId && w.locationId === camp.id);
        const looseBandits = agentsAt(camp.id).filter(a => a.profession === 'bandit' && !a.unitId);
        let tempUnit = null;
        if (looseBandits.length) {
          tempUnit = createUnit({ name: 'โจรป้องกันค่าย', kind: 'warband', leaderId: looseBandits[0].id, memberIds: looseBandits.map(b => b.id), factionId: camp.factionId, locationId: camp.id, food: 10 });
          defenders.push(tempUnit);
        }
        const result = this.battle([u], defenders, { defenseBonus: 15, label: camp.name, kind: 'capture', settlementId: camp.id });
        if (result.attackerWins) {
          EventSystem.add('war', `🔥 ${u.name} บุกทำลาย${camp.name}! โจรแตกกระเจิง`);
          camp.stock.food = Math.floor(camp.stock.food * 0.3);
          camp.treasury = Math.floor(camp.treasury * 0.2);
          const leader = getAgent(u.leaderId);
          if (leader) { leader.reputation += 12; this.checkPromotion(leader); }
        }
        if (tempUnit && world.units.includes(tempUnit)) BanditSystem.disband(tempUnit);
        u.objective = { type: 'hunt_bandits' };
      }

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
            settlementHistory(target, `ถูกกองทัพ${faction.name}ล้อมเมือง`);
            Chronicle.add({
              category: 'war', importance: 4,
              title: `🏰 ${battleName('siege', target.name, sum(units, u => unitMembers(u).length))}เริ่มขึ้น`,
              description: `กองทัพ${faction.name}ปิดล้อม${target.name} เสบียงเข้าออกไม่ได้ ราคาอาหารภายในพุ่งสูง`,
              settlements: [target.id], factions: [faction.id, target.factionId].filter(x => x)
            });
            continue;
          }
          const oldFactionId = target.factionId;
          const captured = this.resolveCapture(units, faction, commander || getAgent(units[0].leaderId), target);
          target.siege = null;
          if (captured) {
            // จบภารกิจ กองทัพพักในเมือง — สงครามจบด้วยชัยชนะฝ่ายบุก
            ar.objective = { type: 'idle' };
            const war = oldFactionId ? activeWarBetween(ar.factionId, oldFactionId) : null;
            if (war) endWar(war, ar.factionId, 'ฝ่ายบุกบรรลุเป้าหมายสงคราม');
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
        settlementHistory(s, `ยอมจำนนหลังถูกล้อม ${s.siege.days} วัน`);
        const siegeDays = s.siege.days;
        const oldFactionId = s.factionId;
        s.siege = null;
        if (faction && commander) {
          const captured = this.resolveCapture(ar.unitIds.map(getUnit).filter(Boolean), faction, commander, s);
          if (captured) {
            const war = oldFactionId ? activeWarBetween(ar.factionId, oldFactionId) : null;
            if (war) endWar(war, ar.factionId, `${s.name}ยอมจำนนหลังถูกล้อม ${siegeDays} วัน`);
          }
        }
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

    /* ── บันทึกช่วงวิกฤต/ปีทองของเมือง ── */
    if (s.stock.food < 8 && pop >= 5 && !s._famineFlag) {
      s._famineFlag = true;
      settlementHistory(s, `เกิดทุพภิกขภัย อาหารเกือบหมดคลัง ราคาพุ่งเป็น ${fmt(s.prices.food, 1)}`);
      Chronicle.add({
        category: 'disaster', importance: 4,
        title: `🍞 ทุพภิกขภัยที่${s.name}`,
        description: `คลังอาหารของ${s.name}เกือบหมดขณะมีประชากร ${pop} คน ราคาอาหารพุ่งเป็น ${fmt(s.prices.food, 1)} ทอง ผู้คนเริ่มหนีออกจากเมือง`,
        settlements: [s.id]
      });
    } else if (s.stock.food > 60 && s._famineFlag) {
      s._famineFlag = false;
      settlementHistory(s, `ผ่านพ้นวิกฤตอาหาร คลังกลับมาอุดมสมบูรณ์`);
    }
    if (s.prosperity > 85 && !s._goldenFlag) {
      s._goldenFlag = true;
      settlementHistory(s, `เข้าสู่ยุคทอง — มั่งคั่งรุ่งเรืองที่สุดในประวัติศาสตร์`);
      Chronicle.add({
        category: 'settlement', importance: 3,
        title: `✨ ยุคทองของ${s.name}`,
        description: `${s.name} มั่งคั่งถึงขีดสุด คลังเมือง ${fmt(s.treasury)} ทอง ประชากร ${pop} คน`,
        settlements: [s.id]
      });
    } else if (s.prosperity < 50) s._goldenFlag = false;

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

    /* จ้างทหารเพิ่ม / mercenary เมื่ออันตราย */
    const threat = EconomySystem.localDanger(s) * 100 + s.crime * 0.5 + (s.raidedRecently > 0 ? 30 : 0);
    const wantGarrison = Math.ceil(threat / 15) + (s.type === 'fort' || s.type === 'castle' ? 5 : 1);
    if (garrisonSize < wantGarrison && s.treasury > 120) {
      const merc = world.units.find(u => u.kind === 'field' && !u.armyId && u.factionId === s.factionId
        && unitMembers(u).length >= 2 && !u.travel && chance(0.1));
      if (merc && s.treasury > 200) {
        const cost = unitMembers(merc).length * 15;
        s.treasury -= cost;
        const leader = getAgent(merc.leaderId);
        if (leader) leader.money += cost * 0.7;
        merc.kind = 'guard';
        merc.objective = { type: 'defend_town' };
        s.garrisonUnitId = merc.id;
        EventSystem.add('war', `💰 ${s.name} จ้าง${merc.name}เป็นทหารรับจ้าง (${fmt(cost)} ทอง)`);
      }
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
    startWar(newF, oldFaction, `${gov.name} ประกาศแยก${s.name}เป็นเอกราช`);
    EventSystem.add('politics', `🔥👑 ${gov.name} ประกาศแยก${s.name}เป็นอิสระจาก${oldFaction.name}! ตั้ง${newF.name} — สงครามกลางเมืองปะทุ`);
    settlementHistory(s, `ประกาศเอกราชจาก${oldFaction.name} ภายใต้${gov.name}`);
    addDeed(gov, `ประกาศแยก${s.name}เป็นอิสระ ตั้งตนเป็นขุนศึก`, 20, 'ขุนศึกกบฏ');
    factionTimeline(oldFaction, `${gov.name} พา${s.name}แยกตัวเป็นเอกราช`);
    Chronicle.add({
      category: 'rebellion', importance: 5,
      title: `🔥 ${gov.name} ประกาศเอกราช${s.name}`,
      description: `ผู้ปกครองที่ทะเยอทะยานตัดสัมพันธ์กับ${oldFaction.name} สถาปนา${newF.name} — สงครามกลางเมืองปะทุ`,
      agents: [gov.id], settlements: [s.id], factions: [newF.id, oldFaction.id]
    });
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
    addDeed(best, `ได้รับแต่งตั้งเป็นผู้ปกครอง${s.name}`, 6);
    settlementHistory(s, `${best.name} ขึ้นเป็นผู้ปกครอง`);
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
    const result = MilitarySystem.battle([u], garrison ? [garrison] : [], {
      defenseBonus: s.security * 0.3, label: s.name, kind: 'rebellion', settlementId: s.id,
      defFactionId: s.factionId
    });
    if (result.attackerWins) {
      const oldOwner = s.ownerId ? getAgent(s.ownerId) : null;
      if (oldOwner) s.pastRulers.push(oldOwner.name);
      const newF = createFaction({
        name: `สาธารณรัฐ${s.name.replace('เมือง', '').replace('บ้าน', '')}`,
        color: pick(['#ff5722', '#8bc34a', '#673ab7', '#009688']),
        rulerId: leader.id, treasury: s.treasury * 0.4
      });
      const oldFaction = getFaction(s.factionId);
      if (oldFaction) startWar(newF, oldFaction, `กบฏยึด${s.name}ตั้ง${newF.name}`);
      s.factionId = newF.id;
      s.ownerId = leader.id;
      s.governorId = leader.id;
      s.timesCaptured++;
      leader.profession = 'lord'; leader.rank = 'rebel_lord';
      leader.gov = makeGovAttrs();
      leader.factionId = newF.id;
      s.unrest = 30; s.loyalty = 55; s.taxRate = 0.06;
      addDeed(leader, `นำประชาชนลุกฮือยึด${s.name} สถาปนา${newF.name}`, 22, 'ขุนศึกกบฏ');
      if (oldFaction) factionTimeline(oldFaction, `เสีย${s.name}ให้กบฏของ${leader.name}`);
      Chronicle.add({
        category: 'rebellion', importance: 5,
        title: `🔥 กบฏยึด${s.name}สำเร็จ — กำเนิด${newF.name}`,
        description: `${leader.name} นำประชาชนที่อดอยากและโกรธแค้นลุกฮือโค่นผู้ปกครอง สถาปนา${newF.name}และลดภาษีเหลือ 6%`,
        agents: [leader.id], settlements: [s.id],
        factions: [newF.id, oldFaction ? oldFaction.id : null].filter(x => x)
      });
      if (garrison) {
        for (const m of unitMembers(garrison)) { m.unitId = null; m.profession = 'unemployed'; }
        world.units = world.units.filter(x => x.id !== garrison.id);
        s.garrisonUnitId = null;
      }
      // กบฏกลายเป็น garrison ใหม่
      u.kind = 'guard'; u.factionId = newF.id; s.garrisonUnitId = u.id;
      for (const m of unitMembers(u)) { m.factionId = newF.id; m.profession = 'guard'; }
      EventSystem.add('politics', `👑 กบฏยึด${s.name}สำเร็จ! ${leader.name} สถาปนา${newF.name}`);
      settlementHistory(s, `กบฏยึดเมือง ตั้ง${newF.name} ภายใต้${leader.name}`);
    } else {
      EventSystem.add('war', `🛡 กบฏที่${s.name}ถูกปราบ (ตาย ${result.atkResult.dead} คน) — ความไม่พอใจยังคุกรุ่น`);
      settlementHistory(s, `การลุกฮือของประชาชนถูกปราบ (ตาย ${result.atkResult.dead})`);
      s.unrest = clamp(s.unrest - 15, 0, 100);
      BanditSystem.disband(u);
    }
  },

  updateCamp(s) {
    // ค่ายโจรผลิตอาหารเล็กน้อย (ล่าสัตว์)
    const bandits = agentsAt(s.id).filter(a => a.profession === 'bandit');
    s.stock.food += bandits.length * 0.5 * Math.max(s.prodPotential.food, 0.3) * 3;
    s._wantedLevel = clamp((s._wantedLevel || 0) - 0.5, 0, 100);
    // ค่ายอดอยาก / wanted สูง → โจรอ่อนแรง แตกกลุ่ม หรือกลับตัว
    const perBanditFood = bandits.length ? s.stock.food / bandits.length : 99;
    if (perBanditFood < 2 || (s._wantedLevel || 0) > 60) {
      for (const u of world.units.filter(u => u.kind === 'warband' && u.factionId === s.factionId)) {
        if (u.supply.food < unitMembers(u).length && chance(0.2)) {
          BanditSystem.disband(u);
          EventSystem.add('bandit', `💨 ${u.name} แตกกลุ่มเพราะขาดเสบียงและถูกไล่ล่า`);
        } else u.morale = clamp(u.morale - 5, 0, 100);
      }
    }
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
      addDeed(heir, `สืบทอดบัลลังก์${f.name}ต่อจาก${dead.name}`, 15);
      factionTimeline(f, `${heir.name} ขึ้นเป็นผู้นำคนใหม่`);
      Chronicle.add({
        category: 'faction', importance: 4,
        title: `👑 ${heir.name} ขึ้นครองอำนาจ${f.name}`,
        description: `สืบทอดอำนาจต่อจาก${dead.name}ที่จากไป`,
        agents: [heir.id], factions: [f.id]
      });
    } else {
      EventSystem.add('politics', `💀 ${f.name} ไร้ผู้สืบทอด — อาณาจักรระส่ำระสาย`);
      factionTimeline(f, `ไร้ผู้สืบทอดหลัง${dead.name}ตาย — ระส่ำระสาย`);
      Chronicle.add({
        category: 'faction', importance: 4,
        title: `💀 ${f.name} เข้าสู่ยุคไร้ผู้นำ`,
        description: `การตายของ${dead.name}ทิ้งบัลลังก์ว่างไว้ ความไม่สงบแผ่ไปทุกหัวเมือง`,
        factions: [f.id]
      });
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
    factionTimeline(f, `ล่มสลาย สิ้นชื่อจากหน้าประวัติศาสตร์`);
    const age = world.day - f.foundedDay;
    Chronicle.add({
      category: 'faction', importance: 5,
      title: `🏴 ${f.name} ล่มสลาย`,
      description: `หลังยืนหยัดมา ${age} วัน ${f.name} สูญสิ้นดินแดนทั้งหมดและหายไปจากหน้าประวัติศาสตร์`,
      factions: [f.id]
    });
    // สงครามที่ค้างอยู่จบลง — ฝ่ายตรงข้ามชนะ
    for (const w of world.wars) {
      if (w.endDay) continue;
      if (w.attackerId === f.id) endWar(w, w.defenderId, `${f.name}ล่มสลาย`);
      else if (w.defenderId === f.id) endWar(w, w.attackerId, `${f.name}ล่มสลาย`);
    }
    f.warState = false;
    for (const other of world.factions) other.enemies = other.enemies.filter(e => e !== f.id);
  }
}

/* ═══════════════ 14.5 PHASE 11: DIPLOMACY SYSTEM ═══════════════ */

function defaultRelation() {
  return {
    score: 0, trust: 50, fear: 0, rivalry: 0, tradeValue: 0, borderTension: 0,
    lastWarDay: null, lastTreatyDay: null,
    tributeUntilDay: null, nonAggressionUntilDay: null, allianceUntilDay: null,
    vassalOf: null, overlordOf: []
  };
}

function ensureFactionDiplomacy(f) {
  if (!f) return;
  if (!f.diplomacy) {
    f.diplomacy = {
      relations: {},
      warExhaustion: 0,
      diplomaticPersonality: pick(['balanced', 'aggressive', 'trader', 'defensive', 'opportunist', 'honorable']),
      diplomaticMemory: []
    };
  }
  if (!f.diplomacy.relations) f.diplomacy.relations = {};
  if (f.diplomacy.warExhaustion == null) f.diplomacy.warExhaustion = 0;
  if (!f.diplomacy.diplomaticMemory) f.diplomacy.diplomaticMemory = [];
}

function getRelation(fA, fB) {
  if (!fA || !fB || fA.id === fB.id) return defaultRelation();
  ensureFactionDiplomacy(fA);
  if (!fA.diplomacy.relations[fB.id]) {
    const r = defaultRelation();
    if (areAtWar(fA, fB)) { r.score = -60; r.trust = 15; r.rivalry = 40; r.lastWarDay = world.day; }
    else if (fA.allies.includes(fB.id)) { r.score = 55; r.trust = 70; r.allianceUntilDay = world.day + 9999; }
    fA.diplomacy.relations[fB.id] = r;
  }
  return fA.diplomacy.relations[fB.id];
}

function changeRelation(fA, fB, delta, reason) {
  if (!fA || !fB || fA.id === fB.id) return;
  const r = getRelation(fA, fB);
  r.score = clamp(r.score + delta, -100, 100);
  if (reason) {
    fA.diplomacy.diplomaticMemory.push({ day: world.day, otherId: fB.id, text: reason, delta });
    if (fA.diplomacy.diplomaticMemory.length > 30) fA.diplomacy.diplomaticMemory.shift();
  }
}

function areAtWar(fA, fB) {
  if (!fA || !fB) return false;
  return fA.enemies.includes(fB.id) || !!activeWarBetween(fA.id, fB.id);
}

function areAllied(fA, fB) {
  if (!fA || !fB) return false;
  const r = getRelation(fA, fB);
  return fA.allies.includes(fB.id) || (r.allianceUntilDay && r.allianceUntilDay > world.day);
}

function isVassalOf(fA, fB) {
  if (!fA || !fB) return false;
  const r = getRelation(fA, fB);
  return r.vassalOf === fB.id || world.vassalContracts?.some(v => v.vassalFactionId === fA.id && v.overlordFactionId === fB.id && v.active);
}

function createTreaty(type, fA, fB, duration, terms) {
  if (!world.treaties) world.treaties = [];
  const t = {
    id: uid(),
    type,
    factions: [fA.id, fB.id],
    startDay: world.day,
    endDay: duration ? world.day + duration : null,
    terms: terms || {},
    status: 'active',
    brokenBy: null,
    history: [`Day ${world.day}: ลงนาม${type}`]
  };
  world.treaties.push(t);
  return t;
}

function setTreaty(fA, fB, type, duration) {
  if (!fA || !fB || fA.isBandit || fB.isBandit) return null;
  const dur = duration || 120;
  const rA = getRelation(fA, fB), rB = getRelation(fB, fA);
  const until = world.day + dur;
  if (type === 'non_aggression') {
    rA.nonAggressionUntilDay = until; rB.nonAggressionUntilDay = until;
    changeRelation(fA, fB, 15, 'ลงนามสัญญาไม่รุกราน');
    changeRelation(fB, fA, 15, 'ลงนามสัญญาไม่รุกราน');
    EventSystem.add('politics', `🤝 ${fA.name} กับ ${fB.name} ลงนามสัญญาไม่รุกราน ${dur} วัน`);
    Chronicle.add({ category: 'diplomacy', importance: 4, title: `🤝 สัญญาไม่รุกราน: ${fA.name}–${fB.name}`, description: `ทั้งสองฝ่ายตกลงไม่รุกรานกันเป็นเวลา ${dur} วัน`, factions: [fA.id, fB.id] });
    factionTimeline(fA, `ลงนามสัญญาไม่รุกรานกับ${fB.name}`);
    factionTimeline(fB, `ลงนามสัญญาไม่รุกรานกับ${fA.name}`);
    return createTreaty('non_aggression', fA, fB, dur);
  }
  if (type === 'alliance') {
    rA.allianceUntilDay = until; rB.allianceUntilDay = until;
    if (!fA.allies.includes(fB.id)) fA.allies.push(fB.id);
    if (!fB.allies.includes(fA.id)) fB.allies.push(fA.id);
    changeRelation(fA, fB, 30, 'พันธมิตร');
    changeRelation(fB, fA, 30, 'พันธมิตร');
    EventSystem.add('politics', `🛡 ${fA.name} กับ ${fB.name} สร้างพันธมิตร`);
    Chronicle.add({ category: 'diplomacy', importance: 5, title: `🛡 พันธมิตร: ${fA.name}–${fB.name}`, description: 'ทั้งสองฝ่ายร่วมมือป้องกันและสนับสนุนกัน', factions: [fA.id, fB.id] });
    factionTimeline(fA, `สร้างพันธมิตรกับ${fB.name}`);
    factionTimeline(fB, `สร้างพันธมิตรกับ${fA.name}`);
    return createTreaty('alliance', fA, fB, dur);
  }
  if (type === 'trade') {
    changeRelation(fA, fB, 12, 'ข้อตกลงการค้า');
    changeRelation(fB, fA, 12, 'ข้อตกลงการค้า');
    rA.tradeValue = Math.max(rA.tradeValue, 20);
    rB.tradeValue = Math.max(rB.tradeValue, 20);
    EventSystem.add('trade', `📜 ${fA.name} กับ ${fB.name} ลงนามข้อตกลงการค้า`);
    Chronicle.add({ category: 'diplomacy', importance: 3, title: `📜 ข้อตกลงการค้า: ${fA.name}–${fB.name}`, factions: [fA.id, fB.id] });
    return createTreaty('trade', fA, fB, dur, { tariffReduction: 0.15 });
  }
  if (type === 'peace') {
    const w = activeWarBetween(fA.id, fB.id);
    if (w) endWar(w, null, `สนธิสัญญาสันติภาพระหว่าง${fA.name}กับ${fB.name}`, { peaceType: 'peace_treaty' });
    changeRelation(fA, fB, 20, 'สงบศึก');
    changeRelation(fB, fA, 20, 'สงบศึก');
    return createTreaty('peace', fA, fB, dur);
  }
  return null;
}

function breakTreaty(fA, fB, reason) {
  if (!fA || !fB) return;
  const rA = getRelation(fA, fB), rB = getRelation(fB, fA);
  rA.trust = clamp(rA.trust - 35, 0, 100);
  rB.trust = clamp(rB.trust - 35, 0, 100);
  changeRelation(fA, fB, -40, `หักหลัง: ${reason}`);
  changeRelation(fB, fA, -40, `ถูกหักหลัง: ${reason}`);
  rA.nonAggressionUntilDay = null; rB.nonAggressionUntilDay = null;
  rA.allianceUntilDay = null; rB.allianceUntilDay = null;
  fA.allies = fA.allies.filter(id => id !== fB.id);
  fB.allies = fB.allies.filter(id => id !== fA.id);
  for (const t of world.treaties || []) {
    if (t.status !== 'active') continue;
    if (t.factions.includes(fA.id) && t.factions.includes(fB.id)) {
      t.status = 'broken';
      t.brokenBy = fA.id;
      t.history.push(`Day ${world.day}: ถูกทำลายโดย${fA.name} — ${reason}`);
    }
  }
  EventSystem.add('politics', `⚔ ${fA.name} หักหลัง${fB.name}! (${reason})`);
  Chronicle.add({ category: 'diplomacy', importance: 5, title: `⚔ การทรยศทางการทูต: ${fA.name} หักหลัง ${fB.name}`, description: reason, factions: [fA.id, fB.id] });
  factionTimeline(fA, `หักหลัง${fB.name}`);
  factionTimeline(fB, `ถูก${fA.name}หักหลังสนธิสัญญา`);
}

const DiplomacySystem = {
  DIPLO_INTERVAL: 5,

  initWorld() {
    if (!world.treaties) world.treaties = [];
    if (!world.vassalContracts) world.vassalContracts = [];
    for (const f of world.factions) {
      ensureFactionDiplomacy(f);
      for (const g of world.factions) {
        if (g.id !== f.id) getRelation(f, g);
      }
    }
  },

  syncFromLegacy() {
    this.initWorld();
    for (const f of world.factions) {
      for (const eid of f.enemies) {
        const other = getFaction(eid);
        if (other) { const r = getRelation(f, other); r.score = Math.min(r.score, -50); r.rivalry = Math.max(r.rivalry, 30); }
      }
      for (const aid of f.allies) {
        const other = getFaction(aid);
        if (other) { const r = getRelation(f, other); r.score = Math.max(r.score, 40); r.trust = Math.max(r.trust, 60); }
      }
    }
  },

  militaryPower(f) {
    if (!f) return 0;
    const settlements = world.settlements.filter(s => s.factionId === f.id);
    const soldiers = world.agents.filter(a => a.alive && a.factionId === f.id && MILITARY_PROFS.has(a.profession)).length;
    return settlements.length * 80 + soldiers * 12 + f.treasury * 0.05;
  },

  foodReserve(f) {
    return sum(world.settlements.filter(s => s.factionId === f.id), s => s.stock.food);
  },

  borderTensionBetween(fA, fB) {
    const sa = world.settlements.filter(s => s.factionId === fA.id && s.type !== 'camp');
    const sb = world.settlements.filter(s => s.factionId === fB.id && s.type !== 'camp');
    if (!sa.length || !sb.length) return 0;
    let minD = Infinity;
    for (const a of sa) for (const b of sb) minD = Math.min(minD, dist(a, b));
    const close = minD < 350 ? (350 - minD) / 350 * 40 : 0;
    const contested = world.routes.filter(r => {
      const fa = getSettlement(r.a), fb = getSettlement(r.b);
      return fa && fb && ((fa.factionId === fA.id && fb.factionId === fB.id) || (fa.factionId === fB.id && fb.factionId === fA.id));
    });
    const routeDanger = contested.length ? sum(contested, r => (r.threat || r.danger) * 20) / contested.length : 0;
    return clamp(close + routeDanger, 0, 100);
  },

  rulerStats(f) {
    const ruler = getAgent(f.rulerId);
    if (!ruler) return { ambition: 0.5, diplomacy: 2, governance: 2, leadership: 2 };
    return {
      ambition: ruler.gov?.ambition ?? ruler.traits?.ambition ?? 0.5,
      diplomacy: ruler.skills?.diplomacy ?? 2,
      governance: ruler.skills?.governance ?? 2,
      leadership: ruler.skills?.leadership ?? 2
    };
  },

  tick() {
    if (!world) return;
    this.updateTreaties();
    this.updateWarExhaustion();
    if (world.day % this.DIPLO_INTERVAL !== 0) return;
    this.update();
  },

  updateTreaties() {
    for (const t of world.treaties || []) {
      if (t.status !== 'active') continue;
      if (t.endDay && world.day >= t.endDay) {
        t.status = 'expired';
        t.history.push(`Day ${world.day}: หมดอายุ`);
        const fA = getFaction(t.factions[0]), fB = getFaction(t.factions[1]);
        if (fA && fB && t.type === 'alliance') {
          fA.allies = fA.allies.filter(id => id !== fB.id);
          fB.allies = fB.allies.filter(id => id !== fA.id);
        }
      }
    }
    this.processVassals();
  },

  updateWarExhaustion() {
    for (const f of world.factions) {
      if (f.isBandit) continue;
      ensureFactionDiplomacy(f);
      const atWar = f.warState || world.wars.some(w => !w.endDay && (w.attackerId === f.id || w.defenderId === f.id));
      if (atWar) {
        const w = world.wars.find(x => !x.endDay && (x.attackerId === f.id || x.defenderId === f.id));
        f.diplomacy.warExhaustion = clamp(f.diplomacy.warExhaustion + 0.15 + (w?.casualties || 0) * 0.002, 0, 100);
        if (f.diplomacy.warExhaustion > 50) {
          for (const s of world.settlements.filter(x => x.factionId === f.id)) s.unrest = clamp(s.unrest + 0.08, 0, 100);
        }
      } else {
        f.diplomacy.warExhaustion = Math.max(0, f.diplomacy.warExhaustion - 0.12);
      }
    }
  },

  processVassals() {
    for (const v of world.vassalContracts || []) {
      if (!v.active) continue;
      const overlord = getFaction(v.overlordFactionId), vassal = getFaction(v.vassalFactionId);
      if (!overlord || !vassal) { v.active = false; continue; }
      if (world.day - (v.lastTributeDay || v.startDay) >= 30) {
        const tribute = Math.min(vassal.treasury * v.tributeRate, 120);
        if (vassal.treasury >= tribute && tribute > 5) {
          vassal.treasury -= tribute;
          overlord.treasury += tribute;
          v.lastTributeDay = world.day;
          if (chance(0.15)) EventSystem.add('economy', `💰 ${vassal.name} ส่งบรรณาการ ${fmt(tribute)} ทองให้${overlord.name}`);
        } else {
          v.brokenPromises = (v.brokenPromises || 0) + 1;
          v.loyalty = clamp((v.loyalty || 50) - 3, 0, 100);
        }
      }
      if ((v.loyalty || 50) < 25 && chance(0.04)) this.breakVassalage(vassal, overlord, 'ประกาศเอกราชจากความไม่พอใจ');
      if (vassal.treasury > overlord.treasury * 1.5 && (v.loyalty || 50) > 40 && chance(0.02)) {
        this.breakVassalage(vassal, overlord, 'แข็งแกร่งพอจะแยกตัวได้');
      }
    }
  },

  update() {
    const factions = world.factions.filter(f => !f.isBandit && world.settlements.some(s => s.factionId === f.id));
    for (const f of factions) {
      for (const other of factions) {
        if (other.id === f.id) continue;
        const r = getRelation(f, other);
        r.borderTension = this.borderTensionBetween(f, other);
        r.tradeValue = this.estimateTradeValue(f, other);
        this.evaluatePair(f, other);
      }
    }
  },

  estimateTradeValue(fA, fB) {
    const routes = world.routes.filter(r => {
      const a = getSettlement(r.a), b = getSettlement(r.b);
      return a && b && ((a.factionId === fA.id && b.factionId === fB.id) || (a.factionId === fB.id && b.factionId === fA.id));
    });
    if (!routes.length) return 0;
    return clamp(routes.length * 18 + sum(routes, r => r.traffic * 3), 12, 100);
  },

  evaluatePair(f, other) {
    if (areAtWar(f, other)) {
      this.considerPeace(f, other);
      return;
    }
    const rs = this.rulerStats(f);
    const myPow = this.militaryPower(f), theirPow = this.militaryPower(other);
    const r = getRelation(f, other);
    const exhaustion = f.diplomacy.warExhaustion;

    if (r.nonAggressionUntilDay && r.nonAggressionUntilDay > world.day) {
      if (f.diplomacy.diplomaticPersonality === 'opportunist' && theirPow < myPow * 0.6 && rs.ambition > 0.7 && chance(0.03)) {
        this.betray(f, other, 'ฉวยโอกาสทำลายสัญญาไม่รุกราน');
        return;
      }
    }

    const warScore = (theirPow < myPow * 0.7 ? 25 : 0) + r.borderTension * 0.4 + rs.ambition * 30
      - exhaustion * 0.5 - (r.tradeValue * 0.3) - (r.score > 20 ? r.score * 0.2 : 0)
      - (r.nonAggressionUntilDay > world.day ? 50 : 0)
      - (areAllied(f, other) ? 80 : 0);
    const peaceScore = exhaustion * 0.8 + (f.treasury < 200 ? 15 : 0) + (this.foodReserve(f) < 80 ? 20 : 0)
      - (myPow > theirPow * 1.3 ? 20 : 0);
    const vassalScore = (theirPow > myPow * 1.4 ? 30 : 0) + (this.foodReserve(f) < 60 ? 15 : 0)
      - rs.ambition * 25 - (myPow > 50 ? 10 : 0);
    const allianceScore = r.trust * 0.3 + r.tradeValue * 0.4 + (r.rivalry > 30 ? -20 : 0)
      - (r.score < -20 ? 30 : 0);

    const warThresh = f.diplomacy.diplomaticPersonality === 'aggressive' ? 35 : f.diplomacy.diplomaticPersonality === 'defensive' ? 55 : 45;
    if (warScore > warThresh && !isVassalOf(f, other) && chance(0.1)) {
      this.declareWar(f, other, 'ความตึงเครียดชายแดนและความทะเยอทะยานของผู้นำ');
      return;
    }
    if (allianceScore > 38 && r.trust > 48 && !areAllied(f, other) && chance(0.14)) {
      setTreaty(f, other, 'alliance', 180);
      return;
    }
    if (allianceScore > 22 && r.trust > 35 && !r.nonAggressionUntilDay && chance(0.16)) {
      setTreaty(f, other, 'non_aggression', 90);
      return;
    }
    if (r.tradeValue > 15 && r.score > -15 && chance(0.12)) {
      setTreaty(f, other, 'trade', 120);
      return;
    }
    if (vassalScore > 35 && theirPow > myPow * 1.4 && chance(0.08)) {
      this.offerVassalage(f, other);
      return;
    }
    if (theirPow > myPow * 1.2 && f.treasury < 180 && chance(0.07)) {
      this.payTribute(f, other);
    }
    if (theirPow > myPow * 1.8 && chance(0.05)) {
      this.demandSurrender(other, f);
    }
    if (!areAtWar(f, other) && r.trust > 40 && world.day > 20 && chance(0.2)) {
      if (r.tradeValue > 12 && !(world.treaties || []).some(t => t.status === 'active' && t.type === 'trade' && t.factions.includes(f.id) && t.factions.includes(other.id))) {
        setTreaty(f, other, 'trade', 100);
      } else if (!r.nonAggressionUntilDay && chance(0.55)) {
        setTreaty(f, other, 'non_aggression', 80);
      }
    }
  },

  considerPeace(f, other) {
    const exhaustion = f.diplomacy.warExhaustion;
    const rs = this.rulerStats(f);
    const peaceScore = exhaustion * 0.9 + (f.treasury < 150 ? 20 : 0) - rs.ambition * 25;
    if (peaceScore > 32 && chance(0.22)) {
      this.offerPeace(f, other);
    }
  },

  declareWar(f, other, cause) {
    if (areAtWar(f, other)) return;
    if (getRelation(f, other).nonAggressionUntilDay > world.day || areAllied(f, other)) {
      this.betray(f, other, 'ประกาศสงครามทั้งที่มีสัญญา');
    }
    startWar(f, other, cause);
  },

  offerPeace(f, other) {
    const w = activeWarBetween(f.id, other.id);
    if (!w) return;
    const otherExhaustion = other.diplomacy?.warExhaustion || 0;
    const accept = otherExhaustion > 35 || this.militaryPower(f) > this.militaryPower(other) * 1.2;
    if (accept && chance(0.5)) {
      EventSystem.add('politics', `🕊 ${f.name} กับ ${other.name} ตกลงสงบศึก`);
      setTreaty(f, other, 'peace', 60);
      Chronicle.add({ category: 'diplomacy', importance: 5, title: `🕊 สงบศึก: ${f.name}–${other.name}`, description: 'สงครามยาวนานจบลงด้วยการเจรจา', factions: [f.id, other.id] });
    }
  },

  payTribute(f, other) {
    const amount = Math.min(f.treasury * 0.12, 80);
    if (amount < 10) return;
    f.treasury -= amount;
    other.treasury += amount;
    getRelation(f, other).tributeUntilDay = world.day + 60;
    changeRelation(f, other, 10, 'ส่งบรรณาการ');
    changeRelation(other, f, 8, 'ได้รับบรรณาการ');
    EventSystem.add('economy', `💰 ${f.name} ส่งบรรณาการ ${fmt(amount)} ทองให้${other.name}`);
    Chronicle.add({ category: 'diplomacy', importance: 3, title: `💰 บรรณาการ: ${f.name} → ${other.name}`, description: `จ่าย ${fmt(amount)} ทองเพื่อหลีกเลี่ยงความขัดแย้ง`, factions: [f.id, other.id] });
  },

  offerVassalage(vassal, overlord) {
    if (isVassalOf(vassal, overlord)) return;
    const r = getRelation(vassal, overlord);
    r.vassalOf = overlord.id;
    getRelation(overlord, vassal).overlordOf = getRelation(overlord, vassal).overlordOf || [];
    if (!getRelation(overlord, vassal).overlordOf.includes(vassal.id)) getRelation(overlord, vassal).overlordOf.push(vassal.id);
    if (!overlord.vassalIds.includes(vassal.id)) overlord.vassalIds.push(vassal.id);
    const contract = {
      overlordFactionId: overlord.id, vassalFactionId: vassal.id,
      startDay: world.day, tributeRate: 0.08, militarySupportExpected: true,
      protectionExpected: true, loyalty: 65, autonomy: 0.7,
      lastTributeDay: world.day, brokenPromises: 0, active: true
    };
    world.vassalContracts.push(contract);
    createTreaty('vassalage', overlord, vassal, 365, { tributeRate: 0.08 });
    EventSystem.add('politics', `👑 ${vassal.name} ยอมเป็นเมืองขึ้นของ${overlord.name}`);
    Chronicle.add({ category: 'diplomacy', importance: 5, title: `👑 เมืองขึ้น: ${vassal.name} ภายใต้ ${overlord.name}`, factions: [vassal.id, overlord.id] });
    factionTimeline(vassal, `ยอมเป็นเมืองขึ้นของ${overlord.name}`);
    factionTimeline(overlord, `รับ${vassal.name}เป็นเมืองขึ้น`);
    const w = activeWarBetween(vassal.id, overlord.id);
    if (w) endWar(w, overlord.id, `${vassal.name}ยอมจำนนเป็นเมืองขึ้น`, { peaceType: 'vassalage' });
  },

  breakVassalage(vassal, overlord, reason) {
    for (const v of world.vassalContracts) {
      if (v.vassalFactionId === vassal.id && v.overlordFactionId === overlord.id) v.active = false;
    }
    getRelation(vassal, overlord).vassalOf = null;
    overlord.vassalIds = overlord.vassalIds.filter(id => id !== vassal.id);
    changeRelation(vassal, overlord, -25, reason);
    EventSystem.add('politics', `🔥 ${vassal.name} แยกตัวจาก${overlord.name} (${reason})`);
    Chronicle.add({ category: 'diplomacy', importance: 4, title: `🔥 ${vassal.name} แยกตัวจากเจ้าเหนือหัว`, description: reason, factions: [vassal.id, overlord.id] });
    factionTimeline(vassal, `แยกตัวจาก${overlord.name}: ${reason}`);
    if (chance(0.35)) this.declareWar(vassal, overlord, reason);
  },

  demandSurrender(strong, weak) {
    if (areAtWar(strong, weak)) return;
    const accept = this.militaryPower(weak) < this.militaryPower(strong) * 0.35 && weak.diplomacy.warExhaustion > 30;
    if (accept && chance(0.4)) {
      this.offerVassalage(weak, strong);
    } else if (chance(0.3)) {
      changeRelation(weak, strong, -15, 'ปฏิเสธคำขาด');
      this.declareWar(strong, weak, `${weak.name}ปฏิเสธคำขาด`);
    }
  },

  betray(f, other, reason) {
    breakTreaty(f, other, reason);
  },

  onWarDeclared(attacker, defender, cause) {
    ensureFactionDiplomacy(attacker);
    ensureFactionDiplomacy(defender);
    changeRelation(attacker, defender, -30, 'สงคราม');
    changeRelation(defender, attacker, -35, 'ถูกรุกราน');
    getRelation(attacker, defender).lastWarDay = world.day;
    getRelation(defender, attacker).lastWarDay = world.day;
    getRelation(attacker, defender).rivalry = clamp(getRelation(attacker, defender).rivalry + 20, 0, 100);
    for (const t of world.treaties || []) {
      if (t.status === 'active' && t.factions.includes(attacker.id) && t.factions.includes(defender.id)) {
        t.status = 'broken';
        t.brokenBy = attacker.id;
      }
    }
  },

  onWarEnded(w, winnerId, reason, peaceOpts) {
    const att = getFaction(w.attackerId), def = getFaction(w.defenderId);
    if (att) att.diplomacy.warExhaustion = Math.max(0, att.diplomacy.warExhaustion - 15);
    if (def) def.diplomacy.warExhaustion = Math.max(0, def.diplomacy.warExhaustion - 15);
    if (peaceOpts?.peaceType === 'peace_treaty' && att && def) {
      changeRelation(att, def, 15, 'สงบศึก');
      changeRelation(def, att, 15, 'สงบศึก');
    }
  },

  /* Sandbox / test helpers */
  forcePeace(fA, fB) { setTreaty(fA, fB, 'peace', 120); },
  forceWar(fA, fB) { this.declareWar(fA, fB, '[Sandbox] บังคับสงคราม'); },
  improveRelations(fA, fB, n) { changeRelation(fA, fB, n || 30, '[Sandbox] ปรับปรุงความสัมพันธ์'); changeRelation(fB, fA, n || 30, '[Sandbox] ปรับปรุงความสัมพันธ์'); },
  damageRelations(fA, fB, n) { changeRelation(fA, fB, -(n || 30), '[Sandbox] ทำลายความสัมพันธ์'); changeRelation(fB, fA, -(n || 30), '[Sandbox] ทำลายความสัมพันธ์'); },
  forceAlliance(fA, fB) { setTreaty(fA, fB, 'alliance', 200); },
  forceBreakTreaty(fA, fB) { breakTreaty(fA, fB, '[Sandbox] บังคับยกเลิกสนธิสัญญา'); },
  forceVassal(vassal, overlord) { this.offerVassalage(vassal, overlord); },

  diplomacySummaryHTML() {
    const factions = world.factions.filter(f => !f.isBandit && world.settlements.some(s => s.factionId === f.id));
    let html = '';
    for (const f of factions) {
      html += `<div class="dip-faction"><b style="color:${f.color}">■ ${f.name}</b>`;
      html += ` <span class="dip-meta">เหนื่อยล้า ${fmt(f.diplomacy?.warExhaustion || 0, 0)}% · ${f.diplomacy?.diplomaticPersonality || '?'}</span>`;
      html += `<ul class="dip-list">`;
      for (const other of factions) {
        if (other.id === f.id) continue;
        const r = getRelation(f, other);
        const state = areAtWar(f, other) ? '⚔ สงคราม' : areAllied(f, other) ? '🛡 พันธมิตร' : isVassalOf(f, other) ? '👑 เมืองขึ้น' : isVassalOf(other, f) ? '👑 เจ้าเหนือหัว' : '🕊 เป็นกลาง';
        const treaties = (world.treaties || []).filter(t => t.status === 'active' && t.factions.includes(f.id) && t.factions.includes(other.id)).map(t => t.type).join(', ');
        html += `<li>${this.linkFaction(other)}: <span class="${r.score < -20 ? 'bad' : r.score > 20 ? 'good' : ''}">${fmt(r.score)}</span> ${state}${treaties ? ` [${treaties}]` : ''}</li>`;
      }
      html += `</ul></div>`;
    }
    const activeTreaties = (world.treaties || []).filter(t => t.status === 'active').slice(-8);
    if (activeTreaties.length) {
      html += `<div class="dip-section"><b>สนธิสัญญาที่ใช้อยู่</b><ul class="dip-list">`;
      for (const t of activeTreaties) {
        const names = t.factions.map(id => getFaction(id)?.name || '?').join(' ↔ ');
        html += `<li>${t.type}: ${names} (Day ${t.startDay}${t.endDay ? '–' + t.endDay : ''})</li>`;
      }
      html += `</ul></div>`;
    }
    return html || '<p class="hint">ยังไม่มีความสัมพันธ์ทางการทูต</p>';
  },

  linkFaction(f) { return f ? `<span style="color:${f.color}">${f.name}</span>` : '?'; }
};

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

  /* 5. ราคา + settlement metrics */
  for (const s of world.settlements) {
    SettlementMetrics.update(s);
    EconomySystem.updateDemandAndPrices(s);
  }

  /* 5.5 Phase 10.5: logistics & route security */
  LogisticsSystem.updatePriceGaps();
  for (const s of world.settlements) LogisticsSystem.updateSettlement(s);
  LogisticsSystem.traderRespawn();
  RouteSecuritySystem.update();

  /* 6-8. Agent AI + งาน + พ่อค้า */
  for (const a of world.agents) {
    if (!a.alive) continue;
    if (a.travel && !a.unitId) {
      const wasTraveling = !!a.travel;
      const arrived = advanceTravel(a, agentSpeed(a));
      if (a.cargo) BanditSystem.interceptCaravan(a);
      if (arrived) {
        if (!a.memory.citiesVisited.includes(a.locationId)) a.memory.citiesVisited.push(a.locationId);
        if (a.cargo || a.isEmergencyCaravan) TraderSystem.onArrive(a);
        else if (a.travel === null && a.profession === 'migrant') { a.profession = 'unemployed'; a.homeId = a.locationId; }
      } else if (wasTraveling && !a.travel && (a.isTownCaravan || a.isEmergencyCaravan)) {
        clearTownCaravan(a, 'lost');
        if (!a.cargo) { /* already cleared */ }
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
  DiplomacySystem.tick();

  // เติม garrison จากทหารว่าง
  for (const s of world.settlements) {
    ensureGarrison(s);
    if (s.type !== 'camp') LogisticsSystem.validateCaravanSlots(s);
  }

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
    if (pop > s.housingCapacity * 1.25) continue;
    const foodOk = s.stock.food > s.demand.food * 0.6 && s.crowding < 1.15;
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

  /* ── Phase 10: บันทึกประวัติอาชีพ (career) ของทุก agent ── */
  for (const a of world.agents) {
    if (!a.alive) continue;
    const last = a.career[a.career.length - 1];
    if (last.profession !== a.profession) {
      a.career.push({ day: world.day, profession: a.profession });
      if (a.career.length > 12) a.career.splice(1, 1); // เก็บอาชีพแรกไว้เสมอ
    }
  }

  /* ── สงครามยืดเยื้อไร้ผลแพ้ชนะ → สงบศึก ── */
  for (const w of world.wars) {
    if (w.endDay) continue;
    const lastBattleDay = w.battles.length ? w.battles[w.battles.length - 1].day : w.startDay;
    if (world.day - lastBattleDay > 60 && world.day - w.startDay > 90) {
      const att = getFaction(w.attackerId), def = getFaction(w.defenderId);
      if (att && def && !att.isBandit && !def.isBandit) {
        setTreaty(att, def, 'peace', 120);
      } else {
        endWar(w, null, 'ทั้งสองฝ่ายอ่อนล้าจนสงครามค่อยๆ มอดดับ', { peaceType: 'peace_treaty' });
      }
    }
  }

  /* ── สรุปยุคสมัยอัตโนมัติทุก 50 วัน ── */
  if (world.day % 50 === 0) generateEraSummary();

  /* สรุปสถานการณ์ทุก 15 วัน */
  if (world.day % 15 === 0) {
    const alive = world.agents.filter(a => a.alive).length;
    const avgFood = sum(marketSettlements(), s => s.prices.food) / marketSettlements().length;
    EventSystem.add('system', `📊 Day ${world.day}: ประชากร ${alive} | ราคาอาหารเฉลี่ย ${fmt(avgFood, 1)} | ศึก ${world.stats.battles} | ปล้น ${world.stats.raids + world.stats.caravansRobbed} | ตาย ${world.stats.deaths}`);
  }

  UI.inspectorDirty = true;
  if (typeof SaveSystem !== 'undefined') SaveSystem.tickAutoSave();
}

/* ── สร้างข้อความสรุปยุคสมัย 50 วันเป็นภาษาไทย ── */
function generateEraSummary() {
  const st = world.stats;
  const prev = world._eraSnapshot || { deaths: 0, battles: 0, raids: 0, caravansRobbed: 0 };
  const d = {
    deaths: st.deaths - prev.deaths,
    battles: st.battles - prev.battles,
    raids: (st.raids - prev.raids) + (st.caravansRobbed - prev.caravansRobbed)
  };
  world._eraSnapshot = { deaths: st.deaths, battles: st.battles, raids: st.raids, caravansRobbed: st.caravansRobbed };

  const from = world.day - 49;
  const mkts = marketSettlements();
  const avgFood = sum(mkts, s => s.prices.food) / Math.max(mkts.length, 1);
  const richest = mkts.reduce((m, s) => s.treasury > m.treasury ? s : m, mkts[0]);
  const hungriest = mkts.reduce((m, s) => s.prices.food > m.prices.food ? s : m, mkts[0]);
  const famous = world.agents.filter(a => a.alive && a.fame > 0).sort((a, b) => b.fame - a.fame)[0];
  const activeWar = world.wars.find(w => !w.endDay);

  let theme, detail;
  if (d.battles >= 5 || activeWar) {
    theme = 'ยุคแห่งสงคราม';
    detail = activeWar
      ? `${activeWar.name}ยังคุกรุ่น มีศึกปะทุ ${d.battles} ครั้งในช่วงนี้`
      : `แผ่นดินลุกเป็นไฟด้วยศึก ${d.battles} ครั้ง`;
  } else if (d.raids >= 10) {
    theme = 'ยุคโจรชุกชุม';
    detail = `เส้นทางการค้ากลายเป็นแดนอันตราย มีการปล้นถึง ${d.raids} ครั้ง พ่อค้าต้องเสี่ยงชีวิตแลกกำไร`;
  } else if (d.deaths >= 20 || avgFood > 25) {
    theme = 'ยุคแห่งความอดอยาก';
    detail = `ราคาอาหารเฉลี่ยพุ่งสูงถึง ${fmt(avgFood, 1)} ทอง ${hungriest.name}เดือดร้อนหนักที่สุด มีผู้เสียชีวิต ${d.deaths} ราย`;
  } else if (avgFood < 12 && d.deaths < 10) {
    theme = 'ยุคแห่งความรุ่งเรือง';
    detail = `การค้าคึกคัก อาหารถูก (เฉลี่ย ${fmt(avgFood, 1)} ทอง) ${richest.name}มั่งคั่งที่สุดด้วยคลัง ${fmt(richest.treasury)} ทอง`;
  } else {
    theme = 'ยุคแห่งการฟื้นตัว';
    detail = `ผู้คนเริ่มตั้งหลักได้ ราคาอาหารเฉลี่ย ${fmt(avgFood, 1)} ทอง`
      + (d.raids > 0 ? ` แม้ยังมีการปล้นอยู่บ้าง (${d.raids} ครั้ง)` : ' เส้นทางการค้าสงบผิดปกติ');
  }
  let text = `ช่วงวันที่ ${from}-${world.day} คือ${theme} — ${detail}`;
  if (famous) text += ` ผู้ที่ถูกกล่าวขานมากที่สุดคือ ${famous.name}${famous.title ? ` "${famous.title}"` : ''}`;

  world.eras.push({ from, to: world.day, theme, text });
  if (world.eras.length > 40) world.eras.shift();
  Chronicle.add({ category: 'era', importance: 4, title: `📜 ${theme} (วันที่ ${from}-${world.day})`, description: text });
  EventSystem.add('system', `📜 ${text}`);
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
    if (!world) {
      ctx.fillStyle = '#141b14';
      ctx.fillRect(0, 0, this.w, this.h);
      return;
    }

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
    if (sel.kind === 'faction') return; // faction ไม่มีตำแหน่งบนแผนที่
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
    } else if (sel.kind === 'route') {
      const route = world.routes.find(rt => rt.id === sel.id);
      if (!route) return;
      const a = getSettlement(route.a), b = getSettlement(route.b);
      if (!a || !b) return;
      x = (this.sx(a.x) + this.sx(b.x)) / 2;
      y = (this.sy(a.y) + this.sy(b.y)) / 2;
      r = 12;
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
    // 4) routes (คลิกใกล้เส้นทาง)
    let bestR = null, bestRd = 12;
    for (const r of world.routes) {
      if (r.destroyed) continue;
      const a = getSettlement(r.a), b = getSettlement(r.b);
      if (!a || !b) continue;
      const ax = this.sx(a.x), ay = this.sy(a.y), bx = this.sx(b.x), by = this.sy(b.y);
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy || 1;
      const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
      const distLine = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (distLine < bestRd) { bestRd = distLine; bestR = r; }
    }
    if (bestR && bestRd < 10) return { kind: 'route', id: bestR.id };

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
  chronicleDirty: true,
  chronicleFilter: 'all',
  chronicleOpen: false,
  _lastTickTime: 0,

  init() {
    // ── toolbar ──
    document.getElementById('btnPause').addEventListener('click', () => {
      this.paused = !this.paused;
      document.getElementById('btnPause').textContent = this.paused ? '▶ Resume' : '⏸ Pause';
    });
    document.getElementById('btnStep').addEventListener('click', () => { simulateDay(); });
    document.getElementById('btnReset').addEventListener('click', () => {
      if (!confirm('สร้างโลกใหม่ทั้งหมด? (การบันทึกในเครื่องจะไม่ถูกลบ)')) return;
      generateWorld();
      this.selected = null;
      this.logDirty = true;
      if (typeof SaveSystem !== 'undefined') {
        SaveSystem.lastSaveKind = null;
        SaveSystem.updateStatusUI();
      }
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

    // ── Phase 10: Chronicle panel ──
    document.getElementById('btnChronicle').addEventListener('click', () => {
      this.chronicleOpen = !this.chronicleOpen;
      document.getElementById('chroniclePanel').classList.toggle('hidden', !this.chronicleOpen);
      document.getElementById('summaryModal').classList.add('hidden');
      if (this.chronicleOpen) { this.chronicleDirty = true; }
    });
    document.getElementById('chronClose').addEventListener('click', () => {
      this.chronicleOpen = false;
      document.getElementById('chroniclePanel').classList.add('hidden');
    });
    for (const btn of document.querySelectorAll('.chron-filter')) {
      btn.addEventListener('click', () => {
        this.chronicleFilter = btn.dataset.f;
        document.querySelectorAll('.chron-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.chronicleDirty = true;
      });
    }

    // ── Phase 10: World summary ──
    document.getElementById('btnWorldSummary').addEventListener('click', () => {
      const modal = document.getElementById('summaryModal');
      const opening = modal.classList.contains('hidden');
      modal.classList.toggle('hidden');
      document.getElementById('chroniclePanel').classList.add('hidden');
      this.chronicleOpen = false;
      if (opening) this.renderWorldSummary();
    });
    document.getElementById('summaryClose').addEventListener('click', () => {
      document.getElementById('summaryModal').classList.add('hidden');
    });

    document.getElementById('btnDiplomacy')?.addEventListener('click', () => {
      const p = document.getElementById('diplomacyPanel');
      if (!p) return;
      p.classList.toggle('hidden');
      document.getElementById('chroniclePanel')?.classList.add('hidden');
      document.getElementById('summaryModal')?.classList.add('hidden');
      document.getElementById('savePanel')?.classList.add('hidden');
      this.chronicleOpen = false;
      const body = document.getElementById('diplomacyBody');
      if (body) body.innerHTML = DiplomacySystem.diplomacySummaryHTML();
    });
    document.getElementById('diplomacyClose')?.addEventListener('click', () => {
      document.getElementById('diplomacyPanel')?.classList.add('hidden');
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
    document.getElementById('dayCounter').textContent = world ? `Day ${world.day}` : 'Day —';
    if (this.logDirty) { this.renderLog(); this.logDirty = false; }
    if (this.inspectorDirty) { this.renderInspector(); this.inspectorDirty = false; }
    if (this.chronicleOpen && this.chronicleDirty) { this.renderChronicle(); this.chronicleDirty = false; }
    requestAnimationFrame(t => this.loop(t));
  },

  /* ── Phase 10: Chronicle rendering ── */
  renderChronicle() {
    const el = document.getElementById('chronicleList');
    const f = this.chronicleFilter;

    if (f === 'heroes') {
      // หอเกียรติยศ — ตัวละคร fame สูงสุด (รวมที่ตายแล้วผ่าน legacy ใน chronicle)
      const heroes = world.agents.filter(a => a.alive && a.fame >= 8)
        .sort((a, b) => b.fame - a.fame).slice(0, 30);
      el.innerHTML = heroes.length
        ? heroes.map(a =>
          `<div class="hero-row" data-agent="${a.id}">
             <span><span class="hr-name">${a.name}</span>${a.title ? ` <span class="hr-title">"${a.title}"</span>` : ''}
             <div class="ce-desc">${a.profession} · ${a.deeds.length ? a.deeds[a.deeds.length - 1].text : '—'}</div></span>
             <span class="hr-fame">⭐ ${fmt(a.fame)}</span>
           </div>`).join('')
        : '<p class="hint">ยังไม่มีผู้ใดสร้างชื่อ — รอวีรบุรุษคนแรกของแผ่นดิน</p>';
      for (const row of el.querySelectorAll('.hero-row')) {
        row.addEventListener('click', () => {
          this.selected = { kind: 'agent', id: +row.dataset.agent };
          this.inspectorDirty = true;
        });
      }
      return;
    }

    if (f === 'wars') {
      // ประวัติสงครามทั้งหมด
      const wars = world.wars.slice().reverse();
      el.innerHTML = wars.length
        ? wars.map(w => {
          const att = getFaction(w.attackerId), def = getFaction(w.defenderId);
          const status = w.endDay
            ? w.summary
            : `กำลังดำเนินอยู่ (เริ่มวันที่ ${w.startDay}) — ศึกแล้ว ${w.battles.length} ครั้ง สูญเสีย ${w.casualties} ชีวิต ยึดได้ ${w.captured.length} แห่ง`;
          return `<div class="war-block ${w.endDay ? '' : 'active-war'}">
                    <div class="wb-name">${w.endDay ? '🕊' : '⚔'} ${w.name}</div>
                    <div class="ce-desc">${att ? att.name : '?'} vs ${def ? def.name : '?'} · ${w.cause || ''}</div>
                    <div class="wb-sum">${status}</div>
                    ${w.battles.slice(-4).map(b => `<div class="timeline-entry"><span class="tl-day">Day ${b.day}</span><span class="tl-text">${b.name} (${b.attackerWon ? 'ฝ่ายบุกชนะ' : 'ฝ่ายรับชนะ'} ตาย ${b.dead})</span></div>`).join('')}
                  </div>`;
        }).join('')
        : '<p class="hint">แผ่นดินยังไม่เคยมีสงครามใหญ่ — สันติภาพอันเปราะบาง</p>';
      return;
    }

    const entries = world.chronicle.filter(e => f === 'all' || e.category === f).slice(-200).reverse();
    el.innerHTML = entries.length
      ? entries.map(e =>
        `<div class="chron-entry imp-${e.importance} cat-${e.category}">
           <div class="ce-title"><span class="ce-day">Day ${e.day}</span>${e.title}</div>
           ${e.description ? `<div class="ce-desc">${e.description}</div>` : ''}
         </div>`).join('')
      : '<p class="hint">ยังไม่มีบันทึกในหมวดนี้ — ประวัติศาสตร์กำลังรอถูกเขียน</p>';
  },

  /* ── Phase 10: World summary ── */
  renderWorldSummary() {
    const el = document.getElementById('summaryBody');
    const alive = world.agents.filter(a => a.alive);
    const mkts = marketSettlements();
    const liveFactions = world.factions.filter(fc => world.settlements.some(s => s.factionId === fc.id));

    // faction ที่แข็งแกร่งสุด = ถิ่นฐาน×100 + ทหาร×10 + คลัง×0.1
    const strongest = liveFactions.reduce((m, fc) => {
      const power = world.settlements.filter(s => s.factionId === fc.id).length * 100
        + alive.filter(a => a.factionId === fc.id && MILITARY_PROFS.has(a.profession)).length * 10
        + fc.treasury * 0.1;
      return power > m.power ? { f: fc, power } : m;
    }, { f: null, power: -1 }).f;

    const richest = mkts.reduce((m, s) => s.treasury > m.treasury ? s : m, mkts[0]);
    const hungriest = mkts.reduce((m, s) => (s.prices.food / Math.max(s.stock.food, 1)) > (m.prices.food / Math.max(m.stock.food, 1)) ? s : m, mkts[0]);
    const famous = alive.filter(a => a.fame > 0).sort((a, b) => b.fame - a.fame)[0];
    const activeWars = world.wars.filter(w => !w.endDay);
    const banditCount = alive.filter(a => a.profession === 'bandit').length;
    const starvingTowns = mkts.filter(s => s.stock.food < 15 && populationOf(s) > 3);
    const unrestTowns = mkts.filter(s => s.unrest > 55);

    // ภัยคุกคามหลัก
    const threats = [];
    if (activeWars.length) threats.push(`สงคราม ${activeWars.length} ศึกที่ยังไม่จบ`);
    if (banditCount >= 8) threats.push(`โจร ${banditCount} คนที่คุกคามเส้นทางการค้า`);
    if (starvingTowns.length) threats.push(`${starvingTowns.map(s => s.name).join(', ')} กำลังขาดแคลนอาหาร`);
    if (unrestTowns.length) threats.push(`ความไม่สงบคุกรุ่นใน${unrestTowns.map(s => s.name).join(', ')}`);
    if (!threats.length) threats.push('ไม่มีภัยคุกคามใหญ่ — แผ่นดินอยู่ในความสงบ (ชั่วคราว?)');

    let html = `<div class="sum-section"><span class="sum-head">ภาพรวม ณ วันที่ ${world.day}</span><br>`;
    html += `แผ่นดินนี้มีประชากร ${alive.length} ชีวิตใน ${world.settlements.length} ถิ่นฐาน ภายใต้ ${liveFactions.length} ฝ่าย `;
    html += `ตลอดประวัติศาสตร์เกิดศึก ${world.stats.battles} ครั้ง การปล้น ${world.stats.raids + world.stats.caravansRobbed} ครั้ง และมีผู้เสียชีวิตรวม ${world.stats.deaths} ราย</div>`;

    if (strongest) {
      const ruler = getAgent(strongest.rulerId);
      html += `<div class="sum-section"><span class="sum-head">มหาอำนาจ</span><br><span style="color:${strongest.color}">■</span> ${strongest.name} คือฝ่ายที่แข็งแกร่งที่สุด`;
      if (ruler) html += ` ภายใต้การนำของ ${ruler.name}${ruler.title ? ` "${ruler.title}"` : ''}`;
      html += `</div>`;
    }
    html += `<div class="sum-section"><span class="sum-head">เศรษฐกิจ</span><br>`;
    html += `เมืองที่มั่งคั่งที่สุดคือ ${richest.name} (คลัง ${fmt(richest.treasury)} ทอง) `;
    html += `ส่วนที่เดือดร้อนที่สุดคือ ${hungriest.name} (อาหารเหลือ ${fmt(hungriest.stock.food)} ราคา ${fmt(hungriest.prices.food, 1)})</div>`;

    if (famous) {
      html += `<div class="sum-section"><span class="sum-head">บุคคลแห่งยุค</span><br>`;
      html += `${famous.name}${famous.title ? ` "${famous.title}"` : ''} (fame ${fmt(famous.fame)}) — ${lifeSummary(famous)}</div>`;
    }
    if (activeWars.length) {
      html += `<div class="sum-section"><span class="sum-head">สงครามที่กำลังดำเนิน</span><br>`;
      html += activeWars.map(w => `${w.name} (เริ่มวันที่ ${w.startDay} ศึกแล้ว ${w.battles.length} ครั้ง)`).join('<br>');
      html += `</div>`;
    }
    html += `<div class="sum-section"><span class="sum-head">ภัยคุกคามหลัก</span><br>${threats.join('<br>')}</div>`;

    const kingdoms = liveFactions.filter(f => !f.isBandit);
    const activeTreaties = (world.treaties || []).filter(t => t.status === 'active');
    const alliances = activeTreaties.filter(t => t.type === 'alliance');
    const vassals = (world.vassalContracts || []).filter(v => v.active);
    const maxExhaust = kingdoms.reduce((m, f) => Math.max(m, f.diplomacy?.warExhaustion || 0), 0);
    const exhaustedF = kingdoms.find(f => (f.diplomacy?.warExhaustion || 0) === maxExhaust);
    const isolated = kingdoms.filter(f => {
      const allies = f.allies.length + (world.treaties || []).filter(t => t.status === 'active' && t.type === 'alliance' && t.factions.includes(f.id)).length;
      return allies === 0 && !f.warState;
    });
    if (alliances.length) {
      html += `<div class="sum-section"><span class="sum-head">พันธมิตรหลัก</span><br>`;
      html += alliances.slice(-3).map(t => t.factions.map(id => getFaction(id)?.name).join(' ↔ ')).join('<br>');
      html += `</div>`;
    }
    if (vassals.length) {
      html += `<div class="sum-section"><span class="sum-head">เมืองขึ้น</span><br>`;
      html += vassals.map(v => `${getFaction(v.vassalFactionId)?.name} ภายใต้ ${getFaction(v.overlordFactionId)?.name}`).join('<br>');
      html += `</div>`;
    }
    if (exhaustedF && maxExhaust > 20) {
      html += `<div class="sum-section"><span class="sum-head">ความเหนื่อยล้าจากสงคราม</span><br>${exhaustedF.name} (${fmt(maxExhaust, 0)}%)</div>`;
    }
    if (isolated.length) {
      html += `<div class="sum-section"><span class="sum-head">ฝ่ายโดดเดี่ยว</span><br>${isolated.map(f => f.name).join(', ')}</div>`;
    }
    const lastTreaty = activeTreaties[activeTreaties.length - 1];
    if (lastTreaty) {
      html += `<div class="sum-section"><span class="sum-head">สนธิสัญญาล่าสุด</span><br>${lastTreaty.type}: ${lastTreaty.factions.map(id => getFaction(id)?.name).join(' ↔ ')} (Day ${lastTreaty.startDay})</div>`;
    }

    if (world.eras.length) {
      const era = world.eras[world.eras.length - 1];
      html += `<div class="sum-section"><span class="sum-head">ยุคสมัยล่าสุด</span><br>${era.text}</div>`;
    }
    el.innerHTML = html;
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
      this.wireInspectorLinks(body);
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
    } else if (sel.kind === 'route') {
      const r = world.routes.find(x => x.id === sel.id);
      if (!r) { this.selected = null; return; }
      const sa = getSettlement(r.a), sb = getSettlement(r.b);
      title.textContent = `🛤 เส้นทาง ${sa ? sa.name : '?'} ↔ ${sb ? sb.name : '?'}`;
      body.innerHTML = this.routeHTML(r, sa, sb);
    } else if (sel.kind === 'faction') {
      const fc = getFaction(sel.id);
      if (!fc) { this.selected = null; return; }
      title.textContent = `🚩 ${fc.name}`;
      body.innerHTML = this.factionHTML(fc);
    }
    this.wireInspectorLinks(body);
  },

  // ทำ links ใน inspector ให้คลิกได้
  wireInspectorLinks(body) {
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
    html += `<div class="insp-section"><h4>ฝ่าย (Factions) — คลิกดู timeline</h4>`;
    for (const f of world.factions) {
      const n = world.settlements.filter(s => s.factionId === f.id).length;
      if (n === 0 && !f.isBandit) continue;
      const ruler = getAgent(f.rulerId);
      html += this.kv(this.link('faction', f.id, `<span style="color:${f.color}">■</span> ${f.name}${f.warState ? ' ⚔' : ''}`),
        `${n} ถิ่นฐาน${ruler ? ' · ' + this.link('agent', ruler.id, ruler.name.split(' ')[0]) : ''}`);
    }
    html += `</div>`;
    // ตัวละครที่โด่งดังที่สุด
    const topFame = alive.filter(a => a.fame > 0).sort((a, b) => b.fame - a.fame).slice(0, 5);
    if (topFame.length) {
      html += `<div class="insp-section"><h4>บุคคลแห่งยุค</h4>`;
      for (const a of topFame) html += this.kv(this.link('agent', a.id, a.name), `⭐ ${fmt(a.fame)}${a.title ? ` "${a.title}"` : ''}`);
      html += `</div>`;
    }
    html += `<div class="insp-section"><h4>อาชีพ</h4>`;
    for (const [p, n] of Object.entries(profCount).sort((a, b) => b[1] - a[1])) html += this.kv(p, n);
    html += `</div>`;
    return html;
  },

  agentHTML(a) {
    const s = getSettlement(a.locationId);
    const f = getFaction(a.factionId);
    const u = a.unitId ? getUnit(a.unitId) : null;
    let html = '';
    if (a.title) html += `<div class="thought" style="border-color:#ffd54f">🏅 "${a.title}" ${a.notable ? '· ตัวละครสำคัญแห่งยุค' : ''}</div>`;
    html += `<div class="thought">💭 "${a.currentThought}"</div>`;
    html += `<div class="insp-section"><h4>ข้อมูลทั่วไป</h4>`;
    html += this.kv('อาชีพ', `<span style="color:${PROF_COLOR[a.profession] || '#fff'}">${a.profession}</span> (${a.rank})`);
    html += this.kv('อายุ', a.age);
    html += this.kv('ฝ่าย', f ? this.link('faction', f.id, f.name) : '—');
    html += this.kv('อยู่ที่', s ? this.link('settlement', s.id, s.name) : 'ระหว่างเดินทาง');
    html += this.kv('เป้าหมาย', a.currentGoal);
    if (u) html += this.kv('สังกัดหน่วย', this.link('unit', u.id, u.name));
    html += this.kv('ชื่อเสียง (rep)', fmt(a.reputation));
    html += this.kv('Fame', fmt(a.fame), a.fame >= 20 ? 'warn' : '');
    html += `</div>`;
    // ── Phase 10.5: Ambition ──
    html += `<div class="insp-section"><h4>Ambition & เป้าหมาย</h4>`;
    html += this.kv('แผน', a.ambitionPlan || '—');
    html += this.kv('เป้าหมายเงิน', a.savingGoal ? fmt(a.savingGoal) + ' ทอง' : '—');
    html += this.kv('ซื้อถัดไป', a.nextPurchase || '—');
    if (a.lastMigrationDay > 0) html += this.kv('ย้ายล่าสุด', `Day ${a.lastMigrationDay}`);
    if (a.wantedLevel > 0) html += this.kv('ค่าหัว', fmt(a.wantedLevel), 'bad');
    html += `</div>`;
    // ── Phase 10.5: Combat stats ──
    const ds = CombatSystem.deriveStats(a);
    html += `<div class="insp-section"><h4>Combat Stats</h4>`;
    for (const [k, v] of Object.entries(a.combatStats || {})) html += this.kv(k, fmt(v, 1));
    html += `<div class="sub-head">Derived</div>`;
    html += this.kv('attack', fmt(ds.attack, 1)) + this.kv('defense', fmt(ds.defense, 1));
    html += this.kv('armor', fmt(ds.armor, 1)) + this.kv('dodge', fmt(ds.dodge * 100, 0) + '%');
    html += this.kv('accuracy', fmt(ds.accuracy * 100, 0) + '%') + this.kv('initiative', fmt(ds.initiative, 1));
    html += this.kv('commandBonus', fmt(ds.commandBonus, 1));
    html += `</div>`;
    // ── Phase 10.5: Equipment ──
    html += `<div class="insp-section"><h4>Equipment</h4>`;
    syncLegacyInventory(a);
    for (const slot of ['mainHand', 'offHand', 'ranged', 'armor', 'mount', 'tool']) {
      const item = a.equipment[slot];
      html += this.kv(slot, item ? `${item.type} (${fmt(item.durability)}/${fmt(item.maxDurability)})` : '—');
    }
    html += `</div>`;
    html += `<div class="insp-section"><h4>เรื่องราวชีวิต</h4><div class="ce-desc" style="font-size:11.5px;line-height:1.5">${lifeSummary(a)}</div></div>`;
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
    if (a.memory.tradeProfit > 0) html += this.kv('กำไรค้าขายสะสม', fmt(a.memory.tradeProfit) + ' ทอง', 'good');
    html += `</div>`;
    // ── Phase 10: เส้นทางอาชีพ ──
    if (a.career.length > 1) {
      html += `<div class="insp-section"><h4>เส้นทางอาชีพ</h4>`;
      html += a.career.slice(-8).map(c =>
        `<div class="timeline-entry"><span class="tl-day">Day ${c.day}</span><span class="tl-text">${c.profession}</span></div>`).join('');
      html += `</div>`;
    }
    // ── Phase 10: วีรกรรม ──
    if (a.deeds.length) {
      html += `<div class="insp-section"><h4>วีรกรรม (Notable Deeds)</h4>`;
      html += a.deeds.slice(-8).reverse().map(d =>
        `<div class="timeline-entry"><span class="tl-day">Day ${d.day}</span><span class="tl-text">${d.text}</span></div>`).join('');
      html += `</div>`;
    }
    // เมืองที่เคยอยู่/ผ่าน
    if (a.memory.citiesVisited.length) {
      const names = a.memory.citiesVisited.map(id => (getSettlement(id) || {}).name).filter(x => x);
      if (names.length) html += `<div class="insp-section"><h4>ถิ่นฐานที่เคยผ่าน</h4><div class="ce-desc">${names.join(' · ')}</div></div>`;
    }
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
    html += this.kv('ก่อตั้งเมื่อ', s.foundedDay === 0 ? 'ยุคก่อตั้งโลก' : `Day ${s.foundedDay}`);
    html += this.kv('ฝ่าย', f ? this.link('faction', f.id, `<span style="color:${f.color}">■</span> ${f.name}`) : '—');
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
    html += this.kv('Crowding', fmt(s.crowding, 2), s.crowding > 1.1 ? 'bad' : '');
    html += this.kv('Housing', `${populationOf(s)}/${s.housingCapacity}`);
    html += this.kv('Food/capita', fmt(s.foodPerCapita, 1));
    html += this.kv('Exportable food', SettlementMetrics.exportableFood(s));
    html += this.kv('Food reserve', s.foodReserveTargetDays + ' วัน');
    html += this.kv('Max export', fmt(s.maxFoodExportRatio * 100) + '%');
    // ── Phase 10.6: town caravan status ──
    let caravanStatus = 'idle';
    let caravanCls = '';
    if (s.townCaravanId) {
      const tc = getAgent(s.townCaravanId);
      if (!tc || !tc.alive) { caravanStatus = 'stuck ⚠'; caravanCls = 'bad'; }
      else if (tc.travel && tc.cargo) { caravanStatus = `active → ${(getSettlement(tc.cargo.destId) || {}).name || '?'}`; caravanCls = 'good'; }
      else if (tc.cargo) { caravanStatus = 'loading'; caravanCls = 'warn'; }
      else { caravanStatus = 'stuck ⚠ (no cargo)'; caravanCls = 'bad'; }
    }
    if (s.emergencyCaravanId) {
      const ec = getAgent(s.emergencyCaravanId);
      caravanStatus += (caravanStatus !== 'idle' ? ' · ' : '') + `emergency ${ec && ec.travel ? 'en route' : 'pending'}`;
    }
    html += this.kv('Town Caravan', caravanStatus, caravanCls);
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
    // ── Phase 10: ประวัติเมือง ──
    html += `<div class="insp-section"><h4>สถิติประวัติศาสตร์</h4>`;
    html += this.kv('เคยถูกปล้น', s.timesRaided + ' ครั้ง', s.timesRaided > 2 ? 'bad' : '');
    html += this.kv('เคยถูกยึด', s.timesCaptured + ' ครั้ง', s.timesCaptured > 0 ? 'warn' : '');
    if (s.pastRulers.length) html += this.kv('ผู้ปกครองในอดีต', s.pastRulers.slice(-3).join(', '));
    html += `</div>`;
    if (s.history.length) {
      html += `<div class="insp-section"><h4>เหตุการณ์สำคัญของเมือง (Timeline)</h4>`;
      html += s.history.slice(-10).map(h => `<div class="timeline-entry"><span class="tl-text">${h}</span></div>`).join('');
      html += `</div>`;
    }
    return html;
  },

  /* ── Phase 10: Faction inspector ── */
  factionHTML(f) {
    const ruler = getAgent(f.rulerId);
    const settlements = world.settlements.filter(s => s.factionId === f.id);
    const members = world.agents.filter(a => a.alive && a.factionId === f.id);
    const soldiers = members.filter(a => MILITARY_PROFS.has(a.profession));
    const wars = world.wars.filter(w => w.attackerId === f.id || w.defenderId === f.id);
    let html = `<div class="insp-section"><h4>ข้อมูลฝ่าย</h4>`;
    html += this.kv('สถานะ', settlements.length ? (f.warState ? '⚔ อยู่ในสงคราม' : '🕊 สงบ') : '🏴 ล่มสลายแล้ว', f.warState ? 'bad' : '');
    html += this.kv('ก่อตั้งเมื่อ', f.foundedDay === 0 ? 'ยุคก่อตั้งโลก' : `Day ${f.foundedDay}`);
    html += this.kv('ผู้นำ', ruler && ruler.alive ? this.link('agent', ruler.id, ruler.name + (ruler.title ? ` "${ruler.title}"` : '')) : '— ไร้ผู้นำ —');
    html += this.kv('ถิ่นฐาน', settlements.length);
    html += this.kv('ประชากรในสังกัด', members.length);
    html += this.kv('กำลังทหาร', soldiers.length);
    html += this.kv('คลังกลาง', fmt(f.treasury) + ' ทอง');
    if (!f.isBandit && f.diplomacy) {
      html += this.kv('War Exhaustion', fmt(f.diplomacy.warExhaustion, 0) + '%', f.diplomacy.warExhaustion > 50 ? 'bad' : '');
      html += this.kv('Diplomatic Personality', f.diplomacy.diplomaticPersonality || 'balanced');
    }
    html += `</div>`;
    if (!f.isBandit && f.diplomacy) {
      const others = world.factions.filter(o => o.id !== f.id && !o.isBandit && world.settlements.some(s => s.factionId === o.id));
      if (others.length) {
        html += `<div class="insp-section"><h4>ความสัมพันธ์ (Phase 11)</h4>`;
        for (const o of others) {
          const r = getRelation(f, o);
          const state = areAtWar(f, o) ? '⚔ สงคราม' : areAllied(f, o) ? '🛡 พันธมิตร' : isVassalOf(f, o) ? '👑 เมืองขึ้น' : isVassalOf(o, f) ? '👑 เจ้าเหนือหัว' : '—';
          html += this.kv(this.link('faction', o.id, o.name), `score ${fmt(r.score)} · trust ${fmt(r.trust)} · ${state}`, r.score < -20 ? 'bad' : r.score > 20 ? 'good' : '');
        }
        html += `</div>`;
      }
      const treaties = (world.treaties || []).filter(t => t.status === 'active' && t.factions.includes(f.id));
      if (treaties.length) {
        html += `<div class="insp-section"><h4>สนธิสัญญา</h4>`;
        for (const t of treaties) {
          const otherId = t.factions.find(id => id !== f.id);
          const other = getFaction(otherId);
          html += this.kv(t.type, `${other ? other.name : '?'} (Day ${t.startDay}${t.endDay ? '–' + t.endDay : ''})`);
        }
        html += `</div>`;
      }
      const vassals = (world.vassalContracts || []).filter(v => v.active && v.overlordFactionId === f.id);
      const overlord = (world.vassalContracts || []).find(v => v.active && v.vassalFactionId === f.id);
      if (vassals.length || overlord) {
        html += `<div class="insp-section"><h4>เมืองขึ้น / เจ้าเหนือหัว</h4>`;
        if (overlord) html += this.kv('เจ้าเหนือหัว', getFaction(overlord.overlordFactionId)?.name || '?');
        for (const v of vassals) html += this.kv('เมืองขึ้น', getFaction(v.vassalFactionId)?.name || '?');
        html += `</div>`;
      }
      if (f.diplomacy.diplomaticMemory?.length) {
        html += `<div class="insp-section"><h4>ความทรงจำทางการทูต</h4>`;
        for (const m of f.diplomacy.diplomaticMemory.slice(-6).reverse()) {
          const on = getFaction(m.otherId);
          html += `<div class="timeline-entry"><span class="tl-day">Day ${m.day}</span><span class="tl-text">${on ? on.name : '?'}: ${m.text}</span></div>`;
        }
        html += `</div>`;
      }
    }
    if (settlements.length) {
      html += `<div class="insp-section"><h4>ดินแดน</h4>`;
      for (const s of settlements) html += this.kv(this.link('settlement', s.id, s.name), s.type);
      html += `</div>`;
    }
    if (wars.length) {
      html += `<div class="insp-section"><h4>สงคราม</h4>`;
      for (const w of wars.slice(-4).reverse()) {
        html += `<div class="timeline-entry"><span class="tl-day">Day ${w.startDay}${w.endDay ? '-' + w.endDay : '+'}</span><span class="tl-text">${w.name} ${w.endDay ? (w.winner === f.id ? '(ชนะ)' : w.winner ? '(แพ้)' : '(เสมอ)') : '(ดำเนินอยู่)'}</span></div>`;
      }
      html += `</div>`;
    }
    if (f.timeline.length) {
      html += `<div class="insp-section"><h4>Timeline ของฝ่าย</h4>`;
      html += f.timeline.slice(-12).reverse().map(t =>
        `<div class="timeline-entry"><span class="tl-day">Day ${t.day}</span><span class="tl-text">${t.text}</span></div>`).join('');
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
    if (u.objective.bounty) html += this.kv('ค่าหัวเป้าหมาย', fmt(u.objective.bounty) + ' ทอง', 'warn');
    html += this.kv('พลังรบ', fmt(MilitarySystem.unitPower(u)));
    html += this.kv('Combat Power', fmt(u.combatPower || 0));
    html += this.kv('ชนะล่าสุด', u.recentVictories || 0, (u.recentVictories || 0) >= 2 ? 'good' : '');
    html += `</div>`;
    // equipment composition
    const eqComp = {};
    for (const m of members) {
      syncLegacyInventory(m);
      for (const slot of ['mainHand', 'offHand', 'ranged', 'armor', 'mount']) {
        const t = m.equipment?.[slot]?.type;
        if (t) eqComp[t] = (eqComp[t] || 0) + 1;
      }
    }
    if (Object.keys(eqComp).length) {
      html += `<div class="insp-section"><h4>Equipment องค์ประกอบ</h4>`;
      for (const [t, n] of Object.entries(eqComp)) html += this.kv(t, n);
      html += `</div>`;
    }
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

  routeHTML(r, sa, sb) {
    let html = `<div class="insp-section"><h4>เส้นทาง</h4>`;
    html += this.kv('จาก', sa ? this.link('settlement', sa.id, sa.name) : '?');
    html += this.kv('ถึง', sb ? this.link('settlement', sb.id, sb.name) : '?');
    html += this.kv('ระยะทาง', fmt(r.distance, 0));
    html += this.kv('คุณภาพถนน', fmt(r.roadQuality, 2));
    html += `</div><div class="insp-section"><h4>ความปลอดภัย (Phase 10.5)</h4>`;
    html += this.kv('Threat', fmt((r.threat || r.danger) * 100, 0) + '%', (r.threat || r.danger) > 0.5 ? 'bad' : '') + this.bar((r.threat || r.danger) * 100, '#ef5350');
    html += this.kv('Danger (legacy)', fmt(r.danger * 100, 0) + '%');
    html += this.kv('Patrol Level', fmt(r.patrolLevel, 1));
    html += this.kv('Bounty', fmt(r.bounty) + ' ทอง', r.bounty > 20 ? 'warn' : '');
    html += this.kv('Recent Raids', fmt(r.recentRaids, 1));
    html += this.kv('Caravan Losses', r.caravanLosses || 0, (r.caravanLosses || 0) > 3 ? 'bad' : '');
    html += this.kv('Food Price Gap', fmt(r.priceGapFood || 0, 2));
    html += this.kv('Traffic', fmt(r.traffic, 1));
    if (r.patrolMissionId) {
      const pu = getUnit(r.patrolMissionId);
      html += this.kv('Patrol Mission', pu ? this.link('unit', pu.id, pu.name) : 'active');
    }
    const recovery = (r._peakThreat || r.threat || 0) - (r.threat || 0);
  html += `</div><div class="insp-section"><h4>Recovery (Phase 10.6)</h4>`;
    html += this.kv('Peak Threat', fmt((r._peakThreat || r.threat || 0) * 100, 0) + '%');
    html += this.kv('Threat Δ', recovery > 0.05 ? `↓ ${fmt(recovery * 100, 0)}%` : 'stable', recovery > 0.05 ? 'good' : '');
    html += this.kv('Recent Raids decay', fmt(Math.max(0, r.recentRaids), 1) + ' (decays daily)');
    html += this.kv('Lifetime Bounty', fmt(r.lifetimeBounty || 0) + ' ทอง', (r.lifetimeBounty || 0) > 15 ? 'good' : '');
    html += this.kv('Patrol recovery', r.patrolLevel > 1 ? `active (${fmt(r.patrolLevel, 1)})` : 'low', r.patrolLevel > 1 ? 'good' : '');
    html += `</div>`;
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
          DiplomacySystem.declareWar(f1, f2, 'พลังลึกลับปลุกปั่นความเกลียดชังระหว่างสองฝ่าย');
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
      },
      forcePeace: () => {
        const ks = world.factions.filter(f => !f.isBandit && world.settlements.some(s => s.factionId === f.id));
        if (ks.length >= 2) { DiplomacySystem.forcePeace(ks[0], ks[1]); EventSystem.add('politics', `🕊 [Sandbox] บังคับสงบศึก ${ks[0].name}–${ks[1].name}`); }
      },
      forceWar: () => {
        const ks = world.factions.filter(f => !f.isBandit && world.settlements.some(s => s.factionId === f.id));
        if (ks.length >= 2) { DiplomacySystem.forceWar(ks[0], ks[1]); EventSystem.add('war', `💥 [Sandbox] บังคับสงคราม ${ks[0].name}–${ks[1].name}`); }
      },
      improveRelations: () => {
        const ks = world.factions.filter(f => !f.isBandit && world.settlements.some(s => s.factionId === f.id));
        if (ks.length >= 2) { DiplomacySystem.improveRelations(ks[0], ks[1], 35); EventSystem.add('politics', `🤝 [Sandbox] ปรับปรุงความสัมพันธ์ ${ks[0].name}–${ks[1].name}`); }
      },
      damageRelations: () => {
        const ks = world.factions.filter(f => !f.isBandit && world.settlements.some(s => s.factionId === f.id));
        if (ks.length >= 2) { DiplomacySystem.damageRelations(ks[0], ks[1], 35); EventSystem.add('politics', `💢 [Sandbox] ทำลายความสัมพันธ์ ${ks[0].name}–${ks[1].name}`); }
      },
      createAlliance: () => {
        const ks = world.factions.filter(f => !f.isBandit && world.settlements.some(s => s.factionId === f.id));
        if (ks.length >= 2) { DiplomacySystem.forceAlliance(ks[0], ks[1]); EventSystem.add('politics', `🛡 [Sandbox] สร้างพันธมิตร ${ks[0].name}–${ks[1].name}`); }
      },
      breakTreaty: () => {
        const ks = world.factions.filter(f => !f.isBandit && world.settlements.some(s => s.factionId === f.id));
        if (ks.length >= 2) { DiplomacySystem.forceBreakTreaty(ks[0], ks[1]); }
      },
      makeVassal: () => {
        const ks = world.factions.filter(f => !f.isBandit && world.settlements.some(s => s.factionId === f.id));
        if (ks.length >= 2) {
          const sorted = ks.slice().sort((a, b) => DiplomacySystem.militaryPower(b) - DiplomacySystem.militaryPower(a));
          DiplomacySystem.forceVassal(sorted[1], sorted[0]);
          EventSystem.add('politics', `👑 [Sandbox] ${sorted[1].name} เป็นเมืองขึ้นของ${sorted[0].name}`);
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
        settlementHistory(s, `ก่อตั้งขึ้นด้วยพลังเหนือธรรมชาติ`);
        Chronicle.add({
          category: 'settlement', importance: 3,
          title: `✨ ${s.name} ถือกำเนิด`,
          description: `ถิ่นฐานใหม่ปรากฏขึ้นบนแผนที่ เชื่อมเส้นทางกับ${nearest.name}`,
          settlements: [s.id]
        });
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

/* ═══════════════════ 17.5 PHASE 13: SAVE / LOAD / EXPORT ═══════════════════ */

const SAVE_SCHEMA_VERSION = '13.1';
const SAVE_GAME_ID = 'living-kingdom-sandbox';
const SAVE_STORAGE_KEY = 'livingKingdomSandbox_save';
const AUTOSAVE_EVERY_DAYS = 50;

const SaveSystem = {
  lastSaveDay: null,
  lastSaveKind: null,
  _lastAutoDay: -1,

  init() {
    const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    bind('btnSavePanel', () => this.togglePanel());
    bind('btnSaveWorld', () => this.saveWorld(false));
    bind('btnLoadWorld', () => this.loadWorld());
    bind('btnContinueWorld', () => this.continueWorld());
    bind('btnExportSave', () => this.exportSaveJSON());
    bind('btnExportChronicle', () => this.exportChronicleMD());
    bind('btnCopySummary', () => this.copySummary());
    bind('btnContinueOverlay', () => this.continueWorld());
    bind('btnNewWorldOverlay', () => this.startNewWorldFromOverlay());
    const imp = document.getElementById('importSaveInput');
    if (imp) imp.addEventListener('change', e => this.handleImportFile(e));
    const close = document.getElementById('savePanelClose');
    if (close) close.addEventListener('click', () => document.getElementById('savePanel')?.classList.add('hidden'));
    this.refreshContinueUI();
    this.updateStatusUI();
  },

  togglePanel() {
    const p = document.getElementById('savePanel');
    if (!p) return;
    p.classList.toggle('hidden');
    document.getElementById('toolPanel')?.classList.add('hidden');
    document.getElementById('chroniclePanel')?.classList.add('hidden');
    document.getElementById('summaryModal')?.classList.add('hidden');
    this.refreshContinueUI();
    this.updateStatusUI();
  },

  hasSave() {
    try { return !!localStorage.getItem(SAVE_STORAGE_KEY); } catch { return false; }
  },

  getSaveMeta() {
    try {
      const raw = localStorage.getItem(SAVE_STORAGE_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      return p && p.gameId === SAVE_GAME_ID ? p : null;
    } catch { return null; }
  },

  buildSavePayload(kind) {
    return {
      schemaVersion: SAVE_SCHEMA_VERSION,
      gameId: SAVE_GAME_ID,
      createdAt: world._createdAt || new Date().toISOString(),
      savedAt: new Date().toISOString(),
      worldName: world.worldName || 'Living Kingdom',
      seed: world.seed || 0,
      day: world.day,
      nextId,
      saveKind: kind,
      uiPrefs: {
        speed: UI.speed,
        heatmapMode: UI.heatmapMode,
        paused: UI.paused
      },
      world: this.serializeWorld()
    };
  },

  serializeWorld() {
    const clone = JSON.parse(JSON.stringify(world, (k, v) => (typeof v === 'function' ? undefined : v)));
    delete clone._eraSnapshot;
    return clone;
  },

  saveToLocalStorage(kind, silent) {
    if (!world) return null;
    try {
      const payload = this.buildSavePayload(kind);
      localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(payload));
      this.lastSaveDay = world.day;
      this.lastSaveKind = kind;
      this.updateStatusUI();
      if (!silent) {
        EventSystem.add('system', kind === 'auto'
          ? `💾 Autosaved Day ${world.day}`
          : `💾 บันทึกโลก "${world.worldName}" Day ${world.day}`);
      }
      return payload;
    } catch (e) {
      alert('บันทึกไม่สำเร็จ: ' + e.message);
      return null;
    }
  },

  saveWorld(force) {
    if (!world) return;
    if (!force && this.hasSave()) {
      const meta = this.getSaveMeta();
      if (!confirm(`เขียนทับการบันทึกเดิม (Day ${meta?.day ?? '?'}) ด้วยโลกปัจจุบัน Day ${world.day}?`)) return;
    }
    this.saveToLocalStorage('manual');
  },

  loadWorld() {
    const meta = this.getSaveMeta();
    if (!meta) { alert('ไม่พบการบันทึกในเครื่อง'); return; }
    if (world && !confirm(`โหลดการบันทึก Day ${meta.day} แทนโลกปัจจุบัน Day ${world.day}?`)) return;
    try {
      this.loadFromPayload(meta);
      EventSystem.add('system', `📂 โหลดโลก "${world.worldName}" Day ${world.day} จากการบันทึกในเครื่อง`);
    } catch (e) {
      alert('โหลดไม่สำเร็จ: ' + e.message);
    }
  },

  continueWorld() {
    const meta = this.getSaveMeta();
    if (!meta) { alert('ไม่พบการบันทึก'); return; }
    try {
      this.loadFromPayload(meta);
      this.hideContinueOverlay();
      EventSystem.add('system', `▶ เล่นต่อโลก "${world.worldName}" Day ${world.day}`);
    } catch (e) {
      alert('โหลดไม่สำเร็จ: ' + e.message);
    }
  },

  loadFromPayload(payload) {
    if (!payload || payload.gameId !== SAVE_GAME_ID) throw new Error('ไฟล์ไม่ใช่ save ของ Living Kingdom Sandbox');
    const migrated = this.migrate(payload);
    nextId = Math.max(1, migrated.nextId || 1);
    world = migrated.world;
    world._createdAt = migrated.createdAt || world._createdAt || new Date().toISOString();
    world.worldName = migrated.worldName || world.worldName || 'Living Kingdom';
    world.seed = migrated.seed != null ? migrated.seed : (world.seed || 0);
    this.applyPostLoad();
    if (migrated.uiPrefs) this.applyUiPrefs(migrated.uiPrefs);
    this.lastSaveDay = world.day;
    this.lastSaveKind = 'loaded';
    UI.selected = null;
    UI.logDirty = true;
    UI.inspectorDirty = true;
    UI.chronicleDirty = true;
    this.updateStatusUI();
    this.refreshContinueUI();
  },

  migrate(payload) {
    const data = JSON.parse(JSON.stringify(payload));
    if (!data.world || typeof data.world !== 'object') throw new Error('save ไม่มีข้อมูล world');
    const w = data.world;
    w.day = w.day || 0;
    w.settlements = w.settlements || [];
    w.routes = w.routes || [];
    w.agents = w.agents || [];
    w.units = w.units || [];
    w.armies = w.armies || [];
    w.factions = w.factions || [];
    w.events = w.events || [];
    w.chronicle = w.chronicle || [];
    w.wars = w.wars || [];
    w.eras = w.eras || [];
    w.treaties = w.treaties || [];
    w.vassalContracts = w.vassalContracts || [];
    w.stats = Object.assign({
      deaths: 0, battles: 0, raids: 0, caravansRobbed: 0, squadsFormed: 0, gearBought: 0,
      bountiesPosted: 0, traderSpawns: 0, townCaravans: 0, townCaravansLost: 0,
      townCaravansReplaced: 0, localRations: 0, emergencyCaravans: 0, emergencyFallbacks: 0
    }, w.stats || {});
    if (!w.worldName) w.worldName = data.worldName || 'Living Kingdom';
    if (w.seed == null) w.seed = data.seed || 0;
    if (!w._createdAt) w._createdAt = data.createdAt || new Date().toISOString();
    for (const s of w.settlements) this.migrateSettlement(s);
    for (const r of w.routes) this.migrateRoute(r);
    for (const a of w.agents) this.migrateAgent(a);
    for (const u of w.units) this.migrateUnit(u);
    for (const ar of w.armies) this.migrateArmy(ar);
    for (const f of w.factions) this.migrateFaction(f);
    data.schemaVersion = SAVE_SCHEMA_VERSION;
    data.world = w;
    return data;
  },

  migrateSettlement(s) {
    s.stock = Object.assign(newStock(), s.stock || {});
    s.demand = Object.assign(newStock(), s.demand || {});
    s.prices = Object.assign({}, BASE_PRICE, s.prices || {});
    s.buildings = s.buildings || [];
    s.history = s.history || [];
    s.housingCapacity = s.housingCapacity != null ? s.housingCapacity : 15;
    s.jobSlots = s.jobSlots != null ? s.jobSlots : 12;
    s.foodReserveTargetDays = s.foodReserveTargetDays != null ? s.foodReserveTargetDays : 4;
    s.maxFoodExportRatio = s.maxFoodExportRatio != null ? s.maxFoodExportRatio : 0.5;
    if (s.townCaravanId == null) s.townCaravanId = null;
    if (s.emergencyCaravanId == null) s.emergencyCaravanId = null;
    s.caravanSubsidy = s.caravanSubsidy || 0;
    s.crowding = s.crowding || 0;
    s.foodPerCapita = s.foodPerCapita || 0;
    s.recentInbound = s.recentInbound || 0;
    s.prodPotential = s.prodPotential || { food: 0, wood: 0, ore: 0 };
  },

  migrateRoute(r) {
    r.threat = r.threat != null ? r.threat : (r.danger || 0);
    r.recentRaids = r.recentRaids || 0;
    r.caravanLosses = r.caravanLosses || 0;
    r.bounty = r.bounty || 0;
    r.lifetimeBounty = r.lifetimeBounty || 0;
    r.patrolLevel = r.patrolLevel || 0;
    r.priceGapFood = r.priceGapFood || 0;
    r._peakThreat = r._peakThreat || r.threat || 0;
    if (r.patrolMissionId == null) r.patrolMissionId = null;
    r.destroyed = !!r.destroyed;
  },

  migrateAgent(a) {
    a.stats = Object.assign({ hunger: 70, energy: 80, health: 100, morale: 60, wealth: 0 }, a.stats || {});
    a.inventory = Object.assign({ food: 0, wood: 0, ore: 0, tools: 0, weapon: 0, bow: 0, horse: 0, cart: 0 }, a.inventory || {});
    a.durability = a.durability || { tools: 0, weapon: 0, cart: 0 };
    a.equipment = a.equipment || emptyEquipment();
    a.combatStats = Object.assign({
      strength: 6, agility: 6, endurance: 6, perception: 6,
      intelligence: 6, charisma: 6, discipline: 6, courage: 6
    }, a.combatStats || {});
    a.skills = Object.assign(DEFAULT_SKILLS(), a.skills || {});
    a.traits = Object.assign({ bravery: 0.5, greed: 0.5, loyalty: 0.5, ambition: 0.5, riskTolerance: 0.5, discipline: 0.5 }, a.traits || {});
    a.memory = Object.assign({ battlesWon: 0, battlesLost: 0, survivedBattles: 0, citiesVisited: [], daysHungry: 0, raidsDone: 0, tradeProfit: 0 }, a.memory || {});
    a.deeds = a.deeds || [];
    a.career = a.career || [{ day: 0, profession: a.profession || 'unemployed' }];
    a.fame = a.fame || 0;
    a.legacyScore = a.legacyScore || 0;
    a.ambitionPlan = a.ambitionPlan || 'survive';
    a.savingGoal = a.savingGoal || 0;
    a.lastMigrationDay = a.lastMigrationDay != null ? a.lastMigrationDay : -99;
    a.isTownCaravan = !!a.isTownCaravan;
    a.isEmergencyCaravan = !!a.isEmergencyCaravan;
    a.wantedLevel = a.wantedLevel || 0;
    a.derivedStats = null;
    if (a._jitterA == null) { a._jitterA = Math.random() * Math.PI * 2; a._jitterR = rand(0.3, 1); }
    a.currentGoal = a.currentGoal || 'ตั้งตัว';
    a.currentThought = a.currentThought || '...';
  },

  migrateUnit(u) {
    u.memberIds = u.memberIds || [];
    u.objective = u.objective || { type: 'idle' };
    u.supply = Object.assign({ food: 20, arrows: 20, weapons: 5 }, u.supply || {});
    u.battleHistory = u.battleHistory || [];
    u.recentVictories = u.recentVictories || 0;
    u.equipmentPower = u.equipmentPower || 0;
    u.combatPower = u.combatPower || 0;
  },

  migrateArmy(ar) {
    ar.unitIds = ar.unitIds || [];
    ar.objective = ar.objective || { type: 'idle' };
    ar.supply = Object.assign({ food: 200, arrows: 100, weapons: 30, horses: 5 }, ar.supply || {});
  },

  migrateFaction(f) {
    f.enemies = f.enemies || [];
    f.allies = f.allies || [];
    f.vassalIds = f.vassalIds || [];
    f.timeline = f.timeline || [];
    f.warState = !!f.warState;
    f.isBandit = !!f.isBandit;
    ensureFactionDiplomacy(f);
  },

  applyPostLoad() {
    for (const a of world.agents) syncLegacyInventory(a);
    for (const s of world.settlements) {
      if (s.type !== 'camp') LogisticsSystem.validateCaravanSlots(s);
    }
    for (const u of world.units) {
      for (const id of u.memberIds) {
        const m = getAgent(id);
        if (m) m.unitId = u.id;
      }
    }
    for (const ar of world.armies) {
      for (const uid of ar.unitIds) {
        const u = getUnit(uid);
        if (u) u.armyId = ar.id;
      }
    }
    DiplomacySystem.syncFromLegacy();
  },

  applyUiPrefs(prefs) {
    if (prefs.speed) {
      UI.speed = prefs.speed;
      document.querySelectorAll('.speed-btn').forEach(b => {
        b.classList.toggle('active', +b.dataset.speed === UI.speed);
      });
    }
    if (prefs.heatmapMode != null) {
      UI.heatmapMode = prefs.heatmapMode;
      const sel = document.getElementById('heatmapSelect');
      if (sel) sel.value = prefs.heatmapMode;
    }
    if (prefs.paused != null) {
      UI.paused = prefs.paused;
      const bp = document.getElementById('btnPause');
      if (bp) bp.textContent = UI.paused ? '▶ Resume' : '⏸ Pause';
    }
  },

  tickAutoSave() {
    if (!world || world.day <= 0) return;
    if (world.day % AUTOSAVE_EVERY_DAYS !== 0) return;
    if (this._lastAutoDay === world.day) return;
    this._lastAutoDay = world.day;
    this.saveToLocalStorage('auto', true);
    EventSystem.add('system', `💾 Autosaved Day ${world.day}`);
    this.updateStatusUI();
  },

  refreshContinueUI() {
    const meta = this.getSaveMeta();
    const btn = document.getElementById('btnContinueWorld');
    if (btn) {
      btn.classList.toggle('hidden', !meta);
      if (meta) btn.title = `โหลด Day ${meta.day}`;
    }
    const overlay = document.getElementById('continueOverlay');
    if (overlay && overlay.classList && !overlay.classList.contains('hidden') && meta) {
      const txt = document.getElementById('continueOverlayText');
      if (txt) txt.textContent = `พบการบันทึก "${meta.worldName}" — Day ${meta.day}`;
    }
  },

  showContinueOverlay() {
    const meta = this.getSaveMeta();
    if (!meta) return false;
    const ov = document.getElementById('continueOverlay');
    const txt = document.getElementById('continueOverlayText');
    if (ov) ov.classList.remove('hidden');
    if (txt) txt.textContent = `พบการบันทึก "${meta.worldName}" — Day ${meta.day}`;
    return true;
  },

  hideContinueOverlay() {
    document.getElementById('continueOverlay')?.classList.add('hidden');
  },

  startNewWorldFromOverlay() {
    if (!confirm('สร้างโลกใหม่และเล่นต่อจาก Day 0? (การบันทึกเดิมยังอยู่ในเครื่อง)')) return;
    this.hideContinueOverlay();
    generateWorld();
    UI.selected = null;
    UI.logDirty = true;
    this.lastSaveKind = null;
    this.updateStatusUI();
  },

  updateStatusUI() {
    const el = document.getElementById('saveStatus');
    if (!el) return;
    if (!world) { el.textContent = 'No save loaded'; el.className = 'save-status'; return; }
    let text = 'No save';
    let cls = 'save-status';
    if (this.lastSaveKind === 'loaded') {
      text = `Loaded Day ${world.day}`;
      cls += ' loaded';
    } else if (this.lastSaveKind === 'auto' && this.lastSaveDay === world.day) {
      text = `Autosaved Day ${world.day}`;
      cls += ' auto';
    } else if (this.lastSaveKind === 'manual' && this.lastSaveDay === world.day) {
      text = `Saved Day ${world.day}`;
      cls += ' saved';
    } else if (this.hasSave()) {
      const meta = this.getSaveMeta();
      text = meta ? `Saved Day ${meta.day} (disk)` : 'No save';
    }
    el.textContent = text;
    el.className = cls;
  },

  downloadText(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  exportSaveJSON() {
    if (!world) return;
    const payload = this.buildSavePayload('export');
    const fname = `living-kingdom-day-${world.day}.json`;
    this.downloadText(fname, JSON.stringify(payload, null, 2), 'application/json');
    EventSystem.add('system', `📤 Export save ${fname}`);
  },

  handleImportFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        if (world && !confirm(`นำเข้า save Day ${payload.day ?? '?'} แทนโลกปัจจุบัน?`)) return;
        this.loadFromPayload(payload);
        try { localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(this.buildSavePayload('import'))); } catch {}
        EventSystem.add('system', `📥 นำเข้าโลก "${world.worldName}" Day ${world.day}`);
      } catch (err) {
        alert('นำเข้าไม่สำเร็จ: ' + err.message);
      }
    };
    reader.readAsText(file);
  },

  buildChronicleMarkdown() {
    if (!world) return '';
    const lines = [];
    lines.push(`# ตำนานแห่ง ${world.worldName}`);
    lines.push('');
    lines.push(`- วันปัจจุบัน: **Day ${world.day}**`);
    lines.push(`- Seed: ${world.seed}`);
    lines.push(`- สร้างเมื่อ: ${world._createdAt || '—'}`);
    lines.push(`- ส่งออกเมื่อ: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('## สรุปโลก');
    lines.push('');
    lines.push(this.buildSummaryText());
    lines.push('');
    lines.push('## ตัวละครสำคัญ');
    lines.push('');
    const heroes = world.agents.filter(a => a.notable || a.fame >= 15).sort((a, b) => (b.fame || 0) - (a.fame || 0)).slice(0, 12);
    if (heroes.length) {
      for (const a of heroes) {
        lines.push(`### ${a.name}${a.title ? ` "${a.title}"` : ''} (fame ${fmt(a.fame)})`);
        lines.push(lifeSummary(a));
        lines.push('');
      }
    } else lines.push('_ยังไม่มีตัวละครที่โดดเด่นมากนัก_');
    lines.push('## Timeline ฝ่าย');
    lines.push('');
    for (const f of world.factions) {
      if (!f.timeline.length) continue;
      lines.push(`### ${f.name}`);
      for (const t of f.timeline.slice(-15)) lines.push(`- Day ${t.day}: ${t.text}`);
      lines.push('');
    }
    lines.push('## ประวัติเมือง');
    lines.push('');
    for (const s of world.settlements.filter(x => x.type !== 'camp')) {
      if (!s.history.length) continue;
      lines.push(`### ${s.name} (${s.type})`);
      for (const h of s.history.slice(-8)) lines.push(`- ${h}`);
      lines.push('');
    }
    lines.push('## สงคราม');
    lines.push('');
    for (const w of world.wars) {
      lines.push(`### ${w.name} (Day ${w.startDay}${w.endDay ? '–' + w.endDay : '+'})`);
      if (w.summary) lines.push(w.summary);
      else lines.push(w.cause || '—');
      lines.push('');
    }
    lines.push('## การทูตและสนธิสัญญา');
    lines.push('');
    for (const t of (world.treaties || []).slice().sort((a, b) => a.startDay - b.startDay)) {
      const names = t.factions.map(id => getFaction(id)?.name || '?').join(' ↔ ');
      lines.push(`- Day ${t.startDay}: ${t.type} (${t.status}) — ${names}`);
    }
    const dipChron = world.chronicle.filter(c => c.category === 'diplomacy');
    for (const c of dipChron) lines.push(`- Day ${c.day}: ${c.title}`);
    lines.push('');
    lines.push('## Chronicle (เรียงตามวัน)');
    lines.push('');
    const sorted = world.chronicle.slice().sort((a, b) => a.day - b.day || a.id - b.id);
    for (const c of sorted) {
      lines.push(`### Day ${c.day} — ${c.title}`);
      if (c.description) lines.push(c.description);
      lines.push('');
    }
    return lines.join('\n');
  },

  exportChronicleMD() {
    if (!world) return;
    const md = this.buildChronicleMarkdown();
    this.downloadText(`living-kingdom-chronicle-day-${world.day}.md`, md, 'text/markdown;charset=utf-8');
    EventSystem.add('system', `📜 Export Chronicle Day ${world.day}`);
  },

  buildSummaryText() {
    if (!world) return '';
    const alive = world.agents.filter(a => a.alive);
    const mkts = marketSettlements();
    const liveFactions = world.factions.filter(fc => world.settlements.some(s => s.factionId === fc.id));
    const strongest = liveFactions.reduce((m, fc) => {
      const power = world.settlements.filter(s => s.factionId === fc.id).length * 100
        + alive.filter(a => a.factionId === fc.id && MILITARY_PROFS.has(a.profession)).length * 10
        + fc.treasury * 0.1;
      return power > m.power ? { f: fc, power } : m;
    }, { f: null, power: -1 }).f;
    const richest = mkts.reduce((m, s) => s.treasury > m.treasury ? s : m, mkts[0]);
    const famous = alive.filter(a => a.fame > 0).sort((a, b) => b.fame - a.fame)[0];
    const activeWars = world.wars.filter(w => !w.endDay);
    let txt = `สรุปโลก "${world.worldName}" ณ Day ${world.day}\n`;
    txt += `ประชากร ${alive.length} ชีวิต | ${world.settlements.length} ถิ่นฐาน | ${liveFactions.length} ฝ่าย\n`;
    txt += `ศึก ${world.stats.battles} | ปล้น ${world.stats.raids + world.stats.caravansRobbed} | ตาย ${world.stats.deaths}\n`;
    if (strongest) {
      const ruler = getAgent(strongest.rulerId);
      txt += `มหาอำนาจ: ${strongest.name}${ruler ? ` (${ruler.name})` : ''}\n`;
    }
    if (richest) txt += `เมืองมั่งคั่ง: ${richest.name} (${fmt(richest.treasury)} ทอง)\n`;
    if (famous) txt += `บุคคลแห่งยุค: ${famous.name} (fame ${fmt(famous.fame)}) — ${lifeSummary(famous)}\n`;
    if (activeWars.length) txt += `สงครามดำเนินอยู่: ${activeWars.map(w => w.name).join(', ')}\n`;
    const treaties = (world.treaties || []).filter(t => t.status === 'active');
    if (treaties.length) txt += `สนธิสัญญา: ${treaties.map(t => t.type).join(', ')}\n`;
    const vassals = (world.vassalContracts || []).filter(v => v.active);
    if (vassals.length) txt += `เมืองขึ้น: ${vassals.map(v => `${getFaction(v.vassalFactionId)?.name}→${getFaction(v.overlordFactionId)?.name}`).join(', ')}\n`;
    if (world.eras.length) txt += `ยุคล่าสุด: ${world.eras[world.eras.length - 1].text}\n`;
    return txt.trim();
  },

  copySummary() {
    if (!world) return;
    const text = this.buildSummaryText();
    const showFallback = () => {
      const box = document.getElementById('copySummaryFallback');
      const ta = document.getElementById('copySummaryText');
      if (box && ta) { ta.value = text; box.classList.remove('hidden'); ta.select(); }
      else alert(text);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        EventSystem.add('system', '📋 คัดลอกสรุปโลกไป clipboard แล้ว');
      }).catch(showFallback);
    } else showFallback();
  },

  validateCaravanSlots() {
    const bad = [];
    if (!world) return bad;
    for (const s of world.settlements) {
      if (s.townCaravanId) {
        const ag = getAgent(s.townCaravanId);
        if (!ag || !ag.alive || !ag.isTownCaravan || (!ag.cargo && !ag.travel)) bad.push(s.townCaravanId);
      }
    }
    return bad;
  }
};

function buildWorldSummaryText() { return SaveSystem.buildSummaryText(); }

/* ═══════════════════ 18. INIT ═══════════════════ */

function bootGame() {
  Renderer.init();
  UI.init();
  SaveSystem.init();
  if (SaveSystem.hasSave()) {
    SaveSystem.showContinueOverlay();
  } else {
    generateWorld();
    SaveSystem.updateStatusUI();
  }
  requestAnimationFrame(t => UI.loop(t));
}

bootGame();
