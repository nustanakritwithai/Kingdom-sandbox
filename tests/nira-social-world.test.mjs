import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLivingWorld,stepLivingWorld,snapshotLivingWorld,restoreLivingWorld,verifyLivingWorld,NIRA_R1_SCHEMA,NIRA_R2_SCHEMA} from '../world/nira/living-world.mjs';
import {resolveSocialEncounter,verifySocialWorld,SOCIAL_MEMORY_CAP,SOCIAL_EVENT_CAP} from '../world/nira/social-world.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../world/nira');
const names=['manifest','regions','factions','locations','routes','resources','region_economy','spawn_setup'];
const pack=Object.fromEntries(names.map(name=>[name,JSON.parse(fs.readFileSync(path.join(root,`${name}.json`),'utf8'))]));
let passed=0;
function check(name,fn){fn();console.log('PASS R2',name);passed++;}
check('R2 starts with identity isolation and empty per-NPC social state',()=>{
 const w=createLivingWorld(pack);
 assert.equal(w.schema,NIRA_R2_SCHEMA);assert.equal(w.agents.length,30);
 for(const a of w.agents){assert.ok(a.social);assert.deepEqual(a.social.relations,{});assert.deepEqual(a.social.beliefs,{});assert.deepEqual(a.social.memories,[]);}
 assert.equal(verifySocialWorld(w,pack).ok,true);
});
check('social encounters require physical co-location, no remote knowledge leakage',()=>{
 const w=createLivingWorld(pack);const a=w.agents[0],b=w.agents.find(x=>x.homeId!==a.homeId);assert.ok(b);
 assert.deepEqual(resolveSocialEncounter(w,pack,a,b),[]);assert.equal(w.stats.socialMeetings,0);
 b.locationId=a.locationId;b.travel={nodes:[b.locationId,'loc_greenford'],routeIds:['not-a-real-route'],leg:0,progress:0};
 assert.deepEqual(resolveSocialEncounter(w,pack,a,b),[]);assert.equal(w.stats.socialMeetings,0);
});
check('food help transfers one existing unit and increases trust; no ghost inventory',()=>{
 const w=createLivingWorld(pack);const a=w.agents[0],b=w.agents[1];assert.equal(a.locationId,b.locationId);
 a.inventory.grain=5;a.temperament.sociability=1;b.inventory.grain=0;b.inventory.fish=0;b.hunger=85;
 const before=a.inventory.grain+b.inventory.grain;
 const events=resolveSocialEncounter(w,pack,a,b);
 assert.ok(events.some(e=>e.kind==='HELP'));
 assert.equal(a.inventory.grain,4);assert.equal(b.inventory.grain,1);
 assert.equal(a.inventory.grain+b.inventory.grain,before);
 assert.equal(w.stats.socialHelp,1);
 assert.ok(b.social.relations[a.id].trust>a.social.relations[b.id].trust);
 assert.ok(a.social.memories.some(x=>x.kind==='help_given'));
 assert.ok(b.social.memories.some(x=>x.kind==='help_received'));
 assert.equal(verifyLivingWorld(w,pack).ok,true);
});
check('market reports are second-hand beliefs with provenance, never world truth',()=>{
 const w=createLivingWorld(pack),a=w.agents[0],b=w.agents[1];
 a.social.beliefs['food:loc_solkar']={key:'food:loc_solkar',locationId:'loc_solkar',kind:'food_supply',value:'scarce',status:'observed',sourceAgentId:null,originAgentId:a.id,confidence:1,relayDepth:0,observedDay:1,updatedTick:0};
 a.temperament.sociability=1;
 const initial=JSON.stringify(w.markets);
 const events=resolveSocialEncounter(w,pack,a,b);
 assert.ok(events.some(e=>e.kind==='REPORT'));
 const received=b.social.beliefs['food:loc_solkar'];
 assert.equal(received.status,'reported');assert.equal(received.sourceAgentId,a.id);
 assert.equal(received.originAgentId,a.id);assert.ok(received.confidence<1);
 assert.equal(JSON.stringify(w.markets),initial);
 assert.equal(verifyLivingWorld(w,pack).ok,true);
});
check('R2 keeps bounded NPC memories and social events during 120 simulated days',()=>{
 const w=createLivingWorld(pack);
 for(let n=0;n<120;n++){stepLivingWorld(w,pack,24);const res=verifyLivingWorld(w,pack);assert.ok(res.ok,res.errors.join('|'));}
 assert.ok(w.stats.socialMeetings>=100);
 assert.ok(w.stats.socialObservations>=100);
 assert.ok(w.stats.knowledgeShared>0);
 assert.ok(w.social.events.length<=SOCIAL_EVENT_CAP);
 for(const a of w.agents){assert.ok(a.social.memories.length<=SOCIAL_MEMORY_CAP);assert.ok(Object.keys(a.social.beliefs).length<=16);}
 console.log('R2 metrics',JSON.stringify(Object.fromEntries(Object.entries(w.stats).filter(([k])=>k.startsWith('social')||k==='knowledgeShared'))));
});
check('R1 saved state migrates to R2 preserving economy, population and event history',()=>{
 const old=createLivingWorld(pack,{seed:'MIGR-2026'});stepLivingWorld(old,pack,47);
 const legacy=snapshotLivingWorld(old);legacy.schema=NIRA_R1_SCHEMA;delete legacy.social;
 for(const a of legacy.agents)delete a.social;
 for(const key of ['socialMeetings','socialHelp','socialDisputes','knowledgeShared','socialObservations'])delete legacy.stats[key];
 const restored=restoreLivingWorld(pack,legacy);
 assert.equal(restored.schema,NIRA_R2_SCHEMA);
 assert.deepEqual(restored.agents.map(a=>a.id),old.agents.map(a=>a.id));
 assert.deepEqual(restored.markets,old.markets);assert.equal(restored.day,old.day);
 assert.equal(restored.events.length,old.events.length);
 assert.ok(restored.agents.every(a=>a.social));
 assert.equal(verifyLivingWorld(restored,pack).ok,true);
 stepLivingWorld(restored,pack,24);assert.equal(verifyLivingWorld(restored,pack).ok,true);
});
check('R2 save -> restore -> replay is deterministic',()=>{
 const a=createLivingWorld(pack,{seed:'SOCIAL-DETERMINISM'}),b=createLivingWorld(pack,{seed:'SOCIAL-DETERMINISM'});
 for(let i=0;i<20;i++){stepLivingWorld(a,pack,24);stepLivingWorld(b,pack,24);}
 assert.deepEqual(a,b);
 const c=restoreLivingWorld(pack,snapshotLivingWorld(a));
 for(let i=0;i<10;i++){stepLivingWorld(a,pack,24);stepLivingWorld(c,pack,24);}
 assert.deepEqual(a,c);
});
check('tampered social snapshot fails restore without accepting impossible trust',()=>{
 const w=createLivingWorld(pack),bad=snapshotLivingWorld(w);
 bad.agents[0].social.relations['nira_npc_002']={trust:999,contacts:5,helped:0,lastDay:1};
 assert.throws(()=>restoreLivingWorld(pack,bad),/Invalid social state/);
 const b=snapshotLivingWorld(w);
 b.agents[0].social.beliefs['food:loc_solkar']={key:'food:loc_solkar',locationId:'loc_solkar',status:'observed',confidence:1,relayDepth:0,sourceAgentId:'nira_npc_007',originAgentId:'nira_npc_007'};
 assert.throws(()=>restoreLivingWorld(pack,b),/Invalid social state/);
});
check('optional 132 NPC profile remains healthy with R2 social logic',()=>{
 const w=createLivingWorld(pack,{profile:'expanded132',seed:'SCALE132'});
 assert.equal(w.agents.length,132);
 for(let i=0;i<15;i++)stepLivingWorld(w,pack,24);
 const res=verifyLivingWorld(w,pack);assert.ok(res.ok,res.errors.join('|'));
 assert.ok(w.stats.socialMeetings>0);
});
console.log(`R2 SOCIAL TESTS ${passed}/${passed} PASSED`);
