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

function defaultMarketRole() {
  return {
    isMarketHub: false, hubLevel: 0, tradeInfluence: 0,
    connectedRoutes: [], storageBonus: 0, priceStability: 0, guildPresence: 0
  };
}

function defaultMarketIndex() {
  return {
    foodIndex: 1, woodIndex: 1, oreIndex: 1, toolsIndex: 1, weaponsIndex: 1,
    volatility: 0, tradeHealth: 50, totalTradeVolume: 0, caravanSurvivalRate: 1,
    lastUpdateDay: 0
  };
}

const MERCHANT_RANKS = ['peddler', 'caravan_trader', 'master_merchant', 'guild_member', 'guild_elder', 'trade_prince'];
const MERCHANT_RANK_TITLES = {
  peddler: 'พ่อค้าเร่', caravan_trader: 'เจ้าคาราวาน', master_merchant: 'นายคลังสินค้า',
  guild_member: 'สมาชิกสมาคมพ่อค้า', guild_elder: 'เจ้าสมาคมพ่อค้า', trade_prince: 'เจ้าชายการค้า'
};

function getGuild(id) { return (world.guilds || []).find(g => g.id === id); }
function getWarehouse(id) { return (world.warehouses || []).find(w => w.id === id); }
function getContract(id) { return (world.tradeContracts || []).find(c => c.id === id); }

/* ── Phase 18.3: Organizations / Warbands ── */
const ORG_TYPES = ['adventurer_party', 'mercenary_company', 'militia_company', 'royal_army', 'merchant_guild', 'caravan_company', 'bandit_gang', 'rebel_cell', 'noble_retinue', 'town_guard', 'bounty_hunter_lodge'];
const WARBAND_TYPES = ['adventurer_party', 'mercenary_company', 'militia', 'royal_army', 'bandit_gang', 'caravan_guard', 'rebel_warband', 'noble_retinue', 'scout_party'];
const OFFER_TYPES = ['open_join', 'paid_contract', 'militia_call', 'royal_conscription', 'mercenary_hire', 'caravan_guard_job', 'bounty_party', 'rebel_recruitment', 'bandit_invitation', 'noble_call_to_arms'];
const MAX_AGENT_MEMBERSHIPS = 3;
const MAX_ACTIVE_OFFERS_PER_SETTLEMENT = 4;
const ORG_HISTORY_CAP = 24;
const WARBAND_HISTORY_CAP = 20;

function getOrganization(id) { return (world.organizations || []).find(o => o.id === id); }
function getWarband(id) { return (world.warbands || []).find(w => w.id === id); }
function getMusterPoint(id) { return (world.musterPoints || []).find(m => m.id === id); }
function getHeadquarters(id) { return (world.headquarters || []).find(h => h.id === id); }
function getRecruitmentOffer(id) { return (world.recruitmentOffers || []).find(o => o.id === id); }

function defaultOrgRanks() {
  return { leader: 100, officer: 70, veteran: 50, member: 30, recruit: 10 };
}

function defaultOrgMembership(organizationId, role, rank, day, opt) {
  opt = opt || {};
  return {
    organizationId, role: role || 'member', rank: rank || 'recruit',
    joinedDay: day || (world ? world.day : 0),
    status: opt.status || 'active',
    loyalty: opt.loyalty != null ? opt.loyalty : 55,
    trust: opt.trust != null ? opt.trust : 50,
    contribution: opt.contribution || 0,
    payShare: opt.payShare || 0,
    foodShare: opt.foodShare || 0,
    reputationInGroup: opt.reputationInGroup || 0,
    reasonJoined: opt.reasonJoined || 'opportunity',
    contractUntilDay: opt.contractUntilDay || null,
    lastPaidDay: opt.lastPaidDay || null,
    lastFedDay: opt.lastFedDay || null
  };
}

function defaultOrganization(opt) {
  opt = opt || {};
  return {
    id: opt.id || uid(),
    name: opt.name || 'กลุ่มไม่มีชื่อ',
    type: opt.type || 'adventurer_party',
    founderId: opt.founderId || null,
    leaderId: opt.leaderId || null,
    factionId: opt.factionId || null,
    homeSettlementId: opt.homeSettlementId || null,
    headquartersId: opt.headquartersId || null,
    createdDay: opt.createdDay != null ? opt.createdDay : (world ? world.day : 0),
    status: opt.status || 'active',
    reputation: opt.reputation != null ? opt.reputation : 40,
    wealth: opt.wealth != null ? opt.wealth : 0,
    foodReserve: opt.foodReserve != null ? opt.foodReserve : 0,
    equipmentReserve: opt.equipmentReserve != null ? opt.equipmentReserve : 0,
    influence: opt.influence != null ? opt.influence : 0,
    purpose: opt.purpose || 'survive',
    recruitmentPolicy: opt.recruitmentPolicy || { open: true, minSkill: 0, payRate: 1, riskTolerance: 0.5 },
    memberIds: (opt.memberIds || []).slice(),
    ranks: opt.ranks || defaultOrgRanks(),
    roles: opt.roles || {},
    activeWarbandIds: (opt.activeWarbandIds || []).slice(),
    activeContractIds: (opt.activeContractIds || []).slice(),
    history: (opt.history || []).slice(0, ORG_HISTORY_CAP),
    relations: opt.relations || {},
    requirements: opt.requirements || {},
    benefits: opt.benefits || {},
    rules: opt.rules || {},
    _legacyGuildId: opt._legacyGuildId || null,
    sovereignty: opt.sovereignty || null,
    vassals: (opt.vassals || []).slice(),
    _crownFactionId: opt._crownFactionId || null,
    _outlawRealm: opt._outlawRealm || false
  };
}

function createOrganization(opt) {
  if (!world.organizations) world.organizations = [];
  const o = defaultOrganization(opt);
  world.organizations.push(o);
  return o;
}

function defaultWarband(opt) {
  opt = opt || {};
  return {
    id: opt.id || uid(),
    organizationId: opt.organizationId || null,
    factionId: opt.factionId || null,
    leaderId: opt.leaderId || null,
    memberIds: (opt.memberIds || []).slice(),
    unitIds: (opt.unitIds || []).slice(),
    name: opt.name || 'กองเล็ก',
    type: opt.type || 'adventurer_party',
    size: 0,
    composition: opt.composition || defaultUnitComposition(),
    locationId: opt.locationId || null,
    currentRouteId: opt.currentRouteId != null ? opt.currentRouteId : null,
    routePath: (opt.routePath || []).slice(),
    progress: opt.progress != null ? opt.progress : 0,
    destinationId: opt.destinationId || null,
    objective: opt.objective || { type: 'idle' },
    speed: opt.speed != null ? opt.speed : 1,
    visibility: opt.visibility != null ? opt.visibility : 0.6,
    stealth: opt.stealth != null ? opt.stealth : 0.2,
    morale: opt.morale != null ? opt.morale : 65,
    cohesion: opt.cohesion != null ? opt.cohesion : 70,
    fatigue: opt.fatigue != null ? opt.fatigue : 0,
    food: opt.food != null ? opt.food : 10,
    gold: opt.gold != null ? opt.gold : 0,
    supplyDays: opt.supplyDays != null ? opt.supplyDays : 0,
    woundedCount: opt.woundedCount || 0,
    prisonerCount: opt.prisonerCount || 0,
    threat: opt.threat != null ? opt.threat : 0.3,
    status: opt.status || 'mustering',
    lastKnownLocation: opt.lastKnownLocation || opt.locationId || null,
    lastSeenDay: opt.lastSeenDay != null ? opt.lastSeenDay : (world ? world.day : 0),
    intelConfidence: opt.intelConfidence != null ? opt.intelConfidence : 1,
    history: (opt.history || []).slice(0, WARBAND_HISTORY_CAP),
    travel: null,
    pursueTargetId: opt.pursueTargetId || null,
    _campDays: opt._campDays || 0,
    foundingReason: opt.foundingReason || null,
    politicalMode: opt.politicalMode || (opt.organizationId ? 'guild_backed' : 'independent'),
    siegeAuthorityId: opt.siegeAuthorityId || null
  };
}

function createWarband(opt) {
  if (!world.warbands) world.warbands = [];
  const wb = defaultWarband(opt);
  wb.size = warbandMembers(wb).length;
  world.warbands.push(wb);
  const org = wb.organizationId ? getOrganization(wb.organizationId) : null;
  if (org && !org.activeWarbandIds.includes(wb.id)) org.activeWarbandIds.push(wb.id);
  return wb;
}

function warbandMembers(wb) {
  if (!wb || !wb.memberIds) return [];
  return wb.memberIds.map(getAgent).filter(a => a && a.alive);
}

function agentActiveMemberships(a) {
  if (!a || !a.memberships) return [];
  return a.memberships.filter(m => ['active', 'probation', 'traveling_to_muster', 'wounded'].includes(m.status));
}

function agentMilitaryMembership(a) {
  const militaryTypes = new Set(['mercenary_company', 'militia_company', 'royal_army', 'bandit_gang', 'rebel_cell', 'town_guard', 'noble_retinue', 'bounty_hunter_lodge']);
  return agentActiveMemberships(a).find(m => {
    const org = getOrganization(m.organizationId);
    return org && militaryTypes.has(org.type);
  });
}

function defaultHeadquarters(opt) {
  opt = opt || {};
  return {
    id: opt.id || uid(),
    organizationId: opt.organizationId,
    settlementId: opt.settlementId,
    type: opt.type || 'camp',
    storage: Object.assign({ food: 0, gold: 0, weapons: 0 }, opt.storage || {}),
    beds: opt.beds != null ? opt.beds : 10,
    trainingLevel: opt.trainingLevel != null ? opt.trainingLevel : 0,
    recruitmentBonus: opt.recruitmentBonus != null ? opt.recruitmentBonus : 0,
    security: opt.security != null ? opt.security : 40,
    upkeepCost: opt.upkeepCost != null ? opt.upkeepCost : 2
  };
}

function createHeadquarters(opt) {
  if (!world.headquarters) world.headquarters = [];
  const hq = defaultHeadquarters(opt);
  world.headquarters.push(hq);
  const org = getOrganization(hq.organizationId);
  if (org) org.headquartersId = hq.id;
  return hq;
}

function defaultRecruitmentOffer(opt) {
  opt = opt || {};
  return {
    id: opt.id || uid(),
    organizationId: opt.organizationId,
    issuerId: opt.issuerId || null,
    settlementId: opt.settlementId,
    musterPointId: opt.musterPointId || null,
    type: opt.type || 'open_join',
    roleNeeded: opt.roleNeeded || 'soldier',
    quantityNeeded: opt.quantityNeeded != null ? opt.quantityNeeded : 5,
    requirements: opt.requirements || {},
    rewards: opt.rewards || { pay: 10, food: 5 },
    riskLevel: opt.riskLevel != null ? opt.riskLevel : 0.4,
    duration: opt.duration != null ? opt.duration : 14,
    postedDay: opt.postedDay != null ? opt.postedDay : (world ? world.day : 0),
    expiresDay: opt.expiresDay != null ? opt.expiresDay : ((world ? world.day : 0) + (opt.duration || 14)),
    status: opt.status || 'open',
    applicants: (opt.applicants || []).slice(),
    acceptedAgentIds: (opt.acceptedAgentIds || []).slice()
  };
}

function createRecruitmentOffer(opt) {
  if (!world.recruitmentOffers) world.recruitmentOffers = [];
  const offer = defaultRecruitmentOffer(opt);
  world.recruitmentOffers.push(offer);
  return offer;
}

function defaultMusterPoint(opt) {
  opt = opt || {};
  return {
    id: opt.id || uid(),
    organizationId: opt.organizationId,
    settlementId: opt.settlementId,
    locationId: opt.locationId || opt.settlementId,
    targetDay: opt.targetDay != null ? opt.targetDay : ((world ? world.day : 0) + 7),
    expectedAgentIds: (opt.expectedAgentIds || []).slice(),
    arrivedAgentIds: (opt.arrivedAgentIds || []).slice(),
    missingAgentIds: (opt.missingAgentIds || []).slice(),
    foodRequired: opt.foodRequired != null ? opt.foodRequired : 20,
    equipmentRequired: opt.equipmentRequired != null ? opt.equipmentRequired : 5,
    status: opt.status || 'pending'
  };
}

function createMusterPoint(opt) {
  if (!world.musterPoints) world.musterPoints = [];
  const mp = defaultMusterPoint(opt);
  world.musterPoints.push(mp);
  return mp;
}

/* ── Phase 17: Agent memory / relationships / motives ── */
const MAX_AGENT_RELATIONS = 20;
const MAX_MAJOR_EVENTS = 40;
const MAX_SENTIMENT_ENTRIES = 12;
const MAX_SCOUT_REPORTS = 80;
const WAR_GOAL_TYPES = ['capture_settlement', 'defend_border', 'cut_trade_route', 'break_vassal', 'punish_rebels', 'secure_market_hub', 'destroy_bandit_camp', 'force_tribute'];
const TERRAIN_TYPES = ['plain', 'forest', 'hill', 'river', 'road', 'marsh'];

function defaultPersonalMemory(birthplaceId, bornDay) {
  return {
    bornDay: bornDay != null ? bornDay : (world ? world.day : 0),
    birthplaceId: birthplaceId || null,
    majorEvents: [],
    trauma: [],
    gratitude: [],
    grudges: [],
    fears: [],
    loyalties: [],
    betrayalsWitnessed: [],
    savedBy: [],
    harmedBy: [],
    favoritePlaces: [],
    avoidedRoutes: [],
    formerCommanders: [],
    formerGuilds: [],
    formerSettlements: []
  };
}

function defaultMotives() {
  return {
    survival: 50, wealth: 30, safety: 40, loyalty: 30, revenge: 10,
    ambition: 25, duty: 20, trade: 15, power: 10, familyClan: 20, fear: 15
  };
}

function defaultSettlementSentiment() {
  return {
    heroes: {}, villains: {}, lovedFactions: {}, hatedFactions: {},
    rememberedCrises: [], refugeeOrigins: {}
  };
}

function defaultUnitBonds() {
  return {
    leaderLoyaltyAvg: 50, veteranCount: 0, sharedBattleCount: 0,
    betrayalRisk: 0.1, moraleMemory: 0
  };
}

function defaultStrategyProfile() {
  return {
    preferredStrategy: 'direct_assault',
    riskAppetite: 0.5, patience: 0.5, logisticsFocus: 0.4, scoutUse: 0.4, honor: 0.5
  };
}

function defaultSiegeEquipment() {
  return { ladders: 0, ram: 0, tower: 0, catapult: 0, buildDays: 0, ready: false };
}

function defaultSupplyLine(armyId, originId, targetId, path) {
  return {
    id: uid(),
    armyId,
    originSettlementId: originId,
    targetSettlementId: targetId,
    routePath: path ? path.slice() : [],
    status: 'open',
    foodFlow: 0, weaponFlow: 0,
    danger: path ? pathDanger(path) : 0,
    lastDeliveredDay: world.day,
    escortStrength: 0,
    disruptionEvents: []
  };
}

function inferSettlementTerrain(s) {
  if (s.terrain && TERRAIN_TYPES.includes(s.terrain)) return s.terrain;
  if (s.type === 'camp') return 'forest';
  if (s.type === 'fort' || s.type === 'castle') return 'hill';
  if (s.y < 180) return 'forest';
  if (s.y > 480) return 'marsh';
  if (Math.abs(s.x - 500) < 90) return 'river';
  return s.type === 'village' ? pick(['plain', 'forest', 'hill']) : 'plain';
}

function inferRouteTerrain(r) {
  if (r.terrain && TERRAIN_TYPES.includes(r.terrain)) return r.terrain;
  const sa = getSettlement(r.a), sb = getSettlement(r.b);
  if (r.roadQuality > 0.65) return 'road';
  const ta = sa ? inferSettlementTerrain(sa) : 'plain';
  const tb = sb ? inferSettlementTerrain(sb) : 'plain';
  if (ta === 'forest' || tb === 'forest') return 'forest';
  if (ta === 'marsh' || tb === 'marsh') return 'marsh';
  if (ta === 'river' || tb === 'river') return 'river';
  if (r.roadQuality < 0.38) return 'forest';
  return 'plain';
}

function terrainBattleContext(terrain) {
  const m = {
    plain: { kind: 'open', atk: 1.05, def: 0.95 },
    forest: { kind: 'close', atk: 0.95, def: 1.12 },
    hill: { kind: 'range', atk: 0.92, def: 1.22 },
    river: { kind: 'close', atk: 0.88, def: 1.14 },
    road: { kind: 'field', atk: 1, def: 1 },
    marsh: { kind: 'close', atk: 0.84, def: 1.06 }
  };
  return m[terrain] || m.plain;
}

function pathDanger(path) {
  if (!path || path.length < 2) return 0;
  let d = 0, n = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const r = getRoute(path[i], path[i + 1]);
    if (r) { d += (r.threat || r.danger || 0) + (r.ambushRisk || 0) * 0.45; n++; }
  }
  return n ? d / n : 0;
}

function settlementStrategicValue(s) {
  if (!s || s.type === 'camp') return 10;
  let v = { village: 25, town: 55, fort: 70, castle: 95 }[s.type] || 30;
  if (s.marketRole?.hubLevel > 0) v += s.marketRole.hubLevel * 12;
  if (s.buildings?.includes('Wall')) v += 15;
  if (s.buildings?.includes('Market')) v += 8;
  return v;
}

function defaultAgentRelation() {
  return {
    score: 0, trust: 50, fear: 0, respect: 0, rivalry: 0,
    gratitude: 0, grudge: 0, loyalty: 0, lastInteractionDay: world.day, tags: []
  };
}

function getAgentRelation(a, bId) {
  if (!a || !bId || a.id === bId) return null;
  AgentMemorySystem.ensureAgent(a);
  const b = getAgent(bId);
  if (!b || !b.alive) return null;
  if (!a.relationships[bId]) a.relationships[bId] = defaultAgentRelation();
  const r = a.relationships[bId];
  if (!r.tags) r.tags = [];
  return r;
}

function changeAgentRelation(a, bId, delta, reason) {
  if (!a || !bId || a.id === bId) return;
  const r = getAgentRelation(a, bId);
  if (!r) return;
  if (!r.tags) r.tags = [];
  if (delta.score) r.score = clamp(r.score + delta.score, -100, 100);
  if (delta.trust) r.trust = clamp(r.trust + delta.trust, 0, 100);
  if (delta.fear) r.fear = clamp(r.fear + delta.fear, 0, 100);
  if (delta.respect) r.respect = clamp(r.respect + delta.respect, 0, 100);
  if (delta.rivalry) r.rivalry = clamp(r.rivalry + delta.rivalry, 0, 100);
  if (delta.gratitude) r.gratitude = clamp(r.gratitude + delta.gratitude, 0, 100);
  if (delta.grudge) r.grudge = clamp(r.grudge + delta.grudge, 0, 100);
  if (delta.loyalty) r.loyalty = clamp(r.loyalty + delta.loyalty, 0, 100);
  r.lastInteractionDay = world.day;
  if (reason && !r.tags.includes(reason)) r.tags.push(reason);
  AgentMemorySystem.pruneRelationships(a);
}

function addGrudge(a, targetId, reason, intensity) {
  if (!a || !targetId) return;
  changeAgentRelation(a, targetId, { grudge: intensity || 15, score: -(intensity || 15) * 0.5 }, reason || 'grudge');
  const p = a.memory.personal;
  if (!p.grudges.some(g => g.targetId === targetId)) p.grudges.push({ targetId, reason: reason || 'grudge', intensity: intensity || 15, day: world.day });
}

function addGratitude(a, targetId, reason, intensity) {
  if (!a || !targetId) return;
  changeAgentRelation(a, targetId, { gratitude: intensity || 12, trust: (intensity || 12) * 0.4, score: (intensity || 12) * 0.5 }, reason || 'gratitude');
  const p = a.memory.personal;
  if (!p.gratitude.some(g => g.targetId === targetId)) p.gratitude.push({ targetId, reason: reason || 'gratitude', intensity: intensity || 12, day: world.day });
}

function addLoyalty(a, leaderId, reason, intensity) {
  if (!a || !leaderId) return;
  changeAgentRelation(a, leaderId, { loyalty: intensity || 18, trust: (intensity || 18) * 0.3, score: (intensity || 18) * 0.4 }, reason || 'loyalty');
  const p = a.memory.personal;
  if (!p.loyalties.some(l => l.targetId === leaderId)) p.loyalties.push({ targetId: leaderId, reason: reason || 'loyalty', intensity: intensity || 18, day: world.day });
}

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
  sword:  { price: 60,  attack: 12, defense: 4,  accuracy: 0.75, durability: 80,  prof: 'swordsman',
    reach: 1.0, baseDamage: 12, damageType: 'slash', speed: 1.0, weight: 3, armorPierce: 0.1,
    shieldDamage: 0.8, staminaCost: 8, idealRange: 'melee', closePenalty: 0, horsebackUsable: true, formationBonus: 0, duelBonus: 0.15 },
  spear:  { price: 45,  attack: 10, defense: 6,  accuracy: 0.7,  durability: 70,  prof: 'spearman', antiCavalry: 1.35,
    reach: 1.8, baseDamage: 10, damageType: 'pierce', speed: 0.9, weight: 2.5, armorPierce: 0.2,
    shieldDamage: 0.5, staminaCost: 7, idealRange: 'reach', closePenalty: 0.35, horsebackUsable: false, formationBonus: 0.2, duelBonus: -0.05 },
  axe:    { price: 50,  attack: 14, defense: 2,  accuracy: 0.65, durability: 65,  prof: 'swordsman',
    reach: 0.9, baseDamage: 15, damageType: 'blunt', speed: 0.7, weight: 4.5, armorPierce: 0.25,
    shieldDamage: 1.4, staminaCost: 14, idealRange: 'melee', closePenalty: 0.05, horsebackUsable: false, formationBonus: 0.05, duelBonus: 0.05 },
  bow:    { price: 45,  attack: 11, defense: 0,  accuracy: 0.8,  durability: 55,  prof: 'archer', ranged: true,
    reach: 3.0, baseDamage: 9, damageType: 'pierce', speed: 0.85, weight: 1.5, armorPierce: 0.15,
    shieldDamage: 0, staminaCost: 6, idealRange: 'missile', closePenalty: 0.5, horsebackUsable: true, formationBonus: 0.1, duelBonus: -0.2 },
  dagger: { price: 25,  attack: 7,  defense: 1,  accuracy: 0.82, durability: 50,  prof: null,
    reach: 0.5, baseDamage: 7, damageType: 'pierce', speed: 1.2, weight: 1, armorPierce: 0.05,
    shieldDamage: 0.3, staminaCost: 5, idealRange: 'close', closePenalty: 0, horsebackUsable: false, formationBonus: 0, duelBonus: 0.1 },
  shield: { price: 35,  attack: 2,  defense: 10, accuracy: 0,   durability: 90,  prof: null, antiRanged: 0.65,
    reach: 0.6, baseDamage: 2, damageType: 'blunt', speed: 0.8, weight: 4, armorPierce: 0,
    shieldDamage: 0, staminaCost: 5, idealRange: 'melee', closePenalty: 0, horsebackUsable: false, formationBonus: 0.25, duelBonus: 0 }
};
const ARMOR_DEFS = {
  cloth:     { price: 25,  armor: 4,  dodge: 0.05, fatigue: 1.0,  durability: 40,
    armorValue: 4, coverage: 0.5, weight: 2, fatiguePenalty: 0, dodgePenalty: 0,
    arrowResistance: 0.05, bluntResistance: 0.05, slashResistance: 0.08, pierceResistance: 0.05 },
  leather:   { price: 55,  armor: 10, dodge: 0.08, fatigue: 1.1,  durability: 60,
    armorValue: 10, coverage: 0.65, weight: 4, fatiguePenalty: 0.05, dodgePenalty: 0.02,
    arrowResistance: 0.1, bluntResistance: 0.1, slashResistance: 0.15, pierceResistance: 0.08 },
  chainmail: { price: 120, armor: 18, dodge: 0.03, fatigue: 1.25, durability: 90,
    armorValue: 18, coverage: 0.8, weight: 12, fatiguePenalty: 0.12, dodgePenalty: 0.08,
    arrowResistance: 0.15, bluntResistance: 0.2, slashResistance: 0.35, pierceResistance: 0.12 },
  plate:     { price: 200, armor: 28, dodge: 0.01, fatigue: 1.45, durability: 120,
    armorValue: 28, coverage: 0.92, weight: 22, fatiguePenalty: 0.22, dodgePenalty: 0.15,
    arrowResistance: 0.25, bluntResistance: 0.35, slashResistance: 0.3, pierceResistance: 0.28 }
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

function equipSlot(type, slot, quality) {
  if (!type) return null;
  const d = WEAPON_DEFS[type] || ARMOR_DEFS[type] || MOUNT_DEFS[type] || (type === 'tool' ? TOOL_DEF : null);
  if (!d) return null;
  const q = quality || 'common';
  const qMod = { common: 1, fine: 1.12, masterwork: 1.25 }[q] || 1;
  const maxD = Math.floor((d.durability || 50) * qMod);
  const item = {
    id: uid(), type, slot, quality: q,
    durability: maxD, maxDurability: maxD,
    kills: 0, fame: 0, ownerHistory: []
  };
  if (WEAPON_DEFS[type]) {
    Object.assign(item, {
      reach: d.reach, baseDamage: Math.floor((d.baseDamage || d.attack) * qMod),
      damageType: d.damageType || 'slash', speed: d.speed || 1, weight: d.weight || 2,
      armorPierce: d.armorPierce || 0, staminaCost: d.staminaCost || 8,
      idealRange: d.idealRange || 'melee', closePenalty: d.closePenalty || 0
    });
  }
  if (ARMOR_DEFS[type]) {
    Object.assign(item, {
      armorValue: Math.floor((d.armorValue || d.armor) * qMod), coverage: d.coverage || 0.6,
      weight: d.weight || 5, fatiguePenalty: d.fatiguePenalty || 0, dodgePenalty: d.dodgePenalty || 0,
      arrowResistance: d.arrowResistance || 0.1, bluntResistance: d.bluntResistance || 0.1,
      slashResistance: d.slashResistance || 0.1, pierceResistance: d.pierceResistance || 0.1
    });
  }
  return item;
}

function seededRand(seed) {
  let s = ((seed || 1) * 1103515245 + 12345) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

function defaultCombatBody(agentId) {
  const r = seededRand(agentId || 1);
  const builds = ['light', 'average', 'heavy'];
  const build = builds[Math.floor(r() * 3)];
  return {
    height: 0.85 + r() * 0.3,
    build,
    dominantHand: r() > 0.12 ? 'right' : 'left',
    reachBonus: build === 'light' ? 0.08 : build === 'heavy' ? -0.06 : 0,
    woundTolerance: 0.4 + r() * 0.4,
    painTolerance: 0.35 + r() * 0.45,
    balance: 0.4 + r() * 0.5,
    reflex: 0.35 + r() * 0.5
  };
}

function defaultDerivedCombat() {
  return {
    meleeAttack: 0, meleeDefense: 0, rangedAttack: 0, block: 0, parry: 0, dodge: 0,
    armor: 0, armorPenetration: 0, reach: 1, speed: 1, stamina: 100, staminaMax: 100,
    staminaRegen: 5, moraleResistance: 0, knockdownResistance: 0, injuryResistance: 0, commandPresence: 0
  };
}

function defaultUnitComposition() {
  return { swordsmen: 0, spearmen: 0, archers: 0, cavalry: 0, shieldmen: 0, scouts: 0, engineers: 0, militia: 0, veterans: 0 };
}

const RANGE_BANDS = ['far', 'missile', 'reach', 'melee', 'close', 'grapple'];
const ATTACK_DIRS = ['overhead', 'left', 'right', 'thrust'];
const DEFENSE_ACTIONS = ['block_high', 'block_left', 'block_right', 'parry', 'shield_block', 'dodge', 'armor_absorb'];
const FORMATIONS = ['loose', 'shield_wall', 'spear_line', 'skirmish', 'charge', 'defensive', 'ambush', 'retreat'];
const MAX_BATTLE_REPORTS = 100;

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
  add(category, text, refs) {
    world.events.push({ day: world.day, category, text, refs: refs || null });
    if (world.events.length > 600) world.events.splice(0, world.events.length - 600);
    UI.logDirty = true;
    if (typeof ObserverSystem !== 'undefined') ObserverSystem.observerDirty = true;
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
    winner: null, summary: null,
    goal: typeof CampaignWarfareSystem !== 'undefined' ? CampaignWarfareSystem.pickWarGoal(attackerF, defenderF) : 'capture_settlement',
    supplyDisruptions: 0, sieges: 0, ambushes: 0, goalAchieved: false
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
  EventSystem.add('war', `⚔ สงครามปะทุ: ${attackerF.name} vs ${defenderF.name}`, {
    factions: [attackerF.id, defenderF.id]
  });
  if (typeof ObserverSystem !== 'undefined') {
    ObserverSystem.onMajorEvent('war_declaration', `สงครามปะทุ: ${attackerF.name} vs ${defenderF.name}`, {
      factions: [attackerF.id, defenderF.id]
    });
  }
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
    + (w.supplyDisruptions ? ` ตัดเสบียง ${w.supplyDisruptions} ครั้ง` : '')
    + (w.sieges ? ` ล้อมเมือง ${w.sieges} ครั้ง` : '')
    + (w.ambushes ? ` ซุ่มโจมตี ${w.ambushes} ครั้ง` : '')
    + (w.goal ? ` เป้าหมาย: ${w.goal}${w.goalAchieved ? ' (สำเร็จ)' : ''}` : '')
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
  AgentMemorySystem.ensureAgent(a);
  const birthplace = getSettlement(a.birthplaceId || a.memory.personal?.birthplaceId);
  const first = a.career[0];
  const profTH = {
    farmer: 'ชาวนา', woodcutter: 'คนตัดไม้', miner: 'คนงานเหมือง', crafter: 'ช่างฝีมือ',
    trader: 'พ่อค้า', guard: 'ยาม', bandit: 'โจร', militia: 'ทหารบ้าน', swordsman: 'นักดาบ',
    spearman: 'พลหอก', archer: 'นักธนู', cavalry: 'ทหารม้า', captain: 'นายกอง',
    commander: 'แม่ทัพ', mayor: 'เจ้าเมือง', lord: 'ขุนนาง', king: 'ราชา',
    unemployed: 'คนว่างงาน', migrant: 'ผู้อพยพ', refugee: 'ผู้ลี้ภัย'
  };
  const bornDay = a.memory.personal?.bornDay ?? 0;
  let txt = `เกิดที่${birthplace ? birthplace.name : 'แดนไกล'}ในวันที่ ${bornDay} เริ่มชีวิตเป็น${profTH[first.profession] || first.profession}`;
  const p = a.memory.personal;
  const turning = (p.majorEvents || []).filter(e => e.importance >= 3).slice(-3);
  for (const ev of turning) {
    if (ev.type === 'robbed_by_bandits') txt += ` ก่อนถูกโจรปล้นบนเส้นทางในวันที่ ${ev.day}`;
    else if (ev.type === 'survived_battle') txt += ` รอดจาก${ev.title || 'ศึกใหญ่'}ในวันที่ ${ev.day}`;
    else if (ev.type === 'commander_saved_me') txt += ` ได้รับการช่วยเหลือจากผู้นำในวันที่ ${ev.day}`;
    else if (ev.type === 'city_starved') txt += ` ประสบความอดอยากที่${(getSettlement(ev.settlements?.[0]) || {}).name || 'ถิ่นฐาน'}ในวันที่ ${ev.day}`;
    else if (ev.type === 'joined_guild') txt += ` เข้าร่วมสมาคมพ่อค้าในวันที่ ${ev.day}`;
    else if (ev.type === 'lost_home') txt += ` สูญเสียบ้านเกิดในวันที่ ${ev.day}`;
    else if (ev.type === 'trade_disaster') txt += ` ประสบภัยการค้าในวันที่ ${ev.day}`;
  }
  if (p.grudges?.length) {
    const g = p.grudges[p.grudges.length - 1];
    const tgt = getAgent(g.targetId);
    if (tgt) txt += ` ถือแค้น${tgt.name.split(' ')[0]}`;
  }
  if (p.loyalties?.length) {
    const l = p.loyalties[p.loyalties.length - 1];
    const tgt = getAgent(l.targetId);
    if (tgt) txt += ` ภักดีต่อ${tgt.name.split(' ')[0]}`;
  }
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
    txt += ` ปัจจุบันเป็น${now}${a.title ? ` ฉายา "${a.title}"` : ''}`;
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
    caravanSubsidy: 0,
    // ── Phase 12: market hub / trade ──
    marketRole: defaultMarketRole(),
    tradeVolume: 0,
    priceVolatility: 0,
    // ── Phase 17: citizen sentiment ──
    sentiment: defaultSettlementSentiment(),
    // ── Phase 18: terrain / strategic value ──
    terrain: opt.terrain || null,
    strategicValue: opt.strategicValue != null ? opt.strategicValue : null,
    siegeEquipment: { wallBonus: 0, watchtower: 0 },
    ownerOrganizationId: opt.ownerOrganizationId || null,
    localLordId: opt.localLordId || null,
    vassalObligation: opt.vassalObligation || null,
    captureSourceWarbandId: null,
    captureDay: null,
    taxRecipient: opt.taxRecipient || null,
    legitimacy: opt.legitimacy != null ? opt.legitimacy : 50
  };
  if (!s.terrain) s.terrain = inferSettlementTerrain(s);
  if (s.strategicValue == null) s.strategicValue = settlementStrategicValue(s);
  if (s.buildings.includes('Wall')) s.siegeEquipment.wallBonus = 1;
  if (s.buildings.includes('Watchtower')) s.siegeEquipment.watchtower = 1;
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
    priceGapFood: 0,
    // ── Phase 18: terrain / campaign ──
    terrain: null,
    ambushRisk: null,
    supplyTraffic: 0,
    scoutCoverage: 0
  };
  r.terrain = inferRouteTerrain(r);
  r.ambushRisk = clamp((r.threat || r.danger || 0.1) * (r.terrain === 'forest' ? 1.35 : r.terrain === 'marsh' ? 1.15 : 0.9), 0.02, 0.85);
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
    tradeInfluence: 0,
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
    memory: {
      battlesWon: 0, battlesLost: 0, survivedBattles: 0, citiesVisited: [],
      daysHungry: 0, raidsDone: 0, tradeProfit: 0,
      personal: defaultPersonalMemory(opt.locationId)
    },
    relationships: {},
    motives: defaultMotives(),
    // governor attributes (ใช้เมื่อได้เป็นผู้ปกครอง)
    gov: null,
    travel: null,        // { path:[ids], seg, progress, purpose }
    cargo: null,         // สำหรับพ่อค้า { good, qty, buyCost, destId }
    currentGoal: 'ตั้งตัว',
    currentThought: 'วันนี้จะทำอะไรดี...',
    // สำหรับ render
    _jitterA: Math.random() * Math.PI * 2,
    _jitterR: rand(0.3, 1),
    // ── Phase 12: merchant career ──
    guildId: opt.guildId || null,
    merchantRank: opt.merchantRank || 'peddler',
    tradeReputation: opt.tradeReputation != null ? opt.tradeReputation : 50,
    contractsCompleted: 0,
    contractsFailed: 0,
    warehouseIds: [],
    // ── Phase 18.1: Mount & Blade text combat ──
    body: opt.body || null,
    derivedCombat: null,
    injuries: opt.injuries || [],
    duelRecord: opt.duelRecord || { wins: 0, losses: 0, kills: 0 },
    memberships: opt.memberships ? opt.memberships.slice() : []
  };
  world.agents.push(a);
  if (typeof TextCombatCore !== 'undefined') TextCombatCore.ensureAgent(a);
  else {
    if (!a.body) a.body = defaultCombatBody(a.id);
    if (!a.derivedCombat) a.derivedCombat = defaultDerivedCombat();
  }
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
    combatPower: 0,
    bonds: defaultUnitBonds(),
    retreating: false,
    // ── Phase 18.1 ──
    composition: opt.composition || defaultUnitComposition(),
    formation: opt.formation || 'loose',
    formationStats: opt.formationStats || defaultFormationStats()
  };
  world.units.push(u);
  for (const id of u.memberIds) { const m = getAgent(id); if (m) m.unitId = u.id; }
  if (typeof TextCombatCore !== 'undefined') TextCombatCore.updateUnitComposition(u);
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
    travel: null,
    baseSettlementId: opt.baseSettlementId || opt.locationId,
    supplyLineId: null,
    campId: null,
    retreatTargetId: null,
    warGoal: opt.warGoal || 'capture_settlement',
    strategyProfile: opt.strategyProfile || defaultStrategyProfile(),
    siegeEquipment: opt.siegeEquipment || defaultSiegeEquipment()
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
function unitMembers(u) { return (u?.memberIds || []).map(getAgent).filter(a => a && a.alive); }
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
    guilds: [], warehouses: [], tradeContracts: [],
    organizations: [], recruitmentOffers: [], musterPoints: [], warbands: [], headquarters: [],
    siegeAuthorities: [], claims: [], captureCredits: [], vassalGrants: [],
    supplyLines: [], armyCamps: [], scoutReports: [],
    battleReports: [], legendaryWeapons: [],
    largeBattleRecords: [], activeBattlefields: [],
    marketIndex: defaultMarketIndex(),
    stats: { deaths: 0, battles: 0, raids: 0, caravansRobbed: 0, squadsFormed: 0, gearBought: 0, bountiesPosted: 0, traderSpawns: 0, townCaravans: 0, townCaravansLost: 0, townCaravansReplaced: 0, localRations: 0, emergencyCaravans: 0, emergencyFallbacks: 0, contractsCompleted: 0, contractsFailed: 0, warehouseRaids: 0 }
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
  MarketTradeSystem.initWorld();
  if (typeof AgentMemorySystem !== 'undefined') AgentMemorySystem.initWorld();
  if (typeof CampaignWarfareSystem !== 'undefined') CampaignWarfareSystem.initWorld();
  if (typeof TextCombatCore !== 'undefined') TextCombatCore.initWorld();
  if (typeof LargeBattlefieldSystem !== 'undefined') LargeBattlefieldSystem.initWorld();
  if (typeof OrganizationSystem !== 'undefined') OrganizationSystem.initWorld();
  if (typeof SovereigntySystem !== 'undefined') SovereigntySystem.initWorld();
  if (typeof ObserverSystem !== 'undefined') {
    ObserverSystem.follow = null;
    ObserverSystem.updateFollowLabel();
    ObserverSystem.observerDirty = true;
    Renderer.resetView();
  }
  UI.dashboardDirty = true;
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
  if (typeof TextCombatCore !== 'undefined') TextCombatCore.ensureAgent(ag);
  AmbitionSystem.planFor(ag);
}

/* ═══════════ 6. ROUTE GRAPH / PATHFINDING / TRAVEL ═══════════ */

// Dijkstra บนกราฟ settlement — weight = ระยะ × สภาพถนน (+ ความอันตรายถ้า avoidDanger)
function findPath(fromId, toId, avoidDanger, agent) {
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
      if (agent && typeof AgentMemorySystem !== 'undefined') w *= AgentMemorySystem.routeWeightMultiplier(agent, r);
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
  const agent = entity.profession ? entity : null;
  const path = findPath(entity.locationId, toId, avoidDanger, agent);
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
    if (typeof CampaignWarfareSystem !== 'undefined') CampaignWarfareSystem.checkTravelAmbush(entity, r, aId, bId);
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


/* ═══════════ Phase 18.1: Mount & Blade Text Combat Core ═══════════ */
const TextCombatCore = {
  ensureAgent(a) {
    if (!a || !a.alive) return;
    syncLegacyInventory(a);
    if (!a.body) a.body = defaultCombatBody(a.id);
    if (!a.derivedCombat) a.derivedCombat = defaultDerivedCombat();
    if (!a.injuries) a.injuries = [];
    if (!a.duelRecord) a.duelRecord = { wins: 0, losses: 0, kills: 0 };
    if (a._stamina == null) a._stamina = 100;
    this.recalcDerivedCombat(a);
  },

  getWeaponSkill(a, weaponType) {
    if (!weaponType) return a.skills.fighting || 0;
    const map = { sword: 'sword', spear: 'spear', axe: 'sword', bow: 'archery', dagger: 'sword' };
    return (a.skills[map[weaponType] || 'fighting'] || 0) + a.skills.fighting * 0.3;
  },

  getArmorPenalty(a) {
    const arm = a.equipment?.armor;
    if (!arm || arm.durability <= 0) return { fatigue: 0, dodge: 0, speed: 0 };
    const d = ARMOR_DEFS[arm.type] || {};
    const ratio = arm.durability / Math.max(arm.maxDurability, 1);
    return {
      fatigue: (d.fatiguePenalty || 0) * ratio,
      dodge: (d.dodgePenalty || 0) * ratio,
      speed: (d.weight || 5) * 0.008 * ratio
    };
  },

  getInjuryPenalty(a) {
    let atk = 0, def = 0, spd = 0, per = 0;
    for (const inj of (a.injuries || []).filter(i => !i.healed)) {
      const s = (inj.severity || 1) / 10;
      if (inj.type === 'broken_arm') atk += 0.25 * s;
      if (inj.type === 'broken_leg' || inj.type === 'limp') spd += 0.3 * s;
      if (inj.type === 'concussion' || inj.type === 'trauma') per += 0.2 * s;
      if (inj.type === 'deep_cut') def += 0.1 * s;
      if (inj.type === 'maimed') atk += 0.4 * s;
    }
    return { atk, def, spd, per };
  },

  recalcDerivedCombat(a) {
    if (!a || !a.alive) return defaultDerivedCombat();
    syncLegacyInventory(a);
    if (!a.body) a.body = defaultCombatBody(a.id);
    if (!a.derivedCombat) a.derivedCombat = defaultDerivedCombat();
    const c = a.combatStats, sk = a.skills, b = a.body;
    const ap = this.getArmorPenalty(a), ip = this.getInjuryPenalty(a);
    const mh = a.equipment?.mainHand, rg = a.equipment?.ranged, sh = a.equipment?.offHand, arm = a.equipment?.armor;
    const buildMod = b.build === 'light' ? { dodge: 0.08, spd: 0.1, kd: -0.1 } : b.build === 'heavy' ? { dodge: -0.06, spd: -0.08, kd: 0.15 } : {};
    const hungerMod = a.stats.hunger < 30 ? 0.85 : 1;
    const fatMod = a.stats.energy < 40 ? 0.88 : 1;
    let meleeAtk = c.strength * 1.1 + sk.fighting * 1.8 + this.getWeaponSkill(a, mh?.type);
    let meleeDef = c.endurance * 0.7 + c.discipline * 0.5 + (sh?.type === 'shield' ? 8 : 0);
    let rangedAtk = c.perception * 0.8 + sk.archery * 2;
    let armor = 0, reach = 1 + (b.reachBonus || 0);
    if (mh?.durability > 0) { meleeAtk += (mh.baseDamage || WEAPON_DEFS[mh.type]?.attack || 0) * 0.5; reach += mh.reach || 0; }
    if (rg?.durability > 0) rangedAtk += (rg.baseDamage || 8);
    if (arm?.durability > 0) armor += arm.armorValue || ARMOR_DEFS[arm.type]?.armor || 0;
    const dc = a.derivedCombat;
    dc.meleeAttack = Math.max(1, (meleeAtk - ip.atk * 20) * hungerMod * fatMod);
    dc.meleeDefense = Math.max(1, (meleeDef - ip.def * 15) * hungerMod);
    dc.rangedAttack = Math.max(0, rangedAtk * hungerMod);
    dc.block = clamp(0.2 + c.discipline * 0.04 + (sh?.type === 'shield' ? 0.25 : 0), 0, 0.85);
    dc.parry = clamp(0.1 + b.reflex * 0.25 + sk.sword * 0.03, 0, 0.7);
    dc.dodge = clamp(0.08 + c.agility * 0.025 + (buildMod.dodge || 0) - ap.dodge, 0, 0.55);
    dc.armor = armor;
    dc.armorPenetration = clamp(0.05 + (mh?.armorPierce || 0) + sk.fighting * 0.02, 0, 0.5);
    dc.reach = reach;
    dc.speed = clamp(0.7 + c.agility * 0.04 + (buildMod.spd || 0) - ap.speed - ip.spd, 0.4, 1.4);
    dc.staminaMax = Math.floor(80 + c.endurance * 6 - (arm?.weight || 0) * 1.2);
    dc.stamina = clamp(a._stamina != null ? a._stamina : dc.staminaMax, 0, dc.staminaMax);
    dc.staminaRegen = clamp(4 + c.endurance * 0.4 - ap.fatigue * 10, 1, 12);
    dc.moraleResistance = c.courage * 0.08 + c.discipline * 0.06 + sk.fighting * 0.05;
    dc.knockdownResistance = clamp(0.2 + b.balance * 0.4 + (buildMod.kd || 0), 0, 0.9);
    dc.injuryResistance = clamp(0.15 + b.woundTolerance * 0.35 + c.endurance * 0.02, 0.05, 0.85);
    dc.commandPresence = sk.leadership * 1.5 + sk.tactics * 0.8 + c.charisma * 0.3;
    for (const k of Object.keys(dc)) {
      if (typeof dc[k] === 'number' && !Number.isFinite(dc[k])) dc[k] = 0;
    }
    a.derivedStats = null;
    return dc;
  },

  applyInjury(a, type, severity, sourceAgentId, sourceWeaponId) {
    this.ensureAgent(a);
    const inj = {
      type, severity: severity || randInt(2, 6), day: world.day,
      sourceAgentId: sourceAgentId || null, sourceWeaponId: sourceWeaponId || null,
      healed: false, permanent: ['scar', 'limp', 'maimed', 'trauma'].includes(type)
    };
    a.injuries.push(inj);
    if (a.injuries.length > 12) a.injuries.shift();
    if (type === 'trauma' && typeof AgentMemorySystem !== 'undefined') {
      AgentMemorySystem.recordPersonalEvent(a, 'trauma', 'บาดแผลทางจิตใจ', 'จากสนามรบ', 3, { agents: sourceAgentId ? [sourceAgentId] : [] });
    }
    if (type === 'scar') a.fame = (a.fame || 0) + 1;
    this.recalcDerivedCombat(a);
    return inj;
  },

  tickInjuries() {
    for (const a of world.agents) {
      if (!a.alive || !a.injuries?.length) continue;
      const s = getSettlement(a.locationId);
      const healBonus = s ? (s.prosperity / 100) * 0.3 + (s.buildings?.includes('Temple') ? 0.2 : 0) : 0;
      for (const inj of a.injuries) {
        if (inj.healed || inj.permanent) continue;
        if (chance(0.08 + healBonus)) {
          inj.healed = true;
          if (inj.type === 'minor_cut' || inj.type === 'arrow_wound') inj.healed = true;
        } else if (inj.type === 'deep_cut' && chance(0.02) && a.stats.health < 25) {
          NeedSystem.kill(a, 'เสียชีวิตจากบาดแผล');
        }
      }
      this.recalcDerivedCombat(a);
    }
    for (const a of world.agents) {
      if (!a.alive) continue;
      this.ensureAgent(a);
      const dc = a.derivedCombat;
      a._stamina = clamp((a._stamina || dc.staminaMax) + dc.staminaRegen * 0.5, 0, dc.staminaMax);
      dc.stamina = a._stamina;
    }
  },

  rangeBandPenalty(weapon, band) {
    if (!weapon) return 0.5;
    const ideal = weapon.idealRange || 'melee';
    const map = { far: 0, missile: 1, reach: 2, melee: 3, close: 4, grapple: 5 };
    const diff = Math.abs((map[ideal] || 3) - (map[band] || 3));
    let pen = diff * 0.18;
    if (band === 'close' && weapon.closePenalty) pen += weapon.closePenalty;
    return clamp(1 - pen, 0.25, 1.15);
  },

  pickDefense(defender, attackDir) {
    const dc = defender.derivedCombat || this.recalcDerivedCombat(defender);
    const hasShield = defender.equipment?.offHand?.type === 'shield';
    if (attackDir === 'overhead' && dc.block > 0.3) return hasShield ? 'shield_block' : 'block_high';
    if (attackDir === 'thrust' && dc.parry > 0.25 && chance(0.4)) return 'parry';
    if (attackDir === 'left') return hasShield ? 'shield_block' : 'block_left';
    if (attackDir === 'right') return hasShield ? 'shield_block' : 'block_right';
    if (dc.dodge > 0.2 && defender.body?.build === 'light' && chance(0.35)) return 'dodge';
    if (dc.armor > 15 && chance(0.3)) return 'armor_absorb';
    return pick(['block_left', 'block_right', 'dodge']);
  },

  calcMomentum(attacker, defender, weapon, mounted, terrainType) {
    const dc = attacker.derivedCombat;
    let m = dc.speed + (weapon?.speed || 1) * 0.3;
    if (mounted) m += 0.45;
    if (terrainType === 'plain' || terrainType === 'road') m += 0.1;
    if (terrainType === 'forest' || terrainType === 'marsh') m -= 0.15;
    m -= (defender.derivedCombat?.meleeDefense || 0) * 0.008;
    return clamp(m, 0.3, 1.8);
  },

  resolveDuel(attacker, defender, context) {
    context = context || {};
    this.ensureAgent(attacker); this.ensureAgent(defender);
    const maxRounds = context.maxRounds || randInt(3, 8);
    let rangeBand = context.rangeBand || (context.mounted ? 'reach' : 'melee');
    const log = [];
    let aDmg = 0, dDmg = 0;
    const injuries = [];
    let killed = false, fled = false, weaponBroken = false, shieldBroken = false;
    attacker._stamina = attacker.derivedCombat.staminaMax;
    defender._stamina = defender.derivedCombat.staminaMax;

    for (let round = 1; round <= maxRounds; round++) {
      if (!attacker.alive || !defender.alive) break;
      const aWpn = attacker.equipment?.mainHand || attacker.equipment?.ranged;
      const intents = context.mounted ? ['charge', 'attack', 'attack', 'feint'] : ['attack', 'attack', 'feint', 'shoot', 'keep_distance'];
      let aIntent = pick(intents);
      if (rangeBand === 'missile' && attacker.equipment?.ranged?.durability > 0) aIntent = 'shoot';
      if (attacker._stamina < 15) aIntent = chance(0.5) ? 'retreat' : 'defend';
      if (aIntent === 'retreat') { fled = true; log.push(`R${round}: ${attacker.name.split(' ')[0]} ถอยหนี`); break; }
      if (aIntent === 'keep_distance' && rangeBand !== 'missile') { rangeBand = RANGE_BANDS[Math.max(0, RANGE_BANDS.indexOf(rangeBand) - 1)]; continue; }
      if (aIntent === 'close_distance') { rangeBand = RANGE_BANDS[Math.min(RANGE_BANDS.length - 1, RANGE_BANDS.indexOf(rangeBand) + 1)]; continue; }

      const atkDir = aIntent === 'shoot' ? 'thrust' : pick(ATTACK_DIRS);
      const defAct = this.pickDefense(defender, atkDir);
      const aDC = attacker.derivedCombat, dDC = defender.derivedCombat;
      const wpn = aIntent === 'shoot' ? attacker.equipment?.ranged : aWpn;
      const staminaCost = wpn?.staminaCost || (atkDir === 'overhead' ? 10 : 8);
      attacker._stamina -= staminaCost;

      const rangeMod = this.rangeBandPenalty(wpn, rangeBand);
      const skillMod = 1 + this.getWeaponSkill(attacker, wpn?.type) * 0.06;
      const initA = aDC.speed * 10 + attacker.combatStats.agility * 0.5 + (atkDir === 'overhead' ? -2 : 0);
      const initD = dDC.speed * 8 + (defender.body?.reflex || 0) * 10;
      const surprise = context.surprise ? 1.15 : 1;
      let hitChance = clamp(0.35 + aDC.meleeAttack * 0.015 * rangeMod * skillMod * surprise - dDC.meleeDefense * 0.01, 0.08, 0.92);
      if (aIntent === 'shoot') hitChance = clamp(0.3 + aDC.rangedAttack * 0.02 * rangeMod - dDC.dodge * 0.5, 0.1, 0.85);

      let damage = 0;
      if (chance(hitChance)) {
        const momentum = this.calcMomentum(attacker, defender, wpn, context.mounted, context.terrain);
        const wRatio = (wpn?.durability || 0) / Math.max(wpn?.maxDurability || wpn?.durability || 1, 1);
        const base = (wpn?.baseDamage || 8) * clamp(wRatio, 0, 1);
        const dirMod = atkDir === 'overhead' ? 1.2 : atkDir === 'thrust' ? 1.05 : 1;
        let armorRed = dDC.armor * 0.35;
        const dtype = wpn?.damageType || 'slash';
        const arm = defender.equipment?.armor;
        if (arm) {
          const res = arm[`${dtype}Resistance`] || arm.slashResistance || 0.1;
          armorRed *= (1 - res);
        }
        if (defAct === 'shield_block') { armorRed += 12; if (defender.equipment?.offHand) defender.equipment.offHand.durability -= randInt(3, 8); }
        if (defAct === 'parry' && chance(dDC.parry)) { damage = 0; log.push(`R${round}: ${defender.name.split(' ')[0]} ปัดป้อง`); }
        else if (defAct === 'dodge' && chance(dDC.dodge)) { damage = 0; }
        else if (defAct === 'armor_absorb') { armorRed *= 1.3; }
        damage = Math.max(0, base * dirMod * momentum * skillMod - armorRed);
        damage *= rand(0.75, 1.15);
        if (!Number.isFinite(damage)) damage = 0;
        defender.stats.health -= damage;
        dDmg += damage;
        defender._stamina -= Math.min(8, damage * 0.4);

        if (damage > 8 && chance(0.35 - defender.derivedCombat.injuryResistance)) {
          const itype = aIntent === 'shoot' ? 'arrow_wound' : damage > 14 ? 'deep_cut' : 'minor_cut';
          injuries.push({ agentId: defender.id, ...this.applyInjury(defender, itype, Math.ceil(damage / 4), attacker.id, wpn?.id) });
        }
        if (defender.stats.health <= 0) {
          killed = true;
          attacker.duelRecord.kills++;
          if (wpn) wpn.kills = (wpn.kills || 0) + 1;
          NeedSystem.kill(defender, 'ตายในการดวล');
          log.push(`R${round}: ${attacker.name.split(' ')[0]} ${aIntent === 'shoot' ? 'ยิง' : 'โจมตี'}ทำให้${defender.name.split(' ')[0]} ล้ม`);
          break;
        }
        log.push(`R${round}: ${attacker.name.split(' ')[0]}→${defender.name.split(' ')[0]} ${Math.floor(damage)} dmg (${defAct})`);
      } else {
        log.push(`R${round}: ${defender.name.split(' ')[0]} หลบ/ป้องกัน`);
      }

      if (defender._stamina < 10 && chance(0.25)) {
        defender.stats.morale = clamp(defender.stats.morale - 12, 0, 100);
        if (chance(0.3)) { fled = true; log.push(`${defender.name.split(' ')[0]} หนีจากการดวล`); break; }
      }

      if (rangeBand === 'melee' && chance(0.2)) rangeBand = 'close';
      if (wpn && wpn.durability <= 0) { weaponBroken = true; break; }
    }

    const winner = killed || fled ? attacker : (dDmg > aDmg ? attacker : defender);
    const loser = winner.id === attacker.id ? defender : attacker;
    if (winner.id === attacker.id) { attacker.duelRecord.wins++; defender.duelRecord.losses++; }
    else { defender.duelRecord.wins++; attacker.duelRecord.losses++; }

    if (typeof AgentMemorySystem !== 'undefined') {
      if (winner.id === attacker.id) AgentMemorySystem.recordPersonalEvent(attacker, 'won_duel', 'ชนะการดวล', loser.name, 2, { agents: [loser.id] });
      else AgentMemorySystem.recordPersonalEvent(defender, 'won_duel', 'ชนะการดวล', attacker.name, 2, { agents: [attacker.id] });
      if (killed) AgentMemorySystem.recordPersonalEvent(attacker, 'killed_enemy', 'สังหารศัตรูในการดวล', loser.name, 3, { agents: [loser.id] });
    }
    this.checkLegendaryWeapon(attacker.equipment?.mainHand || attacker.equipment?.ranged, attacker, 'duel_kill');

    return {
      winnerId: winner.id, loserId: loser.id, rounds: log.length,
      winnerDamage: winner.id === attacker.id ? aDmg : dDmg,
      loserDamage: winner.id === attacker.id ? dDmg : aDmg,
      injuries, killed, fled, weaponBroken, shieldBroken,
      moraleShock: killed ? 15 : fled ? 10 : 5,
      notableLog: log.slice(-4).join(' · '),
      fameDelta: killed ? 3 : (winner.duelRecord.wins % 3 === 0 ? 1 : 0)
    };
  },

  sampleFighters(unit, maxN) {
    const members = unitMembers(unit);
    if (!members.length) return [];
    const leader = getAgent(unit.leaderId);
    const picks = new Set();
    if (leader?.alive) picks.add(leader.id);
    const veterans = members.filter(m => (m.memory?.survivedBattles || 0) >= 2 || m.rank === 'veteran');
    for (const v of veterans.slice(0, 3)) picks.add(v.id);
    const pool = members.filter(m => !picks.has(m.id));
    while (picks.size < Math.min(maxN, members.length) && pool.length) picks.add(pick(pool).id);
    return [...picks].map(getAgent).filter(a => a && a.alive);
  },

  updateUnitComposition(u) {
    if (!u.composition) u.composition = defaultUnitComposition();
    const c = defaultUnitComposition();
    for (const m of unitMembers(u)) {
      TextCombatCore.ensureAgent(m);
      syncLegacyInventory(m);
      const role = CombatSystem.inferProfession(m);
      if ((m.memory?.survivedBattles || 0) >= 2) c.veterans++;
      if (role === 'archer') c.archers++;
      else if (role === 'cavalry') c.cavalry++;
      else if (role === 'spearman') c.spearmen++;
      else if (m.equipment?.offHand?.type === 'shield') c.shieldmen++;
      else if (role === 'swordsman') c.swordsmen++;
      else if (m.skills.crafting > 2) c.engineers++;
      else if (m.skills.perception > 3 || m.combatStats.perception > 7) c.scouts++;
      else c.militia++;
    }
    u.composition = c;
    return c;
  },

  pickFormation(unit, enemyComp, terrainType, strategy) {
    const c = this.updateUnitComposition(unit);
    if (strategy === 'cut_supply' || strategy === 'raid_economy') return 'skirmish';
    if (strategy === 'siege' || strategy === 'defensive') return 'defensive';
    if (c.cavalry > c.spearmen && (terrainType === 'plain' || terrainType === 'road')) return 'charge';
    if (c.spearmen > c.cavalry && enemyComp?.cavalry > 2) return 'spear_line';
    if (c.shieldmen > 3 && c.archers > 2) return 'shield_wall';
    if (c.archers > c.swordsmen) return 'skirmish';
    return 'loose';
  },

  formationMod(formation, role) {
    const m = {
      shield_wall: { def: 1.2, arrow: 0.65, spd: 0.75 },
      spear_line: { def: 1.15, cav: 1.35, close: 0.85 },
      skirmish: { rng: 1.2, cav: 0.85 },
      charge: { atk: 1.35, fat: 1.4 },
      defensive: { mor: 1.2, def: 1.1 },
      ambush: { surp: 1.4 },
      retreat: { cas: 0.7 },
      loose: { atk: 1, def: 1 }
    }[formation] || { atk: 1, def: 1 };
    if (role === 'archer') return m.rng || 1;
    if (role === 'cavalry') return m.cav || 1;
    return m.def || m.atk || 1;
  },

  computeMoraleShock(unit, triggers) {
    const members = unitMembers(unit);
    if (!members.length) return 0;
    let shock = 0;
    for (const t of triggers) {
      if (t === 'commander_died') shock += 25;
      if (t === 'friend_died') shock += 8;
      if (t === 'shield_wall_broken') shock += 12;
      if (t === 'cavalry_charge') shock += 10;
      if (t === 'ambushed') shock += 18;
      if (t === 'surrounded') shock += 14;
      if (t === 'supply_cut') shock += 10;
    }
    const leader = getAgent(unit.leaderId);
    let resist = 0;
    for (const m of members) {
      TextCombatCore.ensureAgent(m);
      resist += m.derivedCombat.moraleResistance + (leader ? (getAgentRelation(m, leader.id)?.loyalty || 0) * 0.1 : 0);
      resist += (unit.bonds?.leaderLoyaltyAvg || 50) * 0.05;
      shock += m.injuries?.filter(i => !i.healed).length * 2;
      if (m.stats.hunger < 25) shock += 5;
    }
    resist /= members.length;
    return clamp(shock - resist, 0, 80);
  },

  resolveSkirmish(unitA, unitB, context) {
    context = context || {};
    const sizeA = unitMembers(unitA).length, sizeB = unitMembers(unitB).length;
    const total = sizeA + sizeB;
    let sampleN = total <= 12 ? Math.min(sizeA, sizeB, 4) : total <= 80 ? randInt(4, 8) : randInt(3, 6);
    const fightersA = this.sampleFighters(unitA, sampleN);
    const fightersB = this.sampleFighters(unitB, sampleN);
    const notableDuels = [];
    let casualtiesA = 0, casualtiesB = 0, injuries = [];
    const terrainType = context.terrainType || 'plain';

    for (let i = 0; i < Math.min(fightersA.length, fightersB.length); i++) {
      const duel = this.resolveDuel(fightersA[i], fightersB[i], {
        terrain: context.terrain, terrainType, rangeBand: context.rangeBand || 'melee',
        stakes: context.stakes || 'battle', surprise: context.surprise,
        mounted: fightersA[i].equipment?.mount?.durability > 0, maxRounds: randInt(3, 6)
      });
      notableDuels.push(duel);
      if (duel.killed) {
        if (duel.winnerId === fightersA[i].id) casualtiesB++;
        else casualtiesA++;
      }
      injuries = injuries.concat(duel.injuries || []);
    }

    const formA = unitA.formation || this.pickFormation(unitA, unitB.composition, terrainType);
    const formB = unitB.formation || this.pickFormation(unitB, unitA.composition, terrainType);
    unitA.formation = formA; unitB.formation = formB;
    this.updateUnitComposition(unitA); this.updateUnitComposition(unitB);

    let powerA = MilitarySystem.unitPower(unitA, context.terrain) * (this.formationMod(formA, 'melee') || 1);
    let powerB = MilitarySystem.unitPower(unitB, context.terrain) * (this.formationMod(formB, 'melee') || 1);
    if (formA === 'spear_line' && unitB.composition?.cavalry > 2) powerA *= 1.2;
    if (formB === 'spear_line' && unitA.composition?.cavalry > 2) powerB *= 1.2;

    const triggers = [];
    if (context.surprise) triggers.push('ambushed');
    if (context.supplyCut) triggers.push('supply_cut');
    const shockA = this.computeMoraleShock(unitA, triggers);
    const shockB = this.computeMoraleShock(unitB, triggers);
    unitA.morale = clamp(unitA.morale - shockB * 0.15, 5, 100);
    unitB.morale = clamp(unitB.morale - shockA * 0.15, 5, 100);

    const aWins = powerA > powerB * rand(0.9, 1.1);
    const routChance = aWins ? shockB / 100 : shockA / 100;
    let routed = chance(routChance * 0.4);

    return {
      attackerWins: aWins, casualtiesA, casualtiesB, injuries, notableDuels,
      moraleShock: Math.max(shockA, shockB), routChance, routed,
      formations: { a: formA, b: formB }, powerA, powerB
    };
  },

  runPhasedBattle(attackerUnits, defenderUnits, context) {
    const terrainType = context.terrainType || 'plain';
    const phases = [];
    let totalDead = 0, totalInjuries = [], notableDuels = [], rout = false;
    const allAtk = attackerUnits.flatMap(u => unitMembers(u));
    const allDef = defenderUnits.flatMap(u => unitMembers(u));

    phases.push({ name: 'scout', text: context.scoutIntel ? 'หน่วยลาดตระเวนส่งข้อมูลศัตรู' : 'เริ่มสำรวจสนาม' });

    for (const u of attackerUnits) this.updateUnitComposition(u);
    for (const u of defenderUnits) this.updateUnitComposition(u);
    const strat = context.strategy || 'direct_assault';
    for (const u of attackerUnits) u.formation = this.pickFormation(u, defenderUnits[0]?.composition, terrainType, strat);
    for (const u of defenderUnits) u.formation = this.pickFormation(u, attackerUnits[0]?.composition, terrainType, 'defensive');

    if (attackerUnits[0] && defenderUnits[0]) {
      const sk = this.resolveSkirmish(attackerUnits[0], defenderUnits[0], {
        terrain: context.terrain, terrainType, surprise: context.kind === 'ambush',
        supplyCut: context.supplyCut, stakes: context.kind || 'battle'
      });
      phases.push({ name: 'skirmish', text: `ปะทะก่อนหลัก — ${sk.formations.a} vs ${sk.formations.b}`, data: sk });
      notableDuels = notableDuels.concat(sk.notableDuels || []);
      totalInjuries = totalInjuries.concat(sk.injuries || []);
      if (sk.routed) rout = true;
    }

    let atkPower = 0, defPower = 0;
    for (const u of attackerUnits) atkPower += MilitarySystem.unitPower(u, context.terrain) * this.formationMod(u.formation, 'melee');
    for (const u of defenderUnits) defPower += MilitarySystem.unitPower(u, context.terrain) * this.formationMod(u.formation, 'melee');
    defPower += context.defenseBonus || 0;
    atkPower *= (context._terrainAtk || 1) * rand(0.88, 1.12);
    defPower *= (context._terrainDef || 1) * rand(0.88, 1.12);

    const attackerWins = atkPower > defPower;
    phases.push({ name: 'main_clash', text: `ศึกใหญ่ — พลัง ${fmt(atkPower, 0)} vs ${fmt(defPower, 0)}`, attackerWins });

    const loserRate = attackerWins ? 0.12 : 0.22;
    const winnerRate = attackerWins ? 0.22 : 0.12;
    const applyLoss = (units, rate, won) => {
      let dead = 0, fled = 0;
      for (const u of units) {
        const sampled = this.sampleFighters(u, Math.min(6, unitMembers(u).length));
        for (const m of sampled) {
          if (chance(rate)) {
            if (chance(0.55)) {
              NeedSystem.kill(m, 'ตายในสนามรบ'); dead++;
            } else if (chance(0.4)) {
              this.applyInjury(m, pick(['minor_cut', 'deep_cut', 'arrow_wound', 'concussion']), randInt(2, 5));
            } else {
              m.unitId = null; u.memberIds = u.memberIds.filter(id => id !== m.id);
              m.profession = 'refugee'; fled++;
            }
          } else if (!won) {
            m.memory.survivedBattles = (m.memory.survivedBattles || 0) + 1;
          }
        }
        u.morale = clamp(u.morale + (won ? 8 : -15), 5, 100);
      }
      return { dead, fled };
    };

    const atkResult = applyLoss(attackerUnits, attackerWins ? winnerRate : loserRate, attackerWins);
    const defResult = applyLoss(defenderUnits, attackerWins ? loserRate : winnerRate, !attackerWins);
    totalDead = atkResult.dead + defResult.dead;
    phases.push({ name: 'break', text: rout ? 'แนวแตก — ทัพเสียขวัญ' : 'ฝ่ายแพ้เริ่มถอย' });

    let pursuitLosses = 0;
    if (typeof CampaignWarfareSystem !== 'undefined') {
      if (!attackerWins) {
        const pr = CampaignWarfareSystem.handleBattleRetreat(attackerUnits, defenderUnits, true, context);
        pursuitLosses = pr.pursuitLosses || 0;
      } else if (context.kind !== 'raid') {
        const pr = CampaignWarfareSystem.handleBattleRetreat(defenderUnits, attackerUnits, false, context);
        pursuitLosses = pr.pursuitLosses || 0;
      }
    }
    totalDead += pursuitLosses;
    phases.push({ name: 'pursuit', text: pursuitLosses ? `ไล่ตาม — สูญเสีย ${pursuitLosses}` : 'ไม่มีการไล่ตาม' });
    phases.push({ name: 'aftermath', text: `เสียชีวิตรวม ${totalDead}` });

    const report = this.createBattleReport(attackerUnits, defenderUnits, context, {
      phases, attackerWins, atkPower, defPower, atkResult, defResult, totalDead, pursuitLosses, notableDuels
    });

    return { attackerWins, atkPower, defPower, atkResult, defResult, totalDead, pursuitLosses, battleReport: report, phases };
  },

  createBattleReport(attackerUnits, defenderUnits, context, data) {
    if (!world.battleReports) world.battleReports = [];
    const atkLead = attackerUnits[0] ? getAgent(attackerUnits[0].leaderId) : null;
    const defLead = defenderUnits[0] ? getAgent(defenderUnits[0].leaderId) : null;
    const loc = context.settlementId ? getSettlement(context.settlementId) : null;
    const terrain = context.terrainType || loc?.terrain || 'plain';
    let summary = '';
    const formA = attackerUnits[0]?.formation || 'loose';
    const formB = defenderUnits[0]?.formation || 'defensive';
    if (data.attackerWins) {
      summary = `กอง${atkLead ? atkLead.name.split(' ')[0] : 'บุก'} เปิดศึกบน${terrain === 'plain' ? 'ที่ราบ' : terrain} ด้วยแนว${formA} `;
      if (formB === 'spear_line') summary += 'ปะทะแนวหอกของศัตรู ';
      summary += `ฝ่ายบุกได้ชัย เสียชีวิต ${data.totalDead} — ${data.phases.map(p => p.name).join('→')}`;
    } else {
      summary = `การป้องกันที่${context.label || loc?.name || 'สนามรบ'} สำเร็จ แนว${formB} ต้าน${formA} ได้ เสียชีวิต ${data.totalDead}`;
    }
    const report = {
      id: uid(), day: world.day, locationId: context.settlementId || null, terrain,
      attackers: attackerUnits.map(u => u.id), defenders: defenderUnits.map(u => u.id),
      commanders: [atkLead?.id, defLead?.id].filter(x => x),
      formations: { attack: formA, defend: formB },
      phases: data.phases, casualties: data.totalDead,
      injuries: data.notableDuels?.flatMap(d => d.injuries || []).length || 0,
      notableDuels: (data.notableDuels || []).slice(-5).map(d => d.notableLog),
      commanderFates: [], pursuitLosses: data.pursuitLosses || 0,
      summaryText: summary, winner: data.attackerWins ? 'attacker' : 'defender'
    };
    world.battleReports.push(report);
    if (world.battleReports.length > MAX_BATTLE_REPORTS) world.battleReports.shift();
    if (data.totalDead >= 6 || ((attackerUnits[0] && defenderUnits[0]) && unitMembers(attackerUnits[0]).length + unitMembers(defenderUnits[0]).length >= 10)) {
      Chronicle.add({
        category: 'war', importance: data.totalDead >= 12 ? 4 : 3,
        title: `⚔ รายงานศึก: ${context.label || loc?.name || 'สนามรบ'}`,
        description: summary,
        agents: report.commanders, settlements: context.settlementId ? [context.settlementId] : []
      });
    }
    return report;
  },

  checkLegendaryWeapon(item, agent, deed) {
    if (!item || !agent) return;
    if (!world.legendaryWeapons) world.legendaryWeapons = [];
    if (item.kills < 5 && item.fame < 8 && item.quality !== 'masterwork') return;
    if (world.legendaryWeapons.some(lw => lw.itemId === item.id)) return;
    if (!chance(0.08 + item.kills * 0.01)) return;
    const names = ['ดาบแห่ง', 'หอกแห่ง', 'ขวานแห่ง', 'ธนูแห่ง'];
    const leg = {
      id: uid(), itemId: item.id, name: `${pick(names)}${agent.name.split(' ')[0]}`,
      originDay: world.day, deed: deed || 'battle', fame: item.fame + item.kills,
      wielderHistory: [{ agentId: agent.id, day: world.day }]
    };
    item.fame = (item.fame || 0) + 10;
    world.legendaryWeapons.push(leg);
    Chronicle.add({ category: 'legend', importance: 4, title: `⚔ ${leg.name}`, description: `อาวุธของ${agent.name} กลายเป็นตำนาน`, agents: [agent.id] });
  },

  rankings() {
    const alive = world.agents.filter(a => a.alive);
    return {
      duelists: alive.filter(a => (a.duelRecord?.wins || 0) > 0).sort((a, b) => (b.duelRecord?.wins || 0) - (a.duelRecord?.wins || 0)).slice(0, 10),
      deadliest: alive.filter(a => (a.duelRecord?.kills || 0) > 0).sort((a, b) => (b.duelRecord?.kills || 0) - (a.duelRecord?.kills || 0)).slice(0, 10),
      scarred: alive.filter(a => a.injuries?.some(i => i.permanent || i.type === 'scar')).slice(0, 10),
      legendaryWeapons: (world.legendaryWeapons || []).slice().sort((a, b) => b.fame - a.fame).slice(0, 8),
      famousBattles: (world.battleReports || []).slice(-8).reverse(),
      brokenUnits: world.units.filter(u => unitMembers(u).length && (u.morale < 30 || u.retreating)).slice(0, 10)
    };
  },

  initWorld() {
    if (!world.battleReports) world.battleReports = [];
    if (!world.legendaryWeapons) world.legendaryWeapons = [];
    for (const a of world.agents) this.ensureAgent(a);
    for (const u of world.units) { this.updateUnitComposition(u); if (!u.formation) u.formation = 'loose'; }
  }
};

/* ═══════════ Phase 18.2: Large Scale Text Battlefield ═══════════ */

const BATTLEFIELD_W = 7;
const BATTLEFIELD_H = 5;
const LARGE_BATTLE_MIN_TOTAL = 80;
const LARGE_BATTLE_MIN_SIDE = 40;
const MAX_LARGE_BATTLE_SAMPLES = 40;
const MAX_LARGE_BATTLE_REPORTS = 100;
const LARGE_BATTLE_TICKS = 8;
const LARGE_FORMATIONS = ['loose', 'shield_wall', 'spear_line', 'skirmish', 'charge', 'hold_position', 'advance', 'flank_left', 'flank_right', 'defensive', 'reserve', 'retreat', 'rout'];

function defaultFormationStats() {
  return { battles: 0, wins: 0, charges: 0, volleys: 0, holds: 0, routs: 0, flankIntercepts: 0 };
}

const LargeBattlefieldSystem = {
  initWorld() {
    if (!world.largeBattleRecords) world.largeBattleRecords = [];
    if (!world.activeBattlefields) world.activeBattlefields = [];
    if (!world.battleReports) world.battleReports = [];
    for (const u of world.units) {
      if (!u.formationStats) u.formationStats = defaultFormationStats();
      if (!u.battleHistory) u.battleHistory = [];
    }
    this.cleanupStaleBattlefields();
  },

  cleanupStaleBattlefields() {
    if (!world.activeBattlefields) return;
    world.activeBattlefields = world.activeBattlefields.filter(bf => {
      if (bf.resolved) return false;
      for (const bu of Object.values(bf.unitStates || {})) {
        if (getUnit(bu.originalUnitId)) return true;
      }
      return false;
    });
  },

  isLargeBattle(attackerUnits, defenderUnits) {
    const atk = sum(attackerUnits, u => unitMembers(u).length);
    const def = sum(defenderUnits, u => unitMembers(u).length);
    return atk + def >= LARGE_BATTLE_MIN_TOTAL || atk >= LARGE_BATTLE_MIN_SIDE || def >= LARGE_BATTLE_MIN_SIDE;
  },

  sectorAt(bf, x, y) {
    return bf.sectors.find(s => s.x === x && s.y === y);
  },

  adjacentSectors(bf, x, y) {
    const out = [];
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const s = this.sectorAt(bf, x + dx, y + dy);
      if (s) out.push(s);
    }
    return out;
  },

  createSectors(terrainType, isSiege) {
    const sectors = [];
    const rowBase = {
      plain: ['plain', 'plain', 'plain', 'hill', 'forest'],
      forest: ['forest', 'forest', 'plain', 'hill', 'marsh'],
      hill: ['hill', 'plain', 'hill', 'forest', 'plain'],
      marsh: ['marsh', 'plain', 'marsh', 'forest', 'plain'],
      road: ['road', 'plain', 'road', 'hill', 'plain']
    };
    const rows = rowBase[terrainType] || rowBase.plain;
    for (let y = 0; y < BATTLEFIELD_H; y++) {
      for (let x = 0; x < BATTLEFIELD_W; x++) {
        let terr = rows[y % rows.length];
        if (isSiege) {
          if (y === 0 && x >= 2 && x <= 4) terr = x === 3 ? 'gate' : 'wall';
          if (y === 1 && x === 3) terr = 'settlement';
        }
        if (!isSiege && x === 1 && y === 2) terr = 'river';
        sectors.push({
          x, y, terrain: terr,
          elevation: terr === 'hill' ? 0.45 : terr === 'wall' ? 0.55 : 0,
          cover: terr === 'forest' ? 0.55 : terr === 'wall' ? 0.75 : terr === 'settlement' ? 0.6 : 0.12,
          mud: terr === 'marsh' ? 0.65 : 0,
          control: null, unitIds: [],
          arrowExposure: ['plain', 'road'].includes(terr) ? 1 : terr === 'forest' ? 0.55 : 0.85,
          cavalryLane: ['plain', 'road'].includes(terr) ? 1.25 : terr === 'forest' ? 0.45 : terr === 'marsh' ? 0.25 : 0.75,
          chokePoint: ['river', 'wall', 'gate', 'settlement'].includes(terr),
          danger: terr === 'marsh' ? 0.35 : 0.1
        });
      }
    }
    return sectors;
  },

  sectorCapacity(sector) {
    if (!sector) return 20;
    const t = sector.terrain;
    if (sector.chokePoint || t === 'gate') return 12;
    if (t === 'river' || t === 'marsh') return 14;
    if (t === 'forest') return 18;
    if (t === 'wall' || t === 'settlement') return 10;
    return 28;
  },

  formationWidth(formation) {
    const w = {
      shield_wall: 1.35, spear_line: 1.25, skirmish: 0.85, charge: 0.9, loose: 1,
      hold_position: 1.1, advance: 1, flank_left: 0.75, flank_right: 0.75,
      defensive: 1.15, reserve: 0.6, retreat: 0.7, rout: 0.4
    };
    return w[formation] || 1;
  },

  frontage(bu, sector) {
    const cap = this.sectorCapacity(sector) * (sector.chokePoint ? 0.65 : 1);
    const terrainMod = sector.terrain === 'plain' || sector.terrain === 'road' ? 1.1 : sector.chokePoint ? 0.55 : 0.85;
    return Math.floor(Math.min(bu.aliveCount, cap * this.formationWidth(bu.formation) * terrainMod));
  },

  largeFormationMod(formation, role) {
    const m = {
      shield_wall: { def: 1.28, arrow: 0.62, spd: 0.72, flank: 1.35 },
      spear_line: { def: 1.18, cav: 1.42, close: 0.82, chargeRes: 1.35 },
      skirmish: { rng: 1.22, spd: 1.15, cav: 0.78, def: 0.88 },
      charge: { atk: 1.38, fat: 1.45, def: 0.82 },
      hold_position: { def: 1.15, mor: 1.1, spd: 0.8 },
      advance: { atk: 1.08, spd: 1.05 },
      flank_left: { atk: 1.12, flank: 1.2 },
      flank_right: { atk: 1.12, flank: 1.2 },
      defensive: { def: 1.2, mor: 1.15 },
      reserve: { mor: 1.25, def: 1.05 },
      retreat: { cas: 0.68, mor: 0.9 },
      rout: { cas: 1.5, mor: 0.4, def: 0.35 },
      loose: { atk: 1, def: 1 }
    }[formation] || { atk: 1, def: 1 };
    if (role === 'archer' || role === 'ranged') return m.rng || m.atk || 1;
    if (role === 'cavalry') return m.cav || m.atk || 1;
    if (role === 'defense') return m.def || 1;
    return m.atk || m.def || 1;
  },

  averageRolePower(bu) {
    const c = bu.composition;
    const total = Math.max(1, bu.aliveCount);
    let p = 0;
    p += (c.spearmen || 0) * 1.15 + (c.swordsmen || 0) * 1.05 + (c.shieldmen || 0) * 1.1;
    p += (c.archers || 0) * 0.85 + (c.cavalry || 0) * 1.35 + (c.veterans || 0) * 1.2;
    p += (c.engineers || 0) * 0.9 + (c.scouts || 0) * 0.75 + (c.militia || 0) * 0.65;
    p += (c.heroes || 0) * 1.5;
    return (p / total) * (0.85 + bu.morale / 200);
  },

  createBattleUnit(unit, side, context) {
    const members = unitMembers(unit);
    if (typeof TextCombatCore !== 'undefined') TextCombatCore.updateUnitComposition(unit);
    const comp = Object.assign(defaultUnitComposition(), unit.composition || {});
    comp.heroes = members.filter(m => (m.fame || 0) >= 12 || m.notable).length;
    const cmd = getAgent(unit.leaderId);
    const ammo = Math.floor((unit.supply?.arrows || 10) + comp.archers * 3);
    return {
      id: uid(),
      originalUnitId: unit.id,
      side,
      factionId: unit.factionId,
      name: unit.name,
      members: members.map(m => m.id),
      size: members.length,
      aliveCount: members.length,
      woundedCount: 0,
      routedCount: 0,
      capturedCount: 0,
      commanderId: unit.leaderId,
      position: { x: 0, y: 0 },
      targetPosition: null,
      facing: side === 'attacker' ? 'east' : 'west',
      formation: unit.formation || 'loose',
      order: side === 'attacker' ? 'advance' : 'hold_position',
      morale: unit.morale || 65,
      cohesion: unit.cohesion || 70,
      fatigue: unit.fatigue || 0,
      supply: unit.supply?.food || 10,
      ammo,
      frontage: 0,
      depth: 1,
      speed: 1,
      engagedWith: [],
      reserveState: unit.formation === 'reserve' ? 'waiting' : 'front',
      flankThreat: { left: 0, right: 0, rear: 0, surrounded: false },
      lastShockReason: null,
      composition: comp,
      notableEvents: []
    };
  },

  pickFormation(unit, enemyComp, terrainType, strategy, side) {
    if (typeof TextCombatCore !== 'undefined') {
      return TextCombatCore.pickFormation(unit, enemyComp, terrainType, strategy);
    }
    const c = unit.composition || defaultUnitComposition();
    if (side === 'defender') {
      if (c.spearmen > c.cavalry) return 'spear_line';
      if (c.shieldmen > 2) return 'shield_wall';
      return 'defensive';
    }
    if (c.cavalry > c.spearmen && ['plain', 'road'].includes(terrainType)) return 'charge';
    if (c.archers > c.swordsmen) return 'skirmish';
    return 'advance';
  },

  deployUnits(bf, atkUnits, defUnits, context) {
    const isSiege = context.isSiege || false;
    let ax = 1, ay = 2;
    for (let i = 0; i < atkUnits.length; i++) {
      const u = atkUnits[i];
      const bu = bf.unitStates['a' + u.id];
      if (!bu) continue;
      const row = i % 3, col = Math.floor(i / 3);
      bu.position = { x: Math.min(BATTLEFIELD_W - 2, 1 + col), y: clamp(1 + row, 0, BATTLEFIELD_H - 1) };
      if (i === atkUnits.length - 1 && atkUnits.length > 2) {
        bu.position = { x: 1, y: 4 };
        bu.formation = 'reserve';
        bu.reserveState = 'waiting';
      }
      if (bu.composition.cavalry > 2 && col === 0) bu.position.y = 0;
      this.placeUnitOnSector(bf, bu);
      bu.formation = this.pickFormation(u, defUnits[0]?.composition, bf.terrainType, context.strategy, 'attacker');
    }
    for (let i = 0; i < defUnits.length; i++) {
      const u = defUnits[i];
      const bu = bf.unitStates['d' + u.id];
      if (!bu) continue;
      const row = i % 3, col = Math.floor(i / 3);
      bu.position = { x: Math.max(1, BATTLEFIELD_W - 2 - col), y: clamp(1 + row, 0, BATTLEFIELD_H - 1) };
      if (i === defUnits.length - 1 && defUnits.length > 2) {
        bu.position = { x: BATTLEFIELD_W - 2, y: 4 };
        bu.formation = 'reserve';
        bu.reserveState = 'waiting';
      }
      if (isSiege && i === 0) bu.position = { x: BATTLEFIELD_W - 2, y: 2 };
      this.placeUnitOnSector(bf, bu);
      bu.formation = this.pickFormation(u, atkUnits[0]?.composition, bf.terrainType, 'defensive', 'defender');
    }
  },

  placeUnitOnSector(bf, bu) {
    for (const s of bf.sectors) s.unitIds = s.unitIds.filter(id => id !== bu.id);
    const s = this.sectorAt(bf, bu.position.x, bu.position.y);
    if (!s) return;
    s.unitIds.push(bu.id);
    s.control = bu.factionId;
    bu.frontage = this.frontage(bu, s);
    bu.depth = Math.ceil(bu.aliveCount / Math.max(1, bu.frontage));
  },

  battleUnits(bf) {
    return Object.values(bf.unitStates).filter(bu => bu.aliveCount > 0 && bu.formation !== 'rout');
  },

  getBU(bf, id) {
    return bf.unitStates[id] || Object.values(bf.unitStates).find(b => b.id === id);
  },

  resolveVolley(bf, shooter, target, sector, context) {
    if (!shooter || !target || shooter.ammo <= 0) return null;
    const archers = shooter.composition.archers || 0;
    if (archers < 1) return null;
    const dist = Math.abs(shooter.position.x - target.position.x) + Math.abs(shooter.position.y - target.position.y);
    if (dist > 3 || dist < 1) return null;
    const s = this.sectorAt(bf, shooter.position.x, shooter.position.y);
    const ts = this.sectorAt(bf, target.position.x, target.position.y);
    let accuracy = 0.35 + archers * 0.02 + (s?.elevation || 0) * 0.2;
    if (bf.visibility < 0.7) accuracy *= 0.85;
    if (target.formation === 'charge') accuracy *= 0.7;
    let shieldReduction = target.formation === 'shield_wall' ? 0.45 : (target.composition.shieldmen || 0) * 0.03;
    shieldReduction = clamp(shieldReduction, 0, 0.55);
    const coverReduction = (ts?.cover || 0) * 0.35;
    const arrowsFired = Math.min(shooter.ammo, Math.floor(archers * rand(2, 5)));
    shooter.ammo -= arrowsFired;
    const hitRate = clamp(accuracy - shieldReduction - coverReduction, 0.08, 0.65);
    const casualties = Math.floor(arrowsFired * hitRate * rand(0.15, 0.35));
    const wounded = Math.floor(casualties * 0.6);
    const moraleShock = clamp(casualties * 0.8 + (casualties > 5 ? 6 : 0), 0, 18);
    target.aliveCount = Math.max(0, target.aliveCount - casualties);
    target.woundedCount += wounded;
    target.morale = clamp(target.morale - moraleShock, 0, 100);
    target.cohesion = clamp(target.cohesion - casualties * 0.4, 5, 100);
    shooter.fatigue += 3;
    if (casualties > 3) shooter.notableEvents.push(`ยิงธนูสร้างความเสียหาย ${casualties}`);
    return { shooterUnitId: shooter.id, targetUnitId: target.id, arrowsFired, accuracy, shieldReduction, coverReduction, casualties, wounded, moraleShock, ammoUsed: arrowsFired };
  },

  resolveCavalryCharge(cavalry, target, sector, context) {
    const cavCount = cavalry.composition.cavalry || Math.floor(cavalry.aliveCount * 0.3);
    if (cavCount < 2 || cavalry.formation !== 'charge') return null;
    const lane = sector?.cavalryLane || 1;
    if (lane < 0.4) {
      cavalry.notableEvents.push('ทหารม้าติดหนูบน terrain');
      cavalry.morale -= 8;
      cavalry.cohesion -= 10;
      return { failed: true, reason: 'bad_terrain' };
    }
    const cmd = getAgent(cavalry.commanderId);
    const chargePower = cavCount * lane * (cavalry.morale / 70) * (cmd?.skills?.tactics || 3) * 0.15 * rand(0.85, 1.15);
    const spearMod = target.formation === 'spear_line' ? 1.35 : 0.7;
    const defense = (target.composition.spearmen || 0) * spearMod * (target.cohesion / 80) * (target.morale / 70) * 0.12;
    const chargeWins = chargePower > defense * rand(0.9, 1.1);
    let casualties = 0, moraleShock = 0, cohesionDamage = 0;
    if (chargeWins) {
      casualties = Math.floor(cavCount * rand(0.08, 0.2) + chargePower * 0.15);
      const targetCas = Math.floor(chargePower * rand(0.2, 0.45));
      target.aliveCount = Math.max(0, target.aliveCount - targetCas);
      moraleShock = clamp(12 + targetCas * 0.5, 8, 28);
      cohesionDamage = clamp(targetCas * 0.6, 5, 35);
      target.morale -= moraleShock;
      target.cohesion -= cohesionDamage;
      target.lastShockReason = 'cavalry_charge';
      cavalry.notableEvents.push('ชาร์จทหารม้าสำเร็จ');
      if (target.formation === 'spear_line' && target.cohesion < 40) {
        target.formation = 'loose';
        target.notableEvents.push('แนวหอกแตก');
      }
    } else {
      const cavCas = Math.floor(cavCount * rand(0.15, 0.35));
      cavalry.aliveCount = Math.max(0, cavalry.aliveCount - cavCas);
      cavalry.morale -= 12;
      cavalry.cohesion -= 15;
      cavalry.formation = 'loose';
      cavalry.notableEvents.push('ชาร์จล้มเหลว — ม้าหลายตัวล้ม');
      target.notableEvents.push('ตั้งรับหอกหยุดทหารม้า');
    }
    cavalry.fatigue += 18;
    return { chargePower, defense, chargeWins, casualties, moraleShock, cohesionDamage };
  },

  resolveUnitEngagement(unitA, unitB, sector, context) {
    const engagedA = this.frontage(unitA, sector);
    const engagedB = this.frontage(unitB, sector);
    const engaged = Math.min(engagedA, engagedB, unitA.aliveCount, unitB.aliveCount);
    if (engaged < 1) return null;

    const roleA = unitA.composition.cavalry > unitA.composition.spearmen ? 'cavalry' : 'melee';
    const roleB = unitB.composition.cavalry > unitB.composition.spearmen ? 'cavalry' : 'melee';
    const terrModA = sector.terrain === 'hill' && unitA.side === 'defender' ? 1.12 : 1;
    const terrModB = sector.terrain === 'hill' && unitB.side === 'defender' ? 1.12 : 1;

    const scoreA = engaged * this.averageRolePower(unitA)
      * this.largeFormationMod(unitA.formation, roleA)
      * (unitA.morale / 70) * (unitA.cohesion / 80) * terrModA
      * (1 + (unitA.flankThreat.surrounded ? -0.2 : 0))
      * rand(0.88, 1.12);
    const scoreB = engaged * this.averageRolePower(unitB)
      * this.largeFormationMod(unitB.formation, roleB)
      * (unitB.morale / 70) * (unitB.cohesion / 80) * terrModB
      * (1 + (unitB.flankThreat.surrounded ? -0.2 : 0))
      * rand(0.88, 1.12);

    const total = scoreA + scoreB;
    const ratioA = total > 0 ? scoreA / total : 0.5;
    const casA = Math.floor(engaged * (1 - ratioA) * rand(0.12, 0.28));
    const casB = Math.floor(engaged * ratioA * rand(0.12, 0.28));
    const woundA = Math.floor(casA * 0.55);
    const woundB = Math.floor(casB * 0.55);
    const shockA = clamp(casA * 0.7, 0, 15);
    const shockB = clamp(casB * 0.7, 0, 15);

    unitA.aliveCount = Math.max(0, unitA.aliveCount - casA);
    unitB.aliveCount = Math.max(0, unitB.aliveCount - casB);
    unitA.woundedCount += woundA;
    unitB.woundedCount += woundB;
    unitA.morale = clamp(unitA.morale - shockA, 0, 100);
    unitB.morale = clamp(unitB.morale - shockB, 0, 100);
    unitA.cohesion = clamp(unitA.cohesion - casA * 0.35, 5, 100);
    unitB.cohesion = clamp(unitB.cohesion - casB * 0.35, 5, 100);
    unitA.fatigue += 6;
    unitB.fatigue += 6;
    unitA.engagedWith.push(unitB.id);
    unitB.engagedWith.push(unitA.id);

    const moments = [];
    if (casA > 4 || casB > 4) moments.push(`ปะทะที่(${sector.x},${sector.y}) สูญเสีย ${casA + casB}`);

    return {
      casualtiesA: casA, casualtiesB: casB, woundedA: woundA, woundedB: woundB,
      moraleShockA: shockA, moraleShockB: shockB,
      cohesionDamageA: casA * 0.35, cohesionDamageB: casB * 0.35,
      fatigueGainA: 6, fatigueGainB: 6, notableMoments: moments
    };
  },

  computeFlankThreat(bf, bu) {
    const threat = { left: 0, right: 0, rear: 0, surrounded: false };
    const enemies = this.battleUnits(bf).filter(u => u.side !== bu.side && u.aliveCount > 0);
    for (const e of enemies) {
      const dx = e.position.x - bu.position.x;
      const dy = e.position.y - bu.position.y;
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist > 2) continue;
      if (bu.side === 'attacker') {
        if (dy < 0) threat.left += e.aliveCount * 0.02;
        if (dy > 0) threat.right += e.aliveCount * 0.02;
        if (dx < 0) threat.rear += e.aliveCount * 0.03;
      } else {
        if (dy < 0) threat.right += e.aliveCount * 0.02;
        if (dy > 0) threat.left += e.aliveCount * 0.02;
        if (dx > 0) threat.rear += e.aliveCount * 0.03;
      }
    }
    threat.surrounded = threat.rear > 0.15 && (threat.left > 0.1 || threat.right > 0.1);
    bu.flankThreat = threat;
    if (threat.surrounded) {
      bu.morale = clamp(bu.morale - 8, 0, 100);
      bu.cohesion = clamp(bu.cohesion - 6, 5, 100);
    }
    return threat;
  },

  checkReserveTriggers(bf, bu) {
    if (bu.reserveState !== 'waiting') return false;
    const frontAllies = this.battleUnits(bf).filter(u => u.side === bu.side && u.reserveState === 'front');
    const lowMorale = frontAllies.some(u => u.morale < 40);
    const flank = frontAllies.some(u => u.flankThreat.left > 0.12 || u.flankThreat.right > 0.12);
    const cavThreat = this.battleUnits(bf).some(u => u.side !== bu.side && u.formation === 'charge' && u.aliveCount > 3);
    return lowMorale || flank || cavThreat;
  },

  deployReserve(bf, bu, targetBU) {
    bu.reserveState = 'committed';
    bu.formation = bu.composition.cavalry > 2 ? 'charge' : 'advance';
    if (targetBU) {
      bu.position = { ...targetBU.position };
      bu.position.y = clamp(bu.position.y + (bu.side === 'attacker' ? 1 : -1), 0, BATTLEFIELD_H - 1);
    }
    bu.morale = clamp(bu.morale + 6, 0, 100);
    bu.notableEvents.push('กองหนุนเข้าสนาม');
    for (const u of this.battleUnits(bf).filter(x => x.side === bu.side && x.id !== bu.id)) {
      u.morale = clamp(u.morale + 3, 0, 100);
    }
    return true;
  },

  applyMoraleNetwork(bf, event) {
    for (const bu of this.battleUnits(bf)) {
      const nearby = this.battleUnits(bf).filter(u => {
        const dist = Math.abs(u.position.x - bu.position.x) + Math.abs(u.position.y - bu.position.y);
        return dist <= 2;
      });
      let delta = 0;
      for (const n of nearby) {
        if (n.side === bu.side) {
          if (n.formation === 'rout') delta -= 6;
          if (n.reserveState === 'committed' && n.notableEvents.some(e => e.includes('หนุน'))) delta += 2;
        } else {
          if (n.formation === 'rout') delta += 3;
          if (n.lastShockReason === 'cavalry_charge') delta -= 4;
        }
      }
      if (event === 'commander_died') delta -= bu.side === event.side ? 15 : 4;
      bu.morale = clamp(bu.morale + delta, 0, 100);
      if (bu.morale < 20 && bu.cohesion < 35 && bu.formation !== 'retreat') {
        if (chance(0.35)) { bu.formation = 'rout'; bu.lastShockReason = 'morale_collapse'; }
        else if (chance(0.25)) bu.formation = 'retreat';
      }
    }
  },

  sampleNamedAgents(bf, totalMen) {
    const limit = totalMen >= 200 ? randInt(20, 40) : totalMen >= 120 ? randInt(12, 30) : randInt(8, 20);
    const picks = new Map();
    const add = (a, reason) => {
      if (!a || !a.alive || picks.size >= limit) return;
      if (!picks.has(a.id)) picks.set(a.id, { agent: a, reason });
    };
    for (const bu of Object.values(bf.unitStates)) {
      const cmd = getAgent(bu.commanderId);
      if (cmd) add(cmd, 'commander');
      for (const mid of bu.members) {
        const m = getAgent(mid);
        if (!m || !m.alive) continue;
        if ((m.fame || 0) >= 10) add(m, 'famous');
        if ((m.memory?.survivedBattles || 0) >= 2) add(m, 'veteran');
        if ((m.motives?.revenge || 0) > 25) add(m, 'revenge');
        if (world.legendaryWeapons?.some(lw => lw.wielderHistory?.some(w => w.agentId === m.id))) add(m, 'legendary');
      }
    }
    const pool = [];
    for (const bu of Object.values(bf.unitStates)) {
      for (const mid of bu.members) {
        const m = getAgent(mid);
        if (m?.alive && !picks.has(m.id)) pool.push(m);
      }
    }
    while (picks.size < limit && pool.length) add(pick(pool), 'soldier');
    return [...picks.values()];
  },

  runSampledEvents(bf, samples, context) {
    const events = [];
    for (let i = 0; i < samples.length - 1 && events.length < 8; i += 2) {
      const a = samples[i]?.agent, b = samples[i + 1]?.agent;
      if (!a || !b || a.factionId === b.factionId) continue;
      if (typeof TextCombatCore === 'undefined') continue;
      const duel = TextCombatCore.resolveDuel(a, b, {
        terrainType: bf.terrainType, rangeBand: 'melee', stakes: 'battle', maxRounds: randInt(3, 5)
      });
      events.push({ type: 'duel', log: duel.notableLog, winnerId: duel.winnerId });
      if (duel.killed && typeof AgentMemorySystem !== 'undefined') {
        AgentMemorySystem.recordPersonalEvent(getAgent(duel.winnerId), 'killed_enemy', 'สังหารศัตรูในสนามรบ', b.name, 3, { agents: [b.id] });
      }
    }
    return events;
  },

  runBattleTick(bf, phaseName, context) {
    const log = [];
    const engagedPairs = new Set();

    for (const bu of this.battleUnits(bf)) {
      this.computeFlankThreat(bf, bu);
      if (bu.reserveState === 'waiting' && this.checkReserveTriggers(bf, bu)) {
        const target = this.battleUnits(bf).find(u => u.side === bu.side && u.reserveState === 'front' && u.morale < 45);
        this.deployReserve(bf, bu, target);
        log.push(`${bu.name} กองหนุนเข้าปิดปีก`);
      }
    }

    if (phaseName === 'ranged' || phaseName === 'skirmish') {
      for (const bu of this.battleUnits(bf).filter(u => (u.composition.archers || 0) > 0 && u.ammo > 0)) {
        const enemies = this.battleUnits(bf).filter(e => e.side !== bu.side);
        if (!enemies.length) continue;
        const target = pick(enemies);
        const sector = this.sectorAt(bf, bu.position.x, bu.position.y);
        const vol = this.resolveVolley(bf, bu, target, sector, context);
        if (vol && vol.casualties > 0) log.push(`ธนู${bu.name} → ${target.name} (${vol.casualties} ตาย)`);
      }
    }

    if (phaseName === 'advance' || phaseName === 'main_clash') {
      for (const bu of this.battleUnits(bf).filter(u => u.side === 'attacker' && u.formation !== 'reserve' && u.formation !== 'rout')) {
        if (bu.position.x < BATTLEFIELD_W - 3) bu.position.x++;
        this.placeUnitOnSector(bf, bu);
      }
    }

    if (phaseName === 'main_clash' || phaseName === 'breakthrough') {
      for (const bu of this.battleUnits(bf)) {
        if (bu.formation === 'charge' && bu.composition.cavalry > 1) {
          const enemies = this.battleUnits(bf).filter(e => e.side !== bu.side && Math.abs(e.position.x - bu.position.x) <= 1);
          for (const tgt of enemies.slice(0, 1)) {
            const sector = this.sectorAt(bf, bu.position.x, bu.position.y);
            const ch = this.resolveCavalryCharge(bu, tgt, sector, context);
            if (ch) log.push(ch.chargeWins ? `ทหารม้า${bu.name} ชาร์จสำเร็จ` : `ชาร์จ${bu.name} ล้มเหลว`);
          }
        }
      }
      for (const bu of this.battleUnits(bf)) {
        const sector = this.sectorAt(bf, bu.position.x, bu.position.y);
        const enemies = this.battleUnits(bf).filter(e => e.side !== bu.side
          && Math.abs(e.position.x - bu.position.x) + Math.abs(e.position.y - bu.position.y) <= 1);
        for (const e of enemies) {
          const key = [Math.min(bu.id, e.id), Math.max(bu.id, e.id)].join('-');
          if (engagedPairs.has(key)) continue;
          engagedPairs.add(key);
          const res = this.resolveUnitEngagement(bu, e, sector, context);
          if (res && (res.casualtiesA + res.casualtiesB) > 0) {
            log.push(`ปะทะ ${bu.name} vs ${e.name}`);
          }
        }
      }
    }

    if (phaseName === 'morale' || phaseName === 'breakthrough') {
      this.applyMoraleNetwork(bf, context._moraleEvent || '');
      for (const bu of this.battleUnits(bf)) {
        if (bu.morale < 25 && bu.cohesion < 30 && chance(0.4)) {
          bu.formation = 'rout';
          bu.lastShockReason = 'morale_collapse';
          log.push(`${bu.name} แตกพ่าย!`);
        }
      }
    }

    if (phaseName === 'pursuit') {
      const routers = Object.values(bf.unitStates).filter(u => u.formation === 'rout');
      const pursuers = this.battleUnits(bf).filter(u => u.composition.cavalry > 0 && u.formation !== 'rout');
      for (const r of routers) {
        const p = pursuers.find(x => x.side !== r.side);
        if (!p) continue;
        const loss = Math.floor(r.aliveCount * (r.formation === 'retreat' ? 0.08 : 0.18) * rand(0.8, 1.2));
        r.aliveCount = Math.max(0, r.aliveCount - loss);
        r.routedCount += loss;
        log.push(`ไล่ตาม${r.name} สูญเสีย ${loss}`);
      }
    }

    return log;
  },

  syncCasualtiesToWorld(bf, attackerUnits, defenderUnits, attackerWins) {
    let totalDead = 0, totalFled = 0;
    const apply = (units, prefix) => {
      for (const u of units) {
        const bu = bf.unitStates[prefix + u.id];
        if (!bu) continue;
        const members = unitMembers(u);
        const lost = members.length - bu.aliveCount;
        if (lost <= 0) continue;
        const toProcess = Math.min(lost, members.length);
        const shuffled = members.slice().sort(() => Math.random() - 0.5);
        for (let i = 0; i < toProcess; i++) {
          const m = shuffled[i];
          if (!m) continue;
          if (chance(0.55)) {
            NeedSystem.kill(m, 'ตายในสนามรบ');
            totalDead++;
          } else if (chance(0.35) && typeof TextCombatCore !== 'undefined') {
            TextCombatCore.applyInjury(m, pick(['minor_cut', 'deep_cut', 'arrow_wound']), randInt(2, 5));
          } else {
            m.unitId = null;
            u.memberIds = u.memberIds.filter(id => id !== m.id);
            m.profession = 'refugee';
            totalFled++;
          }
        }
        u.morale = clamp(bu.morale, 5, 100);
        u.cohesion = clamp(bu.cohesion, 5, 100);
        u.fatigue = clamp(bu.fatigue, 0, 100);
        if (!u.formationStats) u.formationStats = defaultFormationStats();
        u.formationStats.battles++;
        if ((attackerWins && prefix === 'a') || (!attackerWins && prefix === 'd')) u.formationStats.wins++;
        if (bu.formation === 'rout') u.formationStats.routs++;
        u.battleHistory.push({ day: world.day, won: (attackerWins && prefix === 'a') || (!attackerWins && prefix === 'd'), vs: bf.locationName, name: bf.title, large: true });
      }
    };
    apply(attackerUnits, 'a');
    apply(defenderUnits, 'd');
    return { dead: totalDead, fled: totalFled };
  },

  buildThaiSummary(bf, attackerWins, turningPoints) {
    const loc = bf.locationName || 'สนามรบ';
    const terr = { plain: 'ที่ราบ', hill: 'เนินเขา', forest: 'ป่า', marsh: 'หนองน้ำ', road: 'ถนน' }[bf.terrainType] || bf.terrainType;
    const atkCmd = bf.commanders?.attackers?.[0];
    const defCmd = bf.commanders?.defenders?.[0];
    let s = `ศึก${loc}เริ่มขึ้นบน${terr} `;
    const atkForm = Object.values(bf.unitStates).find(u => u.side === 'attacker')?.formation || 'advance';
    const defForm = Object.values(bf.unitStates).find(u => u.side === 'defender')?.formation || 'defensive';
    s += `ฝ่ายบุกตั้งแนว${atkForm} ฝ่ายรับ${defForm} `;
    if (turningPoints.includes('cavalry')) s += 'ทหารม้าชาร์จปะทะแนวหอก ';
    if (turningPoints.includes('reserve')) s += 'กองหนุนเข้าปิดจังหวะ ';
    if (turningPoints.includes('rout')) s += 'ขวัญกำลังใจแตกเป็นการถอยอย่างไร้ระเบียบ ';
    s += attackerWins ? 'ฝ่ายบุกได้ชัย' : 'ฝ่ายรับยึดสนามได้';
    if (atkCmd && bf.commanderFates?.[atkCmd]) s += ` แม่ทัพ${getAgent(atkCmd)?.name?.split(' ')[0] || ''} ${bf.commanderFates[atkCmd]}`;
    return s;
  },

  createLargeBattleReport(bf, context, result) {
    const loc = context.settlementId ? getSettlement(context.settlementId) : null;
    const turningPoints = [];
    if (bf.battleLog.some(l => l.includes('ชาร์จ'))) turningPoints.push('cavalry');
    if (bf.battleLog.some(l => l.includes('หนุน'))) turningPoints.push('reserve');
    if (bf.battleLog.some(l => l.includes('แตกพ่าย'))) turningPoints.push('rout');

    const summaryText = this.buildThaiSummary(bf, result.attackerWins, turningPoints);
    const report = {
      id: uid(), title: bf.title, day: world.day,
      location: loc?.name || context.label || 'สนามรบ',
      locationId: context.settlementId || null,
      armies: { attackers: bf.attackerArmyIds, defenders: bf.defenderArmyIds },
      commanders: bf.commanders,
      terrain: bf.terrainType,
      deployment: bf.deployment,
      phaseSummaries: bf.phaseSummaries,
      casualties: result.totalDead,
      wounded: result.totalWounded,
      routed: result.totalRouted,
      captured: result.totalCaptured,
      notableUnits: result.notableUnits,
      notableAgents: result.notableAgents,
      commanderFates: bf.commanderFates,
      turningPoints,
      moraleCollapseReason: result.moraleCollapseReason,
      pursuitResult: result.pursuitResult,
      strategicOutcome: result.attackerWins ? 'attacker_victory' : 'defender_victory',
      summaryText,
      chronicleText: summaryText,
      large: true,
      gridSnapshot: this.gridSnapshot(bf),
      winner: result.attackerWins ? 'attacker' : 'defender'
    };

    if (!world.battleReports) world.battleReports = [];
    world.battleReports.push(report);
    while (world.battleReports.length > MAX_LARGE_BATTLE_REPORTS) world.battleReports.shift();

    if (!world.largeBattleRecords) world.largeBattleRecords = [];
    world.largeBattleRecords.push({ id: report.id, day: world.day, title: report.title, casualties: report.casualties });
    while (world.largeBattleRecords.length > MAX_LARGE_BATTLE_REPORTS) world.largeBattleRecords.shift();

    if (result.totalDead >= 8 || result.totalMen >= 80) {
      Chronicle.add({
        category: 'war', importance: result.totalDead >= 20 ? 5 : 4,
        title: `⚔ ${report.title}`,
        description: summaryText,
        agents: [...(bf.commanders?.attackers || []), ...(bf.commanders?.defenders || [])],
        settlements: context.settlementId ? [context.settlementId] : []
      });
    }
    bf.battleReport = report;
    return report;
  },

  gridSnapshot(bf) {
    const rows = [];
    for (let y = 0; y < BATTLEFIELD_H; y++) {
      const row = [];
      for (let x = 0; x < BATTLEFIELD_W; x++) {
        const s = this.sectorAt(bf, x, y);
        const units = (s?.unitIds || []).map(id => this.getBU(bf, id)).filter(Boolean);
        if (!units.length) row.push(s?.terrain === 'hill' ? 'HILL' : '—');
        else {
          const u = units[0];
          const tag = u.composition.archers > u.composition.spearmen ? 'ARCH' : u.composition.cavalry > 2 ? 'CAV' : u.composition.spearmen > 2 ? 'SPEAR' : u.formation === 'reserve' ? 'RES' : u.formation === 'rout' ? 'ROUT' : 'CLASH';
          row.push(tag);
        }
      }
      rows.push(row);
    }
    return rows;
  },

  runLargeBattle(attackerUnits, defenderUnits, context) {
    context = context || {};
    const terrainType = context.terrainType || 'plain';
    const loc = context.settlementId ? getSettlement(context.settlementId) : null;
    const isSiege = loc && (loc.type === 'castle' || loc.type === 'fort' || loc.siege);
    const totalMen = sum(attackerUnits, u => unitMembers(u).length) + sum(defenderUnits, u => unitMembers(u).length);

    const bf = {
      id: uid(), day: world.day, locationId: context.settlementId || null,
      locationName: context.label || loc?.name || 'สนามรบ',
      title: `ศึก${context.label || loc?.name || 'ใหญ่'}`,
      terrainType, weather: context.weather || 'clear',
      visibility: context.scoutIntel ? 0.9 : 0.75,
      width: BATTLEFIELD_W, height: BATTLEFIELD_H,
      sectors: this.createSectors(terrainType, isSiege),
      attackerArmyIds: [...new Set(attackerUnits.map(u => u.armyId).filter(Boolean))],
      defenderArmyIds: [...new Set(defenderUnits.map(u => u.armyId).filter(Boolean))],
      unitStates: {},
      battleTime: 0, phase: 'deployment', battleLog: [], phaseSummaries: [],
      commanders: {
        attackers: attackerUnits.map(u => u.leaderId).filter(Boolean),
        defenders: defenderUnits.map(u => u.leaderId).filter(Boolean)
      },
      commanderFates: {},
      deployment: {}, resolved: false, isSiege
    };

    for (const u of attackerUnits) bf.unitStates['a' + u.id] = this.createBattleUnit(u, 'attacker', context);
    for (const u of defenderUnits) bf.unitStates['d' + u.id] = this.createBattleUnit(u, 'defender', context);

    if (context.supplyCut) {
      for (const k of Object.keys(bf.unitStates)) {
        if (bf.unitStates[k].side === 'attacker') bf.unitStates[k].morale -= 8;
      }
    }
    if (isSiege && context.siegeEquipment) {
      const wallPenalty = typeof CampaignWarfareSystem !== 'undefined' ? CampaignWarfareSystem.siegeDefenseBonus(loc, { siegeEquipment: context.siegeEquipment }) : 0;
      context._siegeWallPenalty = wallPenalty;
    }

    this.deployUnits(bf, attackerUnits, defenderUnits, context);
    bf.deployment = this.gridSnapshot(bf);
    bf.phaseSummaries.push({ phase: 'deployment', text: 'วางขบวนทัพเสร็จสิ้น' });

    const phases = ['scout', 'ranged', 'advance', 'main_clash', 'breakthrough', 'morale', 'pursuit', 'aftermath'];
    const ticks = Math.min(LARGE_BATTLE_TICKS, phases.length);
    for (let t = 0; t < ticks; t++) {
      const phase = phases[t];
      bf.phase = phase;
      bf.battleTime++;
      if (phase === 'scout') {
        bf.phaseSummaries.push({ phase, text: context.scoutIntel ? 'หน่วยลาดตระเวนเปิดเผยขบวนศัตรู' : 'สำรวจสนามรบ' });
        if (bf.visibility < 0.8) bf.visibility += 0.05;
      } else {
        const tickLog = this.runBattleTick(bf, phase, context);
        bf.battleLog = bf.battleLog.concat(tickLog);
        if (tickLog.length) bf.phaseSummaries.push({ phase, text: tickLog.slice(0, 2).join(' · ') });
      }
    }

    const samples = this.runSampledEvents(bf, this.sampleNamedAgents(bf, totalMen), context);
    bf.sampledEvents = samples;

    let atkAlive = 0, defAlive = 0, totalWounded = 0, totalRouted = 0;
    for (const bu of Object.values(bf.unitStates)) {
      if (bu.side === 'attacker') atkAlive += bu.aliveCount;
      else defAlive += bu.aliveCount;
      totalWounded += bu.woundedCount;
      totalRouted += bu.routedCount;
      if (bu.formation === 'rout') totalRouted += Math.floor(bu.aliveCount * 0.3);
    }

    const atkPower = atkAlive + sum(attackerUnits, u => MilitarySystem.unitPower(u, context.terrain) * 0.1);
    const defPower = defAlive + (context.defenseBonus || 0) + sum(defenderUnits, u => MilitarySystem.unitPower(u, context.terrain) * 0.1);
    const attackerWins = atkAlive > defAlive * 0.85 && atkPower >= defPower * rand(0.92, 1.05);

    const sync = this.syncCasualtiesToWorld(bf, attackerUnits, defenderUnits, attackerWins);
    let pursuitLosses = 0;
    if (typeof CampaignWarfareSystem !== 'undefined') {
      if (!attackerWins) {
        const pr = CampaignWarfareSystem.handleBattleRetreat(attackerUnits, defenderUnits, true, context);
        pursuitLosses = pr.pursuitLosses || 0;
      } else if (context.kind !== 'raid') {
        const pr = CampaignWarfareSystem.handleBattleRetreat(defenderUnits, attackerUnits, false, context);
        pursuitLosses = pr.pursuitLosses || 0;
      }
    }
    const totalDead = sync.dead + pursuitLosses;

    for (const cid of bf.commanders.attackers.concat(bf.commanders.defenders)) {
      const c = getAgent(cid);
      if (c && !c.alive) bf.commanderFates[cid] = 'เสียชีวิต';
      else if (c && c.injuries?.some(i => !i.healed)) bf.commanderFates[cid] = 'บาดเจ็บ';
    }

    bf.resolved = true;
    const report = this.createLargeBattleReport(bf, context, {
      attackerWins, totalDead, totalWounded, totalRouted, totalCaptured: 0,
      totalMen, notableUnits: Object.values(bf.unitStates).filter(u => u.notableEvents.length).map(u => u.name),
      notableAgents: samples.map(s => s.agent?.id).filter(Boolean),
      moraleCollapseReason: bf.battleLog.find(l => l.includes('แตกพ่าย')) || null,
      pursuitResult: pursuitLosses > 0 ? `ไล่ตามสูญเสีย ${pursuitLosses}` : 'ไม่มีการไล่ตาม'
    });

    world.activeBattlefields = (world.activeBattlefields || []).filter(b => b.id !== bf.id);

    return {
      attackerWins,
      atkPower, defPower,
      atkResult: { dead: sync.dead, fled: sync.fled },
      defResult: { dead: 0, fled: 0 },
      totalDead, pursuitLosses,
      battleReport: report,
      battlefield: bf,
      phases: bf.phaseSummaries,
      large: true
    };
  },

  createTestArmy(settlementId, factionId, size, side) {
    const s = getSettlement(settlementId) || pick(world.settlements);
    const profs = ['spearman', 'archer', 'swordsman', 'cavalry', 'guard'];
    const ids = [];
    for (let i = 0; i < size; i++) {
      const prof = profs[i % profs.length];
      const ag = createAgent({ locationId: s.id, factionId, profession: prof });
      seedSkillForProfession(ag, prof);
      ids.push(ag.id);
    }
    const lead = getAgent(ids[0]);
    const u = createUnit({
      name: `${side === 'atk' ? 'บุก' : 'รับ'} ${size}`, kind: 'field', leaderId: lead.id,
      memberIds: ids, factionId, locationId: s.id, food: size * 2
    });
    return u;
  },

  forceLargeBattle(atkSize, defSize) {
    const ks = world.factions.filter(f => !f.isBandit && world.settlements.some(s => s.factionId === f.id));
    if (ks.length < 2) return null;
    const s = world.settlements.find(x => x.type === 'town' || x.type === 'plain') || world.settlements[0];
    const atk = this.createTestArmy(s.id, ks[0].id, atkSize || 120, 'atk');
    const def = this.createTestArmy(s.id, ks[1].id, defSize || 100, 'def');
    def.formation = 'spear_line';
    atk.formation = 'charge';
    const ctx = { settlementId: s.id, label: s.name, terrainType: s.terrain || 'plain', kind: 'battle' };
    const result = this.runLargeBattle([atk], [def], ctx);
    EventSystem.add('war', `⚔ [Sandbox] ศึกใหญ่ ${s.name}: ${result.totalDead} ตาย — ${result.battleReport?.summaryText?.slice(0, 80) || ''}`);
    return result;
  },

  rankings() {
    const reports = (world.battleReports || []).filter(r => r.large);
    const routed = world.units.filter(u => u.formation === 'rout' || (u.morale || 100) < 25);
    const famous = world.units.filter(u => (u.formationStats?.wins || 0) >= 2 || (u.recentVictories || 0) >= 2);
    const heavy = reports.slice().sort((a, b) => (b.casualties || 0) - (a.casualties || 0)).slice(0, 8);
    const charges = reports.filter(r => r.turningPoints?.includes('cavalry'));
    const heroic = reports.filter(r => r.notableAgents?.length > 2);
    return {
      largeBattles: reports.slice(-10).reverse(),
      formations: Object.entries(
        world.units.reduce((acc, u) => { const f = u.formation || 'loose'; acc[f] = (acc[f] || 0) + 1; return acc; }, {})
      ).map(([f, n]) => ({ formation: f, count: n })).sort((a, b) => b.count - a.count).slice(0, 8),
      battleReports: reports.slice(-8).reverse(),
      famousUnits: famous.slice(0, 10),
      routedUnits: routed.filter(u => unitMembers(u).length).slice(0, 10),
      heavyCasualty: heavy,
      cavalryCharges: charges.slice(-5).reverse(),
      heroicStands: heroic.slice(-5).reverse()
    };
  }
};

/* ═══════════ Phase 18.3: Real Bot Organizations + Warband Movement ═══════════ */

const OrganizationSystem = {
  initWorld() {
    if (!world.organizations) world.organizations = [];
    if (!world.recruitmentOffers) world.recruitmentOffers = [];
    if (!world.musterPoints) world.musterPoints = [];
    if (!world.warbands) world.warbands = [];
    if (!world.headquarters) world.headquarters = [];
    this.migrateLegacyGuilds();
    this.pruneAll();
    for (const a of world.agents) {
      if (!a.memberships) a.memberships = [];
    }
    WarbandSystem.initWorld();
  },

  migrateLegacyGuilds() {
    for (const g of (world.guilds || [])) {
      if (world.organizations.some(o => o._legacyGuildId === g.id)) continue;
      const org = createOrganization({
        name: g.name,
        type: 'merchant_guild',
        founderId: g.members[0] || null,
        leaderId: g.members[0] || null,
        factionId: g.factionId,
        homeSettlementId: g.homeSettlementId,
        createdDay: g.foundedDay || world.day,
        reputation: g.reputation || 50,
        wealth: g.wealth || 0,
        influence: g.influence || 10,
        purpose: 'trade',
        memberIds: g.members.filter(id => { const a = getAgent(id); return a && a.alive; }).slice(),
        _legacyGuildId: g.id
      });
      createHeadquarters({
        organizationId: org.id,
        settlementId: g.homeSettlementId,
        type: 'guild_hall',
        storage: { food: 20, gold: g.wealth * 0.2, weapons: 0 },
        beds: 8,
        recruitmentBonus: 0.15,
        security: 50,
        upkeepCost: 3
      });
      for (const mid of org.memberIds) {
        const a = getAgent(mid);
        if (!a) continue;
        if (!a.memberships) a.memberships = [];
        if (!a.memberships.some(m => m.organizationId === org.id)) {
          a.memberships.push(defaultOrgMembership(org.id, 'merchant', 'member', org.createdDay, { status: 'active', loyalty: 60 }));
        }
      }
    }
  },

  pruneAll() {
    for (const org of world.organizations) {
      org.memberIds = org.memberIds.filter(id => {
        const a = getAgent(id);
        if (!a || !a.alive) return false;
        const mem = (a.memberships || []).find(m => m.organizationId === org.id && ['active', 'probation', 'wounded'].includes(m.status));
        return !!mem;
      });
      org.activeWarbandIds = org.activeWarbandIds.filter(wid => {
        const wb = getWarband(wid);
        return wb && wb.status !== 'disbanding' && warbandMembers(wb).length > 0;
      });
      if (org.history.length > ORG_HISTORY_CAP) org.history = org.history.slice(-ORG_HISTORY_CAP);
    }
    for (const wb of world.warbands) WarbandSystem.syncWarbandSize(wb);
    world.warbands = world.warbands.filter(wb => wb.status !== 'disbanding' || warbandMembers(wb).length > 0);
    world.recruitmentOffers = world.recruitmentOffers.filter(o => o.status !== 'expired' && o.status !== 'cancelled');
  },

  orgLog(org, text) {
    org.history.push({ day: world.day, text });
    if (org.history.length > ORG_HISTORY_CAP) org.history.shift();
  },

  activeMembers(org) {
    return org.memberIds.map(getAgent).filter(a => a && a.alive);
  },

  evaluateJoinOffer(agent, offer) {
    if (!agent || !agent.alive || !offer || offer.status !== 'open') return -999;
    const org = getOrganization(offer.organizationId);
    if (!org) return -999;
    if (agentActiveMemberships(agent).length >= MAX_AGENT_MEMBERSHIPS) return -999;
    const mil = agentMilitaryMembership(agent);
    if (mil && ['royal_army', 'mercenary_company', 'militia_company', 'bandit_gang'].includes(org.type)) return -999;
    const leader = getAgent(org.leaderId);
    const s = getSettlement(offer.settlementId);
    const rewards = offer.rewards || {};
    let needForIncome = agent.stats.hunger < 45 || agent.money < 20 ? 25 : agent.money < 60 ? 12 : 0;
    let safetyNeed = agent.stats.morale < 40 || (s && s.unrest > 50) ? 15 : 0;
    let careerFit = 0;
    if (offer.roleNeeded === 'soldier' && MILITARY_PROFS.has(agent.profession)) careerFit += 20;
    if (offer.roleNeeded === 'trader' && agent.profession === 'trader') careerFit += 25;
    if (offer.type === 'caravan_guard_job' && agent.profession === 'guard') careerFit += 18;
    let relationshipToLeader = 0;
    if (leader && typeof AgentMemorySystem !== 'undefined') {
      const rel = getAgentRelation(agent, leader.id);
      if (rel) relationshipToLeader += rel.loyalty * 0.2 + rel.trust * 0.1 - rel.grudge * 0.15;
    }
    let motiveAlignment = 0;
    if (agent.motives) {
      if (org.type === 'bandit_gang') motiveAlignment += agent.motives.wealth * 0.2 + agent.motives.revenge * 0.1;
      if (org.type === 'merchant_guild') motiveAlignment += agent.motives.trade * 0.25;
      if (org.type === 'militia_company' || org.type === 'town_guard') motiveAlignment += agent.motives.safety * 0.2 + agent.motives.duty * 0.15;
    }
    const rewardValue = (rewards.pay || 0) * 0.4 + (rewards.food || 0) * 0.3;
    let prestige = org.reputation * 0.1;
    let friendsAlreadyJoined = 0;
    for (const mid of offer.acceptedAgentIds) {
      const rel = getAgentRelation(agent, mid);
      if (rel && rel.trust > 40) friendsAlreadyJoined += 8;
    }
    let sharedEnemy = 0;
    if (org.factionId && agent.factionId && org.factionId !== agent.factionId) sharedEnemy -= 20;
    const riskFear = (offer.riskLevel || 0.3) * (1 - (agent.traits?.riskTolerance || 0.5)) * 40;
    let distanceCost = 0;
    if (offer.musterPointId) {
      const mp = getMusterPoint(offer.musterPointId);
      if (mp && agent.locationId !== mp.locationId) {
        const path = findPath(agent.locationId, mp.locationId, true, agent);
        distanceCost = path ? Math.min(30, path.length * 4) : 50;
      }
    }
    let currentJobValue = agent.unitId ? 25 : agent.guildId ? 15 : agent.profession === 'king' ? 80 : 0;
    let loyaltyConflict = 0;
    if (mil && mil.organizationId !== org.id) loyaltyConflict = 30;
    let traumaPenalty = 0;
    if (agent.memory?.personal?.trauma?.length && offer.type === 'bounty_party') traumaPenalty = 10;
    if (agent.memory?.personal?.grudges?.some(g => g.targetId === org.leaderId)) traumaPenalty += 15;
  if (offer.type === 'bandit_invitation' && agent.profession === 'guard') traumaPenalty += 20;
    const joinScore = needForIncome + safetyNeed + careerFit + relationshipToLeader + motiveAlignment +
      rewardValue + prestige + friendsAlreadyJoined + sharedEnemy - riskFear - distanceCost - currentJobValue - loyaltyConflict - traumaPenalty;
    return joinScore;
  },

  postRecruitmentOffer(org, opt) {
    const sid = opt.settlementId || org.homeSettlementId;
    if (!sid) return null;
    const activeHere = world.recruitmentOffers.filter(o => o.settlementId === sid && o.status === 'open').length;
    if (activeHere >= MAX_ACTIVE_OFFERS_PER_SETTLEMENT) return null;
    const mp = createMusterPoint({
      organizationId: org.id,
      settlementId: sid,
      locationId: sid,
      targetDay: world.day + (opt.musterDays || 7),
      foodRequired: (opt.quantityNeeded || 5) * 4,
      equipmentRequired: Math.ceil((opt.quantityNeeded || 5) * 0.3)
    });
    const offer = createRecruitmentOffer({
      organizationId: org.id,
      issuerId: org.leaderId,
      settlementId: sid,
      musterPointId: mp.id,
      type: opt.type || 'open_join',
      roleNeeded: opt.roleNeeded || 'soldier',
      quantityNeeded: opt.quantityNeeded || 5,
      requirements: opt.requirements || {},
      rewards: opt.rewards || { pay: 12, food: 6 },
      riskLevel: opt.riskLevel != null ? opt.riskLevel : 0.35,
      duration: opt.duration || 14,
      expiresDay: world.day + (opt.duration || 14)
    });
    this.orgLog(org, `📢 ประกาศรับสมัคร ${offer.roleNeeded} ที่${getSettlement(sid)?.name || sid}`);
    return offer;
  },

  acceptApplicant(offer, agentId) {
    const agent = getAgent(agentId);
    if (!agent || !agent.alive || !offer || offer.status !== 'open') return false;
    if (offer.acceptedAgentIds.includes(agentId)) return true;
    if (offer.acceptedAgentIds.length >= offer.quantityNeeded) return false;
    const org = getOrganization(offer.organizationId);
    if (!org) return false;
    offer.acceptedAgentIds.push(agentId);
    if (!agent.memberships) agent.memberships = [];
    agent.memberships.push(defaultOrgMembership(org.id, offer.roleNeeded, 'recruit', world.day, {
      status: 'traveling_to_muster',
      reasonJoined: offer.type,
      loyalty: 45 + randInt(0, 15)
    }));
    const mp = getMusterPoint(offer.musterPointId);
    if (mp && !mp.expectedAgentIds.includes(agentId)) mp.expectedAgentIds.push(agentId);
    if (agent.locationId !== mp.locationId) {
      startTravel(agent, mp.locationId, 'muster');
    } else {
      this.arriveAtMuster(agent, mp, org, offer);
    }
    return true;
  },

  arriveAtMuster(agent, mp, org, offer) {
    if (!mp.arrivedAgentIds.includes(agent.id)) mp.arrivedAgentIds.push(agent.id);
    mp.missingAgentIds = mp.missingAgentIds.filter(id => id !== agent.id);
    const mem = (agent.memberships || []).find(m => m.organizationId === org.id);
    if (mem) mem.status = 'active';
    if (!org.memberIds.includes(agent.id)) org.memberIds.push(agent.id);
    agent.unitId = null;
    if (offer && mp.arrivedAgentIds.length >= Math.max(2, Math.floor(offer.quantityNeeded * 0.5))) {
      this.completeMuster(mp, org, offer);
    }
  },

  completeMuster(mp, org, offer) {
    mp.status = 'complete';
    if (offer) offer.status = 'filled';
    const members = mp.arrivedAgentIds.map(getAgent).filter(a => a && a.alive);
    if (!members.length) return null;
    const leader = members.reduce((best, a) => (a.skills.leadership + a.skills.tactics) > (best.skills.leadership + best.skills.tactics) ? a : best, members[0]);
    org.leaderId = org.leaderId || leader.id;
    const wbType = WarbandSystem.orgTypeToWarband(org.type);
    const wb = WarbandSystem.createFromMembers(org, members.map(a => a.id), {
      name: `${org.name} — กอง ${mp.id % 100}`,
      type: wbType,
      locationId: mp.locationId,
      status: 'mustering',
      objective: offer?.type === 'royal_conscription' ? { type: 'join_campaign' } : { type: 'patrol_route', settlementId: mp.settlementId }
    });
    this.orgLog(org, `⚔ รวมพล ${members.length} นาย ที่${getSettlement(mp.settlementId)?.name || ''}`);
    Chronicle.add({ category: 'military', title: `กอง ${wb.name} รวมพลสำเร็จ`, description: `${org.name} รวม ${members.length} นาย`, importance: 3 });
    EventSystem.add('military', `👥 ${org.name} รวมพล ${members.length} นาย → ${wb.name}`);
    if (members.length >= 8) ObserverSystem?.onMajorEvent?.('army_mustered', `${org.name} รวมพล ${members.length} นาย`);
    return wb;
  },

  tickRecruitment() {
    if (world.day % 5 !== 0) return;
    for (const offer of world.recruitmentOffers) {
      if (offer.status !== 'open') continue;
      if (world.day > offer.expiresDay) { offer.status = 'expired'; continue; }
      const agents = agentsAt(offer.settlementId).filter(a => a.alive && !a.unitId && !a.travel);
      const candidates = agents.sort((a, b) => this.evaluateJoinOffer(b, offer) - this.evaluateJoinOffer(a, offer)).slice(0, 8);
      for (const a of candidates) {
        const score = this.evaluateJoinOffer(a, offer);
        if (score < 12) continue;
        if (chance(clamp(score / 80, 0.05, 0.65))) this.acceptApplicant(offer, a.id);
        if (offer.acceptedAgentIds.length >= offer.quantityNeeded) break;
      }
    }
  },

  tickTravelingMembers() {
    for (const offer of world.recruitmentOffers) {
      if (!offer.musterPointId) continue;
      const mp = getMusterPoint(offer.musterPointId);
      if (!mp || mp.status === 'complete') continue;
      for (const aid of offer.acceptedAgentIds) {
        const a = getAgent(aid);
        if (!a || !a.alive) continue;
        const mem = (a.memberships || []).find(m => m.organizationId === offer.organizationId);
        if (!mem || mem.status !== 'traveling_to_muster') continue;
        if (a.travel) {
          const arrived = advanceTravel(a, agentSpeed(a));
          if (arrived && a.locationId === mp.locationId) {
            this.arriveAtMuster(a, mp, getOrganization(offer.organizationId), offer);
          }
        } else if (a.locationId === mp.locationId) {
          this.arriveAtMuster(a, mp, getOrganization(offer.organizationId), offer);
        } else if (!startTravel(a, mp.locationId, 'muster')) {
          mem.status = 'expelled';
          mp.missingAgentIds.push(a.id);
        }
      }
      if (world.day >= mp.targetDay && mp.status === 'pending') {
        const org = getOrganization(mp.organizationId);
        const offer2 = world.recruitmentOffers.find(o => o.musterPointId === mp.id);
        if (mp.arrivedAgentIds.length >= 2) this.completeMuster(mp, org, offer2);
        else if (mp.arrivedAgentIds.length === 0) {
          mp.status = 'failed';
          if (offer2) offer2.status = 'failed';
          if (org) {
            this.orgLog(org, '❌ รวมพลล้มเหลว — ไม่มีคนมา');
            EventSystem.add('military', `📭 ${org.name} รวมพลล้มเหลว — ไม่มีคนมา`);
            Chronicle.add({ category: 'war', title: 'การรวมพลล้มเหลว', description: `${org.name} ไม่มีคนมาตามนัด`, importance: 3 });
          }
        } else {
          mp.targetDay = world.day + 5;
        }
      }
    }
  },

  tickLoyalty() {
    if (world.day % 7 !== 0) return;
    for (const org of world.organizations) {
      for (const aid of org.memberIds) {
        const a = getAgent(aid);
        if (!a || !a.alive) continue;
        const mem = (a.memberships || []).find(m => m.organizationId === org.id && m.status === 'active');
        if (!mem) continue;
        const leader = getAgent(org.leaderId);
        let loyalty = mem.loyalty || 50;
        const paidRecently = mem.lastPaidDay != null && world.day - mem.lastPaidDay < 14;
        const fedRecently = mem.lastFedDay != null && world.day - mem.lastFedDay < 3;
        loyalty += paidRecently ? 3 : -4;
        loyalty += fedRecently ? 2 : -6;
        loyalty += leader ? (getAgentRelation(a, leader.id)?.trust || 0) * 0.05 : -5;
        loyalty -= a.stats.hunger < 35 ? 8 : 0;
        loyalty -= a.stats.morale < 30 ? 5 : 0;
        mem.loyalty = clamp(loyalty, 0, 100);
        if (mem.loyalty < 15 && chance(0.25)) this.desertMember(a, org, mem);
        else if (mem.loyalty < 8 && chance(0.15)) this.mutinyCheck(org, a, mem);
      }
    }
  },

  desertMember(agent, org, mem) {
    if (!mem) {
      const m = (agent.memberships || []).find(x => x.organizationId === org.id);
      if (!m) return;
      mem = m;
    }
    mem.status = 'deserted';
    org.memberIds = org.memberIds.filter(id => id !== agent.id);
    this.orgLog(org, `🏃 ${agent.name} หนีจากกลุ่ม`);
    EventSystem.add('military', `🏃 ${agent.name} หนีจาก ${org.name}`);
    for (const wb of world.warbands.filter(w => w.organizationId === org.id)) {
      wb.memberIds = wb.memberIds.filter(id => id !== agent.id);
      WarbandSystem.syncWarbandSize(wb);
    }
  },

  mutinyCheck(org, agent, mem) {
    const supporters = org.memberIds.map(getAgent).filter(a => a && a.alive && a.id !== agent.id)
      .filter(a => {
        const m = (a.memberships || []).find(x => x.organizationId === org.id);
        return m && m.loyalty < 25;
      });
    if (supporters.length < 2) return;
    this.orgLog(org, `💥 กบฏ! ${agent.name} นำผู้ติดตามปลุกปั่น`);
    Chronicle.add({ category: 'military', title: `กบฏใน ${org.name}`, description: `${agent.name} และผู้ติดตามไม่พอใจผู้นำ`, importance: 3 });
    EventSystem.add('war', `💥 กบฏใน ${org.name}!`);
    if (chance(0.4)) this.splitGroup(org, agent.id);
  },

  splitGroup(parentOrg, newLeaderId) {
    const newLeader = getAgent(newLeaderId);
    if (!newLeader || !newLeader.alive) return null;
    const followers = parentOrg.memberIds.map(getAgent).filter(a => {
      if (!a || !a.alive || a.id === newLeaderId) return false;
      const rel = getAgentRelation(a, newLeaderId);
      return rel && (rel.loyalty + rel.trust) > 50;
    }).slice(0, Math.max(2, Math.floor(parentOrg.memberIds.length * 0.35)));
    const fids = [newLeaderId, ...followers.map(a => a.id)];
    const child = createOrganization({
      name: `${parentOrg.name} (แตกกลุ่ม)`,
      type: parentOrg.type === 'royal_army' ? 'mercenary_company' : parentOrg.type,
      founderId: newLeaderId,
      leaderId: newLeaderId,
      factionId: parentOrg.factionId,
      homeSettlementId: parentOrg.homeSettlementId,
      memberIds: [],
      purpose: 'split'
    });
    for (const id of fids) {
      parentOrg.memberIds = parentOrg.memberIds.filter(x => x !== id);
      if (!child.memberIds.includes(id)) child.memberIds.push(id);
      const a = getAgent(id);
      if (a) {
        const old = (a.memberships || []).find(m => m.organizationId === parentOrg.id);
        if (old) old.status = 'expelled';
        a.memberships.push(defaultOrgMembership(child.id, 'member', id === newLeaderId ? 'leader' : 'member', world.day, { status: 'active', loyalty: 40 }));
      }
    }
    WarbandSystem.createFromMembers(child, fids, { locationId: newLeader.locationId, status: 'mustering' });
    this.orgLog(parentOrg, `⚡ แตกกลุ่ม — ${newLeader.name} แยก ${fids.length} คน`);
    this.orgLog(child, `🆕 ก่อตั้งจากการแตกกลุ่มของ ${parentOrg.name}`);
    Chronicle.add({ category: 'military', title: `กลุ่มแตก: ${child.name}`, description: `แยกจาก ${parentOrg.name}`, importance: 3 });
    return child;
  },

  raiseCallToArms(f, ruler, target) {
    let org = world.organizations.find(o => o.factionId === f.id && o.type === 'royal_army' && o.status === 'active');
    if (!org) {
      org = createOrganization({
        name: `กองทัพหลวง${f.name}`,
        type: 'royal_army',
        founderId: ruler.id,
        leaderId: ruler.id,
        factionId: f.id,
        homeSettlementId: world.settlements.find(s => s.factionId === f.id && (s.type === 'castle' || s.type === 'town'))?.id,
        purpose: 'war',
        reputation: 60,
        wealth: Math.min(f.treasury * 0.2, 300)
      });
      this.orgLog(org, `📯 จัดตั้งกองทัพหลวง`);
      Chronicle.add({ category: 'military', title: `จัดตั้งกองทัพหลวง ${f.name}`, description: `ประกาศระดมพล`, importance: 3 });
    }
    const capital = world.settlements.find(s => s.factionId === f.id && (s.type === 'castle' || s.type === 'town'));
    if (!capital) return null;
    const existing = world.recruitmentOffers.find(o => o.organizationId === org.id && o.status === 'open' && o.type === 'royal_conscription');
    if (existing) return existing;
    return this.postRecruitmentOffer(org, {
      settlementId: capital.id,
      type: 'royal_conscription',
      roleNeeded: 'soldier',
      quantityNeeded: randInt(8, 18),
      rewards: { pay: 15, food: 8 },
      riskLevel: 0.55,
      duration: 12,
      musterDays: 8
    });
  },

  tryAutoFound() {
    if (world.day % 15 !== 0) return;
    if (world.organizations.length > 40) return;
    for (const s of marketSettlements()) {
      if (chance(0.04) && s.unrest > 55) {
        const rebels = agentsAt(s.id).filter(a => a.alive && !a.unitId && a.stats.morale < 45 && !agentMilitaryMembership(a));
        if (rebels.length >= 3) {
          const leader = rebels.reduce((m, a) => a.skills.leadership > m.skills.leadership ? a : m, rebels[0]);
          const org = createOrganization({ name: `กบฏ${s.name}`, type: 'rebel_cell', leaderId: leader.id, founderId: leader.id, homeSettlementId: s.id, memberIds: [], purpose: 'rebellion' });
          this.postRecruitmentOffer(org, { settlementId: s.id, type: 'rebel_recruitment', quantityNeeded: 6, riskLevel: 0.6 });
        }
      }
      if (chance(0.03)) {
        const bandits = agentsAt(s.id).filter(a => a.alive && (a.profession === 'bandit' || a.wantedLevel > 2) && !agentMilitaryMembership(a));
        if (bandits.length >= 2) {
          const leader = bandits[0];
          const org = createOrganization({ name: `โจรแถว${s.name}`, type: 'bandit_gang', leaderId: leader.id, founderId: leader.id, homeSettlementId: s.id, factionId: world.factions.find(f => f.isBandit)?.id, memberIds: [], purpose: 'raid' });
          this.postRecruitmentOffer(org, { settlementId: s.id, type: 'bandit_invitation', quantityNeeded: 5, riskLevel: 0.7, rewards: { pay: 5, food: 10 } });
        }
      }
      const unemployed = agentsAt(s.id).filter(a => a.alive && a.profession === 'unemployed' && a.money < 30 && !agentMilitaryMembership(a));
      if (chance(0.025) && unemployed.length >= 4) {
        const leader = unemployed.reduce((m, a) => a.skills.leadership > m.skills.leadership ? a : m, unemployed[0]);
        const org = createOrganization({ name: `ทหารรับจ้าง${s.name}`, type: 'mercenary_company', leaderId: leader.id, founderId: leader.id, homeSettlementId: s.id, memberIds: [], purpose: 'contract' });
        this.postRecruitmentOffer(org, { settlementId: s.id, type: 'mercenary_hire', quantityNeeded: 6, rewards: { pay: 20, food: 6 } });
      }
    }
  },

  tickDaily() {
    this.tickTravelingMembers();
    this.tickRecruitment();
    this.tickLoyalty();
    this.tryAutoFound();
    this.pruneAll();
    if (world.day % 20 === 0) this.capOrganizations();
  },

  capOrganizations() {
    if (world.organizations.length <= 50) return;
    const weak = world.organizations.filter(o => this.activeMembers(o).length < 2).sort((a, b) => a.reputation - b.reputation);
    for (const o of weak.slice(0, 5)) { o.status = 'disbanded'; this.orgLog(o, 'ยุบกลุ่ม — สมาชิกไม่พอ'); }
  },

  rankings() {
    return {
      organizations: world.organizations.filter(o => o.status === 'active').sort((a, b) => b.reputation - a.reputation).slice(0, 15),
      offers: world.recruitmentOffers.filter(o => o.status === 'open').slice(0, 12),
      warbands: world.warbands.filter(w => warbandMembers(w).length > 0).sort((a, b) => warbandMembers(b).length - warbandMembers(a).length).slice(0, 15),
      mercenaries: world.organizations.filter(o => o.type === 'mercenary_company' && o.status === 'active').slice(0, 8),
      bandits: world.organizations.filter(o => o.type === 'bandit_gang' && o.status === 'active').slice(0, 8)
    };
  }
};

const WarbandSystem = {
  initWorld() {
    for (const wb of world.warbands) this.syncWarbandSize(wb);
    this.cleanupOrphans();
  },

  cleanupOrphans() {
    for (const wb of world.warbands) {
      const members = warbandMembers(wb);
      if (!members.length) { wb.status = 'disbanding'; continue; }
      const leader = getAgent(wb.leaderId);
      if (!leader || !leader.alive || !wb.memberIds.includes(leader.id)) {
        const best = members.reduce((m, a) => (a.skills.leadership + a.skills.tactics) > (m.skills.leadership + m.skills.tactics) ? a : m, members[0]);
        wb.leaderId = best.id;
      }
    }
    world.warbands = world.warbands.filter(wb => wb.status !== 'disbanding' || warbandMembers(wb).length > 0);
  },

  orgTypeToWarband(type) {
    const map = {
      adventurer_party: 'adventurer_party', mercenary_company: 'mercenary_company', militia_company: 'militia',
      royal_army: 'royal_army', merchant_guild: 'caravan_guard', caravan_company: 'caravan_guard',
      bandit_gang: 'bandit_gang', rebel_cell: 'rebel_warband', noble_retinue: 'noble_retinue',
      town_guard: 'militia', bounty_hunter_lodge: 'scout_party'
    };
    return map[type] || 'adventurer_party';
  },

  syncWarbandSize(wb) {
    wb.memberIds = wb.memberIds.filter(id => { const a = getAgent(id); return a && a.alive; });
    wb.size = wb.memberIds.length;
    for (const m of warbandMembers(wb)) {
      m.locationId = wb.locationId;
      if (wb.travel) m.travel = null;
    }
    wb.composition = this.computeComposition(wb);
    return wb.size;
  },

  computeComposition(wb) {
    const members = warbandMembers(wb);
    const comp = defaultUnitComposition();
    for (const m of members) {
      if (m.profession === 'archer' || m.equipment?.ranged) comp.archers++;
      else if (m.profession === 'cavalry' || m.equipment?.mount) comp.cavalry++;
      else if (m.profession === 'spearman') comp.spearmen++;
      else comp.militia++;
    }
    return comp;
  },

  createFromMembers(org, memberIds, opt) {
    opt = opt || {};
    const ids = memberIds.filter(id => { const a = getAgent(id); return a && a.alive; });
    if (!ids.length) return null;
    const leader = getAgent(opt.leaderId) || getAgent(org?.leaderId) || getAgent(ids[0]);
    const wb = createWarband({
      organizationId: org?.id || null,
      factionId: opt.factionId || org?.factionId || leader?.factionId,
      leaderId: leader?.id || ids[0],
      memberIds: ids,
      name: opt.name || `${org?.name || 'กอง'} หมายเลข ${uid() % 900 + 100}`,
      type: opt.type || this.orgTypeToWarband(org?.type),
      locationId: opt.locationId || leader?.locationId,
      status: opt.status || 'marching',
      objective: opt.objective || { type: 'patrol_route' },
      food: opt.food || ids.length * 3,
      gold: opt.gold || 0,
      morale: opt.morale || 65
    });
    this.syncWarbandSize(wb);
    wb.history.push({ day: world.day, text: `ก่อตั้งกอง ${wb.size} นาย` });
    return wb;
  },

  computeSpeed(wb) {
    const members = warbandMembers(wb);
    if (!members.length) return 0;
    let baseSpeed = 1.2;
    const horses = members.filter(m => m.equipment?.mount || m.profession === 'cavalry').length;
    const mountMod = 1 + horses / Math.max(members.length, 1) * 0.35;
    let roadMod = 1;
    if (wb.travel) {
      const t = wb.travel;
      const r = getRoute(t.path[t.seg], t.path[t.seg + 1]);
      if (r) roadMod = 0.7 + r.roadQuality * 0.5;
      const terrain = r?.terrain || 'plain';
      const terrMod = { plain: 1, road: 1.1, forest: 0.82, hill: 0.78, marsh: 0.65, river: 0.7 }[terrain] || 1;
      roadMod *= terrMod;
    }
    const moraleMod = 0.75 + (wb.morale / 200);
    const fatiguePenalty = 1 - clamp(wb.fatigue / 120, 0, 0.35);
    const woundedPenalty = 1 - clamp((wb.woundedCount || 0) / Math.max(members.length, 1) * 0.4, 0, 0.4);
    const supplyLoad = 1 - clamp(members.length / 120, 0, 0.25);
    const leader = getAgent(wb.leaderId);
    const logMod = leader ? 1 + (leader.skills.logistics || 0) * 0.03 : 1;
    return baseSpeed * mountMod * roadMod * moraleMod * fatiguePenalty * woundedPenalty * supplyLoad * logMod;
  },

  startMarch(wb, destId, purpose) {
    if (!destId || wb.locationId === destId) return false;
    const ok = startTravel(wb, destId, purpose || 'march');
    if (ok) {
      wb.destinationId = destId;
      wb.routePath = wb.travel.path.slice();
      wb.status = purpose === 'flee' ? 'fleeing' : purpose === 'pursue' ? 'pursuing' : 'marching';
      wb.objective = { type: purpose || 'travel', targetId: destId };
    }
    return ok;
  },

  tickMovement() {
    for (const wb of world.warbands) {
      const members = warbandMembers(wb);
      if (!members.length) { wb.status = 'disbanding'; continue; }
      wb.lastSeenDay = world.day;
      wb.lastKnownLocation = wb.locationId;
      if (wb.status === 'camping' || wb.status === 'foraging') {
        wb._campDays = (wb._campDays || 0) + 1;
        wb.fatigue = clamp(wb.fatigue - 8, 0, 100);
        continue;
      }
      if (!wb.travel && wb.destinationId && wb.locationId !== wb.destinationId) {
        this.startMarch(wb, wb.destinationId, wb.status === 'fleeing' ? 'flee' : wb.status === 'pursuing' ? 'pursue' : 'march');
      }
      if (wb.travel) {
        const speed = this.computeSpeed(wb);
        const arrived = advanceTravel(wb, speed);
        if (wb.travel) {
          const t = wb.travel;
          wb.currentRouteId = t.seg;
          const r = getRoute(t.path[t.seg], t.path[t.seg + 1]);
          wb.progress = r ? clamp(t.progress / r.distance, 0, 1) : 0;
        } else {
          wb.progress = 0;
          wb.currentRouteId = null;
          wb.destinationId = null;
          for (const m of members) m.locationId = wb.locationId;
          if (wb.status === 'marching') wb.status = 'camping';
        }
        if (arrived) this.onArrive(wb);
      } else {
        this.tickObjective(wb);
      }
    }
  },

  onArrive(wb) {
    const obj = wb.objective || {};
    if (obj.type === 'travel_to_muster' || obj.type === 'join_campaign') wb.status = 'camping';
    else if (obj.type === 'raid_settlement' && obj.targetId) this.tryRaid(wb, getSettlement(obj.targetId));
    else if (obj.type === 'patrol_route') wb.status = 'patrolling';
    else wb.status = 'camping';
  },

  tickObjective(wb) {
    const obj = wb.objective || { type: 'idle' };
    if (wb.status === 'pursuing' && wb.pursueTargetId) {
      const target = getWarband(wb.pursueTargetId);
      if (!target || !warbandMembers(target).length) { wb.status = 'camping'; wb.pursueTargetId = null; return; }
      if (target.locationId === wb.locationId) { this.resolveEncounter(wb, target); return; }
      this.startMarch(wb, target.locationId, 'pursue');
      return;
    }
    if (obj.type === 'patrol_route' && chance(0.08)) {
      const routes = world.routes.filter(r => !r.destroyed && (r.a === wb.locationId || r.b === wb.locationId));
      if (routes.length) {
        const other = routes[0].a === wb.locationId ? routes[0].b : routes[0].a;
        this.startMarch(wb, other, 'patrol');
        wb.status = 'patrolling';
      }
    } else if (obj.type === 'raid_settlement' && obj.targetId) {
      const s = getSettlement(obj.targetId);
      if (s && s.id !== wb.locationId) this.startMarch(wb, s.id, 'raid');
      else if (s) this.tryRaid(wb, s);
    } else if (obj.type === 'flee_to_safety' && obj.targetId) {
      this.startMarch(wb, obj.targetId, 'flee');
    } else if (obj.type === 'escort_caravan' && obj.routeId) {
      wb.status = 'escorting';
    } else if (chance(0.03) && wb.food < warbandMembers(wb).length * 2) {
      wb.status = 'foraging';
      wb.objective = { type: 'forage' };
      const found = randInt(2, 8);
      wb.food += found;
      const s = getSettlement(wb.locationId);
      if (s && s.type !== 'camp') { s.stock.food = Math.max(0, s.stock.food - found); s.prosperity = clamp(s.prosperity - 1, 0, 100); }
    }
  },

  tickSupply() {
    for (const wb of world.warbands) {
      const members = warbandMembers(wb);
      const n = members.length;
      if (!n) continue;
      const horses = members.filter(m => m.equipment?.mount).length;
      const foodNeeded = n * 1.2 + horses * 0.5;
      if (wb.food >= foodNeeded) {
        wb.food -= foodNeeded;
        wb.supplyDays = wb.food / Math.max(foodNeeded, 0.1);
        for (const m of members) {
          const mem = wb.organizationId ? (m.memberships || []).find(x => x.organizationId === wb.organizationId) : null;
          if (mem) mem.lastFedDay = world.day;
        }
      } else {
        wb.food = 0;
        wb.supplyDays = 0;
        wb.morale = clamp(wb.morale - 6, 5, 100);
        wb.cohesion = clamp(wb.cohesion - 4, 5, 100);
        for (const m of members) {
          m.stats.hunger = clamp(m.stats.hunger - 8, 0, 100);
          m.stats.morale = clamp(m.stats.morale - 5, 0, 100);
        }
        if (chance(0.12)) this.desertFromWarband(wb);
        if (wb.morale < 20 && chance(0.08)) {
          wb.status = 'disbanding';
          EventSystem.add('military', `💀 ${wb.name} แตกกองจากอดอาหาร`);
          Chronicle.add({ category: 'war', title: `${wb.name} แตกกอง`, description: 'อดอาหารและทหารหนี', importance: 3 });
        }
      }
      const org = wb.organizationId ? getOrganization(wb.organizationId) : null;
      if (org && org.type === 'mercenary_company' && wb.gold < n * 2) {
        wb.morale = clamp(wb.morale - 3, 5, 100);
        if (chance(0.06)) this.desertFromWarband(wb);
      }
      wb.fatigue = clamp(wb.fatigue + (wb.travel ? 3 : 1), 0, 100);
    }
  },

  desertFromWarband(wb) {
    const members = warbandMembers(wb);
    if (members.length <= 1) return;
    const deserter = pick(members.filter(m => m.id !== wb.leaderId) || members);
    if (!deserter) return;
    wb.memberIds = wb.memberIds.filter(id => id !== deserter.id);
    const org = wb.organizationId ? getOrganization(wb.organizationId) : null;
    if (org) {
      const mem = (deserter.memberships || []).find(m => m.organizationId === org.id);
      if (mem) OrganizationSystem.desertMember(deserter, org, mem);
    }
    this.syncWarbandSize(wb);
  },

  tickEncounters() {
    const buckets = new Map();
    for (const wb of world.warbands) {
      const members = warbandMembers(wb);
      if (!members.length) continue;
      const key = wb.travel ? `r:${wb.travel.path[wb.travel.seg]}-${wb.travel.path[wb.travel.seg + 1]}` : `s:${wb.locationId}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(wb);
    }
    for (const [, group] of buckets) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          if (chance(0.15)) this.resolveEncounter(group[i], group[j]);
        }
      }
    }
  },

  resolveEncounter(a, b) {
    if (!a || !b || a.id === b.id) return;
    const aF = getFaction(a.factionId), bF = getFaction(b.factionId);
    const hostile = (aF && bF && (aF.enemies.includes(bF.id) || bF.enemies.includes(aF.id))) ||
      a.type === 'bandit_gang' || b.type === 'bandit_gang';
    const allied = a.factionId && a.factionId === b.factionId;
    const sizeA = warbandMembers(a).length, sizeB = warbandMembers(b).length;
    const ratio = sizeA / Math.max(sizeB, 1);
    if (allied && chance(0.35)) { this.mergeWarbands(a, b); return; }
    if (!hostile && chance(0.7)) return;
    if (ratio > 1.8 && chance(0.4)) {
      b.status = 'fleeing';
      b.pursueTargetId = null;
      b.objective = { type: 'flee_to_safety', targetId: b.locationId };
      a.status = 'pursuing';
      a.pursueTargetId = b.id;
      return;
    }
    if (sizeA + sizeB < 8) {
      this.resolveSkirmish(a, b);
    } else if (sizeA + sizeB >= 80 || sizeA >= 40 || sizeB >= 40) {
      this.resolveLargeBattle(a, b);
    } else {
      this.resolvePhasedBattle(a, b);
    }
  },

  warbandAsUnits(wb) {
    let u = world.units.find(x => x._warbandId === wb.id);
    if (!u) {
      u = createUnit({
        name: wb.name, kind: wb.type === 'bandit_gang' ? 'warband' : 'field',
        leaderId: wb.leaderId, memberIds: wb.memberIds.slice(),
        factionId: wb.factionId, locationId: wb.locationId, food: wb.food
      });
      u._warbandId = wb.id;
      wb.unitIds = [u.id];
    } else {
      u.memberIds = wb.memberIds.slice();
      u.locationId = wb.locationId;
      u.leaderId = wb.leaderId;
    }
    return [u];
  },

  resolveSkirmish(a, b) {
    const au = this.warbandAsUnits(a), bu = this.warbandAsUnits(b);
  if (typeof TextCombatCore !== 'undefined') TextCombatCore.resolveSkirmish(au[0], bu[0], { settlementId: a.locationId, terrain: 'plain' });
    else MilitarySystem.battle(au, bu, { settlementId: a.locationId, terrain: 'plain', title: `${a.name} vs ${b.name}` });
    this.syncWarbandSize(a); this.syncWarbandSize(b);
    a.history.push({ day: world.day, text: `ปะทะ ${b.name}` });
  },

  resolvePhasedBattle(a, b) {
    const au = this.warbandAsUnits(a), bu = this.warbandAsUnits(b);
    MilitarySystem.battle(au, bu, { settlementId: a.locationId, terrain: 'plain', title: `${a.name} vs ${b.name}` });
    this.syncWarbandSize(a); this.syncWarbandSize(b);
  },

  resolveLargeBattle(a, b) {
    const au = this.warbandAsUnits(a), bu = this.warbandAsUnits(b);
    if (typeof LargeBattlefieldSystem !== 'undefined') {
      LargeBattlefieldSystem.runLargeBattle(au, bu, { settlementId: a.locationId, terrainType: 'plain', title: `${a.name} vs ${b.name}` });
    } else MilitarySystem.battle(au, bu, { settlementId: a.locationId, terrain: 'plain', title: `${a.name} vs ${b.name}` });
    this.syncWarbandSize(a); this.syncWarbandSize(b);
  },

  tryRaid(wb, s) {
    if (!s || s.type === 'camp') return;
    if (typeof SovereigntySystem !== 'undefined') {
      const leader = getAgent(wb.leaderId);
      const faction = getFaction(wb.factionId) || world.factions.find(f => !f.isBandit);
      const u = this.warbandAsUnits(wb)[0];
      const units = u ? [u] : [];
      SovereigntySystem.resolveSettlementCapture(units, faction, leader, s, { warbandId: wb.id, warband: wb });
      this.syncWarbandSize(wb);
      wb.history.push({ day: world.day, text: `โจมตี ${s.name}` });
      return;
    }
    const u = this.warbandAsUnits(wb)[0];
    if (u) MilitarySystem.resolveRaid(u, s);
    this.syncWarbandSize(wb);
    wb.history.push({ day: world.day, text: `ปล้น ${s.name}` });
  },

  mergeWarbands(a, b) {
    if (warbandMembers(a).length + warbandMembers(b).length > 150) return false;
    const cap = MilitarySystem.commandCapacity(getAgent(a.leaderId));
    if (warbandMembers(a).length + warbandMembers(b).length > cap * 3) {
      a.cohesion = clamp(a.cohesion - 10, 10, 100);
    }
    for (const id of b.memberIds) {
      if (!a.memberIds.includes(id)) a.memberIds.push(id);
    }
    const org = a.organizationId ? getOrganization(a.organizationId) : null;
    if (org) {
      for (const id of b.memberIds) if (!org.memberIds.includes(id)) org.memberIds.push(id);
    }
    b.status = 'disbanding';
    b.memberIds = [];
    this.syncWarbandSize(a);
    a.history.push({ day: world.day, text: `รวมกับ ${b.name}` });
    EventSystem.add('military', `🔗 ${a.name} รวมกับ ${b.name}`);
    return true;
  },

  splitWarband(wb, memberIds, opt) {
    opt = opt || {};
    const ids = memberIds.filter(id => wb.memberIds.includes(id) && getAgent(id)?.alive);
    if (!ids.length) return null;
    wb.memberIds = wb.memberIds.filter(id => !ids.includes(id));
    this.syncWarbandSize(wb);
    const org = wb.organizationId ? getOrganization(wb.organizationId) : null;
    const child = this.createFromMembers(org, ids, {
      name: opt.name || `${wb.name} (แยก)`,
      type: wb.type,
      locationId: wb.locationId,
      leaderId: opt.leaderId || ids[0],
      status: opt.status || 'marching',
      objective: opt.objective || { type: 'patrol_route' }
    });
    wb.history.push({ day: world.day, text: `แยกกอง ${ids.length} นาย` });
    return child;
  },

  markerStyle(wb) {
    const n = warbandMembers(wb).length;
    const size = n <= 5 ? 3 : n <= 12 ? 4.5 : n <= 30 ? 6 : n <= 80 ? 8 : n <= 150 ? 10 : 12;
    const colors = {
      royal_army: getFaction(wb.factionId)?.color || '#42a5f5',
      mercenary_company: '#ffd54f', bandit_gang: '#b71c1c', caravan_guard: '#8d6e63',
      militia: '#66bb6a', rebel_warband: '#ff5722', scout_party: '#90caf9', adventurer_party: '#ab47bc',
      noble_retinue: '#7e57c2'
    };
    const color = colors[wb.type] || '#bdbdbd';
    const icon = wb.type === 'mercenary_company' ? '⚔' : wb.type === 'bandit_gang' ? '☠' :
      wb.type === 'caravan_guard' ? '🐪' : wb.type === 'royal_army' ? '🚩' : wb.type === 'scout_party' ? '•' : '⚔';
    return { size, color, icon };
  },

  tickDaily() {
    this.tickMovement();
    this.tickSupply();
    if (world.day % 2 === 0) this.tickEncounters();
    this.cleanupOrphans();
  }
};

/* ═══════════ Phase 18.4B: Guild Sovereignty / City Ownership ═══════════ */

const WARBAND_FOUNDING_REASONS = ['start_caravan', 'protect_trade_route', 'hunt_bandits', 'escort_contract', 'mercenary_work', 'refugee_survival', 'revenge_party', 'deserter_band', 'local_militia', 'bandit_gang', 'guild_detachment', 'noble_retinue'];
const INDEPENDENT_WARBAND_TYPES = ['independent_caravan', 'escort_party', 'bounty_party', 'militia_patrol', 'mercenary_band', 'adventurer_party', 'bandit_gang', 'rebel_warband', 'guild_detachment', 'noble_retinue'];
const REALM_TYPE_MAP = {
  merchant_guild: 'trade_realm', mercenary_company: 'mercenary_realm', bandit_gang: 'outlaw_realm',
  rebel_cell: 'rebel_realm', noble_retinue: 'noble_house', royal_army: 'kingdom',
  militia_company: 'defense_league', caravan_company: 'trade_realm', town_guard: 'defense_league'
};

function defaultSovereignty(org) {
  return {
    status: 'unlanded',
    realmName: org?.name || 'อาณาจักร',
    rulerTitle: 'leader',
    rulerId: org?.leaderId || null,
    capitalSettlementId: null,
    settlementIds: [],
    vassalIds: [],
    laws: {},
    taxPolicy: { rate: 0.1, foodShare: 0.05 },
    levyPolicy: { quotaPerSettlement: 4, callCooldown: 30 },
    legitimacy: 40,
    successionMode: 'appointment'
  };
}

function defaultVassalObligation() {
  return {
    taxRateToOverlord: 0.15,
    levyQuota: 4,
    foodTribute: 5,
    tradeContribution: 0.05,
    defenseDuty: true,
    autonomyLevel: 0.5,
    lastPaidDay: 0,
    missedPayments: 0
  };
}

function defaultVassalRecord(agentId) {
  return {
    agentId,
    settlementIds: [],
    loyaltyToOverlord: 55,
    ambition: 0.4,
    militaryStrength: 0,
    wealth: 0,
    localSupport: 50,
    grievances: [],
    lastTributeDay: 0,
    rebellionRisk: 0.05,
    status: 'loyal'
  };
}

function getSiegeAuthority(id) { return (world.siegeAuthorities || []).find(x => x.id === id); }
function getClaim(id) { return (world.claims || []).find(x => x.id === id); }
function getVassalGrant(id) { return (world.vassalGrants || []).find(x => x.id === id); }
function getCaptureCredit(id) { return (world.captureCredits || []).find(x => x.id === id); }

function getCrownOrganization(factionId) {
  const f = getFaction(factionId);
  if (!f) return null;
  let org = (world.organizations || []).find(o => o._crownFactionId === factionId);
  if (!org) {
    org = createOrganization({
      name: `มงกุฎ${f.name}`,
      type: 'royal_army',
      leaderId: f.rulerId,
      founderId: f.rulerId,
      factionId: f.id,
      purpose: 'governance',
      memberIds: f.rulerId ? [f.rulerId] : [],
      _crownFactionId: f.id
    });
    org.sovereignty = defaultSovereignty(org);
    org.sovereignty.status = 'landed';
    org.sovereignty.rulerTitle = 'king';
    SovereigntySystem.syncOrgSettlements(org);
  }
  return org;
}

const SovereigntySystem = {
  initWorld() {
    if (!world.siegeAuthorities) world.siegeAuthorities = [];
    if (!world.claims) world.claims = [];
    if (!world.captureCredits) world.captureCredits = [];
    if (!world.vassalGrants) world.vassalGrants = [];
    for (const org of (world.organizations || [])) {
      if (!org.sovereignty) org.sovereignty = defaultSovereignty(org);
      if (!org.vassals) org.vassals = [];
      this.syncOrgSettlements(org);
    }
    for (const s of world.settlements) this.migrateSettlementOwnership(s);
    for (const a of world.agents) {
      if (!a.titles) a.titles = [];
      if (!a.grievances) a.grievances = [];
      if (!a.captureCreditIds) a.captureCreditIds = [];
    }
    for (const wb of (world.warbands || [])) {
      if (!wb.foundingReason) wb.foundingReason = wb.organizationId ? 'guild_detachment' : 'local_militia';
    }
  },

  migrateSettlementOwnership(s) {
    if (s.type === 'camp') return;
    if (!s.vassalObligation) s.vassalObligation = defaultVassalObligation();
    if (s.ownerOrganizationId == null && s.factionId) {
      const crown = (world.organizations || []).find(o => o._crownFactionId === s.factionId);
      if (crown) s.ownerOrganizationId = crown.id;
      else if (!s.ownerOrganizationId) {
        const org = getCrownOrganization(s.factionId);
        if (org) s.ownerOrganizationId = org.id;
      }
    }
    if (!s.localLordId && s.governorId) s.localLordId = s.governorId;
    if (!s.taxRecipient && s.ownerOrganizationId) s.taxRecipient = s.ownerOrganizationId;
    if (s.ownerOrganizationId == null && s.type !== 'camp') {
      const org = getCrownOrganization(s.factionId);
      if (org) {
        s.ownerOrganizationId = org.id;
        s.taxRecipient = org.id;
      }
    }
  },

  syncOrgSettlements(org) {
    if (!org.sovereignty) org.sovereignty = defaultSovereignty(org);
    const owned = world.settlements.filter(s => s.ownerOrganizationId === org.id && s.type !== 'camp');
    org.sovereignty.settlementIds = owned.map(s => s.id);
    if (owned.length > 0) {
      org.sovereignty.status = 'landed';
      org.sovereignty.rulerId = org.leaderId;
      const hasCastle = owned.some(s => s.type === 'castle' || s.type === 'fort');
      org.sovereignty.rulerTitle = hasCastle || owned.length > 1 ? 'king' : 'lord';
      org.sovereignty.realmName = org.sovereignty.realmName || org.name;
      if (!org.sovereignty.capitalSettlementId) {
        org.sovereignty.capitalSettlementId = owned.find(s => s.type === 'castle')?.id || owned[0]?.id;
      }
      org.sovereignty.legitimacy = clamp((org.sovereignty.legitimacy || 40) + owned.length * 2, 20, 95);
    }
  },

  canFoundWarband(agent) {
    if (!agent || !agent.alive) return { ok: false, reason: 'dead' };
    if (agent.prisoner || agent.stats.health < 20) return { ok: false, reason: 'incapacitated' };
    const leadership = agent.skills?.leadership || 0;
    const ambition = agent.traits?.ambition || 0;
    if (leadership < 1 && ambition < 0.45) return { ok: false, reason: 'not leader material' };
    const followers = world.agents.filter(a => a.alive && a.id !== agent.id && (a.relationships?.[agent.id] || 0) > 25).length;
    const wealth = agent.stats?.wealth || 0;
    if (wealth < 15 && followers < 1) return { ok: false, reason: 'poor and alone' };
    const mems = agentActiveMemberships(agent);
    const blocked = mems.some(m => {
      const org = getOrganization(m.organizationId);
      return org && ['royal_army', 'town_guard'].includes(org.type) && m.status === 'active';
    });
    if (blocked) return { ok: false, reason: 'bound membership' };
    return { ok: true, leadership, ambition, followers, wealth };
  },

  foundWarbandFromAgent(agent, reason, opt) {
    opt = opt || {};
    const check = this.canFoundWarband(agent);
    if (!check.ok) return null;
    reason = reason || 'local_militia';
    const loc = agent.locationId;
    const typeMap = {
      start_caravan: 'independent_caravan', protect_trade_route: 'escort_party', hunt_bandits: 'bounty_party',
      escort_contract: 'escort_party', mercenary_work: 'mercenary_band', refugee_survival: 'adventurer_party',
      revenge_party: 'adventurer_party', deserter_band: 'bandit_gang', local_militia: 'militia_patrol',
      bandit_gang: 'bandit_gang', guild_detachment: 'guild_detachment', noble_retinue: 'noble_retinue'
    };
    const wbType = typeMap[reason] || 'adventurer_party';
    const followers = world.agents.filter(a => a.alive && !a.unitId && a.locationId === loc && (a.relationships?.[agent.id] || 0) > 20).slice(0, 4);
    const memberIds = [agent.id, ...followers.map(f => f.id)];
    const org = opt.organizationId ? getOrganization(opt.organizationId) : null;
    const wb = WarbandSystem.createFromMembers(org, memberIds, {
      name: opt.name || `กองของ${agent.name.split(' ')[0]}`,
      type: wbType === 'independent_caravan' ? 'caravan_guard' : wbType === 'militia_patrol' ? 'militia' : wbType === 'mercenary_band' ? 'mercenary_company' : wbType === 'bandit_gang' ? 'bandit_gang' : 'adventurer_party',
      locationId: loc,
      leaderId: agent.id,
      status: 'marching',
      objective: { type: reason === 'hunt_bandits' ? 'hunt_bandits' : reason === 'start_caravan' ? 'escort_caravan' : 'patrol_route' },
      food: memberIds.length * 3,
      gold: Math.floor(agent.stats?.wealth || 0) * 0.2
    });
    if (wb) {
      wb.foundingReason = reason;
      wb.politicalMode = org ? 'guild_backed' : 'independent';
      if (org && !org.activeWarbandIds.includes(wb.id)) org.activeWarbandIds.push(wb.id);
      EventSystem.add('military', `⚔ ${agent.name} ตั้งกอง ${wb.name} (${reason})`);
      Chronicle.add({ category: 'military', importance: 2, title: `⚔ ก่อตั้งกอง ${wb.name}`, description: `${agent.name} รวม ${memberIds.length} คน`, agents: [agent.id] });
    }
    return wb;
  },

  getWarbandAuthority(wb) {
    if (!wb) return { mode: 'independent', canRaid: true, canSiege: false, canCapture: false, canHoldCity: false, captureOwnerOrgId: null };
    const org = wb.organizationId ? getOrganization(wb.organizationId) : null;
    const leader = getAgent(wb.leaderId);
    const sa = wb.siegeAuthorityId ? getSiegeAuthority(wb.siegeAuthorityId) : null;
    let mode = wb.politicalMode || 'independent';
    if (org) {
      if (org.type === 'royal_army') mode = 'royal_army';
      else if (org.type === 'rebel_cell') mode = 'rebel_claimant';
      else if (sa?.type === 'mercenary_contract') mode = 'mercenary_contract';
      else mode = 'guild_backed';
    }
    if (wb.type === 'bandit_gang' && !org) mode = 'independent';
    const canRaid = true;
    let canSiege = false, canCapture = false, canHoldCity = false, captureOwnerOrgId = null, employerOrgId = null;
    if (mode === 'royal_army' && org) {
      canSiege = canCapture = canHoldCity = true;
      captureOwnerOrgId = org.id;
    } else if (mode === 'guild_backed' && org) {
      const war = world.wars.find(w => !w.endDay && (w.attackerId === org.factionId || w.defenderId === org.factionId));
      const hasGoal = war?.goal === 'capture_settlement' || org.purpose === 'conquest';
      const officer = leader && org.memberIds.includes(leader.id) && (leader.skills?.leadership || 0) >= 2;
      canSiege = !!(sa || hasGoal || officer);
      canCapture = !!(sa || hasGoal);
      canHoldCity = canCapture;
      captureOwnerOrgId = org.id;
    } else if (mode === 'mercenary_contract' && sa) {
      canSiege = canCapture = true;
      canHoldCity = true;
      captureOwnerOrgId = sa.employerOrganizationId || sa.organizationId;
      employerOrgId = captureOwnerOrgId;
    } else if (mode === 'rebel_claimant' && org) {
      const claim = (world.claims || []).find(c => c.organizationId === org.id && c.status === 'active');
      canSiege = canCapture = !!claim;
      canHoldCity = canCapture;
      captureOwnerOrgId = org.id;
    } else if (mode === 'independent' && org?.type === 'bandit_gang' && (org.sovereignty?.status === 'landed' || org._outlawRealm)) {
      canSiege = canCapture = canHoldCity = true;
      captureOwnerOrgId = org.id;
    }
    return { mode, canRaid, canSiege, canCapture, canHoldCity, captureOwnerOrgId, employerOrgId, organizationId: org?.id, siegeAuthority: sa };
  },

  canCaptureSettlement(wb, settlement) {
    if (!wb || !settlement || settlement.type === 'camp') return false;
    const auth = this.getWarbandAuthority(wb);
    if (!auth.canCapture) return false;
    if (auth.siegeAuthority && auth.siegeAuthority.targetSettlementId && auth.siegeAuthority.targetSettlementId !== settlement.id) return false;
    if (auth.siegeAuthority && auth.siegeAuthority.status !== 'active') return false;
  return true;
  },

  createSiegeAuthority(opt) {
    opt = opt || {};
    const sa = {
      id: uid(),
      type: opt.type || 'guild',
      organizationId: opt.organizationId || null,
      employerOrganizationId: opt.employerOrganizationId || null,
      rulerId: opt.rulerId || null,
      warGoalId: opt.warGoalId || null,
      claimStrength: opt.claimStrength || 50,
      authorizedWarbandIds: (opt.authorizedWarbandIds || []).slice(),
      targetSettlementId: opt.targetSettlementId || null,
      createdDay: world.day,
      expiresDay: opt.expiresDay || world.day + 60,
      status: 'active'
    };
    if (!world.siegeAuthorities) world.siegeAuthorities = [];
    world.siegeAuthorities.push(sa);
    for (const wid of sa.authorizedWarbandIds) {
      const wb = getWarband(wid);
      if (wb) wb.siegeAuthorityId = sa.id;
    }
    return sa;
  },

  authorizeWarbandSiege(org, warband, targetSettlementId) {
    if (!org || !warband) return null;
    const sa = this.createSiegeAuthority({
      type: org.type === 'mercenary_company' ? 'mercenary_contract' : 'guild',
      organizationId: org.id,
      employerOrganizationId: org.id,
      rulerId: org.leaderId,
      authorizedWarbandIds: [warband.id],
      targetSettlementId,
      claimStrength: 60 + (org.reputation || 0) * 0.2
    });
    warband.siegeAuthorityId = sa.id;
    warband.politicalMode = 'guild_backed';
    OrganizationSystem.orgLog(org, `อนุมัติให้ ${warband.name} ล้อม${getSettlement(targetSettlementId)?.name || 'เป้าหมาย'}`);
    return sa;
  },

  resolveSettlementCapture(attUnits, attFaction, commander, s, ctx) {
    ctx = ctx || {};
    const wb = ctx.warbandId ? getWarband(ctx.warbandId) : (ctx.warband || null);
    const army = ctx.armyId ? getArmy(ctx.armyId) : null;
    if (wb && !this.canCaptureSettlement(wb, s)) {
      const garrison = s.garrisonUnitId ? getUnit(s.garrisonUnitId) : null;
      const defUnits = garrison ? [garrison] : [];
      let defenseBonus = (s.buildings.includes('Wall') ? 60 : 0) + s.security * 0.5 + (s.type === 'fort' ? 50 : s.type === 'castle' ? 90 : 0);
      const u = WarbandSystem.warbandAsUnits(wb)[0];
      const att = u ? [u] : attUnits;
      const result = MilitarySystem.battle(att, defUnits, {
        defenseBonus, label: s.name, kind: 'capture', settlementId: s.id,
        atkFactionId: attFaction?.id, defFactionId: s.factionId
      });
      if (result.attackerWins) this.handleUnauthorizedVictory(wb, s, commander || getAgent(wb.leaderId), result);
      else EventSystem.add('war', `🛡 ${s.name} ต้าน${wb.name}ไว้ได้`);
      return false;
    }
    if (wb && this.canCaptureSettlement(wb, s)) {
      const captured = MilitarySystem._resolveCaptureBattle(attUnits, attFaction, commander, s);
      if (captured) return this.applyPermanentCapture({ warband: wb, commander, settlement: s, attFaction });
      return false;
    }
    if (army || !wb) {
      const org = attFaction ? getCrownOrganization(attFaction.id) : null;
      if (org && army) {
        const sa = this.createSiegeAuthority({
          type: 'kingdom', organizationId: org.id, rulerId: commander?.id,
          authorizedWarbandIds: [], targetSettlementId: s.id, expiresDay: world.day + 30
        });
      }
      const captured = MilitarySystem._resolveCaptureBattle(attUnits, attFaction, commander, s);
      if (captured && org) return this.applyPermanentCapture({ warband: null, commander, settlement: s, attFaction, ownerOrg: org, army });
      return captured;
    }
    return false;
  },

  handleUnauthorizedVictory(wb, s, commander, battleResult) {
    const leader = commander || getAgent(wb?.leaderId);
    const lootGold = Math.floor((s.treasury || 0) * 0.15);
    s.treasury = Math.max(0, (s.treasury || 0) - lootGold);
    s.stock.food = Math.max(0, (s.stock.food || 0) - randInt(5, 20));
    s.raidedRecently = (s.raidedRecently || 0) + 1;
    s.timesRaided++;
    if (leader) {
      leader.stats.wealth = (leader.stats.wealth || 0) + lootGold;
      addDeed(leader, `ปล้น${s.name} (ไม่มีสิทธิ์ถือครอง)`, 5);
    }
    wb.history.push({ day: world.day, text: `ปล้น${s.name} แล้วถอนตัว — ไม่มีสิทธิ์ถือครอง` });
    EventSystem.add('war', `⚠ ${wb.name} ชนะที่${s.name} แต่ไม่มีสิทธิ์ถือครอง — ปล้นแล้วถอนตัว`);
    Chronicle.add({
      category: 'war', importance: 3,
      title: `⚠ ${wb.name} ปล้น${s.name}`,
      description: 'กองไม่มี siege authority จึงไม่เปลี่ยนเจ้าของถาวร',
      agents: leader ? [leader.id] : [], settlements: [s.id]
    });
    if (leader && chance(0.25)) this.createClaim({
      claimantAgentId: leader.id, settlementId: s.id,
      type: 'conqueror', strength: 35 + (leader.fame || 0) * 0.5,
      reason: 'ยึดได้แต่ไม่ได้รับรางวัล'
    });
    const check = this.canFoundGuildFromWarband(wb);
    if (check.ok && chance(0.15)) this.foundGuildFromWarband(wb);
    else if (chance(0.1) && leader) {
      leader.grievances = leader.grievances || [];
      leader.grievances.push({ day: world.day, type: 'denied_capture', settlementId: s.id, text: `ถูกปฏิเสธสิทธิ์ถือ${s.name}` });
    }
    return false;
  },

  applyPermanentCapture(ctx) {
    const { warband: wb, commander, settlement: s, attFaction, ownerOrg, army } = ctx;
    const auth = wb ? this.getWarbandAuthority(wb) : null;
    let ownerOrgId = ownerOrg?.id || auth?.captureOwnerOrgId;
    let org = ownerOrgId ? getOrganization(ownerOrgId) : null;
    if (!org && attFaction) org = getCrownOrganization(attFaction.id);
    if (!org) return false;
    ownerOrgId = org.id;
    const leader = commander || getAgent(wb?.leaderId) || getAgent(org.leaderId);
    const oldFaction = getFaction(s.factionId);
    if (s.ownerId && getAgent(s.ownerId)) s.pastRulers.push(getAgent(s.ownerId).name);
    s.factionId = org.factionId || attFaction?.id || s.factionId;
    s.ownerOrganizationId = ownerOrgId;
    s.taxRecipient = ownerOrgId;
    s.rulerId = org.leaderId;
    s.governorId = leader?.id || org.leaderId;
    s.localLordId = s.governorId;
    s.captureSourceWarbandId = wb?.id || null;
    s.captureDay = world.day;
    s.lastCapturedDay = world.day;
    s.timesCaptured++;
    s.loyalty = 28;
    s.unrest = clamp((s.unrest || 0) + 12, 0, 100);
    s.vassalObligation = s.vassalObligation || defaultVassalObligation();
    const lootGold = Math.floor((s.treasury || 0) * 0.25);
    s.treasury -= lootGold;
    org.wealth = (org.wealth || 0) + lootGold;
    const garrison = s.garrisonUnitId ? getUnit(s.garrisonUnitId) : null;
    if (garrison) {
      for (const m of unitMembers(garrison)) { m.unitId = null; m.profession = 'unemployed'; }
      world.units = world.units.filter(x => x.id !== garrison.id);
      s.garrisonUnitId = null;
    }
    const credit = this.recordCaptureCredit({
      settlementId: s.id, warbandId: wb?.id, commanderId: leader?.id,
      ownerOrganizationId: ownerOrgId,
      participatingAgentIds: wb ? wb.memberIds.slice() : (army ? army.unitIds.flatMap(uid => unitMembers(getUnit(uid)).map(m => m.id)) : []),
      siegeAuthorityId: wb?.siegeAuthorityId || null
    });
    this.createClaim({
      organizationId: org.id, settlementId: s.id, claimantAgentId: org.leaderId,
      type: 'conqueror', strength: 55, reason: `ยึด${s.name}โดย${org.name}`
    });
    if (leader && leader.id !== org.leaderId) {
      leader.fame = (leader.fame || 0) + 8;
      addDeed(leader, `นำกองยึด${s.name}ให้${org.name}`, 12);
      if (chance(0.35)) this.grantSettlement(org.leaderId, s.id, leader.id, 'capture_reward');
    }
    this.updateOrganizationSovereignty(org);
    EventSystem.add('war', `🏰 ${org.name} ยึด${s.name}ถาวร${leader ? ` — เครดิต ${leader.name}` : ''}`);
    settlementHistory(s, `เป็นของ${org.name} โดย${leader?.name || 'กองทัพ'}`);
    Chronicle.add({
      category: 'war', importance: 5,
      title: `🏰 ${s.name} ตกเป็นของ${org.name}`,
      description: `${leader?.name || org.name} ยึดเมืองให้องค์กร — ไม่ใช่ warband ส่วนตัว`,
      agents: [leader?.id, org.leaderId].filter(Boolean), settlements: [s.id]
    });
    if (oldFaction && !oldFaction.isBandit) checkFactionCollapse(oldFaction);
    const war = oldFaction ? activeWarBetween(org.factionId, oldFaction.id) : null;
    if (war) war.captured.push({ day: world.day, id: s.id, name: s.name, byFactionId: org.factionId, organizationId: org.id });
    if (typeof ObserverSystem !== 'undefined') {
      ObserverSystem.onMajorEvent('city_captured', `${s.name} ของ${org.name}`, { settlements: [s.id], agents: [leader?.id].filter(Boolean) });
    }
    if (typeof AgentMemorySystem !== 'undefined' && leader) AgentMemorySystem.onCityCaptured(s, leader.id, oldFaction?.id);
    if (typeof UIIndexes !== 'undefined') UIIndexes.markDirty();
    return true;
  },

  recordCaptureCredit(opt) {
    const credit = {
      id: uid(),
      settlementId: opt.settlementId,
      day: world.day,
      warbandId: opt.warbandId || null,
      commanderId: opt.commanderId || null,
      participatingAgentIds: (opt.participatingAgentIds || []).slice(),
      ownerOrganizationId: opt.ownerOrganizationId,
      casualties: opt.casualties || 0,
      notableAgents: opt.notableAgents || [],
      siegeAuthorityId: opt.siegeAuthorityId || null
    };
    if (!world.captureCredits) world.captureCredits = [];
    world.captureCredits.push(credit);
    if (world.captureCredits.length > 200) world.captureCredits.shift();
    const cmd = getAgent(opt.commanderId);
    if (cmd) {
      cmd.captureCreditIds = cmd.captureCreditIds || [];
      cmd.captureCreditIds.push(credit.id);
      cmd.fame = (cmd.fame || 0) + 5;
    }
    return credit;
  },

  updateOrganizationSovereignty(org) {
    if (!org) return;
    if (!org.sovereignty) org.sovereignty = defaultSovereignty(org);
    this.syncOrgSettlements(org);
    const owned = org.sovereignty.settlementIds || [];
    if (owned.length === 0) {
      org.sovereignty.status = 'unlanded';
      return;
    }
    org.sovereignty.status = 'landed';
    org.sovereignty.rulerId = org.leaderId;
    const leader = getAgent(org.leaderId);
    const hasCastle = owned.some(id => ['castle', 'fort'].includes(getSettlement(id)?.type));
    const wasUnlanded = org._wasLanded !== true;
    org.sovereignty.rulerTitle = hasCastle || owned.length > 1 ? 'king' : 'lord';
    org.sovereignty.realmType = REALM_TYPE_MAP[org.type] || 'realm';
    if (!org.sovereignty.capitalSettlementId) org.sovereignty.capitalSettlementId = owned.find(id => getSettlement(id)?.type === 'castle') || owned[0];
    if (leader) {
      leader.titles = leader.titles || [];
      const title = org.sovereignty.rulerTitle === 'king' ? `ราชาแห่ง${org.sovereignty.realmName}` : `เจ้าเมือง${org.name}`;
      if (!leader.titles.some(t => t.settlementId || t.orgId === org.id)) {
        leader.titles.push({ day: world.day, title, orgId: org.id, type: org.sovereignty.rulerTitle });
      }
      if (!RULER_PROFS.has(leader.profession)) { leader.profession = 'lord'; leader.rank = 'lord'; }
    }
    if (wasUnlanded && owned.length >= 1) {
      org._wasLanded = true;
      Chronicle.add({
        category: 'legend', importance: 5,
        title: `👑 ${org.name} กลายเป็นรัฐ`,
        description: `${leader?.name || 'ผู้นำ'} ได้รับการเรียกขานเป็น${org.sovereignty.rulerTitle === 'king' ? 'ราชา' : 'เจ้าเมือง'}`,
        agents: [org.leaderId].filter(Boolean), settlements: owned.slice(0, 3)
      });
    }
  },

  grantSettlement(rulerId, settlementId, targetAgentId, reason) {
    const ruler = getAgent(rulerId);
    const target = getAgent(targetAgentId);
    const s = getSettlement(settlementId);
    if (!ruler || !target || !target.alive || !s) return null;
    const org = getOrganization(s.ownerOrganizationId);
    if (!org || org.leaderId !== rulerId) return null;
    const grant = {
      id: uid(),
      settlementId: s.id,
      ownerOrganizationId: org.id,
      overlordId: rulerId,
      grantedToAgentId: targetAgentId,
      grantedDay: world.day,
      title: `เจ้าเมือง${s.name}`,
      taxShare: 0.7,
      levyObligation: defaultVassalObligation().levyQuota,
      autonomy: 0.55,
      loyalty: 60,
      reason: reason || 'grant'
    };
    if (!world.vassalGrants) world.vassalGrants = [];
    world.vassalGrants.push(grant);
    s.governorId = targetAgentId;
    s.localLordId = targetAgentId;
    s.vassalObligation = Object.assign(defaultVassalObligation(), s.vassalObligation, {
      taxRateToOverlord: 0.12,
      autonomyLevel: grant.autonomy,
      lastPaidDay: world.day
    });
    target.titles = target.titles || [];
    target.titles.push({ day: world.day, title: grant.title, settlementId: s.id, orgId: org.id, type: 'vassal_lord' });
    if (!target.memberships) target.memberships = [];
    if (!target.memberships.some(m => m.organizationId === org.id)) {
      target.memberships.push(defaultOrgMembership(org.id, 'lord', 'officer', world.day, { status: 'active', loyalty: 65, reasonJoined: reason }));
    } else {
      const m = target.memberships.find(x => x.organizationId === org.id);
      if (m) { m.role = 'lord'; m.rank = 'officer'; }
    }
    if (!org.vassals) org.vassals = [];
    let vr = org.vassals.find(v => v.agentId === targetAgentId);
    if (!vr) { vr = defaultVassalRecord(targetAgentId); org.vassals.push(vr); }
    vr.settlementIds = [...new Set([...vr.settlementIds, s.id])];
    vr.loyaltyToOverlord = clamp(vr.loyaltyToOverlord + 15, 0, 100);
    vr.status = 'loyal';
    OrganizationSystem.orgLog(org, `มอบ${s.name}ให้${target.name}`);
    Chronicle.add({
      category: 'politics', importance: 4,
      title: `🏛 มอบ${s.name}ให้${target.name}`,
      description: `${ruler.name} แต่งตั้งเจ้าเมืองภายใต้${org.name}`,
      agents: [rulerId, targetAgentId], settlements: [s.id]
    });
    return grant;
  },

  revokeGrant(grantId) {
    const g = getVassalGrant(grantId);
    if (!g) return false;
    const s = getSettlement(g.settlementId);
    const org = getOrganization(g.ownerOrganizationId);
    if (s) { s.governorId = org?.leaderId; s.localLordId = org?.leaderId; }
    g.status = 'revoked';
    g.revokedDay = world.day;
    Chronicle.add({ category: 'politics', importance: 3, title: `📜 เพิกถอน${s?.name}`, description: `ยกเลิกการมอบเมือง`, settlements: [g.settlementId] });
    return true;
  },

  createClaim(opt) {
    const c = {
      id: uid(),
      claimantAgentId: opt.claimantAgentId || null,
      settlementId: opt.settlementId || null,
      organizationId: opt.organizationId || null,
      type: opt.type || 'conqueror',
      strength: opt.strength || 30,
      createdDay: world.day,
      reason: opt.reason || '',
      status: 'active'
    };
    if (!world.claims) world.claims = [];
    world.claims.push(c);
    return c;
  },

  canFoundGuildFromWarband(wb) {
    const n = warbandMembers(wb).length;
    const leader = getAgent(wb?.leaderId);
    if (!wb || !leader || n < 8) return { ok: false, reason: 'too small' };
    if (wb.organizationId && getOrganization(wb.organizationId)?.type !== 'adventurer_party') return { ok: false, reason: 'already guild' };
    const wealth = (wb.gold || 0) + (leader.stats?.wealth || 0);
    if ((leader.skills?.leadership || 0) < 2 && (leader.traits?.ambition || 0) < 0.55) return { ok: false, reason: 'weak leader' };
    if (wealth < 40 && n < 12) return { ok: false, reason: 'poor' };
    return { ok: true, leader, size: n };
  },

  foundGuildFromWarband(wb) {
    const check = this.canFoundGuildFromWarband(wb);
    if (!check.ok) return null;
    const leader = check.leader;
    const typeMap = {
      bandit_gang: 'bandit_gang', caravan_guard: 'caravan_company', mercenary_company: 'mercenary_company',
      militia: 'militia_company', rebel_warband: 'rebel_cell', adventurer_party: 'adventurer_party'
    };
    const orgType = typeMap[wb.type] || 'adventurer_party';
    const org = createOrganization({
      name: `${wb.name} สมาคม`,
      type: orgType,
      founderId: leader.id,
      leaderId: leader.id,
      factionId: wb.factionId,
      homeSettlementId: wb.locationId,
      memberIds: wb.memberIds.slice(),
      wealth: wb.gold || 0,
      foodReserve: wb.food || 0,
      purpose: wb.type === 'bandit_gang' ? 'outlaw' : 'trade'
    });
    wb.organizationId = org.id;
    wb.politicalMode = 'guild_backed';
    if (!org.activeWarbandIds.includes(wb.id)) org.activeWarbandIds.push(wb.id);
    for (const id of wb.memberIds) {
      const a = getAgent(id);
      if (!a) continue;
      if (!a.memberships) a.memberships = [];
      if (!a.memberships.some(m => m.organizationId === org.id)) {
        a.memberships.push(defaultOrgMembership(org.id, id === leader.id ? 'leader' : 'member', id === leader.id ? 'leader' : 'member', world.day));
      }
    }
    createHeadquarters({ organizationId: org.id, settlementId: wb.locationId, type: orgType === 'bandit_gang' ? 'hideout' : 'guild_hall', beds: 6, security: 40, upkeepCost: 2 });
    OrganizationSystem.orgLog(org, `ก่อตั้งจากกอง ${wb.name}`);
    Chronicle.add({ category: 'guild', importance: 4, title: `🏛 ${org.name} ก่อตั้งจากกอง`, description: `${leader.name} รวม ${wb.memberIds.length} คน`, agents: [leader.id] });
    return org;
  },

  convertBanditToOutlawRealm(org) {
    if (!org || org.type !== 'bandit_gang') return false;
    org._outlawRealm = true;
    org.sovereignty = org.sovereignty || defaultSovereignty(org);
    org.sovereignty.realmType = 'outlaw_realm';
    org.purpose = 'outlaw';
    this.updateOrganizationSovereignty(org);
    Chronicle.add({ category: 'rebellion', importance: 4, title: `☠ ${org.name} กลายเป็น Outlaw Realm`, description: 'กลุ่มโจรยกระดับเป็นรัฐนอกกฎหมาย' });
    return true;
  },

  callVassalLevy(org, settlementId) {
    const s = getSettlement(settlementId);
    if (!s || s.ownerOrganizationId !== org.id) return null;
    const lord = getAgent(s.localLordId || s.governorId);
    if (!lord) return null;
    return OrganizationSystem.postRecruitmentOffer(org, {
      settlementId: s.id,
      type: 'militia_call',
      roleNeeded: 'militia',
      quantityNeeded: s.vassalObligation?.levyQuota || 4,
      issuerId: lord.id
    });
  },

  tickVassalObligations() {
    for (const org of (world.organizations || [])) {
      if (!org.sovereignty || org.sovereignty.status !== 'landed') continue;
      for (const sid of org.sovereignty.settlementIds || []) {
        const s = getSettlement(sid);
        if (!s || !s.vassalObligation) continue;
        const ob = s.vassalObligation;
        if (world.day - (ob.lastPaidDay || 0) < 10) continue;
        const tax = Math.floor((s.treasury || 0) * ob.taxRateToOverlord);
        const food = Math.min(ob.foodTribute, s.stock?.food || 0);
        const canPay = s.prosperity > 25 && s.unrest < 70;
        if (canPay && tax > 0) {
          s.treasury -= tax;
          org.wealth = (org.wealth || 0) + tax;
          s.stock.food -= food;
          org.foodReserve = (org.foodReserve || 0) + food;
          ob.lastPaidDay = world.day;
          ob.missedPayments = 0;
        } else {
          ob.missedPayments = (ob.missedPayments || 0) + 1;
          s.unrest = clamp(s.unrest + 3, 0, 100);
        }
      }
    }
  },

  tickVassalLoyalty() {
    for (const org of (world.organizations || [])) {
      if (!org.vassals?.length) continue;
      const overlord = getAgent(org.leaderId);
      for (const v of org.vassals) {
        const agent = getAgent(v.agentId);
        if (!agent || !agent.alive) { v.status = 'inactive'; continue; }
        let loyalty = v.loyaltyToOverlord || 50;
        const rel = overlord ? (agent.relationships?.[overlord.id] || 0) : 0;
        loyalty += rel * 0.05;
        for (const sid of v.settlementIds) {
          const s = getSettlement(sid);
          if (s?.vassalObligation?.missedPayments > 2) loyalty -= 5;
          if (s?.unrest > 60) loyalty -= 3;
        }
        if ((agent.grievances || []).some(g => g.type === 'denied_capture' || g.type === 'high_tribute')) loyalty -= 8;
        if ((agent.traits?.ambition || 0) > 0.75) loyalty -= 4;
        v.loyaltyToOverlord = clamp(loyalty, 0, 100);
        v.rebellionRisk = clamp((100 - v.loyaltyToOverlord) / 100 + (agent.traits?.ambition || 0) * 0.3, 0, 1);
        if (v.loyaltyToOverlord < 25) v.status = 'defiant';
        else if (v.loyaltyToOverlord < 45) v.status = 'wavering';
        else v.status = 'loyal';
        if (v.rebellionRisk > 0.65 && chance(0.08)) this.triggerVassalRebellion(org, v);
      }
    }
  },

  triggerVassalRebellion(org, vassalRec) {
    const agent = getAgent(vassalRec.agentId);
    if (!agent) return;
    vassalRec.status = 'rebelling';
    agent.grievances = agent.grievances || [];
    agent.grievances.push({ day: world.day, type: 'rebellion', text: `กบฏต่อ${org.name}` });
    for (const sid of vassalRec.settlementIds) {
      const s = getSettlement(sid);
      if (s) { s.unrest = clamp(s.unrest + 25, 0, 100); s.loyalty = clamp(s.loyalty - 20, 0, 100); }
    }
    EventSystem.add('politics', `🔥 ${agent.name} กบฏต่อ${org.name}!`);
    Chronicle.add({ category: 'rebellion', importance: 4, title: `🔥 Vassal กบฏ`, description: `${agent.name} ปฏิเสธอำนาจ${org.name}`, agents: [agent.id] });
  },

  tickDaily() {
    if (world.day % 10 === 0) this.tickVassalObligations();
    if (world.day % 10 === 3) this.tickVassalLoyalty();
    if (world.day % 15 === 0) this.tickWarbandFoundingAI();
    if (world.day % 20 === 0) this.tickGuildLeaderAI();
    for (const sa of (world.siegeAuthorities || [])) {
      if (sa.expiresDay < world.day) sa.status = 'expired';
    }
  },

  tickWarbandFoundingAI() {
    const candidates = world.agents.filter(a => a.alive && !a.unitId && (a.skills?.leadership || 0) >= 2 && !(world.warbands || []).some(w => w.leaderId === a.id));
    if (!candidates.length || chance(0.7)) return;
    const a = pick(candidates);
    const check = this.canFoundWarband(a);
    if (!check.ok) return;
    const reason = a.profession === 'bandit' ? 'bandit_gang' : a.profession === 'trader' ? 'start_caravan' : pick(['hunt_bandits', 'local_militia', 'mercenary_work']);
    if (chance(0.12)) this.foundWarbandFromAgent(a, reason);
  },

  tickGuildLeaderAI() {
    for (const org of (world.organizations || []).filter(o => o.sovereignty?.status === 'landed')) {
      const leader = getAgent(org.leaderId);
      if (!leader) continue;
      const credits = (world.captureCredits || []).filter(c => c.ownerOrganizationId === org.id && world.day - c.day < 30);
      for (const cr of credits) {
        const cmd = getAgent(cr.commanderId);
        if (!cmd || cmd.id === leader.id) continue;
        const granted = (world.vassalGrants || []).some(g => g.grantedToAgentId === cmd.id && g.settlementId === cr.settlementId);
        if (!granted && chance(0.25)) this.grantSettlement(leader.id, cr.settlementId, cmd.id, 'capture_reward');
        else if (!granted && chance(0.15)) {
          cmd.grievances = cmd.grievances || [];
          cmd.grievances.push({ day: world.day, type: 'denied_reward', settlementId: cr.settlementId, text: `ไม่ได้รับ${getSettlement(cr.settlementId)?.name}` });
        }
      }
    }
  },

  validateNoGhostOwners() {
    for (const s of world.settlements) {
      if (s.type === 'camp') continue;
      if (!s.ownerOrganizationId) this.migrateSettlementOwnership(s);
      if (!s.ownerOrganizationId) {
        const org = getCrownOrganization(s.factionId);
        if (org) { s.ownerOrganizationId = org.id; s.taxRecipient = org.id; }
      }
    }
    for (const wb of (world.warbands || [])) {
      const owned = world.settlements.filter(s => s.captureSourceWarbandId === wb.id && s.ownerOrganizationId == null);
      for (const s of owned) this.migrateSettlementOwnership(s);
    }
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
    TextCombatCore.ensureAgent(a);
    const dc = a.derivedCombat;
    const ds = this.deriveStats(a);
    const morale = 0.5 + a.stats.morale / 150;
    const health = 0.55 + a.stats.health / 220;
    const fatigue = clamp(1 - (100 - a.stats.energy) / 200, 0.5, 1);
    let p = (dc.meleeAttack + dc.meleeDefense * 0.6 + dc.armor * 0.4 + dc.rangedAttack * 0.3) * morale * health * fatigue;
    p += ds.attack * 0.15;
    const mh = a.equipment?.mainHand?.type;
    const rg = a.equipment?.ranged?.type;
    const mt = a.equipment?.mount?.type;
    if (terrain === 'open' && mt) p *= 1.2;
    if (terrain === 'close' && mh === 'sword') p *= 1.15;
    if (terrain === 'range' && rg === 'bow') p *= 1.25;
    if (terrain === 'forest' && mt) p *= 0.82;
    if (terrain === 'hill' && rg === 'bow') p *= 1.18;
    if (terrain === 'marsh') p *= 0.9;
    return Number.isFinite(p) ? p : (ds.attack || 1);
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

  // Phase 18.1 delegates
  recalcDerivedCombat(a) { return TextCombatCore.recalcDerivedCombat(a); },
  getWeaponSkill(a, w) { return TextCombatCore.getWeaponSkill(a, w); },
  getArmorPenalty(a) { return TextCombatCore.getArmorPenalty(a); },
  getInjuryPenalty(a) { return TextCombatCore.getInjuryPenalty(a); },
  resolveDuel(a, d, ctx) { return TextCombatCore.resolveDuel(a, d, ctx); },
  resolveSkirmish(uA, uB, ctx) { return TextCombatCore.resolveSkirmish(uA, uB, ctx); },
  runPhasedBattle(atk, def, ctx) { return TextCombatCore.runPhasedBattle(atk, def, ctx); },

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
    if (typeof AgentMemorySystem !== 'undefined') AgentMemorySystem.onReliefArrived(needy, carrier.id);
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
    } else if (a.notable || (a.fame || 0) >= 20) {
      // ตำนานจบชีวิต — บันทึกลง chronicle พร้อมสรุปชีวิต
      EventSystem.add('legend', `⚰ ${a.title ? a.title + ' ' : ''}${a.name} ${causeText}ที่${s ? s.name : 'กลางทาง'}`, { agents: [a.id] });
      if (typeof ObserverSystem !== 'undefined') {
        ObserverSystem.onMajorEvent('legendary_death', `ตำนาน ${a.name} สิ้นชีวิต`, { agents: [a.id] });
      }
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

/* ═══════════════════ 10.8 PHASE 12: MARKET / GUILD / TRADE ═══════════════════ */

function createWarehouse(opt) {
  const wh = {
    id: uid(),
    settlementId: opt.settlementId,
    ownerType: opt.ownerType || 'settlement',
    ownerId: opt.ownerId,
    capacity: opt.capacity || 120,
    stock: newStock(opt.stock),
    rentIncome: 0,
    security: opt.security != null ? opt.security : 40
  };
  world.warehouses.push(wh);
  return wh;
}

function createGuild(opt) {
  const g = {
    id: uid(),
    name: opt.name || `สมาคมพ่อค้าแห่ง${(getSettlement(opt.homeSettlementId) || {}).name || 'แผ่นดิน'}`,
    homeSettlementId: opt.homeSettlementId,
    factionId: opt.factionId || null,
    wealth: opt.wealth || 100,
    influence: opt.influence || 10,
    reputation: opt.reputation || 50,
    members: opt.members ? opt.members.slice() : [],
    warehouses: [],
    contracts: [],
    policyPreference: { lowTax: true, safeRoutes: true, tradeTreaties: true, antiBandit: true },
    relations: opt.relations || {},
    foundedDay: world.day,
    _bountyDay: -99
  };
  world.guilds.push(g);
  const s = getSettlement(opt.homeSettlementId);
  if (s && s.marketRole) {
    s.marketRole.guildPresence = clamp((s.marketRole.guildPresence || 0) + 20, 0, 100);
    s.marketRole.isMarketHub = true;
    if (s.marketRole.hubLevel < 1) s.marketRole.hubLevel = 1;
  }
  return g;
}

function createTradeContract(opt) {
  const c = {
    id: uid(),
    issuerType: opt.issuerType || 'settlement',
    issuerId: opt.issuerId,
    originId: opt.originId,
    destinationId: opt.destinationId,
    good: opt.good,
    quantity: opt.quantity,
    reward: opt.reward,
    deadlineDay: opt.deadlineDay || (world.day + 25),
    riskLevel: opt.riskLevel || 0.2,
    status: 'open',
    acceptedByAgentId: null,
    escortUnitId: null,
    createdDay: world.day
  };
  world.tradeContracts.push(c);
  return c;
}

const MarketTradeSystem = {
  initWorld() {
    if (!world.guilds) world.guilds = [];
    if (!world.warehouses) world.warehouses = [];
    if (!world.tradeContracts) world.tradeContracts = [];
    if (!world.marketIndex) world.marketIndex = defaultMarketIndex();
    for (const s of world.settlements) this.ensureSettlementMarket(s);
    for (const f of world.factions) {
      if (f.tradeInfluence == null) f.tradeInfluence = 0;
    }
    for (const a of world.agents) this.ensureAgentMerchant(a);
    this.validateAll();
  },

  ensureSettlementMarket(s) {
    if (!s.marketRole) s.marketRole = defaultMarketRole();
    if (s.tradeVolume == null) s.tradeVolume = 0;
    if (s.priceVolatility == null) s.priceVolatility = 0;
  },

  ensureAgentMerchant(a) {
    if (a.guildId == null) a.guildId = null;
    if (!a.merchantRank) a.merchantRank = a.profession === 'trader' ? 'peddler' : 'peddler';
    if (a.tradeReputation == null) a.tradeReputation = 50;
    if (a.contractsCompleted == null) a.contractsCompleted = 0;
    if (a.contractsFailed == null) a.contractsFailed = 0;
    if (!a.warehouseIds) a.warehouseIds = [];
  },

  settlementWarehouses(sid) {
    return (world.warehouses || []).filter(w => w.settlementId === sid);
  },

  guildAt(sid) {
    return (world.guilds || []).find(g => g.homeSettlementId === sid);
  },

  routeTradeValue(r) {
    const a = getSettlement(r.a), b = getSettlement(r.b);
    if (!a || !b || r.destroyed) return 0;
    return (r.traffic || 0) * 8 + (a.tradeVolume + b.tradeVolume) * 0.05 + (r.priceGapFood || 0) * 2;
  },

  computeSettlementTradeInfluence(s) {
    if (!s || s.type === 'camp') return 0;
    this.ensureSettlementMarket(s);
    const routes = world.routes.filter(r => !r.destroyed && (r.a === s.id || r.b === s.id));
    const routeBonus = sum(routes, r => r.traffic || 0) * 2;
    const whCap = sum(this.settlementWarehouses(s.id), w => w.capacity);
    const g = this.guildAt(s.id);
    const guildInf = g ? g.influence : 0;
    const danger = EconomySystem.localDanger(s);
    const siegePen = s.siege ? 40 : 0;
    const inf = (s.tradeVolume || 0) * 0.4 + (s.marketRole.hubLevel || 0) * 18 + routes.length * 6
      + whCap * 0.08 + guildInf * 0.5 - danger * 25 - siegePen;
    s.marketRole.tradeInfluence = clamp(inf, 0, 500);
    s.marketRole.connectedRoutes = routes.map(r => r.id);
    return s.marketRole.tradeInfluence;
  },

  computeFactionTradeInfluence(f) {
    if (!f || f.isBandit) { if (f) f.tradeInfluence = 0; return 0; }
    let inf = sum(world.settlements.filter(s => s.factionId === f.id), s => this.computeSettlementTradeInfluence(s));
    const treaties = (world.treaties || []).filter(t => t.status === 'active' && t.type === 'trade' && t.factions.includes(f.id));
    inf += treaties.length * 15;
    for (const g of (world.guilds || []).filter(gu => gu.factionId === f.id)) {
      inf += (g.relations[f.id] || g.reputation * 0.3);
    }
    inf -= (f.diplomacy?.warExhaustion || 0) * 0.4;
    f.tradeInfluence = clamp(inf, 0, 2000);
    return f.tradeInfluence;
  },

  tickDaily() {
    this.initWorld();
    for (const s of marketSettlements()) {
      this.updateSettlementTrade(s);
      this.evaluateMarketHub(s);
      this.trySpawnGuild(s);
      this.maybeCreateContracts(s);
    }
    for (const g of world.guilds) this.guildPolitics(g);
    this.processContracts();
    this.updateMerchantRanks();
    for (const f of world.factions.filter(x => !x.isBandit)) this.computeFactionTradeInfluence(f);
    if (world.day % 3 === 0) this.warehouseRaidCheck();
    if (world.day % 10 === 0) this.updateMarketIndex();
  },

  updateSettlementTrade(s) {
    let vol = 0;
    for (const r of world.routes) {
      if (r.destroyed) continue;
      if (r.a === s.id || r.b === s.id) {
        vol += r.traffic || 0;
        r.traffic = clamp((r.traffic || 0) * 0.98 + this.routeTradeValue(r) * 0.02, 0, 50);
      }
    }
    const traders = agentsAt(s.id).filter(a => a.profession === 'trader').length;
    vol += traders * 2;
    s.tradeVolume = clamp(vol, 0, 200);
    const foodBase = BASE_PRICE.food;
    s.priceVolatility = clamp(Math.abs(s.prices.food / foodBase - 1) * 30 + (s.marketRole.hubLevel > 0 ? -s.marketRole.priceStability * 0.1 : 0), 0, 100);
    if (s.marketRole.hubLevel > 0) {
      s.marketRole.priceStability = clamp(10 + s.marketRole.hubLevel * 8 + (s.buildings.includes('Market') ? 10 : 0), 0, 50);
      s.marketRole.storageBonus = s.marketRole.hubLevel * 15;
    }
  },

  evaluateMarketHub(s) {
    if (s.type === 'camp' || s.siege) return;
    const mr = s.marketRole;
    const routes = world.routes.filter(r => !r.destroyed && (r.a === s.id || r.b === s.id));
    const traders = agentsAt(s.id).filter(a => a.profession === 'trader').length;
    const score = (s.tradeVolume || 0) + routes.length * 8 + traders * 5
      + (s.buildings.includes('Market') ? 15 : 0) + (s.buildings.includes('Warehouse') ? 10 : 0)
      + sum(this.settlementWarehouses(s.id), w => Object.values(w.stock).reduce((a, b) => a + b, 0)) * 0.05;
    let level = 0;
    if (score > 25) level = 1;
    if (score > 55) level = 2;
    if (score > 90) level = 3;
    if (score > 130) level = 4;
    if (score > 180) level = 5;
    if (level > 0 && !mr.isMarketHub) {
      mr.isMarketHub = true;
      mr.hubLevel = level;
      EventSystem.add('trade', `🏦 ${s.name} กลายเป็นตลาดกลางระดับ ${level}`);
      Chronicle.add({
        category: 'market', importance: 4,
        title: `🏦 ตลาดกลาง${s.name} ถือกำเนิด`,
        description: `เส้นทางการค้าและพ่อค้ารวมตัวที่${s.name} กลายเป็นศูนย์กลางเศรษฐกิจของแผ่นดิน`,
        settlements: [s.id], factions: s.factionId ? [s.factionId] : []
      });
    } else if (mr.isMarketHub && level > mr.hubLevel) {
      mr.hubLevel = level;
    } else if (mr.isMarketHub && level < mr.hubLevel - 1) {
      mr.hubLevel = Math.max(1, mr.hubLevel - 1);
    }
    mr.guildPresence = clamp((this.guildAt(s.id) ? 40 : 0) + traders * 4, 0, 100);
  },

  governorDevelopHub(gov, s) {
    if (s.siege || s.type === 'camp') return;
    const faction = getFaction(s.factionId);
    const personality = faction?.diplomacy?.diplomaticPersonality || 'balanced';
    if (personality === 'aggressive') return;
    if (s.tradeVolume < 12 || s.treasury < 280 || s.security < 35) return;
    if (!s.buildings.includes('Market') && (s.type === 'town' || s.type === 'castle') && chance(0.12)) {
      const cost = BUILDINGS.Market.cost;
      if (s.treasury >= cost.gold && s.stock.wood >= cost.wood) {
        s.treasury -= cost.gold; s.stock.wood -= cost.wood;
        s.buildings.push('Market');
        EventSystem.add('trade', `🏗 ${gov.name} พัฒนา${s.name}เป็นศูนย์การค้า (Market)`);
      }
    }
    if (s.marketRole.hubLevel >= 1 && !this.settlementWarehouses(s.id).length && s.treasury > 400 && chance(0.08)) {
      const cost = BUILDINGS.Warehouse.cost;
      if (s.treasury >= cost.gold && s.stock.wood >= cost.wood) {
        s.treasury -= cost.gold; s.stock.wood -= cost.wood;
        createWarehouse({ settlementId: s.id, ownerType: 'settlement', ownerId: s.id, capacity: 100 + s.marketRole.hubLevel * 30, security: s.security * 0.6 });
        if (!s.buildings.includes('Warehouse')) s.buildings.push('Warehouse');
      }
    }
  },

  trySpawnGuild(s) {
    if (s.type === 'camp' || s.siege) return;
    if (this.guildAt(s.id)) return;
    const traders = agentsAt(s.id).filter(a => a.alive && a.profession === 'trader' && !a.guildId);
    const wealthy = traders.find(a => a.money >= 120 || a.memory.tradeProfit >= 150);
    if (traders.length < 3 || s.tradeVolume < 15) return;
    if (!s.marketRole.isMarketHub && s.marketRole.hubLevel < 1 && traders.length < 5) return;
    if (!wealthy && s.tradeVolume < 25) return;
    if (!chance(0.04 + traders.length * 0.01)) return;
    const leader = wealthy || traders.reduce((m, t) => t.memory.tradeProfit > m.memory.tradeProfit ? t : m, traders[0]);
    const g = createGuild({
      name: `สมาคมพ่อค้าแห่ง${s.name}`,
      homeSettlementId: s.id,
      factionId: s.factionId,
      wealth: leader.money * 0.3 + 80,
      members: traders.slice(0, 6).map(t => t.id)
    });
    for (const t of traders.slice(0, 6)) {
      t.guildId = g.id;
      if (MERCHANT_RANKS.indexOf(t.merchantRank) < MERCHANT_RANKS.indexOf('guild_member')) {
        t.merchantRank = 'guild_member';
        t.title = MERCHANT_RANK_TITLES.guild_member;
      }
      if (typeof AgentMemorySystem !== 'undefined') AgentMemorySystem.onGuildJoined(t, g.id);
    }
    const wh = createWarehouse({ settlementId: s.id, ownerType: 'guild', ownerId: g.id, capacity: 80, security: 45 });
    g.warehouses.push(wh.id);
    EventSystem.add('trade', `🏛 สมาคมพ่อค้า "${g.name}" ก่อตั้งที่${s.name} ภายใต้${leader.name}`);
    Chronicle.add({
      category: 'guild', importance: 4,
      title: `🏛 ก่อตั้ง${g.name}`,
      description: `${leader.name} รวมพ่อค้า ${g.members.length} คน ตั้งสมาคมค้าขายที่${s.name}`,
      agents: [leader.id], settlements: [s.id], factions: s.factionId ? [s.factionId] : []
    });
  },

  maybeCreateContracts(s) {
    if (s.siege || chance(0.85)) return;
    const open = world.tradeContracts.filter(c => c.status === 'open' && (c.originId === s.id || c.issuerId === s.id));
    if (open.length >= 3) return;
    let good = null, qty = 0, dest = null, reward = 0;
    if (s.stock.food < s.demand.food * 0.45) {
      good = 'food'; qty = randInt(8, 20);
      dest = s.id;
      const donor = marketSettlements().filter(x => x.id !== s.id && SettlementMetrics.exportableFood(x) > qty + 10)
        .sort((a, b) => b.stock.food - a.stock.food)[0];
      if (!donor) return;
      reward = Math.floor(qty * s.prices.food * 1.2 + 15);
      if (s.treasury < reward * 0.5) return;
      createTradeContract({
        issuerType: 'settlement', issuerId: s.id, originId: donor.id, destinationId: s.id,
        good, quantity: qty, reward, riskLevel: this.contractRisk(donor.id, s.id)
      });
      return;
    }
    if (s.warDemand > 3 && s.stock.weapons < s.demand.weapons) {
      good = 'weapons'; qty = randInt(3, 8);
      const src = marketSettlements().find(x => x.stock.weapons >= qty + 2 && x.id !== s.id);
      if (!src) return;
      reward = Math.floor(qty * s.prices.weapons * 1.5 + 25);
      if (s.treasury < reward * 0.4) return;
      createTradeContract({
        issuerType: 'settlement', issuerId: s.id, originId: src.id, destinationId: s.id,
        good, quantity: qty, reward, riskLevel: this.contractRisk(src.id, s.id)
      });
      return;
    }
    const g = this.guildAt(s.id);
    if (g && g.wealth > 60 && chance(0.15)) {
      good = pick(['food', 'wood', 'tools'].filter(gg => s.stock[gg] < s.demand[gg] * 0.5));
      if (!good) return;
      qty = randInt(5, 15);
      const src = marketSettlements().find(x => x.stock[good] >= qty + 3 && x.id !== s.id);
      if (!src) return;
      reward = Math.floor(qty * (s.prices[good] || BASE_PRICE[good]) * 1.1 + 10);
      createTradeContract({
        issuerType: 'guild', issuerId: g.id, originId: src.id, destinationId: s.id,
        good, quantity: qty, reward, riskLevel: this.contractRisk(src.id, s.id)
      });
    }
  },

  contractRisk(fromId, toId) {
    const path = findPath(fromId, toId, true);
    if (!path) return 0.8;
    let risk = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const r = getRoute(path[i], path[i + 1]);
      if (r) risk += r.danger || r.threat || 0;
    }
    return clamp(risk / Math.max(path.length - 1, 1), 0.05, 0.95);
  },

  processContracts() {
    for (const c of world.tradeContracts) {
      if (c.status === 'open' && world.day > c.deadlineDay) {
        this.failContract(c, 'หมดเวลา');
      }
    }
    for (const a of world.agents) {
      if (!a.alive || a.profession !== 'trader' || a.cargo || a.travel || a.isTownCaravan) continue;
      if (a.contractId) continue;
      this.traderConsiderContract(a);
    }
  },

  traderConsiderContract(a) {
    const s = getSettlement(a.locationId);
    if (!s) return;
    const open = world.tradeContracts.filter(c => c.status === 'open');
    let best = null, bestScore = 8;
    for (const c of open) {
      if (c.originId !== s.id && c.destinationId !== s.id) {
        const nearOrigin = findPath(s.id, c.originId);
        if (!nearOrigin) continue;
      }
      const origin = getSettlement(c.originId);
      const dest = getSettlement(c.destinationId);
      if (!origin || !dest) continue;
      const avail = this.availableStock(origin, c.good, c.quantity);
      if (avail < c.quantity) continue;
      const daysLeft = c.deadlineDay - world.day;
      if (daysLeft < 3) continue;
      const risk = c.riskLevel || this.contractRisk(c.originId, c.destinationId);
      let score = c.reward - c.quantity * (origin.prices[c.good] || BASE_PRICE[c.good]) * 0.9;
      score -= risk * 40 * (1.1 - a.traits.riskTolerance);
      score += a.skills.trading * 3;
      if (a.guildId) score += 8;
      if (daysLeft < 8) score -= 10;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best) return;
    this.acceptContract(a, best);
  },

  availableStock(s, good, need) {
    let avail = Math.floor(s.stock[good] || 0);
    if (good === 'food') avail = Math.min(avail, SettlementMetrics.exportableFood(s));
    const whs = this.settlementWarehouses(s.id);
    for (const wh of whs) avail += Math.floor(wh.stock[good] || 0);
    return avail;
  },

  withdrawStock(s, good, qty) {
    let left = qty;
    const whs = this.settlementWarehouses(s.id);
    for (const wh of whs) {
      const take = Math.min(left, Math.floor(wh.stock[good] || 0));
      wh.stock[good] = Math.max(0, (wh.stock[good] || 0) - take);
      left -= take;
      if (left <= 0) return qty;
    }
    if (good === 'food') {
      const take = Math.min(left, SettlementMetrics.exportableFood(s));
      s.stock.food -= take;
      left -= take;
    } else {
      const take = Math.min(left, Math.floor(s.stock[good] || 0));
      s.stock[good] -= take;
      left -= take;
    }
    return qty - left;
  },

  acceptContract(a, c) {
    const origin = getSettlement(c.originId);
    if (!origin) return;
    if (a.locationId !== c.originId) {
      a.pendingContractId = c.id;
      startTravel(a, c.originId, 'contract');
      return;
    }
    this.pickupContract(a, c);
  },

  pickupContract(a, c) {
    const origin = getSettlement(c.originId);
    if (!origin) return;
    const got = this.withdrawStock(origin, c.good, c.quantity);
    if (got < Math.ceil(c.quantity * 0.8)) return;
    c.status = 'accepted';
    c.acceptedByAgentId = a.id;
    a.contractId = c.id;
    a.pendingContractId = null;
    a.cargo = { good: c.good, qty: got, buyCost: got * (origin.prices[c.good] || BASE_PRICE[c.good]), destId: c.destinationId, isContract: true, contractId: c.id };
    a.currentGoal = `สัญญาขนส่ง ${c.good} → ${(getSettlement(c.destinationId) || {}).name || '?'}`;
    startTravel(a, c.destinationId, 'contract');
    EventSystem.add('trade', `📜 ${a.name} รับสัญญาขนส่ง ${c.good} ${got} หน่วย (ค่าจ้าง ${fmt(c.reward)} ทอง)`);
  },

  completeContract(c, a) {
    const dest = getSettlement(c.destinationId);
    if (!dest || !a.cargo) return;
    const qty = Math.min(a.cargo.qty, c.quantity);
    dest.stock[c.good] = Math.min(dest.stock[c.good] + qty, EconomySystem.storageCap(dest, c.good));
    dest.recentInbound = (dest.recentInbound || 0) + qty;
    let paid = c.reward;
    if (c.issuerType === 'settlement') {
      const iss = getSettlement(c.issuerId);
      if (iss) { paid = Math.min(c.reward, iss.treasury); iss.treasury -= paid; }
    } else if (c.issuerType === 'guild') {
      const g = getGuild(c.issuerId);
      if (g) { paid = Math.min(c.reward, g.wealth); g.wealth -= paid; g.influence += 2; }
    } else if (c.issuerType === 'faction') {
      const f = getFaction(c.issuerId);
      if (f) { paid = Math.min(c.reward, f.treasury); f.treasury -= paid; }
    }
    a.money += paid;
    a.contractsCompleted = (a.contractsCompleted || 0) + 1;
    a.tradeReputation = clamp((a.tradeReputation || 50) + 4, 0, 100);
    a.skills.trading = Math.min(10, a.skills.trading + 0.1);
    world.stats.contractsCompleted = (world.stats.contractsCompleted || 0) + 1;
    c.status = 'completed';
    a.contractId = null;
    a.cargo = null;
    if (a.guildId) {
      const g = getGuild(a.guildId);
      if (g) { g.wealth += paid * 0.1; g.influence += 3; g.contracts.push(c.id); }
    }
    if (c.reward >= 40 || qty >= 15) {
      Chronicle.add({
        category: 'market', importance: 3,
        title: `📜 สัญญาขนส่งสำเร็จ: ${c.good} → ${dest.name}`,
        description: `${a.name} ส่งมอบ ${qty} หน่วย${c.good} ตามสัญญา ได้รับ ${fmt(paid)} ทอง`,
        agents: [a.id], settlements: [c.originId, c.destinationId]
      });
    }
    EventSystem.add('trade', `✅ ${a.name} ส่งมอบสัญญา ${c.good} ที่${dest.name} ได้ ${fmt(paid)} ทอง`);
  },

  failContract(c, reason) {
    c.status = 'failed';
    if (c.acceptedByAgentId) {
      const a = getAgent(c.acceptedByAgentId);
      if (a) {
        a.contractsFailed = (a.contractsFailed || 0) + 1;
        a.tradeReputation = clamp((a.tradeReputation || 50) - 8, 0, 100);
        a.contractId = null;
        if (a.cargo?.contractId === c.id) a.cargo = null;
      }
    }
    world.stats.contractsFailed = (world.stats.contractsFailed || 0) + 1;
    if (c.issuerType === 'guild') {
      const g = getGuild(c.issuerId);
      if (g) g.reputation = clamp(g.reputation - 5, 0, 100);
    }
    if (reason && chance(0.3)) EventSystem.add('trade', `❌ สัญญาขนส่ง ${c.good} ล้มเหลว — ${reason}`);
  },

  onTraderArriveContract(a) {
    if (!a.contractId) return false;
    const c = getContract(a.contractId);
    if (!c || c.status !== 'accepted') return false;
    if (a.locationId === c.destinationId && a.cargo) {
      this.completeContract(c, a);
      return true;
    }
    return false;
  },

  onContractCaravanLost(a) {
    if (!a.contractId) return;
    const c = getContract(a.contractId);
    if (c) this.failContract(c, 'ถูกปล้นหรือสูญหาย');
    a.contractId = null;
  },

  guildPolitics(g) {
    const s = getSettlement(g.homeSettlementId);
    if (!s) return;
    const f = getFaction(s.factionId);
    if (!g.relations[s.factionId]) g.relations[s.factionId] = 50;
    let rel = g.relations[s.factionId];
    if (s.taxRate > 0.22) {
      rel -= 0.4;
      if (chance(0.05)) EventSystem.add('politics', `🏛 ${g.name} ไม่พอใจภาษีสูงที่${s.name} — พ่อค้าเริ่มเลี่ยง`);
    } else if (s.taxRate < 0.12 && s.security > 40) {
      rel += 0.3;
    }
    const routeDanger = EconomySystem.localDanger(s);
    if (routeDanger > 0.45 && g.policyPreference.antiBandit && world.day - g._bountyDay > 20) {
      for (const r of world.routes.filter(rt => !rt.destroyed && (rt.a === s.id || rt.b === s.id))) {
        if (r.danger > 0.35 && g.wealth > 40) {
          const bounty = Math.min(60, Math.floor(g.wealth * 0.15));
          g.wealth -= bounty;
          r.bounty = (r.bounty || 0) + bounty;
          g._bountyDay = world.day;
          EventSystem.add('bandit', `💰 ${g.name} ตั้งค่าหัว ${fmt(bounty)} ทองบนเส้นทางค้า`);
          break;
        }
      }
      if (g.wealth > 120 && routeDanger > 0.5 && chance(0.06)) {
        const guards = agentsAt(s.id).filter(a => a.profession === 'guard' && !a.unitId);
        if (guards.length >= 2) {
          const leader = guards[0];
          const u = createUnit({
            name: `คุ้มกันคาราวาน${g.name.split('แห่ง')[0]}`, kind: 'field',
            leaderId: leader.id, memberIds: guards.slice(0, 3).map(x => x.id),
            factionId: s.factionId, locationId: s.id, food: 15
          });
          u.objective = { type: 'patrol_guild', guildId: g.id };
          g.wealth -= 50;
          EventSystem.add('war', `🛡 ${g.name} จ้าง${u.name} ลาดตระเวนปกป้องเส้นทางค้า`);
        }
      }
    }
    if (f && f.warState && g.policyPreference.tradeTreaties && chance(0.04)) {
      const enemy = world.factions.find(o => f.enemies.includes(o.id));
      if (enemy && rel > 40) {
        EventSystem.add('diplomacy', `🏛 ${g.name} กดดันให้${f.name}หาทางสงบศึกเพื่อการค้า`);
        f.diplomacy.warExhaustion = clamp((f.diplomacy.warExhaustion || 0) + 2, 0, 100);
      }
    }
  },

  warehouseRaidCheck() {
    for (const wh of world.warehouses) {
      const s = getSettlement(wh.settlementId);
      if (!s || s.siege) continue;
      const totalStock = sum(GOODS, g => wh.stock[g] || 0);
      if (totalStock < 8) continue;
      const attract = totalStock * 0.002 + EconomySystem.localDanger(s) * 0.08;
      if (!chance(attract)) continue;
      const good = pick(GOODS.filter(g => (wh.stock[g] || 0) > 2));
      if (!good) continue;
      const stolen = Math.min(Math.floor(wh.stock[good] * rand(0.15, 0.4)), Math.floor(wh.stock[good]));
      wh.stock[good] -= stolen;
      world.stats.warehouseRaids = (world.stats.warehouseRaids || 0) + 1;
      s.crime = clamp(s.crime + 8, 0, 100);
      EventSystem.add('bandit', `🔥 โจรปล้นคลังสินค้าที่${s.name}! เสีย ${good} ${stolen} หน่วย`);
      Chronicle.add({
        category: 'market', importance: 3,
        title: `🔥 คลังสินค้า${s.name}ถูกปล้น`,
        description: `โจรขโมย ${good} ${stolen} หน่วยจากคลัง — เส้นทางค้าเสี่ยงขึ้น`,
        settlements: [s.id]
      });
      for (const r of world.routes.filter(rt => !rt.destroyed && (rt.a === s.id || rt.b === s.id))) {
        r.danger = clamp(r.danger + 0.03, 0, 1);
      }
    }
  },

  updateMerchantRanks() {
    for (const a of world.agents) {
      if (!a.alive || a.profession !== 'trader') continue;
      this.ensureAgentMerchant(a);
      const profit = a.memory.tradeProfit || 0;
      const completed = a.contractsCompleted || 0;
      let rank = 'peddler';
      if (profit >= 80 || completed >= 2) rank = 'caravan_trader';
      if (profit >= 200 && a.money >= 120) rank = 'master_merchant';
      if (a.guildId) rank = MERCHANT_RANKS[Math.max(MERCHANT_RANKS.indexOf('guild_member'), MERCHANT_RANKS.indexOf(rank))];
      if (a.guildId) {
        const g = getGuild(a.guildId);
        if (g && (g.influence > 40 || completed >= 5)) rank = 'guild_elder';
      }
      if (profit >= 500 && (a.fame || 0) >= 12) rank = 'trade_prince';
      const idx = MERCHANT_RANKS.indexOf(rank);
      const curIdx = MERCHANT_RANKS.indexOf(a.merchantRank);
      if (idx > curIdx) {
        a.merchantRank = rank;
        const title = MERCHANT_RANK_TITLES[rank];
        if (title && (!a.title || rank === 'trade_prince')) {
          a.title = title;
          if (rank === 'trade_prince') {
            Chronicle.add({
              category: 'guild', importance: 4,
              title: `👑 ${a.name} ขึ้นเป็นเจ้าชายการค้า`,
              description: `พ่อค้าผู้ยิ่งใหญ่ที่ครอบครองเส้นทางค้าและกำไรสะสม ${fmt(profit)} ทอง`,
              agents: [a.id]
            });
            EventSystem.add('legend', `👑 ${a.name} "${title}" — ผู้ครอบครองเส้นเลือดเศรษฐกิจ`);
          }
        }
      }
    }
  },

  updateMarketIndex() {
    const idx = world.marketIndex || defaultMarketIndex();
    const mkts = marketSettlements();
    if (!mkts.length) return;
    for (const g of GOODS.slice(0, 5)) {
      const avg = sum(mkts, s => s.prices[g] / BASE_PRICE[g]) / mkts.length;
      idx[g + 'Index'] = clamp(avg, 0.3, 4);
    }
    idx.volatility = sum(mkts, s => s.priceVolatility || 0) / mkts.length;
    idx.totalTradeVolume = sum(mkts, s => s.tradeVolume || 0);
    const raids = world.stats.caravansRobbed + (world.stats.warehouseRaids || 0);
    const trips = Math.max(1, idx.totalTradeVolume + raids);
    idx.caravanSurvivalRate = clamp(1 - raids / trips, 0.3, 1);
    idx.tradeHealth = clamp(50 + idx.totalTradeVolume * 0.15 - idx.volatility * 0.5 + idx.caravanSurvivalRate * 20, 0, 100);
    idx.lastUpdateDay = world.day;
    world.marketIndex = idx;
    if (idx.tradeHealth > 75 && idx.volatility < 15 && chance(0.15)) {
      Chronicle.add({
        category: 'market', importance: 3,
        title: `📈 การค้าเฟื่องฟู (trade health ${fmt(idx.tradeHealth, 0)})`,
        description: `ตลาดมั่นคง ปริมาณค้า ${fmt(idx.totalTradeVolume, 0)} ดัชนีอาหาร ${fmt(idx.foodIndex, 2)}`
      });
    }
    if (idx.foodIndex > 2.2 && idx.volatility > 25 && chance(0.2)) {
      Chronicle.add({
        category: 'market', importance: 4,
        title: `📉 วิกฤตราคาอาหาร`,
        description: `ดัชนีอาหารพุ่ง ${fmt(idx.foodIndex, 2)} ความผันผวน ${fmt(idx.volatility, 1)} — พ่อค้าและชาวบ้านเดือดร้อน`
      });
    }
  },

  validateAll() {
    world.tradeContracts = (world.tradeContracts || []).filter(c => {
      if (!getSettlement(c.originId) || !getSettlement(c.destinationId)) return false;
      if (c.issuerType === 'guild' && !getGuild(c.issuerId)) return false;
      if (c.issuerType === 'settlement' && !getSettlement(c.issuerId)) return false;
      if (c.acceptedByAgentId && !getAgent(c.acceptedByAgentId)?.alive) {
        c.status = 'failed'; c.acceptedByAgentId = null;
      }
      return true;
    });
    for (const a of world.agents) {
      if (a.contractId && !getContract(a.contractId)) a.contractId = null;
      if (a.guildId && !getGuild(a.guildId)) a.guildId = null;
    }
  },

  diplomacyTradeWeight(f) {
    return clamp((f.tradeInfluence || 0) * 0.02, 0, 25);
  },

  rankings() {
    const hubs = marketSettlements().filter(s => s.marketRole?.isMarketHub)
      .sort((a, b) => (b.marketRole.tradeInfluence || 0) - (a.marketRole.tradeInfluence || 0)).slice(0, 10);
    const guilds = (world.guilds || []).slice().sort((a, b) => b.wealth - a.wealth).slice(0, 10);
    const routes = world.routes.filter(r => !r.destroyed).map(r => ({ route: r, value: this.routeTradeValue(r) }))
      .sort((a, b) => b.value - a.value).slice(0, 10);
    const volatile = marketSettlements().slice().sort((a, b) => (b.priceVolatility || 0) - (a.priceVolatility || 0)).slice(0, 10);
    const contracts = (world.tradeContracts || []).filter(c => c.status === 'open' || c.status === 'accepted')
      .sort((a, b) => b.reward - a.reward).slice(0, 15);
    const profitable = GOODS.map(g => ({
      good: g,
      avgPrice: sum(marketSettlements(), s => s.prices[g]) / Math.max(marketSettlements().length, 1)
    })).sort((a, b) => b.avgPrice - a.avgPrice);
    return { hubs, guilds, routes, volatile, contracts, profitable, marketIndex: world.marketIndex };
  },

  renderMarketPanel() {
    const body = document.getElementById('marketPanelBody');
    if (!body || !world) return;
    const rk = this.rankings();
    const idx = world.marketIndex || defaultMarketIndex();
    let html = `<div class="mkt-index-box">
      <div><b>Market Index</b> (Day ${idx.lastUpdateDay || world.day})</div>
      <div class="mkt-idx-row">🍞 food ${fmt(idx.foodIndex, 2)} · 🪵 wood ${fmt(idx.woodIndex, 2)} · ⛏ ore ${fmt(idx.oreIndex, 2)}</div>
      <div class="mkt-idx-row">Health ${fmt(idx.tradeHealth, 0)} · Volatility ${fmt(idx.volatility, 1)} · Volume ${fmt(idx.totalTradeVolume, 0)}</div>
      <div class="mkt-idx-row">Caravan survival ${fmt((idx.caravanSurvivalRate || 1) * 100, 0)}%</div>
    </div>`;
    html += '<div class="obs-section-head">Top Market Hubs</div>';
    html += rk.hubs.length ? rk.hubs.map(s =>
      `<div class="obs-row" data-kind="settlement" data-id="${s.id}"><span>${s.name}</span><span class="obs-sub">Lv${s.marketRole.hubLevel} · ${fmt(s.marketRole.tradeInfluence, 0)}</span></div>`
    ).join('') : '<p class="hint">ยังไม่มีตลาดกลาง</p>';
    html += '<div class="obs-section-head">Guilds</div>';
    html += rk.guilds.length ? rk.guilds.map(g =>
      `<div class="obs-row" data-kind="settlement" data-id="${g.homeSettlementId}"><span>${g.name}</span><span class="obs-sub">${fmt(g.wealth)} ทอง · ${g.members.length} สมาชิก</span></div>`
    ).join('') : '<p class="hint">ยังไม่มีสมาคม</p>';
    html += '<div class="obs-section-head">Active Contracts</div>';
    html += rk.contracts.length ? rk.contracts.map(c => {
      const o = getSettlement(c.originId), d = getSettlement(c.destinationId);
      return `<div class="obs-row" data-kind="settlement" data-id="${c.destinationId}"><span>${c.good} ×${c.quantity}</span><span class="obs-sub">${c.status} · ${o ? o.name : '?'}→${d ? d.name : '?'} · ${fmt(c.reward)}</span></div>`;
    }).join('') : '<p class="hint">ไม่มีสัญญาเปิด</p>';
    html += '<div class="obs-section-head">Warehouse Stock</div>';
    const whSum = newStock();
    for (const wh of (world.warehouses || [])) for (const g of GOODS) whSum[g] += wh.stock[g] || 0;
    html += GOODS.filter(g => whSum[g] > 0).map(g => `<div class="kv"><span class="k">${g}</span><span class="v">${fmt(whSum[g])}</span></div>`).join('') || '<p class="hint">คลังว่าง</p>';
    body.innerHTML = html;
    for (const row of body.querySelectorAll('.obs-row')) {
      row.addEventListener('click', () => ObserverSystem.focusTarget(row.dataset.kind, +row.dataset.id));
    }
  }
};

/* ═══════════════════ 10.9 PHASE 17: AGENT MEMORY / RELATIONSHIPS ═══════════════════ */

const AgentMemorySystem = {
  initWorld() {
    for (const a of world.agents) this.ensureAgent(a);
    for (const s of world.settlements) this.ensureSettlement(s);
    for (const u of world.units) this.ensureUnit(u);
    this.validateAll();
  },

  ensureAgent(a) {
    if (!a.memory) a.memory = { battlesWon: 0, battlesLost: 0, survivedBattles: 0, citiesVisited: [], daysHungry: 0, raidsDone: 0, tradeProfit: 0 };
    const bp = a.birthplaceId || a.locationId;
    if (!a.memory.personal) a.memory.personal = defaultPersonalMemory(bp);
    else {
      const d = defaultPersonalMemory(bp);
      a.memory.personal = Object.assign(d, a.memory.personal);
      for (const k of ['majorEvents', 'trauma', 'gratitude', 'grudges', 'fears', 'loyalties', 'betrayalsWitnessed', 'savedBy', 'harmedBy', 'favoritePlaces', 'avoidedRoutes', 'formerCommanders', 'formerGuilds', 'formerSettlements']) {
        if (!a.memory.personal[k]) a.memory.personal[k] = Array.isArray(d[k]) ? [] : d[k];
      }
    }
    if (a.memory.personal.bornDay == null) a.memory.personal.bornDay = Math.max(0, world.day - (a.age || 20));
    if (!a.memory.personal.birthplaceId) a.memory.personal.birthplaceId = bp;
    if (!a.relationships) a.relationships = {};
    if (!a.motives) a.motives = defaultMotives();
    if (a._motiveDay == null) a._motiveDay = -99;
  },

  ensureSettlement(s) {
    if (!s.sentiment) s.sentiment = defaultSettlementSentiment();
    else s.sentiment = Object.assign(defaultSettlementSentiment(), s.sentiment);
  },

  ensureUnit(u) {
    if (!u.bonds) u.bonds = defaultUnitBonds();
    else u.bonds = Object.assign(defaultUnitBonds(), u.bonds);
  },

  recordPersonalEvent(a, type, title, description, importance, refs) {
    if (!a || !a.alive) return;
    this.ensureAgent(a);
    const p = a.memory.personal;
    const entry = {
      day: world.day, type, title, description: description || title,
      importance: importance || 2,
      agents: (refs?.agents || []).slice(),
      settlements: (refs?.settlements || []).slice(),
      factions: (refs?.factions || []).slice()
    };
    p.majorEvents.push(entry);
    if (p.majorEvents.length > MAX_MAJOR_EVENTS) p.majorEvents.shift();
    if (importance >= 3) {
      const cat = ['robbed_by_bandits', 'survived_battle', 'commander_saved_me', 'commander_abandoned_me',
        'friend_died', 'enemy_killed', 'trade_success', 'trade_disaster', 'lost_home', 'captured_city'].includes(type) ? 'personal' : 'relationship';
      if (importance >= 4 || ['mutiny', 'revenge_completed', 'friendship_forged'].includes(type)) {
        Chronicle.add({
          category: cat, importance,
          title, description: description || title,
          agents: [a.id, ...(refs?.agents || [])].filter((x, i, arr) => arr.indexOf(x) === i),
          settlements: refs?.settlements || [], factions: refs?.factions || []
        });
      }
    }
  },

  pruneRelationships(a) {
    const ids = Object.keys(a.relationships);
    if (ids.length <= MAX_AGENT_RELATIONS) return;
    const ranked = ids.map(id => {
      const r = a.relationships[id];
      const strength = Math.abs(r.score) + r.grudge + r.gratitude + r.loyalty + r.trust * 0.2;
      return { id: +id, strength, day: r.lastInteractionDay || 0 };
    }).sort((x, y) => y.strength - x.strength || y.day - x.day);
    for (let i = MAX_AGENT_RELATIONS; i < ranked.length; i++) delete a.relationships[ranked[i].id];
  },

  decayRelationships() {
    for (const a of world.agents) {
      if (!a.alive || !a.relationships) continue;
      for (const [id, r] of Object.entries(a.relationships)) {
        const age = world.day - (r.lastInteractionDay || 0);
        if (age > 300 && Math.abs(r.score) < 8 && r.grudge < 5 && r.loyalty < 8) {
          delete a.relationships[id];
          continue;
        }
        if (age > 60) {
          r.grudge = clamp(r.grudge - 0.15, 0, 100);
          r.gratitude = clamp(r.gratitude - 0.1, 0, 100);
          r.rivalry = clamp(r.rivalry - 0.1, 0, 100);
        }
      }
      this.pruneRelationships(a);
    }
  },

  updateMotives(a) {
    this.ensureAgent(a);
    const m = a.motives;
    const p = a.memory.personal;
    m.survival = clamp(40 + (100 - (a.stats.hunger || 0)) * 0.4 + (100 - (a.stats.health || 100)) * 0.2, 0, 100);
    m.wealth = clamp(25 + a.traits.greed * 40 + Math.min(a.money, 200) * 0.15 + (a.memory.tradeProfit || 0) * 0.05, 0, 100);
    m.safety = clamp(35 + (() => { const loc = getSettlement(a.locationId); return loc ? (1 - EconomySystem.localDanger(loc)) * 40 : 20; })() + (p.fears?.length || 0) * 4, 0, 100);
    m.loyalty = clamp(20 + a.traits.loyalty * 35 + (p.loyalties?.length || 0) * 6, 0, 100);
    m.revenge = clamp(10 + (p.grudges?.length || 0) * 12 + sum(Object.values(a.relationships || {}), r => r.grudge || 0) * 0.08, 0, 100);
    m.ambition = clamp(15 + a.traits.ambition * 50 + (a.fame || 0) * 0.5, 0, 100);
    m.duty = clamp(15 + a.traits.discipline * 30 + (MILITARY_PROFS.has(a.profession) ? 20 : 0), 0, 100);
    m.trade = clamp(10 + (a.profession === 'trader' ? 35 : 0) + a.skills.trading * 4 + (a.guildId ? 15 : 0), 0, 100);
    m.power = clamp(10 + a.traits.ambition * 25 + a.skills.leadership * 5 + (RULER_PROFS.has(a.profession) ? 25 : 0), 0, 100);
    m.familyClan = clamp(20 + (p.favoritePlaces?.length || 0) * 5 + (a.homeId === a.locationId ? 15 : 0), 0, 100);
    m.fear = clamp(10 + (p.fears?.length || 0) * 10 + (p.avoidedRoutes?.length || 0) * 5 + (p.trauma?.length || 0) * 6, 0, 100);
    a._motiveDay = world.day;
  },

  tickDaily() {
    if (world.day % 25 === 0) this.decayRelationships();
    if (world.day % 5 === 0) {
      for (const a of world.agents) if (a.alive) this.updateMotives(a);
    }
    if (world.day % 10 === 0) {
      for (const u of world.units) if (unitMembers(u).length) this.updateUnitBonds(u);
    }
  },

  updateUnitBonds(u) {
    this.ensureUnit(u);
    const members = unitMembers(u);
    const leader = getAgent(u.leaderId);
    if (!members.length) return;
    let loyaltySum = 0, veterans = 0;
    for (const m of members) {
      this.ensureAgent(m);
      if (leader) {
        const rel = getAgentRelation(m, leader.id);
        loyaltySum += rel ? rel.loyalty : 30;
      }
      if ((m.memory.survivedBattles || 0) >= 2) veterans++;
    }
    u.bonds.leaderLoyaltyAvg = leader ? loyaltySum / members.length : 50;
    u.bonds.veteranCount = veterans;
    u.bonds.sharedBattleCount = (u.battleHistory || []).length;
    u.bonds.betrayalRisk = clamp(0.2 - u.bonds.leaderLoyaltyAvg * 0.002 + u.bonds.moraleMemory * 0.003, 0.02, 0.5);
    u.cohesion = clamp(50 + u.bonds.leaderLoyaltyAvg * 0.3 + veterans * 4 + u.bonds.sharedBattleCount * 2 - u.bonds.betrayalRisk * 30, 20, 100);
  },

  routeWeightMultiplier(agent, route) {
    if (!agent?.memory?.personal) return 1;
    const p = agent.memory.personal;
    let mult = 1;
    if (p.avoidedRoutes?.includes(route.id)) mult += 2.5;
    for (const f of (p.fears || [])) {
      if (f.type === 'route' && f.routeId === route.id) mult += 1.5 + (f.intensity || 10) * 0.05;
    }
    return mult;
  },

  pathAvoidPenalty(agent, path) {
    if (!path || path.length < 2) return 0;
    let pen = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const r = getRoute(path[i], path[i + 1]);
      if (r && agent.memory?.personal?.avoidedRoutes?.includes(r.id)) pen += 25;
    }
    return pen;
  },

  desertionResist(member, leader) {
    if (!member || !leader) return 0;
    const rel = getAgentRelation(member, leader.id);
    const unit = member.unitId ? getUnit(member.unitId) : null;
    let resist = rel ? rel.loyalty * 0.006 + rel.trust * 0.003 : 0;
    if (unit?.bonds) resist += unit.bonds.leaderLoyaltyAvg * 0.004 + unit.bonds.veteranCount * 0.02;
    return clamp(resist, 0, 0.55);
  },

  noteSettlementHero(s, agentId, delta, reason) {
    if (!s || !agentId) return;
    this.ensureSettlement(s);
    s.sentiment.heroes[agentId] = clamp((s.sentiment.heroes[agentId] || 0) + delta, -MAX_SENTIMENT_ENTRIES * 10, MAX_SENTIMENT_ENTRIES * 10);
    if (reason && s.sentiment.rememberedCrises.length < MAX_SENTIMENT_ENTRIES) {
      s.sentiment.rememberedCrises.push({ day: world.day, type: 'hero', agentId, text: reason });
    }
    if (delta > 5) s.loyalty = clamp(s.loyalty + delta * 0.15, 0, 100);
  },

  noteSettlementVillain(s, agentId, delta, reason) {
    if (!s || !agentId) return;
    this.ensureSettlement(s);
    s.sentiment.villains[agentId] = clamp((s.sentiment.villains[agentId] || 0) + delta, 0, MAX_SENTIMENT_ENTRIES * 10);
    if (reason) s.unrest = clamp(s.unrest + delta * 0.2, 0, 100);
    if (delta > 8 && chance(0.15)) {
      Chronicle.add({
        category: 'relationship', importance: 3,
        title: `😠 ${(getAgent(agentId) || {}).name || 'ผู้ร้าย'} ถูกประชาชนเกลียดที่${s.name}`,
        description: reason, agents: [agentId], settlements: [s.id]
      });
    }
  },

  noteFactionSentiment(s, factionId, delta) {
    if (!s || !factionId) return;
    this.ensureSettlement(s);
    if (delta > 0) s.sentiment.lovedFactions[factionId] = clamp((s.sentiment.lovedFactions[factionId] || 0) + delta, 0, 100);
    else s.sentiment.hatedFactions[factionId] = clamp((s.sentiment.hatedFactions[factionId] || 0) - delta, 0, 100);
  },

  governorLoyaltyModifier(gov, rulerId) {
    if (!gov || !rulerId) return 0;
    const rel = getAgentRelation(gov, rulerId);
    return rel ? rel.loyalty * 0.15 + rel.trust * 0.08 - rel.grudge * 0.1 : 0;
  },

  rulerBetrayalModifier(rulerA, rulerB) {
    if (!rulerA || !rulerB) return 0;
    const rel = getAgentRelation(rulerA, rulerB);
    return rel ? rel.grudge * 0.12 - rel.trust * 0.06 : 0;
  },

  onRobbed(trader, route, robberIds) {
    if (!trader) return;
    this.ensureAgent(trader);
    const p = trader.memory.personal;
    if (route && !p.avoidedRoutes.includes(route.id)) p.avoidedRoutes.push(route.id);
    if (route && !p.fears.some(f => f.type === 'route' && f.routeId === route.id)) {
      p.fears.push({ type: 'route', routeId: route.id, intensity: 20, day: world.day });
    }
    for (const rid of (robberIds || [])) addGrudge(trader, rid, 'robbed_by_bandits', 22);
    this.recordPersonalEvent(trader, 'robbed_by_bandits', 'ถูกโจรปล้นบนเส้นทาง',
      `${trader.name} ถูกปล้นกลางทาง — จะจำเส้นทางนี้ไว้`, 3, { agents: robberIds || [] });
  },

  onBattleEnd(units, won, battleName, settlementId) {
    for (const u of units) {
      const leader = getAgent(u.leaderId);
      const survivors = unitMembers(u);
      for (let i = 0; i < survivors.length; i++) {
        for (let j = i + 1; j < survivors.length; j++) {
          changeAgentRelation(survivors[i], survivors[j].id, { trust: 3, score: 4 }, 'battle_brother');
          changeAgentRelation(survivors[j], survivors[i].id, { trust: 3, score: 4 }, 'battle_brother');
        }
        const m = survivors[i];
        if (won && leader) {
          changeAgentRelation(m, leader.id, { respect: 5, loyalty: 3, score: 4 }, 'victory_together');
          this.recordPersonalEvent(m, 'survived_battle', battleName || 'รอดจากศึก',
            `${m.name} รอดชีวิตจาก${battleName || 'ศึก'}`, 3, { agents: [leader.id], settlements: settlementId ? [settlementId] : [] });
        } else if (!won && leader) {
          if (chance(0.35)) addGrudge(m, leader.id, 'commander_abandoned_me', 12);
          else changeAgentRelation(m, leader.id, { fear: 4, respect: -3 }, 'defeat_together');
          u.bonds.moraleMemory = clamp((u.bonds.moraleMemory || 0) + 5, 0, 50);
        }
      }
      if (leader && won) changeAgentRelation(leader, survivors[0]?.id, { respect: 2 }, 'led_victory');
      this.updateUnitBonds(u);
    }
  },

  onCityStarved(s) {
    if (!s) return;
    for (const a of agentsAt(s.id)) {
      if (!a.alive) continue;
      this.ensureAgent(a);
      const p = a.memory.personal;
      if (!p.favoritePlaces.includes(s.id) && !p.formerSettlements.includes(s.id)) p.formerSettlements.push(s.id);
      this.recordPersonalEvent(a, 'city_starved', `อดอยากที่${s.name}`,
        `ความหิวกระหายทำให้จำ${s.name}เป็นความทรมาน`, 3, { settlements: [s.id] });
    }
    this.ensureSettlement(s);
    if (s.sentiment.rememberedCrises.length < MAX_SENTIMENT_ENTRIES) {
      s.sentiment.rememberedCrises.push({ day: world.day, type: 'famine', text: `วิกฤตอาหาร Day ${world.day}` });
    }
  },

  onReliefArrived(s, helperId) {
    if (!s || !helperId) return;
    this.noteSettlementHero(s, helperId, 12, `ช่วยส่งอาหารมายัง${s.name}`);
    for (const a of agentsAt(s.id)) {
      if (a.id !== helperId) addGratitude(a, helperId, 'city_saved_by_relief', 10);
      this.recordPersonalEvent(a, 'city_saved_by_relief', `ได้รับความช่วยเหลือที่${s.name}`,
        `อาหารมาถึงในยามวิกฤต`, 3, { agents: [helperId], settlements: [s.id] });
    }
  },

  onTaxRaised(gov, s, newRate) {
    if (!s || newRate < 0.18) return;
    for (const a of agentsAt(s.id).filter(x => x.profession === 'trader')) {
      if (gov) addGrudge(a, gov.id, 'high_tax', Math.floor((newRate - 0.15) * 80));
    }
    if (gov) this.noteSettlementVillain(s, gov.id, Math.floor((newRate - 0.15) * 40), `ขึ้นภาษีหนัก ${fmt(newRate * 100)}%`);
  },

  onCityCaptured(s, captorLeaderId, oldFactionId) {
    if (!s) return;
    for (const a of agentsAt(s.id)) {
      this.recordPersonalEvent(a, 'lost_home', `${s.name} เปลี่ยนมือ`,
        `บ้านเกิดถูกยึด`, 4, { settlements: [s.id], factions: [oldFactionId] });
    }
    if (captorLeaderId) this.noteSettlementHero(s, captorLeaderId, 8, `ยึด${s.name}`);
    if (oldFactionId) this.noteFactionSentiment(s, oldFactionId, -15);
  },

  onGuildJoined(a, guildId) {
    if (!a) return;
    const g = getGuild(guildId);
    this.recordPersonalEvent(a, 'joined_guild', `เข้าร่วม${g ? g.name : 'สมาคมพ่อค้า'}`,
      `${a.name} เป็นสมาชิกสมาคมพ่อค้า`, 3, { settlements: g ? [g.homeSettlementId] : [] });
    if (g) {
      const leaderId = g.members[0];
      if (leaderId && leaderId !== a.id) addLoyalty(a, leaderId, 'joined_guild', 14);
      a.memory.personal.formerGuilds.push(guildId);
    }
  },

  onTradeSuccess(a, profit) {
    if (!a || profit < 30) return;
    this.recordPersonalEvent(a, 'trade_success', 'ค้าขายสำเร็จ',
      `กำไร ${fmt(profit)} ทองจากการค้า`, 2, {});
    const s = getSettlement(a.locationId);
    if (s && profit >= 60) this.noteSettlementHero(s, a.id, 4, 'พ่อค้าที่ทำให้ตลาดคึกคัก');
  },

  onRevengeCompleted(a, targetId, label) {
    addGrudge(a, targetId, 'revenge_completed', -20);
    a.fame = (a.fame || 0) + 3;
    if (!a.title && chance(0.4)) {
      a.title = `ผู้ล้างแค้นแห่ง${(getSettlement(a.homeId) || {}).name || 'แผ่นดิน'}`;
      Chronicle.add({
        category: 'personal', importance: 4,
        title: `⚔ ${a.name} ล้างแค้นสำเร็จ`,
        description: label || `${a.name} ตอบแทนศัตรูที่เคยทำร้าย`,
        agents: [a.id, targetId]
      });
    }
  },

  topRelations(a, field, n) {
    this.ensureAgent(a);
    return Object.entries(a.relationships)
      .map(([id, r]) => ({ id: +id, agent: getAgent(+id), rel: r, val: r[field] || 0 }))
      .filter(x => x.agent && x.agent.alive && x.val > 0)
      .sort((x, y) => y.val - x.val).slice(0, n || 5);
  },

  relationCount(a) {
    return Object.keys(a.relationships || {}).length;
  },

  rankings() {
    const alive = world.agents.filter(a => a.alive);
    const loyalFollowers = alive.map(a => {
      const top = this.topRelations(a, 'loyalty', 1)[0];
      return { agent: a, loyalty: top ? top.val : 0, leader: top?.agent };
    }).sort((x, y) => y.loyalty - x.loyalty).slice(0, 10);
    const feared = alive.map(a => ({
      agent: a, fear: sum(Object.values(a.relationships || {}), r => r.fear)
    })).sort((x, y) => y.fear - x.fear).slice(0, 10);
    const hated = alive.map(a => {
      let hate = 0;
      for (const s of world.settlements) hate += (s.sentiment?.villains?.[a.id] || 0);
      hate += sum(Object.values(a.relationships || {}), r => r.grudge);
      return { agent: a, hate };
    }).sort((x, y) => y.hate - x.hate).slice(0, 10);
    const vengeful = alive.map(a => ({
      agent: a, revenge: (a.motives?.revenge || 0) + (a.memory.personal?.grudges?.length || 0) * 8
    })).sort((x, y) => y.revenge - x.revenge).slice(0, 10);
    const connected = alive.map(a => ({ agent: a, n: this.relationCount(a) }))
      .sort((x, y) => y.n - x.n).slice(0, 10);
    return { loyalFollowers, feared, hated, vengeful, connected };
  },

  validateAll() {
    for (const a of world.agents) {
      this.ensureAgent(a);
      for (const id of Object.keys(a.relationships)) {
        const other = getAgent(+id);
        if (!other || (!other.alive && Math.abs(a.relationships[id].grudge) < 10 && a.relationships[id].loyalty < 10)) {
          delete a.relationships[id];
        }
      }
      this.pruneRelationships(a);
      if (a.memory.personal.majorEvents.length > MAX_MAJOR_EVENTS) {
        a.memory.personal.majorEvents = a.memory.personal.majorEvents.slice(-MAX_MAJOR_EVENTS);
      }
    }
    for (const s of world.settlements) {
      this.ensureSettlement(s);
      const trim = (obj) => {
        const keys = Object.keys(obj).sort((a, b) => obj[b] - obj[a]).slice(0, MAX_SENTIMENT_ENTRIES);
        const keep = new Set(keys);
        for (const k of Object.keys(obj)) if (!keep.has(k)) delete obj[k];
      };
      trim(s.sentiment.heroes);
      trim(s.sentiment.villains);
    }
  }
};

/* ═══════════════════ 10.95 PHASE 18: CAMPAIGN WARFARE ═══════════════════ */

const CampaignWarfareSystem = {
  initWorld() {
    if (!world.supplyLines) world.supplyLines = [];
    if (!world.armyCamps) world.armyCamps = [];
    if (!world.scoutReports) world.scoutReports = [];
    for (const s of world.settlements) {
      if (!s.terrain) s.terrain = inferSettlementTerrain(s);
      if (s.strategicValue == null) s.strategicValue = settlementStrategicValue(s);
      if (!s.siegeEquipment) s.siegeEquipment = { wallBonus: s.buildings?.includes('Wall') ? 1 : 0, watchtower: s.buildings?.includes('Watchtower') ? 1 : 0 };
    }
    for (const r of world.routes) {
      if (!r.terrain) r.terrain = inferRouteTerrain(r);
      if (r.ambushRisk == null) r.ambushRisk = clamp((r.threat || r.danger || 0.1) * (r.terrain === 'forest' ? 1.4 : r.terrain === 'marsh' ? 1.2 : 0.9), 0.02, 0.85);
      if (r.supplyTraffic == null) r.supplyTraffic = 0;
      if (r.scoutCoverage == null) r.scoutCoverage = 0;
    }
    for (const ar of world.armies) this.ensureArmy(ar);
    for (const w of world.wars) {
      if (!w.goal) w.goal = 'capture_settlement';
      if (w.supplyDisruptions == null) w.supplyDisruptions = 0;
      if (w.sieges == null) w.sieges = 0;
      if (w.ambushes == null) w.ambushes = 0;
      if (w.goalAchieved == null) w.goalAchieved = false;
    }
    this.validateOrphans();
  },

  ensureArmy(ar) {
    if (!ar) return;
    if (!ar.strategyProfile) ar.strategyProfile = defaultStrategyProfile();
    else ar.strategyProfile = Object.assign(defaultStrategyProfile(), ar.strategyProfile);
    if (!ar.siegeEquipment) ar.siegeEquipment = defaultSiegeEquipment();
    else ar.siegeEquipment = Object.assign(defaultSiegeEquipment(), ar.siegeEquipment);
    if (!ar.warGoal) ar.warGoal = 'capture_settlement';
    if (ar.retreatTargetId == null) ar.retreatTargetId = null;
    if (ar.baseSettlementId == null) ar.baseSettlementId = ar.locationId;
    if (ar.campId == null) ar.campId = null;
    if (ar.supplyLineId == null) ar.supplyLineId = null;
    const cmd = getAgent(ar.commanderId);
    if (cmd) this.computeStrategyProfile(cmd, ar);
  },

  getSupplyLine(id) { return (world.supplyLines || []).find(sl => sl.id === id); },

  createSupplyLine(ar, originId, targetId) {
    if (!ar || !originId || !targetId || originId === targetId) return null;
    const path = findPath(originId, targetId);
    if (!path || path.length < 2) return null;
    const existing = (world.supplyLines || []).find(sl => sl.armyId === ar.id && sl.status !== 'collapsed');
    if (existing) {
      existing.routePath = path;
      existing.targetSettlementId = targetId;
      existing.danger = pathDanger(path);
      ar.supplyLineId = existing.id;
      return existing;
    }
    const sl = defaultSupplyLine(ar.id, originId, targetId, path);
    world.supplyLines.push(sl);
    ar.supplyLineId = sl.id;
    ar.baseSettlementId = originId;
    return sl;
  },

  cutSupplyLine(sl, reason, byFactionId) {
    if (!sl || sl.status === 'cut' || sl.status === 'collapsed') return;
    sl.status = 'cut';
    sl.disruptionEvents.push({ day: world.day, reason: reason || 'cut', byFactionId: byFactionId || null });
    const ar = getArmy(sl.armyId);
    if (ar) {
      ar.morale = clamp(ar.morale - 12, 0, 100);
      for (const uId of ar.unitIds) {
        const u = getUnit(uId);
        if (u) { u.fatigue = clamp(u.fatigue + 10, 0, 100); u.morale = clamp(u.morale - 8, 0, 100); }
      }
      const cmd = getAgent(ar.commanderId);
      if (cmd && typeof AgentMemorySystem !== 'undefined') {
        AgentMemorySystem.recordPersonalEvent(cmd, 'lost_supply_line', 'เส้นทางเสบียงถูกตัด', reason || 'supply line cut', 3, { settlements: [sl.originSettlementId, sl.targetSettlementId] });
        cmd.strategyProfile = cmd.strategyProfile || defaultStrategyProfile();
        ar.strategyProfile.logisticsFocus = clamp((ar.strategyProfile.logisticsFocus || 0.4) + 0.15, 0, 1);
      }
    }
    const war = ar ? world.wars.find(w => !w.endDay && (w.attackerId === ar.factionId || w.defenderId === ar.factionId)) : null;
    if (war) war.supplyDisruptions = (war.supplyDisruptions || 0) + 1;
    Chronicle.add({
      category: 'war', importance: 4,
      title: `📦 เส้นทางเสบียงถูกตัด`,
      description: reason || 'กองทัพขาดเสบียงจากแนวหลัง',
      settlements: [sl.originSettlementId, sl.targetSettlementId].filter(x => x),
      factions: byFactionId ? [byFactionId] : []
    });
    EventSystem.add('war', `📦 เส้นทางเสบียงถูกตัด! ${reason || ''}`);
  },

  deliverSupply(sl) {
    if (!sl || sl.status === 'collapsed') return 0;
    const ar = getArmy(sl.armyId);
    const origin = getSettlement(sl.originSettlementId);
    if (!ar || !origin || origin.type === 'camp') return 0;
    const units = ar.unitIds.map(getUnit).filter(u => u && unitMembers(u).length);
    const men = sum(units, u => unitMembers(u).length);
    if (!men) return 0;
    const cmd = getAgent(ar.commanderId);
    const logMod = cmd ? 1 + cmd.skills.logistics * 0.05 : 1;
    const need = Math.ceil(men * 0.8);
    let delivered = 0;
    if (sl.status === 'open' || sl.status === 'threatened') {
      const foodTake = Math.min(Math.floor(origin.stock.food * 0.08), need * 2, Math.ceil(need * logMod));
      if (foodTake > 0 && origin.stock.food >= foodTake) {
        origin.stock.food -= foodTake;
        ar.supply.food += foodTake;
        sl.foodFlow += foodTake;
        delivered += foodTake;
      }
      const wpnTake = Math.min(Math.floor(origin.stock.weapons * 0.05), Math.max(1, Math.floor(men / 8)));
      if (wpnTake > 0 && origin.stock.weapons >= wpnTake) {
        origin.stock.weapons -= wpnTake;
        ar.supply.weapons = (ar.supply.weapons || 0) + wpnTake;
        sl.weaponFlow += wpnTake;
      }
      sl.lastDeliveredDay = world.day;
      sl.danger = pathDanger(sl.routePath);
      if (sl.danger > 0.45) sl.status = 'threatened';
      else if (sl.status === 'threatened' && sl.danger < 0.3) sl.status = 'open';
    } else if (sl.status === 'cut') {
      // small fallback to prevent softlock
      const fallback = Math.min(2, Math.floor(men * 0.15));
      ar.supply.food += fallback;
      delivered = fallback;
    }
    return delivered;
  },

  updateSupplyLines() {
    for (const sl of (world.supplyLines || []).slice()) {
      const ar = getArmy(sl.armyId);
      if (!ar) { sl.status = 'collapsed'; continue; }
      this.deliverSupply(sl);
      if (sl.status === 'open' || sl.status === 'threatened') {
        for (let i = 0; i < sl.routePath.length - 1; i++) {
          const r = getRoute(sl.routePath[i], sl.routePath[i + 1]);
          if (r) {
            r.supplyTraffic = (r.supplyTraffic || 0) + 0.4;
            if (chance((r.ambushRisk || 0.1) * 0.04 * (1 - (r.scoutCoverage || 0) * 0.5))) {
              this.cutSupplyLine(sl, `ถูกโจมตีบนเส้นทาง${inferRouteTerrain(r)}`, null);
              break;
            }
          }
        }
      }
      if (sl.status === 'cut' && world.day - (sl.disruptionEvents[sl.disruptionEvents.length - 1]?.day || 0) > 8 && chance(0.2)) {
        sl.status = 'threatened';
      }
    }
  },

  establishCamp(ar) {
    if (!ar || ar.campId) return getArmyCamp(ar.campId);
    const camp = {
      id: uid(), armyId: ar.id, locationId: ar.locationId,
      dayEstablished: world.day,
      stock: { food: Math.floor(ar.supply.food * 0.25), weapons: Math.floor((ar.supply.weapons || 0) * 0.2), arrows: Math.floor((ar.supply.arrows || 0) * 0.2) },
      fortification: 0, visibility: 0.45, diseaseRisk: 0.08, security: 35,
      linkedSupplyLineId: ar.supplyLineId
    };
    world.armyCamps.push(camp);
    ar.campId = camp.id;
    return camp;
  },

  getArmyCamp(id) { return (world.armyCamps || []).find(c => c.id === id); },

  updateCamps() {
    for (const camp of (world.armyCamps || []).slice()) {
      const ar = getArmy(camp.armyId);
      if (!ar) { world.armyCamps = world.armyCamps.filter(c => c.id !== camp.id); continue; }
      const days = world.day - camp.dayEstablished;
      if (ar.locationId === camp.locationId && !ar.travel) {
        ar.supply.food += Math.min(camp.stock.food, 2);
        camp.stock.food = Math.max(0, camp.stock.food - 1);
        for (const uId of ar.unitIds) {
          const u = getUnit(uId);
          if (u) u.fatigue = clamp(u.fatigue - 4, 0, 100);
        }
        camp.diseaseRisk = clamp(camp.diseaseRisk + (days > 14 ? 0.02 : 0), 0.05, 0.6);
        if (days > 20) ar.morale = clamp(ar.morale - 1, 0, 100);
        if (camp.fortification > 0 && chance(0.01)) camp.stock.weapons = Math.max(0, camp.stock.weapons - 1);
        if (chance(0.03 * (1 - camp.security / 100))) {
          EventSystem.add('war', `🔥 ค่ายทัพถูกโจมตี! สูญเสียเสบียง`);
          camp.stock.food = Math.floor(camp.stock.food * 0.6);
          ar.morale -= 5;
        }
      } else if (world.day - camp.dayEstablished > 60) {
        world.armyCamps = world.armyCamps.filter(c => c.id !== camp.id);
        ar.campId = null;
      }
    }
  },

  addScoutReport(report) {
    if (!world.scoutReports) world.scoutReports = [];
    world.scoutReports.push(Object.assign({ day: world.day, confidence: 0.5, threat: 'unknown' }, report));
    if (world.scoutReports.length > MAX_SCOUT_REPORTS) world.scoutReports.shift();
  },

  scoutCoverageForRoute(r) {
    if (!r) return 0;
    let cov = r.scoutCoverage || 0;
    for (const rep of (world.scoutReports || []).slice(-15)) {
      if (rep.locationId === r.a || rep.locationId === r.b) cov += rep.confidence * 0.15;
    }
    return clamp(cov, 0, 1);
  },

  runArmyScouts(ar) {
    const cmd = getAgent(ar.commanderId);
    if (!cmd) return;
    const prof = ar.strategyProfile || defaultStrategyProfile();
    if (prof.scoutUse < 0.25 && !chance(0.15)) return;
    const targetId = ar.objective?.targetId || ar.locationId;
    const path = ar.supplyLineId ? (this.getSupplyLine(ar.supplyLineId)?.routePath) : findPath(ar.baseSettlementId || ar.locationId, targetId);
    if (!path || path.length < 2) return;
    const seg = pick(path.slice(0, -1));
    const nb = path[path.indexOf(seg) + 1];
    const r = getRoute(seg, nb);
    if (r) {
      r.scoutCoverage = clamp((r.scoutCoverage || 0) + 0.12 + cmd.skills.tactics * 0.02, 0, 1);
      const enemyNear = world.armies.filter(x => x.factionId !== ar.factionId && x.locationId === seg || x.locationId === nb);
      let est = 0;
      for (const ea of enemyNear) est += MilitarySystem.armyPower(ea);
      this.addScoutReport({
        locationId: seg, targetType: enemyNear.length ? 'enemy_army' : 'route',
        estimatedPower: est || pathDanger(path) * 100,
        confidence: clamp(0.35 + cmd.combatStats?.perception * 0.04 + prof.scoutUse * 0.3, 0.2, 0.95),
        threat: (r.ambushRisk || 0) > 0.35 ? 'high' : 'low',
        sourceUnitId: cmd.id, armyId: ar.id
      });
    }
  },

  ambushRisk(route, entity) {
    if (!route) return 0;
    let risk = (route.ambushRisk || route.danger || 0.1);
    if (route.terrain === 'forest') risk *= 1.35;
    if (route.terrain === 'marsh') risk *= 1.15;
    if (route.terrain === 'road') risk *= 0.7;
    const cov = this.scoutCoverageForRoute(route);
    risk *= (1 - cov * 0.55);
    const ar = entity.unitIds ? entity : (entity.armyId ? getArmy(entity.armyId) : null);
    if (ar?.strategyProfile?.scoutUse > 0.5) risk *= 0.75;
    const cmd = ar ? getAgent(ar.commanderId) : getAgent(entity.leaderId);
    if (cmd) risk *= (1 - cmd.skills.tactics * 0.03 - (cmd.combatStats?.perception || 6) * 0.008);
    const cavalry = entity.unitIds
      ? ar.unitIds.map(getUnit).some(u => unitMembers(u).some(m => m.profession === 'cavalry' || m.equipment?.mount))
      : unitMembers(entity).some(m => m.profession === 'cavalry' || m.equipment?.mount);
    if (cavalry && route.terrain === 'plain') risk *= 0.65;
    return clamp(risk, 0.01, 0.75);
  },

  checkTravelAmbush(entity, route, fromId, toId) {
    if (!route || route.destroyed) return false;
    const risk = this.ambushRisk(route, entity);
    if (!chance(risk * 0.12)) return false;
    const isArmy = !!entity.unitIds && !entity.memberIds;
    const isWarband = !!(entity.memberIds && getWarband(entity.id));
    const units = isArmy ? entity.unitIds.map(getUnit).filter(u => u && unitMembers(u).length)
      : isWarband ? (typeof WarbandSystem !== 'undefined' ? WarbandSystem.warbandAsUnits(entity) : [{ memberIds: entity.memberIds, leaderId: entity.leaderId, locationId: entity.locationId }])
      : [entity];
    if (!units.length) return false;
    const banditUnits = world.units.filter(u => u.kind === 'warband' && !u.travel && (u.locationId === fromId || u.locationId === toId) && unitMembers(u).length > 0);
    const banditWbs = (world.warbands || []).filter(w => w.type === 'bandit_gang' && !w.travel && w.status !== 'disbanding' && (w.locationId === fromId || w.locationId === toId) && warbandMembers(w).length > 0);
    const attackers = banditUnits.length ? [pick(banditUnits)]
      : banditWbs.length ? (typeof WarbandSystem !== 'undefined' ? WarbandSystem.warbandAsUnits(pick(banditWbs)) : [])
      : [];
    if (!attackers.length && chance(0.5)) {
      const loose = agentsAt(fromId).filter(a => a.profession === 'bandit' && !a.unitId);
      if (loose.length >= 2) {
        const lu = createUnit({ name: 'โจรซุ่มโจมตี', kind: 'warband', leaderId: loose[0].id, memberIds: loose.slice(0, 4).map(x => x.id), factionId: loose[0].factionId, locationId: fromId, food: 5 });
        attackers.push(lu);
      }
    }
    if (!attackers.length) return false;
    const s = getSettlement(fromId);
    const terrainCtx = terrainBattleContext(route.terrain || inferRouteTerrain(route));
    const result = MilitarySystem.battle(attackers, units, {
      label: s ? s.name : 'เส้นทาง', kind: 'ambush', terrain: terrainCtx.kind, terrainType: route.terrain,
      settlementId: fromId, allowRetreat: true
    });
    route.ambushRisk = clamp((route.ambushRisk || 0.1) + 0.05, 0.02, 0.9);
    route.recentRaids = (route.recentRaids || 0) + 1;
    const foodLoss = randInt(isArmy ? 5 : 3, isArmy ? 20 : 12);
    if (isArmy && entity.supply) {
      entity.supply.food = Math.max(0, entity.supply.food - foodLoss);
      const sl = entity.supplyLineId ? this.getSupplyLine(entity.supplyLineId) : null;
      if (sl && chance(0.35)) this.cutSupplyLine(sl, 'ถูกซุ่มโจมตีบนเส้นทางเสบียง');
    } else if (isWarband) {
      entity.food = Math.max(0, (entity.food || 0) - foodLoss);
    } else if (entity.supply) {
      entity.supply.food = Math.max(0, (entity.supply.food || 0) - foodLoss);
    } else if (entity.inventory) {
      entity.inventory.food = Math.max(0, (entity.inventory.food || 0) - foodLoss);
    }
    for (const u of units) {
      for (const m of unitMembers(u)) {
        if (typeof AgentMemorySystem !== 'undefined') {
          AgentMemorySystem.recordPersonalEvent(m, 'survived_ambush', 'รอดจากการซุ่มโจมตี', `บนเส้นทาง${route.terrain || 'unknown'}`, result.attackerWins ? 2 : 3, {});
          if (!result.attackerWins) addGrudge(m, getAgent(attackers[0].leaderId)?.id, 'ambush', 10);
        }
      }
    }
    const war = isArmy ? world.wars.find(w => !w.endDay && w.attackerId === entity.factionId) : null;
    if (war) war.ambushes = (war.ambushes || 0) + 1;
    if (sum(units, u => unitMembers(u).length) >= 6) {
      Chronicle.add({ category: 'war', importance: 3, title: '⚠ การซุ่มโจมตีใหญ่', description: `บนเส้นทาง${route.terrain} เสียชีวิต ${result.totalDead || 0}`, settlements: [fromId] });
    }
    return true;
  },

  computeStrategyProfile(commander, ar) {
    if (!commander || !ar) return defaultStrategyProfile();
    const p = ar.strategyProfile || defaultStrategyProfile();
    const mem = commander.memory?.personal;
    p.riskAppetite = clamp(commander.traits.bravery * 0.5 + commander.traits.ambition * 0.35, 0.1, 0.95);
    p.patience = clamp(0.4 + commander.traits.discipline * 0.4 - commander.traits.ambition * 0.15, 0.1, 0.9);
    p.logisticsFocus = clamp(0.25 + commander.skills.logistics * 0.06 + (mem?.majorEvents?.some(e => e.type === 'starved_on_campaign' || e.type === 'lost_supply_line') ? 0.25 : 0), 0.1, 0.95);
    p.scoutUse = clamp(0.2 + commander.combatStats?.perception * 0.04 + commander.skills.tactics * 0.04, 0.1, 0.9);
    p.honor = clamp(0.35 + commander.traits.loyalty * 0.45 - commander.traits.greed * 0.2, 0.05, 0.95);
    const units = ar.unitIds.map(getUnit).filter(Boolean);
    const cav = sum(units, u => unitMembers(u).filter(m => m.profession === 'cavalry').length);
    const men = sum(units, u => unitMembers(u).length) || 1;
    if (p.logisticsFocus > 0.6) p.preferredStrategy = 'cut_supply';
    else if (cav / men > 0.25) p.preferredStrategy = 'raid_economy';
    else if (p.patience > 0.65) p.preferredStrategy = 'siege';
    else if (p.riskAppetite < 0.35) p.preferredStrategy = 'avoid_battle';
    else if (p.honor > 0.7) p.preferredStrategy = 'defend_trade';
    else p.preferredStrategy = 'direct_assault';
    ar.strategyProfile = p;
    commander.strategyProfile = p;
    return p;
  },

  pickWarGoal(attacker, defender, target) {
    const war = activeWarBetween(attacker.id, defender.id);
    if (war?.goal) return war.goal;
    const hubs = world.settlements.filter(s => s.factionId === defender.id && (s.marketRole?.hubLevel || 0) > 0);
    if (hubs.length && chance(0.35)) return 'secure_market_hub';
    if (target?.type === 'fort' || target?.type === 'castle') return 'capture_settlement';
    if (defender.isBandit) return 'destroy_bandit_camp';
  if (isVassalOf(defender, attacker)) return 'break_vassal';
    return pick(['capture_settlement', 'cut_trade_route', 'force_tribute', 'defend_border']);
  },

  pickCampaignTarget(f, enemyF, goal) {
    const enemySetts = world.settlements.filter(s => s.factionId === enemyF.id && s.type !== 'camp');
    if (!enemySetts.length) return null;
    if (goal === 'secure_market_hub') {
      const hubs = enemySetts.filter(s => (s.marketRole?.hubLevel || 0) > 0);
      if (hubs.length) return hubs.reduce((m, x) => (x.strategicValue || 0) > (m.strategicValue || 0) ? x : m, hubs[0]);
    }
    if (goal === 'cut_trade_route') {
      return enemySetts.reduce((m, x) => (x.tradeVolume || 0) > (m.tradeVolume || 0) ? x : m, enemySetts[0]);
    }
    return enemySetts.reduce((m, x) => {
      const gm = m.garrisonUnitId ? MilitarySystem.unitPower(getUnit(m.garrisonUnitId)) : 0;
      const gx = x.garrisonUnitId ? MilitarySystem.unitPower(getUnit(x.garrisonUnitId)) : 0;
      return gx < gm ? x : m;
    }, enemySetts[0]);
  },

  updateSiegeEquipment(ar, target) {
    if (!ar?.siegeEquipment || !target?.siege) return;
    const se = ar.siegeEquipment;
    if (se.ready) return;
    const cmd = getAgent(ar.commanderId);
    const base = getSettlement(ar.baseSettlementId || ar.locationId);
    if (!base) return;
    if (base.stock.wood < 2 || base.stock.tools < 1) {
      ar.morale = clamp(ar.morale - 1, 0, 100);
      return;
    }
    se.buildDays = (se.buildDays || 0) + 1;
    if (se.buildDays % 3 === 0) { base.stock.wood -= 2; base.stock.tools -= 0.5; }
    const rate = 1 + (cmd?.skills.logistics || 0) * 0.15 + (cmd?.skills.crafting || 0) * 0.1;
    if (se.buildDays > 4 / rate) se.ladders = 1;
    if (se.buildDays > 8 / rate) se.ram = 1;
    if (se.buildDays > 14 / rate) { se.tower = 1; se.ready = true; }
    ar.supply.food -= 1;
    if (se.ready) {
      const war = world.wars.find(w => !w.endDay && w.attackerId === ar.factionId);
      if (war) war.sieges = (war.sieges || 0) + 1;
      Chronicle.add({ category: 'war', importance: 3, title: `🏗 เครื่องมือล้อมเมืองพร้อม`, description: `${ar.name} สร้างเครื่องล้อมสำหรับ${target.name}เสร็จ`, settlements: [target.id], agents: cmd ? [cmd.id] : [] });
      if (cmd && typeof AgentMemorySystem !== 'undefined') AgentMemorySystem.recordPersonalEvent(cmd, 'built_siege_engine', 'สร้างเครื่องมือล้อมเมือง', target.name, 3, { settlements: [target.id] });
    }
  },

  siegeDefenseBonus(target, ar) {
    let bonus = (target.buildings?.includes('Wall') ? 60 : 0) + (target.buildings?.includes('Watchtower') ? 15 : 0);
    const se = ar?.siegeEquipment;
    if (se?.ready) {
      bonus -= (se.ladders ? 8 : 0) + (se.ram ? 18 : 0) + (se.tower ? 25 : 0) + (se.catapult ? 15 : 0);
    }
    return bonus;
  },

  handleBattleRetreat(loserUnits, winnerUnits, loserWasAttacker, context) {
    if (!loserUnits?.length) return { pursuitLosses: 0 };
    const ar = loserUnits[0]?.armyId ? getArmy(loserUnits[0].armyId) : null;
    let retreatTarget = ar?.baseSettlementId || ar?.locationId || context.settlementId;
    if (ar?.retreatTargetId) retreatTarget = ar.retreatTargetId;
    const path = retreatTarget ? findPath(loserUnits[0].locationId, retreatTarget) : null;
    const scoutSafe = path && (world.scoutReports || []).some(r => path.includes(r.locationId) && r.confidence > 0.5);
    let pursuitLosses = 0;
    const cavWin = sum(winnerUnits, u => unitMembers(u).filter(m => m.profession === 'cavalry' || m.equipment?.mount).length);
    const pursueChance = clamp(0.15 + cavWin * 0.04 - (scoutSafe ? 0.12 : 0), 0.05, 0.55);
    for (const u of loserUnits) {
      u.retreating = true;
      const members = unitMembers(u);
      const moraleLow = u.morale < 35;
      for (const m of members) {
        if (moraleLow && chance(0.2)) {
          m.unitId = null;
          u.memberIds = u.memberIds.filter(id => id !== m.id);
          if (typeof AgentMemorySystem !== 'undefined') AgentMemorySystem.recordPersonalEvent(m, 'survived_rout', 'หนีจากสนามรบอย่างตื่นตระหนก', context.label || '', 2, {});
        } else if (chance(pursueChance * 0.25)) {
          NeedSystem.kill(m, 'ถูกไล่ตามหลังถอยทัพ');
          pursuitLosses++;
        }
      }
      const leader = getAgent(u.leaderId);
      const cmd = ar ? getAgent(ar.commanderId) : leader;
      if (cmd && typeof AgentMemorySystem !== 'undefined' && scoutSafe) {
        AgentMemorySystem.recordPersonalEvent(u.leaderId ? getAgent(u.leaderId) : cmd, 'commander_saved_retreat', 'ถอนทัพอย่างมีระเบียบ', context.label || '', 3, { agents: [cmd.id] });
        addGratitude(getAgent(u.leaderId), cmd.id, 'saved_retreat', 10);
      } else if (cmd && typeof AgentMemorySystem !== 'undefined' && moraleLow) {
        for (const m of members.filter(x => x.alive)) AgentMemorySystem.recordPersonalEvent(m, 'abandoned_in_retreat', 'ถูกทิ้งในยามถอยทัพ', context.label || '', 3, { agents: [cmd.id] });
      }
    }
    if (ar) {
      ar.retreatTargetId = retreatTarget;
      if (retreatTarget && path) startTravel(ar, retreatTarget, 'retreat');
      ar.objective = { type: 'retreat', targetId: retreatTarget };
    }
    if (pursuitLosses >= 3) {
      Chronicle.add({ category: 'war', importance: 3, title: '🏃 การถอยทัพอันดุเดือด', description: `สูญเสีย ${pursuitLosses} ในการไล่ตาม`, settlements: context.settlementId ? [context.settlementId] : [] });
    }
    return { pursuitLosses };
  },

  tickDaily() {
    if (!world.supplyLines) world.supplyLines = [];
    if (!world.armyCamps) world.armyCamps = [];
    if (!world.scoutReports) world.scoutReports = [];
    for (const ar of world.armies) {
      this.ensureArmy(ar);
      const target = ar.objective?.targetId ? getSettlement(ar.objective.targetId) : null;
      const base = getSettlement(ar.baseSettlementId || ar.locationId);
      const distSteps = base && target ? (findPath(base.id, target.id)?.length || 0) : 0;
      if (distSteps > 2 || ar.objective?.type === 'attack') {
        if (base && target) this.createSupplyLine(ar, base.id, target.id);
      }
      if (ar.supplyLineId) this.deliverSupply(this.getSupplyLine(ar.supplyLineId));
      if (target?.siege && target.siege.armyId === ar.id) {
        if (!ar.campId) this.establishCamp(ar);
        this.updateSiegeEquipment(ar, target);
      }
      if (world.day % 2 === 0) this.runArmyScouts(ar);
      const sl = ar.supplyLineId ? this.getSupplyLine(ar.supplyLineId) : null;
      if (sl?.status === 'cut') {
        ar.supply.food = Math.max(0, ar.supply.food - 1);
        for (const uId of ar.unitIds) {
          const u = getUnit(uId);
          if (u) {
            u.fatigue = clamp(u.fatigue + 2, 0, 100);
            if (ar.supply.food < unitMembers(u).length) u.morale = clamp(u.morale - 2, 0, 100);
          }
        }
        if (ar.supply.food <= 0 && chance(0.08)) {
          EventSystem.add('war', `🍞 กองทัพ${ar.name}อดอยากบนรบ — ขวัญกำลังทัพทรุด`);
          ar.morale = clamp(ar.morale - 8, 0, 100);
          const cmd = getAgent(ar.commanderId);
          if (cmd && typeof AgentMemorySystem !== 'undefined') AgentMemorySystem.recordPersonalEvent(cmd, 'starved_on_campaign', 'อดอยากบนรบ', ar.name, 3, {});
        }
      }
    }
    if (world.day % 2 === 0) this.updateSupplyLines();
    this.updateCamps();
    this.validateOrphans();
  },

  validateOrphans() {
    const armyIds = new Set(world.armies.map(a => a.id));
    world.supplyLines = (world.supplyLines || []).filter(sl => armyIds.has(sl.armyId) || sl.status !== 'collapsed');
    world.armyCamps = (world.armyCamps || []).filter(c => armyIds.has(c.armyId));
    for (const sl of world.supplyLines || []) {
      sl.routePath = (sl.routePath || []).filter(id => getSettlement(id));
      if (sl.routePath.length < 2) sl.status = 'collapsed';
    }
  },

  rankings() {
    const lines = (world.supplyLines || []).filter(sl => sl.status !== 'collapsed');
    const vulnerable = lines.slice().sort((a, b) => b.danger - a.danger).slice(0, 8);
    const lowSupply = world.armies.filter(ar => {
      const men = sum(ar.unitIds.map(getUnit), u => unitMembers(u).length);
      return men > 0 && ar.supply.food < men * 2;
    }).slice(0, 8);
    const sieges = world.settlements.filter(s => s.siege);
    const campaigns = world.armies.filter(ar => ar.objective?.type === 'attack' || ar.travel);
    return { vulnerable, lowSupply, sieges, campaigns, scoutReports: (world.scoutReports || []).slice(-12).reverse() };
  },

  /* Sandbox helpers */
  forceSupplyCrisis(ar) {
    if (!ar) return;
    const sl = ar.supplyLineId ? this.getSupplyLine(ar.supplyLineId) : null;
    if (sl) this.cutSupplyLine(sl, '[Sandbox] วิกฤตเสบียง');
    ar.supply.food = Math.max(0, Math.floor(ar.supply.food * 0.2));
    ar.morale = clamp(ar.morale - 15, 0, 100);
  },

  spawnScoutUnit(ar) {
    if (!ar) return;
    this.runArmyScouts(ar);
    this.addScoutReport({ locationId: ar.locationId, targetType: 'scout_enemy_army', estimatedPower: 50, confidence: 0.8, threat: 'medium', sourceUnitId: ar.commanderId, armyId: ar.id });
  },

  giveSiegeEquipment(ar) {
    if (!ar) return;
    ar.siegeEquipment = { ladders: 1, ram: 1, tower: 1, catapult: 0, buildDays: 20, ready: true };
  },

  forceAmbush(routeId) {
    const r = world.routes.find(x => x.id === routeId);
    if (!r) return;
    const ar = world.armies[0];
    if (ar) this.checkTravelAmbush(ar, r, r.a, r.b);
  },

  setWarGoal(fA, fB, goal) {
    const w = activeWarBetween(fA?.id, fB?.id);
    if (w && WAR_GOAL_TYPES.includes(goal)) w.goal = goal;
    for (const ar of world.armies.filter(a => a.factionId === fA?.id)) ar.warGoal = goal;
  }
};

function getArmyCamp(id) { return CampaignWarfareSystem.getArmyCamp(id); }

/* ═══════════════════ 11. TRADER SYSTEM ═══════════════════ */

const TraderSystem = {
  planTrade(a, s) {
    if (a.cargo) return;
    if (!a.contractId && !a.pendingContractId) MarketTradeSystem.traderConsiderContract(a);
    if (a.cargo || a.contractId || a.pendingContractId) return;
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
        const path = findPath(s.id, d.id, a.traits.riskTolerance < 0.35, a);
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
        let expected = (sellPrice * 0.85 * (1 - d.taxRate) - buyPrice) * qty
          - travelCost + gapBonus
          - risk * qty * buyPrice * (1.2 - a.traits.riskTolerance);
        if (typeof AgentMemorySystem !== 'undefined') expected -= AgentMemorySystem.pathAvoidPenalty(a, path);
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

    if (a.pendingContractId) {
      const pc = getContract(a.pendingContractId);
      if (pc && a.locationId === pc.originId) {
        MarketTradeSystem.pickupContract(a, pc);
        return;
      }
    }
    if (MarketTradeSystem.onTraderArriveContract(a)) return;

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
        if (typeof AgentMemorySystem !== 'undefined') AgentMemorySystem.onTradeSuccess(a, profit);
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
      const score = r.traffic * 4 - r.patrolLevel * 8 + r.danger * 5
        + (typeof MarketTradeSystem !== 'undefined' ? MarketTradeSystem.routeTradeValue(r) * 0.08 : 0);
      if (score > bestScore) { bestScore = score; best = { type: 'ambush', routeId: r.id, atId: chance(0.5) ? r.a : r.b }; }
    }
    // ตัวเลือก 2: ปล้นหมู่บ้านที่ป้องกันอ่อน
    for (const s of world.settlements) {
      if (s.type === 'camp' || s.factionId === u.factionId) continue;
      const garrisonPower = s.garrisonUnitId ? MilitarySystem.unitPower(getUnit(s.garrisonUnitId)) : 0;
      const wallMod = s.buildings.includes('Wall') ? 2 : 1;
      const lootValue = s.stock.food * 0.5 + s.treasury * 0.1 + s.stock.weapons * 2
        + sum((world.warehouses || []).filter(w => w.settlementId === s.id), w => sum(GOODS, g => w.stock[g] || 0)) * 0.3
        + (s.marketRole?.isMarketHub ? 25 : 0);
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
      if (trader.contractId) MarketTradeSystem.onContractCaravanLost(trader);
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
      if (typeof AgentMemorySystem !== 'undefined') {
        const robberIds = ambusher ? unitMembers(ambusher).map(m => m.id) : [];
        AgentMemorySystem.onRobbed(trader, r, robberIds);
      }
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
    if (!Number.isFinite(u.combatPower)) u.combatPower = power || 0;
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
    let terrain = context.terrain || (context.kind === 'raid' ? 'close' : 'field');
    let terrainType = context.terrainType;
    if (!terrainType && context.settlementId) {
      const st = getSettlement(context.settlementId);
      if (st) {
        terrainType = st.terrain || inferSettlementTerrain(st);
        const tc = terrainBattleContext(terrainType);
        terrain = tc.kind;
        context._terrainAtk = tc.atk;
        context._terrainDef = tc.def;
      }
    } else if (terrainType) {
      const tc = terrainBattleContext(terrainType);
      terrain = tc.kind;
      context._terrainAtk = tc.atk;
      context._terrainDef = tc.def;
    }
    context.terrain = terrain;
    const totalMen = sum(attackerUnits, u => unitMembers(u).length) + sum(defenderUnits, u => unitMembers(u).length);
    const bName = battleName(context.kind || 'field', context.label || '?', totalMen);

    if (totalMen >= 6 && !context.skipPhased && typeof LargeBattlefieldSystem !== 'undefined' && LargeBattlefieldSystem.isLargeBattle(attackerUnits, defenderUnits)) {
      const ar = attackerUnits[0]?.armyId ? getArmy(attackerUnits[0].armyId) : null;
      context.strategy = ar?.strategyProfile?.preferredStrategy;
      if (ar?.supplyLineId && typeof CampaignWarfareSystem !== 'undefined') {
        const sl = CampaignWarfareSystem.getSupplyLine(ar.supplyLineId);
        context.supplyCut = sl?.status === 'cut';
      }
      if (ar?.siegeEquipment) context.siegeEquipment = ar.siegeEquipment;
      context.scoutIntel = (world.scoutReports || []).some(r => r.armyId === ar?.id);
      const large = LargeBattlefieldSystem.runLargeBattle(attackerUnits, defenderUnits, context);
      const attackerWins = large.attackerWins;
      CombatSystem.applyBattleWear(attackerUnits, attackerWins);
      CombatSystem.applyBattleWear(defenderUnits, !attackerWins);
      for (const u of attackerUnits) {
        if (attackerWins) u.recentVictories = (u.recentVictories || 0) + 1;
        const leader = getAgent(u.leaderId);
        if (leader && attackerWins) { leader.fame = (leader.fame || 0) + 2; this.checkPromotion(leader); }
      }
      recordWarBattle(context.atkFactionId, context.defFactionId, bName, large.totalDead, attackerWins);
      if (typeof AgentMemorySystem !== 'undefined') {
        AgentMemorySystem.onBattleEnd(attackerUnits, attackerWins, bName, context.settlementId);
        AgentMemorySystem.onBattleEnd(defenderUnits, !attackerWins, bName, context.settlementId);
      }
      return { attackerWins, atkPower: large.atkPower, defPower: large.defPower, atkResult: large.atkResult, defResult: large.defResult, name: bName, totalDead: large.totalDead, pursuitLosses: large.pursuitLosses, battleReport: large.battleReport, large: true };
    }

    if (totalMen >= 6 && !context.skipPhased && typeof TextCombatCore !== 'undefined') {
      const ar = attackerUnits[0]?.armyId ? getArmy(attackerUnits[0].armyId) : null;
      context.strategy = ar?.strategyProfile?.preferredStrategy;
      if (ar?.supplyLineId && typeof CampaignWarfareSystem !== 'undefined') {
        const sl = CampaignWarfareSystem.getSupplyLine(ar.supplyLineId);
        context.supplyCut = sl?.status === 'cut';
      }
      const phased = CombatSystem.runPhasedBattle(attackerUnits, defenderUnits, context);
      const attackerWins = phased.attackerWins;
      CombatSystem.applyBattleWear(attackerUnits, attackerWins);
      CombatSystem.applyBattleWear(defenderUnits, !attackerWins);
      for (const u of attackerUnits) {
        if (attackerWins) u.recentVictories = (u.recentVictories || 0) + 1;
        const leader = getAgent(u.leaderId);
        if (leader && attackerWins) { leader.fame = (leader.fame || 0) + 1; this.checkPromotion(leader); }
      }
      recordWarBattle(context.atkFactionId, context.defFactionId, bName, phased.totalDead, attackerWins);
      if (typeof AgentMemorySystem !== 'undefined') {
        AgentMemorySystem.onBattleEnd(attackerUnits, attackerWins, bName, context.settlementId);
        AgentMemorySystem.onBattleEnd(defenderUnits, !attackerWins, bName, context.settlementId);
      }
      return { attackerWins, atkPower: phased.atkPower, defPower: phased.defPower, atkResult: phased.atkResult, defResult: phased.defResult, name: bName, totalDead: phased.totalDead, pursuitLosses: phased.pursuitLosses, battleReport: phased.battleReport };
    }

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
    atkPower *= rand(0.82, 1.18) * (context._terrainAtk || 1);
    defPower = (defPower + (context.defenseBonus || 0)) * rand(0.82, 1.18) * (context._terrainDef || 1);
    const attackerWins = atkPower > defPower;
    const ratio = clamp(Math.min(atkPower, defPower) / Math.max(atkPower, defPower, 1), 0.1, 1);

    const applyCasualties = (units, lossRate, won) => {
      let dead = 0, fled = 0;
      for (const u of units) {
        const members = unitMembers(u);
        for (const m of members) {
          if (chance(lossRate)) {
            if (chance(0.65)) { NeedSystem.kill(m, 'ตายในสนามรบ'); dead++; }
            else {
              const leader = getAgent(u.leaderId);
              const resist = typeof AgentMemorySystem !== 'undefined' ? AgentMemorySystem.desertionResist(m, leader) : 0;
              if (chance(0.45 - resist)) {
                m.unitId = null;
                u.memberIds = u.memberIds.filter(id => id !== m.id);
                m.profession = 'refugee';
                m.stats.morale = 20;
                fled++;
              } else {
                m.stats.morale = clamp(m.stats.morale - 12, 0, 100);
              }
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
    let pursuitLosses = 0;
    if (!attackerWins && context.allowRetreat !== false && typeof CampaignWarfareSystem !== 'undefined') {
      const pr = CampaignWarfareSystem.handleBattleRetreat(attackerUnits, defenderUnits, true, context);
      pursuitLosses = pr.pursuitLosses || 0;
    } else if (attackerWins && context.allowRetreat !== false && typeof CampaignWarfareSystem !== 'undefined' && context.kind !== 'raid') {
      const pr = CampaignWarfareSystem.handleBattleRetreat(defenderUnits, attackerUnits, false, context);
      pursuitLosses = pr.pursuitLosses || 0;
    }

    CombatSystem.applyBattleWear(attackerUnits, attackerWins);
    CombatSystem.applyBattleWear(defenderUnits, !attackerWins);
    for (const u of attackerUnits) {
      if (attackerWins) u.recentVictories = (u.recentVictories || 0) + 1;
      const leader = getAgent(u.leaderId);
      if (leader && attackerWins) leader.fame = (leader.fame || 0) + 1;
    }

    // ── บันทึกประวัติศาสตร์: ศึกใหญ่ลง chronicle / ศึกในสงครามลง war object ──
    recordWarBattle(context.atkFactionId, context.defFactionId, bName, totalDead, attackerWins);
    if (typeof AgentMemorySystem !== 'undefined') {
      AgentMemorySystem.onBattleEnd(attackerUnits, attackerWins, bName, context.settlementId);
      AgentMemorySystem.onBattleEnd(defenderUnits, !attackerWins, bName, context.settlementId);
    }
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

    return { attackerWins, atkPower, defPower, atkResult, defResult, name: bName, totalDead, pursuitLosses };
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
  resolveCapture(attUnits, attFaction, commander, s, ctx) {
    if (typeof SovereigntySystem !== 'undefined') {
      return SovereigntySystem.resolveSettlementCapture(attUnits, attFaction, commander, s, ctx || {});
    }
    return this._resolveCaptureBattle(attUnits, attFaction, commander, s);
  },

  _resolveCaptureBattle(attUnits, attFaction, commander, s) {
    const garrison = s.garrisonUnitId ? getUnit(s.garrisonUnitId) : null;
    const defUnits = garrison ? [garrison] : [];
    let defenseBonus = (s.buildings.includes('Wall') ? 60 : 0) + s.security * 0.5 +
      (s.type === 'fort' ? 50 : s.type === 'castle' ? 90 : 0);
    const ar = attUnits[0]?.armyId ? getArmy(attUnits[0].armyId) : null;
    if (ar && typeof CampaignWarfareSystem !== 'undefined') defenseBonus += CampaignWarfareSystem.siegeDefenseBonus(s, ar);
    const oldFaction = getFaction(s.factionId);
    const hateOpen = oldFaction && (s.sentiment?.hatedFactions?.[oldFaction.id] || 0) > 25;
    const gatesOpen = (s.unrest > 65 && s.loyalty < 30 || hateOpen) && chance(0.4 + (hateOpen ? 0.25 : 0));
    const result = gatesOpen ? { attackerWins: true, atkResult: { dead: 0 }, defResult: { dead: 0 } }
      : this.battle(attUnits, defUnits, {
          defenseBonus, label: s.name, kind: 'capture', settlementId: s.id,
          atkFactionId: attFaction?.id, defFactionId: s.factionId
        });
    return !!result.attackerWins;
  },

  _legacyResolveCapture(attUnits, attFaction, commander, s) {
    const garrison = s.garrisonUnitId ? getUnit(s.garrisonUnitId) : null;
    const defUnits = garrison ? [garrison] : [];
    let defenseBonus = (s.buildings.includes('Wall') ? 60 : 0) + s.security * 0.5 +
      (s.type === 'fort' ? 50 : s.type === 'castle' ? 90 : 0);
    const ar = attUnits[0]?.armyId ? getArmy(attUnits[0].armyId) : null;
    if (ar && typeof CampaignWarfareSystem !== 'undefined') defenseBonus += CampaignWarfareSystem.siegeDefenseBonus(s, ar);
    // เมือง unrest สูง loyalty ต่ำ อาจเปิดประตู
    const oldFaction = getFaction(s.factionId);
    const hateOpen = oldFaction && (s.sentiment?.hatedFactions?.[oldFaction.id] || 0) > 25;
    const gatesOpen = (s.unrest > 65 && s.loyalty < 30 || hateOpen) && chance(0.4 + (hateOpen ? 0.25 : 0));
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
      if (typeof AgentMemorySystem !== 'undefined') AgentMemorySystem.onCityCaptured(s, commander.id, oldFaction?.id);
      if (typeof ObserverSystem !== 'undefined') {
        ObserverSystem.onMajorEvent('city_captured', `${s.name} เปลี่ยนมือ — ${attFaction.name}`, {
          settlements: [s.id], agents: [commander.id], factions: [attFaction.id, oldFaction ? oldFaction.id : null].filter(x => x)
        });
      }
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
            if (typeof CampaignWarfareSystem !== 'undefined') CampaignWarfareSystem.establishCamp(ar);
            const war = activeWarBetween(faction.id, target.factionId);
            if (war) war.sieges = (war.sieges || 0) + 1;
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
          const captured = this.resolveCapture(units, faction, commander || getAgent(units[0].leaderId), target, { armyId: ar?.id });
          target.siege = null;
          if (captured) {
            const war = oldFactionId ? activeWarBetween(ar.factionId, oldFactionId) : null;
            if (war) {
              war.goalAchieved = true;
              endWar(war, ar.factionId, 'ฝ่ายบุกบรรลุเป้าหมายสงคราม');
            }
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
        settlementHistory(s, `ยอมจำนนหลังถูกล้อม ${s.siege.days} วัน`);
        const siegeDays = s.siege.days;
        const oldFactionId = s.factionId;
        s.siege = null;
        if (faction && commander) {
          const captured = this.resolveCapture(ar.unitIds.map(getUnit).filter(Boolean), faction, commander, s, { armyId: ar.id });
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
      if (typeof AgentMemorySystem !== 'undefined') AgentMemorySystem.onCityStarved(s);
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
    const taxBefore = s.taxRate;
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
    if (s.taxRate > taxBefore + 0.008 && typeof AgentMemorySystem !== 'undefined') {
      AgentMemorySystem.onTaxRaised(gov, s, s.taxRate);
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

    if (typeof MarketTradeSystem !== 'undefined') MarketTradeSystem.governorDevelopHub(gov, s);

    /* governor อิสระ/กบฏ: ambition สูง loyalty ต่ำ กองกำลังพร้อม */
    if (gov.gov && s.governorId === gov.id && s.ownerId !== gov.id) {
      const faction = getFaction(s.factionId);
      if (faction && faction.rulerId !== gov.id) {
        gov.gov.loyalty = clamp(gov.gov.loyalty + (s.prosperity > 60 ? 0.002 : -0.003) - gov.gov.ambition * 0.002, 0, 1);
        const ruler = faction.rulerId ? getAgent(faction.rulerId) : null;
        if (ruler && typeof AgentMemorySystem !== 'undefined') {
          gov.gov.loyalty = clamp(gov.gov.loyalty + AgentMemorySystem.governorLoyaltyModifier(gov, ruler.id) * 0.002, 0, 1);
        }
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
    if (typeof ObserverSystem !== 'undefined') {
      ObserverSystem.onMajorEvent('rebellion', `${gov.name} ประกาศเอกราช${s.name}`, {
        agents: [gov.id], settlements: [s.id], factions: [newF.id, oldFaction.id]
      });
    }
    const oldRuler = getAgent(oldFaction.rulerId);
    if (oldRuler && typeof AgentMemorySystem !== 'undefined') {
      addGrudge(oldRuler, gov.id, 'betrayed_by_faction', 28);
      AgentMemorySystem.recordPersonalEvent(gov, 'betrayed_by_faction', `ทรยศ${oldFaction.name}`,
        `${gov.name} แยก${s.name}ออกจาก${oldFaction.name}`, 4, { agents: [oldRuler.id], factions: [oldFaction.id, newF.id] });
    }
  },

  appointGovernor(s) {
    const faction = getFaction(s.factionId);
    if (!faction || faction.isBandit) return;
    const candidates = agentsAt(s.id).filter(a => a.alive && !a.unitId &&
      (a.skills.governance > 1 || a.skills.leadership > 2 || a.traits.ambition > 0.7));
    if (!candidates.length) return;
    const best = candidates.reduce((m, x) => {
      const hero = (s.sentiment?.heroes?.[x.id] || 0) * 0.04;
      const score = x.skills.governance + x.skills.leadership + hero;
      const mScore = m.skills.governance + m.skills.leadership + (s.sentiment?.heroes?.[m.id] || 0) * 0.04;
      return score > mScore ? x : m;
    }, candidates[0]);
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
      EventSystem.add('politics', `👑 กบฏยึด${s.name}สำเร็จ! ${leader.name} สถาปนา${newF.name}`, {
        settlements: [s.id], agents: [leader.id], factions: [newF.id, oldFaction ? oldFaction.id : null].filter(x => x)
      });
      settlementHistory(s, `กบฏยึดเมือง ตั้ง${newF.name} ภายใต้${leader.name}`);
      if (typeof ObserverSystem !== 'undefined') {
        ObserverSystem.onMajorEvent('rebellion', `กบฏยึด${s.name} — ${newF.name}`, {
          settlements: [s.id], agents: [leader.id], factions: [newF.id, oldFaction ? oldFaction.id : null].filter(x => x)
        });
      }
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
    const capital = world.settlements.find(s => s.factionId === f.id && (s.type === 'castle' || s.type === 'town'));
    if (!capital) return;
    const target = typeof CampaignWarfareSystem !== 'undefined'
      ? (CampaignWarfareSystem.pickCampaignTarget(f, enemyF, activeWarBetween(f.id, enemyF.id)?.goal || 'capture_settlement') || enemySettlements[0])
      : enemySettlements.reduce((m, x) => {
        const gm = m.garrisonUnitId ? MilitarySystem.unitPower(getUnit(m.garrisonUnitId)) : 0;
        const gx = x.garrisonUnitId ? MilitarySystem.unitPower(getUnit(x.garrisonUnitId)) : 0;
        return gx < gm ? x : m;
      }, enemySettlements[0]);
    if (!target) return;

    // Phase 18.3: ระดมพลจาก agent จริง — ไม่เสกทหาร
    if (typeof OrganizationSystem !== 'undefined') {
      const org = world.organizations.find(o => o.factionId === f.id && o.type === 'royal_army' && o.status === 'active');
      const readyWbs = world.warbands.filter(wb =>
        wb.factionId === f.id && wb.type === 'royal_army' && warbandMembers(wb).length >= 6 &&
        wb.status !== 'disbanding' && !wb.travel
      );
      if (!readyWbs.length) {
        OrganizationSystem.raiseCallToArms(f, ruler, target);
        EventSystem.add('war', `📯 ${f.name} ประกาศระดมพล — รออาสาสมัครเดินทางมารวมพล`);
        if (capital) capital.warDemand = Math.min(10, capital.warDemand + 2);
        return;
      }
      const myUnits = [];
      for (const wb of readyWbs) {
        const u = WarbandSystem.warbandAsUnits(wb)[0];
        if (u && unitMembers(u).length >= 4) myUnits.push(u);
      }
      if (!myUnits.length) return;
      const commander = world.agents.filter(a => a.alive && a.factionId === f.id && (MILITARY_PROFS.has(a.profession) || RULER_PROFS.has(a.profession)))
        .reduce((m, x) => (x.skills.leadership + x.skills.tactics) > (m.skills.leadership + m.skills.tactics) ? x : m, ruler);
      const foodBought = Math.min(capital.stock.food * 0.3, 200);
      capital.stock.food -= foodBought;
      const ar = createArmy({
        name: `กองทัพ${f.name}`, commanderId: commander.id, factionId: f.id,
        unitIds: myUnits.map(u => u.id), locationId: myUnits[0].locationId,
        objective: { type: 'attack', targetId: target.id }, food: foodBought,
        baseSettlementId: capital.id,
        warGoal: typeof CampaignWarfareSystem !== 'undefined' ? CampaignWarfareSystem.pickWarGoal(f, enemyF, target) : 'capture_settlement'
      });
      if (typeof CampaignWarfareSystem !== 'undefined') {
        CampaignWarfareSystem.ensureArmy(ar);
        CampaignWarfareSystem.computeStrategyProfile(commander, ar);
        CampaignWarfareSystem.createSupplyLine(ar, capital.id, target.id);
      }
      for (const u of myUnits) {
        u.armyId = ar.id;
        u.locationId = ar.locationId;
        for (const m of unitMembers(u)) m.locationId = ar.locationId;
        const wb = world.warbands.find(w => w.unitIds?.includes(u.id));
        if (wb) { wb.objective = { type: 'join_campaign', targetId: target.id }; WarbandSystem.startMarch(wb, target.id, 'war'); }
      }
      startTravel(ar, target.id, 'war');
      const totalMen = sum(myUnits, u => unitMembers(u).length);
      EventSystem.add('war', `⚔🔥 ${f.name} ยกทัพ ${totalMen} นาย (จาก warband จริง) นำโดย ${commander.name} มุ่งโจมตี${target.name}!`);
      if (org) OrganizationSystem.orgLog(org, `ยกทัพ ${totalMen} นายจาก warband`);
      if (capital) capital.warDemand = Math.min(10, capital.warDemand + 4);
      return;
    }
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
    if (typeof ObserverSystem !== 'undefined') {
      ObserverSystem.onMajorEvent('faction_collapse', `${f.name} ล่มสลาย`, { factions: [f.id] });
    }
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

function defaultFactionRelation() {
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
  if (!fA || !fB || fA.id === fB.id) return defaultFactionRelation();
  ensureFactionDiplomacy(fA);
  if (!fA.diplomacy.relations[fB.id]) {
    const r = defaultFactionRelation();
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
  EventSystem.add('diplomacy', `⚔ ${fA.name} หักหลัง${fB.name}! (${reason})`, { factions: [fA.id, fB.id] });
  Chronicle.add({ category: 'diplomacy', importance: 5, title: `⚔ การทรยศทางการทูต: ${fA.name} หักหลัง ${fB.name}`, description: reason, factions: [fA.id, fB.id] });
  if (typeof ObserverSystem !== 'undefined') {
    ObserverSystem.onMajorEvent('treaty_betrayal', `${fA.name} หักหลัง ${fB.name}`, { factions: [fA.id, fB.id] });
  }
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

    let warScore = (theirPow < myPow * 0.7 ? 25 : 0) + r.borderTension * 0.4 + rs.ambition * 30
      - exhaustion * 0.5 - (r.tradeValue * 0.3) - (r.score > 20 ? r.score * 0.2 : 0)
      - (r.nonAggressionUntilDay > world.day ? 50 : 0)
      - (areAllied(f, other) ? 80 : 0);
    const peaceScore = exhaustion * 0.8 + (f.treasury < 200 ? 15 : 0) + (this.foodReserve(f) < 80 ? 20 : 0)
      - (myPow > theirPow * 1.3 ? 20 : 0);
    const vassalScore = (theirPow > myPow * 1.4 ? 30 : 0) + (this.foodReserve(f) < 60 ? 15 : 0)
      - rs.ambition * 25 - (myPow > 50 ? 10 : 0);
    let allianceScore = r.trust * 0.3 + r.tradeValue * 0.4 + (r.rivalry > 30 ? -20 : 0)
      - (r.score < -20 ? 30 : 0);

    const warThresh = f.diplomacy.diplomaticPersonality === 'aggressive' ? 35 : f.diplomacy.diplomaticPersonality === 'defensive' ? 55 : 45;
    const tradePen = typeof MarketTradeSystem !== 'undefined' ? MarketTradeSystem.diplomacyTradeWeight(f) : 0;
    if (f.diplomacy.diplomaticPersonality === 'trader') warScore -= tradePen * 1.5;
    else warScore -= tradePen * 0.6;
    const rulerA = getAgent(f.rulerId), rulerB = getAgent(other.rulerId);
    if (typeof AgentMemorySystem !== 'undefined' && rulerA && rulerB) {
      warScore += AgentMemorySystem.rulerBetrayalModifier(rulerA, rulerB.id);
      allianceScore += AgentMemorySystem.governorLoyaltyModifier(rulerA, rulerB.id) * 0.25;
    }
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
    const peaceScore = exhaustion * 0.9 + (f.treasury < 150 ? 20 : 0) - rs.ambition * 25
      + (typeof MarketTradeSystem !== 'undefined' ? MarketTradeSystem.diplomacyTradeWeight(f) * 0.5 : 0);
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
  MarketTradeSystem.tickDaily();
  if (typeof AgentMemorySystem !== 'undefined') AgentMemorySystem.tickDaily();
  if (typeof CampaignWarfareSystem !== 'undefined') CampaignWarfareSystem.tickDaily();
  if (typeof OrganizationSystem !== 'undefined') OrganizationSystem.tickDaily();
  if (typeof WarbandSystem !== 'undefined') WarbandSystem.tickDaily();
  if (typeof SovereigntySystem !== 'undefined') {
    SovereigntySystem.tickDaily();
    if (world.day % 50 === 0) SovereigntySystem.validateNoGhostOwners();
  }
  if (typeof TextCombatCore !== 'undefined') TextCombatCore.tickInjuries();

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
  UI.dashboardDirty = true;
  if (world.day % 10 === 0 && typeof UIIndexes !== 'undefined') UIIndexes.markDirty();
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
  } else if (world.marketIndex && world.marketIndex.tradeHealth > 78 && world.marketIndex.foodIndex < 1.4) {
    theme = 'ยุคทองแห่งการค้า';
    detail = `ตลาดรุ่งเรือง trade health ${fmt(world.marketIndex.tradeHealth, 0)} ปริมาณค้า ${fmt(world.marketIndex.totalTradeVolume, 0)} ดัชนีอาหาร ${fmt(world.marketIndex.foodIndex, 2)}`;
  } else if (world.marketIndex && world.marketIndex.foodIndex > 2.2) {
    theme = 'วิกฤตราคาอาหาร';
    detail = `ดัชนีอาหารพุ่ง ${fmt(world.marketIndex.foodIndex, 2)} ความผันผวน ${fmt(world.marketIndex.volatility, 1)} — ชาวบ้านและพ่อค้าเดือดร้อน`;
  } else if ((world.guilds || []).length >= 2 && world.marketIndex?.tradeHealth > 65) {
    theme = 'ยุคสมาคมพ่อค้าครองเมือง';
    detail = `สมาคมพ่อค้า ${world.guilds.length} แห่งชี้นำเส้นเลือดเศรษฐกิจของแผ่นดิน`;
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

/* ═══════════════════ 15.5 PHASE 15: OBSERVER UX ═══════════════════ */

const ObserverSystem = {
  rankingTab: 'famous',
  follow: null,
  logFilter: 'all',
  logSearch: '',
  observerOpen: false,
  observerDirty: true,
  _toastTimer: null,
  pauseOn: {
    war_declaration: true,
    city_captured: true,
    faction_collapse: true,
    legendary_death: true,
    rebellion: true,
    treaty_betrayal: true
  },

  defaultPauseOn() {
    return {
      war_declaration: true, city_captured: true, faction_collapse: true,
      legendary_death: true, rebellion: true, treaty_betrayal: true
    };
  },

  init() {
    const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    bind('btnObserver', () => this.togglePanel());
    bind('observerClose', () => this.closePanel());
    bind('btnOrganizations', () => {
      this.observerOpen = true;
      this.rankingTab = 'organizations';
      document.getElementById('observerPanel')?.classList.remove('hidden');
      document.querySelectorAll('.obs-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'organizations'));
      this.renderPanel();
    });
    for (const btn of document.querySelectorAll('.obs-tab')) {
      btn.addEventListener('click', () => {
        this.rankingTab = btn.dataset.tab;
        document.querySelectorAll('.obs-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === this.rankingTab));
        this.renderPanel();
      });
    }
    const search = document.getElementById('globalSearch');
    if (search) {
      search.addEventListener('input', () => {
        this.renderSearchResults(search.value.trim());
      });
      search.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          const results = this.search(search.value.trim());
          if (results.length) this.focusTarget(results[0].kind, results[0].id);
        }
      });
    }
    for (const cb of document.querySelectorAll('.pause-on-cb')) {
      cb.addEventListener('change', () => {
        this.pauseOn[cb.dataset.pause] = cb.checked;
      });
    }
    for (const btn of document.querySelectorAll('.log-filter')) {
      btn.addEventListener('click', () => {
        this.logFilter = btn.dataset.f;
        document.querySelectorAll('.log-filter').forEach(b => b.classList.toggle('active', b.dataset.f === this.logFilter));
        UI.logDirty = true;
      });
    }
    const logSearch = document.getElementById('logSearch');
    if (logSearch) {
      logSearch.addEventListener('input', () => {
        this.logSearch = logSearch.value.trim().toLowerCase();
        UI.logDirty = true;
      });
    }
    this.syncPauseTogglesUI();
  },

  syncPauseTogglesUI() {
    for (const cb of document.querySelectorAll('.pause-on-cb')) {
      if (cb.dataset.pause) cb.checked = !!this.pauseOn[cb.dataset.pause];
    }
  },

  togglePanel() {
    this.observerOpen = !this.observerOpen;
    const p = document.getElementById('observerPanel');
    if (p) p.classList.toggle('hidden', !this.observerOpen);
    document.getElementById('chroniclePanel')?.classList.add('hidden');
    document.getElementById('diplomacyPanel')?.classList.add('hidden');
    document.getElementById('summaryModal')?.classList.add('hidden');
    document.getElementById('savePanel')?.classList.add('hidden');
    document.getElementById('marketPanel')?.classList.add('hidden');
    UI.marketOpen = false;
    UI.chronicleOpen = false;
    if (this.observerOpen) { this.observerDirty = true; this.renderPanel(); }
  },

  markDirty() { this.observerDirty = true; },

  closePanel() {
    this.observerOpen = false;
    document.getElementById('observerPanel')?.classList.add('hidden');
  },

  computeRankings() {
    if (!world) return null;
    const alive = world.agents.filter(a => a.alive);
    const mkts = marketSettlements();
    const liveFactions = world.factions.filter(fc => world.settlements.some(s => s.factionId === fc.id));
    const factionPower = f => {
      if (!f) return 0;
      return world.settlements.filter(s => s.factionId === f.id).length * 100
        + alive.filter(a => a.factionId === f.id && MILITARY_PROFS.has(a.profession)).length * 10
        + (f.treasury || 0) * 0.1;
    };
    const units = world.units.filter(u => unitMembers(u).length > 0).map(u => ({
      unit: u,
      power: u.combatPower || MilitarySystem.unitPower(u),
      members: unitMembers(u).length
    })).sort((a, b) => b.power - a.power).slice(0, 10);
    const armies = world.armies.map(ar => {
      const units = ar.unitIds.map(getUnit).filter(Boolean);
      const power = sum(units, u => u.combatPower || MilitarySystem.unitPower(u));
      return { army: ar, power, size: sum(units, u => unitMembers(u).length) };
    }).sort((a, b) => b.power - a.power).slice(0, 10);
    return {
      famousAgents: alive.filter(a => a.fame > 0).sort((a, b) => b.fame - a.fame).slice(0, 10),
      richestAgents: alive.slice().sort((a, b) => b.money - a.money).slice(0, 10),
      strongestUnits: units,
      strongestArmies: armies,
      prosperousSettlements: mkts.slice().sort((a, b) => b.prosperity - a.prosperity).slice(0, 10),
      starvingSettlements: mkts.filter(s => s.stock.food < 15 && populationOf(s) > 3)
        .sort((a, b) => a.stock.food - b.stock.food).slice(0, 10),
      dangerousRoutes: world.routes.filter(r => !r.destroyed).slice()
        .sort((a, b) => b.danger - a.danger).slice(0, 10),
      strongestFactions: liveFactions.map(f => ({ f, power: factionPower(f) }))
        .sort((a, b) => b.power - a.power).slice(0, 10),
      exhaustedFactions: liveFactions.filter(f => !f.isBandit && f.diplomacy)
        .map(f => ({ f, ex: f.diplomacy.warExhaustion || 0 }))
        .sort((a, b) => b.ex - a.ex).slice(0, 10),
      activeWars: world.wars.filter(w => !w.endDay),
      activeTreaties: (world.treaties || []).filter(t => t.status === 'active'),
      recentEvents: world.chronicle.slice(-20).reverse()
    };
  },

  search(query) {
    if (!world || !query) return [];
    const q = query.toLowerCase().trim();
    if (!q) return [];
    const results = [];
    const push = (kind, id, label, sub) => {
      if (results.some(r => r.kind === kind && r.id === id)) return;
      results.push({ kind, id, label, sub: sub || '' });
    };
    for (const a of world.agents) {
      if (!a.alive) continue;
      const hay = [a.name, a.title, a.profession, a.rank, a.currentGoal].filter(Boolean).join(' ').toLowerCase();
      if (hay.includes(q)) push(a.cargo ? 'agent' : 'agent', a.id, a.name + (a.title ? ` "${a.title}"` : ''), a.profession + (a.cargo ? ' · คาราวาน' : ''));
    }
    for (const s of world.settlements) {
      if (s.name.toLowerCase().includes(q)) push('settlement', s.id, s.name, s.type);
    }
    for (const f of world.factions) {
      if (f.name.toLowerCase().includes(q)) push('faction', f.id, f.name, f.warState ? 'สงคราม' : 'ฝ่าย');
    }
    for (const u of world.units) {
      if (unitMembers(u).length && u.name.toLowerCase().includes(q)) push('unit', u.id, u.name, `${unitMembers(u).length} คน`);
    }
    for (const ar of world.armies) {
      if (ar.name.toLowerCase().includes(q)) push('army', ar.id, ar.name, `${ar.unitIds.length} หน่วย`);
    }
    for (const g of (world.guilds || [])) {
      if (g.name.toLowerCase().includes(q)) {
        push('settlement', g.homeSettlementId, g.name, 'guild');
      }
    }
    for (const org of (world.organizations || [])) {
      if (org.name.toLowerCase().includes(q) || org.type.includes(q)) push('organization', org.id, org.name, org.type);
    }
    for (const wb of (world.warbands || [])) {
      if (wb.name.toLowerCase().includes(q) || wb.type.includes(q) || wb.status.includes(q)) {
        push('warband', wb.id, wb.name, `${warbandMembers(wb).length} คน · ${wb.status}`);
      }
    }
    if (q.includes('marching') || q.includes('เดินทัพ')) {
      for (const wb of (world.warbands || []).filter(w => w.status === 'marching' || w.travel)) {
        push('warband', wb.id, wb.name, 'marching');
      }
    }
    if (q.includes('bandit') || q.includes('โจร')) {
      for (const wb of (world.warbands || []).filter(w => w.type === 'bandit_gang')) push('warband', wb.id, wb.name, 'bandit');
      for (const org of (world.organizations || []).filter(o => o.type === 'bandit_gang')) push('organization', org.id, org.name, 'bandit gang');
    }
    if (q.includes('mercenary') || q.includes('รับจ้าง')) {
      for (const org of (world.organizations || []).filter(o => o.type === 'mercenary_company')) push('organization', org.id, org.name, 'mercenary');
    }
    if (q.includes('militia') || q.includes('อาสา')) {
      for (const org of (world.organizations || []).filter(o => o.type === 'militia_company')) push('organization', org.id, org.name, 'militia');
    }
    if (q.includes('recruit') || q.includes('สมัคร')) {
      for (const ro of (world.recruitmentOffers || []).filter(o => o.status === 'open')) {
        const org = getOrganization(ro.organizationId);
        push('settlement', ro.settlementId, org?.name || 'รับสมัคร', ro.type);
      }
    }
    if (typeof AgentMemorySystem !== 'undefined') {
      for (const a of world.agents) {
        if (!a.alive) continue;
        AgentMemorySystem.ensureAgent(a);
        const p = a.memory.personal;
        if ((q.includes('grudge') || q.includes('แค้น')) && p.grudges?.length) {
          push('agent', a.id, a.name, `แค้น ${p.grudges.length} ราย`);
        }
        if ((q.includes('loyal') || q.includes('ภักดี')) && p.loyalties?.length) {
          push('agent', a.id, a.name, `ภักดี ${p.loyalties.length} คน`);
        }
        if ((q.includes('vengeful') || q.includes('แก้แค้น')) && (a.motives?.revenge || 0) > 25) {
          push('agent', a.id, a.name, `แรงจูงใจแก้แค้น ${fmt(a.motives.revenge, 0)}`);
        }
        if ((q.includes('hero') || q.includes('วีรบุรุษ')) && world.settlements.some(s => (s.sentiment?.heroes?.[a.id] || 0) > 10)) {
          push('agent', a.id, a.name, 'วีรบุรุษท้องถิ่น');
        }
        if ((q.includes('villain') || q.includes('วายร้าย') || q.includes('enemy')) && world.settlements.some(s => (s.sentiment?.villains?.[a.id] || 0) > 8)) {
          push('agent', a.id, a.name, 'ถูกเกลียดในเมือง');
        }
      }
    }
    if (typeof TextCombatCore !== 'undefined') {
      for (const a of world.agents) {
        if (!a.alive) continue;
        TextCombatCore.ensureAgent(a);
        const mh = a.equipment?.mainHand?.type, rg = a.equipment?.ranged?.type;
        if ((q.includes('duelist') || q.includes('ดวล')) && (a.duelRecord?.wins || 0) > 0) {
          push('agent', a.id, a.name, `ดวลชนะ ${a.duelRecord.wins}`);
        }
        if ((q.includes('veteran') || q.includes('ทหารเก่า')) && (a.memory?.survivedBattles || 0) >= 2) {
          push('agent', a.id, a.name, `รอดศึก ${a.memory.survivedBattles} ครั้ง`);
        }
        if ((q.includes('wounded') || q.includes('บาดเจ็บ')) && a.injuries?.some(i => !i.healed)) {
          push('agent', a.id, a.name, `บาดเจ็บ ${a.injuries.filter(i => !i.healed).length} แห่ง`);
        }
        if ((q.includes('scarred') || q.includes('แผลเป็น')) && a.injuries?.some(i => i.type === 'scar' || i.permanent)) {
          push('agent', a.id, a.name, 'มีแผลเป็น/บาดแผลถาวร');
        }
        if (q.includes('sword') && mh === 'sword') push('agent', a.id, a.name, 'นักดาบ');
        if (q.includes('spear') && mh === 'spear') push('agent', a.id, a.name, 'ทหารหอก');
        if ((q.includes('archer') || q.includes('ธนู')) && (rg === 'bow' || a.profession === 'archer')) push('agent', a.id, a.name, 'นักธนู');
        if ((q.includes('cavalry') || q.includes('ทหารม้า')) && (a.equipment?.mount?.type === 'horse' || a.profession === 'cavalry')) {
          push('agent', a.id, a.name, 'ทหารม้า');
        }
      }
      if (q.includes('legendary') && (q.includes('weapon') || q.includes('อาวุธ'))) {
        for (const lw of (world.legendaryWeapons || [])) {
          const wielder = lw.wielderHistory?.length ? getAgent(lw.wielderHistory[lw.wielderHistory.length - 1].agentId) : null;
          push('agent', wielder?.id || 0, lw.name, `fame ${lw.fame}`);
        }
      }
    }
    return results.slice(0, 25);
  },

  getTargetLabel(kind, id) {
    if (!world) return '?';
    if (kind === 'agent') {
      const a = getAgent(id);
      if (!a) return '?';
      return a.name + (a.cargo ? ' (คาราวาน)' : '');
    }
    if (kind === 'settlement') return getSettlement(id)?.name || '?';
    if (kind === 'faction') return getFaction(id)?.name || '?';
    if (kind === 'unit') return getUnit(id)?.name || '?';
    if (kind === 'army') return getArmy(id)?.name || '?';
    if (kind === 'warband') return getWarband(id)?.name || '?';
    if (kind === 'organization') return getOrganization(id)?.name || '?';
    if (kind === 'route') {
      const r = world.routes.find(x => x.id === id);
      if (!r) return '?';
      const sa = getSettlement(r.a), sb = getSettlement(r.b);
      return `${sa ? sa.name : '?'} ↔ ${sb ? sb.name : '?'}`;
    }
    return '?';
  },

  getTargetPosition(kind, id) {
    if (!world) return null;
    if (kind === 'settlement') {
      const s = getSettlement(id);
      return s ? { x: s.x, y: s.y } : null;
    }
    if (kind === 'agent') {
      const a = getAgent(id);
      if (!a || !a.alive) return null;
      if (a.travel && !a.unitId) { const p = travelPos(a); return { x: p.x, y: p.y }; }
      const s = getSettlement(a.locationId);
      return s ? { x: s.x, y: s.y } : null;
    }
    if (kind === 'unit') {
      const u = getUnit(id);
      if (!u) return null;
      if (u.travel) { const p = travelPos(u); return { x: p.x, y: p.y }; }
      const s = getSettlement(u.locationId);
      return s ? { x: s.x, y: s.y } : null;
    }
    if (kind === 'army') {
      const ar = getArmy(id);
      if (!ar) return null;
      const u = ar.unitIds.map(getUnit).find(Boolean);
      if (!u) return null;
      if (u.travel) { const p = travelPos(u); return { x: p.x, y: p.y }; }
      const s = getSettlement(u.locationId);
      return s ? { x: s.x, y: s.y } : null;
    }
    if (kind === 'route') {
      const r = world.routes.find(x => x.id === id);
      if (!r) return null;
      const a = getSettlement(r.a), b = getSettlement(r.b);
      if (!a || !b) return null;
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    if (kind === 'faction') {
      const s = world.settlements.find(x => x.factionId === id);
      return s ? { x: s.x, y: s.y } : null;
    }
    if (kind === 'warband') {
      const wb = getWarband(id);
      if (!wb) return null;
      if (wb.travel) { const p = travelPos(wb); return { x: p.x, y: p.y }; }
      const s = getSettlement(wb.locationId);
      return s ? { x: s.x + 12, y: s.y - 8 } : null;
    }
    if (kind === 'organization') {
      const org = getOrganization(id);
      const s = org?.homeSettlementId ? getSettlement(org.homeSettlementId) : null;
      return s ? { x: s.x, y: s.y } : null;
    }
    return null;
  },

  centerOn(kind, id) {
    const pos = this.getTargetPosition(kind, id);
    if (pos) Renderer.centerOnMap(pos.x, pos.y);
  },

  focusTarget(kind, id) {
    UI.selected = { kind, id };
    UI.inspectorDirty = true;
    this.centerOn(kind, id);
    const search = document.getElementById('globalSearch');
    if (search) search.value = '';
    const box = document.getElementById('searchResults');
    if (box) box.innerHTML = '';
  },

  startFollow(kind, id) {
    if (this.follow && this.follow.kind === kind && this.follow.id === id) {
      this.stopFollow('ยกเลิกการติดตาม');
      return;
    }
    this.follow = { kind, id, label: this.getTargetLabel(kind, id) };
    this.centerOn(kind, id);
    this.updateFollowLabel();
  },

  stopFollow(reason) {
    if (!this.follow) return;
    const label = this.follow.label;
    this.follow = null;
    this.updateFollowLabel();
    if (reason) EventSystem.add('system', `👁 หยุดติดตาม ${label} — ${reason}`);
  },

  isFollowValid() {
    if (!this.follow || !world) return false;
    const { kind, id } = this.follow;
    if (kind === 'agent') { const a = getAgent(id); return !!(a && a.alive); }
    if (kind === 'settlement') return !!getSettlement(id);
    if (kind === 'unit') { const u = getUnit(id); return !!(u && unitMembers(u).length); }
    if (kind === 'army') { const ar = getArmy(id); return !!(ar && ar.unitIds.some(uid => { const u = getUnit(uid); return u && unitMembers(u).length; })); }
    if (kind === 'faction') return world.settlements.some(s => s.factionId === id);
    if (kind === 'warband') { const wb = getWarband(id); return !!(wb && warbandMembers(wb).length); }
    if (kind === 'organization') { const o = getOrganization(id); return !!(o && o.status === 'active'); }
    return false;
  },

  tickFollow() {
    if (!this.follow) return;
    if (!this.isFollowValid()) {
      this.stopFollow('เป้าหมายหายไปหรือสูญสิ้นแล้ว');
      return;
    }
    this.centerOn(this.follow.kind, this.follow.id);
    this.updateFollowLabel();
  },

  updateFollowLabel() {
    const el = document.getElementById('followLabel');
    if (!el) return;
    if (!this.follow) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.classList.remove('hidden');
    el.textContent = `👁 กำลังติดตาม: ${this.follow.label}`;
  },

  onMajorEvent(type, title, refs) {
    if (!this.pauseOn[type]) return;
    UI.paused = true;
    const bp = document.getElementById('btnPause');
    if (bp) bp.textContent = '▶ Resume';
    this.showToast(title, `Day ${world.day} — simulation หยุดชั่วคราว`);
    UI.logDirty = true;
  },

  showToast(title, body) {
    const el = document.getElementById('observerToast');
    if (!el) return;
    const t = el.querySelector('.toast-title');
    const b = el.querySelector('.toast-body');
    if (t) t.textContent = title;
    if (b) b.textContent = body || '';
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), 4500);
  },

  eventMatchesFilter(ev) {
    if (this.logFilter === 'all') return true;
    const cat = ev.category || 'system';
    const text = (ev.text || '').toLowerCase();
    if (this.logFilter === 'diplomacy') {
      return cat === 'diplomacy' || (cat === 'politics' && /สนธิ|ทูต|พันธมิตร|เมืองขึ้น|หักหลัง|vassal|alliance/.test(text));
    }
    if (this.logFilter === 'disaster') {
      return /แล้ง|โรค|ภัย|plague|drought/.test(text) || cat === 'disaster';
    }
    if (this.logFilter === 'legend') return cat === 'legend';
    return cat === this.logFilter;
  },

  firstEventRef(refs) {
    if (!refs) return null;
    if (refs.agents && refs.agents.length) return { kind: 'agent', id: refs.agents[0] };
    if (refs.settlements && refs.settlements.length) return { kind: 'settlement', id: refs.settlements[0] };
    if (refs.factions && refs.factions.length) return { kind: 'faction', id: refs.factions[0] };
    return null;
  },

  chronicleTargetButtons(entry) {
    const parts = [];
    const add = (kind, id, label) => {
      parts.push(`<button class="chron-target" data-sel-kind="${kind}" data-sel-id="${id}">📍 ${label}</button>`);
    };
    for (const id of (entry.agents || []).slice(0, 2)) {
      const a = getAgent(id);
      if (a) add('agent', id, a.name);
    }
    for (const id of (entry.settlements || []).slice(0, 2)) {
      const s = getSettlement(id);
      if (s) add('settlement', id, s.name);
    }
    for (const id of (entry.factions || []).slice(0, 2)) {
      const f = getFaction(id);
      if (f) add('faction', id, f.name);
    }
    return parts.length ? `<div class="chron-targets">${parts.join(' ')}</div>` : '';
  },

  getDashboardStats() {
    if (!world) return {};
    const alive = world.agents.filter(a => a.alive);
    const liveFactions = world.factions.filter(fc => world.settlements.some(s => s.factionId === fc.id));
    const activeWars = world.wars.filter(w => !w.endDay);
    const treaties = (world.treaties || []).filter(t => t.status === 'active');
    const foodCrisis = marketSettlements().filter(s => s.stock.food < 15 && populationOf(s) > 3).length;
    const routes = world.routes.filter(r => !r.destroyed);
    const banditAvg = routes.length ? sum(routes, r => r.danger) / routes.length : 0;
    const strongest = liveFactions.reduce((m, fc) => {
      const power = world.settlements.filter(s => s.factionId === fc.id).length * 100
        + alive.filter(a => a.factionId === fc.id && MILITARY_PROFS.has(a.profession)).length * 10;
      return power > m.power ? { f: fc, power } : m;
    }, { f: null, power: -1 }).f;
    return {
      population: alive.length,
      factions: liveFactions.length,
      wars: activeWars.length,
      treaties: treaties.length,
      foodCrisis,
      banditAvg,
      strongest: strongest ? strongest.name : '—',
      day: world.day,
      tradeHealth: world.marketIndex ? fmt(world.marketIndex.tradeHealth, 0) : '—',
      guilds: (world.guilds || []).length,
      hubs: marketSettlements().filter(s => s.marketRole?.isMarketHub).length
    };
  },

  renderSearchResults(query) {
    const box = document.getElementById('searchResults');
    if (!box) return;
    if (!query) { box.innerHTML = ''; return; }
    const results = this.search(query);
    box.innerHTML = results.length
      ? results.map(r =>
        `<div class="search-hit" data-kind="${r.kind}" data-id="${r.id}">
           <span class="sh-label">${r.label}</span>
           <span class="sh-sub">${r.sub}</span>
         </div>`).join('')
      : '<div class="search-empty">ไม่พบผลลัพธ์</div>';
    for (const hit of box.querySelectorAll('.search-hit')) {
      hit.addEventListener('click', () => {
        this.focusTarget(hit.dataset.kind, +hit.dataset.id);
      });
    }
  },

  renderPanel() {
    const body = document.getElementById('observerBody');
    if (!body || !world) return;
    const r = this.computeRankings();
    if (!r) return;
    const tab = this.rankingTab;
    const row = (label, sub, kind, id) =>
      `<div class="obs-row" data-kind="${kind}" data-id="${id}"><span>${label}</span><span class="obs-sub">${sub || ''}</span></div>`;
    let html = '';
    if (tab === 'famous') {
      html = r.famousAgents.length
        ? r.famousAgents.map(a => row(a.name + (a.title ? ` "${a.title}"` : ''), `⭐ ${fmt(a.fame)} · ${a.profession}`, 'agent', a.id)).join('')
        : '<p class="hint">ยังไม่มีตัวละครที่โด่งดัง</p>';
    } else if (tab === 'richest') {
      html = r.richestAgents.map(a => row(a.name, `${fmt(a.money, 1)} ทอง · ${a.profession}`, 'agent', a.id)).join('');
    } else if (tab === 'military') {
      html = '<div class="obs-section-head">หน่วยทหาร</div>';
      html += r.strongestUnits.map(x => row(x.unit.name, `พลัง ${fmt(x.power)} · ${x.members} คน`, 'unit', x.unit.id)).join('');
      html += '<div class="obs-section-head">กองทัพ</div>';
      html += r.strongestArmies.map(x => row(x.army.name, `พลัง ${fmt(x.power)} · ${x.size} คน`, 'army', x.army.id)).join('');
    } else if (tab === 'settlements') {
      html = '<div class="obs-section-head">มั่งคั่ง</div>';
      html += r.prosperousSettlements.map(s => row(s.name, `prosperity ${fmt(s.prosperity)}`, 'settlement', s.id)).join('');
      html += '<div class="obs-section-head">ขาดแคลนอาหาร</div>';
      html += (r.starvingSettlements.length
        ? r.starvingSettlements.map(s => row(s.name, `อาหาร ${fmt(s.stock.food)}`, 'settlement', s.id)).join('')
        : '<p class="hint">ไม่มีเมืองที่อดอยากรุนแรง</p>');
    } else if (tab === 'routes') {
      html = r.dangerousRoutes.map(rt => {
        const sa = getSettlement(rt.a), sb = getSettlement(rt.b);
        return row(`${sa ? sa.name : '?'} ↔ ${sb ? sb.name : '?'}`, `danger ${fmt(rt.danger * 100, 0)}%`, 'route', rt.id);
      }).join('');
    } else if (tab === 'factions') {
      html = '<div class="obs-section-head">แข็งแกร่ง</div>';
      html += r.strongestFactions.map(x => row(x.f.name, `power ${fmt(x.power, 0)}`, 'faction', x.f.id)).join('');
      html += '<div class="obs-section-head">เหนื่อยล้าสงคราม</div>';
      html += r.exhaustedFactions.map(x => row(x.f.name, `${fmt(x.ex, 0)}%`, 'faction', x.f.id)).join('');
    } else if (tab === 'wars') {
      html = r.activeWars.length
        ? r.activeWars.map(w => {
          const att = getFaction(w.attackerId), def = getFaction(w.defenderId);
          return `<div class="obs-war">${w.name}<br><span class="obs-sub">${att ? att.name : '?'} vs ${def ? def.name : '?'} · Day ${w.startDay}+</span></div>`;
        }).join('')
        : '<p class="hint">ไม่มีสงครามที่กำลังดำเนินอยู่</p>';
    } else if (tab === 'treaties') {
      html = r.activeTreaties.length
        ? r.activeTreaties.map(t => {
          const names = t.factions.map(id => getFaction(id)?.name || '?').join(' ↔ ');
          return `<div class="obs-war">${t.type}<br><span class="obs-sub">${names} · Day ${t.startDay}</span></div>`;
        }).join('')
        : '<p class="hint">ไม่มีสนธิสัญญาที่ใช้งานอยู่</p>';
    } else if (tab === 'events') {
      html = r.recentEvents.map(e =>
        `<div class="obs-event imp-${e.importance}">
           <span class="ce-day">Day ${e.day}</span> ${e.title}
           ${this.chronicleTargetButtons(e)}
         </div>`).join('');
    } else if (tab === 'market' && typeof MarketTradeSystem !== 'undefined') {
      const mk = MarketTradeSystem.rankings();
      html = '<div class="obs-section-head">Top Market Hubs</div>';
      html += mk.hubs.map(s => row(s.name, `hub Lv${s.marketRole.hubLevel} · influence ${fmt(s.marketRole.tradeInfluence, 0)}`, 'settlement', s.id)).join('')
        || '<p class="hint">ยังไม่มีตลาดกลาง</p>';
      html += '<div class="obs-section-head">Trade Routes</div>';
      html += mk.routes.map(x => {
        const sa = getSettlement(x.route.a), sb = getSettlement(x.route.b);
        return row(`${sa ? sa.name : '?'} ↔ ${sb ? sb.name : '?'}`, `value ${fmt(x.value, 0)}`, 'route', x.route.id);
      }).join('');
      html += '<div class="obs-section-head">Price Volatility</div>';
      html += mk.volatile.slice(0, 5).map(s => row(s.name, fmt(s.priceVolatility, 1), 'settlement', s.id)).join('');
    } else if (tab === 'guild' && typeof MarketTradeSystem !== 'undefined') {
      const mk = MarketTradeSystem.rankings();
      html = mk.guilds.map(g => {
        const home = getSettlement(g.homeSettlementId);
        return row(g.name, `wealth ${fmt(g.wealth)} · influence ${fmt(g.influence)}`, 'settlement', g.homeSettlementId);
      }).join('') || '<p class="hint">ยังไม่มีสมาคมพ่อค้า</p>';
    } else if (tab === 'contracts' && typeof MarketTradeSystem !== 'undefined') {
      const mk = MarketTradeSystem.rankings();
      html = mk.contracts.map(c => {
        const o = getSettlement(c.originId), d = getSettlement(c.destinationId);
        return `<div class="obs-row" data-kind="settlement" data-id="${c.destinationId}">
          <span>${c.good} ×${c.quantity} (${c.status})</span>
          <span class="obs-sub">${o ? o.name : '?'} → ${d ? d.name : '?'} · ${fmt(c.reward)} ทอง</span>
        </div>`;
      }).join('') || '<p class="hint">ไม่มีสัญญาที่เปิดอยู่</p>';
    } else if (tab === 'personalities' && typeof AgentMemorySystem !== 'undefined') {
      const pr = AgentMemorySystem.rankings();
      html = '<div class="obs-section-head">Most Loyal Followers</div>';
      html += pr.loyalFollowers.filter(x => x.loyalty > 0).map(x =>
        row(x.agent.name, `loyalty ${fmt(x.loyalty)} → ${x.leader ? x.leader.name.split(' ')[0] : '?'}`, 'agent', x.agent.id)).join('')
        || '<p class="hint">ยังไม่มีความภักดีเด่น</p>';
      html += '<div class="obs-section-head">Most Vengeful</div>';
      html += pr.vengeful.filter(x => x.revenge > 15).map(x => row(x.agent.name, `revenge ${fmt(x.revenge, 0)}`, 'agent', x.agent.id)).join('');
      html += '<div class="obs-section-head">Most Connected</div>';
      html += pr.connected.filter(x => x.n > 0).map(x => row(x.agent.name, `${x.n} relations`, 'agent', x.agent.id)).join('');
      html += '<div class="obs-section-head">Most Hated</div>';
      html += pr.hated.filter(x => x.hate > 5).map(x => row(x.agent.name, `hate ${fmt(x.hate, 0)}`, 'agent', x.agent.id)).join('');
    } else if (tab === 'campaigns' && typeof CampaignWarfareSystem !== 'undefined') {
      const cr = CampaignWarfareSystem.rankings();
      html = '<div class="obs-section-head">Active Campaigns</div>';
      html += cr.campaigns.length ? cr.campaigns.map(ar =>
        row(ar.name, `${ar.objective?.type || 'idle'} · food ${fmt(ar.supply?.food || 0)}`, 'army', ar.id)).join('')
        : '<p class="hint">ไม่มีกองทัพเคลื่อนที่</p>';
      html += '<div class="obs-section-head">Supply Lines at Risk</div>';
      html += cr.vulnerable.filter(sl => sl.status !== 'open').map(sl =>
        row(`Supply ${sl.status}`, `danger ${fmt(sl.danger * 100, 0)}%`, 'army', sl.armyId)).join('')
        || cr.vulnerable.slice(0, 5).map(sl => row(`Line → ${(getSettlement(sl.targetSettlementId) || {}).name || '?'}`, `${sl.status} · ${fmt(sl.danger * 100, 0)}%`, 'army', sl.armyId)).join('')
        || '<p class="hint">ไม่มีเส้นทางเสบียง</p>';
      html += '<div class="obs-section-head">Armies Low on Supply</div>';
      html += cr.lowSupply.map(ar => row(ar.name, `food ${fmt(ar.supply.food)}`, 'army', ar.id)).join('') || '<p class="hint">เสบียงพอใช้</p>';
      html += '<div class="obs-section-head">Ongoing Sieges</div>';
      html += cr.sieges.map(s => row(s.name, `day ${s.siege?.days || 0}`, 'settlement', s.id)).join('') || '<p class="hint">ไม่มีการล้อม</p>';
      html += '<div class="obs-section-head">Scout Reports</div>';
      html += cr.scoutReports.map(rep => row(`${rep.targetType} @ ${(getSettlement(rep.locationId) || {}).name || '?'}`, `conf ${fmt((rep.confidence || 0) * 100, 0)}% · ${rep.threat}`, 'army', rep.armyId || 0)).join('')
        || '<p class="hint">ยังไม่มีรายงานลาดตระเวน</p>';
    } else if (tab === 'largebattles' && typeof LargeBattlefieldSystem !== 'undefined') {
      const lr = LargeBattlefieldSystem.rankings();
      html = '<div class="obs-section-head">Large Battles</div>';
      html += lr.largeBattles.length ? lr.largeBattles.map(br =>
        `<div class="obs-war battle-report-row" data-report-id="${br.id}">Day ${br.day} · ${br.title || br.location}<br><span class="obs-sub">${(br.summaryText || br.chronicleText || '').slice(0, 140)}</span></div>`).join('')
        : '<p class="hint">ยังไม่มีศึกใหญ่</p>';
      html += '<div class="obs-section-head">Formations in Field</div>';
      html += lr.formations.map(f => `<div class="obs-row"><span>${f.formation}</span><span class="obs-sub">${f.count} หน่วย</span></div>`).join('') || '<p class="hint">—</p>';
      html += '<div class="obs-section-head">Heavy Casualty Battles</div>';
      html += lr.heavyCasualty.map(br =>
        `<div class="obs-war">Day ${br.day} · ${br.casualties || 0} ตาย<br><span class="obs-sub">${(br.summaryText || '').slice(0, 100)}</span></div>`).join('') || '<p class="hint">—</p>';
      html += '<div class="obs-section-head">Famous Units</div>';
      html += lr.famousUnits.map(u => row(u.name, `W ${u.formationStats?.wins || 0} · ${u.formation}`, 'unit', u.id)).join('') || '<p class="hint">—</p>';
      html += '<div class="obs-section-head">Routed Units</div>';
      html += lr.routedUnits.map(u => row(u.name, `morale ${fmt(u.morale)}`, 'unit', u.id)).join('') || '<p class="hint">—</p>';
      html += '<div class="obs-section-head">Cavalry Charges</div>';
      html += lr.cavalryCharges.map(br =>
        `<div class="obs-war">Day ${br.day}<br><span class="obs-sub">${(br.summaryText || '').slice(0, 90)}</span></div>`).join('') || '<p class="hint">—</p>';
      html += '<div class="obs-section-head">Heroic Stands</div>';
      html += lr.heroicStands.map(br =>
        `<div class="obs-war">Day ${br.day}<br><span class="obs-sub">${(br.summaryText || '').slice(0, 90)}</span></div>`).join('') || '<p class="hint">—</p>';
      const lastLarge = lr.largeBattles[0];
      if (lastLarge?.gridSnapshot) {
        html += '<div class="obs-section-head">Battlefield Grid (ล่าสุด)</div><pre class="battle-grid">';
        for (const row of lastLarge.gridSnapshot) html += row.join(' | ') + '\n';
        html += '</pre>';
      }
    } else if (tab === 'organizations' && typeof OrganizationSystem !== 'undefined') {
      const or = OrganizationSystem.rankings();
      html = '<div class="obs-section-head">All Organizations</div>';
      html += or.organizations.length ? or.organizations.map(o => row(o.name, `${o.type} · ${o.memberIds.length} สมาชิก`, 'organization', o.id)).join('')
        : '<p class="hint">ยังไม่มีองค์กร</p>';
      html += '<div class="obs-section-head">Mercenary Companies</div>';
      html += or.mercenaries.map(o => row(o.name, `rep ${fmt(o.reputation)}`, 'organization', o.id)).join('') || '<p class="hint">—</p>';
      html += '<div class="obs-section-head">Bandit Gangs</div>';
      html += or.bandits.map(o => row(o.name, `${o.memberIds.length} คน`, 'organization', o.id)).join('') || '<p class="hint">—</p>';
    } else if (tab === 'warbands' && typeof WarbandSystem !== 'undefined') {
      const or = OrganizationSystem.rankings();
      html = '<div class="obs-section-head">Warbands on Map</div>';
      html += or.warbands.length ? or.warbands.map(wb => {
        const n = warbandMembers(wb).length;
        return row(wb.name, `${wb.type} · ${n} · ${wb.status}`, 'warband', wb.id);
      }).join('') : '<p class="hint">ยังไม่มี warband</p>';
      html += '<div class="obs-section-head">Marching / Pursuing</div>';
      html += world.warbands.filter(w => w.travel || w.status === 'pursuing' || w.status === 'fleeing').map(wb =>
        row(wb.name, wb.status, 'warband', wb.id)).join('') || '<p class="hint">—</p>';
    } else if (tab === 'recruitment' && typeof OrganizationSystem !== 'undefined') {
      const or = OrganizationSystem.rankings();
      html = '<div class="obs-section-head">Recruitment Offers</div>';
      html += or.offers.length ? or.offers.map(ro => {
        const org = getOrganization(ro.organizationId);
        const s = getSettlement(ro.settlementId);
        return row(`${org?.name || '?'} — ${ro.roleNeeded}`, `${s?.name || '?'} · ${ro.acceptedAgentIds.length}/${ro.quantityNeeded}`, 'settlement', ro.settlementId);
      }).join('') : '<p class="hint">ไม่มีประกาศรับสมัคร</p>';
    } else if (tab === 'combat' && typeof TextCombatCore !== 'undefined') {
      const cr = TextCombatCore.rankings();
      html = '<div class="obs-section-head">Best Duelists</div>';
      html += cr.duelists.length ? cr.duelists.map(a => row(a.name, `W ${a.duelRecord?.wins || 0} · ${a.profession}`, 'agent', a.id)).join('')
        : '<p class="hint">ยังไม่มีนักดวล</p>';
      html += '<div class="obs-section-head">Deadliest Fighters</div>';
      html += cr.deadliest.length ? cr.deadliest.map(a => row(a.name, `kills ${a.duelRecord?.kills || 0}`, 'agent', a.id)).join('')
        : '<p class="hint">ยังไม่มีการสังหารในการดวล</p>';
      html += '<div class="obs-section-head">Scarred Veterans</div>';
      html += cr.scarred.length ? cr.scarred.map(a => row(a.name, `${a.injuries?.length || 0} injuries`, 'agent', a.id)).join('')
        : '<p class="hint">ยังไม่มีทหารเก่าแผลเป็น</p>';
      html += '<div class="obs-section-head">Legendary Weapons</div>';
      html += cr.legendaryWeapons.length ? cr.legendaryWeapons.map(lw => {
        const w = lw.wielderHistory?.length ? getAgent(lw.wielderHistory[lw.wielderHistory.length - 1].agentId) : null;
        return row(lw.name, `fame ${lw.fame}${w ? ' · ' + w.name.split(' ')[0] : ''}`, 'agent', w?.id || 0);
      }).join('') : '<p class="hint">ยังไม่มีอาวุธตำนาน</p>';
      html += '<div class="obs-section-head">Famous Battles</div>';
      html += cr.famousBattles.length ? cr.famousBattles.map(br =>
        `<div class="obs-war">Day ${br.day}<br><span class="obs-sub">${(br.summaryText || '').slice(0, 120)}</span></div>`).join('')
        : '<p class="hint">ยังไม่มีรายงานศึก</p>';
      html += '<div class="obs-section-head">Broken Units</div>';
      html += cr.brokenUnits.length ? cr.brokenUnits.map(u => row(u.name, `morale ${fmt(u.morale)} · ${unitMembers(u).length} คน`, 'unit', u.id)).join('')
        : '<p class="hint">ไม่มีหน่วยที่ใกล้พัง</p>';
    }
    body.innerHTML = html;
    for (const rowEl of body.querySelectorAll('.obs-row')) {
      rowEl.addEventListener('click', () => this.focusTarget(rowEl.dataset.kind, +rowEl.dataset.id));
    }
    for (const btn of body.querySelectorAll('.chron-target')) {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        this.focusTarget(btn.dataset.selKind, +btn.dataset.selId);
      });
    }
  },

  renderMiniDashboard() {
    const el = document.getElementById('miniDashboard');
    if (!el || !world) return;
    const d = this.getDashboardStats();
    el.innerHTML = [
      ['👥', d.population, 'pop'],
      ['🚩', d.factions, 'fac'],
      ['⚔', d.wars, 'war'],
      ['🏦', d.tradeHealth, 'trade'],
      ['🏛', d.guilds, 'guild'],
      ['🍞', d.foodCrisis, 'food'],
      ['👑', d.strongest, 'str'],
      ['📅', 'Day ' + d.day, 'day']
    ].map(([icon, val, cls]) => `<span class="dash-item ${cls}" title="${cls}">${icon} ${val}</span>`).join('');
  },

  getPrefs() {
    return {
      rankingTab: this.rankingTab,
      follow: this.follow ? { kind: this.follow.kind, id: this.follow.id } : null,
      pauseOn: { ...this.pauseOn },
      logFilter: this.logFilter,
      logSearch: this.logSearch,
      panX: Renderer.panX,
      panY: Renderer.panY,
      zoom: Renderer.zoom
    };
  },

  applyPrefs(prefs) {
    if (!prefs) return;
    if (prefs.rankingTab) this.rankingTab = prefs.rankingTab;
    if (prefs.pauseOn) this.pauseOn = { ...this.defaultPauseOn(), ...prefs.pauseOn };
    if (prefs.logFilter) this.logFilter = prefs.logFilter;
    if (prefs.logSearch != null) this.logSearch = prefs.logSearch;
    if (prefs.panX != null) Renderer.panX = prefs.panX;
    if (prefs.panY != null) Renderer.panY = prefs.panY;
    if (prefs.zoom != null) Renderer.zoom = clamp(prefs.zoom, 0.4, 3);
    this.syncPauseTogglesUI();
    const logSearch = document.getElementById('logSearch');
    if (logSearch && prefs.logSearch != null) logSearch.value = prefs.logSearch;
    document.querySelectorAll('.log-filter').forEach(b => b.classList.toggle('active', b.dataset.f === this.logFilter));
    document.querySelectorAll('.obs-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === this.rankingTab));
    if (prefs.follow && prefs.follow.kind && prefs.follow.id) {
      if (this.getTargetPosition(prefs.follow.kind, prefs.follow.id)) {
        this.follow = { kind: prefs.follow.kind, id: prefs.follow.id, label: this.getTargetLabel(prefs.follow.kind, prefs.follow.id) };
      } else {
        this.follow = null;
        EventSystem.add('system', '👁 เป้าหมายติดตามหลังโหลดไม่พบ — ยกเลิก follow');
      }
    }
    this.updateFollowLabel();
  }
};

/* ═══════════════════ 16. RENDERER ═══════════════════ */

const Renderer = {
  canvas: null, ctx: null, w: 0, h: 0, scaleX: 1, scaleY: 1,
  panX: 0, panY: 0, zoom: 1,
  _dragging: false, _dragMoved: false, _dragLast: null,

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
    this.bindCamera();
  },

  bindCamera() {
    const c = this.canvas;
    if (!c) return;
    c.addEventListener('wheel', e => {
      if (UI.armedTool) return;
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const oldZoom = this.zoom;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      this.zoom = clamp(this.zoom * factor, 0.4, 3);
      const scale = this.zoom / oldZoom;
      this.panX = mx - (mx - this.panX) * scale;
      this.panY = my - (my - this.panY) * scale;
    }, { passive: false });
    c.addEventListener('mousedown', e => {
      if (e.button !== 0 || UI.armedTool) return;
      this._dragging = true;
      this._dragMoved = false;
      this._dragLast = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mousemove', e => {
      if (!this._dragging || !this._dragLast) return;
      const dx = e.clientX - this._dragLast.x, dy = e.clientY - this._dragLast.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this._dragMoved = true;
      this.panX += dx; this.panY += dy;
      this._dragLast = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mouseup', () => { this._dragging = false; this._dragLast = null; });
    c.addEventListener('dblclick', e => {
      if (UI.armedTool) return;
      if (!this._dragMoved) this.resetView();
    });
  },

  resetView() {
    this.panX = 0; this.panY = 0; this.zoom = 1;
  },

  centerOnMap(x, y) {
    this.panX = this.w / 2 - x * this.scaleX * this.zoom;
    this.panY = this.h / 2 - y * this.scaleY * this.zoom;
  },

  sx(x) { return x * this.scaleX * this.zoom + this.panX; },
  sy(y) { return y * this.scaleY * this.zoom + this.panY; },

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

    // supply lines (Phase 18)
    if (typeof CampaignWarfareSystem !== 'undefined') {
      for (const sl of (world.supplyLines || [])) {
        if (sl.status === 'collapsed' || !sl.routePath || sl.routePath.length < 2) continue;
        if (UI.selected?.kind !== 'army') continue;
        const selAr = getArmy(UI.selected.id);
        if (!selAr || selAr.supplyLineId !== sl.id) continue;
        const color = sl.status === 'cut' ? 'rgba(239,83,80,0.75)' : sl.status === 'threatened' ? 'rgba(255,193,7,0.65)' : 'rgba(100,181,246,0.55)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        for (let i = 0; i < sl.routePath.length; i++) {
          const st = getSettlement(sl.routePath[i]);
          if (!st) continue;
          const x = this.sx(st.x), y = this.sy(st.y);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // army camps
      for (const camp of (world.armyCamps || [])) {
        const st = getSettlement(camp.locationId);
        if (!st) continue;
        const x = this.sx(st.x) + 10, y = this.sy(st.y) - 10;
        ctx.fillStyle = 'rgba(255,152,0,0.85)';
        ctx.beginPath();
        ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y + 4); ctx.lineTo(x - 5, y + 4);
        ctx.closePath(); ctx.fill();
      }
    }

    // settlements
    for (const s of world.settlements) this.drawSettlement(ctx, s);

    // agents (จุดรอบถิ่นฐาน + ผู้เดินทาง)
    this.drawAgents(ctx);
    if (UI.showRelationLines) this.drawRelationLines(ctx);

    // units/armies เดินทาง (จุดใหญ่)
    this.drawMilitaryDots(ctx);
    if (typeof WarbandSystem !== 'undefined') this.drawWarbandMarkers(ctx);

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

  drawRelationLines(ctx) {
    if (!UI.showRelationLines || !UI.selected || UI.selected.kind !== 'agent' || typeof AgentMemorySystem === 'undefined') return;
    const a = getAgent(UI.selected.id);
    if (!a || !a.alive) return;
    let ax = a._px, ay = a._py;
    if (ax == null) {
      const s = getSettlement(a.locationId);
      if (!s) return;
      ax = this.sx(s.x); ay = this.sy(s.y);
    }
    AgentMemorySystem.ensureAgent(a);
    for (const [id, rel] of Object.entries(a.relationships)) {
      const other = getAgent(+id);
      if (!other || !other.alive) continue;
      const strength = Math.abs(rel.score) + rel.grudge + rel.loyalty + rel.gratitude;
      if (strength < 8) continue;
      let ox = other._px, oy = other._py;
      if (ox == null) {
        const s = getSettlement(other.locationId);
        if (!s) continue;
        ox = this.sx(s.x); oy = this.sy(s.y);
      }
      const positive = (rel.loyalty + rel.gratitude + rel.trust) > (rel.grudge + rel.fear);
      ctx.strokeStyle = positive ? 'rgba(100,200,255,0.4)' : 'rgba(255,100,100,0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ox, oy);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  },

  drawMilitaryDots(ctx) {
    const rMin = Math.min(this.scaleX, this.scaleY);
    for (const u of world.units) {
      if (u._warbandId) continue;
      const members = unitMembers(u);
      if (!members.length) continue;
      let px, py;
      if (u.travel) { const p = travelPos(u); px = this.sx(p.x); py = this.sy(p.y); }
      else {
        const s = getSettlement(u.locationId);
        if (!s) continue;
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

  drawWarbandMarkers(ctx) {
    if (!world.warbands) return;
    const rMin = Math.min(this.scaleX, this.scaleY);
    for (const wb of world.warbands) {
      const members = warbandMembers(wb);
      if (!members.length || wb.status === 'disbanding') continue;
      let px, py;
      if (wb.travel) { const p = travelPos(wb); px = this.sx(p.x); py = this.sy(p.y); }
      else {
        const s = getSettlement(wb.locationId);
        if (!s) continue;
        px = this.sx(s.x) + 14 * rMin; py = this.sy(s.y) - 10 * rMin;
      }
      const st = WarbandSystem.markerStyle(wb);
      const size = st.size * rMin;
      ctx.fillStyle = st.color;
      ctx.strokeStyle = wb.status === 'pursuing' ? '#ffeb3b' : wb.status === 'fleeing' ? '#90a4ae' : 'rgba(255,255,255,0.75)';
      ctx.lineWidth = wb.status === 'marching' ? 2 : 1.5;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(8, size * 1.2)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(st.icon, px, py + size * 0.35);
      ctx.font = '7px sans-serif';
      ctx.fillText(members.length, px, py + size + 6);
      wb._px = px; wb._py = py;
      if (wb.travel && wb.routePath?.length > 1) {
        ctx.strokeStyle = 'rgba(255,213,79,0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        for (let i = 0; i < wb.routePath.length; i++) {
          const st = getSettlement(wb.routePath[i]);
          if (!st) continue;
          const x = this.sx(st.x), y = this.sy(st.y);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
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
    const px = clientX - rect.left, py = clientY - rect.top;
    return {
      x: (px - this.panX) / (this.scaleX * this.zoom),
      y: (py - this.panY) / (this.scaleY * this.zoom)
    };
  },

  pickAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left, py = clientY - rect.top;
    if (world.warbands) {
      for (const wb of world.warbands) {
        if (wb._px == null || !warbandMembers(wb).length) continue;
        const d = Math.hypot(px - wb._px, py - wb._py);
        if (d < 16) return { kind: 'warband', id: wb.id };
      }
    }
    // 1) units (จุดใหญ่ ชัดสุด)
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
      const hitR = SETTLEMENT_RADIUS[s.type] * Math.min(this.scaleX, this.scaleY) * this.zoom * 1.4 + 8;
      if (d < hitR) {
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

/* ═══════════ Phase 18.4: Detail Pages / Readability UI ═══════════ */

function escHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const FORMATION_INFO = {
  shield_wall: { label: 'กำแพงโล่', strengths: 'ต้านธนู/หอก', weaknesses: 'ม้า/เว้นระยะ', terrain: 'road/hill', counters: 'archers' },
  spear_line: { label: 'แนวหอก', strengths: 'ต้านม้า', weaknesses: 'ธนู/เว้นระยะ', terrain: 'plain', counters: 'cavalry' },
  skirmish: { label: 'ซุ่มยิง', strengths: 'ยืดหยุ่น', weaknesses: 'ชาร์จตรง', terrain: 'forest', counters: 'shield_wall' },
  charge: { label: 'ชาร์จม้า', strengths: 'ทะลวงแนว', weaknesses: 'หอก/พื้นแคบ', terrain: 'plain', counters: 'spear_line' },
  reserve: { label: 'กองหนุน', strengths: 'เสริมจังหวะ', weaknesses: 'มาช้า', terrain: 'any', counters: 'rout' },
  retreat: { label: 'ถอย', strengths: 'รักษากำลัง', weaknesses: 'ถูกไล่', terrain: 'road', counters: '—' },
  rout: { label: 'แตก', strengths: '—', weaknesses: 'ทุกอย่าง', terrain: '—', counters: '—' },
  loose: { label: 'กระจาย', strengths: 'ยืดหยุ่น', weaknesses: 'ไม่แข็งแรง', terrain: 'any', counters: '—' },
  defensive: { label: 'ป้องกัน', strengths: 'คงแนว', weaknesses: 'เสียเปรียบเชิงรุก', terrain: 'hill/fort', counters: 'charge' },
  advance: { label: 'เดินหน้า', strengths: 'กดดัน', weaknesses: 'เสียขวัญถ้าแพ้', terrain: 'plain', counters: '—' }
};

let uiIndexes = null;

const UIIndexes = {
  lastDay: -1,
  markDirty() { this.lastDay = -1; UI.pageDirty = true; },
  rebuild(force) {
    if (!world) return null;
    if (!force && uiIndexes && this.lastDay === world.day) return uiIndexes;
    const alive = world.agents.filter(a => a.alive);
    const dead = world.agents.filter(a => !a.alive);
    const orgs = world.organizations || [];
    const wbs = world.warbands || [];
    const reports = world.battleReports || [];
    const searchIndex = [];
    const pushSearch = (type, id, text, score) => searchIndex.push({ type, id, text: (text || '').toLowerCase(), score: score || 0 });

    for (const a of world.agents) {
      const loc = getSettlement(a.locationId);
      const mems = (a.memberships || []).filter(m => ['active', 'traveling_to_muster', 'probation'].includes(m.status));
      const orgNames = mems.map(m => getOrganization(m.organizationId)?.name).filter(Boolean).join(' ');
      const txt = [a.name, a.profession, a.rank, a.title, a.career?.map(c => c.profession).join(' '), orgNames, loc?.name].join(' ');
      pushSearch('agent', a.id, txt, a.fame + (a.alive ? 10 : 0));
    }
    for (const o of orgs) pushSearch('organization', o.id, [o.name, o.type, o.purpose].join(' '), o.reputation || 0);
    for (const wb of wbs) pushSearch('warband', wb.id, [wb.name, wb.type, wb.status].join(' '), warbandMembers(wb).length);
    for (const br of reports) pushSearch('battle', br.id, [br.title, br.summaryText, br.location].join(' '), br.casualties || 0);

    const agentsByFame = alive.slice().sort((a, b) => (b.fame || 0) - (a.fame || 0));
    const agentsByCombat = alive.slice().sort((a, b) => ((b.duelRecord?.kills || 0) + (b.memory?.survivedBattles || 0)) - ((a.duelRecord?.kills || 0) + (a.memory?.survivedBattles || 0)));
    const agentsByWealth = alive.slice().sort((a, b) => (b.stats?.wealth || 0) - (a.stats?.wealth || 0));
    const agentsByConnections = alive.slice().sort((a, b) => Object.keys(b.relationships || {}).length - Object.keys(a.relationships || {}).length);

    const orgMap = {};
    for (const o of orgs) {
      if (!orgMap[o.type]) orgMap[o.type] = [];
      orgMap[o.type].push(o);
    }

    const wbByStatus = {};
    for (const wb of wbs) {
      const st = wb.status || 'idle';
      if (!wbByStatus[st]) wbByStatus[st] = [];
      wbByStatus[st].push(wb);
    }

    const battlesByDay = reports.slice().sort((a, b) => (b.day || 0) - (a.day || 0));
    const battlesByImportance = reports.slice().sort((a, b) => (b.casualties || 0) - (a.casualties || 0));

    const weaponsByFame = [];
    for (const a of alive) {
      for (const slot of ['mainHand', 'offHand']) {
        const it = a.equipment?.[slot];
        if (it && it.type) weaponsByFame.push({ item: it, ownerId: a.id, fame: (it.fame || 0) + (it.kills || 0) });
      }
    }
    weaponsByFame.sort((a, b) => b.fame - a.fame);
    for (const lw of (world.legendaryWeapons || [])) {
      const owner = world.agents.find(a => a.equipment?.mainHand?.id === lw.itemId || a.equipment?.offHand?.id === lw.itemId);
      weaponsByFame.push({ item: { id: lw.itemId, name: lw.name, fame: lw.fame, kills: lw.fame, legendary: true }, ownerId: owner?.id, fame: lw.fame + 50 });
    }
    weaponsByFame.sort((a, b) => b.fame - a.fame);

    const injuriesActive = [];
    for (const a of alive) {
      for (const inj of (a.injuries || []).filter(i => !i.healed)) injuriesActive.push({ agentId: a.id, injury: inj });
    }

    const agentsByOrganization = {};
    for (const o of orgs) agentsByOrganization[o.id] = o.memberIds.map(getAgent).filter(a => a && a.alive);

    uiIndexes = {
      agentsByFame, agentsByCombat, agentsByWealth, agentsByConnections, agentsByOrganization,
      organizationsByType: orgMap, warbandsByStatus: wbByStatus,
      battlesByDay, battlesByImportance, weaponsByFame, injuriesActive, searchIndex,
      alive, dead, orgs, wbs, reports
    };
    this.lastDay = world.day;
    return uiIndexes;
  }
};

function generateAgentSummary(agent) {
  if (!agent) return '—';
  const parts = [];
  const birth = agent.memory?.personal?.birthplaceId ? getSettlement(agent.memory.personal.birthplaceId) : null;
  const loc = getSettlement(agent.locationId);
  const startProf = agent.career?.[0]?.profession || agent.profession;
  parts.push(`${agent.name}${birth ? ` เกิดที่${birth.name}` : ''} เริ่มชีวิตเป็น${startProf}`);
  const trauma = (agent.memory?.personal?.trauma || [])[0];
  if (trauma) parts.push(`เหตุการณ์สำคัญ: ${trauma.text || trauma.kind || 'บาดแผลในใจ'}`);
  const mem = (agent.memberships || []).find(m => ['active', 'traveling_to_muster'].includes(m.status));
  if (mem) {
    const org = getOrganization(mem.organizationId);
    if (mem.status === 'traveling_to_muster') parts.push(`กำลังเดินทางไปรวมพลกับ${org?.name || 'องค์กร'}`);
    else parts.push(`อยู่ใน${org?.name || 'องค์กร'} ในฐานะ${mem.role || mem.rank || 'สมาชิก'}`);
  }
  const wb = (world.warbands || []).find(w => w.memberIds?.includes(agent.id));
  if (wb) parts.push(`อยู่ใน warband ${wb.name}${wb.travel ? ' กำลังเดินทาง' : ''}`);
  const wounds = (agent.injuries || []).filter(i => !i.healed).length;
  if (wounds) parts.push(`มีบาดแผล ${wounds} แห่ง`);
  if (agent.fame >= 5) parts.push(`มีชื่อเสียงระดับ ${fmt(agent.fame)}`);
  parts.push(`ปัจจุบันอยู่ที่${loc?.name || 'ระหว่างเดินทาง'} — ${agent.currentThought || agent.currentGoal || 'ดำเนินชีวิต'}`);
  return parts.join(' ') + '.';
}

function generateOrganizationSummary(org) {
  if (!org) return '—';
  const leader = getAgent(org.leaderId);
  const home = getSettlement(org.homeSettlementId);
  const active = (org.memberIds || []).map(getAgent).filter(a => a && a.alive).length;
  const wbs = (world.warbands || []).filter(w => w.organizationId === org.id && warbandMembers(w).length > 0);
  const unpaid = (org.memberIds || []).map(getAgent).filter(a => {
    const m = (a?.memberships || []).find(x => x.organizationId === org.id);
    return m && world.day - (m.lastPaidDay || 0) > 7;
  }).length;
  let s = `${org.name} (${org.type}) มีสมาชิกจริง ${active} คน`;
  if (leader) s += ` นำโดย ${leader.name}`;
  if (home) s += ` ฐานที่${home.name}`;
  s += ` ชื่อเสียง ${fmt(org.reputation || 0)} คลังอาหาร ${fmt(org.foodReserve || 0)}`;
  if (unpaid > 2) s += ` มีความเสี่ยงค่าจ้างค้าง ${unpaid} คน`;
  if (wbs.length) s += ` มี warband ปฏิบัติการ ${wbs.length} กอง`;
  return s + '.';
}

function generateWarbandSummary(wb) {
  if (!wb) return '—';
  const n = warbandMembers(wb).length;
  const from = getSettlement(wb.locationId);
  const dest = wb.destinationId ? getSettlement(wb.destinationId) : (wb.travel?.path?.length ? getSettlement(wb.travel.path[wb.travel.path.length - 1]) : null);
  const supply = wb.supplyDays != null ? wb.supplyDays : (n ? Math.floor((wb.food || 0) / Math.max(n * 0.8, 1)) : 0);
  let s = `${wb.name} มีสมาชิกจริง ${n} คน สถานะ ${wb.status || 'idle'}`;
  if (from && dest && from.id !== dest.id) s += ` กำลังเดินทางจาก${from.name}ไป${dest.name}`;
  else if (from) s += ` อยู่ที่${from.name}`;
  s += ` เสบียงเหลือประมาณ ${supply} วัน morale ${fmt(wb.morale || 50)}`;
  if ((wb.morale || 50) < 40) s += ' ขวัญต่ำ';
  if (supply < 3) s += ' เสี่ยงอดอาหาร';
  return s + '.';
}

function generateBattleSummary(br) {
  if (!br) return '—';
  if (br.chronicleText) return br.chronicleText;
  if (br.summaryText) return br.summaryText;
  const loc = br.location || (br.locationId ? getSettlement(br.locationId)?.name : 'สนามรบ');
  return `ศึก${br.title || loc} วันที่ ${br.day} เสียชีวิต ${br.casualties || 0} — ฝ่าย${br.winner === 'attacker' ? 'บุก' : 'รับ'}ได้ชัย`;
}

function generateWeaponSummary(item) {
  if (!item) return '—';
  return `${item.name || item.type || 'อาวุธ'} คุณภาพ ${item.quality || 'common'} สังหาร ${item.kills || 0} fame ${fmt(item.fame || 0)}${item.legendary ? ' (ตำนาน)' : ''}`;
}

function generateFormationSummary(formation) {
  const f = FORMATION_INFO[formation] || { label: formation, strengths: '—', weaknesses: '—', terrain: '—', counters: '—' };
  return `แนว${f.label}: จุดแข็ง ${f.strengths} จุดอ่อน ${f.weaknesses} เหมาะ ${f.terrain}`;
}

function getEntityDisplayName(type, id) {
  if (type === 'agent') return getAgent(id)?.name || `Agent #${id}`;
  if (type === 'organization') return getOrganization(id)?.name || `Org #${id}`;
  if (type === 'warband') return getWarband(id)?.name || `Warband #${id}`;
  if (type === 'unit') return getUnit(id)?.name || `Unit #${id}`;
  if (type === 'army') return getArmy(id)?.name || `Army #${id}`;
  if (type === 'settlement') return getSettlement(id)?.name || `Settlement #${id}`;
  if (type === 'battle') return (world.battleReports || []).find(b => b.id === id)?.title || `Battle #${id}`;
  if (type === 'recruitmentOffer') return `Offer #${id}`;
  if (type === 'musterPoint') return `Muster #${id}`;
  return `${type} #${id}`;
}

function openEntityDetail(type, id, opts) {
  opts = opts || {};
  if (type === 'battle') {
    PageViewSystem.prefs.combat.selectedId = id;
    PageViewSystem.prefs.combat.tab = 'battles';
    UI.setView('combat');
  } else if (type === 'agent') {
    PageViewSystem.prefs.characters.selectedId = id;
    UI.setView(opts.view || 'characters');
  } else if (type === 'organization' || type === 'warband' || type === 'recruitmentOffer' || type === 'musterPoint' || type === 'army') {
    PageViewSystem.prefs.organizations.selectedId = type === 'warband' ? 'wb:' + id : id;
    if (type === 'warband') PageViewSystem.prefs.organizations.tab = 'warbands';
    else PageViewSystem.prefs.organizations.tab = 'organizations';
    UI.setView('organizations');
  } else if (type === 'settlement' || type === 'route') {
    UI.setView('map');
    UI.selected = { kind: type, id };
    UI.inspectorDirty = true;
    if (!opts.noCenter) centerEntityOnMap(type, id);
    return;
  } else if (type === 'weapon' || type === 'unit') {
    PageViewSystem.prefs.combat.tab = type === 'weapon' ? 'weapons' : 'battles';
    UI.setView('combat');
  } else {
    UI.setView('map');
    UI.selected = { kind: type, id };
    UI.inspectorDirty = true;
  }
  if (!opts.noCenter && type !== 'battle' && type !== 'weapon') centerEntityOnMap(type, id);
}

function centerEntityOnMap(type, id) {
  if (type === 'battle') {
    const br = (world.battleReports || []).find(b => b.id === id);
    if (br?.locationId && typeof ObserverSystem !== 'undefined') {
      ObserverSystem.centerOn('settlement', br.locationId);
      return;
    }
  }
  if (typeof ObserverSystem !== 'undefined') ObserverSystem.centerOn(type, id);
}

function followEntity(type, id) {
  if (typeof ObserverSystem !== 'undefined') ObserverSystem.startFollow(type, id);
}

const PageViewSystem = {
  LIST_LIMIT: 50,
  prefs: {
    characters: { filter: 'all', search: '', selectedId: null, listPage: 0 },
    organizations: { tab: 'organizations', filter: 'all', search: '', selectedId: null, listPage: 0 },
    combat: { tab: 'battles', filter: 'recent', search: '', selectedId: null, listPage: 0 },
    chronicle: { filter: 'all', search: '', selectedId: null },
    world: {}
  },

  init() {
    const bind = (id, view) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => UI.setView(view));
    };
    bind('btnMap', 'map');
    bind('btnCharacters', 'characters');
    bind('btnOrganizationsPage', 'organizations');
    bind('btnCombat', 'combat');
    bind('btnChroniclePage', 'chronicle');
    const wc = document.getElementById('btnWorldSummary');
    if (wc) wc.addEventListener('click', () => UI.setView('world'));
  },

  defaultPrefs() {
    return JSON.parse(JSON.stringify(this.prefs));
  },

  applyPrefs(p) {
    if (!p) return;
    this.prefs = Object.assign(this.defaultPrefs(), p);
  },

  getPrefs() {
    return JSON.parse(JSON.stringify(this.prefs));
  },

  isMobile() {
    return window.innerWidth < 768;
  },

  linkChip(type, id, label) {
    if (id == null) return escHtml(label || '—');
    return `<button type="button" class="link-chip" data-open-type="${type}" data-open-id="${id}">${escHtml(label || getEntityDisplayName(type, id))}</button>`;
  },

  section(title, body, collapsed) {
    return `<div class="detail-section${collapsed ? ' collapsed' : ''}"><h4 class="ds-toggle">${escHtml(title)}</h4><div class="ds-body">${body}</div></div>`;
  },

  wirePage(root) {
    if (!root) return;
    for (const btn of root.querySelectorAll('[data-open-type]')) {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        openEntityDetail(btn.dataset.openType, isNaN(+btn.dataset.openId) ? btn.dataset.openId : +btn.dataset.openId);
      });
    }
    for (const card of root.querySelectorAll('.entity-card')) {
      card.addEventListener('click', () => {
        const view = UI.currentView;
        const id = card.dataset.id;
        const kind = card.dataset.kind;
        if (view === 'characters') this.prefs.characters.selectedId = +id;
        else if (view === 'organizations') this.prefs.organizations.selectedId = kind === 'warband' ? 'wb:' + id : +id;
        else if (view === 'combat') this.prefs.combat.selectedId = id;
        else if (view === 'chronicle') this.prefs.chronicle.selectedId = +id;
        UI.pageDirty = true;
        PageViewSystem.renderCurrent();
      });
    }
    for (const fl of root.querySelectorAll('.page-filter')) {
      fl.addEventListener('click', () => {
        const view = UI.currentView;
        const f = fl.dataset.filter;
        if (view === 'characters') this.prefs.characters.filter = f;
        else if (view === 'organizations') this.prefs.organizations.filter = f;
        else if (view === 'combat') this.prefs.combat.filter = f;
        else if (view === 'chronicle') this.prefs.chronicle.filter = f;
        UI.pageDirty = true;
        PageViewSystem.renderCurrent();
      });
    }
    for (const tab of root.querySelectorAll('.page-tab')) {
      tab.addEventListener('click', () => {
        const view = UI.currentView;
        const t = tab.dataset.tab;
        if (view === 'organizations') this.prefs.organizations.tab = t;
        else if (view === 'combat') this.prefs.combat.tab = t;
        UI.pageDirty = true;
        PageViewSystem.renderCurrent();
      });
    }
    const search = root.querySelector('.page-search');
    if (search) {
      search.addEventListener('input', () => {
        const view = UI.currentView;
        const q = search.value;
        if (view === 'characters') this.prefs.characters.search = q;
        else if (view === 'organizations') this.prefs.organizations.search = q;
        else if (view === 'combat') this.prefs.combat.search = q;
        else if (view === 'chronicle') this.prefs.chronicle.search = q;
        UI.pageDirty = true;
        PageViewSystem.renderCurrent();
      });
    }
    for (const btn of root.querySelectorAll('[data-page-action]')) {
      btn.addEventListener('click', () => {
        const act = btn.dataset.pageAction;
        const type = btn.dataset.entityType;
        const id = +btn.dataset.entityId;
        if (act === 'center') { UI.setView('map'); centerEntityOnMap(type, id); UI.selected = { kind: type, id }; UI.inspectorDirty = true; }
        else if (act === 'follow') { UI.setView('map'); followEntity(type, id); UI.selected = { kind: type, id }; UI.inspectorDirty = true; }
        else if (act === 'map') UI.setView('map');
      });
    }
    for (const sm of root.querySelectorAll('.show-more-btn')) {
      sm.addEventListener('click', () => {
        const view = UI.currentView;
        if (view === 'characters') this.prefs.characters.listPage++;
        else if (view === 'organizations') this.prefs.organizations.listPage++;
        else if (view === 'combat') this.prefs.combat.listPage++;
        UI.pageDirty = true;
        PageViewSystem.renderCurrent();
      });
    }
    for (const tg of root.querySelectorAll('.ds-toggle')) {
      tg.addEventListener('click', () => tg.parentElement.classList.toggle('collapsed'));
    }
  },

  renderCurrent() {
    const el = document.getElementById('pageContainer');
    if (!el || UI.currentView === 'map') return;
    UIIndexes.rebuild();
    const mobile = this.isMobile();
    let html = '';
    if (UI.currentView === 'characters') html = this.renderCharactersPage(mobile);
    else if (UI.currentView === 'organizations') html = this.renderOrganizationsPage(mobile);
    else if (UI.currentView === 'combat') html = this.renderCombatPage(mobile);
    else if (UI.currentView === 'chronicle') html = this.renderChroniclePage(mobile);
    else if (UI.currentView === 'world') html = this.renderWorldPage(mobile);
    el.innerHTML = html;
    this.wirePage(el);
    UI.pageDirty = false;
  },

  pageShell(title, filters, tabs, listHtml, detailHtml, searchVal) {
    return `<div class="page-view">
      <div class="page-header">
        <button type="button" class="page-back-btn" data-page-action="map">← กลับแผนที่</button>
        <h2>${escHtml(title)}</h2>
        <input class="page-search" type="search" placeholder="ค้นหา..." value="${escHtml(searchVal || '')}">
      </div>
      ${tabs || ''}
      ${filters ? `<div class="page-filters">${filters}</div>` : ''}
      <div class="page-body${this.isMobile() ? ' mobile-stack' : ''}">
        <div class="entity-list">${listHtml}</div>
        <div class="detail-panel">${detailHtml || '<p class="hint">เลือกรายการเพื่อดูรายละเอียด</p>'}</div>
      </div>
    </div>`;
  },

  filterAgents() {
    const idx = UIIndexes.rebuild();
    const p = this.prefs.characters;
    const q = (p.search || '').toLowerCase();
    let list = idx.alive.slice();
    const f = p.filter;
    if (f === 'famous') list = list.filter(a => a.fame >= 8);
    else if (f === 'dead') list = idx.dead.slice();
    else if (f === 'warriors') list = list.filter(a => MILITARY_PROFS.has(a.profession));
    else if (f === 'traders') list = list.filter(a => a.profession === 'trader' || a.guildId);
    else if (f === 'leaders') list = list.filter(a => (a.skills?.leadership || 0) >= 3 || a.rank === 'officer');
    else if (f === 'wounded') list = list.filter(a => (a.injuries || []).some(i => !i.healed));
    else if (f === 'veterans') list = list.filter(a => (a.memory?.survivedBattles || 0) >= 2);
    else if (f === 'duelists') list = list.filter(a => (a.duelRecord?.wins || 0) > 0);
    else if (f === 'guild') list = list.filter(a => a.guildId || (a.memberships || []).some(m => getOrganization(m.organizationId)?.type === 'merchant_guild'));
    else if (f === 'warband') list = list.filter(a => (world.warbands || []).some(w => w.memberIds?.includes(a.id)));
    else if (f === 'muster') list = list.filter(a => (a.memberships || []).some(m => m.status === 'traveling_to_muster'));
    else if (f === 'refugee') list = list.filter(a => !a.homeId || a.profession === 'unemployed' || a.profession === 'migrant');
    else if (f === 'ambition') list = list.filter(a => (a.traits?.ambition || 0) > 0.7);
    else if (f === 'revenge') list = list.filter(a => Object.values(a.relationships || {}).some(r => r < -30));
    else if (f === 'loyal') list = list.filter(a => (a.traits?.loyalty || 0) > 0.75);
    else if (f === 'richest') list = idx.agentsByWealth.slice();
    else if (f === 'connected') list = idx.agentsByConnections.slice();
    else if (f === 'scarred') list = list.filter(a => (a.injuries || []).some(i => i.permanent || i.type === 'scar'));
    if (q) list = list.filter(a => (idx.searchIndex.find(s => s.type === 'agent' && s.id === a.id)?.text || '').includes(q) || a.name.toLowerCase().includes(q));
    if (f === 'famous' || f === 'richest' || f === 'connected') list.sort((a, b) => (b.fame || 0) - (a.fame || 0));
    else list.sort((a, b) => (b.fame || 0) - (a.fame || 0) || a.name.localeCompare(b.name));
    return list;
  },

  agentCard(a) {
    const loc = getSettlement(a.locationId);
    const mem = (a.memberships || []).find(m => ['active', 'traveling_to_muster'].includes(m.status));
    const org = mem ? getOrganization(mem.organizationId) : null;
    const danger = a.travel || (a.injuries || []).some(i => !i.healed) || mem?.status === 'traveling_to_muster';
    const sub = [a.profession, loc?.name, org?.name].filter(Boolean).join(' · ');
    return `<button type="button" class="entity-card${this.prefs.characters.selectedId === a.id ? ' active' : ''}" data-kind="agent" data-id="${a.id}">
      <div class="ec-title">${danger ? '⚠ ' : ''}${escHtml(a.name)}${a.title ? ` <span class="stat-chip">${escHtml(a.title)}</span>` : ''}</div>
      <div class="ec-sub">${escHtml(sub)} · HP ${fmt(a.stats?.health || 0)} · ⭐ ${fmt(a.fame || 0)}</div>
      <div class="ec-sub">💭 ${escHtml((a.currentThought || '').slice(0, 60))}</div>
    </button>`;
  },

  renderCharacterDetail(a) {
    if (!a) return '<p class="hint">ไม่พบตัวละคร</p>';
    const loc = getSettlement(a.locationId);
    const home = a.homeId ? getSettlement(a.homeId) : null;
    const birth = a.memory?.personal?.birthplaceId ? getSettlement(a.memory.personal.birthplaceId) : null;
    const f = getFaction(a.factionId);
    let html = `<div class="page-summary">${escHtml(generateAgentSummary(a))}</div>`;
    html += `<div class="page-actions">
      <button class="page-action-btn" data-page-action="center" data-entity-type="agent" data-entity-id="${a.id}">📍 Center on Map</button>
      <button class="page-action-btn" data-page-action="follow" data-entity-type="agent" data-entity-id="${a.id}">👁 Follow</button>
    </div>`;
    html += this.section('A. ตัวตน', [
      UI.kv('ชื่อ', a.name), UI.kv('อายุ', a.age), UI.kv('เกิดที่', birth ? this.linkChip('settlement', birth.id, birth.name) : '—'),
      UI.kv('ที่อยู่', loc ? this.linkChip('settlement', loc.id, loc.name) : 'ระหว่างเดินทาง'),
      UI.kv('บ้าน', home ? this.linkChip('settlement', home.id, home.name) : '—'),
      UI.kv('ฝ่าย', f ? this.linkChip('faction', f.id, f.name) : '—'),
      UI.kv('ความคิด', `"${escHtml(a.currentThought)}"`), UI.kv('เป้าหมาย', a.currentGoal)
    ].join(''));
    html += this.section('B. อาชีพ', [
      UI.kv('อาชีพ', a.profession), UI.kv('ยศ', a.rank), UI.kv('เส้นทาง', (a.career || []).map(c => `D${c.day}:${c.profession}`).join(' → ')),
      UI.kv('รายได้', fmt(a.stats?.wealth || 0))
    ].join(''));
    const memRows = (a.memberships || []).map(m => {
      const org = getOrganization(m.organizationId);
      return `<div>${org ? this.linkChip('organization', org.id, org.name) : '?'} — ${m.role || m.rank} · ${m.status} · ภักดี ${fmt(m.loyalty || 0)}</div>`;
    }).join('') || '<span class="hint">ไม่มีสมาชิกภาพ</span>';
    html += this.section('C. สมาชิกภาพ', memRows);
    const body = a.body || {};
    const eq = a.equipment || {};
    html += this.section('D. ร่างกาย & การต่อสู้', [
      UI.kv('ร่าง', `${body.build || '—'} / สูง ${body.height || '—'}`),
      UI.kv('อาวุธ', eq.mainHand ? `${eq.mainHand.type} (${eq.mainHand.quality || 'common'})` : '—'),
      UI.kv('เกราะ', eq.armor?.type || eq.chest?.type || '—'),
      UI.kv('บาดแผล', (a.injuries || []).filter(i => !i.healed).map(i => i.type || i.part).join(', ') || 'ไม่มี'),
      UI.kv('ดวล', `ชนะ ${a.duelRecord?.wins || 0} / แพ้ ${a.duelRecord?.losses || 0} / สังหาร ${a.duelRecord?.kills || 0}`),
      UI.kv('รอดศึก', a.memory?.survivedBattles || 0)
    ].join(''));
    const battles = (world.battleReports || []).filter(br => br.commanders?.includes(a.id) || br.notableAgents?.some(n => n.id === a.id)).slice(-5);
    html += this.section('E. ประวัติศึก', battles.length ? battles.map(br => this.linkChip('battle', br.id, `D${br.day} ${br.title || br.location || 'ศึก'}`)).join(' ') : '<span class="hint">ยังไม่มี</span>');
    const pers = a.memory?.personal;
    html += this.section('F. ความทรงจำ', [
      pers?.turningPoints?.length ? `<div>จุดเปลี่ยน: ${pers.turningPoints.slice(-3).map(t => escHtml(t.text || t.kind)).join('; ')}</div>` : '',
      pers?.trauma?.length ? `<div>บาดแผลใจ: ${pers.trauma.slice(-2).map(t => escHtml(t.text || t.kind)).join('; ')}</div>` : '',
      pers?.grudges?.length ? `<div>แค้น: ${pers.grudges.slice(-2).map(g => escHtml(g.text || g.targetId)).join('; ')}</div>` : ''
    ].filter(Boolean).join('') || '<span class="hint">—</span>');
    const rels = Object.entries(a.relationships || {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8);
    html += this.section('G. ความสัมพันธ์', rels.length ? rels.map(([oid, v]) => {
      const o = getAgent(+oid);
      return o ? `${this.linkChip('agent', o.id, o.name)} (${v > 0 ? '+' : ''}${fmt(v)})` : '';
    }).join(' ') : '<span class="hint">—</span>');
    return html;
  },

  renderCharactersPage(mobile) {
    const p = this.prefs.characters;
    const list = this.filterAgents();
    const limit = this.LIST_LIMIT * (p.listPage + 1);
    const slice = list.slice(0, limit);
    if (!p.selectedId && slice[0]) p.selectedId = slice[0].id;
    const sel = getAgent(p.selectedId) || (p.filter === 'dead' ? world.agents.find(a => a.id === p.selectedId) : null);
    const filters = ['all', 'famous', 'alive', 'warriors', 'leaders', 'wounded', 'veterans', 'duelists', 'warband', 'muster', 'richest', 'scarred'].map(f =>
      `<button type="button" class="page-filter${p.filter === f ? ' active' : ''}" data-filter="${f}">${f}</button>`).join('');
    const listHtml = slice.map(a => this.agentCard(a)).join('') + (list.length > limit ? `<button type="button" class="show-more-btn">แสดงเพิ่ม (${list.length - limit})</button>` : '');
    return this.pageShell('👤 Characters', filters, '', listHtml, this.renderCharacterDetail(sel), p.search);
  },

  orgCard(o) {
    const leader = getAgent(o.leaderId);
    const n = (o.memberIds || []).map(getAgent).filter(a => a && a.alive).length;
    const risk = (o.foodReserve || 0) < n * 2 ? 'warn' : '';
    return `<button type="button" class="entity-card${String(this.prefs.organizations.selectedId) === String(o.id) ? ' active' : ''}" data-kind="organization" data-id="${o.id}">
      <div class="ec-title">${escHtml(o.name)} <span class="stat-chip">${escHtml(o.type)}</span></div>
      <div class="ec-sub">${leader ? escHtml(leader.name) : '—'} · สมาชิกจริง ${n} · ชื่อเสียง ${fmt(o.reputation || 0)}</div>
      ${risk ? '<span class="risk-chip warn">เสี่ยงเสบียง</span>' : ''}
    </button>`;
  },

  wbCard(wb) {
    const n = warbandMembers(wb).length;
    const loc = getSettlement(wb.locationId);
    return `<button type="button" class="entity-card${this.prefs.organizations.selectedId === 'wb:' + wb.id ? ' active' : ''}" data-kind="warband" data-id="${wb.id}">
      <div class="ec-title">⚔ ${escHtml(wb.name)} <span class="stat-chip">${escHtml(wb.type)}</span></div>
      <div class="ec-sub">${wb.status} · ${n} คน · ${loc?.name || '?'} · อาหาร ${fmt(wb.food || 0)}</div>
    </button>`;
  },

  renderOrgDetail(org) {
    if (!org) return '<p class="hint">ไม่พบองค์กร</p>';
    let html = `<div class="page-summary">${escHtml(generateOrganizationSummary(org))}</div>`;
    html += `<div class="page-actions">
      <button class="page-action-btn" data-page-action="center" data-entity-type="organization" data-entity-id="${org.id}">📍 Center</button>
    </div>`;
    const leader = getAgent(org.leaderId);
    const home = getSettlement(org.homeSettlementId);
    const members = (org.memberIds || []).map(getAgent).filter(a => a && a.alive);
    const traveling = members.filter(a => (a.memberships || []).find(m => m.organizationId === org.id)?.status === 'traveling_to_muster');
    html += this.section('ภาพรวม', [
      UI.kv('ผู้นำ', leader ? this.linkChip('agent', leader.id, leader.name) : '—'),
      UI.kv('ฐาน', home ? this.linkChip('settlement', home.id, home.name) : '—'),
      UI.kv('สมาชิกจริง', members.length), UI.kv('กำลังมารวมพล', traveling.length),
      UI.kv('คลัง', `💰 ${fmt(org.wealth || 0)} · 🍞 ${fmt(org.foodReserve || 0)}`)
    ].join(''));
    const wbs = (world.warbands || []).filter(w => w.organizationId === org.id);
    html += this.section('Warbands', wbs.length ? wbs.map(w => this.linkChip('warband', w.id, `${w.name} (${warbandMembers(w).length})`)).join(' ') : '—');
    const offers = (world.recruitmentOffers || []).filter(r => r.organizationId === org.id && r.status === 'open');
    html += this.section('รับสมัคร', offers.length ? offers.map(r => `ต้องการ ${r.quantityNeeded} (${r.type})`).join('<br>') : 'ไม่มีประกาศ');
    return html;
  },

  renderWarbandDetail(wb) {
    if (!wb) return '<p class="hint">ไม่พบ warband</p>';
    let html = `<div class="page-summary">${escHtml(generateWarbandSummary(wb))}</div>`;
    html += `<div class="page-actions">
      <button class="page-action-btn" data-page-action="center" data-entity-type="warband" data-entity-id="${wb.id}">📍 Center</button>
      <button class="page-action-btn" data-page-action="follow" data-entity-type="warband" data-entity-id="${wb.id}">👁 Follow</button>
    </div>`;
    const dest = wb.destinationId ? getSettlement(wb.destinationId) : null;
    const route = wb.travel ? (wb.travel.path || []).map(getSettlement).filter(Boolean).map(s => s.name).join(' → ') : '';
    html += this.section('การเคลื่อนที่', [
      UI.kv('สถานะ', wb.status), UI.kv('ตำแหน่ง', getSettlement(wb.locationId)?.name || '?'),
      UI.kv('ปลายทาง', dest ? dest.name : '—'), UI.kv('เส้นทาง', route || '—'),
      UI.kv('ความเร็ว', fmt(WarbandSystem?.computeSpeed?.(wb) || 0, 2))
    ].join(''));
    const comp = wb.composition || {};
    html += this.section('องค์ประกอบ', [
      UI.kv('ขนาดจริง', warbandMembers(wb).length),
      UI.kv('ทหาร', `ดาบ ${comp.swordsmen || 0} · หอก ${comp.spearmen || 0} · ธนู ${comp.archers || 0} · ม้า ${comp.cavalry || 0}`)
    ].join(''));
    html += this.section('เสบียง', [
      UI.kv('อาหาร', wb.food), UI.kv('Morale', wb.morale), UI.kv('Cohesion', wb.cohesion), UI.kv('Fatigue', wb.fatigue)
    ].join(''));
    const top = warbandMembers(wb).slice(0, 6);
    html += this.section('สมาชิก', top.map(m => this.linkChip('agent', m.id, m.name)).join(' '));
    return html;
  },

  renderOrganizationsPage(mobile) {
    const p = this.prefs.organizations;
    const tabs = ['organizations', 'warbands', 'recruitment', 'muster', 'headquarters'].map(t =>
      `<button type="button" class="page-tab${p.tab === t ? ' active' : ''}" data-tab="${t}">${t}</button>`).join('');
    const tabHtml = `<div class="page-tabs">${tabs}</div>`;
    let list = [], detail = '';
    const q = (p.search || '').toLowerCase();
    if (p.tab === 'warbands') {
      list = (world.warbands || []).filter(w => warbandMembers(w).length > 0);
      if (q) list = list.filter(w => w.name.toLowerCase().includes(q));
      const limit = this.LIST_LIMIT * (p.listPage + 1);
      const slice = list.slice(0, limit);
      if (!p.selectedId && slice[0]) p.selectedId = 'wb:' + slice[0].id;
      const wbId = String(p.selectedId || '').startsWith('wb:') ? +String(p.selectedId).slice(3) : null;
      detail = this.renderWarbandDetail(wbId ? getWarband(wbId) : null);
      const listHtml = slice.map(w => this.wbCard(w)).join('');
      return this.pageShell('👥 Organizations & Warbands', '', tabHtml, listHtml, detail, p.search);
    }
    if (p.tab === 'recruitment') {
      list = world.recruitmentOffers || [];
      const listHtml = list.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q)).slice(0, 50).map(r => {
        const org = getOrganization(r.organizationId);
        return `<div class="entity-card"><div class="ec-title">${org?.name || 'Org'} — ${r.type}</div><div class="ec-sub">ต้องการ ${r.quantityNeeded} · ${r.status}</div></div>`;
      }).join('');
      return this.pageShell('📢 Recruitment Offers', '', tabHtml, listHtml, '<p class="hint">เลือกประกาศจากรายการ</p>', p.search);
    }
    list = (world.organizations || []).filter(o => o.status !== 'disbanded');
    if (q) list = list.filter(o => o.name.toLowerCase().includes(q) || o.type.includes(q));
    const limit = this.LIST_LIMIT * (p.listPage + 1);
    const slice = list.slice(0, limit);
    if (!p.selectedId && slice[0]) p.selectedId = slice[0].id;
    const org = getOrganization(+p.selectedId);
    detail = this.renderOrgDetail(org);
    const listHtml = slice.map(o => this.orgCard(o)).join('');
    return this.pageShell('👥 Organizations', '', tabHtml, listHtml, detail, p.search);
  },

  battleCard(br) {
    const sel = this.prefs.combat.selectedId;
    return `<button type="button" class="entity-card${sel === br.id ? ' active' : ''}" data-kind="battle" data-id="${br.id}">
      <div class="ec-title">${br.large ? '🏟 ' : '⚔ '}${escHtml(br.title || br.location || 'ศึก')}</div>
      <div class="ec-sub">Day ${br.day} · ${escHtml(br.location || '')} · เสียชีวิต ${br.casualties || 0}</div>
      <div class="ec-sub">${escHtml((br.summaryText || '').slice(0, 80))}</div>
    </button>`;
  },

  renderBattleDetail(br) {
    if (!br) return '<p class="hint">ไม่พบรายงานศึก</p>';
    let html = `<div class="page-summary">${escHtml(generateBattleSummary(br))}</div>`;
    html += `<div class="page-actions">
      ${br.locationId ? `<button class="page-action-btn" data-page-action="center" data-entity-type="settlement" data-entity-id="${br.locationId}">📍 Center Location</button>` : ''}
    </div>`;
    html += this.section('ภาพรวม', [
      UI.kv('วัน', br.day), UI.kv('สถานที่', br.location || getSettlement(br.locationId)?.name || '—'),
      UI.kv('ภูมิประเทศ', br.terrain || '—'), UI.kv('ผู้ชนะ', br.winner === 'attacker' ? 'ฝ่ายบุก' : 'ฝ่ายรับ'),
      UI.kv('เสียชีวิต', br.casualties || 0), UI.kv('บาดเจ็บ', br.wounded || br.injuries || 0)
    ].join(''));
    if (br.gridSnapshot) {
      const grid = br.gridSnapshot.map(row => row.map(c => `[${String(c).padEnd(5).slice(0, 5)}]`).join(' ')).join('\n');
      html += this.section('Battlefield Grid', `<pre class="battle-grid">${escHtml(grid)}</pre>`);
    }
    if (br.phaseSummaries?.length) {
      html += this.section('Phase Summary', br.phaseSummaries.map(ph => `<div><b>${escHtml(ph.phase || ph.name)}</b>: ${escHtml(ph.text || ph.summary || '')}</div>`).join(''));
    } else if (br.phases?.length) {
      html += this.section('Phase Summary', br.phases.map(ph => `<div><b>${escHtml(ph.name)}</b>: ${escHtml(ph.text)}</div>`).join(''));
    }
    if (br.turningPoints?.length) html += this.section('จุดเปลี่ยน', br.turningPoints.map(t => `<div>• ${escHtml(t.text || t)}</div>`).join(''));
    if (br.commanders?.length) html += this.section('ผู้บัญชาการ', br.commanders.map(id => this.linkChip('agent', id, getAgent(id)?.name || id)).join(' '));
    return html;
  },

  renderCombatPage(mobile) {
    const p = this.prefs.combat;
    const tabs = ['battles', 'large', 'formations', 'weapons', 'injuries', 'rankings'].map(t =>
      `<button type="button" class="page-tab${p.tab === t ? ' active' : ''}" data-tab="${t}">${t}</button>`).join('');
    const tabHtml = `<div class="page-tabs">${tabs}</div>`;
    const idx = UIIndexes.rebuild();
    if (p.tab === 'formations') {
      const body = Object.keys(FORMATION_INFO).map(fk => {
        const uses = world.units.filter(u => u.formation === fk).length;
        return `<div class="detail-section"><h4><span class="formation-badge">${fk}</span> ${FORMATION_INFO[fk].label}</h4><div>${escHtml(generateFormationSummary(fk))} · ใช้ล่าสุด ~${uses}</div></div>`;
      }).join('');
      return this.pageShell('⚔ Formations', '', tabHtml, '<p class="hint">แนวการต่อสู้</p>', body, p.search);
    }
    if (p.tab === 'weapons') {
      const listHtml = idx.weaponsByFame.slice(0, 50).map(w => `<div class="entity-card"><div class="ec-title">${escHtml(w.item.name || w.item.type)}</div><div class="ec-sub">${generateWeaponSummary(w.item)} · ${getAgent(w.ownerId)?.name || '?'}</div></div>`).join('');
      return this.pageShell('⚔ Weapons', '', tabHtml, listHtml, '', p.search);
    }
    if (p.tab === 'injuries') {
      const listHtml = idx.injuriesActive.slice(0, 50).map(x => {
        const a = getAgent(x.agentId);
        return `<div class="entity-card" data-kind="agent" data-id="${a?.id}"><div class="ec-title">${a?.name || '?'}</div><div class="ec-sub">${x.injury.type || x.injury.part} — ${x.injury.severity || ''}</div></div>`;
      }).join('');
      return this.pageShell('🩹 Injuries', '', tabHtml, listHtml, '', p.search);
    }
    if (p.tab === 'rankings') {
      const r = TextCombatCore?.rankings?.() || {};
      const body = `<div>${(r.duelists || []).map(a => this.linkChip('agent', a.id, `${a.name} (${a.duelRecord?.wins}W)`)).join(' ')}</div>`;
      return this.pageShell('🏆 Combat Rankings', '', tabHtml, '<p class="hint">อันดับ</p>', body, p.search);
    }
    let list = idx.battlesByDay.slice();
    if (p.tab === 'large') list = list.filter(b => b.large);
    if (p.filter === 'famous') list = list.filter(b => (b.casualties || 0) >= 10);
    const q = (p.search || '').toLowerCase();
    if (q) list = list.filter(b => JSON.stringify(b).toLowerCase().includes(q));
    const limit = this.LIST_LIMIT * (p.listPage + 1);
    const slice = list.slice(0, limit);
    if (!p.selectedId && slice[0]) p.selectedId = slice[0].id;
    const br = list.find(b => b.id === p.selectedId) || (world.battleReports || []).find(b => b.id === p.selectedId);
    const filters = ['recent', 'famous', 'large', 'ambush'].map(f => `<button type="button" class="page-filter${p.filter === f ? ' active' : ''}" data-filter="${f}">${f}</button>`).join('');
    const listHtml = slice.map(b => this.battleCard(b)).join('');
    return this.pageShell('⚔ Combat & Battles', filters, tabHtml, listHtml, this.renderBattleDetail(br), p.search);
  },

  renderChroniclePage(mobile) {
    const p = this.prefs.chronicle;
    let entries = (world.chronicle || []).slice().reverse();
    const q = (p.search || '').toLowerCase();
    if (p.filter !== 'all') entries = entries.filter(e => e.category === p.filter);
    if (q) entries = entries.filter(e => (e.title + ' ' + (e.description || '')).toLowerCase().includes(q));
    entries = entries.slice(0, 100);
    if (!p.selectedId && entries[0]) p.selectedId = entries[0].day;
    const listHtml = entries.map(e => `<button type="button" class="entity-card${p.selectedId === e.day ? ' active' : ''}" data-kind="chronicle" data-id="${e.day}">
      <div class="ec-title">${escHtml(e.title)}</div><div class="ec-sub">Day ${e.day} · ${e.category}</div>
    </button>`).join('');
    const sel = entries.find(e => e.day === p.selectedId) || entries[0];
    const detail = sel ? `<div class="page-summary">${escHtml(sel.description || sel.title)}</div>${ObserverSystem.chronicleTargetButtons(sel)}` : '';
    const filters = ['all', 'war', 'legend', 'personal', 'market'].map(f => `<button type="button" class="page-filter${p.filter === f ? ' active' : ''}" data-filter="${f}">${f}</button>`).join('');
    return this.pageShell('📖 Chronicle', filters, '', listHtml, detail, p.search);
  },

  renderWorldPage(mobile) {
    const body = UI.worldSummaryHTML();
    return this.pageShell('🌍 World Summary', '', '', '<p class="hint">สรุปโลก</p>', body, '');
  }
};

/* ═══════════════════ 17. UI ═══════════════════ */

const UI = {
  paused: false,
  speed: 1,
  heatmapMode: 'none',
  currentView: 'map',
  pageDirty: true,
  selected: null,
  armedTool: null,
  roadPickFirst: null,
  logDirty: true,
  inspectorDirty: true,
  chronicleDirty: true,
  chronicleFilter: 'all',
  chronicleOpen: false,
  marketOpen: false,
  showRelationLines: false,
  dashboardDirty: true,
  _lastTickTime: 0,

  setView(view) {
    this.currentView = view || 'map';
    const main = document.getElementById('main');
    const page = document.getElementById('pageContainer');
    const mapWrap = document.getElementById('mapWrap');
    const isMap = this.currentView === 'map';
    if (main) main.classList.toggle('page-mode', !isMap);
    if (page) page.classList.toggle('hidden', isMap);
    if (mapWrap && isMap) mapWrap.classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.id === {
      map: 'btnMap', characters: 'btnCharacters', organizations: 'btnOrganizationsPage',
      combat: 'btnCombat', chronicle: 'btnChroniclePage', world: 'btnWorldSummary'
    }[this.currentView]));
    if (!isMap) {
      this.pageDirty = true;
      if (typeof PageViewSystem !== 'undefined') PageViewSystem.renderCurrent();
    }
  },

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
      document.getElementById('observerPanel')?.classList.add('hidden');
      if (typeof ObserverSystem !== 'undefined') ObserverSystem.observerOpen = false;
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
      document.getElementById('observerPanel')?.classList.add('hidden');
      document.getElementById('marketPanel')?.classList.add('hidden');
      ObserverSystem.observerOpen = false;
      this.marketOpen = false;
      this.chronicleOpen = false;
      const body = document.getElementById('diplomacyBody');
      if (body) body.innerHTML = DiplomacySystem.diplomacySummaryHTML();
    });
    document.getElementById('diplomacyClose')?.addEventListener('click', () => {
      document.getElementById('diplomacyPanel')?.classList.add('hidden');
    });

    document.getElementById('btnMarket')?.addEventListener('click', () => {
      this.marketOpen = !this.marketOpen;
      const p = document.getElementById('marketPanel');
      if (p) p.classList.toggle('hidden', !this.marketOpen);
      document.getElementById('observerPanel')?.classList.add('hidden');
      document.getElementById('chroniclePanel')?.classList.add('hidden');
      document.getElementById('diplomacyPanel')?.classList.add('hidden');
      document.getElementById('summaryModal')?.classList.add('hidden');
      document.getElementById('savePanel')?.classList.add('hidden');
      ObserverSystem.observerOpen = false;
      this.chronicleOpen = false;
      if (this.marketOpen && typeof MarketTradeSystem !== 'undefined') MarketTradeSystem.renderMarketPanel();
    });
    document.getElementById('marketClose')?.addEventListener('click', () => {
      this.marketOpen = false;
      document.getElementById('marketPanel')?.classList.add('hidden');
    });

    // ── sandbox tools ──
    for (const btn of document.querySelectorAll('.tool-btn')) {
      btn.addEventListener('click', () => SandboxTools.activate(btn.dataset.tool, btn));
    }

    // ── map interaction ──
    const canvas = document.getElementById('mapCanvas');
    canvas.addEventListener('click', e => {
      if (Renderer._dragMoved) { Renderer._dragMoved = false; return; }
      if (this.armedTool) { SandboxTools.applyAt(e.clientX, e.clientY); return; }
      this.selected = Renderer.pickAt(e.clientX, e.clientY);
      this.inspectorDirty = true;
    });
    canvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      SandboxTools.disarm();
    });

    if (typeof ObserverSystem !== 'undefined') ObserverSystem.init();
    if (typeof PageViewSystem !== 'undefined') PageViewSystem.init();
  },

  loop(ts) {
    const interval = { 1: 900, 5: 180, 20: 45 }[this.speed] || 900;
    if (!this.paused && ts - this._lastTickTime >= interval) {
      this._lastTickTime = ts;
      simulateDay();
    }
    Renderer.draw();
    if (typeof ObserverSystem !== 'undefined') ObserverSystem.tickFollow();
    document.getElementById('dayCounter').textContent = world ? `Day ${world.day}` : 'Day —';
    if (this.logDirty) { this.renderLog(); this.logDirty = false; }
    if (this.inspectorDirty) { this.renderInspector(); this.inspectorDirty = false; }
    if (this.chronicleOpen && this.chronicleDirty) { this.renderChronicle(); this.chronicleDirty = false; }
    if (this.dashboardDirty) {
      if (typeof ObserverSystem !== 'undefined') ObserverSystem.renderMiniDashboard();
      this.dashboardDirty = false;
    }
    if (typeof ObserverSystem !== 'undefined' && ObserverSystem.observerOpen && ObserverSystem.observerDirty) {
      ObserverSystem.renderPanel();
      ObserverSystem.observerDirty = false;
    }
    if (this.marketOpen && typeof MarketTradeSystem !== 'undefined') MarketTradeSystem.renderMarketPanel();
    if (this.currentView !== 'map' && this.pageDirty && typeof PageViewSystem !== 'undefined') PageViewSystem.renderCurrent();
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
           ${typeof ObserverSystem !== 'undefined' ? ObserverSystem.chronicleTargetButtons(e) : ''}
         </div>`).join('')
      : '<p class="hint">ยังไม่มีบันทึกในหมวดนี้ — ประวัติศาสตร์กำลังรอถูกเขียน</p>';
    for (const btn of el.querySelectorAll('.chron-target')) {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        ObserverSystem.focusTarget(btn.dataset.selKind, +btn.dataset.selId);
      });
    }
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
    const obs = typeof ObserverSystem !== 'undefined' ? ObserverSystem : null;
    const events = world.events.slice(-250).filter(ev => {
      if (obs && !obs.eventMatchesFilter(ev)) return false;
      if (obs && obs.logSearch && !(ev.text || '').toLowerCase().includes(obs.logSearch)) return false;
      return true;
    });
    const html = events.map(ev => {
      const ref = obs ? obs.firstEventRef(ev.refs) : null;
      const jump = ref
        ? ` <button class="log-jump" data-kind="${ref.kind}" data-id="${ref.id}">📍 ไปยังเป้าหมาย</button>`
        : '';
      return `<div class="log-entry ev-${ev.category}"><span class="log-day">Day ${ev.day}</span>${ev.text}${jump}</div>`;
    }).join('');
    el.innerHTML = html || '<div class="hint" style="padding:6px">ไม่มีเหตุการณ์ในตัวกรองนี้</div>';
    for (const btn of el.querySelectorAll('.log-jump')) {
      btn.addEventListener('click', () => ObserverSystem.focusTarget(btn.dataset.kind, +btn.dataset.id));
    }
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
    } else if (sel.kind === 'warband') {
      const wb = getWarband(sel.id);
      if (!wb) { this.selected = null; return; }
      title.textContent = `⚔ ${wb.name}`;
      body.innerHTML = this.warbandHTML(wb);
    } else if (sel.kind === 'organization') {
      const org = getOrganization(sel.id);
      if (!org) { this.selected = null; return; }
      title.textContent = `👥 ${org.name}`;
      body.innerHTML = this.organizationHTML(org);
    }
    this.wireInspectorLinks(body);
    this.wireFollowButtons(body);
  },

  followBtn(kind, id) {
    const active = ObserverSystem.follow && ObserverSystem.follow.kind === kind && ObserverSystem.follow.id === id;
    return `<button type="button" class="follow-btn ${active ? 'active' : ''}" data-follow-kind="${kind}" data-follow-id="${id}">${active ? '📍 กำลัง Follow' : '👁 Follow'}</button>`;
  },

  wireFollowButtons(body) {
    for (const btn of body.querySelectorAll('[data-follow-kind]')) {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        ObserverSystem.startFollow(btn.dataset.followKind, +btn.dataset.followId);
        this.inspectorDirty = true;
      });
    }
  },

  // ทำ links ใน inspector ให้คลิกได้
  wireInspectorLinks(body) {
    for (const link of body.querySelectorAll('[data-sel-kind]')) {
      link.addEventListener('click', () => {
        const kind = link.dataset.selKind;
        const id = +link.dataset.selId;
        if (typeof openEntityDetail !== 'undefined' && UI.currentView !== 'map' && ['agent', 'organization', 'warband', 'battle'].includes(kind)) {
          openEntityDetail(kind, id);
        } else {
          this.selected = { kind, id };
          this.inspectorDirty = true;
        }
      });
    }
    const relCb = body.querySelector('#showRelLines');
    if (relCb) relCb.addEventListener('change', () => { UI.showRelationLines = relCb.checked; });
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
    let html = `<div class="insp-actions">${this.followBtn('agent', a.id)}</div>`;
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
    if (a.profession === 'trader' || a.guildId) {
      const g = a.guildId ? getGuild(a.guildId) : null;
      html += `<div class="insp-section"><h4>การค้า (Phase 12)</h4>`;
      html += this.kv('Merchant Rank', MERCHANT_RANK_TITLES[a.merchantRank] || a.merchantRank);
      html += this.kv('Trade Reputation', fmt(a.tradeReputation || 50), (a.tradeReputation || 50) < 35 ? 'bad' : 'good');
      html += this.kv('สัญญาสำเร็จ/ล้มเหลว', `${a.contractsCompleted || 0} / ${a.contractsFailed || 0}`);
      html += this.kv('กำไรค้าสะสม', fmt(a.memory.tradeProfit || 0) + ' ทอง');
      if (g) html += this.kv('สมาคม', g.name);
      if (a.contractId) {
        const c = getContract(a.contractId);
        if (c) html += this.kv('สัญญาปัจจุบัน', `${c.good} ×${c.quantity} → ${(getSettlement(c.destinationId) || {}).name || '?'}`);
      }
      html += `</div>`;
    }
    // ── Phase 10.5: Ambition ──
    html += `<div class="insp-section"><h4>Ambition & เป้าหมาย</h4>`;
    html += this.kv('แผน', a.ambitionPlan || '—');
    html += this.kv('เป้าหมายเงิน', a.savingGoal ? fmt(a.savingGoal) + ' ทอง' : '—');
    html += this.kv('ซื้อถัดไป', a.nextPurchase || '—');
    if (a.lastMigrationDay > 0) html += this.kv('ย้ายล่าสุด', `Day ${a.lastMigrationDay}`);
    if (a.wantedLevel > 0) html += this.kv('ค่าหัว', fmt(a.wantedLevel), 'bad');
    html += `</div>`;
    if (typeof AgentMemorySystem !== 'undefined') {
      AgentMemorySystem.ensureAgent(a);
      if (a._motiveDay !== world.day) AgentMemorySystem.updateMotives(a);
      const m = a.motives || {};
      html += `<div class="insp-section"><h4>Core Motives (Phase 17)</h4>`;
      const motiveKeys = ['survival', 'wealth', 'safety', 'loyalty', 'revenge', 'ambition', 'duty', 'trade', 'power', 'fear'];
      for (const k of motiveKeys) html += this.kv(k, fmt(m[k] || 0, 0)) + this.bar(m[k] || 0, k === 'revenge' || k === 'fear' ? '#ef5350' : '#42a5f5');
      html += `</div>`;
      const allies = AgentMemorySystem.topRelations(a, 'trust', 3);
      const enemies = AgentMemorySystem.topRelations(a, 'grudge', 3);
      const loyal = AgentMemorySystem.topRelations(a, 'loyalty', 3);
      if (allies.length || enemies.length || loyal.length) {
        html += `<div class="insp-section"><h4>Relationships</h4>`;
        if (loyal.length) html += loyal.map(x => this.kv('ภักดีต่อ', this.link('agent', x.id, x.agent.name), 'good')).join('');
        if (allies.length) html += allies.map(x => this.kv('ไว้ใจ', this.link('agent', x.id, x.agent.name))).join('');
        if (enemies.length) html += enemies.map(x => this.kv('แค้น', this.link('agent', x.id, x.agent.name), 'bad')).join('');
        html += `<label class="rel-lines-toggle"><input type="checkbox" id="showRelLines" ${UI.showRelationLines ? 'checked' : ''}> แสดงเส้นความสัมพันธ์บนแผนที่</label>`;
        html += `</div>`;
      }
      const p = a.memory.personal;
      if (p.grudges?.length) {
        html += `<div class="insp-section"><h4>Grudges</h4>`;
        html += p.grudges.slice(-5).reverse().map(g => {
          const t = getAgent(g.targetId);
          return `<div class="timeline-entry"><span class="tl-day">Day ${g.day}</span><span class="tl-text">${t ? this.link('agent', t.id, t.name) : '?'} — ${g.reason}</span></div>`;
        }).join('');
        html += `</div>`;
      }
      if (p.majorEvents?.filter(e => e.importance >= 3).length) {
        html += `<div class="insp-section"><h4>Life Turning Points</h4>`;
        html += p.majorEvents.filter(e => e.importance >= 3).slice(-6).reverse().map(e =>
          `<div class="timeline-entry"><span class="tl-day">Day ${e.day}</span><span class="tl-text">${e.title}</span></div>`).join('');
        html += `</div>`;
      }
      if (p.avoidedRoutes?.length) {
        const routeNames = p.avoidedRoutes.map(rid => {
          const r = world.routes.find(rt => rt.id === rid);
          if (!r) return null;
          const sa = getSettlement(r.a), sb = getSettlement(r.b);
          return `${sa ? sa.name : '?'}↔${sb ? sb.name : '?'}`;
        }).filter(Boolean);
        if (routeNames.length) html += `<div class="insp-section"><h4>Feared Routes</h4><div class="ce-desc">${routeNames.join(' · ')}</div></div>`;
      }
    }
    // ── Phase 10.5: Combat stats ──
    if (typeof TextCombatCore !== 'undefined') TextCombatCore.ensureAgent(a);
    const ds = CombatSystem.deriveStats(a);
    const dc = a.derivedCombat || {};
    html += `<div class="insp-section"><h4>Combat Body (Phase 18.1)</h4>`;
    if (a.body) {
      html += this.kv('build', a.body.build) + this.kv('height', fmt(a.body.height, 2));
      html += this.kv('reachBonus', fmt(a.body.reachBonus, 2)) + this.kv('reflex', fmt(a.body.reflex, 2));
      html += this.kv('balance', fmt(a.body.balance, 2)) + this.kv('woundTol', fmt(a.body.woundTolerance, 2));
    }
    html += `</div>`;
    html += `<div class="insp-section"><h4>Derived Combat</h4>`;
    html += this.kv('meleeAtk', fmt(dc.meleeAttack, 1)) + this.kv('meleeDef', fmt(dc.meleeDefense, 1));
    html += this.kv('rangedAtk', fmt(dc.rangedAttack, 1)) + this.kv('armor', fmt(dc.armor, 1));
    html += this.kv('block', fmt((dc.block || 0) * 100, 0) + '%') + this.kv('parry', fmt((dc.parry || 0) * 100, 0) + '%');
    html += this.kv('dodge', fmt((dc.dodge || 0) * 100, 0) + '%') + this.kv('speed', fmt(dc.speed, 2));
    html += this.kv('stamina', `${fmt(a._stamina != null ? a._stamina : dc.stamina, 0)}/${fmt(dc.staminaMax, 0)}`);
    const prefWpn = a.equipment?.mainHand?.type || a.equipment?.ranged?.type || '—';
    html += this.kv('preferred weapon', prefWpn);
    html += `</div>`;
    if (a.injuries?.length) {
      html += `<div class="insp-section"><h4>Injuries</h4>`;
      for (const inj of a.injuries.slice(-6).reverse()) {
        html += this.kv(inj.type, `sev ${inj.severity} · Day ${inj.day}${inj.healed ? ' ✓' : ''}`, inj.healed ? 'good' : 'bad');
      }
      html += `</div>`;
    }
    if (a.duelRecord && (a.duelRecord.wins || a.duelRecord.losses || a.duelRecord.kills)) {
      html += `<div class="insp-section"><h4>Duel Record</h4>`;
      html += this.kv('W/L', `${a.duelRecord.wins}/${a.duelRecord.losses}`);
      html += this.kv('kills', a.duelRecord.kills);
      html += this.kv('battles survived', a.memory.survivedBattles || 0);
      html += `</div>`;
    }
    html += `<div class="insp-section"><h4>Combat Stats (legacy)</h4>`;
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
      const leg = item && (world.legendaryWeapons || []).find(lw => lw.itemId === item.id);
      const extra = item ? ` (${fmt(item.durability)}/${fmt(item.maxDurability)}${item.quality ? ' · ' + item.quality : ''}${item.kills ? ' · kills ' + item.kills : ''})` : '';
      html += this.kv(slot, item ? `${item.type}${extra}${leg ? ' ⚔ ' + leg.name : ''}` : '—');
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
    if (a.memberships?.length) {
      html += `<div class="insp-section"><h4>Memberships (Phase 18.3)</h4>`;
      for (const mem of a.memberships) {
        const org = getOrganization(mem.organizationId);
        html += this.kv(org ? this.link('organization', org.id, org.name) : '?', `${mem.role} · ${mem.status} · loyalty ${fmt(mem.loyalty)}`);
        if (mem.reasonJoined) html += `<div class="ce-desc">เหตุผล: ${mem.reasonJoined}</div>`;
      }
      html += `</div>`;
    }
    if (a.titles?.length) {
      html += `<div class="insp-section"><h4>Titles & Claims</h4>`;
      for (const t of a.titles.slice(-5).reverse()) html += this.kv(t.title || t.type, `Day ${t.day}`);
      html += `</div>`;
    }
    const claims = (world.claims || []).filter(c => c.claimantAgentId === a.id && c.status === 'active');
    if (claims.length) {
      html += `<div class="insp-section"><h4>Claims</h4>`;
      for (const c of claims) html += this.kv(getSettlement(c.settlementId)?.name || '?', `${c.type} (${fmt(c.strength)})`);
      html += `</div>`;
    }
    if (a.captureCreditIds?.length) {
      const credits = a.captureCreditIds.map(getCaptureCredit).filter(Boolean).slice(-3);
      if (credits.length) {
        html += `<div class="insp-section"><h4>Capture Credits</h4>`;
        for (const cr of credits) html += this.kv(`Day ${cr.day}`, getSettlement(cr.settlementId)?.name || '?');
        html += `</div>`;
      }
    }
    return html;
  },

  settlementHTML(s) {
    const f = getFaction(s.factionId);
    const owner = s.ownerId ? getAgent(s.ownerId) : null;
    const gov = s.governorId ? getAgent(s.governorId) : null;
    const garrison = s.garrisonUnitId ? getUnit(s.garrisonUnitId) : null;
    let html = `<div class="insp-actions">${this.followBtn('settlement', s.id)}</div>`;
    if (s.siege) html += `<div class="thought" style="border-color:#ef5350">⚠ เมืองกำลังถูกล้อม! (วันที่ ${s.siege.days})</div>`;
    html += `<div class="insp-section"><h4>การปกครอง</h4>`;
    html += this.kv('ประเภท', s.type);
    html += this.kv('ก่อตั้งเมื่อ', s.foundedDay === 0 ? 'ยุคก่อตั้งโลก' : `Day ${s.foundedDay}`);
    html += this.kv('ฝ่าย', f ? this.link('faction', f.id, `<span style="color:${f.color}">■</span> ${f.name}`) : '—');
    html += this.kv('เจ้าของ', owner && owner.alive ? this.link('agent', owner.id, owner.name) : '—');
    html += this.kv('ผู้ปกครอง', gov && gov.alive ? this.link('agent', gov.id, gov.name) : '—');
    const ownerOrg = s.ownerOrganizationId ? getOrganization(s.ownerOrganizationId) : null;
    const localLord = s.localLordId ? getAgent(s.localLordId) : null;
    if (ownerOrg) html += this.kv('Owner Organization', this.link('organization', ownerOrg.id, ownerOrg.name));
    if (localLord) html += this.kv('Local Lord', this.link('agent', localLord.id, localLord.name));
    if (s.vassalObligation) html += this.kv('Tax to overlord', fmt((s.vassalObligation.taxRateToOverlord || 0) * 100) + '%');
    if (s.legitimacy != null) html += this.kv('Legitimacy', fmt(s.legitimacy), s.legitimacy < 35 ? 'bad' : 'good');
    const claims = (world.claims || []).filter(c => c.settlementId === s.id && c.status === 'active');
    if (claims.length) html += this.kv('Claimants', claims.length, 'warn');
    if (gov && gov.gov) {
      html += this.kv('· loyalty ของ governor', fmt(gov.gov.loyalty, 2), gov.gov.loyalty < 0.4 ? 'bad' : '');
      html += this.kv('· ambition', fmt(gov.gov.ambition, 2), gov.gov.ambition > 0.7 ? 'warn' : '');
      html += this.kv('· corruption', fmt(gov.gov.corruption, 2), gov.gov.corruption > 0.35 ? 'bad' : '');
    }
    html += this.kv('อัตราภาษี', fmt(s.taxRate * 100) + '%', s.taxRate > 0.22 ? 'bad' : '');
    html += this.kv('คลังเมือง', fmt(s.treasury) + ' ทอง');
    html += `</div>`;
    if (s.marketRole) {
      const g = typeof MarketTradeSystem !== 'undefined' ? MarketTradeSystem.guildAt(s.id) : null;
      const openContracts = (world.tradeContracts || []).filter(c => c.status === 'open' && (c.originId === s.id || c.destinationId === s.id || c.issuerId === s.id));
      html += `<div class="insp-section"><h4>ตลาด / การค้า (Phase 12)</h4>`;
      html += this.kv('Market Hub', s.marketRole.isMarketHub ? `Lv ${s.marketRole.hubLevel}` : '—');
      html += this.kv('Trade Influence', fmt(s.marketRole.tradeInfluence || 0, 0));
      html += this.kv('Trade Volume', fmt(s.tradeVolume || 0, 1));
      html += this.kv('Price Volatility', fmt(s.priceVolatility || 0, 1), s.priceVolatility > 30 ? 'bad' : '');
      html += this.kv('Guild Presence', fmt(s.marketRole.guildPresence || 0, 0) + '%');
      if (g) html += this.kv('สมาคมพ่อค้า', g.name);
      const whs = typeof MarketTradeSystem !== 'undefined' ? MarketTradeSystem.settlementWarehouses(s.id) : [];
      html += this.kv('Warehouses', whs.length);
      html += this.kv('Open Contracts', openContracts.length);
      html += `</div>`;
    }
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
    html += `<div class="insp-section"><h4>Strategic (Phase 18)</h4>`;
    html += this.kv('Terrain', s.terrain || inferSettlementTerrain(s));
    html += this.kv('Strategic Value', fmt(s.strategicValue || settlementStrategicValue(s)));
    if (s.siege) {
      const ar = getArmy(s.siege.armyId);
      html += this.kv('Under Siege', `Day ${s.siege.days}`, 'bad');
      if (ar?.siegeEquipment?.ready) html += this.kv('Enemy Siege Gear', 'พร้อมใช้', 'warn');
    }
    if (s.siegeEquipment) {
      html += this.kv('Wall Bonus', s.siegeEquipment.wallBonus ? 'มีกำแพง' : '—');
      html += this.kv('Watchtower', s.siegeEquipment.watchtower ? 'มี' : '—');
    }
    html += `</div>`;
    if (s.sentiment && typeof AgentMemorySystem !== 'undefined') {
      const heroes = Object.entries(s.sentiment.heroes || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const villains = Object.entries(s.sentiment.villains || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const hated = Object.entries(s.sentiment.hatedFactions || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (heroes.length || villains.length || hated.length || s.sentiment.rememberedCrises?.length) {
        html += `<div class="insp-section"><h4>Citizen Memory (Phase 17)</h4>`;
        for (const [id, sc] of heroes) {
          const ag = getAgent(+id);
          if (ag) html += this.kv('Hero', `${this.link('agent', ag.id, ag.name)} (${fmt(sc)})`, 'good');
        }
        for (const [id, sc] of villains) {
          const ag = getAgent(+id);
          if (ag) html += this.kv('Villain', `${this.link('agent', ag.id, ag.name)} (${fmt(sc)})`, 'bad');
        }
        for (const [fid] of hated) {
          const fac = getFaction(+fid);
          if (fac) html += this.kv('Hated faction', this.link('faction', fac.id, fac.name), 'bad');
        }
        if (s.sentiment.rememberedCrises?.length) {
          html += s.sentiment.rememberedCrises.slice(-4).reverse().map(c =>
            `<div class="timeline-entry"><span class="tl-day">Day ${c.day}</span><span class="tl-text">${c.text || c.type}</span></div>`).join('');
        }
        html += `</div>`;
      }
    }
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
    const localOffers = (world.recruitmentOffers || []).filter(o => o.settlementId === s.id && o.status === 'open');
    const localOrgs = (world.organizations || []).filter(o => o.homeSettlementId === s.id && o.status === 'active');
    if (localOffers.length || localOrgs.length) {
      html += `<div class="insp-section"><h4>Organizations (Phase 18.3)</h4>`;
      for (const o of localOrgs) html += this.kv(this.link('organization', o.id, o.name), `${o.type} · ${o.memberIds.length} คน`);
      for (const ro of localOffers) {
        const org = getOrganization(ro.organizationId);
        html += this.kv('รับสมัคร', `${org?.name || '?'}: ${ro.acceptedAgentIds.length}/${ro.quantityNeeded} (${ro.type})`);
      }
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
      html += this.kv('Trade Influence', fmt(f.tradeInfluence || 0, 0), (f.tradeInfluence || 0) > 100 ? 'good' : '');
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
      const guilds = (world.guilds || []).filter(g => g.factionId === f.id);
      if (guilds.length) {
        html += `<div class="insp-section"><h4>สมาคมพ่อค้า (Phase 12)</h4>`;
        for (const g of guilds) {
          const home = getSettlement(g.homeSettlementId);
          html += this.kv(home ? this.link('settlement', home.id, g.name) : g.name, `wealth ${fmt(g.wealth)} · rel ${fmt(g.relations[f.id] || 50)}`);
        }
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
    if (typeof TextCombatCore !== 'undefined') TextCombatCore.updateUnitComposition(u);
    const roleComp = u.composition || defaultUnitComposition();
    const profComp = {};
    for (const m of members) profComp[m.profession] = (profComp[m.profession] || 0) + 1;
    let html = `<div class="insp-actions">${this.followBtn('unit', u.id)}</div>`;
    html += `<div class="insp-section"><h4>ข้อมูลหน่วย</h4>`;
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
    html += this.kv('Formation', u.formation || 'loose');
    const shockRisk = typeof TextCombatCore !== 'undefined' ? TextCombatCore.computeMoraleShock(u, []) : 0;
    html += this.kv('Morale shock risk', fmt(shockRisk, 0), shockRisk > 40 ? 'bad' : '');
    if (typeof LargeBattlefieldSystem !== 'undefined') {
      const abf = (world.activeBattlefields || []).find(bf => Object.values(bf.unitStates || {}).some(bu => bu.originalUnitId === u.id));
      const bu = abf ? Object.values(abf.unitStates).find(x => x.originalUnitId === u.id) : null;
      if (bu) {
        html += `<div class="insp-section"><h4>Battlefield (Phase 18.2)</h4>`;
        html += this.kv('sector', `(${bu.position.x}, ${bu.position.y})`);
        html += this.kv('order', bu.order || '—');
        html += this.kv('engaged', bu.engagedWith?.length || 0);
        html += this.kv('flank threat', `L${fmt(bu.flankThreat?.left || 0, 2)} R${fmt(bu.flankThreat?.right || 0, 2)}`);
        html += this.kv('battle casualties', `${bu.size - bu.aliveCount} / ${bu.size}`);
        html += `</div>`;
      }
      if (u.formationStats) {
        html += `<div class="insp-section"><h4>Formation Stats</h4>`;
        html += this.kv('battles', u.formationStats.battles || 0);
        html += this.kv('wins', u.formationStats.wins || 0);
        html += this.kv('routs', u.formationStats.routs || 0);
        html += `</div>`;
      }
    }
    html += `</div>`;
    html += `<div class="insp-section"><h4>Composition (Phase 18.1)</h4>`;
    for (const [k, n] of Object.entries(roleComp)) if (n > 0) html += this.kv(k, n);
    const vets = members.filter(m => (m.memory?.survivedBattles || 0) >= 2).length;
    if (vets) html += this.kv('veterans', vets, 'good');
    const recentBr = (world.battleReports || []).filter(br => br.attackers?.includes(u.id) || br.defenders?.includes(u.id)).slice(-1)[0];
    if (recentBr) html += this.kv('last battle', `Day ${recentBr.day}: ${(recentBr.summaryText || '').slice(0, 60)}...`);
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
    html += `<div class="insp-section"><h4>องค์ประกอบ (อาชีพ)</h4>`;
    for (const [p, n] of Object.entries(profComp)) html += this.kv(p, n);
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
    html += `</div><div class="insp-section"><h4>Campaign (Phase 18)</h4>`;
    html += this.kv('Terrain', r.terrain || inferRouteTerrain(r));
    html += this.kv('Ambush Risk', fmt((r.ambushRisk || 0) * 100, 0) + '%', (r.ambushRisk || 0) > 0.35 ? 'bad' : '');
    html += this.kv('Supply Traffic', fmt(r.supplyTraffic || 0, 1));
    html += this.kv('Scout Coverage', fmt((r.scoutCoverage || 0) * 100, 0) + '%');
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
    let html = `<div class="insp-actions">${this.followBtn('army', ar.id)}</div>`;
    html += `<div class="insp-section"><h4>กองทัพ</h4>`;
    html += this.kv('แม่ทัพ', commander ? this.link('agent', commander.id, commander.name) : '—');
    html += this.kv('ฝ่าย', f ? f.name : '—');
    html += this.kv('กำลังพลรวม', totalMen);
    html += this.kv('จำนวนหน่วย', units.length);
    html += this.kv('ภารกิจ', ar.objective.type === 'attack' ? `บุก${(getSettlement(ar.objective.targetId) || {}).name || ''}` : ar.objective.type);
    html += this.kv('พลังรบ', fmt(MilitarySystem.armyPower(ar)));
    html += this.kv('Morale', fmt(ar.morale)) + this.bar(ar.morale, '#ab47bc');
    const war = world.wars.find(w => !w.endDay && (w.attackerId === ar.factionId || w.defenderId === ar.factionId));
    if (war) html += this.kv('War Goal', war.goal || ar.warGoal || '—');
    const prof = ar.strategyProfile || defaultStrategyProfile();
    html += this.kv('Strategy', prof.preferredStrategy || '—');
    html += `</div>`;
    const sl = ar.supplyLineId && typeof CampaignWarfareSystem !== 'undefined' ? CampaignWarfareSystem.getSupplyLine(ar.supplyLineId) : null;
    if (sl) {
      html += `<div class="insp-section"><h4>Supply Line</h4>`;
      html += this.kv('Status', sl.status, sl.status === 'cut' ? 'bad' : sl.status === 'threatened' ? 'warn' : 'good');
      html += this.kv('From', this.link('settlement', sl.originSettlementId, (getSettlement(sl.originSettlementId) || {}).name || '?'));
      html += this.kv('To', this.link('settlement', sl.targetSettlementId, (getSettlement(sl.targetSettlementId) || {}).name || '?'));
      html += this.kv('Danger', fmt(sl.danger * 100, 0) + '%');
      html += this.kv('Last Delivery', `Day ${sl.lastDeliveredDay}`);
      html += `</div>`;
    }
    const camp = ar.campId && typeof CampaignWarfareSystem !== 'undefined' ? CampaignWarfareSystem.getArmyCamp(ar.campId) : null;
    if (camp) {
      html += `<div class="insp-section"><h4>Army Camp</h4>`;
      html += this.kv('Established', `Day ${camp.dayEstablished}`);
      html += this.kv('Fortification', fmt(camp.fortification));
      html += this.kv('Camp Food', fmt(camp.stock.food));
      html += `</div>`;
    }
    const se = ar.siegeEquipment;
    if (se && (se.ready || se.buildDays > 0)) {
      html += `<div class="insp-section"><h4>Siege Equipment</h4>`;
      html += this.kv('Progress', se.ready ? 'พร้อมใช้' : `กำลังสร้าง (${se.buildDays} วัน)`);
      html += this.kv('Ladders/Ram/Tower', `${se.ladders}/${se.ram}/${se.tower}`);
      html += `</div>`;
    }
    const reports = (world.scoutReports || []).filter(rep => rep.armyId === ar.id).slice(-5);
    if (reports.length) {
      html += `<div class="insp-section"><h4>Scout Reports</h4>`;
      for (const rep of reports) {
        html += this.kv(`Day ${rep.day}`, `${rep.targetType} · ${fmt((rep.confidence || 0) * 100, 0)}% · ${rep.threat}`);
      }
      html += `</div>`;
    }
    html += `<div class="insp-section"><h4>เสบียงกองทัพ</h4>`;
    for (const [k, v] of Object.entries(ar.supply)) html += this.kv(k, fmt(v), k === 'food' && v < totalMen * 3 ? 'bad' : '');
    html += `</div>`;
    html += `<div class="insp-section"><h4>หน่วยในสังกัด</h4>`;
    for (const u of units) html += this.kv(this.link('unit', u.id, u.name), unitMembers(u).length + ' นาย');
    html += `</div>`;
    if (typeof LargeBattlefieldSystem !== 'undefined') {
      const abf = (world.activeBattlefields || []).find(bf => bf.attackerArmyIds?.includes(ar.id) || bf.defenderArmyIds?.includes(ar.id));
      const lastBr = (world.battleReports || []).filter(r => r.large).slice(-1)[0];
      if (abf || lastBr) {
        html += `<div class="insp-section"><h4>Large Battle (18.2)</h4>`;
        if (abf) html += this.kv('phase', abf.phase);
        if (lastBr) html += this.kv('last report', `Day ${lastBr.day}: ${(lastBr.summaryText || '').slice(0, 70)}...`);
        const reserves = units.filter(u => u.formation === 'reserve').length;
        if (reserves) html += this.kv('reserves', reserves);
        html += `</div>`;
      }
    }
    return html;
  },

  organizationHTML(org) {
    const leader = getAgent(org.leaderId);
    const home = org.homeSettlementId ? getSettlement(org.homeSettlementId) : null;
    const members = org.memberIds.map(getAgent).filter(a => a && a.alive);
    const avgLoyalty = members.length ? sum(members, a => {
      const mem = (a.memberships || []).find(x => x.organizationId === org.id);
      return mem?.loyalty || 50;
    }) / members.length : 0;
    let html = `<div class="insp-actions">${this.followBtn('organization', org.id)}</div>`;
    html += `<div class="insp-section"><h4>Organization</h4>`;
    html += this.kv('Type', org.type);
    html += this.kv('Purpose', org.purpose);
    html += this.kv('Leader', leader ? this.link('agent', leader.id, leader.name) : '—');
    html += this.kv('Home', home ? this.link('settlement', home.id, home.name) : '—');
    html += this.kv('Members', members.length);
    html += this.kv('Reputation', fmt(org.reputation));
    html += this.kv('Wealth', fmt(org.wealth));
    html += this.kv('Food reserve', fmt(org.foodReserve));
    html += this.kv('Avg loyalty', fmt(avgLoyalty, 1), avgLoyalty < 30 ? 'bad' : 'good');
    html += this.kv('Warbands', org.activeWarbandIds.length);
    html += `</div>`;
    if (org.sovereignty) {
      const sov = org.sovereignty;
      html += `<div class="insp-section"><h4>Sovereignty</h4>`;
      html += this.kv('Status', sov.status);
      html += this.kv('Realm', sov.realmName || org.name);
      html += this.kv('Ruler title', sov.rulerTitle || '—');
      html += this.kv('Capital', sov.capitalSettlementId ? this.link('settlement', sov.capitalSettlementId, getSettlement(sov.capitalSettlementId)?.name || '?') : '—');
      html += this.kv('Settlements owned', (sov.settlementIds || []).length);
      html += this.kv('Vassals', (org.vassals || []).filter(v => v.status !== 'inactive').length);
      html += this.kv('Legitimacy', fmt(sov.legitimacy || 0), (sov.legitimacy || 0) < 35 ? 'bad' : 'good');
      html += `</div>`;
    }
    const offers = world.recruitmentOffers.filter(o => o.organizationId === org.id && o.status === 'open');
    if (offers.length) {
      html += `<div class="insp-section"><h4>Recruitment</h4>`;
      for (const o of offers) html += this.kv(o.roleNeeded, `${o.acceptedAgentIds.length}/${o.quantityNeeded} · ${o.type}`);
      html += `</div>`;
    }
    if (org.history?.length) {
      html += `<div class="insp-section"><h4>History</h4>`;
      html += org.history.slice(-6).reverse().map(h => `<div class="timeline-entry"><span class="tl-day">Day ${h.day}</span><span class="tl-text">${h.text}</span></div>`).join('');
      html += `</div>`;
    }
    return html;
  },

  warbandHTML(wb) {
    const members = warbandMembers(wb);
    const leader = getAgent(wb.leaderId);
    const org = wb.organizationId ? getOrganization(wb.organizationId) : null;
    const loc = getSettlement(wb.locationId);
    const dest = wb.destinationId ? getSettlement(wb.destinationId) : null;
    let html = `<div class="insp-actions">${this.followBtn('warband', wb.id)}</div>`;
    html += `<div class="insp-section"><h4>Warband</h4>`;
    html += this.kv('Type', wb.type);
    html += this.kv('Status', wb.status);
    html += this.kv('Real size', members.length);
    html += this.kv('Leader', leader ? this.link('agent', leader.id, leader.name) : '—');
    if (org) html += this.kv('Organization', this.link('organization', org.id, org.name));
    html += this.kv('Location', loc ? this.link('settlement', loc.id, loc.name) : 'ระหว่างทาง');
    if (dest) html += this.kv('Destination', this.link('settlement', dest.id, dest.name));
    html += this.kv('Objective', wb.objective?.type || 'idle');
    html += this.kv('Speed', fmt(WarbandSystem.computeSpeed(wb), 2));
    html += this.kv('Food', fmt(wb.food) + ` (${fmt(wb.supplyDays, 1)} days)`);
    html += this.kv('Morale', fmt(wb.morale)) + this.bar(wb.morale, '#ab47bc');
    html += this.kv('Cohesion', fmt(wb.cohesion)) + this.bar(wb.cohesion, '#66bb6a');
    html += this.kv('Fatigue', fmt(wb.fatigue)) + this.bar(wb.fatigue, '#ff7043');
    html += this.kv('Wounded', wb.woundedCount || 0);
    html += `</div>`;
    if (typeof SovereigntySystem !== 'undefined') {
      const auth = SovereigntySystem.getWarbandAuthority(wb);
      html += `<div class="insp-section"><h4>Political Authority</h4>`;
      html += this.kv('Mode', auth.mode);
      html += this.kv('Can raid', auth.canRaid ? 'yes' : 'no');
      html += this.kv('Can siege', auth.canSiege ? 'yes' : 'no', auth.canSiege ? 'warn' : '');
      html += this.kv('Can capture', auth.canCapture ? 'yes' : 'no', auth.canCapture ? 'warn' : '');
      html += this.kv('Capture owner', auth.captureOwnerOrgId ? this.link('organization', auth.captureOwnerOrgId, getOrganization(auth.captureOwnerOrgId)?.name || '?') : '—');
      if (auth.employerOrgId) html += this.kv('Employer', this.link('organization', auth.employerOrgId, getOrganization(auth.employerOrgId)?.name || '?'));
      html += `</div>`;
    }
    if (wb.routePath?.length > 1) {
      html += `<div class="insp-section"><h4>Route</h4><div class="ce-desc">`;
      html += wb.routePath.map(id => (getSettlement(id) || {}).name || '?').join(' → ');
      html += `</div></div>`;
    }
    const top = members.sort((a, b) => (b.skills.leadership + b.fame) - (a.skills.leadership + a.fame)).slice(0, 5);
    if (top.length) {
      html += `<div class="insp-section"><h4>Top Members</h4>`;
      for (const m of top) html += this.kv(this.link('agent', m.id, m.name), m.profession);
      html += `</div>`;
    }
    if (wb.history?.length) {
      html += `<div class="insp-section"><h4>Recent</h4>`;
      html += wb.history.slice(-5).reverse().map(h => `<div class="timeline-entry"><span class="tl-day">Day ${h.day}</span><span class="tl-text">${h.text}</span></div>`).join('');
      html += `</div>`;
    }
    return html;
  }
};
const SandboxTools = {
  needsTarget: new Set(['buildRoad', 'destroyRoad', 'addVillage', 'addTown', 'addFort', 'giveWealth', 'foodShortage', 'drought', 'plague', 'createMarketHub', 'spawnMerchantGuild', 'addTradeContract', 'raiseTradeTax', 'lowerTradeTax', 'cutSupplyLine', 'fortifyCamp', 'forceAmbush', 'setWarGoal', 'setFormation', 'authorizeWarbandSiege', 'grantCityToAgent', 'revokeCityGrant', 'testCaptureWithoutAuthority', 'testGuildCapture', 'forceVassalTribute']),

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
      },
      fundGuildPatrol: () => {
        const g = (world.guilds || [])[0];
        if (g) { g.wealth += 200; MarketTradeSystem.guildPolitics(g); EventSystem.add('system', `🛡 [Sandbox] อุดหนุน${g.name} ปราบโจร`); }
        else EventSystem.add('system', '✨ [Sandbox] ยังไม่มี guild');
      },
      createTradeBoom: () => {
        for (const s of marketSettlements()) { s.tradeVolume = (s.tradeVolume || 0) + 20; s.prosperity = clamp(s.prosperity + 15, 0, 100); }
        if (world.marketIndex) { world.marketIndex.tradeHealth = clamp(world.marketIndex.tradeHealth + 20, 0, 100); world.marketIndex.foodIndex = Math.max(0.8, world.marketIndex.foodIndex - 0.2); }
        EventSystem.add('trade', '📈 [Sandbox] Trade Boom — ตลาดคึกคักทั่วแผ่นดิน');
        Chronicle.add({ category: 'market', importance: 4, title: '📈 ยุคบูมการค้า', description: 'พลังลึกลับทำให้เส้นทางค้าคึกคักและราคาอาหารลดลงชั่วคราว' });
      },
      createMarketCrash: () => {
        for (const s of marketSettlements()) { s.prices.food *= 1.6; s.priceVolatility = clamp((s.priceVolatility || 0) + 25, 0, 100); }
        if (world.marketIndex) { world.marketIndex.foodIndex = (world.marketIndex.foodIndex || 1) * 1.5; world.marketIndex.volatility += 15; }
        EventSystem.add('trade', '📉 [Sandbox] Market Crash — ราคาพุ่งความผันผวนสูง');
        Chronicle.add({ category: 'market', importance: 4, title: '📉 ตลาดถล่ม', description: 'ราคาอาหารและสินค้าพุ่งสูงอย่างกะทันหัน ความไม่แน่นอนครอบงำ' });
      },
      supplyCrisis: () => {
        const ar = world.armies[0];
        if (ar && typeof CampaignWarfareSystem !== 'undefined') {
          CampaignWarfareSystem.forceSupplyCrisis(ar);
          EventSystem.add('war', `📦 [Sandbox] วิกฤตเสบียงที่${ar.name}`);
        } else EventSystem.add('system', '✨ [Sandbox] ยังไม่มีกองทัพ');
      },
      spawnScout: () => {
        const ar = world.armies[0];
        if (ar && typeof CampaignWarfareSystem !== 'undefined') {
          CampaignWarfareSystem.spawnScoutUnit(ar);
          EventSystem.add('war', `🔭 [Sandbox] ส่งหน่วยลาดตระเวนจาก${ar.name}`);
        }
      },
      revealScouts: () => {
        if (typeof CampaignWarfareSystem !== 'undefined') {
          for (const ar of world.armies) CampaignWarfareSystem.spawnScoutUnit(ar);
          EventSystem.add('system', '🔭 [Sandbox] เปิดเผยรายงานลาดตระเวนทั้งหมด');
        }
      },
      giveSiegeGear: () => {
        const ar = world.armies.find(a => a.objective?.type === 'attack') || world.armies[0];
        if (ar && typeof CampaignWarfareSystem !== 'undefined') {
          CampaignWarfareSystem.giveSiegeEquipment(ar);
          EventSystem.add('war', `🏗 [Sandbox] มอบเครื่องมือล้อมเมืองให้${ar.name}`);
        }
      },
      forceLargeBattle: () => {
        if (typeof LargeBattlefieldSystem !== 'undefined') LargeBattlefieldSystem.forceLargeBattle(150, 120);
        else EventSystem.add('system', '✨ Large battle system unavailable');
      },
      createTestArmy: () => {
        const ks = world.factions.filter(f => !f.isBandit);
        const s = pick(world.settlements.filter(x => x.type !== 'camp'));
        if (ks.length && typeof LargeBattlefieldSystem !== 'undefined') {
          LargeBattlefieldSystem.createTestArmy(s.id, ks[0].id, 80, 'atk');
          EventSystem.add('war', `⚔ [Sandbox] สร้างกองทดสอบ 80 คนที่${s.name}`);
        }
      },
      spawnReinforcements: () => {
        const u = world.units.find(x => unitMembers(x).length > 0);
        if (!u) return;
        const s = getSettlement(u.locationId);
        for (let i = 0; i < 15; i++) {
          const ag = createAgent({ locationId: s.id, factionId: u.factionId, profession: 'guard' });
          seedSkillForProfession(ag, ag.profession);
          u.memberIds.push(ag.id);
          ag.unitId = u.id;
        }
        if (typeof TextCombatCore !== 'undefined') TextCombatCore.updateUnitComposition(u);
        EventSystem.add('war', `➕ [Sandbox] เสริมกำลัง 15 คนให้${u.name}`);
      },
      triggerCavalryCharge: () => {
        const u = world.units.find(x => unitMembers(x).some(m => m.profession === 'cavalry' || m.equipment?.mount));
        if (u) { u.formation = 'charge'; EventSystem.add('war', `🐎 [Sandbox] ${u.name} สั่งชาร์จทหารม้า`); }
      },
      triggerRout: () => {
        const u = world.units.find(x => unitMembers(x).length > 5);
        if (u) { u.formation = 'rout'; u.morale = 15; EventSystem.add('war', `💥 [Sandbox] ${u.name} จำลองการแตกพ่าย`); }
      },
      spawnDefensiveHillBattle: () => {
        const s = world.settlements.find(x => x.terrain === 'hill') || pick(world.settlements);
        s.terrain = 'hill';
        if (typeof LargeBattlefieldSystem !== 'undefined') {
          const ks = world.factions.filter(f => !f.isBandit);
          const atk = LargeBattlefieldSystem.createTestArmy(s.id, ks[0]?.id, 100, 'atk');
          const def = LargeBattlefieldSystem.createTestArmy(s.id, ks[1]?.id || ks[0]?.id, 90, 'def');
          def.formation = 'spear_line';
          LargeBattlefieldSystem.runLargeBattle([atk], [def], { settlementId: s.id, label: s.name, terrainType: 'hill' });
          EventSystem.add('war', `⛰ [Sandbox] ศึกป้องกันเนินที่${s.name}`);
        }
      },
      startSiegeAssault: () => {
        const s = world.settlements.find(x => x.type === 'castle' || x.type === 'fort');
        if (!s || typeof LargeBattlefieldSystem === 'undefined') return;
        const ks = world.factions.filter(f => !f.isBandit);
        const atk = LargeBattlefieldSystem.createTestArmy(s.id, ks[0]?.id, 120, 'atk');
        const def = LargeBattlefieldSystem.createTestArmy(s.id, s.factionId, 80, 'def');
        def.formation = 'defensive';
        LargeBattlefieldSystem.runLargeBattle([atk], [def], { settlementId: s.id, label: s.name, terrainType: 'plain', isSiege: true, siegeEquipment: { ladders: 2, ram: 1, tower: 0, ready: true } });
        EventSystem.add('war', `🏰 [Sandbox] เริ่มการโจมตีป้อม${s.name}`);
      },
      createRecruitmentOffer: () => {
        const s = pick(marketSettlements());
        const leader = agentsAt(s.id).find(a => a.alive && a.skills.leadership > 3) || agentsAt(s.id)[0];
        if (!leader) { EventSystem.add('system', '✨ [Sandbox] ไม่มี agent สำหรับสร้าง offer'); return; }
        let org = world.organizations.find(o => o.homeSettlementId === s.id && o.status === 'active');
        if (!org) org = createOrganization({ name: `กลุ่ม${s.name}`, type: 'militia_company', leaderId: leader.id, founderId: leader.id, homeSettlementId: s.id, memberIds: [] });
        const offer = OrganizationSystem.postRecruitmentOffer(org, { settlementId: s.id, type: 'militia_call', quantityNeeded: 5 });
        EventSystem.add('system', offer ? `📢 [Sandbox] สร้างประกาศรับสมัครที่${s.name} (ไม่ spawn คน)` : '✨ สร้าง offer ไม่สำเร็จ');
      },
      encourageMilitia: () => {
        const s = pick(marketSettlements());
        const org = createOrganization({ name: `อาสาสมัคร${s.name}`, type: 'militia_company', homeSettlementId: s.id, leaderId: (s.governorId || s.ownerId), memberIds: [] });
        OrganizationSystem.postRecruitmentOffer(org, { settlementId: s.id, type: 'militia_call', quantityNeeded: 6, riskLevel: 0.3 });
        EventSystem.add('system', `🛡 [Sandbox] ส่งเสริมอาสาสมัครที่${s.name}`);
      },
      fundMercenaryCompany: () => {
        const s = pick(marketSettlements());
        const org = world.organizations.find(o => o.type === 'mercenary_company') || createOrganization({ name: `ทหารรับจ้าง${s.name}`, type: 'mercenary_company', homeSettlementId: s.id, wealth: 100, memberIds: [] });
        org.wealth += 150;
        OrganizationSystem.postRecruitmentOffer(org, { settlementId: s.id, type: 'mercenary_hire', quantityNeeded: 5, rewards: { pay: 25, food: 8 } });
        EventSystem.add('system', `💰 [Sandbox] อุดหนุน${org.name}`);
      },
      spawnWarbandFromAgents: () => {
        const s = pick(marketSettlements());
        const pool = agentsAt(s.id).filter(a => a.alive && !a.unitId && !agentMilitaryMembership(a) && MILITARY_PROFS.has(a.profession));
        if (pool.length < 3) { EventSystem.add('system', '✨ [Sandbox] agent ไม่พอ (ต้อง ≥3 ทหารว่าง)'); return; }
        const ids = pool.slice(0, Math.min(8, pool.length)).map(a => a.id);
        const org = createOrganization({ name: `กองทดสอบ${s.name}`, type: 'adventurer_party', leaderId: ids[0], homeSettlementId: s.id, memberIds: [] });
        const wb = WarbandSystem.createFromMembers(org, ids, { locationId: s.id, status: 'marching' });
        EventSystem.add('system', `⚔ [Sandbox] สร้าง warband ${wb.name} จาก agent จริง ${ids.length} คน`);
      },
      forceWarbandMarch: () => {
        const wb = world.warbands.find(w => warbandMembers(w).length > 0);
        if (!wb) { EventSystem.add('system', '✨ ไม่มี warband'); return; }
        const dest = pick(world.settlements.filter(s => s.id !== wb.locationId));
        WarbandSystem.startMarch(wb, dest.id, 'march');
        EventSystem.add('system', `🚶 [Sandbox] ${wb.name} เดินไป${dest.name}`);
      },
      forcePursuit: () => {
        const pursuer = world.warbands.find(w => warbandMembers(w).length > 2);
        const target = world.warbands.find(w => w.id !== pursuer?.id && warbandMembers(w).length > 0);
        if (!pursuer || !target) { EventSystem.add('system', '✨ ต้องมี warband อย่างน้อย 2 กลุ่ม'); return; }
        pursuer.status = 'pursuing'; pursuer.pursueTargetId = target.id;
        WarbandSystem.startMarch(pursuer, target.locationId, 'pursue');
        EventSystem.add('system', `🏃 [Sandbox] ${pursuer.name} ไล่ล่า ${target.name}`);
      },
      splitWarband: () => {
        const wb = world.warbands.find(w => warbandMembers(w).length > 4);
        if (!wb) { EventSystem.add('system', '✨ warband ต้องมี >4 คน'); return; }
        const ids = wb.memberIds.slice(0, Math.floor(wb.memberIds.length / 2));
        const child = WarbandSystem.splitWarband(wb, ids, { name: `${wb.name} (แยก)` });
        EventSystem.add('system', child ? `✂️ [Sandbox] แยก ${child.name} (${ids.length} คน)` : '✨ แยกไม่สำเร็จ');
      },
      mergeNearbyWarbands: () => {
        const wb = world.warbands.find(w => warbandMembers(w).length > 0);
        const other = world.warbands.find(w => w.id !== wb?.id && w.locationId === wb?.locationId && warbandMembers(w).length > 0);
        if (!wb || !other) { EventSystem.add('system', '✨ ต้องมี 2 warband ที่ตำแหน่งเดียวกัน'); return; }
        WarbandSystem.mergeWarbands(wb, other);
        EventSystem.add('system', `🔗 [Sandbox] รวม ${other.name} เข้า ${wb.name}`);
      },
      starveWarband: () => {
        const wb = world.warbands.find(w => warbandMembers(w).length > 0);
        if (!wb) return;
        wb.food = 0; wb.supplyDays = 0;
        EventSystem.add('system', `🍞 [Sandbox] ${wb.name} หมดเสบียง`);
      },
      triggerMutinyCheck: () => {
        const org = world.organizations.find(o => o.memberIds.length > 3);
        if (!org) return;
        const rebel = org.memberIds.map(getAgent).find(a => a && a.alive && a.id !== org.leaderId);
        if (rebel) OrganizationSystem.mutinyCheck(org, rebel, (rebel.memberships || []).find(m => m.organizationId === org.id));
        EventSystem.add('system', `💥 [Sandbox] ตรวจ mutiny ใน ${org.name}`);
      },
      createBanditWarbandFromDeserters: () => {
        const deserters = world.agents.filter(a => a.alive && !a.unitId && (a.profession === 'bandit' || a.wantedLevel > 1)).slice(0, 6);
        if (deserters.length < 2) { EventSystem.add('system', '✨ ไม่มี deserter/bandit พอ'); return; }
        const camp = world.settlements.find(s => s.type === 'camp') || pick(world.settlements);
        for (const a of deserters) a.locationId = camp.id;
        const org = createOrganization({ name: 'โจรหนีทหาร', type: 'bandit_gang', leaderId: deserters[0].id, homeSettlementId: camp.id, factionId: world.factions.find(f => f.isBandit)?.id, memberIds: [] });
        WarbandSystem.createFromMembers(org, deserters.map(a => a.id), { type: 'bandit_gang', locationId: camp.id, status: 'raiding', objective: { type: 'patrol_route' } });
        EventSystem.add('system', `☠ [Sandbox] กลุ่มโจร ${deserters.length} คนจาก agent จริง`);
      },
      openRandomFamousCharacter: () => {
        UIIndexes.rebuild(true);
        const a = (uiIndexes?.agentsByFame || []).find(x => x.fame >= 3) || pick(world.agents.filter(x => x.alive));
        if (!a) return;
        openEntityDetail('agent', a.id);
        EventSystem.add('system', `👤 [Sandbox] เปิดตัวละคร ${a.name}`);
      },
      openRandomWarband: () => {
        const wb = pick((world.warbands || []).filter(w => warbandMembers(w).length > 0));
        if (!wb) { EventSystem.add('system', '✨ ไม่มี warband'); return; }
        openEntityDetail('warband', wb.id);
        EventSystem.add('system', `⚔ [Sandbox] เปิด ${wb.name}`);
      },
      openLatestBattleReport: () => {
        const br = (world.battleReports || []).slice(-1)[0];
        if (!br) { EventSystem.add('system', '✨ ยังไม่มี battle report'); return; }
        openEntityDetail('battle', br.id);
        EventSystem.add('system', `📜 [Sandbox] เปิดศึกล่าสุด`);
      },
      openLargestOrganization: () => {
        const org = (world.organizations || []).slice().sort((a, b) => (b.memberIds?.length || 0) - (a.memberIds?.length || 0))[0];
        if (!org) { EventSystem.add('system', '✨ ไม่มี organization'); return; }
        openEntityDetail('organization', org.id);
        EventSystem.add('system', `👥 [Sandbox] เปิด ${org.name}`);
      },
      generateTestBattleReport: () => {
        const u1 = world.units.find(u => unitMembers(u).length >= 2);
        const u2 = world.units.find(u => u.id !== u1?.id && unitMembers(u).length >= 2);
        if (!u1 || !u2) { EventSystem.add('system', '✨ ต้องมี unit 2 กลุ่ม'); return; }
        const s = world.settlements[0];
        MilitarySystem.battle([u1], [u2], { settlementId: s.id, label: s.name, terrain: 'plain', title: 'Sandbox Test Battle' });
        const br = world.battleReports.slice(-1)[0];
        if (br) openEntityDetail('battle', br.id);
        EventSystem.add('system', '🧪 [Sandbox] สร้าง test battle report');
      },
      rebuildUIIndexes: () => {
        UIIndexes.rebuild(true);
        UI.pageDirty = true;
        EventSystem.add('system', '🔄 [Sandbox] Rebuilt UI indexes');
      },
      foundGuildFromWarband: () => {
        const wb = world.warbands.find(w => warbandMembers(w).length >= 8);
        if (!wb) { EventSystem.add('system', '✨ ต้องมี warband >= 8 คน'); return; }
        const org = SovereigntySystem.foundGuildFromWarband(wb);
        EventSystem.add('system', org ? `🏛 [Sandbox] ${org.name}` : '✨ ก่อตั้ง guild ไม่สำเร็จ');
      },
      triggerVassalRebellionCheck: () => {
        const org = world.organizations.find(o => o.vassals?.length);
        if (!org) { EventSystem.add('system', '✨ ไม่มี vassal'); return; }
        const v = org.vassals[0];
        v.loyaltyToOverlord = 15;
        SovereigntySystem.triggerVassalRebellion(org, v);
      },
      convertBanditToOutlawRealm: () => {
        const org = world.organizations.find(o => o.type === 'bandit_gang');
        if (!org) { EventSystem.add('system', '✨ ไม่มี bandit org'); return; }
        SovereigntySystem.convertBanditToOutlawRealm(org);
        EventSystem.add('system', `☠ [Sandbox] ${org.name} outlaw realm`);
      },
      showPoliticalAuthority: () => {
        const wb = world.warbands.find(w => warbandMembers(w).length > 0);
        if (!wb) return;
        const auth = SovereigntySystem.getWarbandAuthority(wb);
        EventSystem.add('system', `👁 ${wb.name}: ${auth.mode} raid=${auth.canRaid} siege=${auth.canSiege} capture=${auth.canCapture}`);
        UI.selected = { kind: 'warband', id: wb.id };
        UI.inspectorDirty = true;
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
      case 'createMarketHub':
        if (pickedSettlement && pickedSettlement.type !== 'camp') {
          MarketTradeSystem.ensureSettlementMarket(pickedSettlement);
          pickedSettlement.marketRole.isMarketHub = true;
          pickedSettlement.marketRole.hubLevel = Math.max(2, pickedSettlement.marketRole.hubLevel || 0);
          if (!pickedSettlement.buildings.includes('Market')) pickedSettlement.buildings.push('Market');
          createWarehouse({ settlementId: pickedSettlement.id, ownerType: 'settlement', ownerId: pickedSettlement.id, capacity: 150 });
          EventSystem.add('trade', `🏦 [Sandbox] ${pickedSettlement.name} กลายเป็นตลาดกลาง`);
          this.disarm();
        }
        break;
      case 'spawnMerchantGuild':
        if (pickedSettlement && pickedSettlement.type !== 'camp') {
          for (let i = 0; i < 4; i++) {
            const t = createAgent({ locationId: pickedSettlement.id, factionId: pickedSettlement.factionId, profession: 'trader', money: 180 });
            t.skills.trading = 4; t.memory.tradeProfit = 200;
          }
          pickedSettlement.marketRole.isMarketHub = true;
          pickedSettlement.marketRole.hubLevel = Math.max(1, pickedSettlement.marketRole.hubLevel || 0);
          pickedSettlement.tradeVolume = 40;
          MarketTradeSystem.trySpawnGuild(pickedSettlement);
          if (!MarketTradeSystem.guildAt(pickedSettlement.id)) {
            const leader = agentsAt(pickedSettlement.id).find(a => a.profession === 'trader');
            if (leader) createGuild({ homeSettlementId: pickedSettlement.id, factionId: pickedSettlement.factionId, wealth: 300, members: [leader.id] });
          }
          EventSystem.add('trade', `🏛 [Sandbox] สมาคมพ่อค้าปรากฏที่${pickedSettlement.name}`);
          this.disarm();
        }
        break;
      case 'addTradeContract':
        if (pickedSettlement) {
          const dest = pick(marketSettlements().filter(x => x.id !== pickedSettlement.id));
          if (dest) {
            createTradeContract({
              issuerType: 'settlement', issuerId: pickedSettlement.id, originId: pickedSettlement.id,
              destinationId: dest.id, good: 'food', quantity: 12, reward: 45,
              riskLevel: MarketTradeSystem.contractRisk(pickedSettlement.id, dest.id)
            });
            EventSystem.add('trade', `📜 [Sandbox] สร้างสัญญาขนส่งอาหาร ${pickedSettlement.name}→${dest.name}`);
          }
          this.disarm();
        }
        break;
      case 'raiseTradeTax':
        if (pickedSettlement) {
          pickedSettlement.taxRate = Math.min(0.35, pickedSettlement.taxRate + 0.08);
          EventSystem.add('politics', `📜 [Sandbox] ขึ้นภาษีการค้า${pickedSettlement.name} เป็น ${fmt(pickedSettlement.taxRate * 100)}%`);
          this.disarm();
        }
        break;
      case 'lowerTradeTax':
        if (pickedSettlement) {
          pickedSettlement.taxRate = Math.max(0.04, pickedSettlement.taxRate - 0.08);
          EventSystem.add('politics', `📜 [Sandbox] ลดภาษีการค้า${pickedSettlement.name} เป็น ${fmt(pickedSettlement.taxRate * 100)}%`);
          this.disarm();
        }
        break;
      case 'cutSupplyLine': {
        const ar = picked?.kind === 'army' ? getArmy(picked.id) : world.armies.find(a => a.locationId === pickedSettlement?.id);
        if (ar && typeof CampaignWarfareSystem !== 'undefined') {
          const sl = ar.supplyLineId ? CampaignWarfareSystem.getSupplyLine(ar.supplyLineId) : null;
          if (sl) CampaignWarfareSystem.cutSupplyLine(sl, '[Sandbox] ตัดเส้นทางเสบียง');
          else EventSystem.add('system', '✨ [Sandbox] กองทัพนี้ยังไม่มี supply line');
          this.disarm();
        }
        break;
      }
      case 'fortifyCamp': {
        const ar = picked?.kind === 'army' ? getArmy(picked.id) : null;
        if (ar && typeof CampaignWarfareSystem !== 'undefined') {
          const camp = ar.campId ? CampaignWarfareSystem.getArmyCamp(ar.campId) : CampaignWarfareSystem.establishCamp(ar);
          if (camp) { camp.fortification = Math.min(5, camp.fortification + 2); camp.security += 15; }
          EventSystem.add('war', `🏕 [Sandbox] เสริมค่ายทัพ${ar.name}`);
          this.disarm();
        }
        break;
      }
      case 'forceAmbush':
        if (picked?.kind === 'route' && typeof CampaignWarfareSystem !== 'undefined') {
          const r = world.routes.find(x => x.id === picked.id);
          if (r) { r.ambushRisk = Math.min(0.9, (r.ambushRisk || 0.2) + 0.3); CampaignWarfareSystem.forceAmbush(r.id); }
          this.disarm();
        }
        break;
      case 'setWarGoal': {
        const ks = world.factions.filter(f => !f.isBandit && world.settlements.some(s => s.factionId === f.id));
        if (ks.length >= 2 && typeof CampaignWarfareSystem !== 'undefined') {
          CampaignWarfareSystem.setWarGoal(ks[0], ks[1], pick(WAR_GOAL_TYPES));
          EventSystem.add('war', `🎯 [Sandbox] ตั้ง war goal สำหรับ${ks[0].name}`);
        }
        this.disarm();
        break;
      }
      case 'setFormation': {
        const u = picked?.kind === 'unit' ? getUnit(picked.id) : null;
        if (u) {
          u.formation = pick(LARGE_FORMATIONS);
          EventSystem.add('war', `📐 [Sandbox] ${u.name} ตั้ง formation เป็น ${u.formation}`);
        }
        this.disarm();
        break;
      }
      case 'authorizeWarbandSiege': {
        const wb = world.warbands.find(w => warbandMembers(w).length > 0);
        const org = wb?.organizationId ? getOrganization(wb.organizationId) : world.organizations[0];
        if (wb && org && pickedSettlement && pickedSettlement.type !== 'camp') {
          SovereigntySystem.authorizeWarbandSiege(org, wb, pickedSettlement.id);
          EventSystem.add('system', `⚔ [Sandbox] อนุมัติ ${wb.name} ล้อม ${pickedSettlement.name}`);
        } else EventSystem.add('system', '✨ ต้องมี warband+org และคลิก settlement');
        this.disarm();
        break;
      }
      case 'grantCityToAgent': {
        if (!pickedSettlement || pickedSettlement.type === 'camp') { this.disarm(); break; }
        const org = getOrganization(pickedSettlement.ownerOrganizationId);
        const agent = world.agents.find(a => a.alive && a.skills.leadership >= 2 && a.id !== org?.leaderId);
        if (org && agent) {
          SovereigntySystem.grantSettlement(org.leaderId, pickedSettlement.id, agent.id, 'sandbox_grant');
          EventSystem.add('system', `🏛 [Sandbox] มอบ ${pickedSettlement.name} ให้ ${agent.name}`);
        } else EventSystem.add('system', '✨ ต้องมี owner org และ agent จริง');
        this.disarm();
        break;
      }
      case 'testCaptureWithoutAuthority': {
        if (!pickedSettlement || pickedSettlement.type === 'camp') { this.disarm(); break; }
        const a = world.agents.find(x => x.alive && x.skills.leadership >= 2);
        if (!a) { EventSystem.add('system', '✨ ไม่มี agent'); this.disarm(); break; }
        const before = pickedSettlement.ownerOrganizationId;
        const wb = SovereigntySystem.foundWarbandFromAgent(a, 'bandit_gang', { name: 'Raid Test' });
        if (wb) {
          a.locationId = pickedSettlement.id;
          wb.locationId = pickedSettlement.id;
          WarbandSystem.tryRaid(wb, pickedSettlement);
          const after = pickedSettlement.ownerOrganizationId;
          EventSystem.add('system', after === before ? '✅ ไม่เปลี่ยน owner (ถูกต้อง)' : '⚠ owner เปลี่ยน (ผิด)');
        }
        this.disarm();
        break;
      }
      case 'testGuildCapture': {
        if (!pickedSettlement || pickedSettlement.type === 'camp') { this.disarm(); break; }
        const leader = world.agents.find(a => a.alive && a.skills.leadership >= 3);
        if (!leader) { this.disarm(); break; }
        const org = createOrganization({ name: 'Siege Guild', type: 'mercenary_company', leaderId: leader.id, homeSettlementId: pickedSettlement.id, memberIds: [leader.id], purpose: 'conquest' });
        const ids = [leader.id];
        for (let i = 0; i < 5; i++) {
          const m = createAgent({ locationId: pickedSettlement.id, profession: 'guard', factionId: pickedSettlement.factionId });
          ids.push(m.id);
        }
        const wb = WarbandSystem.createFromMembers(org, ids, { locationId: pickedSettlement.id, leaderId: leader.id });
        SovereigntySystem.authorizeWarbandSiege(org, wb, pickedSettlement.id);
        org.purpose = 'conquest';
        leader.locationId = pickedSettlement.id;
        wb.locationId = pickedSettlement.id;
        WarbandSystem.tryRaid(wb, pickedSettlement);
        EventSystem.add('system', `🏰 [Sandbox] guild capture test → owner=${getOrganization(pickedSettlement.ownerOrganizationId)?.name || '?'}`);
        this.disarm();
        break;
      }
      case 'forceVassalTribute': {
        if (pickedSettlement) SovereigntySystem.tickVassalObligations();
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

const SAVE_SCHEMA_VERSION = '18.5';
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
    document.getElementById('observerPanel')?.classList.add('hidden');
    if (typeof ObserverSystem !== 'undefined') ObserverSystem.observerOpen = false;
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
        paused: UI.paused,
        currentView: UI.currentView,
        pages: typeof PageViewSystem !== 'undefined' ? PageViewSystem.getPrefs() : null,
        observer: typeof ObserverSystem !== 'undefined' ? ObserverSystem.getPrefs() : null
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
    if (migrated.uiPrefs?.pages && typeof PageViewSystem !== 'undefined') PageViewSystem.applyPrefs(migrated.uiPrefs.pages);
    if (migrated.uiPrefs?.currentView) UI.setView(migrated.uiPrefs.currentView);
    if (migrated.uiPrefs?.observer && typeof ObserverSystem !== 'undefined') {
      ObserverSystem.applyPrefs(migrated.uiPrefs.observer);
    }
    this.lastSaveDay = world.day;
    this.lastSaveKind = 'loaded';
    UI.selected = null;
    UI.logDirty = true;
    UI.inspectorDirty = true;
    UI.chronicleDirty = true;
    UI.dashboardDirty = true;
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
    w.guilds = w.guilds || [];
    w.warehouses = w.warehouses || [];
    w.tradeContracts = w.tradeContracts || [];
    w.supplyLines = w.supplyLines || [];
    w.armyCamps = w.armyCamps || [];
    w.scoutReports = w.scoutReports || [];
    w.battleReports = w.battleReports || [];
    w.legendaryWeapons = w.legendaryWeapons || [];
    w.largeBattleRecords = w.largeBattleRecords || [];
    w.activeBattlefields = w.activeBattlefields || [];
    w.organizations = w.organizations || [];
    w.recruitmentOffers = w.recruitmentOffers || [];
    w.musterPoints = w.musterPoints || [];
    w.warbands = w.warbands || [];
    w.headquarters = w.headquarters || [];
    w.siegeAuthorities = w.siegeAuthorities || [];
    w.claims = w.claims || [];
    w.captureCredits = w.captureCredits || [];
    w.vassalGrants = w.vassalGrants || [];
    w.marketIndex = Object.assign(defaultMarketIndex(), w.marketIndex || {});
    w.stats = Object.assign({
      deaths: 0, battles: 0, raids: 0, caravansRobbed: 0, squadsFormed: 0, gearBought: 0,
      bountiesPosted: 0, traderSpawns: 0, townCaravans: 0, townCaravansLost: 0,
      townCaravansReplaced: 0, localRations: 0, emergencyCaravans: 0, emergencyFallbacks: 0,
      contractsCompleted: 0, contractsFailed: 0, warehouseRaids: 0
    }, w.stats || {});
    if (!w.worldName) w.worldName = data.worldName || 'Living Kingdom';
    if (w.seed == null) w.seed = data.seed || 0;
    if (!w._createdAt) w._createdAt = data.createdAt || new Date().toISOString();
    const prevWorld = world;
    world = w;
    try {
      for (const s of w.settlements) this.migrateSettlement(s);
      for (const r of w.routes) this.migrateRoute(r);
      for (const a of w.agents) this.migrateAgent(a, w.day);
      for (const u of w.units) this.migrateUnit(u);
      for (const ar of w.armies) this.migrateArmy(ar);
      for (const f of w.factions) this.migrateFaction(f);
      for (const wwar of w.wars) this.migrateWar(wwar);
      for (const wh of w.warehouses) this.migrateWarehouse(wh);
      for (const g of w.guilds) this.migrateGuild(g);
      for (const c of w.tradeContracts) this.migrateContract(c, w.day);
      for (const org of w.organizations) this.migrateOrganization(org);
      for (const wb of w.warbands) this.migrateWarband(wb);
      for (const ro of w.recruitmentOffers) this.migrateRecruitmentOffer(ro);
      for (const mp of w.musterPoints) this.migrateMusterPoint(mp);
      for (const hq of w.headquarters) this.migrateHeadquarters(hq);
      data.schemaVersion = SAVE_SCHEMA_VERSION;
      data.world = w;
      return data;
    } catch (e) {
      world = prevWorld;
      throw e;
    }
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
    if (!s.marketRole) s.marketRole = defaultMarketRole();
    else s.marketRole = Object.assign(defaultMarketRole(), s.marketRole);
    if (s.tradeVolume == null) s.tradeVolume = 0;
    if (s.priceVolatility == null) s.priceVolatility = 0;
    if (!s.sentiment) s.sentiment = defaultSettlementSentiment();
    else s.sentiment = Object.assign(defaultSettlementSentiment(), s.sentiment);
    if (!s.terrain) s.terrain = inferSettlementTerrain(s);
    if (s.strategicValue == null) s.strategicValue = settlementStrategicValue(s);
    if (!s.siegeEquipment) s.siegeEquipment = { wallBonus: s.buildings?.includes('Wall') ? 1 : 0, watchtower: s.buildings?.includes('Watchtower') ? 1 : 0 };
    if (!s.vassalObligation) s.vassalObligation = defaultVassalObligation();
    if (!s.localLordId && s.governorId) s.localLordId = s.governorId;
    if (s.legitimacy == null) s.legitimacy = 50;
    if (typeof SovereigntySystem !== 'undefined') SovereigntySystem.migrateSettlementOwnership(s);
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
    if (!r.terrain) r.terrain = inferRouteTerrain(r);
    if (r.ambushRisk == null) r.ambushRisk = clamp((r.threat || r.danger || 0.1) * 0.9, 0.02, 0.85);
    if (r.supplyTraffic == null) r.supplyTraffic = 0;
    if (r.scoutCoverage == null) r.scoutCoverage = 0;
  },

  migrateWar(w) {
    if (!w.goal) w.goal = 'capture_settlement';
    if (w.supplyDisruptions == null) w.supplyDisruptions = 0;
    if (w.sieges == null) w.sieges = 0;
    if (w.ambushes == null) w.ambushes = 0;
    if (w.goalAchieved == null) w.goalAchieved = false;
  },

  migrateAgent(a, day) {
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
    const bp = a.birthplaceId || a.locationId;
    if (!a.memory.personal) a.memory.personal = defaultPersonalMemory(bp, day);
    else a.memory.personal = Object.assign(defaultPersonalMemory(bp, day), a.memory.personal);
    if (!a.relationships) a.relationships = {};
    if (!a.motives) a.motives = defaultMotives();
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
    if (a.guildId == null) a.guildId = null;
    if (!a.merchantRank) a.merchantRank = a.profession === 'trader' ? 'peddler' : 'peddler';
    if (a.tradeReputation == null) a.tradeReputation = 50;
    if (a.contractsCompleted == null) a.contractsCompleted = 0;
    if (a.contractsFailed == null) a.contractsFailed = 0;
    if (!a.warehouseIds) a.warehouseIds = [];
    if (a.contractId == null) a.contractId = null;
    if (a.pendingContractId == null) a.pendingContractId = null;
    if (!a.body) a.body = defaultCombatBody(a.id);
    if (!a.derivedCombat) a.derivedCombat = defaultDerivedCombat();
    if (!a.injuries) a.injuries = [];
    if (!a.duelRecord) a.duelRecord = { wins: 0, losses: 0, kills: 0 };
    if (!a.memberships) a.memberships = [];
    if (!a.titles) a.titles = [];
    if (!a.grievances) a.grievances = [];
    if (!a.captureCreditIds) a.captureCreditIds = [];
    for (const slot of ['mainHand', 'offHand', 'ranged', 'armor', 'mount', 'tool']) {
      const item = a.equipment?.[slot];
      if (!item) continue;
      if (!item.id) item.id = uid();
      if (item.quality == null) item.quality = 'common';
      if (item.kills == null) item.kills = 0;
      if (item.fame == null) item.fame = 0;
      if (!item.ownerHistory) item.ownerHistory = [];
      if (item.maxDurability == null) item.maxDurability = item.durability || 50;
      if (item.durability == null) item.durability = item.maxDurability;
    }
    if (typeof TextCombatCore !== 'undefined') TextCombatCore.recalcDerivedCombat(a);
  },

  migrateUnit(u) {
    u.memberIds = u.memberIds || [];
    u.objective = u.objective || { type: 'idle' };
    u.supply = Object.assign({ food: 20, arrows: 20, weapons: 5 }, u.supply || {});
    u.battleHistory = u.battleHistory || [];
    u.recentVictories = u.recentVictories || 0;
    u.equipmentPower = u.equipmentPower || 0;
    u.combatPower = u.combatPower || 0;
    if (!u.bonds) u.bonds = defaultUnitBonds();
    else u.bonds = Object.assign(defaultUnitBonds(), u.bonds);
    if (u.retreating == null) u.retreating = false;
    if (!u.composition) u.composition = defaultUnitComposition();
    if (!u.formation) u.formation = 'loose';
    if (!u.formationStats) u.formationStats = defaultFormationStats();
    if (typeof TextCombatCore !== 'undefined') TextCombatCore.updateUnitComposition(u);
  },

  migrateArmy(ar) {
    ar.unitIds = ar.unitIds || [];
    ar.objective = ar.objective || { type: 'idle' };
    ar.supply = Object.assign({ food: 200, arrows: 100, weapons: 30, horses: 5 }, ar.supply || {});
    if (!ar.strategyProfile) ar.strategyProfile = defaultStrategyProfile();
    else ar.strategyProfile = Object.assign(defaultStrategyProfile(), ar.strategyProfile);
    if (!ar.siegeEquipment) ar.siegeEquipment = defaultSiegeEquipment();
    if (!ar.warGoal) ar.warGoal = 'capture_settlement';
    if (ar.baseSettlementId == null) ar.baseSettlementId = ar.locationId;
    if (ar.supplyLineId == null) ar.supplyLineId = null;
    if (ar.campId == null) ar.campId = null;
    if (ar.retreatTargetId == null) ar.retreatTargetId = null;
  },

  migrateFaction(f) {
    f.enemies = f.enemies || [];
    f.allies = f.allies || [];
    f.vassalIds = f.vassalIds || [];
    f.timeline = f.timeline || [];
    f.warState = !!f.warState;
    f.isBandit = !!f.isBandit;
    ensureFactionDiplomacy(f);
    if (f.tradeInfluence == null) f.tradeInfluence = 0;
  },

  migrateWarehouse(wh) {
    wh.stock = Object.assign(newStock(), wh.stock || {});
    wh.capacity = wh.capacity || 100;
    wh.security = wh.security != null ? wh.security : 40;
    wh.rentIncome = wh.rentIncome || 0;
  },

  migrateGuild(g) {
    g.members = g.members || [];
    g.warehouses = g.warehouses || [];
    g.contracts = g.contracts || [];
    g.relations = g.relations || {};
    g.wealth = g.wealth || 0;
    g.influence = g.influence || 0;
    g.reputation = g.reputation != null ? g.reputation : 50;
    g.policyPreference = Object.assign({ lowTax: true, safeRoutes: true, tradeTreaties: true, antiBandit: true }, g.policyPreference || {});
    g._bountyDay = g._bountyDay != null ? g._bountyDay : -99;
  },

  migrateContract(c, day) {
    c.status = c.status || 'open';
    if (c.acceptedByAgentId == null) c.acceptedByAgentId = null;
    if (c.escortUnitId == null) c.escortUnitId = null;
    c.createdDay = c.createdDay != null ? c.createdDay : (day || 0);
  },

  migrateOrganization(org) {
    org.memberIds = org.memberIds || [];
    org.activeWarbandIds = org.activeWarbandIds || [];
    org.activeContractIds = org.activeContractIds || [];
    org.history = org.history || [];
    org.relations = org.relations || {};
    org.ranks = org.ranks || defaultOrgRanks();
    org.roles = org.roles || {};
    org.recruitmentPolicy = org.recruitmentPolicy || { open: true, minSkill: 0, payRate: 1, riskTolerance: 0.5 };
    org.requirements = org.requirements || {};
    org.benefits = org.benefits || {};
    org.rules = org.rules || {};
    if (!org.status) org.status = 'active';
    org.memberIds = org.memberIds.filter(id => { const a = getAgent(id); return a && a.alive; });
    if (!org.sovereignty) org.sovereignty = defaultSovereignty(org);
    if (!org.vassals) org.vassals = [];
  },

  migrateWarband(wb) {
    wb.memberIds = (wb.memberIds || []).filter(id => { const a = getAgent(id); return a && a.alive; });
    wb.unitIds = wb.unitIds || [];
    wb.routePath = wb.routePath || [];
    wb.history = wb.history || [];
    wb.objective = wb.objective || { type: 'idle' };
    if (!wb.composition) wb.composition = defaultUnitComposition();
    wb.size = wb.memberIds.length;
    if (!wb.leaderId || !getAgent(wb.leaderId)?.alive) {
      const m = wb.memberIds.map(getAgent).filter(a => a && a.alive);
      if (m.length) wb.leaderId = m.reduce((b, a) => (a.skills.leadership > b.skills.leadership ? a : b), m[0]).id;
    }
    if (!wb.foundingReason) wb.foundingReason = wb.organizationId ? 'guild_detachment' : 'local_militia';
    if (!wb.politicalMode) wb.politicalMode = wb.organizationId ? 'guild_backed' : 'independent';
  },

  migrateRecruitmentOffer(ro) {
    ro.applicants = ro.applicants || [];
    ro.acceptedAgentIds = ro.acceptedAgentIds || [];
    ro.requirements = ro.requirements || {};
    ro.rewards = ro.rewards || { pay: 10, food: 5 };
    if (!ro.status) ro.status = 'open';
  },

  migrateMusterPoint(mp) {
    mp.expectedAgentIds = mp.expectedAgentIds || [];
    mp.arrivedAgentIds = mp.arrivedAgentIds || [];
    mp.missingAgentIds = mp.missingAgentIds || [];
    if (!mp.status) mp.status = 'pending';
  },

  migrateHeadquarters(hq) {
    hq.storage = Object.assign({ food: 0, gold: 0, weapons: 0 }, hq.storage || {});
    if (hq.beds == null) hq.beds = 10;
    if (hq.security == null) hq.security = 40;
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
    if (typeof MarketTradeSystem !== 'undefined') MarketTradeSystem.initWorld();
    if (typeof AgentMemorySystem !== 'undefined') AgentMemorySystem.initWorld();
    if (typeof CampaignWarfareSystem !== 'undefined') CampaignWarfareSystem.initWorld();
    if (typeof TextCombatCore !== 'undefined') TextCombatCore.initWorld();
    if (typeof LargeBattlefieldSystem !== 'undefined') LargeBattlefieldSystem.initWorld();
    if (typeof OrganizationSystem !== 'undefined') OrganizationSystem.initWorld();
    if (typeof SovereigntySystem !== 'undefined') SovereigntySystem.initWorld();
    if (typeof UIIndexes !== 'undefined') UIIndexes.rebuild(true);
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
    if (prefs.currentView && prefs.currentView !== 'map') UI.currentView = prefs.currentView;
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
