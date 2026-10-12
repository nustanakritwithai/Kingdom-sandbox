/**
 * Nira R2 social simulation: bounded, deterministic relationships, first-hand
 * observations, second-hand beliefs and evidence-backed cooperation.
 * Utility/rule agents only. No LLM, remote inference, or hidden world access.
 */
export const NIRA_SOCIAL_VERSION = 1;
export const SOCIAL_MEMORY_CAP = 20;
export const SOCIAL_BELIEF_CAP = 16;
export const SOCIAL_EVENT_CAP = 120;
const cap = (n,low,high) => Math.max(low,Math.min(high,n));
const finite = n => typeof n === 'number' && Number.isFinite(n);
const locOf = (pack,id) => pack.locations.find(l=>l.id===id);
const memo = (agent,item) => {
  agent.social.memories.push(item);
  if(agent.social.memories.length>SOCIAL_MEMORY_CAP)agent.social.memories.splice(0,agent.social.memories.length-SOCIAL_MEMORY_CAP);
};
const statsDefault = {socialMeetings:0,socialHelp:0,socialDisputes:0,knowledgeShared:0,socialObservations:0,socialConfirmedReports:0,socialCorrectedReports:0};
function trimBeliefs(agent,protectedKey){
  const keys=Object.keys(agent.social.beliefs);
  if(keys.length<=SOCIAL_BELIEF_CAP)return;
  const removable=keys.filter(k=>k!==protectedKey).sort((a,b)=>(agent.social.beliefs[a].updatedTick||0)-(agent.social.beliefs[b].updatedTick||0)||a.localeCompare(b));
  for(const key of removable.slice(0,keys.length-SOCIAL_BELIEF_CAP))delete agent.social.beliefs[key];
}

/** Only call with new state or an explicitly recognized R1 snapshot migration. */
export function initializeSocialWorld(world){
  if(!world.social) world.social={version:NIRA_SOCIAL_VERSION,seq:0,events:[]};
  for(const [key,val] of Object.entries(statsDefault))if(world.stats[key]===undefined)world.stats[key]=val;
  for(const a of world.agents){
    if(!a.social) a.social={relations:{},memories:[],beliefs:{},lastObservedDay:-1};
  }
  return world;
}
function relationship(a,b){
  return a.social.relations[b.id] || (a.social.relations[b.id]={trust:50,contacts:0,helped:0,lastDay:0});
}
function socialEvent(world,kind,locationId,participants,summary){
  const event={id:++world.social.seq,day:world.day,hour:world.hour,tick:world.tick,kind,locationId,participants:[...participants],summary};
  world.social.events.push(event);
  if(world.social.events.length>SOCIAL_EVENT_CAP)world.social.events.splice(0,world.social.events.length-SOCIAL_EVENT_CAP);
  return event;
}
function observeMarket(world,agent){
  const market=world.markets[agent.locationId];
  if(!market||agent.travel||agent.social.lastObservedDay===world.day)return;
  agent.social.lastObservedDay=world.day;
  const food=(market.stock.grain||0)+(market.stock.fish||0);
  const knownKey='food:'+agent.locationId;
  // A report can only be checked through the receiver's own observation.
  // A mismatch can reflect a changing market, not intentional deception.
  const observedValue=food<30?'scarce':'available';
  const prior=agent.social.beliefs[knownKey];
  if(prior?.status==='reported'&&prior.sourceAgentId){
    const source=world.agents.find(a=>a.id===prior.sourceAgentId);
    if(source&&source.id!==agent.id){
      const rel=relationship(agent,source);
      const confirmed=prior.value===observedValue;
      rel.trust=cap(rel.trust+(confirmed?4:-7),0,100);
      const kind=confirmed?'CONFIRMED':'CORRECTED';
      const stat=confirmed?'socialConfirmedReports':'socialCorrectedReports';
      world.stats[stat]=(world.stats[stat]||0)+1;
      const msg=confirmed
        ? `${agent.name} ตรวจตลาดและยืนยันข่าวจาก ${source.name}`
        : `${agent.name} ตรวจตลาดพบว่าข่าวจาก ${source.name} ไม่ตรงกับข้อมูลล่าสุด`;
      memo(agent,{kind:kind.toLowerCase(),day:world.day,hour:world.hour,locationId:agent.locationId,peerId:source.id,summary:msg});
      socialEvent(world,kind,agent.locationId,[agent.id,source.id],msg);
    }
  }
  agent.social.beliefs[knownKey]={key:knownKey,locationId:agent.locationId,kind:'food_supply',value:food<30?'scarce':'available',
    status:'observed',sourceAgentId:null,originAgentId:agent.id,confidence:1,relayDepth:0,observedDay:world.day,updatedTick:world.tick};
  trimBeliefs(agent,knownKey);
  world.stats.socialObservations++;
}
function shareObservation(world,from,to){
  const candidates=Object.values(from.social.beliefs)
    .filter(x=>x.status==='observed'||(x.status==='reported'&&x.relayDepth<2))
    .filter(x=>x.locationId!==to.locationId)
    .sort((a,b)=>a.key.localeCompare(b.key));
  const fact=candidates.find(x=>{
    const known=to.social.beliefs[x.key];
    return !known || (known.status!=='observed'&&known.observedDay<x.observedDay);
  });
  if(!fact)return null;
  to.social.beliefs[fact.key]={...fact,status:'reported',sourceAgentId:from.id,confidence:cap(fact.confidence*.7,0.1,.85),relayDepth:fact.relayDepth+1,updatedTick:world.tick};
  trimBeliefs(to,fact.key);
  world.stats.knowledgeShared++;
  return fact;
}
/**
 * Resolve an actual, same-location encounter. Returns social event objects;
 * rejects remote or traveling characters. Transfers existing food only.
 */
export function resolveSocialEncounter(world,pack,a,b){
  if(!a||!b||a.id===b.id||!world.agents.includes(a)||!world.agents.includes(b))return [];
  if(a.travel||b.travel||a.locationId!==b.locationId||!locOf(pack,a.locationId))return [];
  if(!a.social||!b.social||!world.social)throw Error('Social system not initialized');
  const out=[];
  const ra=relationship(a,b),rb=relationship(b,a);
  for(const r of [ra,rb]){r.contacts++;r.lastDay=world.day;r.trust=cap(r.trust+1,0,100);}
  world.stats.socialMeetings++;
  memo(a,{kind:'meeting',day:world.day,hour:world.hour,locationId:a.locationId,peerId:b.id,summary:`พบ ${b.name}`});
  memo(b,{kind:'meeting',day:world.day,hour:world.hour,locationId:a.locationId,peerId:a.id,summary:`พบ ${a.name}`});
  const meet=socialEvent(world,'MEET',a.locationId,[a.id,b.id],`${a.name} พบ ${b.name} ที่ ${locOf(pack,a.locationId).name}`);
  out.push(meet);

  // Cooperative help is constrained by physical inventory and local presence.
  const pairs=[[a,b],[b,a]];
  for(const [giver,receiver] of pairs){
    const gRel=relationship(giver,receiver);
    const good=giver.inventory.grain>=2?'grain':giver.inventory.fish>=2?'fish':null;
    const receiverFood=(receiver.inventory.grain||0)+(receiver.inventory.fish||0);
    if(!good||receiverFood>1||receiver.hunger<30||giver.temperament.sociability<.35||gRel.trust<38||giver.hunger>=70)continue;
    giver.inventory[good]--;receiver.inventory[good]++;
    gRel.trust=cap(gRel.trust+2,0,100);gRel.helped++;
    relationship(receiver,giver).trust=cap(relationship(receiver,giver).trust+7,0,100);
    world.stats.socialHelp++;
    const message=`${giver.name} แบ่ง ${good} 1 หน่วยให้ ${receiver.name}`;
    memo(giver,{kind:'help_given',day:world.day,hour:world.hour,locationId:giver.locationId,peerId:receiver.id,summary:message});
    memo(receiver,{kind:'help_received',day:world.day,hour:world.hour,locationId:receiver.locationId,peerId:giver.id,summary:message});
    out.push(socialEvent(world,'HELP',giver.locationId,[giver.id,receiver.id],message));
    break;
  }

  // A reported belief never changes authoritative market stock or becomes truth.
  for(const [speaker,listener] of pairs){
    if(speaker.temperament.sociability<.3)continue;
    const shared=shareObservation(world,speaker,listener);
    if(shared){
      const message=`${speaker.name} เล่าข้อมูลตลาด ${locOf(pack,shared.locationId)?.name||shared.locationId} ให้ ${listener.name} ฟัง (ข่าวบอกต่อ ไม่ยืนยัน)`;
      memo(listener,{kind:'reported',day:world.day,hour:world.hour,locationId:listener.locationId,peerId:speaker.id,summary:message});
      out.push(socialEvent(world,'REPORT',speaker.locationId,[speaker.id,listener.id],message));
    }
  }

  // Occasional personality-driven disputes are bounded and leave consequences.
  if((world.day+Number(a.id.slice(-3))+Number(b.id.slice(-3)))%17===0 && a.temperament.sociability<.32 && b.temperament.risk>.65){
    ra.trust=cap(ra.trust-7,0,100);rb.trust=cap(rb.trust-5,0,100);
    world.stats.socialDisputes++;
    const message=`${a.name} และ ${b.name} มีความเห็นขัดแย้งกัน`;
    memo(a,{kind:'dispute',day:world.day,hour:world.hour,locationId:a.locationId,peerId:b.id,summary:message});
    memo(b,{kind:'dispute',day:world.day,hour:world.hour,locationId:b.locationId,peerId:a.id,summary:message});
    out.push(socialEvent(world,'DISPUTE',a.locationId,[a.id,b.id],message));
  }
  return out;
}

/** Two scheduled encounters per day, maximum 3 pairs per settlement per slot. */
export function tickSocialWorld(world,pack){
  if(![10,17].includes(world.hour))return [];
  for(const agent of world.agents)observeMarket(world,agent);
  const out=[];
  const cities=new Map();
  for(const a of world.agents){
    if(a.travel)continue;
    if(!cities.has(a.locationId))cities.set(a.locationId,[]);
    cities.get(a.locationId).push(a);
  }
  for(const id of [...cities.keys()].sort()){
    const agents=cities.get(id).sort((a,b)=>a.id.localeCompare(b.id));
    if(agents.length<2)continue;
    const shift=(world.day+(world.hour===17?1:0))%agents.length;
    const rotated=agents.slice(shift).concat(agents.slice(0,shift));
    for(let i=0;i<Math.min(6,rotated.length-1);i+=2){
      out.push(...resolveSocialEncounter(world,pack,rotated[i],rotated[i+1]));
    }
  }
  return out;
}

export function verifySocialWorld(world,pack){
  const errors=[];
  if(world.social?.version!==NIRA_SOCIAL_VERSION||!Number.isInteger(world.social?.seq)||world.social.seq<0||!Array.isArray(world.social.events)||world.social.events.length>SOCIAL_EVENT_CAP)errors.push('invalid social event store');
  const ids=new Set(world.agents.map(a=>a.id));
  for(const [k] of Object.entries(statsDefault))if(!Number.isInteger(world.stats[k])||world.stats[k]<0)errors.push('bad social counter '+k);
  for(const a of world.agents){
    const social=a.social;
    if(!social||!Array.isArray(social.memories)||social.memories.length>SOCIAL_MEMORY_CAP||!social.relations||!social.beliefs||typeof social.beliefs!=='object'){
      errors.push('bad social state '+a.id);continue;
    }
    if(Object.keys(social.beliefs).length>SOCIAL_BELIEF_CAP)errors.push('too many beliefs '+a.id);
    for(const [peer,r] of Object.entries(social.relations)){
      if(!ids.has(peer)||peer===a.id||!finite(r.trust)||r.trust<0||r.trust>100||!Number.isInteger(r.contacts)||r.contacts<0||!Number.isInteger(r.helped)||r.helped<0)errors.push('bad relationship '+a.id+':'+peer);
    }
    for(const m of social.memories){
      if(!locOf(pack,m.locationId)||!ids.has(m.peerId)||m.peerId===a.id)errors.push('bad social memory '+a.id);
    }
    for(const [key,belief] of Object.entries(social.beliefs)){
      if(key!==belief.key||!locOf(pack,belief.locationId)||!['reported','observed'].includes(belief.status)||!finite(belief.confidence)||belief.confidence<0||belief.confidence>1||!Number.isInteger(belief.relayDepth)||belief.relayDepth<0||belief.relayDepth>2)errors.push('bad belief '+a.id);
      if(belief.status==='reported'&&(!ids.has(belief.sourceAgentId)||belief.sourceAgentId===a.id))errors.push('bad report source '+a.id);
      if(belief.status==='observed'&&(belief.sourceAgentId!==null||belief.originAgentId!==a.id))errors.push('bad observed provenance '+a.id);
    }
  }
  for(const e of world.social?.events||[])if(!locOf(pack,e.locationId)||!Array.isArray(e.participants)||e.participants.some(id=>!ids.has(id)))errors.push('bad social event '+e.id);
  return {ok:errors.length===0,errors};
}
