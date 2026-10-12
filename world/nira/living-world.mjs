/**
 * The Realm of Nira — R1 deterministic, browser-local autonomous NPC sandbox.
 * World truth is an explicit state object; the map and route graph are read-only.
 * This is utility/rule AI, NOT remote LLM inference or a persistent server.
 */
import {findShortestPath} from './navigation.mjs';

export const NIRA_R1_SCHEMA = 'nira-living-world-r1-v1';
const GOODS = ['grain', 'fish', 'wood', 'iron_ore', 'herbs', 'tools'];
const PRIMARY = {farmer:'grain', fisherman:'fish', woodcutter:'wood', miner:'iron_ore', healer:'herbs'};
const FIRST = ['Mira','Aren','Liora','Tarin','Kael','Nessa','Daren','Yuna','Vera','Orin','Selin','Rhea','Ember','Elio','Nira','Rovan','Faye','Kirin','Tala','Nolan','Sera','Iris','Bryn','Pera','Arin','Runa','Iven','Luka','Lyra','Venn'];
const JOBS = {
  region_heartland:['farmer','trader','crafter','guard','woodcutter','healer','explorer'],
  region_sunspire:['trader','guard','explorer','farmer','crafter'],
  region_silverridge:['miner','guard','crafter','trader','explorer'],
};
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
const finite=x=>Number.isFinite(x);
const clone=x=>JSON.parse(JSON.stringify(x));
const locOf=(pack,id)=>pack.locations.find(l=>l.id===id);
const priceOf=(good,market,pack)=>{
  const base=pack.resources.find(r=>r.id===good)?.base_value||4;
  const stock=market?.stock?.[good]||0;
  return Math.max(1,Math.round(base*(stock<12?2.0:stock<25?1.45:stock>90?0.65:1)));
};
function hashSeed(seed){let n=2166136261;for(const c of String(seed)){n^=c.charCodeAt(0);n=Math.imul(n,16777619);}return (n>>>0)||1;}
function random(world){let s=world.rngState>>>0;s^=s<<13;s^=s>>>17;s^=s<<5;world.rngState=s>>>0;return world.rngState/4294967296;}
function randomInt(world,n){return Math.floor(random(world)*n);}
function emit(world,type,message,agentId=null){world.eventSeq++;world.events.push({id:world.eventSeq,day:world.day,hour:world.hour,type,message,agentId});if(world.events.length>180)world.events.splice(0,world.events.length-180);}
function isMarketLocation(l){return l&&['city','town','port'].includes(l.type);}
function professionFor(loc,index){
  const list=JOBS[loc.region_id]||(loc.region_id==='region_heartland'?JOBS.region_heartland:['farmer','trader','guard','woodcutter','explorer']);
  return list[index%list.length];
}
function initialMarkets(pack){
  const economy=new Map(pack.region_economy.map(e=>[e.region_id,e]));
  const markets={};
  for(const l of pack.locations){
    if(!isMarketLocation(l))continue;
    const produced=new Set(economy.get(l.region_id)?.produces||[]);
    const stock={};
    for(const g of GOODS)stock[g]=produced.has(g)?70:((g==='grain'||g==='fish')?23:14);
    markets[l.id]={stock,treasury:1800,region_id:l.region_id};
  }
  return markets;
}
/** Spawn exactly one agent identity per target in the R0 mvp30 profile. */
export function createLivingWorld(pack,{profile='mvp30',seed=null}={}){
  if(!pack?.spawn_setup?.profiles?.[profile])throw Error('Unknown spawn profile');
  const setup=pack.spawn_setup.profiles[profile];
  const total=setup.locations.reduce((n,x)=>n+x.count,0);
  if(total!==setup.target_agents)throw Error('Spawn count mismatch');
  const world={schema:NIRA_R1_SCHEMA,mapId:pack.manifest.id,profile,seed:String(seed??pack.spawn_setup.start_seed),rngState:hashSeed(seed??pack.spawn_setup.start_seed),day:1,hour:6,tick:0,eventSeq:0,markets:initialMarkets(pack),agents:[],events:[],stats:{journeys:0,delivered:0,produced:0,meals:0,rests:0,attempts:0,blocked:0}};
  let id=0;
  for(const group of setup.locations){
    const home=locOf(pack,group.location_id);
    if(!isMarketLocation(home))throw Error('Missing spawn settlement '+group.location_id);
    for(let i=0;i<group.count;i++){
      id++;
      const profession=professionFor(home,i);
      world.agents.push({id:`nira_npc_${String(id).padStart(3,'0')}`,name:`${FIRST[(id-1)%FIRST.length]} ${home.name}`,profession,homeId:home.id,locationId:home.id,
        factionId:home.owner_faction_id,inventory:{grain:2,fish:0,wood:0,iron_ore:0,herbs:0,tools:0},gold:24+randomInt(world,30),hunger:20+randomInt(world,16),energy:75+randomInt(world,25),health:100,
        temperament:{risk:Math.round(random(world)*100)/100,sociability:Math.round(random(world)*100)/100},goal:'เริ่มต้นชีวิต',activity:'พักอยู่ที่เมือง',travel:null,cargo:null,visits:0,workCount:0,restCount:0,stories:[]});
    }
  }
  emit(world,'WORLD',`วันแรกของโลก Nira — ประชากร ${world.agents.length} คน เริ่มดำเนินชีวิต`);
  return world;
}

function logAgent(world,agent,type,message){agent.stories.push({day:world.day,hour:world.hour,type,message});if(agent.stories.length>12)agent.stories.shift();emit(world,type,`${agent.name}: ${message}`,agent.id);}
function pathFor(pack,from,to){return findShortestPath(pack,from,to,{allowPortals:false});}
function startJourney(world,pack,agent,target,reason){
  if(agent.travel||agent.locationId===target)return false;
  const path=pathFor(pack,agent.locationId,target);
  if(!path||!path.routes.length||!path.routes.every(r=>r.mode!=='portal')){world.stats.blocked++;return false;}
  agent.travel={nodes:path.nodes,routeIds:path.routes.map(r=>r.id),leg:0,progress:0,to:target,reason};
  agent.goal=reason;agent.activity='เดินทาง';world.stats.journeys++;
  logAgent(world,agent,'TRAVEL',`ออกเดินทางไป ${locOf(pack,target).name} (${reason})`);
  return true;
}
function travelStep(world,pack,agent){
  const t=agent.travel;
  if(!t)return false;
  const route=pack.routes.find(r=>r.id===t.routeIds[t.leg]);
  if(!route){world.stats.blocked++;agent.travel=null;agent.activity='รอแก้เส้นทาง';return true;}
  const speed=route.mode==='sea'?6:route.mode==='bridge'?3:4;
  const distance=Math.max(1,route.distance_units);
  t.progress=clamp(t.progress+speed/distance,0,1);
  agent.energy=clamp(agent.energy-1.3,0,100);
  agent.activity=route.mode==='sea'?'เดินทางทางเรือ':'เดินทางบนเส้นทาง';
  if(t.progress<1)return true;
  const reached=t.nodes[t.leg+1];
  if(!reached){world.stats.blocked++;agent.travel=null;return true;}
  agent.locationId=reached;
  t.leg++;t.progress=0;
  if(t.leg>=t.routeIds.length){agent.travel=null;agent.visits++;agent.activity='ถึงจุดหมาย';logAgent(world,agent,'ARRIVAL',`ถึง ${locOf(pack,reached).name}`);}
  return true;
}
/** Agent position interpolated on SCHEMATIC route lines, not collision-tested terrain. */
export function getAgentMapPosition(pack,agent){
  const cur=locOf(pack,agent.locationId);if(!cur)return null;
  if(!agent.travel)return {x:cur.map_x,y:cur.map_y,traveling:false};
  const t=agent.travel,route=pack.routes.find(r=>r.id===t.routeIds[t.leg]);
  if(!route)return {x:cur.map_x,y:cur.map_y,traveling:false};
  const next=locOf(pack,t.nodes[t.leg+1]);if(!next)return {x:cur.map_x,y:cur.map_y,traveling:false};
  const forward=route.from_location_id===cur.id;
  const via=forward?(route.via||[]):(route.via||[]).slice().reverse();
  const points=[{x:cur.map_x,y:cur.map_y},...via,{x:next.map_x,y:next.map_y}];
  let total=0;const lengths=[];
  for(let i=1;i<points.length;i++){const len=Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y);lengths.push(len);total+=len;}
  let remain=(t.progress||0)*total;
  for(let i=0;i<lengths.length;i++){const len=lengths[i];if(remain<=len||i===lengths.length-1){const f=len>0?clamp(remain/len,0,1):1;return {x:points[i].x+(points[i+1].x-points[i].x)*f,y:points[i].y+(points[i+1].y-points[i].y)*f,traveling:true};}remain-=len;}
  return {x:next.map_x,y:next.map_y,traveling:true};
}
function spendFood(world,agent){
  const food=agent.inventory.grain>0?'grain':agent.inventory.fish>0?'fish':null;
  if(food){agent.inventory[food]--;agent.hunger=clamp(agent.hunger-48,0,100);world.stats.meals++;agent.activity='กินอาหาร';return true;}
  const market=world.markets[agent.locationId];
  if(!market)return false;
  for(const good of ['grain','fish']){
    const price=priceOf(good,market,{resources:[{id:'grain',base_value:4},{id:'fish',base_value:5}]});
    if(market.stock[good]>=1&&agent.gold>=price){market.stock[good]-=1;market.treasury+=price;agent.gold-=price;agent.hunger=clamp(agent.hunger-48,0,100);world.stats.meals++;agent.activity='ซื้ออาหารกิน';return true;}
  }
  return false;
}
function doWork(world,pack,agent){
  const market=world.markets[agent.locationId];
  if(!market){agent.activity='สำรวจพื้นที่';return;}
  if(agent.profession==='trader'){tradeDecision(world,pack,agent);return;}
  if(agent.profession==='explorer'){
    if(agent.locationId!==agent.homeId){agent.activity='สำรวจหมู่บ้าน';return;}
    if(random(world)<0.16){const nearby=pack.routes.filter(r=>(r.from_location_id===agent.locationId||r.bidirectional&&r.to_location_id===agent.locationId)&&r.mode!=='portal').map(r=>r.from_location_id===agent.locationId?r.to_location_id:r.from_location_id).filter(id=>locOf(pack,id));
      if(nearby.length)startJourney(world,pack,agent,nearby[randomInt(world,nearby.length)],'ออกสำรวจ');}
    else agent.activity='เก็บข้อมูลเส้นทาง';return;
  }
  let gain=0;
  if(PRIMARY[agent.profession]){
    const good=PRIMARY[agent.profession];market.stock[good]=(market.stock[good]||0)+2;
    gain=1;world.stats.produced+=2;agent.activity=`ผลิต ${good}`;
  }else if(agent.profession==='crafter'){
    if(market.stock.iron_ore>=1&&market.stock.wood>=1){market.stock.iron_ore--;market.stock.wood--;market.stock.tools++;gain=2;world.stats.produced++;agent.activity='ผลิตเครื่องมือ';}
    else {agent.activity='รอวัตถุดิบ';return;}
  }else if(agent.profession==='guard'){gain=1;agent.activity='รักษาความปลอดภัย';}
  if(gain&&market.treasury>=gain){market.treasury-=gain;agent.gold+=gain;}
  agent.workCount++;agent.energy=clamp(agent.energy-3,0,100);
}
function tradeDecision(world,pack,agent){
  const market=world.markets[agent.locationId];if(!market)return;
  if(agent.cargo){
    const {good,quantity,buyCost}=agent.cargo;
    const price=priceOf(good,market,pack);const total=price*quantity;
    if(market.treasury>=total){market.treasury-=total;market.stock[good]+=quantity;agent.gold+=total;agent.cargo=null;world.stats.delivered++;agent.activity=`ขาย ${good} สำเร็จ`;logAgent(world,agent,'TRADE',`ขาย ${good} ${quantity} หน่วย ได้กำไร ${total-buyCost} เหรียญ`);}else{agent.activity='รอตลาดมีเงิน';}
    return;
  }
  // Choose a reachable town with a price gap large enough to cover travel risk.
  const alternatives=pack.locations.filter(l=>l.id!==agent.locationId&&isMarketLocation(l)&&world.markets[l.id]);
  let best=null;
  for(const dest of alternatives){
    const path=pathFor(pack,agent.locationId,dest.id);if(!path||path.units>65||path.routes.some(r=>r.mode==='portal'))continue;
    const destMarket=world.markets[dest.id];
    for(const good of GOODS){
      const cost=priceOf(good,market,pack),sale=priceOf(good,destMarket,pack);
      const quantity=Math.min(2,market.stock[good],Math.floor(agent.gold/cost));
      const potential=(sale-cost)*quantity-path.units*0.08;
      if(quantity&&potential>2&&(!best||potential>best.profit))best={dest:dest.id,good,quantity,cost,profit:potential};
    }
  }
  if(best){
    const total=best.cost*best.quantity;
    if(market.stock[best.good]<best.quantity||agent.gold<total)return;
    // Reserve cargo now; if the path fails, refund it immediately.
    market.stock[best.good]-=best.quantity;market.treasury+=total;agent.gold-=total;
    agent.cargo={good:best.good,quantity:best.quantity,buyCost:total};
    if(!startJourney(world,pack,agent,best.dest,'ส่งสินค้า')){
      market.stock[best.good]+=best.quantity;market.treasury-=total;agent.gold+=total;agent.cargo=null;
    }
  }else agent.activity='ตรวจราคาตลาด';
}
function stepAgent(world,pack,agent){
  world.stats.attempts++;
  agent.hunger=clamp(agent.hunger+1.5,0,100);
  if(agent.travel){travelStep(world,pack,agent);return;}
  if(agent.hunger>=64){if(spendFood(world,agent))return;agent.activity='ขาดแคลนอาหาร';agent.health=clamp(agent.health-1,0,100);}
  if(world.hour>=20||world.hour<6||agent.energy<20){agent.energy=clamp(agent.energy+11,0,100);agent.activity='พักผ่อน';agent.restCount++;world.stats.rests++;return;}
  if(agent.locationId!==agent.homeId&&!agent.cargo&&world.hour>=16){if(startJourney(world,pack,agent,agent.homeId,'กลับบ้าน'))return;}
  if(world.hour>=7&&world.hour<18)doWork(world,pack,agent);
  else agent.activity='พักหลังเลิกงาน';
}
function stepOne(world,pack){
  for(const a of world.agents)stepAgent(world,pack,a);
  world.tick++;world.hour++;
  if(world.hour>=24){world.hour=0;world.day++;emit(world,'DAY',`เริ่มวันที่ ${world.day} — สินค้าเคลื่อนไหว ${world.stats.delivered} เที่ยว การเดินทาง ${world.stats.journeys} ครั้ง`);}
}
/** One tick == one simulated hour. No clock keeps running after the page closes. */
export function stepLivingWorld(world,pack,hours=1){
  if(!Number.isInteger(hours)||hours<1||hours>48)throw Error('Invalid hours');
  for(let i=0;i<hours;i++)stepOne(world,pack);
  return world;
}
export function snapshotLivingWorld(world){return clone(world);}
export function restoreLivingWorld(pack,saved){
  if(typeof saved==='string')saved=JSON.parse(saved);
  if(!saved||saved.schema!==NIRA_R1_SCHEMA||saved.mapId!==pack.manifest.id)throw Error('Snapshot schema or map does not match');
  if(!['mvp30','expanded132'].includes(saved.profile))throw Error('Unknown snapshot profile');
  const expected=pack.spawn_setup.profiles[saved.profile]?.target_agents;
  if(!Array.isArray(saved.agents)||saved.agents.length!==expected||new Set(saved.agents.map(a=>a.id)).size!==expected)throw Error('Invalid snapshot population');
  if(!Number.isInteger(saved.hour)||saved.hour<0||saved.hour>23||!Number.isInteger(saved.day)||saved.day<1||!Number.isInteger(saved.tick)||saved.tick<0||!Number.isInteger(saved.rngState))throw Error('Invalid snapshot clock');
  for(const a of saved.agents){
    if(!locOf(pack,a.locationId)||!locOf(pack,a.homeId))throw Error('Unknown location in snapshot');
    if(!finite(a.gold)||a.gold<0||!finite(a.hunger)||!finite(a.energy))throw Error('Invalid agent values');
    if(a.travel){const t=a.travel;if(!Array.isArray(t.nodes)||!Array.isArray(t.routeIds)||!Number.isInteger(t.leg)||t.leg<0||t.leg>=t.routeIds.length||t.routeIds.some(id=>!pack.routes.some(r=>r.id===id)))throw Error('Invalid journey');}
  }
  for(const [id,m] of Object.entries(saved.markets||{})){
    if(!isMarketLocation(locOf(pack,id))||!finite(m.treasury)||m.treasury<0)throw Error('Invalid market');
    for(const qty of Object.values(m.stock||{}))if(!finite(qty)||qty<0)throw Error('Invalid market stock');
  }
  if(!Array.isArray(saved.events)||saved.events.length>180)throw Error('Invalid event log');
  return clone(saved);
}
export function verifyLivingWorld(world,pack){
  const errors=[];
  if(world.agents.length!==pack.spawn_setup.profiles[world.profile].target_agents)errors.push('population mismatch');
  const ids=new Set();
  for(const a of world.agents){
    if(ids.has(a.id))errors.push('duplicate agent '+a.id);ids.add(a.id);
    if(!locOf(pack,a.locationId))errors.push('bad location '+a.id);
    for(const v of [a.gold,a.hunger,a.energy,a.health])if(!finite(v)||v<0)errors.push('bad agent metric '+a.id);
    for(const value of Object.values(a.inventory))if(!finite(value)||value<0)errors.push('bad agent inventory '+a.id);
    if(a.travel){const t=a.travel;if(t.leg<0||t.leg>=t.routeIds.length||t.nodes[t.leg]!==a.locationId)errors.push('bad journey '+a.id);}
  }
  for(const market of Object.values(world.markets)){
    if(!finite(market.treasury)||market.treasury<0)errors.push('negative treasury');
    for(const q of Object.values(market.stock))if(!finite(q)||q<0)errors.push('negative stock');
  }
  return {ok:errors.length===0,errors};
}
